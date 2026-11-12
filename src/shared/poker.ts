// 인디언 포커 (2026-11-12). 둘이서 1~10 카드 한 장씩: 내 카드는 못 보고 상대 카드만 본다. 참가비를 내고 번갈아 다이·체크/콜·레이즈.
// 서버 코드가 없어 이렇게 한다:
//  ① 판 pkh/{hid}: 한 사람이 테이블(pkt/t1·t2)에 판을 열며 참가비를 낸다 → 다른 사람이 참가하며 참가비를 낸다 (지갑 b='poker', pk=판 id, ps=자리 a|b)
//  ② 카드 pkc/{hid}/{자리}: **상대가** 그 칸에 서버 시각을 적는다(규칙이 == now 강제). 카드 = 그 시각을 섞은 값 % 10 + 1.
//     규칙이 그 칸을 "카드 주인만 못 읽게" 막는다(상대는 읽는다). 그래서 고친 클라이언트로도 자기 카드를 볼 수 없고, 적는 쪽도 ms 를 맞출 수 없어 고를 수 없다.
//     카드를 적는 쓰기는 다른 공개 시각(ta 등)과 같이 쓸 수 없게 규칙이 막는다: 같은 시각이 공개되면 주인이 자기 카드를 계산할 수 있다
//  ③ 베팅: 차례인 사람이 다이 / 체크·콜 / 레이즈. 건 돈은 그때그때 지갑에서 떼어 판의 pa·pb 에 쌓는다(같은 쓰기). 못 따라가면 가진 만큼 올인하고 바로 공개
//  ④ 공개(st='show')되면 카드가 모두에게 읽히고, 아무나 결과(w)를 적는다(규칙이 두 카드로 대조). 다이·시간 초과는 그 쓰기에서 w 가 정해진다
//  ⑤ 정산: 각자 자기 몫을 받는다(지갑 pc=판 id + 판의 xa·xb 표시). 규칙이 금액을 대조한다.
//     겨룬 돈 m = 둘 중 적게 건 쪽의 돈. 이긴 쪽: 내가 건 돈 + m − 수수료, 진 쪽: 내가 건 돈 − m (상대가 못 따라온 초과분은 돌려받는다), 비김·취소: 건 돈 그대로
// 아래 숫자는 tools/gen-rules.cjs 에 같은 값으로 들어 있다 (tests/poker.test.mjs 가 대조).
import { slotHash } from './slots';

export const POKER_ANTES = [100, 1000, 10000] as const;
export const POKER_CAP_MULT = 50;          // 한 사람이 한 판에 걸 수 있는 돈 = 참가비 × 50
export const POKER_TURN_MS = 20000;        // 차례마다 (화면)
export const POKER_TURN_GRACE_MS = 5000;   // 규칙은 이만큼 더 기다린 뒤에야 상대의 시간 초과 처리를 받는다
export const POKER_DEAL_LIMIT_MS = 20000;  // 참가 뒤 이 시간 안에 카드가 다 안 나오면 판을 취소할 수 있다
export const POKER_TABLE_STALE_MS = 900000; // 15분 넘게 안 끝난 판의 테이블은 새 판을 열 수 있다 (둘 다 나가 버린 판)
export const POKER_KEEP_MS = 86400000;
export const POKER_TABLES = ['t1', 't2'] as const;

export type Side = 'a' | 'b';
export type PokerStage = 'wait' | 'deal' | 'bet' | 'show' | 'done';
export interface PokerHand {
  t: string; A: number; a: string; an: string; b?: string; bn?: string;
  pa: number; pb: number; st: PokerStage; o: number; tj?: number;
  turn?: Side; n?: number; ta?: number;
  w?: Side | 'tie' | 'void'; why?: string; xa?: boolean; xb?: boolean;
}
export const otherSide = (s: Side): Side => (s === 'a' ? 'b' : 'a');
export const sideOf = (h: PokerHand, uid: string): Side | null => (h.a === uid ? 'a' : h.b === uid ? 'b' : null);
export const putOf = (h: PokerHand, s: Side): number => (s === 'a' ? h.pa : h.pb);
export const pokerCap = (ante: number): number => ante * POKER_CAP_MULT;

// 카드 (1~10): 상대가 적은 서버 시각을 섞은 값에서
export const pokerCard = (at: number): number => (slotHash(at) % 10) + 1;
export const pokerWinner = (cardA: number, cardB: number): Side | 'tie' => (cardA > cardB ? 'a' : cardA < cardB ? 'b' : 'tie');

// 수수료: 겨룬 돈의 합(2m)을 100 단위로 내린 값에서 뗀다 (올인으로 m 이 100 단위가 아닐 때도 정수가 되게)
export const pokerFee = (m: number, feePct: number): number => ((2 * m - ((2 * m) % 100)) * feePct) / 100;
// 정산에서 받는 돈
export function pokerPayout(h: Pick<PokerHand, 'pa' | 'pb' | 'w'>, side: Side, feePct: number): number {
  const own = side === 'a' ? h.pa : h.pb, m = Math.min(h.pa, h.pb);
  if (h.w === 'tie' || h.w === 'void') return own;
  return h.w === side ? own + m - pokerFee(m, feePct) : own - m;
}

// 내 차례에 할 수 있는 일 (balance: 지금 내 잔액)
export interface PokerOptions {
  canCheck: boolean;        // 건 돈이 같다: 체크
  callAdd: number;          // 콜하려면 더 낼 돈 (0 이면 체크). 잔액이 모자라면 가진 만큼(올인)
  callAllIn: boolean;       // 콜이 올인이다 (못 따라가서 가진 만큼만)
  raises: number[];         // 레이즈로 올릴 수 있는 폭들 (상대가 건 돈보다 이만큼 더). 참가비의 1·2·5·10배 중 가능한 것
  maxRaise: number;         // 올릴 수 있는 가장 큰 폭 (0 이면 레이즈 불가)
}
export function pokerOptions(h: PokerHand, side: Side, balance: number): PokerOptions {
  const mine = putOf(h, side), theirs = putOf(h, otherSide(side));
  const need = Math.max(0, theirs - mine);
  const callAdd = Math.min(need, balance);
  const room = Math.min(pokerCap(h.A) - theirs, balance - need); // 상대 돈에 맞춘 뒤 더 올릴 수 있는 여유
  const maxRaise = room >= h.A ? Math.floor(room / h.A) * h.A : 0;
  const raises = [1, 2, 5, 10].map((k) => k * h.A).filter((r) => r <= maxRaise);
  return { canCheck: need === 0, callAdd, callAllIn: need > 0 && callAdd < need, raises, maxRaise };
}
