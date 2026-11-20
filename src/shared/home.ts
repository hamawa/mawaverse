// 내 집 (2026-11-17, 건의 반영: 개인 공간 + 창고). 숫자는 전부 여기에 있고, 규칙(database.rules.json 의 homes 블록)에 같은 값이 글자로 들어 있다 (tests/home.test.mjs 가 대조)
//
// homes/{uid} = { t 집 단계(1~3. 없으면 집 없음), w 나무, wa 마지막으로 나무를 캔 서버 시각, f 창고 물고기 수, fa 마지막으로 물고기를 넣은 서버 시각,
//                 s 코인으로 늘린 창고 칸(0~6), lk 문 잠금(통나무집부터), sh 든든함(빠따를 막아 주는 횟수 0~3) }
// - 나무: 어느 맵이든 나무를 보고 F. 한 번 휘두르는 데 CHOP_MS, 나무 1~2개. 규칙은 "지난 쓰기에서 CHOP_GAP_MS 이상, 한 번에 CHOP_MAX 개 이하"만 본다 (채광과 같은 신뢰 수준)
// - 집: 초가집은 나무만, 통나무집·벽돌집은 나무 + 코인. 코인은 보관함 품목(house2·house3)을 사는 기존 구매 규칙으로 내고, homes 규칙이 그 품목을 가졌는지 본다 (지갑 규칙은 손대지 않았다)
// - 창고: 낚을 때마다 지금처럼 코인을 받고, 덤으로 창고에 한 마리 쌓인다 (꽝 제외). 한 칸 = SLOT_FISH 마리, 기본 BASE_SLOTS 칸. 칸은 코인(hslot1~6)으로 늘리고 집 단계가 상한을 정한다
//   쌓는 쓰기는 잡을 때마다 하지 않고 STORE_FLUSH_MS 마다 모아서 한 번 (요청 수 = 비용). 규칙: STORE_GAP_MS 에 STORE_MAX 마리까지
// - 묶음 판매: 큰 묶음일수록 한 마리 값이 높고, 큰 묶음을 팔려면 칸이 그만큼 있어야 한다 (BUNDLES). 값은 일부러 낮게 잡았다: 하루 한 사람이 2,000마리쯤 낚는다
// - 겨울잠: 내 집 침대에서 SLEEP_MS 를 자면 물고기 SHIELD_FISH 마리를 먹고 든든함 +1 (최대 SHIELD_MAX). 든든함 하나가 빠따 한 번을 막는다 (상대 빠따는 그대로 소모)
//   "하루 동안 빠따 면역"은 넣지 않았다: 갑옷·펫 방어를 대부분 갖춰 빠따가 유일한 공격 수단이라, 집 있는 사람이 전부 면역이 되면 빠따가 쓸모없어진다
// 꾸미기 (2026-11-17 저녁, 사용자 요청): fu 만든 가구 종류(오브젝트 id → true. 한 번 만들면 몇 개든 놓는다), d 놓은 가구("x_y" → 오브젝트 id), fl 바닥재(바닥 id), tr 박제(자리 번호 → { id 물고기, s 크기 })
export interface HomeData { t?: number; w?: number; wa?: number; f?: number; fa?: number; s?: number; lk?: boolean | null; sh?: number; fu?: Record<string, true>; d?: Record<string, number>; dr?: Record<string, number>; fl?: number; wl?: number; tr?: Record<string, { id: string; s?: number }>; gb?: Record<string, GuestNote>; vc?: number; ph?: Record<string, { k: number; at: number }> }
// 금고 (2026-11-20 건의): vc = 넣어 둔 코인. 이자는 없다 (가만히 있어도 코인이 생기는 길을 만들지 않는다). 넣고 빼는 쓰기는 지갑과 한 번에 가고, 규칙이 "금고가 는 만큼 지갑이 줄었는가"를 본다
// 사진 액자 (2026-11-20 사용자 요청): ph/{자리} = { k: 액자 종류, at }. 자리는 박제와 같은 벽 자리를 쓴다 (한 자리에 박제 아니면 사진). 사진 자체는 homepic/{uid}/{자리} 에 따로 둔다:
// homes/{uid} 는 주인이 늘 구독하고 손님도 들어와 있는 동안 구독하므로, 거기에 사진을 넣으면 집 값이 바뀔 때마다 사진까지 다시 내려받게 된다.
// 무료 플랜이라 사진 저장소(Storage)를 쓸 수 없어 DB 에 글자(JPEG data URL)로 넣는다. 올릴 때 화면이 줄인다 (PHOTO_EDGE·PHOTO_MAX_CHARS. 규칙의 한도는 조금 넉넉하다)
export const PHOTO_FRAMES: readonly { k: number; item: string; name: string }[] = [{ k: 1, item: 'frame1', name: '나무 액자' }, { k: 2, item: 'frame2', name: '금테 액자' }];
export const PHOTO_EDGE = 720;          // 긴 변 (px). 2026-11-20 에 480 → 720: 눌러서 크게 볼 때 덜 흐리게 (규칙 한도 안. 전에 올린 사진은 그대로라 다시 올려야 선명해진다)
export const PHOTO_MAX_CHARS = 110000;  // data URL 길이 (약 82KB)
export const PHOTO_RULE_CHARS = 120000; // 규칙이 받는 최대 길이
export function vaultOf(h: HomeData | null | undefined): number { const v = h?.vc; return typeof v === 'number' && v > 0 ? Math.floor(v) : 0; }
// 방명록 (2026-11-18): homes/{주인}/gb/{쓴 사람 uid} = 한 사람이 한 집에 한 줄 (다시 쓰면 바뀐다). 쓴 사람과 집주인이 지울 수 있다
export interface GuestNote { n: string; t: string; at: number }
export const GUEST_MAX = 60; // 한 줄의 글자 수 (규칙과 같아야 한다)

export interface HomeTier {
  tier: number; name: string; icon: string;
  wood: number;          // 짓는(올리는) 데 드는 나무
  item: string | null;   // 코인으로 내는 값의 품목 id (shop.ts HOME_GOODS). 초가집은 코인이 안 든다
  coins: number;         // 그 품목의 기본 가격 (실제 값은 config/prices)
  extraSlots: number;    // 코인으로 늘릴 수 있는 칸의 상한
  iw: number; ih: number; // 방 안 크기 (칸)
  perk: string;
  deco: number;          // 놓을 수 있는 가구 수
  trophyX: readonly number[]; // 박제를 거는 위쪽 벽의 x 좌표들 (개수 = 걸 수 있는 박제 수. 창문 자리는 피했다)
}
export const HOME_TIERS: readonly HomeTier[] = [
  { tier: 1, name: '초가집', icon: '🌾', wood: 30, item: null, coins: 0, extraSlots: 0, iw: 5, ih: 4, perk: '누구나 들어올 수 있고 밀치기도 통한다', deco: 4, trophyX: [4] },
  { tier: 2, name: '통나무집', icon: '🌲', wood: 300, item: 'house2', coins: 10000, extraSlots: 3, iw: 7, ih: 5, perk: '문을 잠글 수 있다', deco: 10, trophyX: [3, 6] },
  { tier: 3, name: '벽돌집', icon: '🧱', wood: 1000, item: 'house3', coins: 50000, extraSlots: 6, iw: 10, ih: 6, perk: '문을 잠글 수 있고, 집 안에서는 밀치기·끌기·말랑이가 안 통한다', deco: 24, trophyX: [3, 6, 7, 9] },
];
export const HOME_MAX_TIER = 3;
export function homeTier(t: unknown): HomeTier | null { return typeof t === 'number' && t >= 1 && t <= HOME_MAX_TIER ? HOME_TIERS[Math.floor(t) - 1] : null; }
export function tierOf(h: HomeData | null | undefined): number { return homeTier(h?.t)?.tier ?? 0; }

// ---- 나무 ----
export const CHOP_MS = 3000;        // 한 번 휘두르는 시간
export const CHOP_GAP_MS = 2500;    // 규칙이 보는 최소 간격 (통신 지연으로 정상 쓰기가 거부되지 않게 조금 짧게)
export const CHOP_MAX = 2;          // 한 번에 나오는 최대 개수 (곡괭이 보너스 빼고. 규칙: 늘어난 양이 이보다 많으면 (늘어난 양 - CHOP_MAX) * 2 <= 지갑의 pi 여야 한다)
export const CHOP_SWINGS = 5;       // F 한 번에 이어서 휘두르는 횟수 (자동으로 계속 캐지는 않는다)
export const WOOD_MAX = 2000;       // 들고 있을 수 있는 나무
// pick: 곡괭이 단계. 단계의 절반만큼 더 나온다 (2026-11-19, 건의 반영: 금광의 금덩이와 같은 식. 10단계면 한 번에 6~7개)
export function woodBonus(pick: number): number { return Math.max(0, Math.floor((pick || 0) / 2)); }
export function rollWood(rand: () => number = Math.random, pick = 0): number { return (rand() < 0.5 ? 1 : 2) + woodBonus(pick); }

// ---- 창고 ----
export const SLOT_FISH = 100;       // 한 칸에 들어가는 물고기
export const BASE_SLOTS = 4;        // 기본 칸
export const MAX_EXTRA_SLOTS = 6;   // 코인으로 늘리는 칸 (벽돌집에서 전부)
export const slotItem = (n: number): string => `hslot${n}`; // n 번째로 늘리는 칸의 품목 id (1~6)
export const slotPrice = (n: number): number => 5000 * n;   // 기본 가격: 5,000 · 10,000 · … · 30,000 (합계 105,000)
export function extraSlotsOf(h: HomeData | null | undefined): number { const s = h?.s; return typeof s === 'number' && s > 0 ? Math.min(MAX_EXTRA_SLOTS, Math.floor(s)) : 0; }
export function slotsOf(h: HomeData | null | undefined): number { return tierOf(h) ? BASE_SLOTS + extraSlotsOf(h) : 0; }
export function capacityOf(h: HomeData | null | undefined): number { return SLOT_FISH * slotsOf(h); }
export function fishOf(h: HomeData | null | undefined): number { const f = h?.f; return typeof f === 'number' && f > 0 ? Math.floor(f) : 0; }
export const STORE_FLUSH_MS = 60000; // 잡은 물고기를 모아서 창고에 넣는 간격
export const STORE_GAP_MS = 30000;   // 규칙이 보는 최소 간격
export const STORE_MAX = 20;         // 한 번에 넣을 수 있는 최대 마릿수

// 묶음 판매: n 마리를 price 코인에. slots 칸 이상이어야 그 묶음을 팔 수 있다 (칸을 늘릴 이유)
export interface Bundle { n: number; price: number; slots: number }
export const BUNDLES: readonly Bundle[] = [
  { n: 100, price: 100, slots: 1 },
  { n: 500, price: 750, slots: 5 },
  { n: 1000, price: 2000, slots: 10 },
];

// ---- 겨울잠 ----
export const SLEEP_MS = 300000;     // 이만큼 자면 한 끼
export const SHIELD_FISH = 300;     // 한 끼에 먹는 물고기
export const SHIELD_MAX = 3;        // 쌓아 둘 수 있는 든든함
export function shieldOf(h: HomeData | null | undefined): number { const n = h?.sh; return typeof n === 'number' && n > 0 ? Math.min(SHIELD_MAX, Math.floor(n)) : 0; }

// 지금 올릴 수 있는 다음 단계와 모자란 것. owns: 그 단계의 코인 값을 이미 냈는가 (보관함)
export function nextTier(h: HomeData | null | undefined): HomeTier | null { const t = tierOf(h); return t >= HOME_MAX_TIER ? null : HOME_TIERS[t]; }
export function woodOf(h: HomeData | null | undefined): number { const w = h?.w; return typeof w === 'number' && w > 0 ? Math.floor(w) : 0; }
// 나무를 더 캘 이유가 있나: 다음 단계가 있고, 그 값만큼 아직 못 모았을 때
export function needsWood(h: HomeData | null | undefined): boolean { const n = nextTier(h); return !!n && woodOf(h) < n.wood; }

// ---- 꾸미기: 가구·바닥·박제 ----
// 가구는 나무로 종류마다 한 번 만들면(fu) 집 단계의 개수(deco)까지 몇 개든 놓는다. o 는 맵 오브젝트 id (map.ts O). 값은 규칙의 fu 검증에 같은 숫자로 들어 있다
// item: 나무 대신 그 보관함 품목을 사야 만들 수 있다 (2026-11-18 고급 가구: fn = 코인, gg = 코인 + 금덩이. shop.ts HOME_GOODS). 규칙도 그 품목을 가졌는지 본다
export interface Furniture { o: number; name: string; wood: number; item?: string }
export const FURNITURE: readonly Furniture[] = [
  { o: 6, name: '의자', wood: 20 }, { o: 12, name: '화분', wood: 20 }, { o: 31, name: '화초', wood: 20 },
  { o: 5, name: '테이블', wood: 30 }, { o: 30, name: '원탁', wood: 30 }, { o: 4, name: '벤치', wood: 30 },
  { o: 10, name: '가로등', wood: 40 }, { o: 27, name: '카운터', wood: 40 }, { o: 32, name: '파라솔', wood: 50 },
  { o: 21, name: '책장', wood: 60 }, { o: 22, name: '소파', wood: 60 }, { o: 23, name: '자판기', wood: 100 }, { o: 33, name: '오락기', wood: 100 },
  { o: 39, name: '텔레비전', wood: 0, item: 'fn39' }, { o: 36, name: '벽난로', wood: 0, item: 'fn36' }, { o: 37, name: '어항', wood: 0, item: 'fn37' }, { o: 38, name: '피아노', wood: 0, item: 'fn38' },
  { o: 40, name: '황금 화분', wood: 0, item: 'gg40' }, { o: 41, name: '황금 동상', wood: 0, item: 'gg41' },
];
// 벽지 (2026-11-18): 보관함 품목 wall{n} 을 사면 집 벽을 그 빛깔로 바꿀 수 있다 (homes 의 wl = n. 0 또는 없음 = 기본 벽). 규칙이 그 품목을 가졌는지 본다
export const WALLS: readonly { n: number; name: string; item: string }[] = [{ n: 1, name: '분홍 벽지', item: 'wall1' }, { n: 2, name: '민트 벽지', item: 'wall2' }, { n: 3, name: '밤하늘 벽지', item: 'wall3' }];
export function furnitureOf(o: unknown): Furniture | undefined { return FURNITURE.find((f) => f.o === o); }
// 가구 방향 (2026-11-19, 사용자 요청): 놓은 가구를 돌릴 수 있다. homes/{uid}/dr/{x_y} = 1 왼쪽 · 2 오른쪽 · 3 뒤 (캐릭터 방향 Dir 과 같은 번호. 앞을 보면 칸이 없다).
// 돌릴 수 있는 것은 앞뒤·옆이 다르게 생긴 가구뿐이다 (화분·화초·원탁·가로등·파라솔·황금 화분은 어느 쪽에서 봐도 같다). 그림은 tiles.ts drawTurned
export const TURNABLE: readonly number[] = [6, 4, 22, 21, 23, 33, 39, 36, 38, 27, 5, 37, 41];
export function canTurn(o: unknown): boolean { return TURNABLE.includes(o as number); }
export const TURN_NAMES: readonly string[] = ['앞', '왼쪽', '오른쪽', '뒤']; // 방향 번호 → 이름
export const TURN_ORDER: readonly number[] = [0, 1, 3, 2];                 // 돌리는 순서: 앞 → 왼쪽 → 뒤 → 오른쪽
export function turnOf(h: HomeData | null | undefined, x: number, y: number): number {
  const r = h?.dr?.[`${x}_${y}`];
  return (r === 1 || r === 2 || r === 3) && canTurn(h?.d?.[`${x}_${y}`]) ? r : 0;
}
// 바닥재 (g 는 맵 바닥 id, map.ts G). 바꿀 때마다 나무 FLOOR_WOOD 개
export const FLOORS: readonly { g: number; name: string }[] = [{ g: 7, name: '모래' }, { g: 4, name: '나무 바닥' }, { g: 5, name: '타일' }, { g: 8, name: '카펫' }];
export const FLOOR_WOOD = 30;
export const posKey = (x: number, y: number): string => `${x}_${y}`;
// 놓은 가구 목록 (알 수 없는 값은 버린다). r: 방향 (0 앞 · 1 왼쪽 · 2 오른쪽 · 3 뒤)
export function decoList(h: HomeData | null | undefined): { x: number; y: number; o: number; r: number }[] {
  const out: { x: number; y: number; o: number; r: number }[] = [];
  for (const [k, o] of Object.entries(h?.d || {})) { const m = /^(\d{1,2})_(\d{1,2})$/.exec(k); if (m && furnitureOf(o)) out.push({ x: +m[1], y: +m[2], o, r: turnOf(h, +m[1], +m[2]) }); }
  return out;
}
// 박제: 내가 잡은 적 있는 전설(3)·신화(4) 물고기만 건다. 자리 수는 집 단계의 trophyX 개수
export const TROPHY_MIN_RARITY = 3;

// ---- 나무가 베이고 다시 자라기 (2026-11-17 저녁, 건의 반영) ----
// 한 그루 = F 한 번(CHOP_SWINGS 번). 첫 도끼질의 나무를 받을 때 trees/{맵}/{x_y} 에 벤 시각을 적는다: 그때부터 남은 못 캔다.
// 베는 동안(TREE_HIDE_MS)은 서 있는 나무로 그리고, 그 뒤 그루터기 → 덤불(새싹) → TREE_REGROW_MS 뒤 다시 나무. 그루터기·덤불도 길은 막는다 (맵 테두리가 나무라 뚫리면 안 된다)
export const TREE_REGROW_MS = 300000;
export const TREE_HIDE_MS = (CHOP_SWINGS - 1) * CHOP_MS;
export type TreeStage = 'tree' | 'stump' | 'bush';
export function treeStage(cutAt: number | undefined, now: number): TreeStage {
  if (typeof cutAt !== 'number') return 'tree';
  const dt = now - cutAt;
  if (dt < TREE_HIDE_MS || dt >= TREE_REGROW_MS) return 'tree';
  return dt < TREE_REGROW_MS * 0.6 ? 'stump' : 'bush';
}
// 지금 벨 수 없는 나무인가 (누가 벴고 아직 다 자라지 않았다)
export function treeCut(cutAt: number | undefined, now: number): boolean { return typeof cutAt === 'number' && now - cutAt < TREE_REGROW_MS; }

export const fmtWood = (n: number): string => `🌳 ${Math.floor(n).toLocaleString('ko-KR')}`;
