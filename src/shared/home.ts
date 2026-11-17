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
export interface HomeData { t?: number; w?: number; wa?: number; f?: number; fa?: number; s?: number; lk?: boolean | null; sh?: number }

export interface HomeTier {
  tier: number; name: string; icon: string;
  wood: number;          // 짓는(올리는) 데 드는 나무
  item: string | null;   // 코인으로 내는 값의 품목 id (shop.ts HOME_GOODS). 초가집은 코인이 안 든다
  coins: number;         // 그 품목의 기본 가격 (실제 값은 config/prices)
  extraSlots: number;    // 코인으로 늘릴 수 있는 칸의 상한
  iw: number; ih: number; // 방 안 크기 (칸)
  perk: string;
}
export const HOME_TIERS: readonly HomeTier[] = [
  { tier: 1, name: '초가집', icon: '🌾', wood: 30, item: null, coins: 0, extraSlots: 0, iw: 5, ih: 4, perk: '누구나 들어올 수 있고 밀치기도 통한다' },
  { tier: 2, name: '통나무집', icon: '🌲', wood: 300, item: 'house2', coins: 10000, extraSlots: 3, iw: 7, ih: 5, perk: '문을 잠글 수 있다' },
  { tier: 3, name: '벽돌집', icon: '🧱', wood: 1000, item: 'house3', coins: 50000, extraSlots: 6, iw: 10, ih: 6, perk: '문을 잠글 수 있고, 집 안에서는 밀치기·끌기·말랑이가 안 통한다' },
];
export const HOME_MAX_TIER = 3;
export function homeTier(t: unknown): HomeTier | null { return typeof t === 'number' && t >= 1 && t <= HOME_MAX_TIER ? HOME_TIERS[Math.floor(t) - 1] : null; }
export function tierOf(h: HomeData | null | undefined): number { return homeTier(h?.t)?.tier ?? 0; }

// ---- 나무 ----
export const CHOP_MS = 3000;        // 한 번 휘두르는 시간
export const CHOP_GAP_MS = 2500;    // 규칙이 보는 최소 간격 (통신 지연으로 정상 쓰기가 거부되지 않게 조금 짧게)
export const CHOP_MAX = 2;          // 한 번에 나오는 최대 개수
export const CHOP_SWINGS = 5;       // F 한 번에 이어서 휘두르는 횟수 (자동으로 계속 캐지는 않는다)
export const WOOD_MAX = 2000;       // 들고 있을 수 있는 나무
export function rollWood(rand: () => number = Math.random): number { return rand() < 0.5 ? 1 : 2; }

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

export const fmtWood = (n: number): string => `🌳 ${Math.floor(n).toLocaleString('ko-KR')}`;
