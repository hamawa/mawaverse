import { ref, get, update, push, set, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow, onNewChild } from '../firebase/db';
import { dayKey } from '../shared/util';
import { G, O, groundAt, objectAt, isWalkable, roomAt, type MapData } from './map';
import type { Net } from './net';
import type { WorldCtx } from './state';
import { MAIN_MAP_ID } from '../shared/maps';

export const DIG_SPOTS = 5;          // 하루 자리 수
export const DIG_MS = 1500;          // 삽질 시간
export const DIG_HINT_RADIUS = 4;    // 지도에 표시하는 원 반경 (칸)
export const DIG_BOX_COINS = 100;    // 보물 상자
export const DIG_JUNK_CHANCE = 0.2;  // 꽝 확률 (보물 상자 자리 제외)
export const DIG_COIN_MIN = 10, DIG_COIN_MAX = 50;

export interface DigSpot { i: number; x: number; y: number; box: boolean; cx: number; cy: number } // cx,cy = 지도에 그리는 원의 중심 (자리에서 조금 비켜 있다)
export interface DigRecord { c: number; at: number }                                             // dig/{day}/{uid}/{i}: 받은 코인, 시각
export interface DigFeed { u: string; n: string; ts: number }                                   // dig/feed: 보물 상자 발견 공지

// 날짜 문자열로 시드를 만들어 모두 같은 자리를 본다
function seedOf(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const DIGGABLE = new Set<number>([G.GRASS, G.GRASS2, G.SAND, G.FLOWER]);

// 오늘의 자리: 풀·모래·꽃밭의 빈 칸 중 서로 6칸 이상 떨어진 곳 5군데. 하나는 보물 상자
export function dailySpots(m: MapData, day = dayKey()): DigSpot[] {
  const rnd = mulberry(seedOf(day + ':' + m.w + 'x' + m.h));
  const spots: DigSpot[] = [];
  const boxIdx = Math.floor(rnd() * DIG_SPOTS);
  for (let tries = 0; tries < 400 && spots.length < DIG_SPOTS; tries++) {
    const x = 1 + Math.floor(rnd() * (m.w - 2)), y = 1 + Math.floor(rnd() * (m.h - 2));
    if (!DIGGABLE.has(groundAt(m, x, y)) || objectAt(m, x, y) !== O.NONE || !isWalkable(m, x, y) || roomAt(m, x, y)) continue;
    if (spots.some((s) => Math.abs(s.x - x) + Math.abs(s.y - y) < 6)) continue;
    const ox = Math.round((rnd() - 0.5) * 4), oy = Math.round((rnd() - 0.5) * 4);
    spots.push({ i: spots.length, x, y, box: spots.length === boxIdx, cx: x + ox, cy: y + oy });
  }
  return spots;
}

// 보물 지도: 매일 5곳. 그 칸에 서서 F → 1.5초 삽질 → 코인(10~50) / 꽝 / 보물 상자(100 + 전체 공지). 각자 하루 한 번씩
export class DigMgr {
  spots: DigSpot[] = [];
  dug = new Set<number>();
  private day = '';
  private digging: { spot: DigSpot; until: number } | null = null;
  private feedUnsub: (() => void) | null = null;
  private saving = false;

  constructor(private w: WorldCtx, private net: Net) {}

  start(): void {
    void this.refresh();
    this.feedUnsub = onNewChild('dig/feed', serverNow(), 5, (s) => {
      const e = s.val() as DigFeed;
      this.w.events.emit('log', { channel: 'notice', from: '', text: `💎 ${e.n} 님이 오늘의 보물 상자를 찾았습니다! (+${DIG_BOX_COINS}코인)`, ts: e.ts || serverNow() });
    });
  }
  stop(): void { this.feedUnsub?.(); this.feedUnsub = null; this.digging = null; }

  // 날짜가 바뀌면 자리와 기록을 다시 읽는다
  async refresh(): Promise<void> {
    const day = dayKey();
    if (day === this.day) return;
    this.day = day;
    this.spots = dailySpots(this.w.mainMap, day); // 보물 자리는 기본 맵 기준 (다른 맵에 있을 때 날이 바뀌어도)
    this.dug = new Set();
    try {
      const v = (await get(ref(db, `dig/${day}/${this.w.uid}`))).val() as Record<string, DigRecord> | null;
      for (const k of Object.keys(v || {})) this.dug.add(Number(k));
    } catch { /* 다음 기회에 */ }
  }

  get active(): boolean { return !!this.digging; }
  // 내가 서 있는 칸의 아직 안 판 자리
  spotHere(): DigSpot | null {
    const me = this.w.me;
    if (me.moving || me.locked || me.roomId || this.w.mapId !== MAIN_MAP_ID) return null;
    return this.spots.find((s) => s.x === me.x && s.y === me.y && !this.dug.has(s.i)) || null;
  }
  // F: 삽질 시작
  begin(): boolean {
    if (this.digging || this.saving) return false;
    const s = this.spotHere();
    if (!s) return false;
    this.digging = { spot: s, until: performance.now() + DIG_MS };
    return true;
  }
  cancel(): void { if (this.digging) { this.digging = null; this.w.toast('삽질을 멈췄어요.'); } }

  tick(now: number): void {
    if (this.day !== dayKey()) void this.refresh();
    if (!this.digging) return;
    if (this.w.me.moving) { this.cancel(); return; }
    if (now >= this.digging.until) { const s = this.digging.spot; this.digging = null; void this.finish(s); }
  }

  private async finish(s: DigSpot): Promise<void> {
    const w = this.w;
    this.dug.add(s.i);
    let coins = 0, text = '';
    if (s.box) { coins = DIG_BOX_COINS; text = `💎 보물 상자! +${coins}코인`; }
    else if (Math.random() < DIG_JUNK_CHANCE) { coins = 0; text = ['🪱 지렁이만 나왔다… 꽝!', '🥾 누가 묻어둔 장화. 꽝!', '📎 녹슨 클립 한 개. 꽝!'][Math.floor(Math.random() * 3)]; }
    else { coins = DIG_COIN_MIN + Math.floor(Math.random() * (DIG_COIN_MAX - DIG_COIN_MIN + 1)); text = `💰 동전 주머니! +${coins}코인`; }
    w.setBubble(w.uid, { text: s.box ? '💎!' : coins ? '💰' : '🪱', kind: 'near', at: performance.now() });
    w.events.emit('log', { channel: 'sys', from: '', text: `⛏ ${text} (오늘 ${this.dug.size}/${this.spots.length}곳)`, ts: serverNow() });
    this.saving = true;
    try {
      await update(ref(db), { [`dig/${this.day}/${w.uid}/${s.i}`]: { c: coins, at: serverTimestamp() } });
      if (coins > 0) void w.wallet.earn(coins);
      if (s.box) { const feed: DigFeed = { u: w.uid, n: w.profile.nick, ts: serverTimestamp() as unknown as number }; await set(push(ref(db, 'dig/feed')), feed); w.toast('💎 오늘의 보물 상자를 찾았습니다!'); }
      if (this.dug.size >= this.spots.length) w.toast('오늘 자리를 다 팠어요! 내일 새 지도가 나옵니다.');
      this.net.stat('dig');
    } catch (e) { console.warn('dig save failed', e); w.toast('기록 저장에 실패했습니다.', true); }
    finally { this.saving = false; }
  }
}
