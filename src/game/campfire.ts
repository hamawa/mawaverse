// 모닥불 (2026-11-20). 설계는 shared/campfire.ts 머리말.
import { ref, onValue, update, remove, increment, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import { isHomeMapId } from '../shared/maps';
import { CAMPFIRE_ID, CAMPFIRE_MS, CAMPFIRE_WOOD, fireBurning, fireKey, fireXY, type FireRec } from '../shared/campfire';
import { isWalkable, isWater, type MapData } from './map';
import type { Dir } from '../shared/types';

export type LightResult = 'ok' | 'noitem' | 'nowood' | 'indoor' | 'blocked' | 'have' | 'fail';
export interface FireHost {
  uid: string; mapId: string; map: MapData;
  me: { x: number; y: number; dir: Dir; moving: boolean };
  profile: { own?: Record<string, boolean> | null };
  occupied(x: number, y: number): boolean;
}
const AHEAD: Record<number, [number, number]> = { 0: [0, 1], 1: [-1, 0], 2: [1, 0], 3: [0, -1] };

export class CampfireMgr {
  private fires = new Map<string, FireRec>();
  private unsub: (() => void) | null = null;
  private mapId = '';
  private busy = false;
  constructor(private h: FireHost) {}

  // 맵을 옮겼다: 그 맵의 모닥불을 본다 (집 안에는 피울 수 없다)
  watch(mapId: string): void {
    this.unsub?.(); this.unsub = null;
    this.fires.clear();
    this.mapId = mapId;
    if (isHomeMapId(mapId)) return;
    this.unsub = onValue(ref(db, `fires/${mapId}`), (s) => {
      this.fires.clear();
      s.forEach((c) => { const v = c.val() as FireRec | null; if (v && typeof v.at === 'number' && c.key) this.fires.set(c.key, v); });
    }, () => {});
  }
  stop(): void { this.unsub?.(); this.unsub = null; this.fires.clear(); }

  // 지금 타고 있는 불 (그리기용)
  views(): { x: number; y: number }[] {
    const now = serverNow(), out: { x: number; y: number }[] = [];
    for (const [k, f] of this.fires) { if (!fireBurning(f, now)) continue; const p = fireXY(k); if (p) out.push(p); }
    return out;
  }
  // 그 칸에 불이 타고 있나 (걸음을 막는다)
  burningAt(x: number, y: number): boolean { return fireBurning(this.fires.get(fireKey(x, y)), serverNow()); }
  owns(): boolean { return !!this.h.profile.own?.[CAMPFIRE_ID]; }
  private mine(now: number): boolean { return !!this.mineKey(now); }
  private mineKey(now: number): string | null { for (const [k, f] of this.fires) if (f.u === this.h.uid && fireBurning(f, now)) return k; return null; }
  // 이 맵에 내 모닥불이 타고 있나 (내 메뉴의 "끄기")
  burningMine(): boolean { return this.mine(serverNow()); }
  // 내 모닥불 끄기 (2026-11-20 사용자 요청: 불이 길을 막게 되면서 잘못 놓은 불을 치울 수 있어야 했다). 나무는 돌려주지 않는다. 규칙: 피운 사람은 언제든 지울 수 있다
  async putOut(): Promise<boolean> {
    const k = this.mineKey(serverNow());
    if (!k || this.busy) return false;
    this.busy = true;
    try { await remove(ref(db, `fires/${this.mapId}/${k}`)); return true; } catch (e) { console.warn('campfire off failed', e); return false; } finally { this.busy = false; }
  }

  // 내 앞 칸에 피운다. wood: 지금 가진 나무, outdoors: 바깥 맵인가
  async light(wood: number, outdoors: boolean): Promise<LightResult> {
    const h = this.h, now = serverNow();
    if (this.busy) return 'fail';
    if (!this.owns()) return 'noitem';
    if (!outdoors || isHomeMapId(h.mapId) || h.mapId !== this.mapId) return 'indoor';
    if (this.mine(now)) return 'have';
    if (wood < CAMPFIRE_WOOD) return 'nowood';
    const d = AHEAD[h.me.dir] || AHEAD[0], x = h.me.x + d[0], y = h.me.y + d[1], key = fireKey(x, y);
    if (h.me.moving || !isWalkable(h.map, x, y) || isWater(h.map, x, y) || h.occupied(x, y) || fireBurning(this.fires.get(key), now)) return 'blocked';
    // 불은 길을 막는다: 시작 자리와 방의 문·나오는 칸에는 못 피운다 (사람이 갇히거나 들어오자마자 막힌다)
    const at = (p?: { x: number; y: number } | null) => !!p && p.x === x && p.y === y;
    if (at(h.map.spawn) || h.map.zones.some((z) => at(z.door) || at(z.exit))) return 'blocked';
    const upd: Record<string, unknown> = { [`fires/${this.mapId}/${key}`]: { u: h.uid, at: serverTimestamp() }, [`homes/${h.uid}/w`]: increment(-CAMPFIRE_WOOD) };
    // 다 탄 기록도 몇 개 같이 치운다 (맵에 들어올 때 받는 양이 늘지 않게)
    let n = 0;
    for (const [k, f] of this.fires) { if (n >= 5) break; if (k !== key && now - f.at > CAMPFIRE_MS + 60000) { upd[`fires/${this.mapId}/${k}`] = null; n++; } }
    this.busy = true;
    try { await update(ref(db), upd); return 'ok'; } catch (e) { console.warn('campfire failed', e); return 'fail'; } finally { this.busy = false; }
  }
}
