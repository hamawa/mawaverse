// 겨울 맵(winter)의 놀이: 빙판 미끄러짐(관성)과 눈덩이 굴리기. 순수 로직이라 실제 게임(world.ts)과 미리보기(dev/main.ts)가 같이 쓴다.
// 눈덩이·눈사람은 이 브라우저에만 있는 장난감이다 (DB·코인·다른 사람 화면과 무관, 서버 점유도 건드리지 않는다). 그래서 다른 사람은 그 칸을 지나다닐 수 있다.
// 상태는 WinterPlay 인스턴스에만 있고, 맵을 나가거나 다시 들어오면 새로 만든다 (world.enterMap).
//
// 눈덩이 규칙: 눈덩이 쪽으로 걸어 들어가면(F 가 아니다) 한 칸 밀려가고, 눈 위를 굴러갈 때마다 커진다. LARGE_ROLLS 번 굴리면 '큰' 눈덩이다.
// 눈사람은 큰 눈덩이를 다른 큰 눈덩이에 밀어 붙일 때만 생긴다. 작은 눈덩이가 낀 합치기는 막는다 (밀리지 않고 길만 막는다):
// 작은 것끼리, 작은 것과 큰 것이 우연히 눈사람이 되거나 합쳐져 크기가 뛰는 일이 없도록, 눈사람은 "둘 다 충분히 굴려 키웠다"는 뜻일 때만 만들어진다.
import { WINTER_MAP_ID } from '../shared/maps';
import { STEP_MS } from '../shared/config';
import type { Dir } from '../shared/types';
import { G_SNOW, G_ICE, groundAt, isWalkable, portalNear, type MapData } from './map';

export const SLIDE_EXTRA = 3;       // 방향키를 뗀 뒤 빙판에서 더 미끄러지는 칸 수 (최대)
export const LARGE_ROLLS = 5;       // 눈 위에서 이만큼 굴러간 눈덩이는 '큰' 눈덩이
export const MAX_SNOWMEN = 6;       // 한 번 들어와 있는 동안 만들 수 있는 눈사람 수. 넘으면 눈덩이를 다시 채우지 않는다
export const MIN_BALLS = 2;         // 눈덩이가 이보다 적으면(합칠 수 없으면) 시작 눈덩이를 다시 놓는다
// 시작 눈덩이 자리: 눈 광장의 (12,5) 둘레. 서로 한 칸 이상 떨어져 있고 나무·포탈·빙판·구멍과 겹치지 않는다
export const SNOW_SEEDS: ReadonlyArray<readonly [number, number]> = [[12, 5], [15, 6], [10, 7], [13, 8], [16, 4]];

const DX = [0, -1, 1, 0], DY = [1, 0, 0, -1]; // Dir: 0 아래 1 왼쪽 2 오른쪽 3 위

// rolls: 굴러간 횟수 (눈덩이 크기), large: 큰 눈덩이. x,y 는 밀리는 동안 보간된 타일 좌표
export interface SnowView { kind: 'ball' | 'man'; x: number; y: number; rolls: number; large: boolean }
interface Ball { x: number; y: number; rolls: number; fromX: number; fromY: number; at: number }
export type Blocked = (x: number, y: number) => boolean; // 사람이 서 있는 칸 (나·다른 접속자)
export interface PushPlan { ball: Ball; x: number; y: number; kind: 'roll' | 'snowman' } // x,y: 눈덩이가 가는 칸

export class WinterPlay {
  readonly active: boolean;
  private map: MapData;
  private balls: Ball[] = [];
  private men: { x: number; y: number }[] = [];
  private rev = 0; // 눈덩이·눈사람이 바뀔 때마다 +1 (밀기를 되돌릴 때, 그 사이 다른 변화가 없었는지 본다)
  private slideDir: Dir | null = null;
  private slideLeft = 0;

  constructor(map: MapData, blocked: Blocked = () => false) {
    this.map = map;
    this.active = map.id === WINTER_MAP_ID;
    if (this.active) this.refill(blocked);
  }

  // ---- 빙판 관성 ----
  // 방향키로 직접 한 걸음이 시작됐다: 떼면 이 방향으로 SLIDE_EXTRA 칸까지 더 간다
  armSlide(dir: Dir): void { if (this.active) { this.slideDir = dir; this.slideLeft = SLIDE_EXTRA; } }
  resetSlide(): void { this.slideDir = null; this.slideLeft = 0; }
  get sliding(): boolean { return this.slideDir !== null && this.slideLeft > 0; }
  // 키를 뗀 채 멈춰 선 (x,y)에서 이어 갈 다음 칸. 얼음에서 얼음으로만 이어지고, 눈·장애물·사람·구멍을 만나면 관성이 끝난다
  slideStep(x: number, y: number, canStep: (nx: number, ny: number) => boolean): { x: number; y: number; dir: Dir } | null {
    const dir = this.slideDir;
    if (!this.active || dir === null || this.slideLeft <= 0 || groundAt(this.map, x, y) !== G_ICE) { this.resetSlide(); return null; }
    const nx = x + DX[dir], ny = y + DY[dir];
    if (groundAt(this.map, nx, ny) !== G_ICE || !canStep(nx, ny)) { this.resetSlide(); return null; }
    this.slideLeft--;
    return { x: nx, y: ny, dir };
  }

  // ---- 눈덩이·눈사람 ----
  toyAt(x: number, y: number): boolean { return this.balls.some((b) => b.x === x && b.y === y) || this.men.some((m) => m.x === x && m.y === y); }
  views(now = Infinity): SnowView[] {
    const balls = this.balls.map((b): SnowView => {
      const k = Math.min(1, Math.max(0, (now - b.at) / STEP_MS));
      return { kind: 'ball', x: b.fromX + (b.x - b.fromX) * k, y: b.fromY + (b.y - b.fromY) * k, rolls: b.rolls, large: b.rolls >= LARGE_ROLLS };
    });
    return [...balls, ...this.men.map((m): SnowView => ({ kind: 'man', x: m.x, y: m.y, rolls: LARGE_ROLLS, large: true }))];
  }
  private canLand(x: number, y: number, blocked: Blocked): boolean {
    return groundAt(this.map, x, y) === G_SNOW && isWalkable(this.map, x, y) && !portalNear(this.map, x, y) && !this.men.some((m) => m.x === x && m.y === y) && !blocked(x, y);
  }
  // (x,y)에 선 사람이 dir 쪽으로 걸어 들어갈 때 바로 앞 눈덩이가 밀려갈 계획. 밀 수 없으면 null (그 칸은 막힌 길이다).
  // 도착 칸이 눈이 아니거나(빙판·구멍) 나무·포탈 옆·사람·눈사람이면 못 민다. 도착 칸에 다른 눈덩이가 있으면 둘 다 큰 것일 때만 눈사람이 된다
  pushPlan(x: number, y: number, dir: Dir, blocked: Blocked): PushPlan | null {
    if (!this.active) return null;
    const bx = x + DX[dir], by = y + DY[dir];
    const ball = this.balls.find((b) => b.x === bx && b.y === by);
    if (!ball) return null;
    const tx = bx + DX[dir], ty = by + DY[dir];
    if (!this.canLand(tx, ty, blocked)) return null;
    const other = this.balls.find((b) => b.x === tx && b.y === ty);
    if (!other) return { ball, x: tx, y: ty, kind: 'roll' };
    return ball.rolls >= LARGE_ROLLS && other.rolls >= LARGE_ROLLS ? { ball, x: tx, y: ty, kind: 'snowman' } : null;
  }
  // 걸음 (x,y)→(nx,ny)가 눈덩이·눈사람에 막히나. 밀 수 있는 눈덩이는 막지 않는다 (걸음이 나가면 applyPush)
  stepBlocked(x: number, y: number, nx: number, ny: number, blocked: Blocked): boolean {
    if (!this.toyAt(nx, ny)) return false;
    const dir = DX.findIndex((dx, i) => dx === nx - x && DY[i] === ny - y);
    return dir < 0 || !this.pushPlan(x, y, dir as Dir, blocked);
  }
  // 걸음이 시작됐다: 눈덩이를 한 칸 보낸다 (눈 위를 굴렀으니 커진다). 큰 눈덩이 둘이면 눈사람. 서버가 그 걸음을 거부하면 돌려 쓸 되돌리기 함수를 준다.
  // 끝나고 합칠 눈덩이가 모자라면 시작 눈덩이를 다시 채운다 (밀기 뒤에만: 타이머로 채우지 않는다)
  applyPush(plan: PushPlan, now: number, blocked: Blocked): () => void {
    const snap = { balls: this.balls.map((b) => ({ ...b })), men: this.men.map((m) => ({ ...m })) };
    const { ball } = plan;
    if (plan.kind === 'roll') { ball.fromX = ball.x; ball.fromY = ball.y; ball.x = plan.x; ball.y = plan.y; ball.rolls++; ball.at = now; }
    else {
      this.balls = this.balls.filter((b) => b !== ball && !(b.x === plan.x && b.y === plan.y));
      this.men.push({ x: plan.x, y: plan.y });
    }
    this.refill(blocked);
    const mine = ++this.rev;
    return () => { if (this.rev === mine) { this.balls = snap.balls; this.men = snap.men; this.rev++; } };
  }
  // dir 쪽 바로 옆 눈사람 (없으면 null)
  manAhead(x: number, y: number, dir: Dir): { x: number; y: number } | null {
    if (!this.active) return null;
    const mx = x + DX[dir], my = y + DY[dir];
    return this.men.some((m) => m.x === mx && m.y === my) ? { x: mx, y: my } : null;
  }
  removeMan(x: number, y: number): boolean {
    const n = this.men.length;
    this.men = this.men.filter((m) => !(m.x === x && m.y === y));
    if (this.men.length === n) return false;
    this.rev++;
    return true;
  }
  private refill(blocked: Blocked): void {
    if (this.men.length >= MAX_SNOWMEN || this.balls.length >= MIN_BALLS) return;
    for (const [x, y] of SNOW_SEEDS) {
      if (this.balls.length >= SNOW_SEEDS.length) break;
      if (this.balls.some((b) => b.x === x && b.y === y) || !this.canLand(x, y, blocked)) continue;
      this.balls.push({ x, y, rolls: 0, fromX: x, fromY: y, at: -Infinity });
    }
  }
}
