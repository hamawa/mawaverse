// 거래소 판 (2026-11-19, 건의 반영). 종목마다 가격·변동·그래프·내 보유와 사기·팔기. 가격이 바뀌거나 내 보유·코인이 바뀔 때마다 다시 그린다
// 2026-11-25 (건의 반영): 탭 셋으로 나눴다. 📈 종목 · 📉 하락 상품(종목의 가격이 내리면 오른다) · 📊 손익 순위(모두의 평가·실현 손익).
// 하락 상품을 종목 칸 안에 한 줄씩 덧붙였더니 폰에서 화면이 1.5배로 길어져서 탭으로 갈랐다: 탭마다 길이는 전과 같다
import { el } from '../shared/util';
import { modal, withCloseX } from './ui';
import { fmtCoins } from '../shared/shop';
import { STOCKS, STOCK_CAP, STOCK_INV_CAP, TICK_MS, buyCost, sellNet, settled, invPrice, stockOf, type StockDef, type StockSym, type StockRankRow } from '../shared/stock';
import type { StockMgr, HistPoint, TradeResult } from './stock';

// nickOf: 순위에 나온 사람의 닉네임 (접속해 있지 않은 사람은 한 번 읽는다. 못 읽으면 null)
export interface StockHost { stock: StockMgr; uid: string; balance(): number; toast(msg: string, err?: boolean): void; onWallet(fn: () => void): () => void; nickOf(uid: string): Promise<string | null> }

type View = 'base' | 'inv' | 'rank';
const TABS: { id: View; label: string }[] = [{ id: 'base', label: '📈 종목' }, { id: 'inv', label: '📉 하락 상품' }, { id: 'rank', label: '📊 손익 순위' }];
const QTYS: Record<'base' | 'inv', number[]> = { base: [1, 10, 100, STOCK_CAP], inv: [1, 10, 100, STOCK_INV_CAP] };
const MSG: Record<Exclude<TradeResult, 'ok'>, string> = {
  wait: '가격이 바뀌는 중이에요. 잠깐 뒤에 다시 눌러 주세요.',
  coins: '코인이 모자랍니다.',
  cap: `한 종목은 ${STOCK_CAP}주까지만 가질 수 있어요.`,
  none: '그만큼 가지고 있지 않아요.',
  changed: '그 사이 가격이 바뀌었어요. 새 가격을 보고 다시 눌러 주세요.',
  fail: '거래하지 못했습니다. 잠시 후 다시 시도하세요.',
};
const INV_CAP_MSG = `하락 상품은 한 종목에 ${STOCK_INV_CAP}주까지만 가질 수 있어요.`;
const num = (n: number): string => n.toLocaleString('ko-KR');
const signed = (n: number): string => `${n >= 0 ? '+' : ''}${num(n)}`;
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
  const nicks = new Map<string, string>();
  const qtyOf = { base: 1, inv: 1 };
  let busy = false;
  let view: View = 'base';
  let rank: StockRankRow[] | null = null;
  const render = (): void => {
    body.innerHTML = '';
    const st = h.stock;
    const head = el('div', { class: 'shop-head' }, [
      el('div', { text: `잔액 ${fmtCoins(h.balance())}` }),
      el('div', { class: 'muted', text: nextText(st.untilNext()) }),
    ]);
    const tabs = el('div', { class: 'tabs', style: 'margin-bottom:8px' });
    for (const t of TABS) {
      const b = el('button', { class: t.id === view ? 'active' : '', text: t.label });
      b.dataset.view = t.id;
      b.onclick = () => { if (t.id === 'rank') showRank(); else { view = t.id; render(); } };
      tabs.append(b);
    }
    body.append(head, tabs);
    if (view === 'rank') { renderRank(); return; }
    const inv = view === 'inv', qty = qtyOf[view];
    const pick = el('div', { class: 'row', style: 'gap:6px;margin:6px 0;align-items:center;flex-wrap:wrap' }, [el('span', { class: 'muted', text: '한 번에' })]);
    for (const n of QTYS[view]) {
      const b = el('button', { class: 'btn small' + (n === qty ? ' primary' : ''), text: `${n}주` });
      b.dataset.q = String(n);
      b.onclick = () => { qtyOf[inv ? 'inv' : 'base'] = n; render(); };
      pick.append(b);
    }
    body.append(pick);
    if (!STOCKS.some((s) => st.prices[s.sym])) { body.append(el('div', { class: 'muted', text: '거래소가 아직 열리지 않았어요.' })); return; }
    for (const s of STOCKS) { const row = card(s, inv, qty); if (row) body.append(row); }
    const common = `가격은 ${TICK_MS / 60000}분마다 바뀌고, 다음 가격은 아무도 미리 알 수 없어요. 살 때와 팔 때 수수료 2%가 붙어요.`;
    body.append(el('div', { class: 'muted', style: 'font-size:12px;line-height:1.5;margin-top:8px', text: inv
      ? `하락 상품은 그 종목의 가격이 내리면 값이 오르고, 가격이 오르면 값이 내려요 (값 = 1,000,000 ÷ 가격). ${common} 한 종목에 ${STOCK_INV_CAP}주까지 가질 수 있어요. 종목이 오르면 산 돈을 잃을 수 있어요.`
      : `${common} 한 종목은 ${STOCK_CAP}주까지 가질 수 있어요. 값이 떨어지면 산 돈을 잃을 수 있어요. 내릴 것 같으면 📉 하락 상품 탭을 보세요.` }));
  };
  // 종목 한 칸. inv: 그 종목의 하락 상품 (값 = invPrice(가격). 그래프도 그 값으로 그린다)
  const card = (s: StockDef, inv: boolean, qty: number): HTMLElement | null => {
    const st = h.stock, p = st.prices[s.sym];
    if (!p) return null;
    const val = (v: number): number => (inv ? invPrice(v) : v);
    const pts = (hist[s.sym] || []).map((x) => x.v);
    // 그래프의 마지막 점이 지금 가격이 아니면(판을 연 뒤에 가격이 바뀌었으면) 덧붙인다
    const line = (pts.length && pts[pts.length - 1] === p.v ? pts : [...pts, p.v]).map(val);
    const now = val(p.v), prev = line.length > 1 ? line[line.length - 2] : now;
    const diff = now - prev, pct = prev ? (diff / prev) * 100 : 0;
    const hold = st.holds[s.sym], q = (inv ? hold?.iq : hold?.q) || 0, paid = (inv ? hold?.ia : hold?.a) || 0;
    const cap = inv ? STOCK_INV_CAP : STOCK_CAP;
    const label = inv ? `📉 ${s.name} 하락` : `${s.icon} ${s.name}`;
    const row = el('div', { class: 'stock-row' });
    const info = el('div', { class: 'stock-info' }, [
      el('div', { class: 'nm', text: label }),
      el('div', { class: 'ds', text: inv ? `${s.icon} ${s.name}의 가격이 내리면 오른다.` : s.desc }),
      el('div', { class: 'stock-price' }, [
        el('b', { text: num(now) }),
        el('span', { class: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat', text: diff === 0 ? ' 그대로' : ` ${diff > 0 ? '▲' : '▼'} ${num(Math.abs(diff))} (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)` }),
      ]),
      el('div', { class: 'ds', text: q > 0 ? `보유 ${q}주 · 평균 ${num(Math.round(paid / q))}에 삼 · 지금 팔면 ${signed(sellNet(q, now) - paid)}` : '보유 없음' }),
    ]);
    const canBuy = Math.min(qty, cap - q), canSell = Math.min(qty, q);
    const buy = el('button', { class: 'btn small primary', text: canBuy > 0 ? `${canBuy}주 사기 ${fmtCoins(buyCost(canBuy, now))}` : `${cap}주 한도` });
    buy.dataset.buy = s.sym;
    buy.disabled = busy || canBuy <= 0 || !settled(p) || h.balance() < buyCost(canBuy, now);
    buy.onclick = () => void trade(() => st.buy(s.sym, canBuy, inv), `${label} ${canBuy}주를 샀어요.`, inv ? INV_CAP_MSG : undefined);
    const sell = el('button', { class: 'btn small', text: canSell > 0 ? `${canSell}주 팔기 +${num(sellNet(canSell, now))}` : '팔 것 없음' });
    sell.dataset.sell = s.sym;
    sell.disabled = busy || canSell <= 0 || !settled(p);
    sell.onclick = () => void trade(() => st.sell(s.sym, canSell, inv), `${label} ${canSell}주를 팔았어요.`);
    row.append(info, el('div', { class: 'stock-side' }, [spark(line.slice(-48)), el('div', { class: 'row', style: 'gap:6px;justify-content:flex-end;flex-wrap:wrap' }, [buy, sell])]));
    return row;
  };
  // 손익 순위: 열 때마다 모두의 보유를 한 번 읽는다
  const renderRank = (): void => {
    body.append(el('div', { class: 'muted', style: 'font-size:12px;line-height:1.5;margin-bottom:8px', text: '지금 들고 있는 것을 팔면 남는 돈(평가)과 이미 팔아서 남긴 돈(실현)을 더한 순위예요. 실현 손익은 2026년 11월 25일부터 쌓여요.' }));
    if (!rank) { body.append(el('div', { class: 'muted', text: '순위를 읽는 중…' })); return; }
    if (!rank.length) { body.append(el('div', { class: 'muted', text: '아직 사고판 사람이 없어요.' })); return; }
    rank.forEach((r, i) => {
      const held = r.held.flatMap((x) => {
        const s = stockOf(x.sym)!;
        return [x.q > 0 ? `${s.icon} ${x.q}주` : '', x.iq > 0 ? `${s.icon}📉 ${x.iq}주` : ''].filter(Boolean);
      });
      const parts = [held.length ? held.join(' · ') : '보유 없음'];
      if (r.cost > 0) parts.push(`평가 ${signed(r.open)} (${r.pct! > 0 ? '+' : ''}${r.pct!.toFixed(1)}%)`);
      if (r.real) parts.push(`실현 ${signed(r.real)}`);
      body.append(el('div', { class: 'stock-rank' + (r.uid === h.uid ? ' me' : '') }, [
        el('span', { class: 'no', text: String(i + 1) }),
        el('div', { class: 'who' }, [el('div', { class: 'nm', text: nicks.get(r.uid) ?? '…' }), el('div', { class: 'ds', text: parts.join(' · ') })]),
        el('b', { class: 'sum ' + (r.total > 0 ? 'up' : r.total < 0 ? 'down' : ''), text: signed(r.total) }),
      ]));
    });
  };
  const showRank = (): void => {
    view = 'rank'; rank = null; render();
    void h.stock.ranking().then(async (rows) => {
      await Promise.all(rows.filter((r) => !nicks.has(r.uid)).map(async (r) => { nicks.set(r.uid, (await h.nickOf(r.uid).catch(() => null)) ?? '(알 수 없음)'); }));
      rank = rows;
      if (open === m && view === 'rank') render();
    });
  };
  const trade = async (fn: () => Promise<TradeResult>, okMsg: string, capMsg?: string): Promise<void> => {
    if (busy) return;
    busy = true; render();
    const r = await fn();
    busy = false;
    if (r === 'ok') h.toast(okMsg); else h.toast(r === 'cap' && capMsg ? capMsg : MSG[r], true);
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
