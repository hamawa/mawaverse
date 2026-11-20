// 거래소 판 (2026-11-19, 건의 반영). 종목마다 가격·변동·그래프·내 보유와 사기·팔기. 가격이 바뀌거나 내 보유·코인이 바뀔 때마다 다시 그린다
import { el } from '../shared/util';
import { modal, withCloseX } from './ui';
import { fmtCoins } from '../shared/shop';
import { STOCKS, STOCK_CAP, TICK_MS, buyCost, sellNet, settled, type StockSym } from '../shared/stock';
import type { StockMgr, HistPoint, TradeResult } from './stock';

export interface StockHost { stock: StockMgr; balance(): number; toast(msg: string, err?: boolean): void; onWallet(fn: () => void): () => void }

const QTYS = [1, 10, 100, STOCK_CAP];
const MSG: Record<Exclude<TradeResult, 'ok'>, string> = {
  wait: '가격이 바뀌는 중이에요. 잠깐 뒤에 다시 눌러 주세요.',
  coins: '코인이 모자랍니다.',
  cap: `한 종목은 ${STOCK_CAP}주까지만 가질 수 있어요.`,
  none: '그만큼 가지고 있지 않아요.',
  changed: '그 사이 가격이 바뀌었어요. 새 가격을 보고 다시 눌러 주세요.',
  fail: '거래하지 못했습니다. 잠시 후 다시 시도하세요.',
};
let open: { close: () => void } | null = null;

// 가격 그래프 (꺾은선). 오른 날은 빨강, 내린 날은 파랑 (한국 증시 빛깔)
function spark(points: number[]): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 150; cv.height = 40; cv.className = 'stock-spark';
  const c = cv.getContext('2d')!;
  if (points.length < 2) return cv;
  const lo = Math.min(...points), hi = Math.max(...points), span = Math.max(1, hi - lo);
  const x = (i: number) => 2 + (i / (points.length - 1)) * (cv.width - 4), y = (v: number) => cv.height - 4 - ((v - lo) / span) * (cv.height - 8);
  const up = points[points.length - 1] >= points[0];
  c.strokeStyle = up ? '#ff6b6b' : '#5aa9ff'; c.lineWidth = 1.5; c.beginPath();
  points.forEach((v, i) => (i ? c.lineTo(x(i), y(v)) : c.moveTo(x(i), y(v))));
  c.stroke();
  c.fillStyle = c.strokeStyle; c.beginPath(); c.arc(x(points.length - 1), y(points[points.length - 1]), 2.5, 0, Math.PI * 2); c.fill();
  return cv;
}

export function openStock(h: StockHost): void {
  if (open) return;
  const body = el('div', { class: 'stock' });
  const hist: Partial<Record<StockSym, HistPoint[]>> = {};
  let qty = 1, busy = false;
  const render = (): void => {
    body.innerHTML = '';
    const st = h.stock;
    const head = el('div', { class: 'shop-head' }, [
      el('div', { text: `잔액 ${fmtCoins(h.balance())}` }),
      el('div', { class: 'muted', text: nextText(st.untilNext()) }),
    ]);
    const pick = el('div', { class: 'row', style: 'gap:6px;margin:6px 0;align-items:center;flex-wrap:wrap' }, [el('span', { class: 'muted', text: '한 번에' })]);
    for (const n of QTYS) {
      const b = el('button', { class: 'btn small' + (n === qty ? ' primary' : ''), text: `${n}주` });
      b.dataset.q = String(n);
      b.onclick = () => { qty = n; render(); };
      pick.append(b);
    }
    body.append(head, pick);
    if (!STOCKS.some((s) => st.prices[s.sym])) { body.append(el('div', { class: 'muted', text: '거래소가 아직 열리지 않았어요.' })); return; }
    for (const s of STOCKS) {
      const p = st.prices[s.sym];
      if (!p) continue;
      const pts = (hist[s.sym] || []).map((x) => x.v);
      // 그래프의 마지막 점이 지금 가격이 아니면(판을 연 뒤에 가격이 바뀌었으면) 덧붙인다
      const line = pts.length && pts[pts.length - 1] === p.v ? pts : [...pts, p.v];
      const prev = line.length > 1 ? line[line.length - 2] : p.v;
      const diff = p.v - prev, pct = prev ? (diff / prev) * 100 : 0;
      const hold = st.holds[s.sym], q = hold?.q || 0, avg = q > 0 ? Math.round((hold?.a || 0) / q) : 0;
      const worth = q > 0 ? sellNet(q, p.v) : 0, gain = worth - (hold?.a || 0);
      const row = el('div', { class: 'stock-row' });
      const info = el('div', { class: 'stock-info' }, [
        el('div', { class: 'nm', text: `${s.icon} ${s.name}` }),
        el('div', { class: 'ds', text: s.desc }),
        el('div', { class: 'stock-price' }, [
          el('b', { text: p.v.toLocaleString('ko-KR') }),
          el('span', { class: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat', text: diff === 0 ? ' 그대로' : ` ${diff > 0 ? '▲' : '▼'} ${Math.abs(diff).toLocaleString('ko-KR')} (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)` }),
        ]),
        el('div', { class: 'ds', text: q > 0 ? `보유 ${q}주 · 평균 ${avg.toLocaleString('ko-KR')}에 삼 · 지금 팔면 ${gain >= 0 ? '+' : ''}${gain.toLocaleString('ko-KR')}` : '보유 없음' }),
      ]);
      const canBuy = Math.min(qty, STOCK_CAP - q), canSell = Math.min(qty, q);
      const buy = el('button', { class: 'btn small primary', text: canBuy > 0 ? `${canBuy}주 사기 ${fmtCoins(buyCost(canBuy, p.v))}` : `${STOCK_CAP}주 한도` });
      buy.dataset.buy = s.sym;
      buy.disabled = busy || canBuy <= 0 || !settled(p) || h.balance() < buyCost(canBuy, p.v);
      buy.onclick = () => void trade(() => st.buy(s.sym, canBuy), `${s.icon} ${s.name} ${canBuy}주를 샀어요.`);
      const sell = el('button', { class: 'btn small', text: canSell > 0 ? `${canSell}주 팔기 +${sellNet(canSell, p.v).toLocaleString('ko-KR')}` : '팔 것 없음' });
      sell.dataset.sell = s.sym;
      sell.disabled = busy || canSell <= 0 || !settled(p);
      sell.onclick = () => void trade(() => st.sell(s.sym, canSell), `${s.icon} ${s.name} ${canSell}주를 팔았어요.`);
      row.append(info, el('div', { class: 'stock-side' }, [spark(line.slice(-48)), el('div', { class: 'row', style: 'gap:6px;justify-content:flex-end;flex-wrap:wrap' }, [buy, sell])]));
      body.append(row);
    }
    body.append(el('div', { class: 'muted', style: 'font-size:12px;line-height:1.5;margin-top:8px', text: `가격은 ${TICK_MS / 60000}분마다 바뀌고, 다음 가격은 아무도 미리 알 수 없어요. 살 때와 팔 때 수수료 2%가 붙고, 한 종목은 ${STOCK_CAP}주까지 가질 수 있어요. 값이 떨어지면 산 돈을 잃을 수 있어요.` }));
  };
  const trade = async (fn: () => Promise<TradeResult>, okMsg: string): Promise<void> => {
    if (busy) return;
    busy = true; render();
    const r = await fn();
    busy = false;
    if (r === 'ok') h.toast(okMsg); else h.toast(MSG[r], true);
    render();
  };
  const offs = [h.stock.listen(render), h.onWallet(render)];
  const timer = window.setInterval(render, 5000); // 남은 시간 표시
  const m = modal('📈 거래소', body, [], true, () => { for (const off of offs) off(); clearInterval(timer); open = null; });
  m.root.querySelector('.actions')?.remove();
  withCloseX(m);
  open = m;
  render();
  // 그래프: 판을 열 때 한 번 읽는다
  for (const s of STOCKS) void h.stock.history(s.sym).then((list) => { hist[s.sym] = list; if (open === m) render(); });
}
function nextText(ms: number): string {
  if (ms <= 0) return '곧 가격이 바뀝니다';
  const sec = Math.ceil(ms / 1000);
  return `다음 변동까지 ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
