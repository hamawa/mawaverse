// 슬롯 방의 즉석 게임 두 가지: 슬롯머신과 홀짝 (2026-11-12). 서버 코드가 없어 결과는 "베팅을 쓴 서버 시각"에서 뽑는다 (경마와 같은 생각):
//  ① 베팅: 지갑에서 값을 빼며 it = 서버 시각(규칙이 == now 를 강제), ib = 금액, ik = 게임('s' 슬롯 | 'o' 홀짝), ip = 홀짝에서 고른 쪽
//  ② 정산: 그 it 로 결과를 계산해 딴 돈을 받으며 ic = it 로 표시 (규칙이 같은 식으로 금액을 대조한다. 꽝이면 0 을 받는 정산)
// 클라이언트는 서버 시각을 ms 단위로 맞출 수 없다. 다만 100ms 쯤은 노릴 수 있으므로 시각을 그대로 쓰지 않고 한 번 섞는다(slotHash):
// 이웃한 ms 가 멀리 떨어진 값이 되어, 시각을 대충 맞춰서는 결과를 고를 수 없다.
// 아래 숫자들은 tools/gen-rules.cjs 와 database.rules.json(slot/jp)에 같은 값으로 들어 있다 (tests/slots.test.mjs 가 대조).

export const SLOT_MOD = 9973;       // 소수. 결과는 0 ~ 9972 의 고른 값
export const SLOT_MUL = 7919;
export const SLOT_ADD = 4421;
export const slotHash = (at: number): number => ((Math.abs(Math.floor(at)) % SLOT_MOD) * SLOT_MUL + SLOT_ADD) % SLOT_MOD;

export const INSTANT_MIN = 100;
export const INSTANT_STEP = 100;
export const INSTANT_GAP_MS = 1000;  // 한 판과 다음 판 사이 최소 간격 (규칙이 강제)

// ---- 슬롯 ----
// 칸(해시 값의 구간)마다 배수. 위에서부터 차례로 본다. 잭팟 칸은 JACKPOT_MIN_BET 이상 걸었을 때만 잭팟이고, 그보다 적게 걸었으면 50배
export const SLOT_TIERS: { below: number; mult: number; name: string; icon: string }[] = [
  { below: 10, mult: 50, name: '잭팟', icon: '💎' },    // 0.10%
  { below: 40, mult: 50, name: '트리플 세븐', icon: '7️⃣' }, // 0.30%
  { below: 240, mult: 10, name: '트리플 벨', icon: '🔔' },  // 2.0%
  { below: 739, mult: 4, name: '트리플 체리', icon: '🍒' },  // 5.0%
  { below: 1936, mult: 2, name: '페어', icon: '🍋' },        // 12.0%
  { below: 2734, mult: 1, name: '본전', icon: '🍀' },        // 8.0%
];
export const JACKPOT_MIN_BET = 1000;   // 잭팟은 이 금액 이상 걸었을 때만 터진다 (적게 걸어 잭팟만 노리는 것을 막는다)
export const JACKPOT_SEED = 10000;     // 잭팟이 터진 뒤 다시 시작하는 금액
export const JACKPOT_PCT = 3;          // 슬롯 베팅의 3% 가 잭팟에 쌓인다

export type SlotResult = { tier: number; jackpot: boolean; mult: number };
// tier: SLOT_TIERS 의 번호 (-1 은 꽝)
export function slotResult(at: number, bet: number): SlotResult {
  const h = slotHash(at);
  const tier = SLOT_TIERS.findIndex((t) => h < t.below);
  if (tier < 0) return { tier: -1, jackpot: false, mult: 0 };
  return { tier, jackpot: tier === 0 && bet >= JACKPOT_MIN_BET, mult: SLOT_TIERS[tier].mult };
}
// 받을 돈. 잭팟이면 쌓인 금액(pool)을 통째로
export function slotPayout(at: number, bet: number, pool: number): number {
  const r = slotResult(at, bet);
  return r.jackpot ? pool : bet * r.mult;
}
export const jackpotAdd = (bet: number): number => (bet * JACKPOT_PCT) / 100;

// 화면에 보여 줄 릴 세 칸 (결과에 맞춘 그림. 꽝은 해시로 고른 서로 안 맞는 그림)
const REEL = ['🍒', '🍋', '🔔', '🍇', '⭐', '🍉'];
export function slotReels(at: number, bet: number): [string, string, string] {
  const r = slotResult(at, bet), h = slotHash(at);
  if (r.tier === 0) return r.jackpot ? ['💎', '💎', '💎'] : ['7️⃣', '7️⃣', '7️⃣'];
  if (r.tier === 1) return ['7️⃣', '7️⃣', '7️⃣'];
  if (r.tier === 2) return ['🔔', '🔔', '🔔'];
  if (r.tier === 3) return ['🍒', '🍒', '🍒'];
  const a = REEL[h % REEL.length], b = REEL[(h + 1 + (Math.floor(h / 7) % (REEL.length - 1))) % REEL.length]; // a 와 다른 그림
  if (r.tier === 4) return h % 3 === 0 ? [a, a, b] : h % 3 === 1 ? [a, b, a] : [b, a, a];
  if (r.tier === 5) return ['🍀', a, b];
  const c = REEL.find((x) => x !== a && x !== b)!;
  return [a, b, c];
}

// ---- 홀짝 ----
export const ODD_EVEN_NUM = 19, ODD_EVEN_DEN = 10;   // 맞히면 1.9배
// 나온 수(1~6 주사위 눈처럼 보여 준다)와 홀짝. pick: 1 홀, 0 짝
export const oddEvenParity = (at: number): 0 | 1 => (slotHash(at) % 2) as 0 | 1;
export const oddEvenFace = (at: number): number => { const h = slotHash(at); const p = h % 2; const k = Math.floor(h / 2) % 3; return p === 1 ? [1, 3, 5][k] : [2, 4, 6][k]; };
export const oddEvenPayout = (at: number, bet: number, pick: number): number => (oddEvenParity(at) === pick ? (bet * ODD_EVEN_NUM) / ODD_EVEN_DEN : 0);

export type InstantKind = 's' | 'o';
export const instantPayout = (kind: InstantKind, at: number, bet: number, pick: number, pool: number): number => (kind === 's' ? slotPayout(at, bet, pool) : oddEvenPayout(at, bet, pick));
// 슬롯의 평균 환수율(잭팟 제외): 구간 확률 × 배수의 합
export function slotBaseRtp(minBetForJackpot = true): number {
  let prev = 0, sum = 0;
  SLOT_TIERS.forEach((t, i) => { const p = (t.below - prev) / SLOT_MOD; prev = t.below; if (i === 0 && minBetForJackpot) return; sum += p * t.mult; });
  return sum;
}
