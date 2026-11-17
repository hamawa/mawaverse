import { PixelBuf, shade } from '../pixel';
import { drawEyes } from './face';
import { FRAME_W, FRAME_H, type CreatureParams, type Pose } from './types';
import type { Dir } from '../../shared/types';

// 비인간 캐릭터 (동물/외계인/로봇/슬라임 등). 2등신 치비 스타일.
export function drawCreature(p: CreatureParams, dir: Dir, frame: number, pose: Pose): PixelBuf {
  const b = new PixelBuf(FRAME_W, FRAME_H);
  const d: Dir = dir === 2 ? 1 : dir;
  const side = d === 1, back = d === 3, front = d === 0;
  frame = frame & 3;
  const step = frame === 1 ? 1 : frame === 3 ? -1 : 0;
  const bob = step !== 0 ? -1 : 0;
  const jump = pose === 'jump';
  const { c1, c2, c3 } = p;
  const c1d = shade(c1, -0.25);
  const c1l = shade(c1, 0.25);
  const sp = p.species;
  const hy = 3 + bob;          // 머리 윗부분
  const by = 19 + bob;         // 몸통 윗부분
  const noFeet = sp === 'slime' || sp === 'ghost' || sp === 'octopus';

  const feet = (color: string, w = 3) => {
    if (noFeet) return;
    const lift = (s: number) => (jump ? 3 : s ? 2 : 0);
    const ly = 31 + bob;
    if (!side) { b.rect(8, ly - lift(step === 1 ? 1 : 0), w, 3, color); b.rect(13, ly - lift(step === -1 ? 1 : 0), w, 3, color); }
    else { b.rect(step === 1 ? 7 : 9, ly - (jump ? 3 : 0), w, 3, color); b.rect(step === -1 ? 14 : 12, ly - (jump ? 3 : 0), w, 3, color); }
  };
  const eyes = (lx: number, y: number, rx: number, eye = p.eye, white = '#ffffff') => {
    if (back) return;
    if (side) drawEyes(b, lx - 1, y, -1, eye, pose, false, white);
    else drawEyes(b, lx, y, rx, eye, pose, false, white);
  };
  const mouth = (x: number, y: number, color: string) => {
    if (back) return;
    if (pose === 'laugh') { b.rect(x - 1, y, 4, 2, color); b.px(x, y + 1, '#e86a6a'); }
    else if (pose === 'yawn') b.rect(x, y, 2, 3, color);
    else if (pose === 'angry' || pose === 'cry') { b.px(x - 1, y + 1, color); b.px(x, y, color); b.px(x + 1, y, color); b.px(x + 2, y + 1, color); }
    else b.hline(side ? x - 2 : x, y, 2, color);
  };
  const blush = (y: number) => { if (front) { b.px(7, y, '#f7a1a1'); b.px(16, y, '#f7a1a1'); } else if (side) b.px(6, y, '#f7a1a1'); };
  const earTri = (cx: number, top: number, h: number, color: string, inner?: string) => {
    for (let j = 0; j < h; j++) b.hline(cx - j, top + j, 2 * j + 1, color);
    if (inner) for (let j = 1; j < h - 1; j++) b.hline(cx - j + 1, top + j + 1, 2 * j - 1, inner);
  };
  const tail = (color: string, tip?: string) => {
    if (side) { b.rect(19, 24 + bob, 3, 2, color); b.rect(21, 20 + bob, 2, 5, color); if (tip) b.rect(21, 20 + bob, 2, 2, tip); }
    if (back) { b.rect(11, 28 + bob, 2, 5, color); b.rect(12, 26 + bob, 2, 3, color); if (tip) b.rect(12, 26 + bob, 2, 2, tip); }
  };
  const headBody = (headColor = c1, bodyColor = c1) => {
    b.ellipse(12, by + 6, 7, 6, bodyColor);
    b.circle(12, hy + 8, 8, headColor);
  };

  switch (sp) {
    case 'cat': {
      headBody(); feet(c1);
      earTri(6, hy - 1, 4, c1, c2); earTri(18, hy - 1, 4, c1, c2);
      if (!back) { b.hline(10, hy + 2, 4, c3); b.hline(9, hy + 4, 2, c3); b.hline(13, hy + 4, 2, c3); }
      eyes(9, hy + 7, 14);
      if (!back) { b.px(12, hy + 10, '#f29a9a'); mouth(11, hy + 11, c1d); if (front) { b.hline(2, hy + 10, 3, c3); b.hline(19, hy + 10, 3, c3); } }
      if (front) b.ellipse(12, by + 8, 4, 3, c2);
      tail(c1, c2);
      break;
    }
    case 'dog': {
      headBody(); feet(c1);
      b.rrect(2, hy + 4, 3, 8, 1, c2); b.rrect(19, hy + 4, 3, 8, 1, c2);
      if (!back) { b.ellipse(12, hy + 11, 4, 2.5, c2); b.rect(11, hy + 10, 2, 1, '#222'); b.px(12, hy + 13, '#f66'); }
      eyes(9, hy + 7, 14);
      if (front) b.ellipse(12, by + 8, 4, 3, c2);
      tail(c1);
      break;
    }
    case 'rabbit': {
      headBody(); feet(c1);
      b.rrect(7, hy - 3, 3, 7, 1, c1); b.rect(8, hy - 2, 1, 5, c2);
      b.rrect(14, hy - 3, 3, 7, 1, c1); b.rect(15, hy - 2, 1, 5, c2);
      eyes(9, hy + 7, 14);
      if (!back) { b.px(12, hy + 10, '#f29a9a'); b.rect(11, hy + 12, 2, 1, '#fff'); }
      blush(hy + 9);
      if (front) b.ellipse(12, by + 8, 4, 3, c2);
      if (back) b.circle(12, by + 9, 2, '#fff');
      break;
    }
    case 'bear': {
      headBody(); feet(c1);
      b.circle(6, hy + 1, 2.5, c1); b.circle(18, hy + 1, 2.5, c1); b.px(6, hy + 1, c2); b.px(18, hy + 1, c2);
      if (!back) { b.ellipse(12, hy + 11, 3.5, 2.5, c2); b.rect(11, hy + 10, 2, 1, '#222'); }
      eyes(9, hy + 7, 14);
      if (front) b.ellipse(12, by + 8, 4, 3, c2);
      break;
    }
    case 'panda': {
      headBody(); feet(c2);
      b.circle(6, hy + 1, 2.5, c2); b.circle(18, hy + 1, 2.5, c2);
      if (!back) { b.ellipse(9, hy + 8, 2.5, 2.5, c2); b.ellipse(15, hy + 8, 2.5, 2.5, c2); }
      eyes(9, hy + 7, 14, '#111', '#fff');
      if (!back) { b.rect(11, hy + 11, 2, 1, '#222'); }
      b.rect(5, by + 3, 3, 6, c2); b.rect(16, by + 3, 3, 6, c2);
      break;
    }
    case 'fox': {
      headBody(); feet(c3);
      earTri(6, hy - 2, 5, c1, c3); earTri(18, hy - 2, 5, c1, c3);
      if (!back) { b.ellipse(12, hy + 11, 4, 3, c2); b.rect(11, hy + 10, 2, 1, '#222'); b.px(6, hy + 9, c2); b.px(18, hy + 9, c2); }
      eyes(9, hy + 7, 14);
      if (front) b.ellipse(12, by + 8, 4, 3, c2);
      if (side) { b.ellipse(20, by + 7, 3, 3, c1); b.rect(21, by + 4, 3, 3, c2); }
      if (back) { b.ellipse(12, by + 9, 3, 4, c1); b.rect(11, by + 10, 3, 2, c2); }
      break;
    }
    case 'pig': {
      headBody(); feet(c1d);
      earTri(6, hy, 3, c1); earTri(18, hy, 3, c1);
      if (!back) { b.rect(10, hy + 9, 5, 3, c2); b.px(11, hy + 10, c3); b.px(13, hy + 10, c3); }
      eyes(9, hy + 6, 14);
      blush(hy + 8);
      if (back) { b.px(13, by + 8, c1d); b.px(14, by + 7, c1d); b.px(14, by + 9, c1d); }
      break;
    }
    case 'frog': {
      headBody(); feet(c1);
      b.circle(8, hy + 1, 2.5, c1); b.circle(16, hy + 1, 2.5, c1);
      if (!back) { b.rect(7, hy, 3, 2, '#fff'); b.rect(15, hy, 3, 2, '#fff'); b.px(8, hy, '#111'); b.px(16, hy, '#111'); }
      if (!back) { b.hline(8, hy + 11, 8, c1d); b.px(7, hy + 10, c1d); b.px(16, hy + 10, c1d); }
      if (front) b.ellipse(12, by + 8, 5, 4, c2);
      blush(hy + 9);
      break;
    }
    case 'duck': {
      headBody(); feet(c2);
      if (!back) { b.rect(9, hy + 9, 6, 3, c2); b.hline(9, hy + 10, 6, shade(c2, -0.3)); }
      eyes(9, hy + 6, 14);
      b.ellipse(5, by + 6, 2, 4, c1d); b.ellipse(19, by + 6, 2, 4, c1d);
      if (!back) b.px(12, hy + 1, c1d);
      break;
    }
    case 'penguin': {
      headBody(); feet(c3);
      if (!back) { b.ellipse(12, hy + 9, 5, 4.5, c2); b.rect(11, hy + 10, 2, 2, c3); }
      eyes(9, hy + 7, 14, '#111');
      if (front) b.ellipse(12, by + 6, 5, 5, c2);
      b.rect(4, by + 2, 2, 8, c1); b.rect(18, by + 2, 2, 8, c1);
      break;
    }
    case 'owl': {
      headBody(); feet(c3);
      earTri(6, hy - 1, 3, c1); earTri(18, hy - 1, 3, c1);
      if (!back) { b.circle(9, hy + 8, 3, c2); b.circle(15, hy + 8, 3, c2); }
      eyes(8, hy + 7, 14, '#222');
      if (!back) { b.px(12, hy + 10, c3); b.px(12, hy + 11, c3); }
      if (front) { b.ellipse(12, by + 7, 4, 4, c2); b.px(11, by + 6, c1d); b.px(13, by + 6, c1d); b.px(12, by + 9, c1d); }
      b.ellipse(5, by + 6, 2, 4, c1d); b.ellipse(19, by + 6, 2, 4, c1d);
      break;
    }
    case 'slime': {
      const squash = step !== 0 ? 1 : 0;
      b.ellipse(12, 23, 10 + squash, 9 - squash, c1);
      b.ellipse(12, 18 + squash, 7, 5, c1);
      b.px(7, 16, c1l); b.px(8, 15, c1l); b.px(7, 17, c1l);
      eyes(9, 20, 14, '#222');
      mouth(11, 24, c1d);
      blush(23);
      break;
    }
    case 'ghost': {
      const fy = 6 + (frame === 1 || frame === 2 ? -1 : 0);
      b.rrect(4, fy, 16, 22, 6, c1);
      for (let x = 4; x < 20; x += 4) { b.rect(x, fy + 21, 2, 2, c1); b.rect(x + 2, fy + 20, 2, 1, c1); }
      b.rect(4, fy + 22, 16, 1, null); for (let x = 4; x < 20; x += 4) b.rect(x, fy + 22, 2, 1, c1);
      if (!back) { b.ellipse(9, fy + 9, 1.5, 2, '#222'); b.ellipse(15, fy + 9, 1.5, 2, '#222'); if (pose !== 'sleep') { b.px(9, fy + 8, '#fff'); b.px(15, fy + 8, '#fff'); } b.rect(11, fy + 13, 2, 2, c2); }
      if (side) { b.rect(8, fy + 6, 4, 4, c1); b.ellipse(7, fy + 9, 1.5, 2, '#222'); }
      blush(fy + 12);
      break;
    }
    case 'robot': {
      b.rect(5, hy + 1, 14, 11, c1); b.rect(6, hy + 1, 12, 1, c1l);
      b.vline(12, hy - 2, 3, c3); b.px(12, hy - 3, '#f55');
      if (!back) { b.rect(7, hy + 5, 10, 3, c2); b.px(8, hy + 6, '#fff'); b.px(15, hy + 6, '#fff'); if (pose === 'sleep') { b.rect(7, hy + 5, 10, 3, shade(c2, -0.4)); } b.rect(10, hy + 9, 4, 1, c3); }
      else { b.rect(7, hy + 4, 10, 5, c1d); }
      b.rect(6, by - 1, 12, 12, c1); b.rect(7, by - 1, 10, 1, c1l);
      if (!back) { b.rect(8, by + 2, 8, 5, c2); b.px(9, by + 3, '#f55'); b.px(11, by + 3, '#5f5'); b.px(13, by + 3, '#55f'); b.rect(9, by + 5, 6, 1, c1d); }
      b.rect(3, by, 3, 7, c3); b.rect(18, by, 3, 7, c3);
      feet(c3, 4);
      break;
    }
    case 'alien': {
      b.ellipse(12, by + 6, 5, 6, c1);
      b.ellipse(12, hy + 7, 9, 8, c1);
      b.vline(12, hy - 3, 3, c1); b.circle(12, hy - 4, 1, c2);
      if (!back) {
        b.ellipse(9, hy + 8, 2.5, 3.5, '#111'); b.ellipse(15, hy + 8, 2.5, 3.5, '#111');
        if (pose !== 'sleep') { b.px(8, hy + 6, '#fff'); b.px(14, hy + 6, '#fff'); } else { b.ellipse(9, hy + 8, 2.5, 3.5, c1d); b.ellipse(15, hy + 8, 2.5, 3.5, c1d); b.hline(7, hy + 9, 5, '#111'); b.hline(13, hy + 9, 5, '#111'); }
        mouth(11, hy + 13, c1d);
      }
      feet(c1);
      break;
    }
    case 'mushroom': {
      b.rrect(7, hy + 8, 10, 18, 3, c3);
      b.ellipse(12, hy + 5, 11, 6, c1); b.ellipse(12, hy + 3, 9, 4, c1l);
      b.circle(7, hy + 4, 1.5, c2); b.circle(15, hy + 2, 1.5, c2); b.circle(12, hy + 8, 1.5, c2); b.circle(19, hy + 6, 1, c2);
      eyes(9, hy + 14, 14, '#222');
      mouth(11, hy + 18, shade(c3, -0.3));
      blush(hy + 16);
      feet(shade(c3, -0.2));
      break;
    }
    case 'octopus': {
      b.ellipse(12, 14, 9, 9, c1);
      for (const [x, y] of [[5, 27], [10, 29], [14, 29], [19, 27]]) { b.ellipse(x, y + (step && (x < 12) ? 1 : 0), 2.5, 4, c1); b.px(x, y + 2, c2); }
      b.rect(5, 20, 14, 6, c1);
      eyes(9, 12, 14, '#222');
      mouth(11, 17, c1d);
      blush(15);
      break;
    }
    case 'dragon': {
      headBody(); feet(c3);
      b.rect(6, hy - 2, 2, 4, c3); b.rect(16, hy - 2, 2, 4, c3); b.px(6, hy - 3, c3); b.px(17, hy - 3, c3);
      if (!back) { b.rect(9, hy + 9, 6, 3, c2); b.px(10, hy + 10, c1d); b.px(13, hy + 10, c1d); }
      eyes(9, hy + 6, 14);
      if (front) b.ellipse(12, by + 7, 4, 4, c2);
      if (side) { b.rect(16, by - 2, 6, 2, c1d); b.rect(18, by - 4, 4, 3, c1d); b.rect(20, by - 6, 2, 2, c1d); }
      if (back) { for (let y = hy + 4; y < by + 8; y += 3) b.rect(11, y, 2, 2, c3); b.rect(2, by - 2, 6, 3, c1d); b.rect(16, by - 2, 6, 3, c1d); b.rect(1, by - 5, 3, 4, c1d); b.rect(20, by - 5, 3, 4, c1d); }
      tail(c1, c3);
      break;
    }
    case 'bat': {
      headBody(); feet(c3);
      earTri(6, hy - 2, 5, c1, c2); earTri(18, hy - 2, 5, c1, c2);
      eyes(9, hy + 7, 14, c2, '#fff');
      if (!back) { b.px(10, hy + 11, '#fff'); b.px(14, hy + 11, '#fff'); mouth(11, hy + 11, c1d); }
      for (let j = 0; j < 6; j++) { b.hline(1 + (j % 2), by + 1 + j, 5 - Math.floor(j / 3), c1d); b.hline(18 + Math.floor(j / 3), by + 1 + j, 5 - Math.floor(j / 3), c1d); }
      break;
    }
    case 'cactus': {
      b.rrect(7, hy + 3, 10, 26, 4, c1);
      b.rect(3, hy + 9, 4, 3, c1); b.rrect(2, hy + 4, 3, 7, 1, c1);
      b.rect(17, hy + 13, 4, 3, c1); b.rrect(19, hy + 8, 3, 7, 1, c1);
      for (const [x, y] of [[8, hy + 6], [15, hy + 9], [9, hy + 15], [14, hy + 20], [10, hy + 24], [3, hy + 6], [20, hy + 10]]) b.px(x, y, c3);
      b.px(12, hy + 1, c2); b.px(11, hy + 2, c2); b.px(13, hy + 2, c2); b.px(12, hy + 3, c2); b.px(12, hy + 2, '#ffe9a8');
      eyes(9, hy + 11, 14, '#222');
      mouth(11, hy + 15, c1d);
      blush(hy + 13);
      feet(shade(c1, -0.3));
      break;
    }
    // ---- 음식 캐릭터 (2026-11-17 건의 반영). c1 몸 · c2 포인트 · c3 보조. 얼굴은 다른 캐릭터와 같은 높이에 둔다 ----
    case 'shrimpfry': {
      // 새우튀김: 바삭한 튀김옷 몸통 위로 빨간 꼬리가 부채처럼 펴진다
      b.rect(10, hy + 2, 4, 6, c2); b.rect(7, hy - 1, 4, 5, c2); b.rect(13, hy - 1, 4, 5, c2); b.px(8, hy - 2, c2); b.px(15, hy - 2, c2); b.rect(11, hy + 1, 2, 4, shade(c2, -0.25));
      b.rrect(6, hy + 6, 12, 23, 5, c1);
      for (const [x, y] of [[7, hy + 9], [16, hy + 11], [8, hy + 19], [15, hy + 22], [10, hy + 26], [13, hy + 8]]) b.px(x, y, c1l);
      for (const [x, y] of [[9, hy + 22], [15, hy + 17], [7, hy + 14], [14, hy + 26], [16, hy + 8]]) b.px(x, y, c1d);
      b.px(5, hy + 12, c1); b.px(18, hy + 16, c1); b.px(5, hy + 21, c1); b.px(18, hy + 24, c1);
      eyes(9, hy + 13, 14, '#222'); mouth(11, hy + 17, c1d); blush(hy + 15);
      feet(c1d);
      break;
    }
    case 'shrimp': {
      // 새우: 마디가 있는 분홍 몸, 긴 더듬이, 밝은 배
      b.rect(8, hy, 1, 6, c3); b.rect(15, hy, 1, 6, c3); b.px(7, hy - 1, c3); b.px(16, hy - 1, c3);
      b.rrect(6, hy + 5, 12, 24, 6, c1);
      if (front) b.rrect(9, hy + 13, 6, 14, 3, c2);
      for (const y of [hy + 12, hy + 17, hy + 22, hy + 26]) { if (front) { b.hline(6, y, 3, c1d); b.hline(15, y, 3, c1d); } else b.hline(6, y, 12, c1d); }
      if (back || side) { b.rect(back ? 9 : 17, hy + 27, back ? 6 : 4, 3, c3); }
      eyes(9, hy + 9, 14, '#222'); mouth(11, hy + 12, c1d); blush(hy + 11);
      feet(c3, 2);
      break;
    }
    case 'bungeoppang': {
      // 붕어빵: 노릇한 붕어 모양, 아래쪽에 비늘 무늬와 꼬리지느러미, 한쪽에 팥이 살짝 보인다
      b.rect(4, hy + 24, 5, 5, c1); b.rect(15, hy + 24, 5, 5, c1); b.px(4, hy + 24, null); b.px(19, hy + 24, null);
      b.ellipse(12, hy + 14, 8, 12, c1);
      b.rect(11, hy, 2, 3, c1d);
      for (const y of [hy + 17, hy + 20, hy + 23]) for (let x = 7; x <= 15; x += 3) b.hline(x + ((y - hy) % 2), y, 2, c1d);
      b.ellipse(12, hy + 5, 5, 2, c3);
      if (!back) { b.rect(16, hy + 6, 3, 3, c2); b.px(17, hy + 5, c2); }
      eyes(9, hy + 9, 14, '#222'); mouth(11, hy + 13, c1d); blush(hy + 11);
      feet(c1d);
      break;
    }
    case 'onigiri': {
      // 삼각김밥: 흰 밥 삼각형에 김 한 장
      for (let j = 0; j < 23; j++) { const w = Math.min(20, 4 + j); b.hline(12 - Math.floor(w / 2), hy + 5 + j, w, c1); }
      b.hline(4, hy + 28, 16, c1); b.px(2, hy + 27, null); b.px(21, hy + 27, null);
      b.rect(8, hy + 20, 8, 9, c2); b.hline(9, hy + 21, 6, shade(c2, 0.2));
      for (const [x, y] of [[6, hy + 22], [17, hy + 18], [11, hy + 8], [14, hy + 11]]) b.px(x, y, '#e6e3d8');
      eyes(9, hy + 14, 14, '#222'); mouth(11, hy + 17, '#8a8478'); blush(hy + 16);
      feet(c3);
      break;
    }
    case 'mandu': {
      // 만두: 통통한 반달 몸에 위쪽으로 주름이 잡혀 있다
      b.ellipse(12, hy + 18, 10, 10, c1);
      b.ellipse(12, hy + 9, 8, 3, c2);
      for (let x = 5; x <= 18; x += 3) { b.rect(x, hy + 7, 2, 4, c3); b.px(x, hy + 6, c2); }
      b.ellipse(12, hy + 24, 7, 3, c1l);
      eyes(9, hy + 15, 14, '#222'); mouth(11, hy + 19, shade(c3, -0.25)); blush(hy + 17);
      feet(c3);
      break;
    }
    case 'eggfry': {
      // 계란프라이: 울퉁불퉁한 흰자 한가운데 노른자가 얼굴
      b.ellipse(12, hy + 16, 10, 11, c1); b.circle(5, hy + 10, 3, c1); b.circle(19, hy + 21, 3, c1); b.circle(18, hy + 8, 2.5, c1); b.circle(6, hy + 23, 2.5, c1);
      for (const [x, y] of [[3, hy + 9], [21, hy + 22], [4, hy + 25]]) b.px(x, y, c3);
      b.circle(12, hy + 14, 7, c2); b.px(8, hy + 10, '#fff3b0'); b.px(9, hy + 9, '#fff3b0'); b.px(8, hy + 11, '#fff3b0');
      eyes(9, hy + 13, 14, '#222'); mouth(11, hy + 17, shade(c2, -0.35)); blush(hy + 15);
      feet(c3);
      break;
    }
    case 'boiledegg': {
      // 삶은 계란 (2026-11-17 건의 반영): 흰 달걀, 배에 노른자가 비쳐 보인다. c1 흰자 · c2 노른자 · c3 그늘
      b.ellipse(12, hy + 18, 8, 10, c1); b.ellipse(12, hy + 11, 6.5, 7, c1);
      b.ellipse(12, hy + 26, 6, 2, c3);
      b.px(8, hy + 7, '#ffffff'); b.px(8, hy + 8, '#ffffff'); b.px(9, hy + 6, '#ffffff');
      if (!back) { b.circle(12, hy + 23, 3.5, c2); b.px(11, hy + 22, '#ffe59a'); }
      eyes(9, hy + 13, 14, '#222'); mouth(11, hy + 17, shade(c3, -0.25)); blush(hy + 15);
      feet(shade(c3, -0.15));
      break;
    }
    case 'smokedegg': {
      // 훈제 계란: 갈색으로 익은 달걀, 윤기와 짙은 반점. c1 껍데기 · c2 윤기 · c3 반점·그늘
      b.ellipse(12, hy + 18, 8, 10, c1); b.ellipse(12, hy + 11, 6.5, 7, c1);
      b.ellipse(12, hy + 26, 6, 2, c3);
      b.ellipse(8, hy + 9, 1.5, 2.5, c2);
      for (const [x, y] of [[15, hy + 7], [17, hy + 14], [6, hy + 19], [15, hy + 24], [9, hy + 25], [18, hy + 21]]) b.px(x, y, c3);
      eyes(9, hy + 13, 14, '#222'); mouth(11, hy + 17, c3); blush(hy + 15);
      feet(c3);
      break;
    }
    case 'hamster': {
      // 2026-11-16 건의 반영. c1 털 · c2 볼주머니·배 · c3 귀 안쪽·발. 볼이 머리보다 살짝 넓어 통통해 보인다
      headBody(); feet(c3);
      b.circle(6, hy + 1, 2, c1); b.circle(18, hy + 1, 2, c1); b.px(6, hy + 1, c3); b.px(18, hy + 1, c3);
      if (front) { b.ellipse(6, hy + 11, 3, 2.5, c2); b.ellipse(18, hy + 11, 3, 2.5, c2); b.ellipse(12, hy + 11, 3, 2, c2); }
      if (side) b.ellipse(7, hy + 11, 4, 2.5, c2);
      eyes(9, hy + 7, 14);
      if (!back) { b.px(side ? 5 : 12, hy + 10, '#f29a9a'); mouth(11, hy + 12, c1d); }
      if (front) b.ellipse(12, by + 8, 4, 3, c2);
      if (side) b.circle(19, by + 9, 1.5, c2);
      if (back) { b.rect(11, hy + 3, 2, 12, c1d); b.rect(11, by + 2, 2, 7, c1d); b.circle(12, by + 10, 1.5, c2); }
      break;
    }
    default: {
      headBody(); feet(c1); eyes(9, hy + 7, 14); mouth(11, hy + 11, c1d);
    }
  }
  if (pose === 'heart' && !back) blush(hy + 9);
  return b;
}
