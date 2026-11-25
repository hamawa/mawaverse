// 거래소 (2026-11-19, 건의 반영): 가격 구독, 굴리기·반영, 사고팔기. 설계와 "왜 이렇게 하는가"는 shared/stock.ts 머리말.
// 가격은 서버가 아니라 접속해 있는 화면 가운데 하나가 굴린다(전부가 시도하고 먼저 쓴 쪽만 통과한다. 규칙이 간격과 식을 본다).
// 그래서 아무도 접속해 있지 않으면 가격은 멈춰 있고, 다음에 누가 들어오면 한 번 움직인다.
import { ref, onValue, update, increment, serverTimestamp, get } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import { sfx } from './audio';
import type { WorldCtx } from './state';
import { STOCKS, TICK_MS, STOCK_CAP, STOCK_INV_CAP, HIST_SLOTS, stepPrice, settled, buyCost, sellNet, histIndex, stockOf, invPrice, stockRank, type StockSym, type StockPrice, type StockHold, type StockRankRow } from '../shared/stock';

const CHECK_MS = 4000;       // 굴릴 때가 됐는지·반영이 밀렸는지 보는 간격
const ROLL_JITTER_MS = 6000; // 굴릴 때가 되면 이 안에서 저마다 다른 만큼 기다린다 (여럿이 한꺼번에 쓰면 한 명만 통과하고 나머지는 거부된 요청이 된다)
const SETTLE_WAIT_MS = 1200; // 굴린 직후에는 잠깐 기다렸다가 반영한다: 내가 굴린 at 은 처음엔 추정값으로 보이고 곧 서버 값으로 바뀐다

export type TradeResult = 'ok' | 'wait' | 'coins' | 'cap' | 'none' | 'changed' | 'fail';
export interface HistPoint { i: number; v: number }

export class StockMgr {
  prices: Partial<Record<StockSym, StockPrice>> = {};
  holds: Partial<Record<StockSym, StockHold>> = {};
  private unsubP: (() => void) | null = null;
  private unsubH: (() => void) | null = null;
  private timer = 0;
  private rollAt = 0;            // 이 시각(서버 시각) 이후에 굴리기를 시도한다
  private settleAfter = 0;       // 이 시각(내 시계) 이후에 반영을 시도한다
  private busy = false;
  private listeners = new Set<() => void>();
  constructor(private w: WorldCtx) {}

  start(): void {
    this.unsubP = onValue(ref(db, 'stock/p'), (s) => { this.prices = (s.val() as Partial<Record<StockSym, StockPrice>> | null) || {}; this.settleAfter = Math.max(this.settleAfter, performance.now() + 300 + Math.random() * SETTLE_WAIT_MS); this.emit(); }, () => {});
    this.unsubH = onValue(ref(db, `stock/h/${this.w.uid}`), (s) => { this.holds = (s.val() as Partial<Record<StockSym, StockHold>> | null) || {}; this.emit(); }, () => {});
    this.timer = window.setInterval(() => void this.tick(), CHECK_MS);
  }
  stop(): void {
    this.unsubP?.(); this.unsubH?.(); this.unsubP = this.unsubH = null;
    if (this.timer) { clearInterval(this.timer); this.timer = 0; }
    this.listeners.clear();
  }
  listen(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(): void { for (const fn of this.listeners) fn(); }

  price(sym: StockSym): number { return this.prices[sym]?.v ?? 0; }
  held(sym: StockSym): number { return this.holds[sym]?.q ?? 0; }
  // 하락 상품 (2026-11-25): 값은 종목 가격에서 나온다 (가격이 내리면 오른다)
  heldInv(sym: StockSym): number { return this.holds[sym]?.iq ?? 0; }
  invPrice(sym: StockSym): number { const v = this.price(sym); return v > 0 ? invPrice(v) : 0; }
  // 다음 가격 변동까지 남은 시간 (ms. 가장 늦게 굴린 종목 기준. 값이 없으면 0)
  untilNext(): number {
    const ats = STOCKS.map((s) => this.prices[s.sym]?.at ?? 0).filter((t) => t > 0);
    return ats.length ? Math.max(0, Math.min(...ats) + TICK_MS - serverNow()) : 0;
  }

  // 굴릴 때가 된 종목은 굴리고(at = 지금), 굴렸는데 반영이 안 된 종목은 반영한다(v = 다음 가격, sa = at). 어느 화면이 해도 결과는 같다: 규칙이 식을 본다
  private async tick(): Promise<void> {
    if (this.busy || !this.w.online) return;
    const list = STOCKS.map((s) => ({ s, p: this.prices[s.sym] })).filter((x): x is { s: typeof STOCKS[number]; p: StockPrice } => !!x.p && typeof x.p.v === 'number');
    if (!list.length) return;
    const now = serverNow();
    const pending = list.filter((x) => !settled(x.p));
    if (pending.length) {
      if (performance.now() < this.settleAfter) return;
      const upd: Record<string, unknown> = {}, rec: Record<string, unknown> = {};
      for (const { s, p } of pending) {
        const v = stepPrice(p.v, p.at, s.sym), i = histIndex(p.at);
        upd[`stock/p/${s.sym}/v`] = v; upd[`stock/p/${s.sym}/sa`] = p.at;
        rec[`stock/hist/${s.sym}/${i % HIST_SLOTS}`] = { i, v };
      }
      this.busy = true;
      // 그래프용 기록은 따로 쓴다: 기록 쓰기가 어떤 이유로든 거부돼도 가격 반영은 멈추지 않게
      try { await update(ref(db), upd); void update(ref(db), rec).catch(() => {}); } catch { /* 다른 화면이 먼저 반영했다 */ } finally { this.busy = false; }
      return;
    }
    const due = list.filter((x) => now >= x.p.at + TICK_MS + 300);
    if (!due.length) { this.rollAt = 0; return; }
    if (!this.rollAt) { this.rollAt = now + Math.random() * ROLL_JITTER_MS; return; }
    if (now < this.rollAt) return;
    this.rollAt = 0;
    const upd: Record<string, unknown> = {};
    for (const { s } of due) upd[`stock/p/${s.sym}/at`] = serverTimestamp();
    this.busy = true;
    try { await update(ref(db), upd); this.settleAfter = performance.now() + SETTLE_WAIT_MS; } catch { /* 다른 화면이 먼저 굴렸다 */ } finally { this.busy = false; }
  }

  // 사기: 코인이 값 × 수량 + 수수료만큼 줄고 보유가 는다 (쓰기 한 번. 규칙이 금액을 본다). inv: 하락 상품 (값 = invPrice(가격), 보유 칸 iq·ia)
  async buy(sym: StockSym, q: number, inv = false): Promise<TradeResult> {
    const p = this.prices[sym];
    if (!p || !stockOf(sym) || q < 1 || q % 1 !== 0) return 'fail';
    if (!settled(p)) return 'wait';
    if ((inv ? this.heldInv(sym) : this.held(sym)) + q > (inv ? STOCK_INV_CAP : STOCK_CAP)) return 'cap';
    const cost = buyCost(q, inv ? invPrice(p.v) : p.v);
    if (this.w.wallet.balance < cost) return 'coins';
    const base = `stock/h/${this.w.uid}/${sym}`;
    try {
      await update(ref(db), { [`wallet/${this.w.uid}/c`]: increment(-cost), [`${base}/${inv ? 'iq' : 'q'}`]: increment(q), [`${base}/${inv ? 'ia' : 'a'}`]: increment(cost) });
      sfx('coin');
      return 'ok';
    } catch { return this.prices[sym]?.v !== p.v || !settled(this.prices[sym]) ? 'changed' : 'fail'; }
  }
  // 팔기: 보유가 줄고 코인이 값 × 수량 − 수수료만큼 는다. 지갑 규칙에 맞게 획득(e)도 같이 올린다.
  // 실현 손익(r = 받은 돈 − 판 주식을 산 값)도 같은 쓰기에 더한다: 손익 순위에 쓰는 표시용 값이다 (규칙이 대조하지 않는다)
  async sell(sym: StockSym, q: number, inv = false): Promise<TradeResult> {
    const p = this.prices[sym], h = this.holds[sym];
    if (!p || !stockOf(sym) || q < 1 || q % 1 !== 0) return 'fail';
    const have = (inv ? h?.iq : h?.q) || 0, paid = (inv ? h?.ia : h?.a) || 0;
    if (have < q) return 'none';
    if (!settled(p)) return 'wait';
    const net = sellNet(q, inv ? invPrice(p.v) : p.v);
    const left = have - q, a = left > 0 ? Math.max(0, Math.round(paid * (left / have))) : 0; // 남은 것의 산 값 (평단은 그대로)
    const base = `stock/h/${this.w.uid}/${sym}`;
    try {
      await update(ref(db), {
        [`wallet/${this.w.uid}/c`]: increment(net), [`wallet/${this.w.uid}/e`]: increment(net),
        [`${base}/${inv ? 'iq' : 'q'}`]: increment(-q), [`${base}/${inv ? 'ia' : 'a'}`]: a, [`${base}/r`]: increment(net - (paid - a)),
      });
      sfx('coin');
      return 'ok';
    } catch { return this.prices[sym]?.v !== p.v || !settled(this.prices[sym]) ? 'changed' : 'fail'; }
  }
  // 손익 순위 (2026-11-25): 모두의 보유를 한 번 읽어 지금 가격으로 줄 세운다 (판에서 순위를 열 때만. 구독하지 않는다)
  async ranking(): Promise<StockRankRow[]> {
    try {
      const all = (await get(ref(db, 'stock/h'))).val() as Record<string, Partial<Record<StockSym, StockHold>>> | null;
      return stockRank(all, (sym) => this.price(sym));
    } catch { return []; }
  }
  // 가격 기록 (그래프용): 판을 열 때 한 번 읽는다. 굴림 번호 순으로, 너무 오래된 것(8시간 넘게 지난 칸)은 뺀다
  async history(sym: StockSym): Promise<HistPoint[]> {
    try {
      const raw = (await get(ref(db, `stock/hist/${sym}`))).val() as Record<string, HistPoint> | HistPoint[] | null;
      const cur = histIndex(serverNow());
      return Object.values(raw || {}).filter((x): x is HistPoint => !!x && typeof x.i === 'number' && typeof x.v === 'number' && x.i > cur - HIST_SLOTS && x.i <= cur).sort((a, b) => a.i - b.i);
    } catch { return []; }
  }
}
