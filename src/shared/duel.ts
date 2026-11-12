// 1:1 내기 (2026-11-12): 주사위 대결. 캐릭터 메뉴에서 신청 → 상대가 수락 → 높은 쪽이 판돈을 가져간다.
// 서버 코드가 없어 이렇게 한다 (경마·슬롯과 같은 생각):
//  ① 신청: 신청한 사람이 duel/{id} 를 만들며 같은 쓰기에서 판돈을 낸다 (지갑 b='duel', dl=id). 상대에게는 duelInv/{상대 uid} 로 알린다
//  ② 수락: 상대가 같은 쓰기에서 판돈을 내고 duel/{id}/acc = 서버 시각을 적는다 (규칙이 == now 강제). 결과는 이 시각을 섞은 값으로 정해진다:
//     수락하는 쪽도 서버 시각을 ms 단위로 맞출 수 없어 고를 수 없다
//  ③ 정산: 이긴 사람이 판돈 합계에서 수수료를 뺀 돈을 받으며 duel/{id}/paid 를 적는다 (지갑 dc=id. 규칙이 승자와 금액을 대조)
//  ④ 수락하지 않으면(거절·시간 초과) 신청한 사람이 낸 돈을 돌려받는다
// 주사위 눈은 보여 주기용이다: 승패는 섞은 값의 홀짝으로 정확히 반반이고, 눈은 이긴 쪽이 더 크게 나오도록 그 값에서 고른다 (비기는 판이 없다).
// 아래 숫자는 tools/gen-rules.cjs 와 database.rules.json(duel)에 같은 값으로 들어 있다 (tests/duel.test.mjs 가 대조).
import { slotHash } from './slots';

export const DUEL_MIN = 100;
export const DUEL_STEP = 100;
export const DUEL_ACCEPT_MS = 20000;       // 수락을 기다리는 시간 (화면)
export const DUEL_ACCEPT_GRACE_MS = 5000;  // 규칙은 이만큼 더 받아 준다 (통신 지연으로 정상 수락이 거부되지 않게)
export const DUEL_FEE_DEFAULT = 5;         // 수수료 % (config/duelFee 로 관리자가 조정. 판돈 합계에서 떼고 없앤다)
export const DUEL_KEEP_MS = 86400000;      // 끝난 내기는 하루 뒤 아무나 지울 수 있다

export type DuelKind = 'dice';
export interface Duel { a: string; b: string; an: string; bn: string; k: DuelKind; s: number; o: number; acc?: number; no?: boolean; paid?: boolean }
export interface DuelInvite { id: string; f: string; fn: string; s: number; k: DuelKind; t: number }

// 규칙은 config/duelFee 를 숫자면 그대로 쓴다: 여기서도 고치지 않고 그대로 써야 금액이 맞는다 (관리자 화면이 0~50 의 정수로만 저장한다)
export const duelFee = (cfg?: number | null): number => (typeof cfg === 'number' ? cfg : DUEL_FEE_DEFAULT);
// 이긴 사람이 받는 돈: 판돈 합계 − 수수료 (판돈이 100 단위라 늘 정수)
export const duelPayout = (stake: number, feePct: number): number => 2 * stake - (2 * stake * feePct) / 100;
// 이긴 쪽: 'a'(신청한 사람) 또는 'b'(수락한 사람)
export const duelWinner = (acc: number): 'a' | 'b' => (slotHash(acc) % 2 === 0 ? 'a' : 'b');
// 화면에 보여 줄 주사위 눈 [a, b]: 이긴 쪽이 더 크다
const PAIRS: [number, number][] = [];
for (let hi = 2; hi <= 6; hi++) for (let lo = 1; lo < hi; lo++) PAIRS.push([hi, lo]); // 15가지
export function duelDice(acc: number): [number, number] {
  const h = slotHash(acc);
  const [hi, lo] = PAIRS[Math.floor(h / 2) % PAIRS.length];
  return h % 2 === 0 ? [hi, lo] : [lo, hi];
}
// 수락을 더 받지 않는 시각이 지났나 (신청한 사람이 돈을 돌려받을 수 있다)
export const duelExpired = (d: { o: number; acc?: number }, now: number): boolean => !d.acc && now > d.o + DUEL_ACCEPT_MS + DUEL_ACCEPT_GRACE_MS;
