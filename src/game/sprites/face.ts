import { PixelBuf, shade } from '../pixel';
import type { Pose } from './types';

// 2x2 눈 그리기 (감은 눈/눈물/화남 변형 포함). rx < 0 이면 한쪽 눈만.
export function drawEyes(b: PixelBuf, lx: number, y: number, rx: number, eye: string, pose: Pose, female = false, white = '#ffffff'): void {
  const closed = pose === 'sleep' || pose === 'yawn' || pose === 'laugh';
  const xs = rx < 0 ? [lx] : [lx, rx];
  const dark = shade(eye, -0.4);
  for (const x of xs) {
    const isLeft = x === lx;
    if (closed) {
      if (pose === 'laugh') { b.px(x, y + 1, dark); b.px(x + 1, y, dark); }
      else b.hline(x, y + 1, 2, dark);
    } else {
      b.rect(x, y, 2, 2, eye);
      b.px(x, y, white);
    }
    if (female && !closed) b.px(isLeft ? x - 1 : x + 2, y - 1, dark);
    if (pose === 'angry') { b.px(isLeft ? x + 1 : x, y - 1, dark); b.px(isLeft ? x : x + 1, y - 2, dark); }
    if (pose === 'cry') { b.px(x, y + 2, '#7cc4f0'); b.px(isLeft ? x : x + 1, y + 3, '#7cc4f0'); }
  }
}
