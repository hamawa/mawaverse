// 금광의 거대한 금덩어리 그림 (2026-11-11). 칸마다 같은 무늬를 깔지 않고 큰 한 장으로 그린다: 울퉁불퉁한 덩어리에 깎인 면(facet)을 넣고, 반짝임은 render 가 프레임마다 얹는다.
import { TILE } from '../shared/config';
import { mulberry32 } from '../shared/hash';

export interface GoldArt {
  cv: HTMLCanvasElement;
  over: number;                                        // 구역 위로 솟은 높이(px): 그릴 때 그만큼 올려 그린다
  sparks: { x: number; y: number; phase: number }[];   // 반짝임 자리 (그림 안 좌표)
}

// 밝은 쪽부터 어두운 쪽으로. 마지막은 외곽선
const PAL: [number, number, number][] = [
  [255, 246, 190], [255, 221, 104], [245, 187, 56], [214, 150, 34], [170, 110, 22], [116, 72, 12], [58, 36, 6],
];
const OVER = 10;
const cache = new Map<string, GoldArt>();

// wTiles × hTiles 칸을 덮는 금덩어리. 한 번 그려 두고 다시 쓴다
export function goldNugget(wTiles: number, hTiles: number): GoldArt {
  const key = `${wTiles}x${hTiles}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = wTiles * TILE, H = hTiles * TILE + OVER;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  const rnd = mulberry32(20261111);

  // 바닥 그림자
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath(); ctx.ellipse(W / 2, H - 9, W / 2 - 4, 10, 0, 0, Math.PI * 2); ctx.fill();

  // 덩어리 윤곽: 둥근 네모(초타원)의 가장자리를 각도에 따라 들쭉날쭉하게
  const cx = W / 2, cy = (H - 6) / 2, rx = W / 2 - 3, ry = (H - 6) / 2 - 2;
  const bumps = Array.from({ length: 5 }, (_, i) => ({ k: 3 + i * 2 + Math.floor(rnd() * 2), amp: 0.05 / (1 + i * 0.5), ph: rnd() * Math.PI * 2 }));
  const edge = (ang: number) => 1 + bumps.reduce((s, b) => s + b.amp * Math.sin(ang * b.k + b.ph), 0);
  const inside = new Uint8Array(W * H);
  const depth = new Float32Array(W * H); // 0 가장자리 … 1 가운데
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry;
    const r = Math.pow(Math.pow(Math.abs(u), 2.8) + Math.pow(Math.abs(v), 2.8), 1 / 2.8);
    const lim = edge(Math.atan2(v, u));
    if (r <= lim) { inside[y * W + x] = 1; depth[y * W + x] = 1 - r / lim; }
  }

  // 깎인 면: 씨앗 점을 흩뿌리고 가까운 씨앗끼리 한 면으로 묶는다. 면마다 밝기를 다르게 (빛은 왼쪽 위에서)
  const seeds = Array.from({ length: Math.round(wTiles * hTiles * 1.5) }, () => ({ x: rnd() * W, y: rnd() * H, tone: (rnd() - 0.5) * 0.3 }));
  const img = ctx.getImageData(0, 0, W, H);
  const put = (x: number, y: number, c: [number, number, number]) => { const i = (y * W + x) * 4; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside[y * W + x]) continue;
    let d1 = 1e9, d2 = 1e9, s1 = seeds[0];
    for (const s of seeds) { const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y) * 1.6; if (d < d1) { d2 = d1; d1 = d; s1 = s; } else if (d < d2) d2 = d; }
    // 면의 밝기: 씨앗이 왼쪽 위일수록 밝고, 덩어리 가장자리·아래쪽은 어둡게
    const lx = (s1.x - cx) / rx, ly = (s1.y - cy) / ry;
    let b = 0.56 - lx * 0.2 - ly * 0.3 + s1.tone + Math.min(0.14, depth[y * W + x] * 0.5);
    if (Math.sqrt(d2) - Math.sqrt(d1) < 1.6) b -= 0.2;        // 면과 면 사이 골
    if (depth[y * W + x] < 0.06) b -= 0.18;                   // 가장자리 띠
    const idx = Math.max(0, Math.min(5, Math.round((1 - b) * 5.2)));
    put(x, y, PAL[idx]);
  }
  // 외곽선: 바깥과 맞닿은 안쪽 픽셀
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside[y * W + x]) continue;
    const out = (xx: number, yy: number) => xx < 0 || yy < 0 || xx >= W || yy >= H || !inside[yy * W + xx];
    if (out(x - 1, y) || out(x + 1, y) || out(x, y - 1) || out(x, y + 1)) put(x, y, PAL[6]);
  }
  ctx.putImageData(img, 0, 0);
  // 그림자가 putImageData 에 지워졌으므로(투명 픽셀로 덮임) 덩어리 아래에 다시 깐다
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath(); ctx.ellipse(W / 2, H - 8, W / 2 - 4, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // 반짝임 자리: 덩어리 안쪽의 밝은 쪽(왼쪽 위)에 치우치게
  const sparks: GoldArt['sparks'] = [];
  for (let tries = 0; tries < 400 && sparks.length < wTiles * 2 + 2; tries++) {
    const x = Math.floor(rnd() * W), y = Math.floor(rnd() * (H * 0.8));
    if (!inside[y * W + x] || depth[y * W + x] < 0.15) continue;
    if (sparks.some((s) => Math.abs(s.x - x) + Math.abs(s.y - y) < 22)) continue;
    sparks.push({ x, y, phase: rnd() * Math.PI * 2 });
  }
  const art: GoldArt = { cv, over: OVER, sparks };
  cache.set(key, art);
  return art;
}

// 반짝임: 자리마다 주기가 어긋난 십자 별. ox, oy 는 그림의 왼쪽 위(월드 좌표)
export function drawGoldSparks(ctx: CanvasRenderingContext2D, art: GoldArt, ox: number, oy: number, now: number): void {
  for (const s of art.sparks) {
    const t = Math.sin(now / 520 + s.phase * 3) * Math.sin(now / 1730 + s.phase);
    if (t < 0.55) continue;
    const a = (t - 0.55) / 0.45, x = Math.round(ox + s.x), y = Math.round(oy + s.y), r = a > 0.6 ? 3 : 2;
    ctx.fillStyle = `rgba(255, 255, 240, ${0.5 + 0.5 * a})`;
    ctx.fillRect(x - r, y, r * 2 + 1, 1);
    ctx.fillRect(x, y - r, 1, r * 2 + 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, 1, 1);
  }
}
