import { PixelBuf, shade } from '../pixel';
import { drawEyes } from './face';
import { FRAME_W, FRAME_H, type HumanParams, type Pose } from './types';
import type { Dir } from '../../shared/types';

export function drawHuman(p: HumanParams, dir: Dir, frame: number, pose: Pose): PixelBuf {
  const b = new PixelBuf(FRAME_W, FRAME_H);
  const d: Dir = dir === 2 ? 1 : dir; // 오른쪽은 왼쪽을 미러링
  const side = d === 1, back = d === 3, front = d === 0;
  frame = frame & 3;
  const step = frame === 1 ? 1 : frame === 3 ? -1 : 0;
  const bob = step !== 0 ? -1 : 0;
  const jump = pose === 'jump';
  const skinD = shade(p.skin, -0.3);
  const topD = shade(p.topColor, -0.25);
  const topL = shade(p.topColor, 0.2);
  const legsSkin = p.bottom === 1 || p.bottom === 2 || p.bottom === 3 || p.top === 3;
  const legColor = p.top === 6 ? p.topColor2 : p.bottomColor;
  const longSleeve = [2, 4, 5, 8].includes(p.top);
  const noSleeve = p.top === 7 || p.top === 3;

  // ---------- 다리 ----------
  const legY = 25 + bob;
  const drawLeg = (x: number, lift: number, w: number) => {
    const h = 8 - lift;
    if (legsSkin) {
      b.rect(x, legY, w, h, p.skin);
      if (p.bottom === 1) b.rect(x, legY, w, 4, p.bottomColor);
    } else b.rect(x, legY, w, h, legColor);
    b.rect(x, legY + h - 2, w, 3, p.shoe);
  };
  if (!side) {
    const liftL = jump ? 3 : step === 1 ? 2 : 0;
    const liftR = jump ? 3 : step === -1 ? 2 : 0;
    drawLeg(8, liftL, 3);
    drawLeg(13, liftR, 3);
  } else {
    const ax = step === 1 ? 7 : step === -1 ? 12 : 9;
    const bx = step === 1 ? 13 : step === -1 ? 8 : 12;
    drawLeg(bx, jump ? 3 : 0, 3);
    drawLeg(ax, jump ? 3 : 0, 3);
  }
  // 치마
  if (p.bottom === 2 || p.bottom === 3) {
    const sc = p.bottomColor;
    const sh = p.bottom === 2 ? 4 : 7;
    if (!side) { b.rect(7, 24 + bob, 10, sh - 1, sc); b.rect(6, 24 + bob + sh - 2, 12, 2, sc); b.hline(6, 24 + bob + sh - 1, 12, shade(sc, -0.25)); }
    else { b.rect(8, 24 + bob, 8, sh - 1, sc); b.rect(7, 24 + bob + sh - 2, 10, 2, sc); b.hline(7, 24 + bob + sh - 1, 10, shade(sc, -0.25)); }
  }

  // ---------- 몸통 ----------
  const ty = 16 + bob;
  const tx = side ? 8 : 7, tw = side ? 8 : 10;
  if (p.top === 7) { b.rect(tx, ty, tw, 9, p.skin); b.rect(tx + 1, ty, tw - 2, 9, p.topColor); }
  else b.rect(tx, ty, tw, 9, p.topColor);
  switch (p.top) {
    case 1:
      if (!back) { b.px(tx + 2, ty, '#ffffff'); b.px(tx + tw - 3, ty, '#ffffff'); for (let yy = ty + 2; yy < ty + 8; yy += 2) b.px(tx + Math.floor(tw / 2), yy, topD); }
      break;
    case 2:
      b.rect(tx + 1, ty - 2, tw - 2, 3, topD);
      if (front) { b.rect(tx + 2, ty + 5, tw - 4, 3, topD); b.px(tx + 4, ty + 1, '#ffffff'); b.px(tx + 5, ty + 1, '#ffffff'); }
      break;
    case 3: {
      const sh = 6;
      if (!side) { b.rect(6, 25 + bob, 12, sh - 1, p.topColor); b.rect(5, 25 + bob + sh - 2, 14, 2, p.topColor); b.hline(5, 25 + bob + sh - 1, 14, topD); b.hline(7, 24 + bob, 10, topD); }
      else { b.rect(7, 25 + bob, 10, sh - 1, p.topColor); b.rect(6, 25 + bob + sh - 2, 12, 2, p.topColor); b.hline(6, 25 + bob + sh - 1, 12, topD); }
      if (front) { b.px(tx + 3, ty + 1, topL); b.px(tx + tw - 4, ty + 1, topL); }
      break;
    }
    case 4:
      if (front) { b.rect(tx + 3, ty, tw - 6, 2, '#ffffff'); b.rect(tx + 4, ty + 2, 2, 5, p.topColor2); b.px(tx + 2, ty + 1, topD); b.px(tx + tw - 3, ty + 1, topD); }
      break;
    case 5:
      b.hline(tx, ty + 2, tw, p.topColor2); b.hline(tx, ty + 5, tw, p.topColor2); b.hline(tx, ty + 8, tw, p.topColor2);
      break;
    case 6:
      if (!back) { b.rect(tx + 2, ty + 2, tw - 4, 7, p.topColor2); b.px(tx + 2, ty, p.topColor2); b.px(tx + 2, ty + 1, p.topColor2); b.px(tx + tw - 3, ty, p.topColor2); b.px(tx + tw - 3, ty + 1, p.topColor2); b.rect(tx + 3, ty + 4, tw - 6, 2, shade(p.topColor2, -0.2)); }
      else b.rect(tx + 1, ty + 2, tw - 2, 7, p.topColor2);
      break;
    case 8:
      if (front) { b.rect(tx + 4, ty, 2, 9, p.topColor2); b.px(tx + 3, ty, topL); b.px(tx + 6, ty, topL); }
      break;
  }

  // ---------- 팔 ----------
  const armSleeve = noSleeve ? 0 : longSleeve ? 7 : 3;
  const drawArm = (x: number, y: number, h: number) => {
    b.rect(x, y, 2, h, p.skin);
    if (armSleeve) b.rect(x, y, 2, Math.min(h, armSleeve), p.topColor);
  };
  const armsUp = pose === 'dance';
  if (!side) {
    if (armsUp) { drawArm(4, ty - 6, 8); drawArm(18, ty - 6, 8); }
    else if (pose === 'push') { drawArm(5, ty + 2, 6); drawArm(17, ty + 2, 6); b.rect(5, ty + 7, 2, 2, p.skin); b.rect(17, ty + 7, 2, 2, p.skin); }
    else {
      drawArm(5, ty + step, 8);
      if (pose === 'wave' && front) { b.rect(17, ty - 7, 2, 9, p.skin); if (armSleeve) b.rect(17, ty - 1, 2, Math.min(5, armSleeve), p.topColor); b.rect(17, ty - 8, 2, 1, p.skin); }
      else drawArm(17, ty - step, 8);
    }
  } else {
    if (armsUp) drawArm(10, ty - 6, 8);
    else if (pose === 'push') { b.rect(4, ty + 3, 6, 2, p.topColor); b.rect(4, ty + 3, 2, 2, p.skin); }
    else drawArm(10 + (step === 1 ? -1 : step === -1 ? 1 : 0), ty + 1, 7);
  }

  // ---------- 목/머리 ----------
  const hy = 3 + bob;
  b.rect(10, hy + 12, 4, 1, p.skin);
  b.rrect(6, hy, 12, 12, 3, p.skin);
  b.rect(5, hy + 6, 1, 2, p.skin);
  b.rect(18, hy + 6, 1, 2, p.skin);
  if (front) {
    drawEyes(b, 8, hy + 6, 14, p.eye, pose, p.female);
    if (pose === 'laugh') { b.rect(10, hy + 9, 4, 2, skinD); b.rect(11, hy + 10, 2, 1, '#e86a6a'); }
    else if (pose === 'yawn') { b.rect(11, hy + 9, 2, 3, skinD); }
    else if (pose === 'angry' || pose === 'cry') { b.px(10, hy + 10, skinD); b.px(11, hy + 9, skinD); b.px(12, hy + 9, skinD); b.px(13, hy + 10, skinD); }
    else { b.px(11, hy + 9, skinD); b.px(12, hy + 9, skinD); }
    if (p.female || pose === 'heart') { b.px(7, hy + 8, '#f7a1a1'); b.px(16, hy + 8, '#f7a1a1'); }
    if (pose === 'heart') { b.px(6, hy + 8, '#f7a1a1'); b.px(17, hy + 8, '#f7a1a1'); }
  } else if (side) {
    drawEyes(b, 7, hy + 6, -1, p.eye, pose, p.female);
    b.px(5, hy + 8, p.skin);
    b.px(7, hy + 9, skinD);
    b.rect(15, hy + 6, 2, 2, skinD);
    if (p.female || pose === 'heart') b.px(7, hy + 8, '#f7a1a1');
  }

  drawHair(b, p, d, hy);
  drawAcc(b, p, d, hy);
  return b;
}

function drawHair(b: PixelBuf, p: HumanParams, d: Dir, hy: number): void {
  const c = p.hairColor;
  const cd = shade(c, -0.3);
  const side = d === 1, back = d === 3, front = d === 0;
  const cap = () => b.rrect(5, hy - 2, 14, 7, 3, c);
  const backFull = (h: number) => b.rrect(5, hy - 2, 14, h, 3, c);
  const sideBack = (h: number) => b.rect(11, hy + 2, 8, h, c);
  const style = p.hair;
  if (style === 9) return; // 대머리
  if (style === 6) { // 짧은 스포츠
    if (back) b.rrect(6, hy - 1, 12, 9, 3, cd); else b.rrect(6, hy - 1, 12, 5, 3, cd);
    return;
  }
  if (style === 8) { // 모히칸
    b.rect(11, hy - 4, 2, 8, c);
    if (back) b.rect(11, hy - 4, 2, 15, c);
    if (side) b.rect(8, hy - 3, 10, 2, c);
    return;
  }
  if (style === 13) { // 아프로
    b.circle(12, hy + 3, 8, c);
    if (!back) b.rrect(6, hy + 3, 12, 8, 3, p.skin); // 얼굴 다시 노출
    if (back) b.circle(12, hy + 5, 8, c);
    if (side) { b.circle(13, hy + 3, 8, c); b.rrect(6, hy + 4, 8, 7, 2, p.skin); }
    return;
  }
  // 기본 캡
  if (back) backFull(style === 2 || style === 16 || style === 15 ? 21 : style === 3 || style === 17 ? 14 : 11);
  else { cap(); if (side) sideBack(style === 2 || style === 16 ? 16 : style === 3 || style === 17 || style === 15 ? 9 : 5); }
  switch (style) {
    case 0: // 짧은 머리
      if (front) { b.px(5, hy + 5, c); b.px(18, hy + 5, c); }
      break;
    case 1: // 삐죽
      for (const x of [6, 9, 12, 15, 18]) { b.px(x, hy - 3, c); b.px(x, hy - 4, c); }
      break;
    case 2: // 긴 생머리
      if (front) { b.rect(5, hy + 3, 2, 14, c); b.rect(17, hy + 3, 2, 14, c); }
      if (side) { b.rect(10, hy + 2, 9, 16, c); b.rect(5, hy + 3, 1, 4, c); }
      break;
    case 3: // 단발
      if (front) { b.rect(5, hy + 3, 2, 9, c); b.rect(17, hy + 3, 2, 9, c); b.rect(6, hy + 4, 3, 2, c); b.rect(15, hy + 4, 3, 2, c); }
      if (side) { b.rect(5, hy + 3, 1, 6, c); }
      break;
    case 4: // 포니테일
      if (side) { b.rect(18, hy + 2, 3, 3, c); b.rect(19, hy + 4, 3, 10, c); b.vline(20, hy + 5, 8, cd); }
      if (back) { b.rect(10, hy + 6, 4, 12, c); b.vline(11, hy + 8, 9, cd); }
      if (front) { b.px(5, hy + 5, c); b.px(18, hy + 5, c); }
      break;
    case 5: // 올림머리(번)
      b.circle(12, hy - 2, 3, c); b.px(12, hy - 3, cd);
      break;
    case 7: // 곱슬
      for (const [x, y] of [[5, hy + 3], [18, hy + 3], [7, hy - 2], [12, hy - 3], [17, hy - 2]]) b.circle(x, y, 2, c);
      if (!back) { b.px(6, hy + 5, cd); b.px(17, hy + 5, cd); }
      break;
    case 10: // 양갈래
      if (!side) { b.rect(3, hy + 2, 3, 3, c); b.rect(2, hy + 4, 3, 10, c); b.rect(18, hy + 2, 3, 3, c); b.rect(19, hy + 4, 3, 10, c); b.vline(3, hy + 5, 8, cd); b.vline(20, hy + 5, 8, cd); }
      else { b.rect(2, hy + 3, 3, 10, c); b.rect(18, hy + 3, 3, 11, c); }
      break;
    case 11: // 옆가르마 앞머리
      if (front) { b.rect(6, hy + 3, 8, 2, c); b.rect(6, hy + 5, 3, 1, c); }
      if (side) { b.rect(5, hy + 3, 4, 2, c); }
      break;
    case 12: // 가운데 가르마
      if (front) { b.rect(6, hy + 3, 4, 2, c); b.rect(14, hy + 3, 4, 2, c); b.vline(12, hy - 1, 5, cd); }
      if (side) { b.rect(5, hy + 3, 3, 2, c); }
      if (back) b.vline(12, hy - 1, 4, cd);
      break;
    case 14: // 투블럭
      if (front) { b.rect(5, hy + 3, 1, 3, cd); b.rect(18, hy + 3, 1, 3, cd); b.rect(7, hy + 3, 10, 1, c); }
      if (side) { b.rect(11, hy + 2, 8, 6, cd); b.rrect(5, hy - 2, 14, 7, 3, c); }
      break;
    case 15: // 땋은 머리
      if (front) { b.rect(17, hy + 3, 2, 15, c); for (let y = hy + 4; y < hy + 18; y += 2) b.px(17 + (y % 4 === 0 ? 1 : 0), y, cd); }
      if (side) { b.rect(18, hy + 3, 2, 15, c); for (let y = hy + 4; y < hy + 18; y += 2) b.px(18 + (y % 4 === 0 ? 1 : 0), y, cd); }
      if (back) { b.rect(11, hy + 8, 3, 12, c); for (let y = hy + 9; y < hy + 20; y += 2) b.px(11 + (y % 4 === 0 ? 1 : 0), y, cd); }
      break;
    case 16: // 웨이브 긴머리
      if (front) for (let y = hy + 3; y < hy + 18; y++) { b.rect(5 + (y % 2), y, 2, 1, c); b.rect(17 - (y % 2), y, 2, 1, c); }
      if (side) { b.rect(10, hy + 2, 9, 16, c); for (let y = hy + 5; y < hy + 18; y += 2) b.px(18, y, cd); }
      if (back) for (let y = hy + 10; y < hy + 20; y += 2) { b.px(6, y, cd); b.px(17, y, cd); }
      break;
    case 17: // 앞머리 단발
      if (front) { b.rect(6, hy + 3, 12, 2, c); b.rect(5, hy + 3, 2, 9, c); b.rect(17, hy + 3, 2, 9, c); }
      if (side) { b.rect(5, hy + 3, 4, 2, c); b.rect(5, hy + 3, 1, 7, c); }
      break;
  }
}

function drawAcc(b: PixelBuf, p: HumanParams, d: Dir, hy: number): void {
  const c = p.accColor;
  const cd = shade(c, -0.3);
  const side = d === 1, back = d === 3, front = d === 0;
  switch (p.acc) {
    case 1: // 안경
      if (front) { b.hline(7, hy + 5, 4, '#333'); b.hline(13, hy + 5, 4, '#333'); b.px(7, hy + 6, '#333'); b.px(10, hy + 6, '#333'); b.px(13, hy + 6, '#333'); b.px(16, hy + 6, '#333'); b.hline(11, hy + 6, 2, '#333'); }
      if (side) { b.hline(6, hy + 5, 4, '#333'); b.px(6, hy + 6, '#333'); b.px(9, hy + 6, '#333'); b.hline(10, hy + 6, 5, '#333'); }
      break;
    case 2: // 캡모자
      b.rrect(5, hy - 3, 14, 6, 3, c);
      if (front) b.rect(4, hy + 2, 16, 2, cd);
      if (side) b.rect(2, hy + 2, 10, 2, cd);
      if (back) b.px(12, hy - 3, cd);
      break;
    case 3: // 리본
      if (!side) { b.rect(15, hy - 2, 5, 3, c); b.px(17, hy - 1, cd); b.px(14, hy - 1, c); b.px(20, hy - 1, c); }
      else { b.rect(14, hy - 2, 5, 3, c); b.px(16, hy - 1, cd); }
      break;
    case 4: // 비니
      b.rrect(5, hy - 3, 14, 8, 3, c); b.hline(5, hy + 3, 14, cd); b.px(12, hy - 4, cd);
      break;
    case 5: // 헤드폰
      b.hline(6, hy - 3, 12, '#333'); b.px(5, hy - 2, '#333'); b.px(18, hy - 2, '#333');
      if (!side) { b.rect(4, hy + 4, 2, 4, '#333'); b.rect(18, hy + 4, 2, 4, '#333'); b.px(4, hy + 5, '#666'); b.px(19, hy + 5, '#666'); }
      else { b.rect(14, hy + 4, 3, 4, '#333'); b.px(15, hy + 5, '#666'); }
      break;
    case 6: // 선글라스
      if (front) { b.rect(7, hy + 6, 4, 2, '#111'); b.rect(13, hy + 6, 4, 2, '#111'); b.hline(11, hy + 6, 2, '#111'); b.px(7, hy + 6, '#555'); b.px(13, hy + 6, '#555'); }
      if (side) { b.rect(6, hy + 6, 4, 2, '#111'); b.hline(10, hy + 6, 5, '#111'); }
      break;
    case 7: // 머리띠
      b.hline(6, hy - 1, 12, c); if (!back) { b.px(5, hy, c); b.px(18, hy, c); }
      break;
    case 8: // 꽃
      if (!back) { b.px(17, hy - 2, c); b.px(16, hy - 1, c); b.px(18, hy - 1, c); b.px(17, hy, c); b.px(17, hy - 1, '#ffe9a8'); }
      else { b.px(7, hy - 2, c); b.px(6, hy - 1, c); b.px(8, hy - 1, c); b.px(7, hy, c); b.px(7, hy - 1, '#ffe9a8'); }
      break;
    case 9: // 베레모
      b.ellipse(12, hy - 2, 8, 3, c); b.px(14, hy - 5, cd); b.hline(6, hy, 12, cd);
      break;
  }
}
