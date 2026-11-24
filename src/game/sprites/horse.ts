// 경마공원 말·기수·마필관리사 (2026-11-23). 캐릭터·펫과 같은 방식: PixelBuf 에 찍고 autoShade + OUTLINE, 오른쪽은 왼쪽을 미러링.
// 2등신 치비 비율에 맞춰 머리를 크게, 다리는 짧게 그린다. 옆모습은 왼쪽을 본다.
import { PixelBuf, shade, mix } from '../pixel';
import { drawHuman } from './human';
import { OUTLINE, FRAME_W, FRAME_H, type HumanParams } from './types';
import type { Dir } from '../../shared/types';

// 말은 사람보다 커야 해서 도안(36×44) 을 1.5배 격자에 찍는다. 곡선(원·타원·둥근 모서리)은 고운 격자에서 다시 계산하고
// 음영·외곽선은 고운 격자에서 1픽셀로 둘러 캐릭터와 선 굵기가 같다.
// 기수는 도안에 그리지 않고 사람 캐릭터 생성기(drawHuman)의 상반신을 고운 격자에 그대로(1배) 얹는다: 캐릭터와 크기·그림체가 같다
export const HORSE_SCALE = 1.5;
const LW = 36, LH = 44, LFOOT = 41;
const S = HORSE_SCALE;
const f = (v: number) => Math.round(v * S); // 도안 좌표 → 고운 격자
export const HORSE_W = Math.floor(LW * S), HORSE_H = Math.floor(LH * S);
export const HORSE_FOOT = Math.floor((LFOOT + 1) * S) - 1; // 발밑 기준 줄 (외곽선 포함)
class ScaledBuf extends PixelBuf {
  private s: number;
  constructor(w: number, h: number, s: number) { super(Math.floor(w * s), Math.floor(h * s)); this.s = s; }
  fine(x: number, y: number, c: string): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = c;
  }
  fineRect(x: number, y: number, w: number, h: number, c: string): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.fine(x + i, y + j, c);
  }
  // 다른 버퍼(사람 캐릭터)를 고운 격자에 1배로 찍는다. rows: 위에서부터 찍을 줄 수
  stamp(src: PixelBuf, ox: number, oy: number, rows: number): void {
    for (let y = 0; y < Math.min(rows, src.h); y++) for (let x = 0; x < src.w; x++) {
      const c = src.data[y * src.w + x];
      if (c) this.fine(ox + x, oy + y, c);
    }
  }
  // 도안 한 칸 = 고운 격자 [floor(x·s), floor((x+1)·s)) (1.5배면 1·2픽셀이 번갈아 나온다)
  px(x: number, y: number, c: string | null): void {
    const s = this.s, X = Math.round(x), Y = Math.round(y);
    const x0 = Math.floor(X * s), x1 = Math.floor((X + 1) * s), y0 = Math.floor(Y * s), y1 = Math.floor((Y + 1) * s);
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) if (c) this.fine(i, j, c); else super.px(i, j, null);
  }
  circle(cx: number, cy: number, r: number, c: string): void {
    const R = (Math.sqrt(r * r + r * 0.6) + 0.5) * this.s - 0.5; // 도안 원과 같은 넓이
    this.fineEllipse(cx, cy, R, R, c);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: string): void {
    const k = Math.sqrt(1 + 0.35 / Math.max(rx, ry));
    this.fineEllipse(cx, cy, (rx * k + 0.5) * this.s - 0.5, (ry * k + 0.5) * this.s - 0.5, c);
  }
  private fineEllipse(cx: number, cy: number, Rx: number, Ry: number, c: string): void {
    const s = this.s, fx = (cx + 0.5) * s - 0.5, fy = (cy + 0.5) * s - 0.5;
    for (let y = Math.floor(fy - Ry); y <= Math.ceil(fy + Ry); y++)
      for (let x = Math.floor(fx - Rx); x <= Math.ceil(fx + Rx); x++) {
        const dx = (x - fx) / Rx, dy = (y - fy) / Ry;
        if (dx * dx + dy * dy <= 1) this.fine(x, y, c);
      }
  }
}
// 기수: 복색 줄무늬 긴팔(top 5: topColor 바탕·topColor2 줄)과 복색 헬멧(비니 모양), 흰 바지·검은 장화
function jockeyParams(silkA: string, silkB: string): HumanParams {
  return {
    kind: 'human', female: false, skin: SKIN, hair: 0, hairColor: '#3a2a1e', eye: '#222222',
    top: 5, topColor: silkA, topColor2: silkB, bottom: 0, bottomColor: BREECH, shoe: BOOT, acc: 4, accColor: silkA,
  };
}
const TORSO_ROWS = 25; // drawHuman 의 다리는 25줄부터 (그 위만 얹는다)
function rider(b: ScaledBuf, L: HorseLook, d: Dir, ox: number, oy: number): void {
  b.stamp(drawHuman(jockeyParams(L.silkA, L.silkB), d, 0, 'none'), ox, oy, TORSO_ROWS);
}
const SKIN = '#f2c89b', HOOF = '#3a2a20', BREECH = '#f2f2f2', BOOT = '#2a2a2a';

export interface HorseLook {
  coat: string; silkA: string; silkB: string;
  dir: Dir; frame: number;
  gait: 'stand' | 'walk' | 'trot' | 'gallop';
  rider: boolean;
  head: -1 | 0 | 1;  // -1 고개 듦 · 1 고개 숙임
  rear: boolean;     // 앞발 들기
}

const cache = new Map<string, HTMLCanvasElement>();
const CACHE_LIMIT = 1500;
function cached(key: string, make: () => PixelBuf, mirror: boolean): HTMLCanvasElement {
  let cv = cache.get(key);
  if (cv) return cv;
  let buf = make().autoShade(-0.16).outline(OUTLINE);
  if (mirror) buf = buf.mirrorX();
  cv = buf.toCanvas();
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, cv);
  return cv;
}

// 다리 하나 (짧고 통통하게): 위쪽 x, 발굽 2줄은 둥글게. 발굽 아래 끝은 top + 8
function leg(b: PixelBuf, x: number, top: number, lift: number, color: string): void {
  const h = 6 - lift;
  b.rect(x, top, 4, h, color);
  b.rrect(x, top + h, 4, 2, 1, HOOF);
}
const BLUSH = '#ff8fa3', EAR_IN = '#f6b8c0', EYE = '#2a1a14';
// 반짝이는 큰 눈 (2×3, 위 하이라이트 + 아래 작은 빛)
function eye(b: PixelBuf, x: number, y: number): void {
  b.rect(x, y, 2, 3, EYE);
  b.px(x, y, '#ffffff');
  b.px(x + 1, y + 2, '#8a7a72');
}
// 몽글몽글한 털 뭉치 (원 여러 개)
function tuft(b: PixelBuf, pts: ReadonlyArray<readonly [number, number, number]>, c: string): void {
  for (const [x, y, r] of pts) b.circle(x, y, r, c);
}

// 걸음 한 칸 (frame 0~3) 에서 다리 앞뒤 어긋남·들림
function legPose(gait: HorseLook['gait'], frame: number, i: number): { dx: number; lift: number } {
  if (gait === 'stand') return { dx: 0, lift: 0 };
  const ph = (frame + (i === 0 || i === 3 ? 0 : 2)) & 3; // 대각선 짝(앞가까운·뒤먼)이 같이 움직인다
  if (gait === 'gallop') {
    const front = i < 2;
    if (ph === 0) return { dx: front ? 2 : -2, lift: 1 };    // 모음
    if (ph === 2) return { dx: front ? -3 : 3, lift: 1 };    // 뻗음
    return { dx: 0, lift: 2 };
  }
  const amp = gait === 'trot' ? 2 : 1;
  if (ph === 1) return { dx: -amp, lift: gait === 'trot' ? 2 : 1 };
  if (ph === 3) return { dx: amp, lift: 0 };
  return { dx: 0, lift: 0 };
}

// 귀여운 2등신: 크고 둥근 머리·짧은 주둥이·큰 눈과 볼터치, 짧은 목, 동글한 몸통, 짧고 통통한 다리, 몽글한 갈기·꼬리
function drawSide(b: ScaledBuf, L: HorseLook): void {
  const c = L.coat, far = shade(c, -0.2), mane = shade(c, -0.4), muzzle = mix(c, '#f3e3cf', 0.5);
  const bob = L.gait === 'stand' ? 0 : (L.frame & 1) ? -1 : 0;
  const hy = (L.head === 1 ? 3 : L.head === -1 ? -2 : 0) + (L.rear ? -4 : 0) + bob; // 머리 높이
  const legTop = 33;
  // 먼 쪽 다리 (어둡게, 먼저)
  const fp1 = legPose(L.gait, L.frame, 1), bp1 = legPose(L.gait, L.frame, 3);
  if (L.rear) { b.rect(9, 27 + bob, 4, 4, far); b.rrect(8, 30 + bob, 4, 2, 1, HOOF); }
  else leg(b, 12 + fp1.dx, legTop + bob, fp1.lift, far);
  leg(b, 25 + bp1.dx, legTop + bob, bp1.lift, far);
  // 꼬리 (몽글몽글, 걸으면 살랑)
  const sway = L.gait === 'stand' ? 0 : (L.frame & 2) ? 1 : 0;
  tuft(b, [[30, 25 + bob, 2], [32 + sway, 28 + bob, 2.2], [33 + sway, 31 + bob, 2], [32 + sway, 34 + bob, 1.6]], mane);
  // 몸통 (동글)
  b.ellipse(20, 29 + bob, 10, 6.5, c);
  b.hline(15, 23 + bob, 9, shade(c, 0.14)); // 등 윤기
  // 턱 뒤에서 어깨까지 갈수록 넓어진다. 머리 높이가 바뀌어도 매 행을 채워 빈 틈이 생기지 않는다.
  const poll = 13 + hy, shoulder = 29 + bob;
  for (let y = poll; y <= shoulder; y++) {
    const t = (y - poll) / (shoulder - poll);
    const left = Math.round(10 + 2 * t * t);
    const right = Math.round(13 + 8 * t * t);
    b.hline(left, y, right - left + 1, c);
    if (t < 0.72) b.hline(right - 1, y, 2, mane);
  }
  // 머리 (크고 둥글게)
  b.circle(8, 13 + hy, 6, c);
  b.ellipse(3.5, 16.5 + hy, 3.5, 2.8, muzzle); // 짧은 주둥이
  // 귀 (동글, 안쪽 분홍)
  b.rrect(12, 4 + hy, 3, 5, 1, far);
  b.rrect(9, 3 + hy, 3, 5, 1, c); b.px(10, 5 + hy, EAR_IN); b.px(10, 6 + hy, EAR_IN);
  // 앞머리 (이마에 몽글)
  tuft(b, [[9, 7 + hy, 2], [7, 8 + hy, 1.5], [11, 8 + hy, 1.5]], mane);
  // 눈·볼터치·콧구멍·미소
  eye(b, 6, 11 + hy);
  b.px(5, 11 + hy, EYE); // 속눈썹
  b.ellipse(8.5, 15.5 + hy, 1.2, 0.8, mix(c, BLUSH, 0.6));
  b.px(1, 16 + hy, shade(muzzle, -0.45));
  b.px(3, 18 + hy, shade(muzzle, -0.35)); b.px(4, 18 + hy, shade(muzzle, -0.35));
  // 가까운 쪽 다리
  const fp0 = legPose(L.gait, L.frame, 0), bp0 = legPose(L.gait, L.frame, 2);
  if (L.rear) { b.rect(12, 26 + bob, 4, 4, c); b.rrect(11, 29 + bob, 4, 2, 1, HOOF); }
  else leg(b, 14 + fp0.dx, legTop + bob, fp0.lift, c);
  leg(b, 23 + bp0.dx, legTop + bob, bp0.lift, c);
  // 안장 천 (복색, 아래 단은 둘째 색)
  b.rrect(16, 23 + bob, 9, 4, 1, L.silkA);
  b.hline(16, 27 + bob, 9, L.silkB);
  if (L.rider) {
    // 사람 캐릭터 상반신을 안장 위에 (허리가 안장 천에 묻히게), 다리는 말 옆구리로 굽혀 내린다
    const ox = f(20.5) - 12, oy = f(23 + bob) + 2 - (TORSO_ROWS - 1);
    rider(b, L, 1, ox, oy);
    b.fineRect(ox + 7, oy + TORSO_ROWS - 1, 6, 3, BREECH);
    b.fineRect(ox + 7, oy + TORSO_ROWS + 2, 3, 5, BOOT);
  }
}

function drawFront(b: ScaledBuf, L: HorseLook): void {
  const c = L.coat, far = shade(c, -0.2), mane = shade(c, -0.4), muzzle = mix(c, '#f3e3cf', 0.5);
  const bob = L.gait === 'stand' ? 0 : (L.frame & 1) ? -1 : 0;
  const hy = (L.head === 1 ? 2 : L.head === -1 ? -2 : 0) + (L.rear ? -3 : 0) + bob;
  const lift = (i: number) => (L.gait === 'stand' ? 0 : ((L.frame + i * 2) & 3) === 1 ? 2 : 0);
  // 뒷다리 (몸통 뒤로 조금 보인다)
  leg(b, 12, 33 + bob, 1, far); leg(b, 20, 33 + bob, 1, far);
  // 몸통 (가슴, 동글)
  b.ellipse(18, 29 + bob, 7.5, 6, c);
  // 앞다리
  if (L.rear) { b.rect(12, 28 + bob, 4, 4, c); b.rect(20, 28 + bob, 4, 4, c); b.rrect(12, 31 + bob, 4, 2, 1, HOOF); b.rrect(20, 31 + bob, 4, 2, 1, HOOF); }
  else { leg(b, 13, 33 + bob, lift(0), c); leg(b, 19, 33 + bob, lift(1), c); }
  // 안장 천 양옆
  b.rrect(9, 25 + bob, 3, 5, 1, L.silkA); b.rrect(24, 25 + bob, 3, 5, 1, L.silkA);
  // 기수: 말 머리 너머로 얼굴과 어깨가 보인다 (몸통은 머리에 가린다)
  if (L.rider) rider(b, L, 0, f(18) - 12, f(bob));
  for (let y = 18 + hy; y <= 28 + bob; y++) {
    const width = 4 + Math.round(2 * (y - 18 - hy) / (10 + bob - hy));
    b.hline(18 - width, y, width * 2 + 1, c);
  }
  // 귀 (동글, 안쪽 분홍)
  b.rrect(11, 7 + hy, 3, 5, 1, c); b.px(12, 9 + hy, EAR_IN); b.px(12, 10 + hy, EAR_IN);
  b.rrect(22, 7 + hy, 3, 5, 1, c); b.px(23, 9 + hy, EAR_IN); b.px(23, 10 + hy, EAR_IN);
  // 머리 (크고 둥글게) + 짧은 주둥이
  b.circle(18, 17 + hy, 7, c);
  b.ellipse(18, 22 + hy, 4.5, 2.8, muzzle);
  // 앞머리 (몽글)
  tuft(b, [[18, 11 + hy, 2.4], [15.5, 12 + hy, 1.6], [20.5, 12 + hy, 1.6]], mane);
  // 눈·볼터치·콧구멍·미소
  eye(b, 13, 15 + hy); eye(b, 21, 15 + hy);
  b.ellipse(12.5, 19.5 + hy, 1.2, 0.8, mix(c, BLUSH, 0.6)); b.ellipse(23.5, 19.5 + hy, 1.2, 0.8, mix(c, BLUSH, 0.6));
  b.px(16, 21 + hy, shade(muzzle, -0.45)); b.px(20, 21 + hy, shade(muzzle, -0.45));
  b.px(17, 23 + hy, shade(muzzle, -0.35)); b.px(18, 24 + hy, shade(muzzle, -0.35)); b.px(19, 23 + hy, shade(muzzle, -0.35));
}

function drawBack(b: ScaledBuf, L: HorseLook): void {
  const c = L.coat, mane = shade(c, -0.4);
  const bob = L.gait === 'stand' ? 0 : (L.frame & 1) ? -1 : 0;
  const hy = (L.head === 1 ? 2 : L.head === -1 ? -2 : 0) + (L.rear ? -3 : 0) + bob;
  const lift = (i: number) => (L.gait === 'stand' ? 0 : ((L.frame + i * 2) & 3) === 1 ? 2 : 0);
  for (let y = 16 + hy; y <= 26 + bob; y++) {
    const width = 3 + Math.round(3 * (y - 16 - hy) / (10 + bob - hy));
    b.hline(18 - width, y, width * 2 + 1, c);
  }
  // 머리 (뒤통수·귀, 기수 너머로)
  b.rrect(11, 7 + hy, 3, 5, 1, c); b.rrect(22, 7 + hy, 3, 5, 1, c);
  b.circle(18, 15 + hy, 6, c);
  tuft(b, [[18, 11 + hy, 2], [18, 14 + hy, 1.8], [18, 17 + hy, 1.6]], mane); // 갈기
  // 엉덩이 (동글)
  b.ellipse(18, 29 + bob, 8.5, 6.5, c);
  b.hline(14, 23 + bob, 9, shade(c, 0.14)); // 윤기
  leg(b, 12, 33 + bob, lift(0), c); leg(b, 20, 33 + bob, lift(1), c);
  // 꼬리 (몽글, 살랑)
  const sway = L.gait === 'stand' ? 0 : (L.frame & 2) ? 1 : -1;
  tuft(b, [[18 + sway, 26 + bob, 2], [18 + sway, 29 + bob, 2.3], [18 + sway * 2, 32 + bob, 2]], mane);
  // 안장 천
  b.rrect(11, 23 + bob, 14, 3, 1, L.silkA);
  if (L.rider) rider(b, L, 3, f(18) - 12, f(23 + bob) + 2 - (TORSO_ROWS - 1));
}

export function horseSprite(L: HorseLook): HTMLCanvasElement {
  const d: Dir = L.dir === 2 ? 1 : L.dir;
  const key = `${L.coat}|${L.silkA}|${L.silkB}|${L.dir}|${L.frame & 3}|${L.gait}|${L.rider ? 1 : 0}|${L.head}|${L.rear ? 1 : 0}`;
  return cached(key, () => {
    const b = new ScaledBuf(LW, LH, HORSE_SCALE);
    if (d === 1) drawSide(b, L);
    else if (d === 0) drawFront(b, L);
    else drawBack(b, L);
    return b;
  }, L.dir === 2);
}

// 떨어진 기수: 기수와 같은 사람 캐릭터(정면)를 눕힌다. 머리가 왼쪽, 발이 오른쪽. 외곽선 자리로 둘레 1칸을 비운다
export const FALLEN_W = FRAME_H + 2, FALLEN_H = FRAME_W + 2;
export function fallenJockeySprite(silkA: string, silkB: string, mirror: boolean): HTMLCanvasElement {
  return cached(`fallen|${silkA}|${silkB}|${mirror ? 1 : 0}`, () => {
    const src = drawHuman(jockeyParams(silkA, silkB), 0, 0, 'none');
    const b = new PixelBuf(FALLEN_W, FALLEN_H);
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const c = src.data[y * src.w + x];
      if (c) b.px(1 + y, 1 + (src.w - 1 - x), c);
    }
    return b;
  }, mirror);
}

// 마필관리사: 기존 사람 캐릭터 생성기 (남색 셔츠·캡모자)
const GROOM: HumanParams = {
  kind: 'human', female: false, skin: SKIN, hair: 0, hairColor: '#3a2a1e', eye: '#222222',
  top: 1, topColor: '#22335c', topColor2: '#22335c', bottom: 0, bottomColor: '#1a2340',
  shoe: '#2a2a2a', acc: 2, accColor: '#22335c',
};
export function groomSprite(dir: Dir, frame: number): HTMLCanvasElement {
  return cached(`groom|${dir}|${frame & 3}`, () => drawHuman(GROOM, dir === 2 ? 1 : dir, frame & 3, 'none'), dir === 2);
}
