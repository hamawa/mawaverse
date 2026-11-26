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
//
// 하락 상품 (2026-11-25, 건의 반영: "가격이 내려가는 쪽에도 투자"). 종목마다 하나씩이고 값은 그 종목의 가격에서 바로 나온다: invPrice = floor(1,000,000 / 가격).
//  가격이 반이 되면 값은 두 배다 (1,000 → 1,000 · 500 → 2,000 · 2,000 → 500). 되돌리는 항이 위아래 대칭이라 하락 상품의 움직임도 보통 종목과 같은 성질이다.
//  따로 굴리지 않는다: 가격 칸은 그대로이고 보유의 iq·ia 와 규칙의 금액 식만 늘었다. 규칙에는 내림이 없어 `x - x % 1` 로 적는다
//  (1,000,000 / 가격의 소수부는 0 이거나 1/9999 이상이라 실수 오차로 값이 달라지지 않는다. tests/rules-gate 가 값마다 대조한다).
//  값 고르기 (600일치 계산, scratch stock-sim): 오를 때도 내릴 때도 벌 수 있게 되어 "가장 잘했을 때"의 수익이 거의 두 배가 된다
//  (세 종목 합, 한도 1,000주: 주 45만 → 86만. 한 번에 10만 코인: 7.6만 → 14.5만). 하락 상품의 수수료를 5% 로 올려도 1.8배라 수수료로는 못 막는다.
//  그래서 하락 상품의 한도를 300주로 낮게 시작했다 (맨 위 수익 약 57만. 저장소 주인 결정). 올리기 전에 같은 계산을 다시 해 볼 것
// 손익 순위 (같은 날, 건의 반영: "주식 수익률 공개"): 보유(stock/h)는 처음부터 누구나 읽을 수 있다. 판에서 순위를 열 때 한 번 읽어
//  평가 손익(지금 팔면 받는 돈 − 산 값) + 실현 손익(r)으로 줄 세운다. r 은 팔 때 화면이 더하는 값이고 규칙이 대조하지 않는다(표시용. 이날부터 쌓인다)
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
export const STOCK_INV_CAP = 300;     // 하락 상품의 종목당 보유 한도 (주). 낮게 시작했다: 머리말의 계산
export const STOCK_INV_NUM = 1000000; // 하락 상품의 값 = 이 수 / 가격 (내림). 가격 1,000 에서 값도 1,000
export const STOCK_FEE_DIV = 50;      // 수수료 = 거래액 / 50 (2%), 올림
export const HIST_SLOTS = 96;         // 가격 기록 칸 수 (5분 × 96 = 8시간. 굴림 번호 % 96 자리에 덮어쓴다)

export interface StockPrice { v: number; at: number; sa: number }
// q: 보유 수, a: 산 값의 합 (평단 표시용. 규칙은 보지 않는다). iq·ia: 하락 상품의 보유 수·산 값의 합. r: 실현 손익의 합 (순위 표시용. 규칙은 보지 않는다)
export interface StockHold { q?: number; a?: number; iq?: number; ia?: number; r?: number }

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
// 사고팔기 확인창 (2026-11-26, v62, 저장소 주인 요청). 확인창을 띄워 둔 사이에 가격이 바뀌었으면(굴림·반영) 거래하지 않는다:
// 창에 적힌 값과 다른 값에 사고팔게 된다. a: 물을 때의 가격, b: 지금 가격
export const sameQuote = (a: StockPrice | null | undefined, b: StockPrice | null | undefined): boolean => !!a && !!b && a.v === b.v && a.at === b.at && settled(b);
// 가진 have 주(산 값의 합 paid) 가운데 q 주를 1주 value 에 팔면 남는 돈 (받는 돈 − 그 주식을 산 값). 확인창에 보여 준다.
// 식은 StockMgr.sell 이 적는 실현 손익과 같다 (남은 것의 산 값을 반올림하고 나머지를 판 것의 산 값으로 본다)
export const sellGain = (q: number, value: number, have: number, paid: number): number => {
  const left = have - q, keep = left > 0 ? Math.max(0, Math.round(paid * (left / have))) : 0;
  return sellNet(q, value) - (paid - keep);
};
export const histIndex = (at: number): number => Math.floor(at / TICK_MS);
// 하락 상품의 값: 종목 가격이 내리면 오른다. 규칙의 (1000000 / v - 1000000 / v % 1) 과 같다
export const invPrice = (v: number): number => Math.floor(STOCK_INV_NUM / v);

// 손익 순위의 한 줄. open: 지금 들고 있는 것의 평가 손익(지금 팔면 받는 돈 − 산 값), real: 실현 손익, pct: 들고 있는 것의 수익률(%) 또는 null(든 것이 없다)
export interface StockRankRow { uid: string; cost: number; worth: number; open: number; real: number; total: number; pct: number | null; held: { sym: StockSym; q: number; iq: number }[] }
export function stockRank(all: Record<string, Partial<Record<StockSym, StockHold>> | null> | null | undefined, price: (sym: StockSym) => number): StockRankRow[] {
  const rows: StockRankRow[] = [];
  for (const [uid, hs] of Object.entries(all || {})) {
    let cost = 0, worth = 0, real = 0;
    const held: StockRankRow['held'] = [];
    for (const s of STOCKS) {
      const h = hs?.[s.sym];
      if (!h) continue;
      const v = price(s.sym), q = h.q || 0, iq = h.iq || 0;
      real += h.r || 0;
      if (v > 0 && q > 0) { cost += h.a || 0; worth += sellNet(q, v); }
      if (v > 0 && iq > 0) { cost += h.ia || 0; worth += sellNet(iq, invPrice(v)); }
      if (q > 0 || iq > 0) held.push({ sym: s.sym, q, iq });
    }
    if (!held.length && !real) continue; // 사고판 적이 없거나 기록을 남기기 전에 다 판 사람
    const open = worth - cost;
    rows.push({ uid, cost, worth, open, real, total: open + real, pct: cost > 0 ? (open / cost) * 100 : null, held });
  }
  return rows.sort((a, b) => b.total - a.total || (a.uid < b.uid ? -1 : 1));
}
