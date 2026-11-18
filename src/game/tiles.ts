// 바닥/오브젝트 타일을 코드로 그려 캐시한다.
import { PixelBuf, shade, mix } from './pixel';
import { G, G_GOLD, G_ICE, G_ICE_HOLE, G_SNOW, O, O_BED, O_CHEST, O_FIREPLACE, O_AQUARIUM, O_PIANO, O_TV, O_GOLD_VASE, O_GOLD_STATUE, O_SPEAKER, O_DJ, WALLPAPER_BASE, WALLPAPER_COUNT } from './map';
import { TILE } from '../shared/config';
import { seededRandom } from '../shared/hash';

const P = {
  grass: '#7ec850', grass2: '#6cb544', grassDark: '#5aa23a', flower1: '#ff7eb3', flower2: '#ffd84d', flower3: '#ffffff',
  path: '#d9c38f', pathDark: '#c4ac76', path2: '#bdb7a6', path2Dark: '#a39d8c',
  water: '#4aa3df', waterLight: '#7cc4f0', waterDark: '#3a8cc5',
  wood: '#c99a5b', woodDark: '#b3864a', tile: '#e8e2d2', tileDark: '#d8d1be', plaza: '#cfc9bd', plazaDark: '#bfb8aa',
  sand: '#eadcaa', sandDark: '#d9c88f', carpet: '#c0504d', carpetDark: '#a8403e', darkFloor: '#5b5b66', darkFloorDark: '#4a4a55',
  outline: '#2b2b2b', trunk: '#8b5a2b', trunkDark: '#6e4620', leaf: '#3e9b3e', leafLight: '#5fc45f', leafDark: '#2f7a2f',
  pine: '#2f8a4a', pineLight: '#48a862', pineDark: '#236b3a',
  wall: '#e5d6b8', wallDark: '#c9b894', wallTop: '#b7523f', wallTopDark: '#8e3e30', window: '#8ad4ff', windowFrame: '#6b4b2a',
  fence: '#b98a4c', fenceDark: '#8e6836', benchWood: '#b77a3f', benchDark: '#8f5d2d', metal: '#777', metalDark: '#555',
  table: '#a86f3c', tableTop: '#d19a5c', chair: '#c48a4e', coffee: '#444', coffeeLight: '#666', coffeeRed: '#d64545',
  board: '#8b5e34', boardPaper: '#fff6d8', boardPin: '#e04040', lampPost: '#3d3d44', lampGlow: '#ffe28a',
  bush: '#4ca34c', bushLight: '#6fc06f', bushDark: '#357a35', pot: '#c86f3c', potDark: '#9c552c', rock: '#9a9a9a', rockDark: '#777',
  fountain: '#cfd8dc', fountainDark: '#a7b4ba', sign: '#b07d45', signDark: '#845c30',
  mat: '#8c6d4d', book1: '#d85', book2: '#58a', book3: '#8a5', book4: '#a58', shelf: '#8b5e34', sofa: '#6f8fd8', sofaDark: '#5774b5',
  vending: '#e04b4b', vendingDark: '#b63a3a', vendingGlass: '#9fd8ff', hedge: '#3f8f3f', hedgeDark: '#2e6e2e', counter: '#8d6b4b', counterTop: '#e9dcc5',
  stump: '#a2703e', stumpDark: '#7c5530', stumpRing: '#c9955a', umbrella1: '#e85a5a', umbrella2: '#ffffff', plant: '#45a24d', plantPot: '#b85c3c',
};

const groundCache = new Map<string, HTMLCanvasElement>();
const objectCache = new Map<number, { cv: HTMLCanvasElement; h: number }>();

export function groundTile(id: number, variant: number, frame = 0): HTMLCanvasElement {
  const key = `${id}:${variant}:${frame}`;
  let cv = groundCache.get(key);
  if (cv) return cv;
  cv = drawGround(id, variant, frame).toCanvas();
  groundCache.set(key, cv);
  return cv;
}

function speckle(b: PixelBuf, rnd: () => number, count: number, colors: string[], w = 1, h = 1): void {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rnd() * TILE), y = Math.floor(rnd() * TILE);
    b.rect(x, y, w, h, colors[Math.floor(rnd() * colors.length)]);
  }
}

function drawGround(id: number, variant: number, frame: number): PixelBuf {
  const b = new PixelBuf(TILE, TILE);
  const rnd = seededRandom(`g${id}-${variant}`);
  switch (id) {
    case G_SNOW:
      b.rect(0, 0, TILE, TILE, '#f4f8fa');
      speckle(b, rnd, 9, ['#e0ebf2', '#ffffff'], 2, 1);
      b.rect(4, 24, 6, 1, '#d8e6ee');
      break;
    case G_ICE:
      b.rect(0, 0, TILE, TILE, '#c9eaf3');
      speckle(b, rnd, 8, ['#eafaff', '#a9d7e8'], 3, 1);
      b.rect(5, 7, 9, 1, '#f3fcff');
      b.rect(14, 8, 1, 6, '#a9d7e8');
      break;
    case G_ICE_HOLE:
      b.rect(0, 0, TILE, TILE, '#c9eaf3');
      b.rect(5, 3, 22, 26, '#f2fcff');
      b.rect(3, 7, 26, 18, '#f2fcff');
      b.rect(7, 6, 18, 20, '#173b55');
      b.rect(5, 10, 22, 12, '#173b55');
      b.rect(10, 12, 10, 1, '#39718a');
      break;
    case G.GRASS:
      b.rect(0, 0, TILE, TILE, P.grass);
      speckle(b, rnd, 14, [P.grass2, P.grassDark], 2, 1);
      speckle(b, rnd, 6, [P.grassDark], 1, 2);
      break;
    case G.GRASS2:
      b.rect(0, 0, TILE, TILE, P.grass2);
      speckle(b, rnd, 16, [P.grassDark, P.grass], 2, 1);
      break;
    case G.FLOWER:
      b.rect(0, 0, TILE, TILE, P.grass);
      speckle(b, rnd, 10, [P.grass2, P.grassDark], 2, 1);
      for (let i = 0; i < 4; i++) {
        const x = 3 + Math.floor(rnd() * 24), y = 3 + Math.floor(rnd() * 24);
        const c = [P.flower1, P.flower2, P.flower3][Math.floor(rnd() * 3)];
        b.px(x, y - 1, c); b.px(x - 1, y, c); b.px(x + 1, y, c); b.px(x, y + 1, c); b.px(x, y, '#ffe9a8');
      }
      break;
    case G.PATH:
      b.rect(0, 0, TILE, TILE, P.path);
      speckle(b, rnd, 12, [P.pathDark], 2, 1);
      speckle(b, rnd, 5, ['#e6d3a4'], 1, 1);
      break;
    case G.PATH2:
      b.rect(0, 0, TILE, TILE, P.path2);
      speckle(b, rnd, 14, [P.path2Dark, '#cfc9b8'], 2, 2);
      break;
    case G.WATER: {
      b.rect(0, 0, TILE, TILE, P.water);
      const off = frame * 3;
      for (let i = 0; i < 4; i++) {
        const y = (6 + i * 8 + off) % TILE;
        const x = Math.floor(rnd() * 20);
        b.hline(x, y, 6, P.waterLight); b.hline(x + 8, y + 2, 4, P.waterDark);
      }
      break;
    }
    case G.WOOD:
      b.rect(0, 0, TILE, TILE, P.wood);
      for (let y = 0; y < TILE; y += 8) {
        b.hline(0, y, TILE, P.woodDark);
        const off = (y / 8) % 2 === 0 ? 10 : 22;
        b.vline(off, y, 8, P.woodDark);
      }
      speckle(b, rnd, 6, ['#d6a86a'], 3, 1);
      break;
    case G.TILE_FLOOR:
      b.rect(0, 0, TILE, TILE, P.tile);
      for (let y = 0; y < TILE; y += 16) for (let x = 0; x < TILE; x += 16) {
        b.hline(x, y, 16, P.tileDark); b.vline(x, y, 16, P.tileDark);
        if ((x + y) % 32 === 16) b.rect(x + 1, y + 1, 15, 15, '#f0ebdd');
      }
      break;
    case G.PLAZA:
      b.rect(0, 0, TILE, TILE, P.plaza);
      b.hline(0, 0, TILE, P.plazaDark); b.vline(0, 0, TILE, P.plazaDark);
      b.hline(0, 16, TILE, P.plazaDark); b.vline(16, 0, 16, P.plazaDark); b.vline(8, 16, 16, P.plazaDark); b.vline(24, 16, 16, P.plazaDark);
      speckle(b, rnd, 5, ['#dcd6ca'], 2, 1);
      break;
    case G.SAND:
      b.rect(0, 0, TILE, TILE, P.sand);
      speckle(b, rnd, 12, [P.sandDark], 1, 1);
      break;
    case G.CARPET:
      b.rect(0, 0, TILE, TILE, P.carpet);
      for (let y = 2; y < TILE; y += 6) for (let x = (y / 6) % 2 === 0 ? 2 : 5; x < TILE; x += 6) b.px(x, y, P.carpetDark);
      break;
    case G_GOLD: // 금덩어리 아래 바닥: 큰 그림이 덮으므로 어두운 바닥과 같게
    case G.DARK_FLOOR:
      b.rect(0, 0, TILE, TILE, P.darkFloor);
      b.hline(0, 0, TILE, P.darkFloorDark); b.vline(0, 0, TILE, P.darkFloorDark);
      break;
    default:
      b.rect(0, 0, TILE, TILE, '#ff00ff');
  }
  return b;
}

export function objectSprite(id: number): { cv: HTMLCanvasElement; h: number } | null {
  if (id === O.NONE) return null;
  let s = objectCache.get(id);
  if (s) return s;
  const buf = drawObject(id);
  if (!buf) return null;
  s = { cv: buf.toCanvas(), h: buf.h };
  objectCache.set(id, s);
  return s;
}

function tree(b: PixelBuf, leaf: string, light: string, dark: string, round: boolean): void {
  // 64 높이: 위 32px 캐노피, 아래 트렁크
  b.rect(13, 44, 6, 16, P.trunk); b.rect(16, 44, 3, 16, P.trunkDark);
  b.rect(10, 58, 12, 2, P.trunkDark);
  if (round) {
    b.circle(16, 26, 13, leaf);
    b.circle(10, 20, 7, light); b.circle(21, 18, 8, light);
    b.circle(20, 32, 8, dark);
    b.circle(11, 33, 6, dark);
    b.circle(9, 19, 3, '#9be28a');
  } else {
    for (let i = 0; i < 3; i++) {
      const top = 6 + i * 11, w = 10 + i * 6, y = top;
      for (let j = 0; j < 14; j++) {
        const ww = Math.floor((w * (j + 2)) / 14);
        b.hline(16 - ww / 2, y + j, ww, j < 10 ? leaf : dark);
      }
      b.hline(16 - w / 4, top + 3, w / 4, light);
    }
  }
}

// 벽지 빛깔: 기본 벽 그림의 색을 이 빛깔 쪽으로 섞는다 (벽돌 줄눈·창문 모양은 그대로)
const WALLPAPER_TINT: readonly [string, number][] = [['#ff9ec4', 0.45], ['#7fe0c0', 0.45], ['#2b3a6b', 0.6]];
function drawObject(id: number): PixelBuf | null {
  if (id >= WALLPAPER_BASE && id < WALLPAPER_BASE + WALLPAPER_COUNT * 3) {
    const k = id - WALLPAPER_BASE, base = drawObject([O.WALL, O.WALL_SIDE, O.WALL_WINDOW][k % 3]);
    if (!base) return null;
    const [tint, amt] = WALLPAPER_TINT[Math.floor(k / 3)];
    base.data = base.data.map((c) => (c ? mix(c, tint, amt) : c));
    return base;
  }
  const tall = new PixelBuf(TILE, TILE * 2);
  const one = new PixelBuf(TILE, TILE);
  const rnd = seededRandom('obj' + id);
  switch (id) {
    case O.TREE: tree(tall, P.leaf, P.leafLight, P.leafDark, true); return tall.outline(P.outline);
    case O.PINE: tree(tall, P.pine, P.pineLight, P.pineDark, false); return tall.outline(P.outline);
    case O.WALL:
      one.rect(0, 0, TILE, TILE, P.wall);
      for (let y = 8; y < TILE; y += 8) { one.hline(0, y, TILE, P.wallDark); const off = (y / 8) % 2 ? 8 : 0; for (let x = off; x < TILE; x += 16) one.vline(x, y, 8, P.wallDark); }
      one.rect(0, 0, TILE, 8, P.wallTop); one.hline(0, 7, TILE, P.wallTopDark); one.hline(0, 0, TILE, '#d9705a');
      return one;
    case O.WALL_SIDE:
      one.rect(0, 0, TILE, TILE, P.wall);
      for (let y = 0; y < TILE; y += 8) { one.hline(0, y, TILE, P.wallDark); const off = (y / 8) % 2 ? 8 : 0; for (let x = off; x < TILE; x += 16) one.vline(x, y, 8, P.wallDark); }
      one.vline(0, 0, TILE, P.wallTopDark); one.vline(TILE - 1, 0, TILE, P.wallTopDark);
      return one;
    case O.WALL_WINDOW:
      one.rect(0, 0, TILE, TILE, P.wall);
      for (let y = 8; y < TILE; y += 8) one.hline(0, y, TILE, P.wallDark);
      one.rect(0, 0, TILE, 8, P.wallTop); one.hline(0, 7, TILE, P.wallTopDark); one.hline(0, 0, TILE, '#d9705a');
      one.rect(8, 11, 16, 14, P.windowFrame); one.rect(10, 13, 12, 10, P.window); one.vline(16, 13, 10, P.windowFrame); one.hline(10, 18, 12, P.windowFrame);
      one.rect(11, 14, 3, 2, '#d8f0ff');
      return one;
    case O.FENCE:
      one.rect(2, 10, 28, 3, P.fence); one.rect(2, 20, 28, 3, P.fence);
      for (const x of [4, 15, 26]) { one.rect(x, 6, 3, 22, P.fence); one.rect(x + 1, 6, 1, 22, P.fenceDark); one.px(x + 1, 5, P.fence); }
      return one.outline(P.outline);
    case O.HEDGE:
      one.rect(1, 6, 30, 24, P.hedge);
      one.rrect(1, 4, 30, 22, 4, P.hedge);
      for (let i = 0; i < 12; i++) one.rect(2 + Math.floor(rnd() * 27), 6 + Math.floor(rnd() * 20), 2, 2, i % 2 ? P.hedgeDark : P.bushLight);
      one.rect(1, 26, 30, 4, P.hedgeDark);
      return one.outline(P.outline);
    case O.BUSH:
      one.circle(16, 20, 10, P.bush); one.circle(10, 18, 6, P.bushLight); one.circle(22, 17, 6, P.bushLight); one.circle(16, 25, 7, P.bushDark);
      one.px(12, 15, '#a6e0a6'); one.px(20, 14, '#a6e0a6');
      return one.outline(P.outline);
    case O.BENCH:
      one.rect(3, 10, 26, 4, P.benchWood); one.rect(3, 16, 26, 5, P.benchWood); one.rect(3, 20, 26, 1, P.benchDark);
      one.rect(5, 21, 3, 6, P.metal); one.rect(24, 21, 3, 6, P.metal); one.rect(5, 14, 2, 2, P.metal); one.rect(25, 14, 2, 2, P.metal);
      return one.outline(P.outline);
    case O.TABLE:
      one.rect(3, 8, 26, 14, P.tableTop); one.rect(3, 20, 26, 3, P.table); one.rect(5, 23, 4, 6, P.table); one.rect(23, 23, 4, 6, P.table);
      one.rect(12, 11, 8, 6, '#fff'); one.rect(13, 12, 6, 4, '#ffd27f');
      return one.outline(P.outline);
    case O.TABLE_ROUND:
      one.ellipse(16, 14, 12, 7, P.tableTop); one.ellipse(16, 17, 12, 7, P.table); one.ellipse(16, 14, 12, 7, P.tableTop);
      one.rect(14, 20, 4, 8, P.table); one.rect(10, 27, 12, 2, P.table);
      one.rect(13, 11, 6, 5, '#fff'); one.rect(14, 12, 4, 3, '#6b3f1d');
      return one.outline(P.outline);
    case O.CHAIR:
      one.rect(8, 6, 16, 10, P.chair); one.rect(8, 16, 16, 7, shade(P.chair, 0.15)); one.rect(9, 23, 3, 5, P.chair); one.rect(20, 23, 3, 5, P.chair);
      one.rect(10, 8, 12, 6, shade(P.chair, -0.2));
      return one.outline(P.outline);
    case O.SOFA:
      one.rect(2, 8, 28, 18, P.sofa); one.rect(2, 8, 28, 6, P.sofaDark); one.rect(2, 14, 4, 12, P.sofaDark); one.rect(26, 14, 4, 12, P.sofaDark);
      one.rect(6, 16, 20, 8, shade(P.sofa, 0.12)); one.rect(4, 26, 24, 2, '#3a4b7a');
      return one.outline(P.outline);
    case O.COFFEE:
      one.rect(6, 4, 20, 26, P.coffee); one.rect(8, 6, 16, 6, P.coffeeLight); one.rect(10, 14, 12, 5, '#222');
      one.rect(13, 20, 6, 6, '#fff'); one.rect(14, 21, 4, 3, '#7a4a1e'); one.rect(9, 7, 4, 3, P.coffeeRed); one.px(22, 8, '#6f6');
      return one.outline(P.outline);
    case O.VENDING:
      tall.rect(4, 8, 24, 54, P.vending); tall.rect(6, 12, 20, 28, P.vendingGlass); tall.rect(8, 16, 4, 6, '#ff7'); tall.rect(14, 16, 4, 6, '#7ff'); tall.rect(20, 16, 4, 6, '#f7f');
      tall.rect(8, 26, 4, 6, '#7f7'); tall.rect(14, 26, 4, 6, '#fa7'); tall.rect(20, 26, 4, 6, '#77f');
      tall.rect(6, 44, 20, 8, P.vendingDark); tall.rect(8, 46, 16, 4, '#333');
      tall.rect(22, 12, 2, 20, P.vendingDark);
      return tall.outline(P.outline);
    case O.ARCADE:
      // 아케이드 캐비닛: 남색 몸통, 빨간 상단, 녹색 화면에 두더지 구멍 3개, 조이스틱과 버튼
      tall.rect(4, 6, 24, 56, '#1f2d6b'); tall.rect(4, 6, 24, 8, '#d1343b'); tall.rect(7, 8, 18, 4, '#ffd84d');
      tall.rect(7, 17, 18, 15, '#0b3d1f'); tall.rect(9, 19, 14, 11, '#2e9e4f');
      tall.rect(10, 26, 3, 2, '#3b2411'); tall.rect(15, 26, 3, 2, '#3b2411'); tall.rect(20, 26, 3, 2, '#3b2411'); tall.rect(15, 23, 3, 3, '#a26a3a');
      tall.rect(6, 35, 20, 7, '#2c3f8f'); tall.rect(9, 37, 3, 3, '#ff6b6b'); tall.rect(14, 37, 3, 3, '#ffd84d'); tall.rect(19, 36, 2, 5, '#222'); tall.rect(18, 34, 4, 3, '#ff6b6b');
      tall.rect(6, 46, 20, 12, '#15215a'); tall.rect(9, 50, 14, 3, '#0b1340');
      return tall.outline(P.outline);
    case O.BOOKSHELF:
      tall.rect(2, 4, 28, 58, P.shelf);
      for (let s = 0; s < 3; s++) {
        const y = 8 + s * 18;
        tall.rect(4, y, 24, 14, '#4a3321');
        let x = 5;
        while (x < 26) { const w = 2 + Math.floor(rnd() * 3); const c = [P.book1, P.book2, P.book3, P.book4][Math.floor(rnd() * 4)]; tall.rect(x, y + 2 + Math.floor(rnd() * 3), w, 12, c); x += w + 1; }
        tall.hline(2, y + 14, 28, shade(P.shelf, -0.25));
      }
      return tall.outline(P.outline);
    case O.COUNTER:
      one.rect(1, 6, 30, 22, P.counter); one.rect(1, 6, 30, 6, P.counterTop); one.rect(1, 11, 30, 1, shade(P.counterTop, -0.2));
      one.rect(6, 16, 6, 8, shade(P.counter, -0.2)); one.rect(20, 16, 6, 8, shade(P.counter, -0.2));
      return one.outline(P.outline);
    case O.BOARD_L:
    case O.BOARD_R: {
      const isL = id === O.BOARD_L;
      tall.rect(isL ? 2 : 0, 12, isL ? 30 : 30, 36, P.board);
      tall.rect(isL ? 5 : 0, 15, isL ? 27 : 27, 30, '#4b7a4b');
      const papers = isL ? [[7, 18, 10, 12], [19, 20, 9, 10], [9, 32, 12, 9]] : [[3, 17, 11, 10], [16, 19, 9, 13], [5, 31, 10, 10]];
      for (const [x, y, w, h] of papers) { tall.rect(x, y, w, h, P.boardPaper); tall.px(x + Math.floor(w / 2), y, P.boardPin); for (let l = 2; l < h - 1; l += 3) tall.hline(x + 1, y + l, w - 3, '#bbb'); }
      tall.rect(isL ? 6 : 24, 48, 4, 14, P.signDark);
      if (isL) tall.rect(2, 12, 30, 3, shade(P.board, 0.2)); else tall.rect(0, 12, 30, 3, shade(P.board, 0.2));
      return tall.outline(P.outline);
    }
    case O.LAMP:
      tall.rect(14, 20, 4, 40, P.lampPost); tall.rect(10, 58, 12, 4, P.lampPost);
      tall.rect(10, 8, 12, 12, P.lampGlow); tall.rect(8, 6, 16, 3, P.lampPost); tall.rect(12, 20, 8, 2, P.lampPost); tall.rect(12, 10, 4, 4, '#fff6c4');
      return tall.outline(P.outline);
    case O.SIGN:
      tall.rect(14, 40, 4, 22, P.signDark); tall.rect(4, 22, 24, 18, P.sign); tall.rect(6, 24, 20, 14, shade(P.sign, 0.25));
      tall.hline(8, 28, 16, P.signDark); tall.hline(8, 32, 12, P.signDark);
      return tall.outline(P.outline);
    case O.POT:
      one.rect(9, 14, 14, 14, P.pot); one.rect(7, 12, 18, 4, P.pot); one.rect(9, 24, 14, 4, P.potDark);
      one.circle(16, 9, 7, P.bush); one.circle(12, 7, 4, P.bushLight); one.px(19, 5, '#ff7eb3'); one.px(13, 11, '#ffd84d');
      return one.outline(P.outline);
    case O.PLANT:
      one.rect(11, 20, 10, 9, P.plantPot); one.rect(10, 19, 12, 2, shade(P.plantPot, 0.2));
      for (const [x, y] of [[16, 10], [10, 13], [22, 13], [13, 6], [20, 6]]) one.ellipse(x, y, 3, 5, P.plant);
      one.rect(15, 12, 2, 8, '#2f7a2f');
      return one.outline(P.outline);
    case O.ROCK:
      one.ellipse(16, 20, 11, 7, P.rock); one.ellipse(13, 17, 6, 4, shade(P.rock, 0.2)); one.ellipse(18, 23, 8, 3, P.rockDark);
      return one.outline(P.outline);
    // ---- 고급 가구 (2026-11-18) ----
    case O_FIREPLACE:
      // 벽난로: 벽돌 틀 안에서 불이 탄다
      one.rect(3, 4, 26, 25, '#a8503c'); one.rect(3, 4, 26, 3, '#7a3526'); one.rect(1, 2, 30, 3, '#d9c7a0');
      for (let y = 9; y < 28; y += 5) one.hline(3, y, 26, '#7a3526');
      one.rect(8, 12, 16, 15, '#241512'); one.rect(10, 20, 12, 7, '#ff7b2e'); one.rect(12, 17, 8, 9, '#ffb84d'); one.rect(14, 21, 4, 5, '#fff2a8'); one.px(11, 18, '#ff7b2e'); one.px(20, 17, '#ff7b2e');
      one.rect(8, 27, 16, 2, '#5a3a22');
      return one.outline(P.outline);
    case O_AQUARIUM:
      // 어항: 받침 위 유리 수조에 물고기 두 마리
      one.rect(4, 22, 24, 7, P.benchDark); one.rect(4, 22, 24, 2, P.benchWood);
      one.rect(4, 6, 24, 17, '#6fc3ec'); one.rect(4, 6, 24, 3, '#b9e6fb'); one.rect(4, 20, 24, 3, '#e8d9a0');
      one.rect(9, 12, 5, 3, '#ff8a3c'); one.px(8, 13, '#ff8a3c'); one.px(13, 13, '#222'); one.rect(18, 15, 5, 3, '#ffd84d'); one.px(23, 16, '#ffd84d'); one.px(19, 16, '#222');
      one.vline(24, 13, 7, '#3fa85c'); one.vline(7, 15, 5, '#3fa85c'); one.px(12, 9, '#ffffff'); one.px(20, 11, '#ffffff');
      one.vline(4, 6, 17, '#dff4ff'); one.vline(27, 6, 17, '#4b9cc9');
      return one.outline(P.outline);
    case O_PIANO:
      // 피아노: 검은 몸체, 흰 건반
      one.rect(3, 6, 26, 22, '#1c1c24'); one.rect(3, 6, 26, 3, '#3a3a4a'); one.rect(5, 10, 22, 6, '#2a2a36');
      one.rect(4, 17, 24, 6, '#f6f1e4'); for (let x = 6; x < 28; x += 3) one.vline(x, 17, 6, '#b9b2a0');
      for (const x of [5, 8, 14, 17, 20, 26]) one.rect(x, 17, 2, 4, '#1c1c24');
      one.rect(5, 26, 3, 3, '#1c1c24'); one.rect(24, 26, 3, 3, '#1c1c24'); one.rect(13, 11, 6, 3, '#e8c15a');
      return one.outline(P.outline);
    case O_TV:
      // 텔레비전: 낮은 장 위의 화면
      one.rect(5, 22, 22, 7, P.benchDark); one.rect(5, 22, 22, 2, P.benchWood); one.rect(13, 19, 6, 3, '#333');
      one.rect(3, 5, 26, 15, '#22222a'); one.rect(5, 7, 22, 11, '#3d7bd9'); one.rect(5, 7, 22, 4, '#7fb7f2'); one.rect(8, 13, 6, 5, '#5fc45f'); one.rect(18, 11, 5, 7, '#ffd84d'); one.px(25, 18, '#e74c3c');
      return one.outline(P.outline);
    case O_GOLD_VASE:
      // 황금 화분: 금빛 항아리에 붉은 꽃
      one.circle(12, 8, 3, '#e74c3c'); one.circle(19, 6, 3, '#ff7eb3'); one.circle(16, 10, 3, '#ffd84d'); one.vline(15, 11, 5, '#3e9b3e'); one.vline(12, 10, 5, '#3e9b3e'); one.vline(19, 9, 6, '#3e9b3e');
      one.rect(10, 14, 12, 3, '#fff2a8'); one.rect(8, 17, 16, 10, '#ffd84d'); one.rect(10, 27, 12, 2, '#c9952a'); one.rect(8, 17, 3, 10, '#fff2a8'); one.rect(21, 17, 3, 10, '#c9952a'); one.rect(13, 20, 6, 3, '#c9952a');
      return one.outline(P.outline);
    case O_GOLD_STATUE:
      // 황금 동상: 받침 위에 물고기를 든 낚시꾼 (두 칸 높이)
      tall.rect(6, 52, 20, 9, '#8a8a8a'); tall.rect(6, 52, 20, 2, '#b5b5b5'); tall.rect(4, 59, 24, 3, '#6b6b6b');
      tall.rect(12, 34, 8, 18, '#ffd84d'); tall.rect(11, 44, 4, 8, '#ffd84d'); tall.rect(17, 44, 4, 8, '#ffd84d'); tall.circle(16, 27, 6, '#ffd84d');
      tall.rect(20, 34, 3, 8, '#ffd84d'); tall.rect(22, 20, 2, 15, '#c9952a'); tall.rect(9, 36, 3, 9, '#ffd84d');
      tall.rect(18, 14, 8, 5, '#fff2a8'); tall.px(17, 16, '#fff2a8'); tall.px(26, 14, '#fff2a8'); tall.px(26, 18, '#fff2a8'); tall.px(20, 15, '#c9952a');
      tall.rect(12, 34, 2, 18, '#fff2a8'); tall.rect(18, 36, 2, 16, '#c9952a'); tall.px(14, 26, '#c9952a'); tall.px(18, 26, '#c9952a');
      return tall.outline(P.outline);
    case O_SPEAKER:
      // 스피커 (클럽): 검은 통에 큰 울림판 둘
      tall.rect(5, 10, 22, 52, '#17171d'); tall.rect(5, 10, 22, 3, '#2c2c38'); tall.rect(5, 10, 2, 52, '#2c2c38');
      tall.circle(16, 24, 7, '#33333f'); tall.circle(16, 24, 4, '#0c0c10'); tall.circle(16, 24, 1, '#55556a');
      tall.circle(16, 46, 9, '#33333f'); tall.circle(16, 46, 6, '#0c0c10'); tall.circle(16, 46, 2, '#55556a');
      tall.px(8, 14, '#ff5ce1'); tall.px(24, 14, '#5cf2ff');
      return tall.outline(P.outline);
    case O_DJ:
      // 디제이 탁자 (클럽): 턴테이블 둘과 불빛
      one.rect(1, 10, 30, 19, '#2a2238'); one.rect(1, 10, 30, 3, '#463a5e'); one.rect(1, 26, 30, 3, '#1a1524');
      one.circle(9, 9, 6, '#111118'); one.circle(9, 9, 2, '#ff5ce1'); one.circle(23, 9, 6, '#111118'); one.circle(23, 9, 2, '#5cf2ff');
      for (let x = 4; x < 28; x += 4) one.rect(x, 17, 2, 5, ['#ff5ce1', '#5cf2ff', '#ffd84d', '#8fd45a'][(x / 4) % 4]);
      return one.outline(P.outline);
    case O_BED:
      // 침대 (집 안): 나무 틀, 흰 베개, 붉은 이불
      one.rect(3, 5, 26, 24, P.benchDark); one.rect(5, 7, 22, 20, '#f4ead2'); one.rect(8, 8, 16, 6, '#ffffff'); one.rect(8, 13, 16, 1, '#d8d0bc');
      one.rect(5, 16, 22, 11, '#d9655a'); one.rect(5, 16, 22, 2, '#f0a59c'); one.rect(5, 24, 22, 3, '#b84d44');
      return one.outline(P.outline);
    case O_CHEST:
      // 창고 상자 (집 안): 물고기 꼬리가 삐져나온 나무 궤짝
      one.rect(10, 6, 5, 6, '#7fb7e6'); one.rect(8, 4, 3, 4, '#5a9bd4'); one.rect(13, 4, 3, 4, '#5a9bd4'); one.rect(18, 8, 4, 4, '#f2a35e');
      one.rect(4, 11, 24, 17, P.benchWood); one.rect(4, 11, 24, 4, P.benchDark); one.rect(4, 20, 24, 2, P.benchDark); one.rect(4, 26, 24, 2, P.benchDark);
      one.rect(14, 15, 4, 6, '#e8c15a'); one.px(15, 18, '#8a6a1e'); one.px(16, 18, '#8a6a1e');
      return one.outline(P.outline);
    case O.STUMP:
      one.ellipse(16, 14, 11, 6, P.stumpRing); one.rect(5, 14, 22, 10, P.stump); one.ellipse(16, 24, 11, 4, P.stumpDark); one.ellipse(16, 14, 11, 6, P.stumpRing);
      one.ellipse(16, 14, 7, 3, P.stump); one.ellipse(16, 14, 3, 1, P.stumpRing);
      return one.outline(P.outline);
    case O.FOUNTAIN_TL: case O.FOUNTAIN_TR: case O.FOUNTAIN_BL: case O.FOUNTAIN_BR: {
      const b = new PixelBuf(64, 64);
      b.circle(32, 32, 30, P.fountain); b.circle(32, 32, 25, P.fountainDark); b.circle(32, 32, 22, P.water);
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; b.px(32 + Math.cos(a) * 15, 32 + Math.sin(a) * 15, P.waterLight); }
      b.circle(32, 32, 7, P.fountain); b.circle(32, 32, 4, P.fountainDark); b.rect(30, 14, 4, 18, P.fountain); b.circle(32, 12, 5, P.waterLight); b.px(28, 10, '#fff'); b.px(36, 11, '#fff');
      const ob = b.outline(P.outline);
      const ox = id === O.FOUNTAIN_TR || id === O.FOUNTAIN_BR ? 32 : 0;
      const oy = id === O.FOUNTAIN_BL || id === O.FOUNTAIN_BR ? 32 : 0;
      const q = new PixelBuf(TILE, TILE);
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) q.data[y * TILE + x] = ob.data[(oy + y) * 64 + ox + x];
      return q;
    }
    case O.MAT:
      one.rect(2, 8, 28, 18, P.mat); one.rect(4, 10, 24, 14, shade(P.mat, 0.25)); one.rect(10, 14, 12, 6, P.mat);
      return one;
    case O.FLOWERBED:
      one.rect(1, 4, 30, 26, '#6b4a2b'); one.rect(3, 6, 26, 22, '#8a5f3a');
      for (let i = 0; i < 9; i++) { const x = 5 + (i % 3) * 9, y = 8 + Math.floor(i / 3) * 7; const c = [P.flower1, P.flower2, P.flower3, '#b57bee'][i % 4]; one.px(x, y - 1, c); one.px(x - 1, y, c); one.px(x + 1, y, c); one.px(x, y + 1, c); one.px(x, y, '#ffe9a8'); one.px(x, y + 2, '#2f7a2f'); }
      return one.outline(P.outline);
    case O.UMBRELLA:
      for (let j = 0; j < 14; j++) { const w = 4 + j * 2; tall.hline(16 - w / 2, 6 + j, w, j % 4 < 2 ? P.umbrella1 : P.umbrella2); }
      tall.rect(15, 20, 2, 42, P.metal); tall.rect(14, 4, 4, 3, P.metal);
      return tall.outline(P.outline);
    default:
      return null;
  }
}

export const DECOR_IDS_GROUND = Object.values(G);
export const DECOR_IDS_OBJECT = Object.values(O).filter((v) => v !== 0);
