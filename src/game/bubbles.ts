// 말풍선 꾸미기 (2026-11-20, 사용자 요청. 상점 kind 'bubble', 착용 칸 bb): 일반 채팅 말풍선의 모양·빛깔을 바꾼다. 귓속말(점선 보라)은 그대로다.
// 글자 크기·줄 높이·여백·글꼴은 기본 말풍선과 같다 (크기 계산은 render.ts drawBubble 이 그대로 한다).
// 글꼴은 바꾸지 않는다 (2026-11-21 건의 반영: "이름표처럼 테두리만 바뀌고 글꼴은 그대로". 처음에는 꾸미기마다 바깥에서 글꼴을 받아 썼다. 지금은 바깥으로 나가는 요청이 없다).
// 꾸미기를 더하려면: shared/shop.ts BUBBLES · 여기의 PAINT · 라이브 config/prices/{id}
const BASE = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

// ---- 그리기 ----
type Ctx = CanvasRenderingContext2D;
export interface BubbleInk { color: string; glow?: string } // 글자 빛깔 (glow: 글자 둘레의 빛)
function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function tail(ctx: Ctx, cx: number, by: number, fill: string, stroke: string, lw: number): void {
  ctx.beginPath(); ctx.moveTo(cx - 5, by); ctx.lineTo(cx, by + 7); ctx.lineTo(cx + 5, by); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx - 5, by); ctx.lineTo(cx, by + 7); ctx.lineTo(cx + 5, by); ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke();
  ctx.fillStyle = fill; ctx.fillRect(cx - 4, by - 1.5, 8, 2.5);
}
// 몽글몽글한 둘레: 반원을 이어 붙인다
function cloudPath(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const r = 7, nx = Math.max(2, Math.round(w / (r * 1.7))), ny = Math.max(1, Math.round(h / (r * 1.7))), sx = w / nx, sy = h / ny;
  ctx.beginPath(); ctx.moveTo(x, y);
  for (let i = 0; i < nx; i++) ctx.arc(x + sx * (i + 0.5), y, sx / 2, Math.PI, 0);
  for (let i = 0; i < ny; i++) ctx.arc(x + w, y + sy * (i + 0.5), sy / 2, -Math.PI / 2, Math.PI / 2);
  for (let i = nx - 1; i >= 0; i--) ctx.arc(x + sx * (i + 0.5), y + h, sx / 2, 0, Math.PI);
  for (let i = ny - 1; i >= 0; i--) ctx.arc(x, y + sy * (i + 0.5), sy / 2, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
}
function spark(ctx: Ctx, px: number, py: number, r: number): void { ctx.beginPath(); ctx.moveTo(px, py - r); ctx.quadraticCurveTo(px, py, px + r, py); ctx.quadraticCurveTo(px, py, px, py + r); ctx.quadraticCurveTo(px, py, px - r, py); ctx.quadraticCurveTo(px, py, px, py - r); ctx.fill(); ctx.stroke(); }

// (x, y, w, h): 말풍선 상자, cx: 꼬리의 가운데, now: 움직이는 꾸미기의 시각(ms). 글자 빛깔을 돌려준다
type Paint = (ctx: Ctx, x: number, y: number, w: number, h: number, cx: number, now: number) => BubbleInk;
const PAINT: Readonly<Record<string, Paint>> = {
  'bb-ink': (ctx, x, y, w, h, cx) => {
    ctx.fillStyle = '#17171c'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; rr(ctx, x, y, w, h, 7); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; rr(ctx, x + 2, y + 2, w - 4, h - 4, 5); ctx.stroke();
    tail(ctx, cx, y + h, '#17171c', '#000', 2);
    return { color: '#f4f4f4' };
  },
  'bb-candy': (ctx, x, y, w, h, cx) => {
    ctx.fillStyle = '#ffe6f2'; ctx.strokeStyle = '#ff7eb6'; ctx.lineWidth = 2; rr(ctx, x, y, w, h, 11); ctx.fill(); ctx.stroke();
    tail(ctx, cx, y + h, '#ffe6f2', '#ff7eb6', 2);
    ctx.font = `10px ${BASE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ff5fa2'; ctx.fillText('♥', x + w - 3, y + 2); ctx.fillText('♥', x + 3, y + h - 2);
    return { color: '#8a2457' };
  },
  'bb-cloud': (ctx, x, y, w, h, cx) => {
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#8fbff0'; ctx.lineWidth = 2; cloudPath(ctx, x + 2, y + 2, w - 4, h - 4); ctx.stroke(); ctx.fill();
    ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx - 3, y + h + 6, 3.2, 0, 7); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(cx + 2, y + h + 12, 1.8, 0, 7); ctx.fill(); ctx.stroke();
    return { color: '#27496d' };
  },
  'bb-retro': (ctx, x, y, w, h, cx) => {
    ctx.fillStyle = '#17204a'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = '#8fa2ff'; ctx.lineWidth = 1; ctx.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
    ctx.fillStyle = '#fff'; ctx.fillRect(cx - 4, y + h + 1, 8, 2); ctx.fillRect(cx - 2, y + h + 3, 4, 2);
    return { color: '#ffffff' };
  },
  'bb-gold': (ctx, x, y, w, h, cx) => {
    const g = ctx.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, '#fff3b0'); g.addColorStop(0.35, '#e0a422'); g.addColorStop(0.65, '#fff0a0'); g.addColorStop(1, '#b97d10');
    ctx.fillStyle = '#1b1508'; ctx.strokeStyle = g; ctx.lineWidth = 2.5; rr(ctx, x, y, w, h, 5); ctx.fill(); ctx.stroke();
    tail(ctx, cx, y + h, '#1b1508', '#e0a422', 2);
    ctx.fillStyle = '#ffe58a';
    for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) { ctx.beginPath(); ctx.moveTo(px, py - 3.5); ctx.lineTo(px + 3.5, py); ctx.lineTo(px, py + 3.5); ctx.lineTo(px - 3.5, py); ctx.closePath(); ctx.fill(); }
    return { color: '#ffdf80' };
  },
  'bb-ice': (ctx, x, y, w, h, cx) => {
    const g = ctx.createLinearGradient(x, y, x, y + h); g.addColorStop(0, '#f4fcff'); g.addColorStop(1, '#cdeeff');
    const k = 6; ctx.fillStyle = g; ctx.strokeStyle = '#6cc4f5'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + k, y); ctx.lineTo(x + w - k, y); ctx.lineTo(x + w, y + k); ctx.lineTo(x + w, y + h - k); ctx.lineTo(x + w - k, y + h); ctx.lineTo(x + k, y + h); ctx.lineTo(x, y + h - k); ctx.lineTo(x, y + k); ctx.closePath(); ctx.fill(); ctx.stroke();
    tail(ctx, cx, y + h, '#cdeeff', '#6cc4f5', 2);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#6cc4f5'; ctx.lineWidth = 1; spark(ctx, x + w - 2, y + 1, 5); spark(ctx, x + 4, y + h - 1, 3.5);
    return { color: '#0b4a6f' };
  },
  'bb-rainbow': (ctx, x, y, w, h, cx, now) => {
    const shift = now / 25; // 테두리 빛깔이 천천히 흐른다 (한 바퀴 9초)
    const g = ctx.createLinearGradient(x, 0, x + w, 0); for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${(i * 60 + shift) % 360} 95% 60%)`);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = g; ctx.lineWidth = 3; rr(ctx, x, y, w, h, 8); ctx.fill(); ctx.stroke();
    tail(ctx, cx, y + h, '#fff', `hsl(${(180 + shift) % 360} 95% 55%)`, 2.5);
    return { color: '#222222' };
  },
  'bb-neon': (ctx, x, y, w, h, cx, now) => {
    const col = `hsl(${(now / 30) % 360} 100% 62%)`; // 빛깔이 천천히 바뀐다 (한 바퀴 11초)
    ctx.fillStyle = 'rgba(12, 10, 28, 0.92)'; rr(ctx, x, y, w, h, 7); ctx.fill();
    ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.strokeStyle = col; ctx.lineWidth = 2; rr(ctx, x, y, w, h, 7); ctx.stroke(); ctx.stroke(); ctx.shadowBlur = 0;
    tail(ctx, cx, y + h, 'rgb(12, 10, 28)', col, 2);
    return { color: '#f2ffff', glow: col };
  },
  'bb-flame': (ctx, x, y, w, h, cx, now) => {
    const n = Math.max(4, Math.round(w / 11)), sw = w / n;
    for (const [col, amp, ph] of [['#ff4d1a', 13, 0], ['#ff9a1f', 9, 1.7], ['#ffe066', 5, 3.1]] as const) {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x - 2, y + 6);
      for (let i = 0; i < n; i++) { const hh = amp * (0.55 + 0.45 * Math.sin(now / 130 + i * 1.9 + ph)); ctx.quadraticCurveTo(x + sw * (i + 0.2), y - hh * 0.4, x + sw * (i + 0.5) + Math.sin(now / 170 + i) * 2, y - hh); ctx.quadraticCurveTo(x + sw * (i + 0.8), y - hh * 0.4, x + sw * (i + 1), y + 1); }
      ctx.lineTo(x + w + 2, y + 6); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#2a0e02'; ctx.strokeStyle = '#ff7a1a'; ctx.lineWidth = 2; rr(ctx, x, y, w, h, 6); ctx.fill(); ctx.stroke();
    tail(ctx, cx, y + h, '#2a0e02', '#ff7a1a', 2);
    return { color: '#ffe2b0' };
  },
  // 크리스마스 한정 (2026-11-21, 건의 반영. shop.ts XMAS_IDS): 흰 바탕에 빨강·초록이 번갈아 도는 테두리, 왼쪽 위에 작은 호랑가시 잎
  'bb-xmas': (ctx, x, y, w, h, cx) => {
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#d6342c'; ctx.lineWidth = 2.5; rr(ctx, x, y, w, h, 7); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#2f9e4f'; ctx.setLineDash([6, 6]); rr(ctx, x, y, w, h, 7); ctx.stroke(); ctx.setLineDash([]);
    tail(ctx, cx, y + h, '#ffffff', '#d6342c', 2);
    ctx.fillStyle = '#2f9e4f'; ctx.beginPath(); ctx.ellipse(x + 1, y + 2, 4, 2, -0.6, 0, 7); ctx.fill(); ctx.beginPath(); ctx.ellipse(x + 6, y - 1, 4, 2, 0.5, 0, 7); ctx.fill();
    ctx.fillStyle = '#d6342c'; ctx.beginPath(); ctx.arc(x + 3.5, y - 0.5, 1.8, 0, 7); ctx.fill();
    return { color: '#1f3d2a' };
  },
};
// 아는 꾸미기인가 (옛 화면이 모르는 id 는 기본 말풍선으로 그린다)
export const hasBubbleSkin = (skin: string | null | undefined): skin is string => !!skin && skin in PAINT;
// 말풍선의 바탕을 그리고 글자 빛깔을 돌려준다 (그리기 상태는 건드리지 않고 돌려놓는다)
export function paintBubble(ctx: Ctx, skin: string, x: number, y: number, w: number, h: number, cx: number, now: number): BubbleInk {
  ctx.save(); ctx.lineJoin = 'round'; ctx.setLineDash([]);
  const ink = PAINT[skin](ctx, x, y, w, h, cx, now);
  ctx.restore();
  return ink;
}
export const BUBBLE_SKIN_IDS: readonly string[] = Object.keys(PAINT);
