// 겨울 눈싸움 (스키 장갑, shared/shop.ts SKI_GLOVES). 순수 로직이라 실제 게임(world.ts·toss.ts)과 미리보기(dev/main.ts)가 같이 쓴다.
// 장갑을 가지고 끼고 있으면(users/{uid}/eq/sg) 겨울 맵의 눈 바닥에서 F 로 눈을 뭉치고(보관 상태는 이 브라우저에만), 다음 F 로 던진다. 눈 뭉치기는 DB·지갑을 건드리지 않는다.
// 던지기는 TossMgr.throwSnow 가 말랑이 경로(TossMsg, s=1)로 보내고, 맞으면 말랑이와 같은 스턴이지만 갑옷·펫 방어·되받아치기를 무시한다.
import { WINTER_MAP_ID } from '../shared/maps';
import type { Dir } from '../shared/types';
import { dirVec, frontTiles, FRONT_DEPTH } from './area';
import { G_SNOW, groundAt, type MapData } from './map';

export const SNOW_PACK_HINT = 'F · 눈뭉치기';
export const SNOW_THROW_HINT = 'F · 눈덩이 던지기';
export const SNOW_RANGE = FRONT_DEPTH; // 앞으로 몇 칸까지 겨냥하나 (frontTiles 의 깊이와 같다. 규칙의 범위 검사도 같은 값)

export type SnowAction = 'pack' | 'throw';
// winter: 겨울 맵에 있다 · gloves: 장갑을 가지고 있고 끼고 있다 · onSnow: 서 있는 칸이 눈 바닥 · busy: 이동 중·잠금·스턴·입력 막힘(모달)·맵 이동 중
export interface SnowGate { winter: boolean; gloves: boolean; onSnow: boolean; busy: boolean }

export function snowGateAt(map: MapData, mapId: string, x: number, y: number, gloves: boolean, busy: boolean): SnowGate {
  return { winter: mapId === WINTER_MAP_ID, gloves, onSnow: groundAt(map, x, y) === G_SNOW, busy };
}
// 지금 F 가 하게 될 일: 뭉친 눈이 있으면 던지기(눈 바닥이 아니어도 된다, 예: 얼음 위), 없으면 눈 바닥에서만 뭉치기. 겨울 맵이 아니거나 장갑이 없거나 바쁘면 아무것도 아니다
export function snowfightAction(held: boolean, g: SnowGate): SnowAction | null {
  if (!g.winter || !g.gloves || g.busy) return null;
  return held ? 'throw' : g.onSnow ? 'pack' : null;
}

export class SnowfightState {
  private held = false;
  get packed(): boolean { return this.held; }
  reset(): void { this.held = false; }
  // 장갑을 벗었거나 겨울 맵이 아니면 뭉친 눈을 버린다 (바쁜 것만으로는 버리지 않는다)
  sync(g: Pick<SnowGate, 'winter' | 'gloves'>): void { if (!g.winter || !g.gloves) this.held = false; }
  // F 한 번. repeat(키를 누르고 있어 반복된 F)는 무시한다: 한 번 누르면 뭉치기 또는 던지기 중 하나뿐이다.
  // 'pack' 은 바로 뭉친 상태가 되고, 'throw' 는 호출한 쪽이 실제로 던졌을 때(쿨타임이 아닐 때) consume() 을 불러야 비워진다
  press(g: SnowGate, repeat: boolean): SnowAction | null {
    if (repeat) return null;
    const a = snowfightAction(this.held, g);
    if (a === 'pack') this.held = true;
    return a;
  }
  consume(): void { this.held = false; }
}

interface Pos { x: number; y: number }
// 바라보는 방향 앞 SNOW_RANGE 칸(frontTiles) 안에서 가장 가까운 사람. 카지노 안에 앉은 사람(st.r)은 건드릴 수 없다. 나는 playerAt 에 들어 있지 않다(남의 접속자만)
export function pickSnowTarget<T extends { st: { r?: string | null } }>(x: number, y: number, dir: Dir, playerAt: (x: number, y: number) => T | null): T | null {
  const [dx, dy] = dirVec(dir);
  for (const [tx, ty] of frontTiles(x, y, dx, dy)) { const rp = playerAt(tx, ty); if (rp && !rp.st.r) return rp; }
  return null;
}
// 던지기 계획: 대상이 있으면 그 사람의 (반올림한) 칸, 없으면 바라보는 방향 SNOW_RANGE 칸 앞 (눈덩이만 날아간다)
export function planSnowThrow<T extends { st: { r?: string | null } } & Pos>(me: Pos & { dir: Dir }, playerAt: (x: number, y: number) => T | null): { target: T | null; tx: number; ty: number } {
  const target = pickSnowTarget(me.x, me.y, me.dir, playerAt);
  if (target) return { target, tx: Math.round(target.x), ty: Math.round(target.y) };
  const [dx, dy] = dirVec(me.dir);
  return { target: null, tx: me.x + dx * SNOW_RANGE, ty: me.y + dy * SNOW_RANGE };
}
// 날아간 뒤 그 자리에 아직 있나 (추적 없음: 옆으로 피하면 빗나간다)
export function snowStillThere(pos: Pos | null | undefined, tx: number, ty: number): boolean { return !!pos && Math.round(pos.x) === tx && Math.round(pos.y) === ty; }
// 받는 쪽 검사: 내가 겨울 맵에 있고, 던진 사람도 같은 겨울 맵에 있고, 좌표가 범위 안. (장갑 보유·착용은 받는 쪽이 못 보므로 규칙이 보낸 쓰기에서 막는다)
export function snowMsgValid(myMapId: string, throwerMapId: string | undefined, m: { fx: number; fy: number; tx: number; ty: number }): boolean {
  return myMapId === WINTER_MAP_ID && throwerMapId === WINTER_MAP_ID && Math.abs(m.tx - m.fx) <= SNOW_RANGE && Math.abs(m.ty - m.fy) <= SNOW_RANGE;
}
