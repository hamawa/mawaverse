// 경마공원 프로필 · 기본 착순표 · 배당표 · NPC 매출 (순수 함수, 결정적).
// 돈에 관계된 것은 전부 인기 순위(0 = 1인기 … 7 = 8인기, 글자 '0'~'7')로 되어 있다.
// 착순표: 프로필마다 1만 칸, 칸마다 상위 4착의 순위 'abcd'. Harville 확률을 1만 칸에 최대 잔여법으로 나누고 쌍승 56조합이 모두 한 칸 이상이게 고친다.
// 배당(×10 정수) = max(10, floor(93000 ÷ 그 조합이 맞는 칸 수)): 0.93 ÷ (칸 수 / 10000), 0.1배 아래 버림, 최저 1.0배.
import { seededRandom } from '../hash';

export type DerbyBetType = 'W' | 'P' | 'Q' | 'E' | 'R';
export const DERBY_BET_TYPES: readonly DerbyBetType[] = ['W', 'P', 'Q', 'E', 'R'];
export const DERBY_BET_NAMES: Record<DerbyBetType, string> = { W: '단승', P: '연승', Q: '복승', E: '쌍승', R: '복연승' };
export const DERBY_RUNNERS = 8;
export const DERBY_TABLE_SIZE = 10000;
export const DERBY_REFUND_PERMILLE = 930;   // 환급률 93%
export const DERBY_MIN_ODDS_X10 = 10;       // 최저 1.0배

export interface DerbyProfile { id: number; name: string; w: readonly number[] }
// 순위별 승률 (합 1). 1인기 승률은 0.42 이하로 둔다: 1인기가 부진하면 다른 말의 확률이 β/(1−승률)만큼 올라 기대 환급이 100% 를 넘기 쉽다
export const DERBY_PROFILES: readonly DerbyProfile[] = [
  { id: 0, name: '독주', w: [0.42, 0.15, 0.11, 0.09, 0.07, 0.06, 0.055, 0.045] },
  { id: 1, name: '축마 강세', w: [0.34, 0.18, 0.13, 0.10, 0.08, 0.07, 0.055, 0.045] },
  { id: 2, name: '양강', w: [0.27, 0.25, 0.12, 0.10, 0.08, 0.07, 0.06, 0.05] },
  { id: 3, name: '삼강', w: [0.21, 0.20, 0.19, 0.10, 0.09, 0.08, 0.07, 0.06] },
  { id: 4, name: '보통', w: [0.26, 0.19, 0.15, 0.12, 0.10, 0.08, 0.07, 0.03] },
  { id: 5, name: '상위권 두터움', w: [0.28, 0.21, 0.16, 0.12, 0.09, 0.065, 0.045, 0.03] },
  { id: 6, name: '혼전', w: [0.19, 0.17, 0.15, 0.13, 0.12, 0.10, 0.08, 0.06] },
  { id: 7, name: '대혼전', w: [0.15, 0.14, 0.133, 0.127, 0.12, 0.113, 0.11, 0.107] },
  { id: 8, name: '중위권 강세', w: [0.24, 0.17, 0.14, 0.13, 0.12, 0.09, 0.06, 0.05] },
  { id: 9, name: '하위 약세', w: [0.30, 0.22, 0.16, 0.11, 0.08, 0.055, 0.045, 0.03] },
  { id: 10, name: '양강 우세', w: [0.31, 0.24, 0.11, 0.09, 0.08, 0.07, 0.055, 0.045] },
  { id: 11, name: '순서 뚜렷', w: [0.30, 0.20, 0.15, 0.11, 0.09, 0.07, 0.05, 0.03] },
];

export interface DerbyTable {
  entries: string[];                                   // 1만 칸, 칸마다 'abcd'
  tuples: { a: number; b: number; c: number; d: number; n: number }[];  // 칸 수가 있는 상위 4착 조합
  W: number[]; P: number[]; Q: number[]; E: number[]; R: number[];      // 맞는 칸 수. Q·R·E 는 [s1*8+s2] (Q·R 은 s1<s2)
}

const tables = new Map<number, DerbyTable>();

// 프로필 p 의 착순표 (처음 부를 때 만들고 기억해 둔다)
export function derbyTable(p: number): DerbyTable {
  const hit = tables.get(p);
  if (hit) return hit;
  const w = DERBY_PROFILES[p].w;
  const list: { a: number; b: number; c: number; d: number; x: number; n: number }[] = [];
  for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) for (let c = 0; c < 8; c++) for (let d = 0; d < 8; d++) {
    if (a === b || a === c || a === d || b === c || b === d || c === d) continue;
    const pr = w[a] * (w[b] / (1 - w[a])) * (w[c] / (1 - w[a] - w[b])) * (w[d] / (1 - w[a] - w[b] - w[c]));
    const x = pr * DERBY_TABLE_SIZE;
    list.push({ a, b, c, d, x, n: Math.floor(x) });
  }
  // 최대 잔여법: 남는 칸을 소수 부분이 큰 순서로 (같으면 앞 조합)
  let left = DERBY_TABLE_SIZE - list.reduce((s, t) => s + t.n, 0);
  const byFrac = list.map((t, i) => i).sort((i, j) => (list[j].x - list[j].n) - (list[i].x - list[i].n) || i - j);
  for (let k = 0; left > 0; k++, left--) list[byFrac[k]].n++;
  // 쌍승 조합마다 한 칸 이상: 없으면 그 조합에서 가장 그럴듯한 4착 조합에 한 칸을 주고, 칸이 가장 많은 조합에서 한 칸을 뺀다
  for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
    if (a === b) continue;
    const same = list.filter((t) => t.a === a && t.b === b);
    if (same.some((t) => t.n > 0)) continue;
    same.reduce((m, t) => (t.x > m.x ? t : m)).n++;
    list.reduce((m, t) => (t.n > m.n ? t : m)).n--;
  }
  const tbl: DerbyTable = {
    entries: [], tuples: [],
    W: Array(8).fill(0), P: Array(8).fill(0), Q: Array(64).fill(0), E: Array(64).fill(0), R: Array(64).fill(0),
  };
  for (const t of list) {
    if (!t.n) continue;
    tbl.tuples.push({ a: t.a, b: t.b, c: t.c, d: t.d, n: t.n });
    const key = `${t.a}${t.b}${t.c}${t.d}`;
    for (let i = 0; i < t.n; i++) tbl.entries.push(key);
    tbl.W[t.a] += t.n;
    tbl.P[t.a] += t.n; tbl.P[t.b] += t.n; tbl.P[t.c] += t.n;
    tbl.E[t.a * 8 + t.b] += t.n;
    tbl.Q[Math.min(t.a, t.b) * 8 + Math.max(t.a, t.b)] += t.n;
    for (const [x, y] of [[t.a, t.b], [t.a, t.c], [t.b, t.c]]) tbl.R[Math.min(x, y) * 8 + Math.max(x, y)] += t.n;
  }
  tables.set(p, tbl);
  return tbl;
}

// 기본 착순표 칸 (p, i) → 상위 4착 순위 글자 'abcd'
export function derbyBaseEntry(p: number, i: number): string { return derbyTable(p).entries[i]; }

// 정수 나눗셈 (부동소수 오차 없이)
export function idiv(num: number, den: number): number {
  if (!Number.isSafeInteger(num) || num < 0 || !Number.isSafeInteger(den) || den <= 0) {
    throw new RangeError('경마 배당을 나누려면 음이 아닌 정수와 양의 정수 제수가 필요합니다');
  }
  return (num - num % den) / den;
}

// 맞는 칸 수 → 배당 ×10
export function oddsFromCount(count: number): number {
  return Math.max(DERBY_MIN_ODDS_X10, idiv(DERBY_REFUND_PERMILLE * DERBY_TABLE_SIZE / 100, count));
}

// 조합 열쇠: 단승·연승은 '{s1}', 복승·복연승은 '{작은 순위}{큰 순위}', 쌍승은 '{1착}{2착}'
export function comboKey(t: DerbyBetType, s1: number, s2 = -1): string {
  if (t === 'W' || t === 'P') return `${s1}`;
  if (t === 'E') return `${s1}${s2}`;
  return `${Math.min(s1, s2)}${Math.max(s1, s2)}`;
}

// 승식마다 있을 수 있는 조합 (열쇠 순)
export function derbyCombos(t: DerbyBetType): [number, number][] {
  const out: [number, number][] = [];
  if (t === 'W' || t === 'P') { for (let s = 0; s < 8; s++) out.push([s, -1]); return out; }
  for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) if (a !== b && (t === 'E' || a < b)) out.push([a, b]);
  return out;
}

export function comboCount(p: number, t: DerbyBetType, s1: number, s2 = -1): number {
  const rank = (n: number) => Number.isInteger(n) && n >= 0 && n < DERBY_RUNNERS;
  const single = t === 'W' || t === 'P';
  if (!rank(s1) || (single ? s2 !== -1 : !rank(s2) || s1 === s2)) throw new RangeError('유효하지 않은 마권 조합입니다');
  const tb = derbyTable(p);
  if (t === 'W') return tb.W[s1];
  if (t === 'P') return tb.P[s1];
  if (t === 'E') return tb.E[s1 * 8 + s2];
  return tb[t][Math.min(s1, s2) * 8 + Math.max(s1, s2)];
}

// 배당 ×10 (프로필 p, 승식, 순위)
export function derbyOdds(p: number, t: DerbyBetType, s1: number, s2 = -1): number {
  return oddsFromCount(comboCount(p, t, s1, s2));
}

// 프로필 p 의 배당표: { W: { '0': 배당×10, … }, …, E: { '01': … } }
export function derbyOddsTable(p: number): Record<DerbyBetType, Record<string, number>> {
  const out = {} as Record<DerbyBetType, Record<string, number>>;
  for (const t of DERBY_BET_TYPES) {
    out[t] = {};
    for (const [a, b] of derbyCombos(t)) out[t][comboKey(t, a, b)] = derbyOdds(p, t, a, b);
  }
  return out;
}

// --- NPC 매출 ---
// 착순표에서 맞는 칸마다 같은 양의 NPC 매출을 배분한다. 연승·복연승은 한 결과에
// 적중 칸이 셋이라 환급 재원도 3등분한다. 정수 단위 매출만 키워 합계와 배당을 맞춘다.
export interface DerbyPool { total: number; cells: Record<string, number> }
const POOL_BASE: Record<DerbyBetType, number> = { W: 2000000, P: 1500000, Q: 3000000, E: 4000000, R: 2000000 };

const winningSlots = (t: DerbyBetType): number => (t === 'P' || t === 'R' ? 3 : 1);
export function poolOddsX10(total: number, amount: number, t: DerbyBetType): number {
  return Math.max(DERBY_MIN_ODDS_X10, idiv(total * DERBY_REFUND_PERMILLE, amount * 100 * winningSlots(t)));
}

export function derbyPoolsFor(p: number, seed: string, progress: number): Record<DerbyBetType, DerbyPool> {
  const rng = seededRandom(`derby|pool|${seed}`);
  const f = 0.6 + 0.4 * Math.min(1, Math.max(0, progress));
  const out = {} as Record<DerbyBetType, DerbyPool>;
  for (const t of DERBY_BET_TYPES) {
    const rows = DERBY_TABLE_SIZE * winningSlots(t);
    const unit = Math.floor(POOL_BASE[t] * (1 + 0.6 * rng()) * f / rows);
    const cells: Record<string, number> = {};
    for (const [a, b] of derbyCombos(t)) {
      cells[comboKey(t, a, b)] = comboCount(p, t, a, b) * unit;
    }
    out[t] = { total: rows * unit, cells };
  }
  return out;
}
