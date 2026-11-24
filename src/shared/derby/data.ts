// 규칙이 마권 배당을 대조할 공개 고정 자료 raceData/ (tools/gen-derby.mjs 가 JSON 으로 써서 관리자가 올린다). 화면은 이 자료를 내려받지 않고 같은 코드로 계산한다.
//   raceData/sc/{0~9999}  = 그 시나리오의 프로필 번호 p (경주 n 은 시나리오 n % 10000)
//   raceData/odds/{p}/{W|P|Q|E|R}/{열쇠} = 배당 ×10 정수. 열쇠: W·P '{s1}', Q·R '{작은}{큰}', E '{1착}{2착}'
//   결과는 이 자료로 계산하지 않는다: 경주마다 숨은 결과표(derby/secret.ts, raceSecret/)의 칸을 규칙이 그대로 대조한다
import { DERBY_PROFILES, derbyOddsTable } from './odds';
import type { DerbyBetType } from './odds';
import { derbyScenario, DERBY_SCENARIOS } from './scenario';

export interface DerbyStaticData {
  sc: number[];
  odds: Record<DerbyBetType, Record<string, number>>[];
}

export function derbyStaticData(): DerbyStaticData {
  const sc = [];
  for (let s = 0; s < DERBY_SCENARIOS; s++) sc.push(derbyScenario(s).p);
  const odds = DERBY_PROFILES.map((_, p) => derbyOddsTable(p));
  return { sc, odds };
}
