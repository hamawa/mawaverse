// 꾸미기 그리기: 모자 픽셀 아트, 이름표 색, 이동 이펙트 파티클. render.ts 와 상점 미리보기가 같이 쓴다
import { FRAME_W, FRAME_H } from './sprites';
import type { Dir } from '../shared/types';
import { NAME_COLORS, TITLES, TITLE_NEEDS } from '../shared/shop';

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
// 비싼 모자 (2026-11-18)
Object.assign(HAT_ART, {
  tophat: { overlap: 3, pal: { k: '#23232b', h: '#3a3a48', r: '#c0392b' }, rows: [
    '....kkkkkkkk....',
    '....khkkkkkk....',
    '....khkkkkkk....',
    '....khkkkkkk....',
    '....khkkkkkk....',
    '....rrrrrrrr....',
    '.kkkkkkkkkkkkkk.',
  ] },
  halo: { overlap: 0, pal: { y: '#ffe680', w: '#fff8d0', d: '#d9a520' }, rows: [
    '....wyyyyyyw....',
    '...y........y...',
    '...dyyyyyyyyd...',
    '................',
    '................',
  ] },
  emperor: { overlap: 3, pal: { g: '#ffd84d', d: '#c9a227', r: '#b0222b', v: '#7a1620', b: '#3fa7ff', e: '#4fd67b', w: '#ffffff' }, rows: [
    '.......ww.......',
    '.......gg.......',
    '..g...gbbg...g..',
    '..gg.grrrrg.gg..',
    '..ggggrrrrgggg..',
    '..gegrrvvrrgeg..',
    '..ggggggggggggg.',
    '..gbgggwgggbggg.',
    '..ddddddddddddd.',
  ] },
} satisfies Record<string, HatArt>);
// 크리스마스 한정 (2026-11-21, 건의 반영. shop.ts XMAS_IDS)
Object.assign(HAT_ART, {
  santa: { overlap: 3, pal: { r: '#d6342c', d: '#a82420', w: '#ffffff', s: '#d9dfe8' }, rows: [
    '.........rr.....',
    '.......rrrrr....',
    '......rrrrrrd...',
    '.....rrrrrrrdww.',
    '....rrrrrrrrdww.',
    '...rrrrrrrrrd...',
    '..wwwwwwwwwwww..',
    '..wssssssssssw..',
  ] },
  rudolph: { overlap: 2, pal: { b: '#8a5a2b', l: '#b98a4c', r: '#d6342c', d: '#a82420' }, rows: [
    '.l...l....l...l.',
    '.b..lb....bl..b.',
    '.bb.b......b.bb.',
    '..bbb......bbb..',
    '...bb......bb...',
    '...bb......bb...',
    '..rrrrrrrrrrrr..',
    '..dd........dd..',
  ] },
} satisfies Record<string, HatArt>);
// 건의 반영 (2026-11-26): 프로펠러 모자 · 풍선 · 머리핀 넷 · 날개 둘. 전부 모자 칸에 쓴다 (모자와 같이 쓸 수 없다).
// 풍선(너비 24)과 날개(천사 36 · 악마 32: 프레임 양옆으로 6px · 4px 씩 나간다)는 머리 아래까지 내려온다: overlap 이 줄 수보다 클 수 있다 (hatAbove 는 0 아래로 내려가지 않는다).
// 날개는 몸의 윤곽 바깥에만 그려서 등 뒤에 있는 것처럼 보인다. 천사 날개는 저장소 주인이 후보 셋(둥근 깃털 · 위로 펼친 날개 · 아래로 접은 날개)에서 접은 날개를 골랐다
Object.assign(HAT_ART, {
  propeller: { overlap: 3, pal: { b: '#3d8ef0', k: '#1d4a94', y: '#ffd43b', r: '#e0433a', g: '#35b563', d: '#1f7a40' }, rows: [
    '..bbbbb..bbbbb..',
    '..kbbbb..bbbbk..',
    '.......yy.......',
    '.......kk.......',
    '.....yyrrbb.....',
    '....yyyrrbbb....',
    '...yyyyrrbbbb...',
    '...yyyyrrbbbb...',
    '..gggggggggggg..',
    '..dddddddddddd..',
  ] },
  balloon: { overlap: 20, pal: { r: '#ff5b6e', w: '#ffd6dc', d: '#c93a52', s: '#f4f4f4' }, rows: [
    '..................rrr...',
    '.................rrrrr..',
    '................rrrrrrr.',
    '...............rrwwrrrrr',
    '...............rwwrrrrrr',
    '...............rwrrrrrrd',
    '...............rrrrrrrrd',
    '................rrrrrrd.',
    '.................rrrrd..',
    '..................rdd...',
    '...................d....',
    '...................s....',
    '....................s...',
    '....................s...',
    '.....................s..',
    '.....................s..',
    '.....................s..',
    '.....................s..',
    '.....................s..',
    '.....................s..',
    '.....................s..',
    '.....................s..',
    '.....................s..',
    '.....................s..',
    '.....................s..',
    '.....................s..',
    '.....................s..',
    '....................s...',
    '....................s...',
    '....................s...',
    '....................s...',
    '...................s....',
  ] },
  pinheart: { overlap: 8, pal: { p: '#ff6fa5', w: '#ffd6e6', d: '#d6457e' }, rows: [
    '..........pp.pp.',
    '.........pwppppp',
    '.........ppppppd',
    '..........ppppd.',
    '...........ppd..',
    '............d...',
  ] },
  pinstar: { overlap: 8, pal: { y: '#ffd84d', w: '#fff6c2', d: '#d9a520' }, rows: [
    '............y...',
    '............y...',
    '.........ywyyyyy',
    '..........yyyyd.',
    '...........yyd..',
    '..........yy.yd.',
    '..........y...d.',
  ] },
  pindrop: { overlap: 9, pal: { b: '#4fb3ff', w: '#dff3ff', d: '#2478c8' }, rows: [
    '............b...',
    '............b...',
    '...........bbb..',
    '...........bbb..',
    '..........bwbbb.',
    '..........bwbbd.',
    '..........bbbbd.',
    '...........bdd..',
  ] },
  pinbolt: { overlap: 8, pal: { y: '#ffe14d', d: '#f29b1d' }, rows: [
    '.............yy.',
    '............yy..',
    '...........yy...',
    '..........yyyyd.',
    '............yd..',
    '...........yd...',
    '..........yd....',
  ] },
  wingangel: { overlap: 25, pal: { o: '#7f93b5', w: '#ffffff', s: '#cfdcf0' }, rows: [
    '....oooo....................oooo....',
    '..oowwwwo..................owwwwoo..',
    '.owwwwwwwo................owwwwwwwo.',
    'owwwwwwwww................wwwwwwwwwo',
    'owwwwwwwww................wwwwwwwwwo',
    'owswwwwwww................wwwwwwwswo',
    'owswwswwwo................owwwswwswo',
    'owswwswwwo................owwwswwswo',
    'owswwswwo..................owwswwswo',
    '.oswwswwo..................owwswwso.',
    '.owswswwo..................owwswswo.',
    '..oswswo....................owswso..',
    '..owsowo....................owoswo..',
    '...oo.oo....................oo.oo...',
  ] },
  wingdevil: { overlap: 20, pal: { k: '#2a1038', p: '#8b2fc9' }, rows: [
    'k..............................k',
    'kk............................kk',
    'kpk..........................kpk',
    'kppk........................kppk',
    'kpppkk....................kkpppk',
    'kpppppkk................kkpppppk',
    'kpppppp..................ppppppk',
    'kpkppkp..................pkppkpk',
    'kk.kp.k..................k.pk.kk',
    'k...k......................k...k',
  ] },
} satisfies Record<string, HatArt>);
export const HAT_IDS = Object.keys(HAT_ART);

const hatCache = new Map<string, HTMLCanvasElement>();
function hatCanvas(id: string): HTMLCanvasElement | null {
  const art = HAT_ART[id];
  if (!art) return null;
  let cv = hatCache.get(id);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = Math.max(16, ...art.rows.map((r) => r.length)); cv.height = art.rows.length; // 보통 16. 풍선·날개는 24
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
  const sx = dx + Math.floor((FRAME_W - cv.width) / 2) + (dir === 1 ? -1 : dir === 2 ? 1 : 0);
  ctx.drawImage(cv, sx, dy + top - cv.height + art.overlap);
}
// 모자가 스프라이트의 첫 불투명 줄보다 위로 솟는 픽셀 수 (머리 위 말풍선·이모트 위치용)
export function hatAbove(id: string): number { const art = HAT_ART[id]; return art ? Math.max(0, art.rows.length - art.overlap) : 0; }

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
  pethamster: { pal: { b: '#e9a55a', d: '#b9793a', w: '#fff4e0', k: '#2b2b2b', p: '#ffb3c6' }, rows: [
    '............',
    '.bb......bb.',
    '.bpbbbbbbpb.',
    '.bbbbbbbbbb.',
    'bbkbbbbbbkbb',
    'bwwbbppbbwwb',
    'bwwwbbbbwwwb',
    '.bwwwwwwwwb.',
    '.bbwwwwwwbb.',
    '..pp....pp..',
  ] },
  // 앵무새 (2026-11-19, 사용자 요청): 붉은 머리와 볏, 눈가의 흰 무늬, 굽은 주황 부리, 초록 몸에 파란 날개. 붉은색 글자는 c 다 (r·R 은 탑승 그림의 안장 색)
  petparrot: { pal: { g: '#3fbf5a', d: '#2a8f43', y: '#ffd84d', o: '#ff9a3c', b: '#3a8fe6', k: '#222222', w: '#f4f4f4', c: '#e8493f' }, rows: [
    '.....cc.....',
    '....cccc....',
    '...cccccc...',
    '..cwkcckwc..',
    '..cwwoowwc..',
    '..ggyooygg..',
    '.bgyyyyyygb.',
    '.bggyyyyggb.',
    '..bggggggb..',
    '...oo..oo...',
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
// 선글라스 자리 (클럽, 2026-11-18): 펫 그림에서 가장 어두운 색이 한 줄에 둘 이상 찍힌 첫 줄을 눈으로 본다 (그림마다 눈 색 글자가 달라 그림에서 찾는다)
const shadesCache = new Map<string, { row: number; x0: number; x1: number } | null>();
function petShades(id: string): { row: number; x0: number; x1: number } | null {
  if (shadesCache.has(id)) return shadesCache.get(id)!;
  const art = PET_ART[id];
  let out: { row: number; x0: number; x1: number } | null = null;
  if (art) {
    const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11; };
    const dark = Object.entries(art.pal).sort((a, b) => lum(a[1]) - lum(b[1]))[0]?.[0];
    for (let r = 1; r < Math.min(7, art.rows.length) && !out && dark; r++) {
      const xs = [...art.rows[r]].map((c, i) => (c === dark ? i : -1)).filter((i) => i >= 0);
      if (xs.length >= 2 && xs[xs.length - 1] - xs[0] >= 3) out = { row: r, x0: xs[0], x1: xs[xs.length - 1] };
    }
    if (!out) out = { row: 3, x0: 3, x1: 8 };
  }
  shadesCache.set(id, out);
  return out;
}
// 펫 꾸미기·고유 동작 (2026-11-20, 건의 + 사용자 결정). 이름은 render 가 화면 좌표에 따로 그린다.
// 고유 동작은 앵무새의 따라 말하기처럼 보는 재미뿐이다 (종류별 능력 차이는 밸런스 때문에 2026-11-10 에 없앴고 되살리지 않는다):
// 토끼 높이 깡충깡충 · 슬라임 빛깔이 천천히 바뀜 (둘은 여기서 종류로) · 고양이 sleep · 거북이 hide · 햄스터 puff · 강아지·병아리 say (world.petLook 이 정한다)
export interface PetLook { name?: string | null; hat?: string | null; glass?: string | null; sleep?: boolean; hide?: boolean; puff?: boolean; say?: string | null; perch?: boolean } // perch: 앉은 주인의 머리 위에 올라앉았다 (그림자 없음)
function hueShift(hex: string, deg: number): string {
  const n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, bl = (n & 255) / 255;
  const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), l = (mx + mn) / 2, d = mx - mn;
  if (d < 0.02) return hex; // 무채색(눈·테두리)은 그대로
  const sat = d / (1 - Math.abs(2 * l - 1) || 1);
  let hh = mx === r ? ((g - bl) / d) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4;
  hh = (((hh * 60 + deg) % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * sat, xx = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = l - c / 2;
  const [r1, g1, b1] = hh < 60 ? [c, xx, 0] : hh < 120 ? [xx, c, 0] : hh < 180 ? [0, c, xx] : hh < 240 ? [0, xx, c] : hh < 300 ? [xx, 0, c] : [c, 0, xx];
  const to = (v: number) => Math.max(0, Math.min(255, Math.round((v + m) * 255))).toString(16).padStart(2, '0');
  return `#${to(r1)}${to(g1)}${to(b1)}`;
}
// 슬라임: 열두 빛깔을 만들어 두고 2.5초마다 다음 빛깔로
const slimeCache = new Map<number, HTMLCanvasElement>();
function slimeCanvas(now: number): HTMLCanvasElement | null {
  const step = Math.floor(Math.max(0, now) / 2500) % 12;
  if (step === 0) return petCanvas('petslime');
  let cv = slimeCache.get(step);
  if (!cv) {
    const art = PET_ART.petslime;
    if (!art) return null;
    cv = document.createElement('canvas');
    cv.width = 12; cv.height = art.rows.length;
    const c = cv.getContext('2d')!;
    art.rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const k = row[x]; if (k !== '.' && art.pal[k]) { c.fillStyle = hueShift(art.pal[k], step * 30); c.fillRect(x, y, 1, 1); } } });
    slimeCache.set(step, cv);
  }
  return cv;
}
// 머리 꼭대기 줄 (모자 자리): 눈이 있는 열들에 색이 넉 칸 넘게 찍힌 첫 줄 (토끼 귀처럼 가는 것은 건너뛴다)
const headCache = new Map<string, number>();
function petHeadTop(id: string): number {
  const hit = headCache.get(id);
  if (hit !== undefined) return hit;
  const art = PET_ART[id], g = petShades(id);
  let top = 0;
  if (art && g) {
    const x0 = Math.max(0, g.x0 - 1), x1 = Math.min(11, g.x1 + 1), need = Math.min(4, x1 - x0);
    for (let r = 0; r < art.rows.length; r++) {
      let n = 0;
      for (let x = x0; x <= x1; x++) if (art.rows[r][x] && art.rows[r][x] !== '.') n++;
      if (n >= need) { top = r; break; }
    }
  }
  headCache.set(id, top);
  return top;
}
// 펫 모자: (cx, top) = 머리 꼭대기 가운데 (캔버스 좌표), u = 펫 그림 한 칸의 크기
function drawPetHat(ctx: CanvasRenderingContext2D, hat: string, cx: number, top: number, u: number): void {
  const R = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(Math.round(cx + x * u), Math.round(top + y * u), Math.max(1, Math.round(w * u)), Math.max(1, Math.round(h * u))); };
  if (hat === 'ph_ribbon') { R(-3, -2, 2, 2, '#ff7eb6'); R(1, -2, 2, 2, '#ff7eb6'); R(-1, -1.5, 2, 1, '#d94f8c'); }
  else if (hat === 'ph_straw') { R(-4, -1, 8, 1, '#e3c16f'); R(-2, -3, 4, 2, '#edd28a'); R(-2, -2, 4, 1, '#c0392b'); }
  else if (hat === 'ph_party') { R(-2, -1, 4, 1, '#5cc8ff'); R(-1.5, -2, 3, 1, '#ff5ce1'); R(-1, -3, 2, 1, '#5cc8ff'); R(-0.5, -4, 1, 1, '#ffd84d'); }
  else if (hat === 'ph_santa') { R(-3, -1, 6, 1, '#ffffff'); R(-2, -2, 4, 1, '#d6342c'); R(-1.5, -3, 3, 1, '#d6342c'); R(-0.5, -4, 2, 1, '#d6342c'); R(1.5, -4, 1, 1, '#ffffff'); } // 크리스마스 한정 (2026-11-21)
  else if (hat === 'ph_crown') { R(-3, -2, 6, 2, '#ffd84d'); R(-3, -3, 1, 1, '#ffd84d'); R(-0.5, -3, 1, 1, '#ffd84d'); R(2, -3, 1, 1, '#ffd84d'); R(-0.5, -1.5, 1, 1, '#e74c3c'); R(-3, -0.5, 6, 0.5, '#c9952a'); }
}
export function drawPet(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, tile: number, now: number, moving: boolean, moveT: number, hopAt: number, dir: Dir, scale = 1, ride = false, shades = false, look?: PetLook | null): void {
  const cv = id === 'petslime' ? slimeCanvas(now) : petCanvas(id);
  if (!cv) return;
  const hide = !!look?.hide && !ride, still = !!look?.sleep || hide;
  const hop = now - hopAt;
  let dy = 0;
  if (hop >= 0 && hop < 350) dy -= Math.round(Math.sin((hop / 350) * Math.PI) * 7);
  else if (moving) dy -= Math.round(Math.abs(Math.sin(moveT * Math.PI * 2)) * (id === 'petrabbit' ? 6 : 2)); // 토끼는 높이 깡충깡충
  else if (!still) dy -= Math.floor(now / 600) % 2;
  const w = Math.round(cv.width * scale * (look?.puff && !ride ? 1.3 : 1)), h = Math.round(cv.height * scale * (hide ? 0.55 : 1)); // 햄스터 볼 빵빵 · 거북이 등껍질 속으로
  const px = Math.round(x * tile + (tile - w) / 2);
  const py = Math.round(y * tile + tile - h - (ride ? 1 : 3) + dy);
  // 옆을 볼 때는 좌우로 뒤집는다 (오른쪽 = 기본)
  if (dir === 1) { ctx.save(); ctx.translate(px + w, py); ctx.scale(-1, 1); ctx.drawImage(cv, 0, 0, w, h); ctx.restore(); }
  else ctx.drawImage(cv, px, py, w, h);
  const g = petShades(id);
  const glass = shades ? 'pg_sun' : ride ? null : look?.glass;
  const hat = ride ? null : look?.hat;
  if (g && !hide && (glass || hat)) {
    const k = w / cv.width, ky = h / cv.height;
    const e0 = dir === 1 ? cv.width - 1 - g.x1 : g.x0, e1 = dir === 1 ? cv.width - 1 - g.x0 : g.x1; // 뒤집어 그렸으면 눈 자리도 뒤집는다
    if (glass) {
      const gy = py + Math.round((g.row - 0.3) * ky), gh = Math.max(2, Math.round(1.7 * ky)), lw = Math.max(3, Math.round(2.6 * k));
      const lx = px + Math.round((e0 - 0.8) * k), rx = px + Math.round((e1 + 1.8) * k) - lw;
      if (glass === 'pg_round') {
        // 동그란 안경: 갈색 테 둘과 가운데 다리, 알은 비친다
        const t = Math.max(1, Math.round(0.4 * k));
        for (const bx of [lx, rx]) {
          ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(bx, gy - t, lw, gh + t * 2);
          ctx.fillStyle = '#4a2f18'; ctx.fillRect(bx, gy - t, lw, t); ctx.fillRect(bx, gy + gh, lw, t); ctx.fillRect(bx, gy - t, t, gh + t * 2); ctx.fillRect(bx + lw - t, gy - t, t, gh + t * 2);
        }
        ctx.fillStyle = '#4a2f18'; ctx.fillRect(lx + lw, gy, Math.max(0, rx - lx - lw), t);
      } else {
        // 선글라스: 두 눈을 덮는 검은 알 둘과 가운데 다리, 왼쪽 알에 흰 반짝임
        ctx.fillStyle = '#0b0b10'; ctx.fillRect(lx, gy, lw, gh); ctx.fillRect(rx, gy, lw, gh); ctx.fillRect(lx, gy, rx + lw - lx, Math.max(1, Math.round(0.5 * k)));
        ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(lx + 1, gy + 1, 1, 1);
      }
    }
    if (hat) { const cArt = (g.x0 + g.x1) / 2 + 0.5; drawPetHat(ctx, hat, px + (dir === 1 ? cv.width - cArt : cArt) * k, py + petHeadTop(id) * ky, Math.max(1, k)); }
  }
  if (!ride && look?.sleep) {
    // 졸기: 작은 z 둘이 머리 옆에서 올라간다
    const zx = px + w - 1, zy = py - 2 - (Math.floor(now / 500) % 3);
    ctx.fillStyle = '#ffffff';
    for (const [ox, oy] of [[0, 0], [4, -5]] as const) { ctx.fillRect(zx + ox, zy + oy, 3, 1); ctx.fillRect(zx + ox + 1, zy + oy + 1, 1, 1); ctx.fillRect(zx + ox, zy + oy + 2, 3, 1); }
  }
  if (!ride && look?.say) {
    ctx.save();
    ctx.font = 'bold 7px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const tx = px + w / 2, ty = py - 2 - (hat ? Math.round(4 * scale) : 0);
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(look.say, tx, ty);
    ctx.fillStyle = '#fff7d6'; ctx.fillText(look.say, tx, ty);
    ctx.restore();
  }
  // 그림자
  if (!ride && !look?.perch) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(x * tile + tile / 2, y * tile + tile - 2, 5 * scale, 2 * scale, 0, 0, Math.PI * 2); ctx.fill(); }
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
  pethamster: { seat: 4, ox: -2,
    side: [
      '..............................',
      '....................bb...bb...',
      '...................bpbbbbbpb..',
      '.........rrrrrrr..bbbbbbbbbbb.',
      '......bbbrRRRRRrbbbbbbbbbkbbb.',
      '....bbbbbrrrrrrrbbbbbbbbbbbwwp',
      '...bbbbbbbbbbbbbbbbbbbbbwwwwww',
      '..bbbbbbbbbbbbbbbbbbbbbbwwwww.',
      '.pbbbbbbbbbbbbbbbbbbbbbbbwww..',
      '..bbbbbbbbbbwwwwwwwwwwbbbb....',
      '...bbbbbbbwwwwwwwwwwwwbbb.....',
      '....dbbbbwwwwwwwwwwwwbbd......',
      '.....pp...pp.....pp...pp......',
      '.....pp...pp.....pp...pp......',
    ],
    front: [
      '........................',
      '......dbbbbbbbbbbd......',
      '.....dbbbbbbbbbbbbd.....',
      '.....rbbbbbbbbbbbbr.....',
      '...bb.bbbbbbbbbbbb.bb...',
      '..bpbbbbbbbbbbbbbbbbpb..',
      '..bbbbbkbbbbbbbbkbbbbb..',
      '..bwwwbbbbbppbbbbbwwwb..',
      '..bwwwwwbbbbbbbbwwwwwb..',
      '...bwwwwwwwwwwwwwwwwb...',
      '....bbwwwwwwwwwwwwbb....',
      '.....pp..........pp.....',
    ],
    back: [
      '........................',
      '......dbbbbbbbbbbd......',
      '.....dbbbbbbbbbbbbd.....',
      '.....rbbbbbbbbbbbbr.....',
      '...bb.bbbbbbbbbbbb.bb...',
      '..bpbbbbbbbddbbbbbbbpb..',
      '..bbbbbbbbbddbbbbbbbbb..',
      '..bbbbbbbbbddbbbbbbbbb..',
      '..bbbbbbbbbddbbbbbbbbb..',
      '...bbbbbbbbbbbbbbbbbb...',
      '....bbbbbbbbppbbbbbb....',
      '.....pp..........pp.....',
    ] },
  petparrot: { seat: 4, ox: -1,
    side: [
      '..............................',
      '....................cc........',
      '.........ggggggggggcccccc.....',
      '.......gggrrrrrrrggccccccc....',
      '......gggrRRRRRRRrgccwkwccoo..',
      '.....gggggrrrrrrrggccwwwcoooo.',
      '....gggggggggggggggggcccc.oo..',
      '.bbbgggbbbbbbbbbggggggggg.....',
      'cbbbggbbbbbbbbbbbgggyyyy......',
      '.cbbbggbbbbbbbbbggggyyyy......',
      '..cbb.ggggggggggggyyyyy.......',
      '........ggggggggggyyy.........',
      '...........oo.......oo........',
      '..........ooo......ooo........',
    ],
    front: [
      '........................',
      '..........cccc..........',
      '.......cccccccccc.......',
      '.....rccccccccccccr.....',
      '....cwwwccccccccwwwc....',
      '....cwkwccccccccwkwc....',
      '....gwwwcccoocccwwwg....',
      '...bgggggggoogggggggb...',
      '...bbggggyyyyyyggggbb...',
      '....bbgggyyyyyygggbb....',
      '......ggg.yyyy.ggg......',
      '.......oo......oo.......',
    ],
    back: [
      '........................',
      '..........cccc..........',
      '.......cccccccccc.......',
      '.....rccccccccccccr.....',
      '....cccccccccccccccc....',
      '....gggggggggggggggg....',
      '....ggbbbbbggbbbbbgg....',
      '...gggbbbbbggbbbbbggg...',
      '....ggbbbbbggbbbbbgg....',
      '.....ggbbbbccbbbbgg.....',
      '.......gg.cbbc.gg.......',
      '.......oo..cc..oo.......',
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
export interface NameStyle { color: string; bg: string; border?: string } // color 가 흐르는 빛깔 이름(LABEL_FLOWS: rainbow·flame·neon·puregold)이면 drawLabel 이 그라데이션으로 칠한다
export function nameStyle(nc: string | null | undefined): NameStyle | null {
  if (!nc) return null;
  if (nc === 'gold') return { color: '#ffd84d', bg: 'rgba(70, 50, 0, 0.75)', border: '#ffd84d' };
  if (nc === 'rainbow') return { color: 'rainbow', bg: 'rgba(0, 0, 0, 0.6)' };
  // 비싼 이름표 (2026-11-18)
  if (nc === 'ncflame') return { color: 'flame', bg: 'rgba(40, 8, 0, 0.75)', border: '#ff7b2e' };
  if (nc === 'ncneon') return { color: 'neon', bg: 'rgba(10, 0, 30, 0.8)', border: '#ff5ce1' };
  if (nc === 'ncdiamond') return { color: '#d6f6ff', bg: 'rgba(10, 40, 70, 0.8)', border: '#8fe3ff' };
  if (nc === 'ggname') return { color: 'puregold', bg: 'rgba(60, 40, 0, 0.85)', border: '#fff2a8' };
  // 금 이름표 (2026-11-26, 저장소 주인 요청: 금광을 캘 명분). 순금과 같은 짜임(흐르는 금빛 글자 + 어두운 바탕 + 밝은 테두리)에 금의 빛깔만 다르다
  if (nc === 'ggrose') return { color: 'rosegold', bg: 'rgba(72, 28, 26, 0.85)', border: '#ffd2c4' };
  if (nc === 'ggwhite') return { color: 'whitegold', bg: 'rgba(34, 40, 54, 0.85)', border: '#f4f8ff' };
  if (nc === 'gggreen') return { color: 'greengold', bg: 'rgba(32, 46, 8, 0.85)', border: '#e6f59a' };
  if (nc === 'ggblack') return { color: 'blackgold', bg: 'rgba(8, 8, 10, 0.92)', border: '#d9a53a' };
  if (nc === 'ggchamp') return { color: 'champgold', bg: 'rgba(58, 48, 30, 0.85)', border: '#fff3d1' };
  const it = NAME_COLORS.find((x) => x.id === nc);
  return it?.color ? { color: it.color, bg: 'rgba(0, 0, 0, 0.55)' } : null;
}
// 흐르는 빛깔: 이름 → 색 띠 (왼쪽에서 오른쪽으로 흐른다). rainbow 는 아래 rainbowGradient 가 따로 그린다
const FLOWS: Record<string, string[]> = {
  flame: ['#ffe066', '#ff9a3c', '#ff4d2e', '#ff9a3c', '#ffe066'],
  neon: ['#5cf2ff', '#ff5ce1', '#b388ff', '#5cf2ff', '#ff5ce1'],
  puregold: ['#fff2a8', '#ffd84d', '#c9952a', '#ffd84d', '#fff2a8'],
  rosegold: ['#ffe4dc', '#f6b9a6', '#cf8672', '#f6b9a6', '#ffe4dc'],
  whitegold: ['#ffffff', '#e3e9ef', '#a9b6c4', '#e3e9ef', '#ffffff'],
  greengold: ['#f3ffc2', '#d3e374', '#93a83a', '#d3e374', '#f3ffc2'],
  blackgold: ['#ffe9a8', '#d9a53a', '#8a6a1c', '#d9a53a', '#ffe9a8'],
  champgold: ['#fffaea', '#f1dfb0', '#c8b07a', '#f1dfb0', '#fffaea'],
};
export function isLabelFlow(color: string): boolean { return color === 'rainbow' || color in FLOWS; }
export function labelFlow(ctx: CanvasRenderingContext2D, color: string, x0: number, x1: number, now: number): CanvasGradient {
  if (color === 'rainbow') return rainbowGradient(ctx, x0, x1, now);
  const stops = FLOWS[color], w = Math.max(1, x1 - x0), shift = ((now / 1600) % 1) * w;
  const g = ctx.createLinearGradient(x0 - w + shift, 0, x1 + shift, 0);
  // 같은 띠를 두 번 이어 붙여 흘러도 끊기지 않게
  for (let k = 0; k < 2; k++) stops.forEach((c, i) => g.addColorStop((k + i / (stops.length - 1)) / 2, c));
  return g;
}
// 칭호의 빛깔: 값이 비쌀수록 눈에 띈다 (2026-11-18)
export function titleStyle(id: string | null | undefined): { text: string; color: string; bg: string; border?: string } | null {
  const it = id ? TITLES.find((t) => t.id === id) : undefined;
  if (!it) return null;
  if (it.id === 'tt-xmas') return { text: it.name, color: '#fff6e0', bg: 'rgba(150, 24, 32, 0.88)', border: '#4cbf6a' }; // 크리스마스 한정 (2026-11-21): 값과 상관없이 빨강·초록
  if (it.id === 'tt-pink') return { text: it.name, color: '#fff0f7', bg: 'rgba(206, 70, 136, 0.88)', border: '#ffc2dd' };   // 핑크공주 (2026-11-25): 이름값을 하게 분홍
  if (TITLE_NEEDS[it.id]) return { text: it.name, color: '#ffe9a8', bg: 'rgba(90, 60, 0, 0.8)', border: '#ffd84d' };        // 달성 칭호: 값(1,000)과 상관없이 금빛 (15만짜리와 같은 모양)
  if (it.price >= 1000000) return { text: it.name, color: 'rainbow', bg: 'rgba(20, 6, 30, 0.85)', border: '#ffd84d' };
  if (it.price >= 300000) return { text: it.name, color: '#ffd84d', bg: 'rgba(60, 20, 90, 0.85)', border: '#d9a8ff' };
  if (it.price >= 150000) return { text: it.name, color: '#ffe9a8', bg: 'rgba(90, 60, 0, 0.8)', border: '#ffd84d' };
  return { text: it.name, color: '#e8fff4', bg: 'rgba(10, 70, 60, 0.8)' };
}
export function rainbowGradient(ctx: CanvasRenderingContext2D, x0: number, x1: number, now: number): CanvasGradient {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  const base = (now / 12) % 360;
  for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${(base + i * 60) % 360}, 95%, 70%)`);
  return g;
}

// ---- 샤샤샥 (2026-11-11): 움직일 때 지나온 자리에 내 모습(모자 포함)의 어두운 잔상을 잠깐씩 남긴다 ----
// 걷는 동안 GHOST_GAP_MS 마다 지금 모습을 한 장 찍어 두고, GHOST_LIFE_MS 동안 흐려지게 그린다. 사람마다 캔버스 GHOST_MAX 장을 돌려 쓴다(매번 새로 만들지 않는다)
export const AFTERIMAGE_FX = 'shasha';
const GHOST_GAP_MS = 45, GHOST_LIFE_MS = 380, GHOST_MAX = 9;
const GHOST_PAD_X = 6, GHOST_PAD_TOP = 16; // 모자가 캐릭터 틀 밖으로 나가는 만큼의 여백 (옆: 천사 날개 6px · 위: 풍선 12px)
interface Ghost { x: number; y: number; at: number; h: number; cv: HTMLCanvasElement }
const ghostTrail = new Map<string, { list: Ghost[]; pool: HTMLCanvasElement[] }>();

// 캐릭터를 그리기 직전에 부른다. spr 을 (dx, dy)에 높이 h 만큼 그릴 참이다 (h: 탑승으로 아래가 잘렸으면 그만큼 짧다)
export function drawAfterimages(ctx: CanvasRenderingContext2D, uid: string, now: number, moving: boolean, spr: HTMLCanvasElement, dx: number, dy: number, h: number, hat: string | null, top: number, dir: Dir): void {
  let tr = ghostTrail.get(uid);
  if (tr) {
    while (tr.list.length && now - tr.list[0].at > GHOST_LIFE_MS) tr.pool.push(tr.list.shift()!.cv);
    for (const g of tr.list) {
      ctx.globalAlpha = 0.55 * (1 - (now - g.at) / GHOST_LIFE_MS);
      ctx.drawImage(g.cv, 0, 0, g.cv.width, GHOST_PAD_TOP + g.h, g.x - GHOST_PAD_X, g.y - GHOST_PAD_TOP, g.cv.width, GHOST_PAD_TOP + g.h);
    }
    ctx.globalAlpha = 1;
  }
  if (!moving) return;
  if (!tr) { tr = { list: [], pool: [] }; ghostTrail.set(uid, tr); }
  const last = tr.list[tr.list.length - 1];
  if (last && now - last.at < GHOST_GAP_MS) return;
  if (tr.list.length >= GHOST_MAX) tr.pool.push(tr.list.shift()!.cv);
  const cv = tr.pool.pop() || document.createElement('canvas');
  cv.width = FRAME_W + GHOST_PAD_X * 2; cv.height = FRAME_H + GHOST_PAD_TOP; // 크기를 다시 넣으면 내용이 지워진다
  const c = cv.getContext('2d')!;
  c.drawImage(spr, GHOST_PAD_X, GHOST_PAD_TOP);
  if (hat) drawHat(c, hat, GHOST_PAD_X, GHOST_PAD_TOP, top, dir);
  // 그린 부분만 어둡게 덮는다
  c.globalCompositeOperation = 'source-atop';
  c.fillStyle = 'rgba(24, 20, 44, 0.6)';
  c.fillRect(0, 0, cv.width, cv.height);
  c.globalCompositeOperation = 'source-over';
  tr.list.push({ x: dx, y: dy, at: now, h, cv });
}

// ---- 이동 이펙트 (파티클) ----
const NOTE_COLORS = ['#ff7eb3', '#ffd84d', '#7fd8ff', '#9be37a', '#c79bff'];
interface Particle { x: number; y: number; vx: number; vy: number; born: number; life: number; kind: string; hue: number; size: number }
const parts: Particle[] = [];
const lastSpawn = new Map<string, number>();

// 걷는 동안 55ms 마다 발밑(fx, fy = 월드 px)에서 하나씩
export function spawnFx(uid: string, kind: string, fx: number, fy: number, now: number): void {
  if (kind === AFTERIMAGE_FX) return; // 샤샤샥은 파티클이 아니라 잔상 (drawAfterimages)
  const last = lastSpawn.get(uid) || 0;
  if (now - last < 55) return;
  lastSpawn.set(uid, now);
  const n = kind === 'rainbowtrail' ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = kind === 'dust' ? 0.012 : 0.02;
    parts.push({
      x: fx + (Math.random() - 0.5) * 10, y: fy - Math.random() * 3,
      vx: Math.cos(a) * sp, vy: kind === 'dust' ? -0.008 : -0.03 - Math.random() * 0.02,
      born: now, life: kind === 'rainbowtrail' || kind === 'petal' || kind === 'snowfx' || kind === 'notes' ? 700 : kind === 'heart' || kind === 'stardust' ? 650 : 450,
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
      // 음표 (2026-11-26 건의): 색색의 음표가 살랑살랑 떠오른다. 어두운 테두리를 먼저 깔아 밝은 바닥에서도 보이게 한다
      case 'notes': {
        const sway = Math.sin((now - p.born) / 150 + p.hue) * 2, g = Math.floor(p.hue) % 2 ? '♪' : '♫';
        ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(20, 20, 40, 0.55)'; ctx.fillText(g, x + sway + 0.6, y + 0.6);
        ctx.fillStyle = NOTE_COLORS[Math.floor(p.hue / 7) % NOTE_COLORS.length]; ctx.fillText(g, x + sway, y);
        break;
      }
      case 'fire': ctx.fillStyle = t < 0.4 ? '#ffd166' : t < 0.75 ? '#ff7b2e' : '#8a2a0a'; ctx.beginPath(); ctx.arc(x, y, p.size * (1.2 - t * 0.7), 0, Math.PI * 2); ctx.fill(); break;
      // 비싼 이펙트 (2026-11-18): 꽃잎은 살랑살랑 내려앉고, 별가루는 금빛 별이 반짝인다
      case 'petal': { ctx.fillStyle = p.hue % 2 < 1 ? '#ffb7d5' : '#ff8fc0'; const sway = Math.sin((now - p.born) / 120 + p.hue) * 2; ctx.beginPath(); ctx.ellipse(x + sway, y + t * 6, p.size * 1.2, p.size * 0.7, p.hue, 0, Math.PI * 2); ctx.fill(); break; }
      case 'stardust': { ctx.fillStyle = t < 0.5 ? '#fff6c2' : '#ffd84d'; const r = p.size * (1.6 - t); ctx.beginPath(); for (let k = 0; k < 10; k++) { const a = (Math.PI / 5) * k - Math.PI / 2, rr = k % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); break; }
      // 눈송이 (2026-11-21 크리스마스 한정): 작은 십자 눈송이가 살랑살랑 내려앉는다. 눈 바닥에서도 보이게 옅은 그림자를 깐다
      case 'snowfx': {
        const sway = Math.sin((now - p.born) / 140 + p.hue) * 2.5, px = Math.round(x + sway), py = Math.round(y + t * 7), big = p.size > 2.2;
        ctx.fillStyle = 'rgba(70, 100, 140, 0.4)'; ctx.fillRect(px - (big ? 2 : 1), py, big ? 5 : 3, 1); ctx.fillRect(px, py - (big ? 2 : 1) + 1, 1, big ? 5 : 3);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(px - (big ? 2 : 1), py - 1, big ? 5 : 3, 1); ctx.fillRect(px, py - (big ? 3 : 2), 1, big ? 5 : 3);
        if (big) { ctx.fillStyle = '#dff1ff'; ctx.fillRect(px - 1, py - 2, 1, 1); ctx.fillRect(px + 1, py - 2, 1, 1); ctx.fillRect(px - 1, py, 1, 1); ctx.fillRect(px + 1, py, 1, 1); }
        break;
      }
      default: ctx.fillStyle = `hsl(${p.hue}, 95%, 65%)`; ctx.beginPath(); ctx.arc(x, y, p.size, 0, Math.PI * 2); ctx.fill(); break;
    }
  }
  ctx.globalAlpha = 1;
}
// 밤에 빛나는 별가루 (2026-11-23 건의): 낮밤 덧칠을 한 뒤에 별가루 알갱이만 한 번 더 얹는다. 어둠에 묻히지 않고 둘레가 옅게 밝다.
// 화면 좌표(캔버스 px)로 그린다: camX·camY 카메라(월드 px), k 확대 배율, lamp 밤의 세기 0~1 (낮에는 아무것도 하지 않는다)
export function drawFxGlow(ctx: CanvasRenderingContext2D, now: number, camX: number, camY: number, k: number, lamp: number): void {
  if (lamp <= 0.02) return;
  let any = false;
  for (const p of parts) {
    if (p.kind !== 'stardust') continue;
    const t = (now - p.born) / p.life;
    if (t >= 1) continue;
    if (!any) { any = true; ctx.globalCompositeOperation = 'lighter'; }
    const x = (p.x + p.vx * (now - p.born) - camX) * k, y = (p.y + p.vy * (now - p.born) - camY) * k;
    const r = p.size * (1.6 - t) * k, halo = r * 2.6, a = (1 - t) * lamp;
    const g = ctx.createRadialGradient(x, y, 0, x, y, halo);
    g.addColorStop(0, `rgba(255, 224, 130, ${0.4 * a})`); g.addColorStop(1, 'rgba(255, 224, 130, 0)');
    ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(x - halo, y - halo, halo * 2, halo * 2);
    ctx.globalAlpha = a; ctx.fillStyle = t < 0.5 ? '#fff6c2' : '#ffd84d';
    ctx.beginPath(); for (let i = 0; i < 10; i++) { const an = (Math.PI / 5) * i - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr); } ctx.closePath(); ctx.fill();
  }
  if (any) { ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
}

// 펫에게 모자·안경을 입혀 본 그림 (상점 카드)
export function petLookCanvas(id: string, look: PetLook, zoom = 3): HTMLCanvasElement {
  const base = document.createElement('canvas'); base.width = 32; base.height = 32;
  const c = base.getContext('2d')!; c.imageSmoothingEnabled = false;
  drawPet(c, id, 0, 0, 32, 0, false, 0, -1e9, 2, 1.7, false, false, look);
  const out = document.createElement('canvas'); out.width = 32 * zoom; out.height = 26 * zoom;
  const o = out.getContext('2d')!; o.imageSmoothingEnabled = false;
  o.drawImage(base, 0, 6, 32, 26, 0, 0, out.width, out.height);
  return out;
}
