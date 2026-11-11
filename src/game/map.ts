import { mulberry32 } from '../shared/hash';
import { MAIN_MAP_ID, GARDEN_MAP_ID, GOLD_MINE_MAP_ID, isMapId } from '../shared/maps';

// 바닥 타일
export const G = {
  GRASS: 0, PATH: 1, WATER: 2, FLOWER: 3, WOOD: 4, TILE_FLOOR: 5, PLAZA: 6, SAND: 7, CARPET: 8, DARK_FLOOR: 9, GRASS2: 10, PATH2: 11,
} as const;

// 금광 맵의 거대한 금덩어리가 놓인 칸: 지나갈 수 없고, 옆 칸에서 캔다 (mine.ts). 금광 맵 빌더만 쓰므로 관리자 편집기 팔레트(G 의 값들)에는 넣지 않는다
export const G_GOLD = 12;

// 오브젝트 (0 = 없음)
export const O = {
  NONE: 0, TREE: 1, WALL: 2, FENCE: 3, BENCH: 4, TABLE: 5, CHAIR: 6, COFFEE: 7, BOARD_L: 8, BOARD_R: 9, LAMP: 10, BUSH: 11, POT: 12, ROCK: 13,
  FOUNTAIN_TL: 14, FOUNTAIN_TR: 15, FOUNTAIN_BL: 16, FOUNTAIN_BR: 17, SIGN: 18, WALL_WINDOW: 19, MAT: 20, BOOKSHELF: 21, SOFA: 22, VENDING: 23,
  FLOWERBED: 24, HEDGE: 25, PINE: 26, COUNTER: 27, STUMP: 28, WALL_SIDE: 29, TABLE_ROUND: 30, PLANT: 31, UMBRELLA: 32, ARCADE: 33,
} as const;

export const GROUND_NAMES: Record<number, string> = {
  0: '잔디', 1: '길', 2: '물', 3: '꽃밭', 4: '나무 바닥', 5: '타일 바닥', 6: '광장 돌', 7: '모래', 8: '카펫', 9: '어두운 바닥', 10: '진한 잔디', 11: '자갈길',
};
export const OBJECT_NAMES: Record<number, string> = {
  0: '지우기', 1: '나무', 2: '벽', 3: '울타리', 4: '벤치', 5: '테이블', 6: '의자', 7: '커피머신', 8: '게시판(좌)', 9: '게시판(우)', 10: '가로등', 11: '덤불', 12: '화분', 13: '바위',
  14: '분수(좌상)', 15: '분수(우상)', 16: '분수(좌하)', 17: '분수(우하)', 18: '표지판', 19: '창문 벽', 20: '출입 매트', 21: '책장', 22: '소파', 23: '자판기',
  24: '화단', 25: '생울타리', 26: '소나무', 27: '카운터', 28: '그루터기', 29: '옆 벽', 30: '원탁', 31: '화초', 32: '파라솔', 33: '오락기',
};

export const WALKABLE_OBJECTS = new Set<number>([O.NONE, O.MAT]);
// 들어갈 수 없는 바닥. 물은 수영으로 들어갈 수 있으므로 현재 비어 있음
export const SOLID_GROUND = new Set<number>([G_GOLD]);
// 2타일 높이로 그려지는 오브젝트 (아랫칸 기준, 윗칸을 덮음)
export const TALL_OBJECTS = new Set<number>([O.TREE, O.PINE, O.LAMP, O.SIGN, O.BOARD_L, O.BOARD_R, O.BOOKSHELF, O.VENDING, O.UMBRELLA, O.ARCADE]);

export interface Zone {
  id: string;
  kind: 'room' | 'casino' | 'board' | 'label' | 'fish' | 'arcade' | 'portal' | 'mine'; // mine: 거대한 금덩어리(금광 맵에만. 그림 한 장으로 그린다), room: 커피 내기 방, casino: 카지노(정원 있음, 방처럼 입장), fish: 낚시 기록 표지판, arcade: 두더지 잡기 오락기 (옆에서 F), portal: 다른 맵으로 이동
  x: number; y: number; w: number; h: number;
  cap?: number;
  door?: { x: number; y: number };
  exit?: { x: number; y: number };
  label?: string;
  targetMap?: string;                       // 포탈(옛 형식): 목적지 하나
  targetSpawn?: { x: number; y: number };
  targets?: PortalDest[];                   // 포탈: 행선지 목록. 2개 이상이면 F 를 눌렀을 때 고르는 창이 뜬다 (2026-11-11)
}
// 포탈 행선지 하나. spawn 이 없으면 그 맵의 시작 자리, label·desc 가 없으면 맵 기본 이름·설명 (portal.ts MAP_INFO)
export interface PortalDest { map: string; spawn?: { x: number; y: number }; label?: string; desc?: string }
export const PORTAL_MAX_DESTS = 6;
// 포탈의 행선지 목록. 옛 형식(targetMap 하나)은 1개짜리로 읽는다: 이미 저장된 맵을 고치지 않아도 된다
export function portalDests(z: { targets?: PortalDest[] | null; targetMap?: string; targetSpawn?: { x: number; y: number } | null }): PortalDest[] {
  if (Array.isArray(z.targets) && z.targets.length) return z.targets;
  return z.targetMap ? [{ map: z.targetMap, ...(z.targetSpawn ? { spawn: z.targetSpawn } : {}) }] : [];
}
function validPortalDest(d: unknown): boolean {
  if (!d || typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  if (!isMapId(o.map)) return false;
  if (o.spawn !== undefined && o.spawn !== null) {
    if (typeof o.spawn !== 'object') return false;
    const s = o.spawn as Record<string, unknown>;
    if (!Number.isInteger(s.x) || !Number.isInteger(s.y)) return false;
  }
  if (o.label !== undefined && typeof o.label !== 'string') return false;
  if (o.desc !== undefined && typeof o.desc !== 'string') return false;
  return true;
}

export const RESERVED_MAP_IDS = [MAIN_MAP_ID, 'default', GARDEN_MAP_ID, GOLD_MINE_MAP_ID] as const;

export function isReservedMapId(id: string): boolean {
  return (RESERVED_MAP_IDS as readonly string[]).includes(id);
}

export function validatePortalZone(z: unknown): z is Zone {
  if (!z || typeof z !== 'object') return false;
  const zone = z as Record<string, unknown>;
  if (zone.kind !== 'portal') return false;
  if (typeof zone.id !== 'string' || !zone.id.trim()) return false;
  if (!Number.isInteger(zone.x) || !Number.isInteger(zone.y)) return false;
  if (!Number.isInteger(zone.w) || (zone.w as number) <= 0) return false;
  if (!Number.isInteger(zone.h) || (zone.h as number) <= 0) return false;
  // 행선지: 목록(targets, 1~6개)이 있으면 그것을, 없으면 옛 형식 targetMap 하나를 본다
  if (zone.targets !== undefined && zone.targets !== null) {
    if (!Array.isArray(zone.targets) || zone.targets.length < 1 || zone.targets.length > PORTAL_MAX_DESTS || !zone.targets.every(validPortalDest)) return false;
    if (zone.targetMap !== undefined && !isMapId(zone.targetMap)) return false;
  } else if (typeof zone.targetMap !== 'string' || !isMapId(zone.targetMap)) return false;
  if (zone.targetSpawn !== undefined && zone.targetSpawn !== null) {
    if (typeof zone.targetSpawn !== 'object') return false;
    const ts = zone.targetSpawn as Record<string, unknown>;
    if (!Number.isInteger(ts.x) || !Number.isInteger(ts.y)) return false;
  }
  if (zone.label !== undefined && typeof zone.label !== 'string') return false;
  return true;
}

export function validateZone(z: unknown): z is Zone {
  if (!z || typeof z !== 'object') return false;
  const zone = z as Record<string, unknown>;
  if (typeof zone.id !== 'string' || !zone.id.trim()) return false;
  if (!Number.isInteger(zone.x) || !Number.isInteger(zone.y)) return false;
  if (!Number.isInteger(zone.w) || (zone.w as number) <= 0) return false;
  if (!Number.isInteger(zone.h) || (zone.h as number) <= 0) return false;
  if (zone.kind === 'portal') return validatePortalZone(z);
  const validKinds = new Set(['room', 'casino', 'board', 'label', 'fish', 'arcade']);
  if (typeof zone.kind !== 'string' || !validKinds.has(zone.kind)) return false;
  return true;
}

export interface MapData {
  id: string;
  name: string;
  w: number;
  h: number;
  ground: number[];
  objects: number[];
  zones: Zone[];
  spawn: { x: number; y: number };
  version?: number;
  updatedAt?: number;
}

export function inBounds(m: MapData, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < m.w && y < m.h;
}
export function groundAt(m: MapData, x: number, y: number): number { return inBounds(m, x, y) ? m.ground[y * m.w + x] : G.WATER; }
export function objectAt(m: MapData, x: number, y: number): number { return inBounds(m, x, y) ? m.objects[y * m.w + x] : O.WALL; }
export function isWater(m: MapData, x: number, y: number): boolean { return inBounds(m, x, y) && m.ground[y * m.w + x] === G.WATER; }
// 보간된(소수) 타일 좌표에서 물에 잠긴 정도 0..1. 물가를 드나들 때 부드럽게 가라앉고 떠오르도록 이웃 타일과 섞는다
export function waterDepth(m: MapData, fx: number, fy: number): number {
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const w = (x: number, y: number) => (isWater(m, x, y) ? 1 : 0);
  const top = w(x0, y0) * (1 - tx) + w(x0 + 1, y0) * tx;
  const bottom = w(x0, y0 + 1) * (1 - tx) + w(x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

export function isWalkable(m: MapData, x: number, y: number): boolean {
  if (!inBounds(m, x, y)) return false;
  if (SOLID_GROUND.has(m.ground[y * m.w + x])) return false;
  return WALKABLE_OBJECTS.has(m.objects[y * m.w + x]);
}

// 정원이 있는 방(커피 내기 방·카지노) 중 (x,y)를 품은 것
export function roomAt(m: MapData, x: number, y: number): Zone | undefined {
  return m.zones.find((z) => (z.kind === 'room' || z.kind === 'casino') && x >= z.x && y >= z.y && x < z.x + z.w && y < z.y + z.h);
}
export function zoneContains(z: Zone, x: number, y: number): boolean {
  return x >= z.x && y >= z.y && x < z.x + z.w && y < z.y + z.h;
}
export function nearZone(z: Zone, x: number, y: number, dist = 1): boolean {
  return x >= z.x - dist && y >= z.y - dist && x < z.x + z.w + dist && y < z.y + z.h + dist;
}
export function portalNear(m: MapData, x: number, y: number): Zone | undefined {
  const near = m.zones.filter((z) => z.kind === 'portal' && nearZone(z, x, y));
  if (near.length === 0) return undefined;
  return near.find((z) => zoneContains(z, x, y)) || near[0];
}
export function labelAt(m: MapData, x: number, y: number): string | undefined {
  return m.zones.find((z) => z.kind === 'label' && zoneContains(z, x, y))?.label;
}

// 가까운 빈 타일 찾기 (BFS). 물은 건너뛴다: 스폰이나 순간이동으로 물속에 떨어지지 않도록
export function findFreeTile(m: MapData, sx: number, sy: number, occupied: (x: number, y: number) => boolean, avoidRooms = true): { x: number; y: number } {
  const seen = new Set<string>();
  const q: [number, number][] = [[sx, sy]];
  seen.add(`${sx},${sy}`);
  while (q.length) {
    const [x, y] = q.shift()!;
    if (isWalkable(m, x, y) && !isWater(m, x, y) && !occupied(x, y) && !(avoidRooms && roomAt(m, x, y))) return { x, y };
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (!seen.has(k) && inBounds(m, nx, ny) && seen.size < 4000) { seen.add(k); q.push([nx, ny]); }
    }
  }
  return { x: sx, y: sy };
}

export function emptyMap(id: string, name: string, w: number, h: number): MapData {
  return { id, name, w, h, ground: new Array(w * h).fill(G.GRASS), objects: new Array(w * h).fill(0), zones: [], spawn: { x: Math.floor(w / 2), y: Math.floor(h / 2) }, version: 1 };
}

// 방 크기(내부 가로x세로) : 정원 2..10명
export const ROOM_SIZES: Record<number, [number, number]> = {
  2: [2, 2], 3: [3, 2], 4: [3, 2], 5: [3, 2], 6: [3, 3], 7: [4, 2], 8: [4, 2], 9: [4, 3], 10: [4, 3],
};

// 커피 거리의 건물 두 채와 장식. 기본 맵 생성과, 관리자 편집본 맵에 같은 거리를 덧씌우는 데(tools) 같이 쓴다.
// 건물은 y 5~9(문은 9번 줄 매트), 길은 y 10~11. 커피 내기 10인실 x 18~23, 카지노 x 34~41
export const COFFEE_STREET_ROWS: [number, number] = [3, 11]; // 덧씌울 때 다시 그리는 줄 범위 (포함)
export function buildCoffeeStreet(m: MapData, setO: (x: number, y: number, id: number) => void, building: (x: number, y: number, w: number, h: number, doorX: number, floor: number) => void): void {
  const [iw, ih] = ROOM_SIZES[10];
  {
    const bw = iw + 2, bh = ih + 2, cx = 18, top = 10 - bh, doorX = cx + Math.floor(bw / 2);
    building(cx, top, bw, bh, doorX, G.TILE_FLOOR);
    m.zones.push({ id: 'room10', kind: 'room', x: cx + 1, y: top + 1, w: iw, h: ih + 1, cap: 10, door: { x: doorX, y: 9 }, exit: { x: doorX, y: 10 }, label: '☕ 커피 내기' });
  }
  {
    const cw = 6, ch = 3, bw = cw + 2, bh = ch + 2, cx = 34, top = 10 - bh, doorX = cx + Math.floor(bw / 2);
    building(cx, top, bw, bh, doorX, G.CARPET);
    m.zones.push({ id: 'casino', kind: 'casino', x: cx + 1, y: top + 1, w: cw, h: ch + 1, cap: 10, door: { x: doorX, y: 9 }, exit: { x: doorX, y: 10 }, label: '🎰 카지노' });
  }
  // 거리 장식 (건물 x 18~23, 34~41 은 피한다)
  for (const x of [3, 11, 27, 46, 55]) setO(x, 9, O.LAMP);
  for (const x of [6, 14, 30, 49, 52]) setO(x, 9, O.BENCH);
  for (const x of [8, 16, 25, 32, 43, 57]) setO(x, 9, O.POT);
  for (const x of [5, 13, 44, 54]) setO(x, 7, O.TREE);
  for (const x of [9, 28, 50]) setO(x, 6, O.BUSH);
}

export function buildDefaultMap(): MapData {
  const W = 60, H = 40;
  const m = emptyMap('default', 'MawaVerse 기본 맵', W, H);
  const rnd = mulberry32(534001398); // 기본 맵 꾸밈의 난수 씨앗 (맵 모양이 바뀌지 않게 고정된 값)
  const setG = (x: number, y: number, id: number) => { if (inBounds(m, x, y)) m.ground[y * W + x] = id; };
  const setO = (x: number, y: number, id: number) => { if (inBounds(m, x, y)) m.objects[y * W + x] = id; };
  const fillG = (x: number, y: number, w: number, h: number, id: number) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) setG(x + i, y + j, id); };
  const getO = (x: number, y: number) => objectAt(m, x, y);
  const getG = (x: number, y: number) => groundAt(m, x, y);

  // 잔디 변화 + 꽃
  for (let i = 0; i < W * H; i++) {
    const r = rnd();
    if (r < 0.12) m.ground[i] = G.GRASS2;
    else if (r < 0.16) m.ground[i] = G.FLOWER;
  }
  // 테두리 나무
  for (let x = 0; x < W; x++) { setO(x, 0, rnd() < 0.5 ? O.TREE : O.PINE); setO(x, H - 1, rnd() < 0.5 ? O.TREE : O.PINE); }
  for (let y = 0; y < H; y++) { setO(0, y, rnd() < 0.5 ? O.TREE : O.PINE); setO(W - 1, y, rnd() < 0.5 ? O.TREE : O.PINE); }

  // 건물 생성 도우미: 외곽 벽 + 내부 바닥 + 문(아래쪽 벽)
  const building = (x: number, y: number, w: number, h: number, doorX: number, floor: number, side: 'bottom' | 'right' | 'left' = 'bottom') => {
    fillG(x, y, w, h, floor);
    for (let i = 0; i < w; i++) { setO(x + i, y, O.WALL); setO(x + i, y + h - 1, O.WALL); }
    for (let j = 1; j < h - 1; j++) { setO(x, y + j, O.WALL_SIDE); setO(x + w - 1, y + j, O.WALL_SIDE); }
    if (side === 'bottom') { setO(doorX, y + h - 1, O.MAT); setG(doorX, y + h - 1, floor); }
    else if (side === 'right') { setO(x + w - 1, doorX, O.MAT); setG(x + w - 1, doorX, floor); }
    else { setO(x, doorX, O.MAT); setG(x, doorX, floor); }
    // 창문
    for (let i = 2; i < w - 2; i += 3) if (getO(x + i, y) === O.WALL) setO(x + i, y, O.WALL_WINDOW);
  };

  // ---- 중앙 광장 ----
  fillG(20, 14, 20, 13, G.PLAZA);
  setO(29, 17, O.BOARD_L); setO(30, 17, O.BOARD_R);
  m.zones.push({ id: 'board', kind: 'board', x: 29, y: 17, w: 2, h: 1, label: '게시판' });
  setO(29, 22, O.FOUNTAIN_TL); setO(30, 22, O.FOUNTAIN_TR); setO(29, 23, O.FOUNTAIN_BL); setO(30, 23, O.FOUNTAIN_BR);
  for (const [x, y] of [[21, 15], [38, 15], [21, 25], [38, 25]]) setO(x, y, O.LAMP);
  for (const [x, y] of [[24, 19], [35, 19], [24, 24], [35, 24]]) setO(x, y, O.BENCH);
  for (const [x, y] of [[23, 15], [36, 15], [23, 26], [36, 26]]) setO(x, y, O.PLANT);
  m.zones.push({ id: 'lbl-plaza', kind: 'label', x: 20, y: 14, w: 20, h: 13, label: '중앙 광장' });

  // ---- 커피 거리 (북쪽): ☕ 커피 내기 10인실 하나 + 🎰 카지노 (2026-11-09: 2~9인실은 수요가 없어 없앴다) ----
  fillG(1, 10, 58, 2, G.PATH);
  fillG(29, 12, 2, 2, G.PATH);
  buildCoffeeStreet(m, setO, building);
  m.zones.push({ id: 'lbl-coffee', kind: 'label', x: 1, y: 3, w: 58, h: 9, label: '커피 거리' });

  // ---- 라운지 (서쪽) ----
  building(3, 15, 14, 12, 20, G.WOOD, 'right');
  fillG(17, 20, 3, 1, G.PATH);
  fillG(8, 19, 4, 5, G.CARPET);
  setO(4, 16, O.VENDING); setO(5, 16, O.COFFEE); setO(6, 16, O.COUNTER);
  setO(8, 16, O.SOFA); setO(9, 16, O.SOFA); setO(11, 16, O.SOFA); setO(12, 16, O.SOFA);
  setO(14, 16, O.BOOKSHELF); setO(15, 16, O.BOOKSHELF);
  setO(7, 21, O.TABLE_ROUND); setO(6, 21, O.CHAIR); setO(8, 21, O.CHAIR);
  setO(12, 21, O.TABLE_ROUND); setO(11, 21, O.CHAIR); setO(13, 21, O.CHAIR);
  setO(4, 25, O.PLANT); setO(15, 25, O.PLANT); setO(4, 20, O.POT); setO(15, 23, O.POT);
  m.zones.push({ id: 'lbl-lounge', kind: 'label', x: 3, y: 15, w: 14, h: 12, label: '라운지' });
  setO(18, 19, O.SIGN);

  // ---- 공원 (동쪽) ----
  fillG(40, 20, 5, 1, G.PATH);
  fillG(44, 16, 1, 10, G.PATH2); fillG(53, 16, 1, 10, G.PATH2);
  fillG(44, 16, 10, 1, G.PATH2); fillG(44, 25, 10, 1, G.PATH2);
  fillG(45, 17, 8, 8, G.GRASS);
  fillG(46, 18, 6, 5, G.WATER);
  fillG(45, 17, 8, 1, G.SAND); fillG(45, 23, 8, 2, G.SAND); fillG(45, 18, 1, 5, G.SAND); fillG(52, 18, 1, 5, G.SAND);
  setO(45, 17, O.ROCK); setO(52, 17, O.ROCK); setO(45, 24, O.ROCK); setO(52, 24, O.ROCK);
  setO(46, 24, O.BENCH); setO(51, 24, O.BENCH);
  for (let i = 0; i < 26; i++) {
    const x = 41 + Math.floor(rnd() * 17), y = 13 + Math.floor(rnd() * 24);
    if (getO(x, y) === 0 && getG(x, y) !== G.PATH && getG(x, y) !== G.PATH2 && getG(x, y) !== G.WATER && getG(x, y) !== G.SAND && !(x >= 44 && x <= 53 && y >= 16 && y <= 25))
      setO(x, y, rnd() < 0.5 ? O.TREE : rnd() < 0.5 ? O.PINE : O.BUSH);
  }
  for (const [x, y] of [[42, 14], [56, 14], [42, 30], [56, 30]]) setO(x, y, O.FLOWERBED);
  for (const [x, y] of [[48, 28], [50, 28]]) setO(x, y, O.STUMP);
  setO(43, 20, O.LAMP); setO(54, 20, O.LAMP);
  // 낚시 기록 표지판 (연못 서쪽 모래밭)
  setO(45, 20, O.SIGN);
  m.zones.push({ id: 'fishsign', kind: 'fish', x: 45, y: 20, w: 1, h: 1, label: '낚시 기록' });
  // 광장 오른쪽 위 구석의 두더지 잡기 오락기
  for (const [ax, ay] of [[38, 15], [37, 15], [38, 16], [21, 15]]) {
    if (m.objects[ay * m.w + ax] === O.NONE) { setO(ax, ay, O.ARCADE); m.zones.push({ id: 'arcade', kind: 'arcade', x: ax, y: ay, w: 1, h: 1, label: '두더지 잡기' }); break; }
  }
  m.zones.push({ id: 'lbl-park', kind: 'label', x: 40, y: 13, w: 19, h: 25, label: '공원' });

  // ---- 정원 / 야외 카페 (남쪽) ----
  fillG(29, 27, 2, 3, G.PATH);
  for (let x = 20; x < 40; x++) if (x < 29 || x > 30) setO(x, 29, O.HEDGE);
  fillG(20, 30, 20, 8, G.GRASS);
  fillG(29, 30, 2, 7, G.PATH);
  setO(24, 32, O.TABLE_ROUND); setO(23, 32, O.CHAIR); setO(25, 32, O.CHAIR); setO(24, 31, O.UMBRELLA);
  setO(35, 32, O.TABLE_ROUND); setO(34, 32, O.CHAIR); setO(36, 32, O.CHAIR); setO(35, 31, O.UMBRELLA);
  setO(26, 35, O.BENCH); setO(33, 35, O.BENCH);
  for (let x = 21; x < 39; x += 2) if (x < 28 || x > 31) setO(x, 37, O.FLOWERBED);
  setO(21, 31, O.LAMP); setO(38, 31, O.LAMP);
  for (let y = 30; y < 38; y++) { setO(19, y, O.FENCE); setO(40, y, O.FENCE); }
  m.zones.push({ id: 'lbl-garden', kind: 'label', x: 20, y: 29, w: 20, h: 9, label: '정원' });
  m.zones.push({
    id: 'portal-garden',
    kind: 'portal',
    x: 29,
    y: 36,
    w: 2,
    h: 1,
    label: '포탈 정원 · 공사 중 (출입 금지)',
    targets: [{ map: GARDEN_MAP_ID, spawn: { x: 12, y: 13 } }, { map: GOLD_MINE_MAP_ID }],
  });
  // 상호작용 거리(1칸) 밖까지 둘러야 펜스 너머에서 F로 진입하지 못한다.
  for (let x = 27; x <= 32; x++) { setO(x, 34, O.FENCE); setO(x, 38, O.FENCE); }
  for (let y = 35; y <= 37; y++) { setO(27, y, O.FENCE); setO(32, y, O.FENCE); }

  // 빈 구역에 나무/덤불 조금
  for (let i = 0; i < 40; i++) {
    const x = 1 + Math.floor(rnd() * (W - 2)), y = 1 + Math.floor(rnd() * (H - 2));
    const inPlaza = x >= 19 && x <= 40 && y >= 13 && y <= 29;
    const inStreet = y >= 3 && y <= 12;
    const inLounge = x >= 2 && x <= 20 && y >= 14 && y <= 28;
    const inPark = x >= 40;
    const inGarden = x >= 19 && x <= 40 && y >= 29;
    if (!inPlaza && !inStreet && !inLounge && !inPark && !inGarden && getO(x, y) === 0) setO(x, y, rnd() < 0.6 ? O.TREE : O.BUSH);
  }
  // 광장 밖 산책로
  fillG(29, 27, 2, 1, G.PATH);
  m.spawn = { x: 30, y: 28 };
  return m;
}

export function buildPortalGarden(): MapData {
  const W = 24, H = 20;
  const m = emptyMap(GARDEN_MAP_ID, '포탈 정원', W, H);
  const rnd = mulberry32(734001289);
  const setG = (x: number, y: number, id: number) => { if (inBounds(m, x, y)) m.ground[y * W + x] = id; };
  const setO = (x: number, y: number, id: number) => { if (inBounds(m, x, y)) m.objects[y * W + x] = id; };
  const fillG = (x: number, y: number, w: number, h: number, id: number) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) setG(x + i, y + j, id); };

  // 잔디 변화 + 꽃
  for (let i = 0; i < W * H; i++) {
    const r = rnd();
    if (r < 0.15) m.ground[i] = G.GRASS2;
    else if (r < 0.22) m.ground[i] = G.FLOWER;
  }
  // 테두리 나무/소나무
  for (let x = 0; x < W; x++) { setO(x, 0, rnd() < 0.5 ? O.TREE : O.PINE); setO(x, H - 1, rnd() < 0.5 ? O.TREE : O.PINE); }
  for (let y = 0; y < H; y++) { setO(0, y, rnd() < 0.5 ? O.TREE : O.PINE); setO(W - 1, y, rnd() < 0.5 ? O.TREE : O.PINE); }

  // 중앙 산책로 (돌길)
  fillG(11, 2, 2, 16, G.PLAZA);
  fillG(4, 9, 16, 2, G.PATH);

  // 연못 (북동쪽)
  fillG(14, 4, 7, 5, G.WATER);
  fillG(13, 3, 9, 1, G.SAND); fillG(13, 9, 9, 1, G.SAND);
  fillG(13, 4, 1, 5, G.SAND); fillG(21, 4, 1, 5, G.SAND);
  setO(14, 3, O.ROCK); setO(20, 3, O.ROCK); setO(14, 9, O.ROCK); setO(20, 9, O.ROCK);
  setO(17, 3, O.BENCH);

  // 정원 화단 및 쉼터 (서쪽)
  setO(3, 3, O.FLOWERBED); setO(7, 3, O.FLOWERBED);
  setO(3, 7, O.FLOWERBED); setO(7, 7, O.FLOWERBED);
  setO(5, 5, O.TABLE_ROUND); setO(4, 5, O.CHAIR); setO(6, 5, O.CHAIR); setO(5, 4, O.UMBRELLA);
  setO(3, 12, O.BENCH); setO(7, 12, O.BENCH);
  setO(5, 14, O.POT);

  // 가로등
  setO(9, 3, O.LAMP); setO(9, 15, O.LAMP); setO(14, 15, O.LAMP);

  // 남쪽 포탈 광장
  fillG(10, 14, 4, 3, G.PATH2);
  fillG(11, 15, 2, 1, G.PLAZA);

  // 라벨 구역
  m.zones.push({ id: 'lbl-garden', kind: 'label', x: 1, y: 1, w: 22, h: 18, label: '포탈 정원' });

  // 복귀 포탈: targetMap 은 'main' (MAIN_MAP_ID), targetSpawn 없음 => main spawn 으로 이동
  m.zones.push({
    id: 'portal-main',
    kind: 'portal',
    x: 11,
    y: 15,
    w: 2,
    h: 1,
    label: '메인 광장',
    targetMap: MAIN_MAP_ID,
  });

  // 스폰 위치: 포탈 앞 안전한 타일 (12, 13)
  m.spawn = { x: 12, y: 13 };
  return m;
}

// 금광 (2026-11-11): 가운데에 거대한 금덩어리 6×5칸 하나. 물·잔디·꽃밭이 없어 낚시도 곤충도 없다. 금덩어리 둘레의 돌길 22칸에 서서 캔다
export function buildGoldMine(): MapData {
  const W = 24, H = 18;
  const m = emptyMap(GOLD_MINE_MAP_ID, '금광', W, H);
  const rnd = mulberry32(918273645);
  const setG = (x: number, y: number, id: number) => { if (inBounds(m, x, y)) m.ground[y * W + x] = id; };
  const setO = (x: number, y: number, id: number) => { if (inBounds(m, x, y)) m.objects[y * W + x] = id; };
  const fillG = (x: number, y: number, w: number, h: number, id: number) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) setG(x + i, y + j, id); };

  fillG(0, 0, W, H, G.DARK_FLOOR);
  // 테두리 바위벽
  for (let x = 0; x < W; x++) { setO(x, 0, O.ROCK); setO(x, H - 1, O.ROCK); }
  for (let y = 0; y < H; y++) { setO(0, y, O.ROCK); setO(W - 1, y, O.ROCK); }
  // 금덩어리 둘레의 돌길, 그 안에 금덩어리 (지나갈 수 없는 바닥)
  const gold = { x: 9, y: 5, w: 6, h: 5 };
  fillG(gold.x - 1, gold.y - 1, gold.w + 2, gold.h + 2, G.PLAZA);
  fillG(gold.x, gold.y, gold.w, gold.h, G_GOLD);
  m.zones.push({ id: 'gold', kind: 'mine', ...gold, label: '거대한 금덩어리' });
  // 포탈에서 금덩어리까지 돌길
  fillG(11, 11, 2, 6, G.PLAZA);
  // 굴 안 여기저기 바위 (돌길·시작 자리·포탈 둘레는 비운다)
  for (let i = 0; i < 16; i++) {
    const x = 1 + Math.floor(rnd() * (W - 2)), y = 1 + Math.floor(rnd() * (H - 2));
    if (m.ground[y * W + x] !== G.DARK_FLOOR || (x >= 9 && x <= 14 && y >= 11)) continue;
    setO(x, y, O.ROCK);
  }
  setO(6, 3, O.LAMP); setO(17, 3, O.LAMP); setO(6, 11, O.LAMP); setO(17, 11, O.LAMP);

  m.zones.push({ id: 'lbl-mine', kind: 'label', x: 1, y: 1, w: W - 2, h: H - 2, label: '금광' });
  // 복귀 포탈: 행선지가 하나라 고르는 창 없이 바로 기본 맵의 시작 자리로
  m.zones.push({ id: 'portal-main', kind: 'portal', x: 11, y: 15, w: 2, h: 1, label: '메인 광장', targetMap: MAIN_MAP_ID });
  m.spawn = { x: 12, y: 13 };
  return m;
}

// 저장된 맵 데이터 검증/보정
export function sanitizeMap(raw: Partial<MapData> | null, fallback: MapData): MapData {
  if (!raw || typeof raw.w !== 'number' || typeof raw.h !== 'number' || !Array.isArray(raw.ground) || !Array.isArray(raw.objects)) return fallback;
  if (raw.ground.length !== raw.w * raw.h || raw.objects.length !== raw.w * raw.h) return fallback;
  const zones: Zone[] = [];
  if (Array.isArray(raw.zones)) {
    for (const z of raw.zones) {
      if (validateZone(z)) zones.push(z);
    }
  }
  return {
    id: raw.id || fallback.id,
    name: raw.name || fallback.name,
    w: raw.w, h: raw.h,
    ground: raw.ground.map((v) => (typeof v === 'number' ? v : 0)),
    objects: raw.objects.map((v) => (typeof v === 'number' ? v : 0)),
    zones: Array.isArray(raw.zones) ? zones : fallback.zones,
    spawn: raw.spawn && Number.isInteger(raw.spawn.x) && Number.isInteger(raw.spawn.y) ? raw.spawn : fallback.spawn,
    version: raw.version || 1,
    updatedAt: raw.updatedAt,
  };
}
