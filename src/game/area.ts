// 앞쪽 범위 (장풍·말랑이 보따리 공용): 바라보는 방향으로 1~FRONT_DEPTH 칸, 옆으로는 바라보는 축에 수직으로 FRONT_SIDE_MIN~FRONT_SIDE_MAX 칸 (내 줄 포함 4칸 너비)
// 4×4 는 사용자 결정(2026-11-03). 너비가 짝수라 한쪽(-)으로 한 칸 더 넓다
import type { Dir } from '../shared/types';

export const FRONT_DEPTH = 4;
export const FRONT_SIDE_MIN = -2;
export const FRONT_SIDE_MAX = 1;

// 바라보는 방향의 단위 벡터
export function dirVec(dir: Dir): [number, number] { return [dir === 2 ? 1 : dir === 1 ? -1 : 0, dir === 0 ? 1 : dir === 3 ? -1 : 0]; }

// (rx, ry) = 상대 위치 - 내 위치, (dx, dy) = 내가 보는 방향. 상대가 내 앞 범위 안에 있나
export function inFront(rx: number, ry: number, dx: number, dy: number): boolean {
  const depth = dx !== 0 ? rx * dx : ry * dy, side = dx !== 0 ? ry : rx;
  return depth >= 1 && depth <= FRONT_DEPTH && side >= FRONT_SIDE_MIN && side <= FRONT_SIDE_MAX;
}

// 범위 안의 칸들. 가까운 줄부터, 각 줄은 옆 좌표가 작은 쪽부터
export function frontTiles(x: number, y: number, dx: number, dy: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i <= FRONT_DEPTH; i++) for (let l = FRONT_SIDE_MIN; l <= FRONT_SIDE_MAX; l++) out.push([x + dx * i + (dx === 0 ? l : 0), y + dy * i + (dy === 0 ? l : 0)]);
  return out;
}
