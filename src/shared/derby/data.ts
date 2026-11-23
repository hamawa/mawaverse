// 규칙이 대조할 고정 자료 raceData/ (tools/gen-derby.mjs 가 JSON 으로 써서 배포 때 올린다). 화면은 이 자료를 내려받지 않고 같은 코드로 계산한다.
//   raceData/sc/{0~9999}      = { p: 프로필 번호, h: { 0: 슬롯, 1: 슬롯, 2: 슬롯 } } — 슬롯 = { r: 순위 글자 '0'~'7' 또는 '-', k: 몸짓 id 또는 '-', b, d, l: 천분율 누적 끝 }
//                               슬롯 j 의 시작 = 슬롯 j−1 의 l (슬롯 0 은 0). 기세 [시작,b) · 부진 [b,d) · 안정 [d,l). 빈 슬롯은 폭 0 (b = d = l = 앞 l)
//   raceData/tbl/{p}/{0~9999} = { a, b, c, d: 상위 4착 순위 글자 }
//   raceData/odds/{p}/{W|P|Q|E|R}/{열쇠} = 배당 ×10 정수. 열쇠: W·P '{s1}', Q·R '{작은}{큰}', E '{1착}{2착}'
import { DERBY_PROFILES, derbyTable, derbyOddsTable } from './odds';
import type { DerbyBetType } from './odds';
import { derbyScenario, DERBY_SCENARIOS } from './scenario';

export interface DerbyStaticSlot { r: string; k: string; b: number; d: number; l: number }
export interface DerbyStaticData {
  sc: { p: number; h: [DerbyStaticSlot, DerbyStaticSlot, DerbyStaticSlot] }[];
  tbl: { a: string; b: string; c: string; d: string }[][];
  odds: Record<DerbyBetType, Record<string, number>>[];
}

export function derbyStaticScenario(s: number): DerbyStaticData['sc'][number] {
  const sc = derbyScenario(s);
  let end = 0;
  const h = [0, 1, 2].map((j) => {
    const x = sc.horses[j];
    if (!x) return { r: '-', k: '-', b: end, d: end, l: end };
    end = x.l;
    return { r: `${x.r}`, k: x.k, b: x.b, d: x.d, l: x.l };
  }) as [DerbyStaticSlot, DerbyStaticSlot, DerbyStaticSlot];
  return { p: sc.p, h };
}

export function derbyStaticData(): DerbyStaticData {
  const sc = [];
  for (let s = 0; s < DERBY_SCENARIOS; s++) sc.push(derbyStaticScenario(s));
  const tbl = DERBY_PROFILES.map((_, p) => derbyTable(p).entries.map((e) => ({ a: e[0], b: e[1], c: e[2], d: e[3] })));
  const odds = DERBY_PROFILES.map((_, p) => derbyOddsTable(p));
  return { sc, tbl, odds };
}
