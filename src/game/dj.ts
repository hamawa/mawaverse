// 클럽 DJ (2026-11-19, 사용자 요청): 유튜브 링크를 넣으면 클럽에 있는 모두가 같은 노래를 같은 지점부터 듣는다.
// 서버에는 "어떤 영상을 언제부터 틀었나" 한 줄만 둔다 (club/dj = { v: 영상 id, at: 튼 서버 시각, u, n, k, t }). 영상과 소리는 각자의 브라우저가 유튜브에서 직접 받는다:
// Firebase 전송량은 늘지 않는다. 클럽에 있는 동안에만 구독한다.
// 유튜브 약관: 공식 플레이어를 화면에 보이는 채로(200×200 이상) 써야 하고 소리만 따로 틀면 안 된다. 그래서 패널을 접으면 내 화면에서는 재생을 멈춘다 (djui.ts)
//
// 노래 예약 (2026-11-20 밤, 사용자 요청: 노래방처럼). 전에는 한 곡씩 덮어썼다.
// - 예약: DJ 기계 옆(CLUB_DJ_SPOTS: 사방 여섯 칸)에서 club/q/{uid}_0 ~ {uid}_9 = { v, u, n, at, t?, p? } 를 쓴다. 열쇠가 열 개뿐이라 한 사람 열 곡은 규칙이 지킨다
//   (2026-11-23 에 두 곡 → 열 곡). 전체 20곡(DJ_Q_MAX)은 화면이 지킨다: 규칙은 예약의 개수를 셀 수 없다.
//   p: 1 은 우선 예약 (보통 예약보다 먼저 나온다. 한 사람이 한 번에 하나: 규칙). 순서는 shared/youtube.ts djOrder.
// - 다음 곡: 서버가 없으므로 클럽에 있는 아무 화면이 넘긴다 (거래소의 가격 굴리기와 같은 방식). 넘기는 쓰기는 "club/dj = 그 예약, club/q/{k} = 지움" 한 번이고
//   규칙이 그 예약이 같은 쓰기에서 빠졌는지와 내용이 같은지를 본다: 여럿이 한꺼번에 보내도 한 번만 넘어가고, 예약에 없는 영상은 틀 수 없다.
//   언제 넘기나: 영상이 끝났을 때(djui 가 알린다), 재생이 막힌 영상일 때, 아무것도 안 나오는데 예약이 있을 때(첫 예약·옛 화면이 끈 뒤).
// - 규칙이 못 지키는 것 (화면을 믿는다): 영상 길이를 모르므로 남의 곡도 10초가 지나면 넘길 수 있고, 예약의 순서(맨 앞인가)도 보지 않는다. 코인이 걸린 것이 아니라 감수했다.
// - 취소: 예약은 건 사람만(관리자는 아무거나), 지금 곡 넘기기도 선곡한 사람만(관리자는 아무거나). 3시간 넘은 예약은 누구든 지운다 (다음 날 클럽에 들어온 사람에게 어제 예약이 나오지 않게).
// - 제목: 예약할 때 유튜브 oEmbed(공개 주소, 열쇠 없음)에서 읽어 예약에 적는다. 재생이 막혔거나 없는 영상은 여기서 걸러진다. 못 읽으면 제목 없이 예약한다.
import { ref, onValue, update, remove, push, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import { CLUB_DJ_SPOTS } from './map';
import { youtubeId, sameSong, djOrder, djSlotKey, djCleanTitle, DJ_Q_TTL_MS, DJ_SKIP_MIN_MS, DJ_Q_MAX, type DjEntry } from '../shared/youtube';
import type { WorldCtx } from './state';

export interface DjState { v: string; at: number; u: string; n: string; k?: string; t?: string }
export type DjResult = 'ok' | 'bad' | 'spot' | 'full' | 'qfull' | 'prio' | 'blocked' | 'missing' | 'fail';
type RawEntry = Omit<DjEntry, 'k'>;

// 영상 제목을 읽는다. 재생이 막힌 영상(401·403)과 없는 영상(400·404)은 그렇게 알려 준다. 못 읽으면 null (예약은 제목 없이 받는다)
async function lookup(id: string): Promise<{ title: string } | 'blocked' | 'missing' | null> {
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ac?.abort(), 5000);
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, { credentials: 'omit', signal: ac?.signal });
    if (r.status === 401 || r.status === 403) return 'blocked';
    if (r.status === 400 || r.status === 404) return 'missing';
    if (!r.ok) return null;
    const j = (await r.json()) as { title?: unknown };
    return { title: djCleanTitle(j?.title) };
  } catch { return null; } finally { clearTimeout(timer); }
}

export class DjMgr {
  state: DjState | null = null;
  queue: DjEntry[] = [];                 // 나올 순서대로 (낡은 예약은 빠져 있다)
  private raw: Record<string, RawEntry> = {};
  private unsub: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private kickTimer = 0;
  private cleanTimer = 0;
  private busy = false;                  // 넘기는 쓰기가 가는 중
  private tries = new Map<string, number>(); // 넘기려다 실패한 횟수 (같은 예약을 끝없이 다시 보내지 않게)
  constructor(private w: WorldCtx) {}

  // 클럽에 들어오면 구독하고 나가면 끊는다. 지금 곡과 예약을 한 노드(club)로 같이 받는다: 따로 받으면 예약만 먼저 와서 "아무것도 안 나온다"로 잘못 본다
  setActive(on: boolean): void {
    if (on === !!this.unsub) return;
    if (on) {
      this.unsub = onValue(ref(db, 'club'), (s) => {
        const c = (s.val() || {}) as { dj?: DjState | null; q?: Record<string, RawEntry> | null };
        this.state = c.dj && typeof c.dj.v === 'string' && typeof c.dj.at === 'number' ? c.dj : null;
        this.raw = c.q || {};
        this.changed();
      }, () => {});
    } else {
      this.unsub?.(); this.unsub = null; this.state = null; this.raw = {}; this.queue = [];
      clearTimeout(this.kickTimer); clearTimeout(this.cleanTimer); this.kickTimer = this.cleanTimer = 0; this.tries.clear();
      this.emit();
    }
  }
  stop(): void { this.setActive(false); this.listeners.clear(); }
  listen(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(): void { for (const fn of this.listeners) fn(); }
  private changed(): void {
    this.queue = djOrder(this.raw, serverNow());
    this.emit();
    this.kick();
    this.sweep();
  }

  // 내가 DJ 기계 옆에 서 있나 (걷는 중이 아닐 때)
  atBooth(): boolean { const me = this.w.me; return !me.moving && CLUB_DJ_SPOTS.some((p) => p.x === me.x && p.y === me.y); }
  // 내가 걸어 둔 예약
  mine(): DjEntry[] { return this.queue.filter((e) => e.u === this.w.uid); }
  // 이 곡을 내가 넘길 수 있나 (선곡한 사람·관리자)
  canSkip(): boolean { return !!this.state && (this.state.u === this.w.uid || this.w.isAdmin); }
  canCancel(e: DjEntry): boolean { return e.u === this.w.uid || this.w.isAdmin; }

  // 예약. text: 유튜브 링크 또는 영상 id. 관리자가 볼 수 있게 누가 무엇을 예약했는지 기록을 같은 쓰기에 싣는다 (요청이 늘지 않는다)
  async reserve(text: string, prio: boolean): Promise<DjResult> {
    const id = youtubeId(text);
    if (!id) return 'bad';
    if (!this.atBooth()) return 'spot';
    const w = this.w, now = serverNow();
    // 내 낡은 예약이 자리를 차지하고 있으면 먼저 지운다 (규칙이 있는 열쇠에 덮어쓰기를 받지 않는다)
    const old = Object.keys(this.raw).filter((k) => this.raw[k]?.u === w.uid && now - this.raw[k].at >= DJ_Q_TTL_MS);
    if (old.length) await update(ref(db), Object.fromEntries(old.map((k) => [`club/q/${k}`, null]))).catch(() => {});
    const key = djSlotKey(w.uid, Object.keys(this.raw).filter((k) => !old.includes(k)));
    if (!key) return 'full';
    if (this.queue.length >= DJ_Q_MAX) return 'qfull';
    if (prio && this.mine().some((e) => e.p)) return 'prio';
    const info = await lookup(id);
    if (info === 'blocked' || info === 'missing') return info;
    if (!this.atBooth()) return 'spot';
    const title = info ? info.title : '';
    const logKey = push(ref(db, 'logs/chat')).key!;
    try {
      await update(ref(db), {
        [`club/q/${key}`]: { v: id, u: w.uid, n: w.profile.nick, at: serverTimestamp(), ...(title ? { t: title } : {}), ...(prio ? { p: 1 } : {}) },
        [`logs/chat/${logKey}`]: { u: w.uid, n: w.profile.nick, c: 'dj', t: `🎧 ${prio ? '우선 예약' : '예약'} ${id}${title ? ` ${title}` : ''}`.slice(0, 120), ts: serverTimestamp() },
      });
      return 'ok';
    } catch (e) { console.warn('노래 예약 실패', e); return 'fail'; }
  }
  // 예약 취소 (내 것. 관리자는 아무거나)
  async cancel(k: string): Promise<boolean> {
    try { await remove(ref(db, `club/q/${k}`)); return true; } catch { return false; }
  }
  // 지금 곡 넘기기 (내가 선곡한 곡. 관리자는 아무 곡이나): 다음 예약으로 넘어가고, 예약이 없으면 꺼진다
  async skip(): Promise<boolean> { return this.canSkip() ? this.advance() : false; }

  // 영상이 끝났다 (djui 가 알린다. wait: 재생이 막힌 영상이면 안내를 읽을 시간). 누구 화면이든 넘길 수 있다:
  // 선곡한 사람의 화면이 먼저 나서고, 남들은 조금 기다렸다가 아직 그대로면 넘긴다 (규칙: 남의 곡은 튼 지 10초가 지나야 한다)
  ended(song: DjState, wait = 0): void {
    if (!this.unsub || !sameSong(this.state, song)) return;
    const mine = song.u === this.w.uid || this.w.isAdmin;
    const delay = Math.max(wait, mine ? 0 : 400 + Math.random() * 1600, mine ? 0 : song.at + DJ_SKIP_MIN_MS + 500 - serverNow());
    const go = async (again: boolean): Promise<void> => {
      if (!this.unsub || !sameSong(this.state, song)) return;
      if (!(await this.advance()) && again) window.setTimeout(() => void go(false), 3000);
    };
    window.setTimeout(() => void go(true), delay);
  }
  // 아무것도 안 나오는데 예약이 있다: 맨 앞을 올린다 (첫 예약, 옛 화면이 곡을 끈 뒤, 넘기는 쓰기가 실패한 뒤). 예약한 사람의 화면이 먼저 나선다
  private kick(): void {
    clearTimeout(this.kickTimer); this.kickTimer = 0;
    const head = this.queue[0];
    if (!this.unsub || this.state || !head || (this.tries.get(head.k) || 0) >= 3) return;
    this.kickTimer = window.setTimeout(async () => {
      this.kickTimer = 0;
      if (!this.unsub || this.state || this.queue[0]?.k !== head.k) return;
      if (!(await this.advance())) { this.tries.set(head.k, (this.tries.get(head.k) || 0) + 1); this.kickTimer = window.setTimeout(() => this.kick(), 3000); }
    }, head.u === this.w.uid ? 0 : 400 + Math.random() * 1600);
  }
  // 다음 곡으로: 예약 맨 앞을 올리거나, 예약이 없으면 끈다
  private async advance(): Promise<boolean> {
    if (this.busy) return false;
    const head = this.queue[0], cur = this.state;
    if (!head && !cur) return true;
    this.busy = true;
    try {
      if (head) await update(ref(db), { 'club/dj': { v: head.v, at: serverTimestamp(), u: head.u, n: head.n, k: head.k, ...(head.t ? { t: head.t } : {}) }, [`club/q/${head.k}`]: null });
      else await remove(ref(db, 'club/dj'));
      return true;
    } catch { return false; } finally { this.busy = false; }
  }
  // 낡은 예약(3시간 넘음)은 누구든 지운다. 여럿이 한꺼번에 보내지 않게 저마다 조금 기다린다
  private sweep(): void {
    if (this.cleanTimer || !this.unsub) return;
    const stale = (): string[] => { const now = serverNow(); return Object.keys(this.raw).filter((k) => now - (this.raw[k]?.at || 0) >= DJ_Q_TTL_MS); };
    if (!stale().length) return;
    this.cleanTimer = window.setTimeout(() => {
      this.cleanTimer = 0;
      const ks = stale();
      if (this.unsub && ks.length) void update(ref(db), Object.fromEntries(ks.map((k) => [`club/q/${k}`, null]))).catch(() => {});
    }, 1000 + Math.random() * 4000);
  }
}
