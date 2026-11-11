// 꾸미기 그리기: 모자 픽셀 아트, 이름표 색, 이동 이펙트 파티클. render.ts 와 상점 미리보기가 같이 쓴다
import { FRAME_W } from './sprites';
import type { Dir } from '../shared/types';
import { NAME_COLORS } from '../shared/shop';

// ---- 모자 ----
// 16px 너비 픽셀 아트. 문자는 팔레트 키, '.' 은 투명. 맨 아랫줄이 머리 꼭대기(첫 불투명 줄)보다 overlap 만큼 아래에 온다
interface HatArt { rows: string[]; pal: Record<string, string>; overlap: number }
const HAT_ART: Record<string, HatArt> = {
  straw: { overlap: 3, pal: { y: '#e9cb62', d: '#b8963a', r: '#c0392b' }, rows: [
    '......yyyy......',
    '....yyyyyyyy....',
    '....rrrrrrrr....',
    '.yyyyyyyyyyyyyy.',
    'yddddddddddddddy',
  ] },
  cap: { overlap: 3, pal: { b: '#2f6fd6', k: '#1d4a94', w: '#e8f0ff' }, rows: [
    '......bbbb......',
    '....bbbbbbbb....',
    '...bbbbwbbbbb...',
    '...bbbbbbbbbb...',
    '..kkkkkkkkkkkk..',
  ] },
  beanie: { overlap: 4, pal: { w: '#f3f3f3', r: '#d6453c', d: '#a1312b' }, rows: [
    '.......ww.......',
    '......wwww......',
    '......rrrr......',
    '.....rrrrrr.....',
    '....rrrrrrrr....',
    '...rrrrrrrrrr...',
    '...dddddddddd...',
  ] },
  party: { overlap: 3, pal: { p: '#4ea8de', y: '#ffe066', k: '#ff6b9d' }, rows: [
    '.......k........',
    '.......pp.......',
    '......pyp.......',
    '......pppp......',
    '.....pyppp......',
    '.....ppppyp.....',
    '....pppypppp....',
    '....pppppppp....',
  ] },
  ribbon: { overlap: 4, pal: { p: '#ff7eb3', d: '#d64f8a', k: '#ffd1e6' }, rows: [
    '..pp........pp..',
    '.pppp..dd..pppp.',
    '.ppppppkkpppppp.',
    '..ppppddddpppp..',
    '..pp...dd...pp..',
  ] },
  wizard: { overlap: 3, pal: { v: '#6a3fb5', d: '#4b2a85', y: '#ffe066' }, rows: [
    '........v.......',
    '.......vv.......',
    '.......vvv......',
    '......vvvv......',
    '......vyvvv.....',
    '.....vvvvvv.....',
    '.....vvvvvvv....',
    '....vvvvyvvv....',
    '....vvvvvvvvv...',
    '.vvvvvvvvvvvvvv.',
    'dddddddddddddddd',
  ] },
  catears: { overlap: 6, pal: { o: '#e8963c', p: '#ffb4c8', k: '#2b1b0e' }, rows: [
    '..o..........o..',
    '..oo........oo..',
    '..opo......opo..',
    '..oppo....oppo..',
    '..oppoo..ooppo..',
    '..ooooo..ooooo..',
  ] },
  crown: { overlap: 3, pal: { g: '#ffd84d', d: '#c9a227', r: '#e74c3c', b: '#3fa7ff' }, rows: [
    '..g.....g.....g.',
    '..gg...ggg...gg.',
    '..ggg.ggggg.ggg.',
    '..ggggggggggggg.',
    '..grgggbgggrggg.',
    '..ddddddddddddd.',
  ] },
};
export const HAT_IDS = Object.keys(HAT_ART);

const hatCache = new Map<string, HTMLCanvasElement>();
function hatCanvas(id: string): HTMLCanvasElement | null {
  const art = HAT_ART[id];
  if (!art) return null;
  let cv = hatCache.get(id);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = 16; cv.height = art.rows.length;
    const c = cv.getContext('2d')!;
    art.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) { const k = row[x]; if (k !== '.' && art.pal[k]) { c.fillStyle = art.pal[k]; c.fillRect(x, y, 1, 1); } }
    });
    hatCache.set(id, cv);
  }
  return cv;
}

// dx, dy = 스프라이트 프레임 좌상단(월드 px), top = 프레임 안 첫 불투명 줄. 옆을 볼 때는 1px 그쪽으로
export function drawHat(ctx: CanvasRenderingContext2D, id: string, dx: number, dy: number, top: number, dir: Dir): void {
  const cv = hatCanvas(id);
  if (!cv) return;
  const art = HAT_ART[id];
  const sx = dx + Math.floor((FRAME_W - 16) / 2) + (dir === 1 ? -1 : dir === 2 ? 1 : 0);
  ctx.drawImage(cv, sx, dy + top - cv.height + art.overlap);
}
// 모자가 스프라이트의 첫 불투명 줄보다 위로 솟는 픽셀 수 (머리 위 말풍선·이모트 위치용)
export function hatAbove(id: string): number { const art = HAT_ART[id]; return art ? art.rows.length - art.overlap : 0; }

// ---- 펫 (2026-11-09) ----
// 12px 너비 픽셀 아트(정면). 주인의 한 칸 뒤 타일에 그린다. 걸을 때는 통통 튀고, 가만히 있으면 숨 쉬듯 1px 들썩인다
interface PetArt { rows: string[]; pal: Record<string, string> }
const PET_ART: Record<string, PetArt> = {
  petdog: { pal: { b: '#b8763a', d: '#8a5423', w: '#f6e7cf', k: '#222222', n: '#3a2415', p: '#ff9aa8' }, rows: [
    '.dd......dd.',
    'dbbbbbbbbbbd',
    'dbbbbbbbbbbd',
    '.bbkbbbbkbb.',
    '.bbbbwwbbbb.',
    '..bbwnnwbb..',
    '..bbwwpwbb..',
    '...bbbbbb...',
    '..bbbbbbbb..',
    '..bb....bb..',
  ] },
  petcat: { pal: { g: '#8f96a3', d: '#6b7280', p: '#ffb3c6', k: '#2b2b2b', y: '#ffd84d' }, rows: [
    '.g........g.',
    '.gpg....gpg.',
    '.gggggggggg.',
    '.gggggggggg.',
    '.gykgggggkyg',
    '.gggggppggg.',
    '..gggggggg..',
    '..gggggggg..',
    '.gggggggggg.',
    '..gg....gg..',
  ] },
  petchick: { pal: { y: '#ffd84d', o: '#ff9a3c', k: '#2b2b2b', w: '#fff3c0' }, rows: [
    '.....y......',
    '....yyyy....',
    '...yyyyyy...',
    '..yykyyyky..',
    '..yyyoooyy..',
    '..yyyyyyyy..',
    '.yyyyyyyyyy.',
    '.yyyywwyyyy.',
    '..yyyyyyyy..',
    '...oo..oo...',
  ] },
  petrabbit: { pal: { w: '#f7f7f7', p: '#ffb3c6', k: '#2b2b2b', g: '#d9d9d9' }, rows: [
    '..ww....ww..',
    '..wpw..wpw..',
    '..wpw..wpw..',
    '..wwwwwwww..',
    '.wwkwwwwkww.',
    '.wwwwwppwww.',
    '..wwwwwwww..',
    '.wwwwwwwwww.',
    '.wwwwwwwwww.',
    '..gg....gg..',
  ] },
  petslime: { pal: { g: '#6fd37a', d: '#3f9a4a', k: '#1f3a24', w: '#d9ffe0' }, rows: [
    '............',
    '....gggg....',
    '..ggwggggg..',
    '.gggggggggg.',
    '.ggkggggkgg.',
    'gggggggggggg',
    'gggggkkggggg',
    'gggggggggggg',
    '.gggggggggg.',
    '..dddddddd..',
  ] },
  petturtle: { pal: { g: '#5aa85a', d: '#2f6f36', s: '#9bd36a', k: '#1f3a24', y: '#c9d99a' }, rows: [
    '....dddd....',
    '..ddssssdd..',
    '.dssddddssd.',
    '.dsdssssdsd.',
    '.dssddddssd.',
    '..ddssssdd..',
    '...dddddd...',
    '..gggkggkg..',
    '.ggggggggg..',
    '..gg..gg.gg.',
  ] },
};
const petCache = new Map<string, HTMLCanvasElement>();
export function petCanvas(id: string): HTMLCanvasElement | null {
  const art = PET_ART[id];
  if (!art) return null;
  let cv = petCache.get(id);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = 12; cv.height = art.rows.length;
    const c = cv.getContext('2d')!;
    art.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) { const k = row[x]; if (k !== '.' && art.pal[k]) { c.fillStyle = art.pal[k]; c.fillRect(x, y, 1, 1); } }
    });
    petCache.set(id, cv);
  }
  return cv;
}
// (x, y) = 펫이 있는 타일 좌표(소수 가능, 보간 중). moving 이면 통통, hopAt 이 최근이면 점프(벌레 잡기). 타일 아래쪽 가운데에 선다
// scale: 레벨에 따른 크기 (2026-11-10, 1 = 12×10 픽셀). ride 면 주인 발밑(그림자는 주인 것을 쓰므로 생략)
export function drawPet(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, tile: number, now: number, moving: boolean, moveT: number, hopAt: number, dir: Dir, scale = 1, ride = false): void {
  const cv = petCanvas(id);
  if (!cv) return;
  const hop = now - hopAt;
  let dy = 0;
  if (hop >= 0 && hop < 350) dy -= Math.round(Math.sin((hop / 350) * Math.PI) * 7);
  else if (moving) dy -= Math.round(Math.abs(Math.sin(moveT * Math.PI * 2)) * 2);
  else dy -= Math.floor(now / 600) % 2;
  const w = Math.round(cv.width * scale), h = Math.round(cv.height * scale);
  const px = Math.round(x * tile + (tile - w) / 2);
  const py = Math.round(y * tile + tile - h - (ride ? 1 : 3) + dy);
  // 옆을 볼 때는 좌우로 뒤집는다 (오른쪽 = 기본)
  if (dir === 1) { ctx.save(); ctx.translate(px + w, py); ctx.scale(-1, 1); ctx.drawImage(cv, 0, 0, w, h); ctx.restore(); }
  else ctx.drawImage(cv, px, py, w, h);
  // 그림자
  if (!ride) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(x * tile + tile / 2, y * tile + tile - 2, 5 * scale, 2 * scale, 0, 0, Math.PI * 2); ctx.fill(); }
}

// ---- 탑승 (2026-11-10 저녁) ----
// Lv10 펫은 따라오지 않고 주인 발밑에 "탈것" 그림으로 바뀐다. 처음엔 12px 펫을 2.6배로 키워 깔았는데 캐릭터(1배 픽셀)와 도트 크기가 섞여 이상했다.
// 그래서 캐릭터 150종 탑승 포즈 대신, 펫 6종의 탈것 그림(옆·앞·뒤, 1배 픽셀)만 새로 그리고 캐릭터는 다리 아래쪽을 가려 앉은 것처럼 보이게 한다 (render.ts).
// seat: 그림 위에서 몇 번째 줄에 캐릭터의 (가려진) 아랫단이 오는가. ox: 옆모습일 때 캐릭터를 몸통 중심 쪽으로 미는 픽셀 (오른쪽 볼 때 기준, 왼쪽은 부호 반대)
// 안장(r/R)은 모든 펫 공통 색. 물속에서는 탈것을 그리지 않는다 (render.ts: 펫은 물밑에 있는 셈)
interface MountArt { side: string[]; front: string[]; back: string[]; seat: number; ox: number }
const SADDLE = { r: '#b3402e', R: '#e8b04a' };
const MOUNT_ART: Record<string, MountArt> = {
  petdog: { seat: 4, ox: -2,
    side: [
      '..............................',
      '....................dd..dd....',
      '...................dbbddbbd...',
      '..dd.....rrrrrrr...dbbbbbbd...',
      '..dbd..ddrRRRRRrdd.dbbkbbbbd..',
      '...dbdbbbrrrrrrrbbbdbbbbbwwwd.',
      '....dbbbbbbbbbbbbbbbbbbbbwnnd.',
      '....bbbbbbbbbbbbbbbbbbbbbwwww.',
      '....bbbbbbbbbbbbbbbbbbbbbbwp..',
      '....dbbbbbbbbbbbbbbbbbbbbd....',
      '....dbbbbbbbbbbbbbbbbbbdd.....',
      '.....bbb..bbb....bbb..bbb.....',
      '.....bbb..bbb....bbb..bbb.....',
      '.....ddd..ddd....ddd..ddd.....',
    ],
    front: [
      '........................',
      '......dbbbbbbbbbbd......',
      '.....dbbbbbbbbbbbbd.....',
      '.....rbbbbbbbbbbbbr.....',
      '....bbbbbbbbbbbbbbbb....',
      '...dd.bbbbbbbbbbbb.dd...',
      '...dbbbbbbbbbbbbbbbbd...',
      '...dbbbbkbbbbbbkbbbbd...',
      '....bbbbbbwwwwbbbbbb....',
      '....bbbbbwwnnwwbbbbb....',
      '.....bbb.wwpww..bbb.....',
      '.....ddd........ddd.....',
    ],
    back: [
      '........................',
      '......dbbbbbbbbbbd......',
      '.....dbbbbbbbbbbbbd.....',
      '.....rbbbbbbbbbbbbr.....',
      '....bbbbbbbbbbbbbbbb....',
      '....bbbbbbbbbbbbbbbb....',
      '....bbbbbbbbbbbbbbbb....',
      '....dbbbbbbbddbbbbbd....',
      '.....bbbbbbddbbbbbb.....',
      '.....dbbbbbddbbbbbd.....',
      '.....bbb..dd...bbb......',
      '.....ddd.......ddd......',
    ] },
  petcat: { seat: 4, ox: -2,
    side: [
      '..............................',
      '....................g...g.....',
      '...................gpg.gpg....',
      '.g.......rrrrrrr...ggggggg....',
      '.gg....ddrRRRRRrdd.ggggggg....',
      '..gg..gggrrrrrrrggggggykgggd..',
      '...ggggggggggggggggggggpgggd..',
      '....gggggggggggggggggggggggd..',
      '....ggggggggggggggggggggggd...',
      '....dgggggggggggggggggggggd...',
      '....dgggggggggggggggggggdd....',
      '.....ggg..ggg....ggg..ggg.....',
      '.....ggg..ggg....ggg..ggg.....',
      '.....ddd..ddd....ddd..ddd.....',
    ],
    front: [
      '........................',
      '......dggggggggggd......',
      '.....dggggggggggggd.....',
      '.....rggggggggggggr.....',
      '....gggggggggggggggg....',
      '...g.gggggggggggggg.g...',
      '...gpggggggggggggggpg...',
      '...gggykggggggggkyggg...',
      '....gggggggppggggggg....',
      '....gggggggggggggggg....',
      '.....ggg........ggg.....',
      '.....ddd........ddd.....',
    ],
    back: [
      '........................',
      '......dggggggggggd......',
      '.....dggggggggggggd.....',
      '.....rggggggggggggr.....',
      '....gggggggggggggggg....',
      '....gggggggggggggggg....',
      '....gggggggggggggggg....',
      '....dgggggggggggggggd...',
      '.....gggggggggggggg.....',
      '.....dgggggggggggggd....',
      '.....ggg..gg....ggg.....',
      '.....ddd...gg...ddd.....',
    ] },
  petchick: { seat: 4, ox: -1,
    side: [
      '..............................',
      '...........yy.................',
      '.........yyyyyyyyyyy..........',
      '.......yyyrrrrrrryyyyy........',
      '......yyyrRRRRRRRryyyyy.......',
      '.....yyyyyrrrrrrryyyyykyy.....',
      '.....yyyyyyyyyyyyyyyyyyyooo...',
      '....yyyyyyyyyyyyyyyyyyyyooo...',
      '....yyyyyyyyyyyyyyyyyyyyy.....',
      '....yyywwyyyyyyyyyyyyyyy......',
      '.....yyyyyyyyyyyyyyyyyy.......',
      '......yyyyyyyyyyyyyyyy........',
      '.........oo.......oo..........',
      '........ooo......ooo..........',
    ],
    front: [
      '........................',
      '.......yyyyyyyyyy.......',
      '.....yyyyyyyyyyyyyy.....',
      '.....ryyyyyyyyyyyyr.....',
      '....yyyyyyyyyyyyyyyy....',
      '....yyyyyyyyyyyyyyyy....',
      '....yyyyykyyyyyykyyyy...',
      '....yyyyyyyyyyyyyyyy....',
      '....yyyyyyyooyyyyyyy....',
      '.....yyyyyyooyyyyyy.....',
      '......yyy.yyyy.yyy......',
      '.......oo......oo.......',
    ],
    back: [
      '........................',
      '.......yyyyyyyyyy.......',
      '.....yyyyyyyyyyyyyy.....',
      '.....ryyyyyyyyyyyyr.....',
      '....yyyyyyyyyyyyyyyy....',
      '....yyyyyyyyyyyyyyyy....',
      '....yyyyyyyyyyyyyyyy....',
      '....yyyyyyyyyyyyyyyy....',
      '.....yyyyyyyyyyyyyy.....',
      '......yyyyyyyyyyyy......',
      '.......yy.yyyy.yy.......',
      '.......oo......oo.......',
    ] },
  petrabbit: { seat: 4, ox: 0,
    side: [
      '...................ww.ww......',
      '...................wpw.wpw....',
      '...................wpwwwpw....',
      '.........rrrrrrr....wwwwww....',
      '.......wwrRRRRRrww.wwwwwwww...',
      '..ww..wwwrrrrrrrwwwwwwkwwwww..',
      '.wwww.wwwwwwwwwwwwwwwwwwwppw..',
      '..ww.wwwwwwwwwwwwwwwwwwwwwww..',
      '.....wwwwwwwwwwwwwwwwwwwwww...',
      '....gwwwwwwwwwwwwwwwwwwwwwg...',
      '....gwwwwwwwwwwwwwwwwwwwwgg...',
      '.....www..www....www..www.....',
      '.....www..www....www..www.....',
      '.....ggg..ggg....ggg..ggg.....',
    ],
    front: [
      '.....ww..........ww.....',
      '.....wpw........wpw.....',
      '.....wpw........wpw.....',
      '.....rwwwwwwwwwwwwr.....',
      '....wwwwwwwwwwwwwwww....',
      '....wwwwwwwwwwwwwwww....',
      '....wwwwkwwwwwwwkwwww...',
      '....wwwwwwwwwwwwwwww....',
      '.....wwwwwwppwwwwww.....',
      '.....wwwwwwwwwwwwww.....',
      '......www.wwww.www......',
      '......ggg......ggg......',
    ],
    back: [
      '.....ww..........ww.....',
      '.....wpw........wpw.....',
      '.....wpw........wpw.....',
      '.....rwwwwwwwwwwwwr.....',
      '....wwwwwwwwwwwwwwww....',
      '....wwwwwwwwwwwwwwww....',
      '....wwwwwwwwwwwwwwww....',
      '....wwwwwwwwwwwwwwww....',
      '.....wwwwwwwwwwwwww.....',
      '.....wwwwwwwwwwwwww.....',
      '......www.wwww.www......',
      '......ggg......ggg......',
    ] },
  petslime: { seat: 5, ox: 0,
    side: [
      '..............................',
      '..............................',
      '..........gggggggggg..........',
      '.......gggwwrrrrrrrggg........',
      '.....ggggwwrRRRRRRRrgggg......',
      '....gggggggrrrrrrrrrggggg.....',
      '...gggggggggggggggggggggg.....',
      '..ggggggggggggggggggggkgggkg..',
      '..gggggggggggggggggggggggggg..',
      '.ggggggggggggggggggggggggkkgg.',
      '.gggggggggggggggggggggggggggg.',
      '.gggggggggggggggggggggggggggg.',
      '..dddddddddddddddddddddddddd..',
      '...dddddddddddddddddddddddd...',
    ],
    front: [
      '........................',
      '........................',
      '.......gggggggggg.......',
      '.....ggrrrrrrrrrrgg.....',
      '....gggggggggggggggg....',
      '...gggggggggggggggggg...',
      '...gggggkggggggkggggg...',
      '..gggggggggggggggggggg..',
      '..ggggggggggkkgggggggg..',
      '..gggggggggggggggggggg..',
      '..gggggggggggggggggggg..',
      '...dddddddddddddddddd...',
    ],
    back: [
      '........................',
      '........................',
      '.......gggggggggg.......',
      '.....ggrrrrrrrrrrgg.....',
      '....gggggggggggggggg....',
      '...gggggggggggggggggg...',
      '...gggggggggggggggggg...',
      '..gggggggggggggggggggg..',
      '..gggggggggggggggggggg..',
      '..gggggggggggggggggggg..',
      '..gggggggggggggggggggg..',
      '...dddddddddddddddddd...',
    ] },
  petturtle: { seat: 3, ox: -1,
    side: [
      '..............................',
      '..............................',
      '...........rrrrrrr............',
      '........dddrRRRRRrddd.........',
      '......ddssdrrrrrrrdssddd......',
      '.....dsddssddssddssddsdd......',
      '....ddssddssddssddssddssd.....',
      '....dsddssddssddssddssddd.....',
      '....ddssddssddssddssddssd.gggg',
      '.....dddddddddddddddddddd.gkgg',
      '..g..yyyyyyyyyyyyyyyyyyyygggg.',
      '..gggggggg..gggg...gggg.ggg...',
      '....ggg....gggg....gggg.......',
      '....ddd....dddd....dddd.......',
    ],
    front: [
      '........................',
      '........................',
      '.......rrrrrrrrrr.......',
      '.....ddssddssddssdd.....',
      '....dsddssddssddssdd....',
      '....ddssddssddssddss....',
      '....dddddddddddddddd....',
      '....yyyyyyyyyyyyyyyy....',
      '..gg...gggggggggg...gg..',
      '..gg...ggggkggkggg..gg..',
      '..dd...ggggggggggg..dd..',
      '........gggggggg........',
    ],
    back: [
      '........................',
      '........................',
      '.......rrrrrrrrrr.......',
      '.....ddssddssddssdd.....',
      '....dsddssddssddssdd....',
      '....ddssddssddssddss....',
      '....dddddddddddddddd....',
      '....yyyyyyyyyyyyyyyy....',
      '..gg.......gg......gg...',
      '..gg.......gg......gg...',
      '..dd.......g.......dd...',
      '........................',
    ] },
};
export type MountView = 'side' | 'front' | 'back';
const mountCache = new Map<string, HTMLCanvasElement>();
export function mountCanvas(id: string, view: MountView): HTMLCanvasElement | null {
  const art = MOUNT_ART[id], pal = PET_ART[id]?.pal;
  if (!art || !pal) return null;
  const key = id + '/' + view;
  let cv = mountCache.get(key);
  if (!cv) {
    const rows = art[view];
    cv = document.createElement('canvas');
    cv.width = Math.max(...rows.map((r) => r.length)); cv.height = rows.length;
    const c = cv.getContext('2d')!;
    const colors: Record<string, string> = { ...pal, ...SADDLE };
    rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const k = row[x]; if (k !== '.' && colors[k]) { c.fillStyle = colors[k]; c.fillRect(x, y, 1, 1); } } });
    mountCache.set(key, cv);
  }
  return cv;
}
export const mountView = (dir: Dir): MountView => (dir === 0 ? 'front' : dir === 3 ? 'back' : 'side');
// 탈것 크기·앉는 줄 (render.ts 가 캐릭터를 어디에 앉힐지 계산할 때)
export function mountInfo(id: string, dir: Dir): { w: number; h: number; seat: number; ox: number } | null {
  const art = MOUNT_ART[id];
  if (!art) return null;
  const rows = art[mountView(dir)];
  return { w: Math.max(...rows.map((r) => r.length)), h: rows.length, seat: art.seat, ox: mountView(dir) === 'side' ? (dir === 1 ? -art.ox : art.ox) : 0 };
}
// (x, y) 타일에 선 탈것을 그리고, 캐릭터의 (가려진) 아랫단이 올 화면 y 와 가로 보정을 돌려준다. 걸을 때 1~2px 들썩, 벌레를 잡으면(hopAt) 폴짝
export function drawMount(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, tile: number, now: number, moving: boolean, moveT: number, hopAt: number, dir: Dir): { seatY: number; ox: number } | null {
  const view = mountView(dir);
  const cv = mountCanvas(id, view), info = mountInfo(id, dir);
  if (!cv || !info) return null;
  const hop = now - hopAt;
  let dy = 0;
  if (hop >= 0 && hop < 350) dy -= Math.round(Math.sin((hop / 350) * Math.PI) * 5);
  else if (moving) dy -= Math.round(Math.abs(Math.sin(moveT * Math.PI * 2)) * 2);
  else dy -= Math.floor(now / 700) % 2;
  const px = Math.round(x * tile + (tile - cv.width) / 2);
  const py = Math.round(y * tile + tile - 2 - cv.height + dy);
  if (dir === 1) { ctx.save(); ctx.translate(px + cv.width, py); ctx.scale(-1, 1); ctx.drawImage(cv, 0, 0); ctx.restore(); }
  else ctx.drawImage(cv, px, py);
  return { seatY: py + info.seat, ox: info.ox };
}

// ---- 이름표 색 ----
export interface NameStyle { color: string; bg: string; border?: string } // color 가 'rainbow' 면 drawLabel 이 그라데이션으로 칠한다
export function nameStyle(nc: string | null | undefined): NameStyle | null {
  if (!nc) return null;
  if (nc === 'gold') return { color: '#ffd84d', bg: 'rgba(70, 50, 0, 0.75)', border: '#ffd84d' };
  if (nc === 'rainbow') return { color: 'rainbow', bg: 'rgba(0, 0, 0, 0.6)' };
  const it = NAME_COLORS.find((x) => x.id === nc);
  return it?.color ? { color: it.color, bg: 'rgba(0, 0, 0, 0.55)' } : null;
}
export function rainbowGradient(ctx: CanvasRenderingContext2D, x0: number, x1: number, now: number): CanvasGradient {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  const base = (now / 12) % 360;
  for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${(base + i * 60) % 360}, 95%, 70%)`);
  return g;
}

// ---- 이동 이펙트 (파티클) ----
interface Particle { x: number; y: number; vx: number; vy: number; born: number; life: number; kind: string; hue: number; size: number }
const parts: Particle[] = [];
const lastSpawn = new Map<string, number>();

// 걷는 동안 55ms 마다 발밑(fx, fy = 월드 px)에서 하나씩
export function spawnFx(uid: string, kind: string, fx: number, fy: number, now: number): void {
  const last = lastSpawn.get(uid) || 0;
  if (now - last < 55) return;
  lastSpawn.set(uid, now);
  const n = kind === 'rainbow' ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = kind === 'dust' ? 0.012 : 0.02;
    parts.push({
      x: fx + (Math.random() - 0.5) * 10, y: fy - Math.random() * 3,
      vx: Math.cos(a) * sp, vy: kind === 'dust' ? -0.008 : -0.03 - Math.random() * 0.02,
      born: now, life: kind === 'rainbow' ? 700 : kind === 'heart' ? 650 : 450,
      kind, hue: (now / 4 + i * 40) % 360, size: 1.5 + Math.random() * 1.5,
    });
  }
  if (parts.length > 300) parts.splice(0, parts.length - 300);
}

export function drawFx(ctx: CanvasRenderingContext2D, now: number): void {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    const t = (now - p.born) / p.life;
    if (t >= 1) { parts.splice(i, 1); continue; }
    const x = p.x + p.vx * (now - p.born), y = p.y + p.vy * (now - p.born);
    ctx.globalAlpha = 1 - t;
    switch (p.kind) {
      case 'dust': ctx.fillStyle = '#cdbc9c'; ctx.beginPath(); ctx.arc(x, y, p.size * (1 + t), 0, Math.PI * 2); ctx.fill(); break;
      case 'sparkle': { ctx.fillStyle = t < 0.5 ? '#fff8c0' : '#ffd84d'; const r = p.size * (1.3 - t * 0.6); ctx.fillRect(x - r, y - 0.5, r * 2, 1); ctx.fillRect(x - 0.5, y - r, 1, r * 2); break; }
      case 'heart': ctx.fillStyle = '#ff7eb3'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('♥', x, y); break;
      case 'fire': ctx.fillStyle = t < 0.4 ? '#ffd166' : t < 0.75 ? '#ff7b2e' : '#8a2a0a'; ctx.beginPath(); ctx.arc(x, y, p.size * (1.2 - t * 0.7), 0, Math.PI * 2); ctx.fill(); break;
      default: ctx.fillStyle = `hsl(${p.hue}, 95%, 65%)`; ctx.beginPath(); ctx.arc(x, y, p.size, 0, Math.PI * 2); ctx.fill(); break;
    }
  }
  ctx.globalAlpha = 1;
}
