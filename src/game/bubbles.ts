// 말풍선 꾸미기 (2026-11-20, 사용자 요청. 상점 kind 'bubble', 착용 칸 bb): 일반 채팅 말풍선의 모양·빛깔과 글꼴을 바꾼다. 귓속말(점선 보라)은 그대로다.
// 글자 크기·줄 높이·여백은 기본 말풍선과 같다 (사용자 결정: 글자를 키우지 않는다. 글꼴 모양만 살짝 다르다). 크기 계산은 render.ts drawBubble 이 그대로 한다.
// 글꼴은 게임에 넣지 않고 바깥에서 받는다 (구글 글꼴. 레트로만 jsDelivr 의 Neo둥근모 한 파일 38KB): 그 말풍선이 화면에 처음 뜰 때, 그 글에 필요한 조각만.
// 받기 전이거나 그 주소가 막힌 환경에서는 기본 글꼴로 그린다 (모양·빛깔은 그대로). 서버로 가는 것은 없고, Node(테스트)에서는 아무것도 하지 않는다.
// 꾸미기를 더하려면: shared/shop.ts BUBBLES · 여기의 BUBBLE_FONTS 와 PAINT · 라이브 config/prices/{id}
const BASE = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

export interface BubbleFont { family: string; weight?: number; css?: string; file?: string } // css: 글꼴 목록 주소(구글 글꼴) · file: 글꼴 파일 하나
const gf = (q: string): string => `https://fonts.googleapis.com/css2?family=${q}&display=swap`;
export const BUBBLE_FONTS: Readonly<Record<string, BubbleFont>> = {
  'bb-ink': { family: 'Gowun Batang', weight: 700, css: gf('Gowun+Batang:wght@700') },          // 명조
  'bb-candy': { family: 'Jua', css: gf('Jua') },                                                  // 둥근 글씨
  'bb-cloud': { family: 'Gowun Dodum', css: gf('Gowun+Dodum') },                                  // 부드러운 고딕
  'bb-retro': { family: 'NeoDunggeunmo', file: 'https://cdn.jsdelivr.net/gh/neodgm/neodgm-webfont@1.601/neodgm/neodgm.woff2' }, // 도트 글씨 (판을 고정해 둔다)
  'bb-gold': { family: 'Nanum Myeongjo', weight: 800, css: gf('Nanum+Myeongjo:wght@800') },       // 굵은 명조
  'bb-ice': { family: 'IBM Plex Sans KR', weight: 500, css: gf('IBM+Plex+Sans+KR:wght@500') },    // 또렷한 고딕
  'bb-rainbow': { family: 'Poor Story', css: gf('Poor+Story') },                                  // 가벼운 손글씨
  'bb-neon': { family: 'Do Hyeon', css: gf('Do+Hyeon') },                                         // 간판 글씨
  'bb-flame': { family: 'Nanum Gothic', weight: 700, css: gf('Nanum+Gothic:wght@700') },          // 굵은 고딕
};

// ---- 글꼴 받기 ----
const fontSpec = (f: BubbleFont, size: number): string => `${f.weight ? `${f.weight} ` : ''}${size}px "${f.family}"`;
const started = new Map<string, { ready: boolean; wait: (() => void)[] }>(); // 글꼴 이름 → 글꼴 목록을 받았나, 그때까지 밀린 일
const asked = new Set<string>(); // 이미 받아 달라고 한 (글꼴, 크기, 글): 프레임마다 다시 묻지 않는다
// 이 글을 그 글꼴로 그릴 수 있게 받아 둔다. 다 받으면 다음 프레임부터 그 글꼴로 그려진다 (캔버스는 받은 글꼴만 쓴다).
// 돌려주는 약속은 받은 뒤에 풀린다 (상점 미리보기를 다시 그리는 데 쓴다. 주소가 막힌 환경에서는 풀리지 않는다)
export function loadBubbleFont(skin: string | null | undefined, size: number, text: string): Promise<void> {
  const f = skin ? BUBBLE_FONTS[skin] : undefined;
  if (!f || typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  const load = (): Promise<void> => document.fonts.load(fontSpec(f, size), text).then(() => undefined, () => undefined);
  let st = started.get(f.family);
  if (!st) {
    const s0: { ready: boolean; wait: (() => void)[] } = { ready: false, wait: [] };
    st = s0; started.set(f.family, s0);
    const done = (): void => { s0.ready = true; s0.wait.splice(0).forEach((fn) => fn()); };
    try {
      if (f.file) { document.fonts.add(new FontFace(f.family, `url(${f.file})`)); done(); }
      else if (f.css) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = f.css; link.onload = done; document.head.append(link); }
    } catch { /* 글꼴을 못 쓰는 환경: 기본 글꼴 그대로 */ }
  }
  if (st.ready) return load();
  const s1 = st;
  return new Promise((resolve) => { s1.wait.push(() => { void load().then(resolve); }); });
}
// 그 꾸미기의 글꼴 (CSS font 값). 못 받았으면 뒤에 적은 기본 글꼴로 그려진다
export function bubbleFont(skin: string | null | undefined, size: number, text: string): string {
  const f = skin ? BUBBLE_FONTS[skin] : undefined;
  if (!f) return `${size}px ${BASE}`;
  const key = `${f.family}|${size}|${text}`;
  if (!asked.has(key)) { if (asked.size > 400) asked.clear(); asked.add(key); void loadBubbleFont(skin, size, text); }
  return `${fontSpec(f, size)}, ${BASE}`;
}

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
