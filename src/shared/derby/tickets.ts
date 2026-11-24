// 경마공원 마권 (순수 함수). 마권은 인기 순위로 기록한다: { t, s1, s2?, a } (race/t/{n}/{uid}/{00~99}).
// 화면은 마번으로 고르고, 출마표의 gateOfRank 로 순위로 바꿔 넘긴다.
import type { DerbyBetType } from './odds';
import { derbyOdds, derbyPoolsFor } from './odds';
import type { DerbyPool } from './odds';
import type { DerbyRes } from './scenario';
import { derbyScenarioFor } from './scenario';

export const DERBY_TICKET_MIN = 100;       // 마권 한 장 최소
export const DERBY_TICKET_STEP = 100;      // 100 단위
export const DERBY_MAX_PARK = 100000;      // 한 사람 한 경주 합계 (공원) 기본값 config/raceMax/park
export const DERBY_MAX_BRANCH = 50000;     // 분점 기본값 config/raceMax/branch
export const DERBY_TICKETS_PER_RACE = 100; // 한 경주 최대 장 수 (키 00~99)

export type DerbyMethod = 'single' | 'box' | 'axis' | 'formation';
export interface DerbySelection {
  t: DerbyBetType;
  m: DerbyMethod;
  lines: number[][];       // 순위. single: W·P 는 lines[0] 전부, 짝 승식은 lines[0][0]·lines[1][0] · box: lines[0] · axis: lines[0][0] 축, lines[1] 상대 · formation: lines[0] × lines[1]
  axisPos?: 1 | 2;         // 쌍승 축: 축 말이 1착(기본) 또는 2착
}
export interface DerbyTicket { t: DerbyBetType; s1: number; s2: number }   // W·P 는 s2 = −1

// 고른 것 → 정리된 마권 목록 (같은 말 조합 빼기, 복승·복연승은 s1 < s2 한 장, 겹침 빼기, 열쇠 순)
export function expandSelection(sel: DerbySelection): DerbyTicket[] {
  const ok = (x: number) => Number.isInteger(x) && x >= 0 && x < 8;
  const L = sel.lines.map((l) => [...new Set(l.filter(ok))]);
  const pairs: [number, number][] = [];
  if (sel.t === 'W' || sel.t === 'P') {
    const all = sel.m === 'formation' ? L.flat() : (L[0] ?? []);
    return [...new Set(all)].sort((a, b) => a - b).map((s) => ({ t: sel.t, s1: s, s2: -1 }));
  }
  const a = L[0] ?? [], b = L[1] ?? [];
  if (sel.m === 'single') { if (a.length && b.length) pairs.push([a[0], b[0]]); }
  else if (sel.m === 'box') { for (const x of a) for (const y of a) pairs.push([x, y]); }
  else if (sel.m === 'axis') {
    if (a.length) for (const y of b) pairs.push(sel.t === 'E' && sel.axisPos === 2 ? [y, a[0]] : [a[0], y]);
  } else for (const x of a) for (const y of b) pairs.push([x, y]);
  const seen = new Map<string, DerbyTicket>();
  for (let [x, y] of pairs) {
    if (x === y) continue;
    if (sel.t !== 'E' && x > y) [x, y] = [y, x];
    seen.set(`${x}${y}`, { t: sel.t, s1: x, s2: y });
  }
  return [...seen.entries()].sort((p, q) => (p[0] < q[0] ? -1 : 1)).map((e) => e[1]);
}

// 순위 글자 기록 형식 (RTDB 에 쓰는 모양. W·P 는 s2 없음)
export function ticketRecord(tk: DerbyTicket, a: number): { t: DerbyBetType; s1: string; s2?: string; a: number } {
  return tk.s2 < 0 ? { t: tk.t, s1: `${tk.s1}`, a } : { t: tk.t, s1: `${tk.s1}`, s2: `${tk.s2}`, a };
}

// 적중 판정 (res 의 a·b·c 만 본다)
export function ticketWins(tk: { t: DerbyBetType; s1: number | string; s2?: number | string }, res: DerbyRes): boolean {
  const s1 = `${tk.s1}`, s2 = tk.s2 === undefined ? '' : `${tk.s2}`;
  if (!/^[0-7]$/.test(s1)) return false;
  if (tk.t !== 'W' && tk.t !== 'P' && (!/^[0-7]$/.test(s2) || s1 === s2)) return false;
  if ((tk.t === 'W' || tk.t === 'P') && s2 !== '' && s2 !== '-1') return false;
  const top3 = [res.a, res.b, res.c];
  switch (tk.t) {
    case 'W': return res.a === s1;
    case 'P': return top3.includes(s1);
    case 'Q': return (res.a === s1 && res.b === s2) || (res.a === s2 && res.b === s1);
    case 'E': return res.a === s1 && res.b === s2;
    case 'R': return top3.includes(s1) && top3.includes(s2);
  }
  return false;
}

// 경주 n 의 확정 배당 ×10 (출마표 발표 때 정해지고 바뀌지 않는다)
export function raceOdds(n: number, t: DerbyBetType, s1: number, s2 = -1): number { return derbyOdds(derbyScenarioFor(n).p, t, s1, s2); }
// 적중금 = 금액 × 배당 ÷ 10 (금액이 100 단위라 정수)
export function ticketPayout(a: number, oddsX10: number): number {
  const refund = (a / 10) * oddsX10;
  if (!validTicketAmount(a) || !Number.isSafeInteger(oddsX10) || oddsX10 < 10 || !Number.isSafeInteger(refund)) {
    throw new RangeError('유효하지 않은 마권 환급 금액입니다');
  }
  return refund;
}
// 마권 열쇠 / 지갑 kb·kr 형식 '{n}_{00~99}'
export function ticketKey(n: number, nn: number): string { return `${n}_${String(nn).padStart(2, '0')}`; }
// 금액 한 장이 형식에 맞는가
export function validTicketAmount(a: number): boolean { return Number.isSafeInteger(a) && a >= DERBY_TICKET_MIN && a % DERBY_TICKET_STEP === 0; }

// 경주 n 의 NPC 매출 (progress = 발매 진행 0..1, time.ts saleProgress).
export function derbyPools(n: number, progress: number): Record<DerbyBetType, DerbyPool> {
  return derbyPoolsFor(derbyScenarioFor(n).p, `${n}`, progress);
}
