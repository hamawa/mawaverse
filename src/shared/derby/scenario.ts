// 경마공원 몸짓 · 시나리오 · 결과 계산 (순수 함수, 결정적).
// 시나리오 s = n % 10000: 프로필 p 와 몸짓 보일 말 0~3마리(인기 순위 r, 몸짓). 말마다 일어날 일 세 구간(천분율):
//   기세 b = round(1000·α·승률), 부진 d = round(1000·β), 안정 l = round(1000·γ·입상률/(1−입상률)). 승률·입상률은 착순표의 칸 수.
//   구간은 말 순서대로 이어 붙인다: 슬롯 j 의 기세 [시작, b), 부진 [b, d), 안정 [d, l), 다음 슬롯의 시작 = l. 마지막 l 이상이면 아무 일 없음.
// 결과: 기본 착순 칸 = 숫자 4개(천·백·십·일), 몸짓 추첨 = 숫자 3개(0~999). 숫자는 부르는 쪽이 넘긴다 (어디서 얻는지는 여기서 정하지 않는다).
//   기세 = r 을 1착에 두고 나머지는 원래 순서 · 부진 = 원래 상위 4착에서 r 을 빼고 앞당김 · 안정 = r 이 3착 밖이면 3착(1·2착 그대로).
import { seededRandom } from '../hash';
import { DERBY_PROFILES, DERBY_TABLE_SIZE, derbyTable, derbyOdds, derbyCombos, DERBY_BET_TYPES } from './odds';import type { DerbyBetType } from './odds';

export type DerbyBehavior = 'dash' | 'wild' | 'gallopIn' | 'side' | 'lazy' | 'unseat' | 'calm';
export interface DerbyBehaviorDef { id: DerbyBehavior; name: string; where: string; a: number; b: number; g: number }
// α 기세 · β 부진 · γ 안정. 차분하게 걷기의 γ 는 SPEC 시작값 0.05 대신 0.06: 입상률 변화가 γ − β 라 0.05 면 +4%, SPEC 표의 "약 +5%" 에 맞췄다
export const DERBY_BEHAVIORS: Record<DerbyBehavior, DerbyBehaviorDef> = {
  dash: { id: 'dash', name: '점프하며 등장·힘찬 걸음', where: '예시장·입장', a: 0.10, b: 0.04, g: 0 },
  wild: { id: 'wild', name: '사나움(날뛰고 앞발 들기)', where: '예시장', a: 0.16, b: 0.13, g: 0 },
  gallopIn: { id: 'gallopIn', name: '뛰어서 입장', where: '본마장 입장', a: 0.10, b: 0.10, g: 0 },
  side: { id: 'side', name: '옆으로 걸으며 등장', where: '예시장·입장', a: 0.05, b: 0.07, g: 0 },
  lazy: { id: 'lazy', name: '설렁설렁 등장', where: '예시장·입장', a: 0.03, b: 0.08, g: 0 },
  unseat: { id: 'unseat', name: '기수를 떨어뜨렸다 다시 태움', where: '기승·준비운동', a: 0.08, b: 0.14, g: 0 },
  calm: { id: 'calm', name: '차분하게 걷기', where: '예시장', a: 0, b: 0.01, g: 0.06 },
};
export const DERBY_BEHAVIOR_IDS = Object.keys(DERBY_BEHAVIORS) as DerbyBehavior[];

export interface DerbySlot { r: number; k: DerbyBehavior; start: number; b: number; d: number; l: number }
export interface DerbyScenario { s: number; p: number; horses: DerbySlot[] }
export const DERBY_SCENARIOS = 10000;
const SLOT_WEIGHTS = [15, 40, 30, 15];   // 몸짓 보일 말 0·1·2·3마리 (%)
export const DERBY_EV_LIMIT = 0.995;     // 어떤 마권도 기대 환급이 이 값에 닿으면 그 시나리오를 다시 뽑는다 (100% 미만에 여유)

// 프로필 p 에서 순위 r 이 몸짓 k 를 보일 때 세 구간의 폭(천분율)
export function behaviorRates(p: number, r: number, k: DerbyBehavior): { b: number; d: number; l: number } {
  const tb = derbyTable(p), def = DERBY_BEHAVIORS[k];
  const win = tb.W[r] / DERBY_TABLE_SIZE, plc = tb.P[r] / DERBY_TABLE_SIZE;
  return { b: Math.round(1000 * def.a * win), d: Math.round(1000 * def.b), l: Math.round(1000 * def.g * plc / (1 - plc)) };
}

// 순위·몸짓 목록 → 이어 붙인 구간
export function buildSlots(p: number, list: readonly { r: number; k: DerbyBehavior }[]): DerbySlot[] {
  let at = 0;
  return list.map(({ r, k }) => {
    const w = behaviorRates(p, r, k);
    const start = at, b = start + w.b, d = b + w.d, l = d + w.l;
    at = l;
    return { r, k, start, b, d, l };
  });
}

export type DerbyEventKind = 'n' | 'b' | 'd' | 'l';
// 원래 상위 4착(순위 배열) + 일어난 일 → 최종 1~3착
export function applyDerbyEvent(top4: readonly number[], e: DerbyEventKind, r: number): [number, number, number] {
  if (e === 'b') { const o = [r, ...top4.filter((x) => x !== r)]; return [o[0], o[1], o[2]]; }
  if (e === 'd') { const o = top4.filter((x) => x !== r); return [o[0], o[1], o[2]]; }
  if (e === 'l' && top4[0] !== r && top4[1] !== r && top4[2] !== r) return [top4[0], top4[1], r];
  return [top4[0], top4[1], top4[2]];
}

// 몸짓 추첨 숫자(0~999)가 고른 일
export function pickDerbyEvent(slots: readonly DerbySlot[], ev: number): { e: DerbyEventKind; slot: DerbySlot | null } {
  for (const s of slots) {
    if (ev < s.start || ev >= s.l) continue;
    return { e: ev < s.b ? 'b' : ev < s.d ? 'd' : 'l', slot: s };
  }
  return { e: 'n', slot: null };
}

// 일어난 일들 아래 1~3착 분포 (열쇠 a*64+b*8+c, 합 1)
export function outcomeDist(p: number, slots: readonly DerbySlot[]): Float64Array {
  const out = new Float64Array(512);
  const tb = derbyTable(p);
  const evs: { e: DerbyEventKind; r: number; w: number }[] = [];
  let used = 0;
  for (const s of slots) {
    evs.push({ e: 'b', r: s.r, w: (s.b - s.start) / 1000 }, { e: 'd', r: s.r, w: (s.d - s.b) / 1000 }, { e: 'l', r: s.r, w: (s.l - s.d) / 1000 });
    used += s.l - s.start;
  }
  evs.push({ e: 'n', r: 0, w: (1000 - used) / 1000 });
  const live = evs.filter((v) => v.w > 0);
  // applyDerbyEvent 와 같은 계산을 할당 없이 (시나리오 1만 개를 모두 따지는 생성기·시험이 빠르게)
  for (const { a, b, c, d, n } of tb.tuples) {
    const pt = n / DERBY_TABLE_SIZE;
    for (const { e, r, w } of live) {
      let k: number;
      if (e === 'b') k = r === a ? a * 64 + b * 8 + c : r === b ? r * 64 + a * 8 + c : r * 64 + a * 8 + b;
      else if (e === 'd') k = r === a ? b * 64 + c * 8 + d : r === b ? a * 64 + c * 8 + d : r === c ? a * 64 + b * 8 + d : a * 64 + b * 8 + c;
      else if (e === 'l') k = r === a || r === b || r === c ? a * 64 + b * 8 + c : a * 64 + b * 8 + r;
      else k = a * 64 + b * 8 + c;
      out[k] += pt * w;
    }
  }
  return out;
}

// 분포 아래 승식·조합별 적중 확률. W·P [s], Q·E·R [s1*8+s2]
export function ticketProbs(dist: Float64Array): Record<DerbyBetType, Float64Array> {
  const W = new Float64Array(8), P = new Float64Array(8), Q = new Float64Array(64), E = new Float64Array(64), R = new Float64Array(64);
  for (let i = 0; i < 512; i++) {
    const w = dist[i];
    if (!w) continue;
    const a = i >> 6, b = (i >> 3) & 7, c = i & 7;
    W[a] += w; P[a] += w; P[b] += w; P[c] += w;
    E[a * 8 + b] += w; Q[Math.min(a, b) * 8 + Math.max(a, b)] += w;
    for (const [x, y] of [[a, b], [a, c], [b, c]]) R[Math.min(x, y) * 8 + Math.max(x, y)] += w;
  }
  return { W, P, Q, E, R };
}

const oddsArrays = new Map<number, { t: DerbyBetType; i: number; s1: number; s2: number; o: number }[]>();
function oddsList(p: number) {
  let l = oddsArrays.get(p);
  if (!l) {
    l = [];
    for (const t of DERBY_BET_TYPES) for (const [a, b] of derbyCombos(t)) l.push({ t, i: t === 'W' || t === 'P' ? a : a * 8 + b, s1: a, s2: b, o: derbyOdds(p, t, a, b) / 10 });
    oddsArrays.set(p, l);
  }
  return l;
}

// 가장 기대 환급이 큰 마권 (배당은 프로필 p 의 확정 배당)
export function maxTicketEV(p: number, slots: readonly DerbySlot[]): { ev: number; t: DerbyBetType; s1: number; s2: number } {
  const pr = ticketProbs(outcomeDist(p, slots));
  let best = { ev: 0, t: 'W' as DerbyBetType, s1: 0, s2: -1 };
  for (const c of oddsList(p)) {
    const ev = pr[c.t][c.i] * c.o;
    if (ev > best.ev) best = { ev, t: c.t, s1: c.s1, s2: c.s2 };
  }
  return best;
}

const allowed = new Map<number, { r: number; k: DerbyBehavior }[]>();
// 프로필 p 에서 혼자 보여도 어떤 마권의 기대 환급도 100% 에 닿지 않는 (순위, 몸짓). 가파른 프로필의 1인기 부진처럼
// 다른 말들을 한꺼번에 앞당기는 조합은 저인기 쌍승·복연승의 기대 환급을 100% 넘게 올려서 시나리오에 넣지 않는다
export function derbyAllowedBehaviors(p: number): { r: number; k: DerbyBehavior }[] {
  let l = allowed.get(p);
  if (!l) {
    l = [];
    for (let r = 0; r < 8; r++) for (const k of DERBY_BEHAVIOR_IDS) if (maxTicketEV(p, buildSlots(p, [{ r, k }])).ev < DERBY_EV_LIMIT) l.push({ r, k });
    allowed.set(p, l);
  }
  return l;
}

const scenarios = new Map<number, DerbyScenario>();

// 시나리오 s (0~9999)
export function derbyScenario(s: number): DerbyScenario {
  const hit = scenarios.get(s);
  if (hit) return hit;
  const r0 = seededRandom(`derby|sc|${s}`);
  const p = Math.floor(r0() * DERBY_PROFILES.length);
  let horses: DerbySlot[] = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const rng = seededRandom(`derby|sc|${s}|${attempt}`);
    let x = rng() * 100, cnt = 0;
    while (cnt < 3 && x >= SLOT_WEIGHTS[cnt]) { x -= SLOT_WEIGHTS[cnt]; cnt++; }
    let pool = derbyAllowedBehaviors(p);
    const list: { r: number; k: DerbyBehavior }[] = [];
    for (let i = 0; i < cnt && pool.length; i++) {
      const pick = pool[Math.floor(rng() * pool.length)];
      list.push(pick);
      pool = pool.filter((x) => x.r !== pick.r);
    }
    const slots = buildSlots(p, list);
    if (!slots.length || maxTicketEV(p, slots).ev < DERBY_EV_LIMIT) { horses = slots; break; }
  }
  const sc = { s, p, horses };
  scenarios.set(s, sc);
  return sc;
}
export function derbyScenarioFor(n: number): DerbyScenario { return derbyScenario(((n % DERBY_SCENARIOS) + DERBY_SCENARIOS) % DERBY_SCENARIOS); }

// --- 결과 ---
export interface DerbyRes { a: string; b: string; c: string; e: string }   // e: 'n' 없음 · 'b{r}' 기세 · 'd{r}' 부진 · 'l{r}' 안정
export interface DerbyResult {
  n: number; p: number;
  index: number;          // 기본 착순 칸 0~9999
  ev: number;             // 몸짓 추첨 0~999
  entry: string;          // 기본 상위 4착 'abcd'
  res: DerbyRes;
  event: { e: Exclude<DerbyEventKind, 'n'>; r: number; k: DerbyBehavior } | null;
  fall: boolean;          // 경주 중 낙마 장면 (사나움의 부진 구간 앞쪽 절반. 착외 꼴찌, 꾸밈용)
  order: number[];        // 8두 전체 착순(순위). 앞 3칸 = res
}

export function normalizeDigits(digits: string | readonly number[]): number[] {
  if (typeof digits === 'string' && !/^[0-9]{7}$/.test(digits)) throw new Error('derby: 숫자 7개(0~9)가 필요합니다');
  const d = typeof digits === 'string' ? [...digits].map(Number) : [...digits];
  if (d.length !== 7 || d.some((x) => !Number.isInteger(x) || x < 0 || x > 9)) throw new Error('derby: 숫자 7개(0~9)가 필요합니다');
  return d;
}

// 경주 n 과 숫자 7개 → 최종 결과. 규칙이 대조할 수 있는 계산만 쓴다 (res). order·fall 은 화면용
export function derbyResolve(n: number, digits: string | readonly number[]): DerbyResult {
  const d = normalizeDigits(digits);
  const sc = derbyScenarioFor(n);
  const index = d[0] * 1000 + d[1] * 100 + d[2] * 10 + d[3];
  const ev = d[4] * 100 + d[5] * 10 + d[6];
  const entry = derbyTable(sc.p).entries[index];
  const top4 = [...entry].map(Number);
  const pick = pickDerbyEvent(sc.horses, ev);
  const r = pick.slot ? pick.slot.r : 0;
  const [a, b, c] = applyDerbyEvent(top4, pick.e, r);
  // 5착 아래는 경주 번호와 숫자로 정한 가중 추첨 (원래 승률 비례)
  const w = DERBY_PROFILES[sc.p].w, rng = seededRandom(`derby|tail|${n}|${d.join('')}`);
  const rest = [0, 1, 2, 3, 4, 5, 6, 7].filter((x) => !top4.includes(x));
  let order = [...top4];
  while (rest.length) {
    let x = rng() * rest.reduce((s, i) => s + w[i], 0), j = 0;
    while (j < rest.length - 1 && x >= w[rest[j]]) { x -= w[rest[j]]; j++; }
    order.push(rest.splice(j, 1)[0]);
  }
  if (pick.e === 'b') order = [r, ...order.filter((x) => x !== r)];
  else if (pick.e === 'd') order = [...order.filter((x) => x !== r), r];
  else if (pick.e === 'l' && order.indexOf(r) > 2) { order = order.filter((x) => x !== r); order.splice(2, 0, r); }
  const slot = pick.slot;
  const fall = !!slot && pick.e === 'd' && slot.k === 'wild' && ev - slot.b < Math.ceil((slot.d - slot.b) / 2);
  return {
    n, p: sc.p, index, ev, entry,
    res: { a: `${a}`, b: `${b}`, c: `${c}`, e: pick.e === 'n' ? 'n' : `${pick.e}${r}` },
    event: slot && pick.e !== 'n' ? { e: pick.e, r, k: slot.k } : null,
    fall, order,
  };
}
