// 거래소 (2026-11-19, 건의 반영: "주식이나 코인을 만들어 주세요"). 서버 코드가 없어서 가격을 정하는 방법이 핵심이다.
//
// 가격을 미리 알 수 없게 하는 법 (경마·슬롯과 같은 원리: 결과는 서버 시각에서 나오고, 쓰는 사람은 그 시각을 고를 수 없다)
//  stock/p/{종목} = { v: 지금 가격, at: 마지막으로 "굴린" 서버 시각, sa: v 가 반영한 굴림 시각 }
//  1) 굴리기: TICK_MS 가 지나면 아무나 at 을 지금(서버 시각)으로 쓴다. 이 순간 다음 가격이 정해진다 (v 와 그 at 으로 계산). 쓰기 전에는 아무도 모른다
//  2) 반영: 아무나 v = stepPrice(v, at), sa = at 을 쓴다 (규칙이 같은 식으로 검산). 굴렸는데 아직 반영되지 않은 사이(sa != at)에는 거래할 수 없다:
//     그 사이에는 새 가격을 계산할 수 있으므로, 옛 가격으로 사고팔게 두면 공짜 돈이 된다
//  저장된 값만으로 다음 가격을 미리 계산할 수 있는 식(예: 지난 굴림 시각으로 다음 가격을 정하기)은 쓰면 안 된다: 저장소가 공개라 누구나 계산한다
//
// 가격의 움직임: 한 번에 ±A(천분율) 안에서 고르게 흔들리고, 1,000 에서 멀어질수록 아주 약하게 되돌아온다 (그래야 0 으로 주저앉거나 끝없이 오르지 않는다).
//  되돌리는 항 (1000 - v) / (1000 + v) 은 위아래가 대칭이다(두 배 비쌀 때와 절반일 때 같은 세기): (1000 - v) 에 비례시키면 쌀 때는 약하고 비쌀 때만 세서 값이 아래에 눌러앉는다 (계산해 보니 코인의 평균이 480 이었다).
//  되돌아오는 성질이 있으니 "쌀 때 사서 비쌀 때 팔기"의 기대값은 0 보다 크다. 아무 때나 사서 팔면 수수료만큼 손해다.
//  값을 고른 근거 (2026-11-19, 400~600일치를 굴려 본 계산): 처음 잡은 폭 10·30·80·센 되돌림에서는 한도(100주)까지 잘 사고파는 사람이 일주일에 17만 코인을 벌었다
//  (보통 사람의 주간 수입이 20만). 폭 6·15·40 과 약한 되돌림으로 낮춰 4만쯤(세 종목 합, 가장 잘했을 때)으로 묶었다. 하루 변동은 4%·10%·26% 쯤.
//  폭이나 한도를 올리기 전에 같은 계산(scratch stock-sim)을 다시 해 볼 것: 코인이 남는 게임이라 여기가 코인이 새로 생기는 통로가 되면 안 된다
//
// 거래: 지갑의 코인(c)과 보유(stock/h/{uid}/{종목}/q)를 쓰기 한 번에 바꾼다. 규칙(stock/h/{uid} 의 .validate)이 "코인이 바뀐 양 = 가격 × 수량 ∓ 수수료"를 본다.
//  살 때는 코인만 줄이고(지갑 규칙은 코인이 줄기만 하는 쓰기를 그냥 받는다), 팔 때는 획득(e)도 같이 올린다. 지갑 규칙(gen-rules.cjs)은 건드리지 않았다
// 아래 숫자와 식은 database.rules.json 의 stock 블록(손으로 넣은 줄)과 같아야 한다 (tests/stock.test.mjs 가 대조, 허용·거부는 tests/rules-gate.test.mjs)
export type StockSym = 'a' | 'b' | 'c';
export interface StockDef { sym: StockSym; name: string; icon: string; amp: number; mul: number; desc: string }
// amp: 한 번에 흔들리는 폭 (천분율). mul: 종목마다 다른 수로 섞는다 (같은 순간에 굴려도 종목마다 다르게 움직이게. 1000 과 서로소)
export const STOCKS: readonly StockDef[] = [
  { sym: 'a', name: '마와전자', icon: '📺', amp: 6, mul: 7919, desc: '안정주. 조금씩 움직인다.' },
  { sym: 'b', name: '연못수산', icon: '🐟', amp: 15, mul: 6007, desc: '보통주. 하루에도 꽤 출렁인다.' },
  { sym: 'c', name: '두더지코인', icon: '🚀', amp: 40, mul: 4001, desc: '급등락 코인. 크게 오르고 크게 내린다.' },
];
export const stockOf = (sym: string): StockDef | undefined => STOCKS.find((s) => s.sym === sym);
export const TICK_MS = 300000;        // 가격이 바뀌는 간격 (5분)
export const STOCK_BASE = 1000;       // 되돌아오는 중심 가격 (시작 가격)
export const STOCK_MIN = 100, STOCK_MAX = 9999;
export const STOCK_CAP = 1000;        // 종목당 보유 한도 (주). 2026-11-20 에 100 → 1000 (건의 "무한 매수"에 사용자가 정한 값. 최고 수익도 손실도 그만큼 커진다)
export const STOCK_FEE_DIV = 50;      // 수수료 = 거래액 / 50 (2%), 올림
export const HIST_SLOTS = 96;         // 가격 기록 칸 수 (5분 × 96 = 8시간. 굴림 번호 % 96 자리에 덮어쓴다)

export interface StockPrice { v: number; at: number; sa: number }
export interface StockHold { q: number; a?: number } // q: 보유 수, a: 산 값의 합 (평단 표시용. 규칙은 보지 않는다)

// 다음 가격: v 에서 at(굴린 서버 시각)으로 한 번 움직인다. 규칙의 식과 연산 순서까지 같다 (둘 다 배정도 실수로 계산한다)
export function stepPrice(v: number, at: number, sym: StockSym): number {
  const s = stockOf(sym)!;
  const h = ((at % 100003) * s.mul) % 1000;                                              // 0~999: 굴린 시각의 ms 자리를 섞은 값
  // 가운데 항(amp² / 6000)은 치우침 보정이다: 곱으로 흔들리는 값은 그냥 두면 조금씩 아래로 흐른다(폭이 클수록 빨리). 그만큼 위로 보태야 중심이 1,000 에 머문다
  const raw = v + (v * ((s.amp * (h * 2 - 999)) / 999 + (s.amp * s.amp) / 6000 + (STOCK_BASE - v) / (STOCK_BASE + v))) / 1000;
  const r = Math.floor(raw + 0.5);
  return r < STOCK_MIN ? STOCK_MIN : r > STOCK_MAX ? STOCK_MAX : r;
}
export const settled = (p: StockPrice | null | undefined): boolean => !!p && p.sa === p.at;
// 수수료 (올림). n: 거래액 = 가격 × 수량
export const stockFee = (n: number): number => (n + STOCK_FEE_DIV - 1 - ((n + STOCK_FEE_DIV - 1) % STOCK_FEE_DIV)) / STOCK_FEE_DIV;
export const buyCost = (q: number, price: number): number => q * price + stockFee(q * price);   // 사는 데 드는 코인
export const sellNet = (q: number, price: number): number => q * price - stockFee(q * price);   // 팔아서 받는 코인
export const histIndex = (at: number): number => Math.floor(at / TICK_MS);
