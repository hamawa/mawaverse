// 카지노 경마 판 (2026-11-09): 카지노 방 안에 있는 동안 오른쪽에 떠 있는 패널. 모바일은 화면 전체를 덮는다(채팅창과 위쪽 표시만 남긴다. 2026-11-12).
// 방 안에서는 캐릭터가 자리에 고정되므로 나갈 때는 이 판의 나가기 버튼을 쓴다. 말 5마리 중 하나에 100~최대치(100 단위)를 건다.
// 첫 배팅부터 20초 뒤 마감 → 8초 경주(모든 화면 동일, 시드 = 마감 서버 시각) → 결과·배당. 한 라운드에 한 번만.
import { el } from '../shared/util';
import { confirmModal } from './ui';
import { HORSES, HORSE_COUNT, BET_MIN, BET_STEP, RACE_MS, PAYOUT, betMax, payoutOf, raceProgress, winnerOf } from '../shared/casino';
import { fmtCoins } from '../shared/shop';
import type { CasinoMgr } from './casino';
import type { WalletMgr } from './wallet';
import type { ServerConfig } from '../shared/types';

export interface CasinoHost { uid: string; wallet: WalletMgr; config: ServerConfig; casino: CasinoMgr; toast(msg: string, err?: boolean): void; leaveCasino(): Promise<void> }

export class CasinoPanel {
  private root: HTMLElement | null = null;
  private off: (() => void) | null = null;
  private amount = 100;
  private raf = 0;
  private canvas: HTMLCanvasElement | null = null;
  private lastSig = '';
  constructor(private h: CasinoHost) {}

  get open(): boolean { return !!this.root; }

  show(): void {
    if (this.root) return;
    const root = el('div', { id: 'casino' });
    (document.getElementById('app') || document.body).append(root); // #app 안에 넣어야 모바일에서 위쪽 표시·채팅창(#hud)이 판 위에 남는다 (#app 은 fixed 라 쌓임 맥락이 따로다)
    document.body.classList.add('in-casino'); // 모바일: 판이 화면을 덮는 동안 조이스틱·버튼을 숨긴다 (styles.css)
    this.root = root;
    this.off = this.h.casino.listen(() => this.render(true));
    const offW = this.h.wallet.listen(() => this.render(true));
    const off = this.off; this.off = () => { off(); offW(); };
    this.render(true);
    const loop = () => { if (!this.root) return; this.render(false); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  hide(): void {
    if (!this.root) return;
    cancelAnimationFrame(this.raf);
    this.off?.(); this.off = null;
    this.root.remove(); this.root = null; this.canvas = null;
    document.body.classList.remove('in-casino');
  }

  // force: 구조를 다시 그린다. 아니면 숫자(남은 시간)와 경주 캔버스만 갱신
  private render(force: boolean): void {
    const root = this.root; if (!root) return;
    const st = this.h.casino.state();
    const sig = `${st.rid}|${st.phase}|${JSON.stringify(st.round?.bets || {})}|${st.claimed}|${this.amount}|${this.h.wallet.balance}`;
    if (!force && sig === this.lastSig) { this.tickDynamic(st.leftMs, st.phase); return; }
    this.lastSig = sig;
    root.innerHTML = '';
    const max = betMax(this.h.config.casinoMax);
    const head = el('div', { class: 'ch' });
    const out = el('button', { class: 'btn small out', text: '🚪 나가기', title: '카지노에서 나가기' });
    out.onclick = () => { out.disabled = true; void this.h.leaveCasino().finally(() => { out.disabled = false; }); };
    head.append(el('b', { text: '🏇 경마' }), el('span', { class: 'cnt', id: 'casino-left' }), out);
    root.append(head);
    const sub = el('div', { class: 'sub' });
    if (st.phase === 'none') sub.textContent = `말을 골라 배팅하면 20초 뒤 출발! 맞히면 ${PAYOUT}배. 한 번에 ${BET_MIN.toLocaleString('ko-KR')}~${max.toLocaleString('ko-KR')}코인`;
    else if (st.phase === 'open') sub.textContent = st.myBet ? `${HORSES[st.myBet.h].name}에 ${st.myBet.a.toLocaleString('ko-KR')}코인 걸었어요. 마감을 기다리는 중…` : '배팅 중! 말을 고르세요';
    else if (st.phase === 'racing') sub.textContent = '달린다!';
    else if (st.winner !== null) sub.textContent = `${HORSES[st.winner].icon} ${HORSES[st.winner].name} 우승!` + (st.myBet ? (st.myBet.h === st.winner ? ` 💰 +${payoutOf(st.myBet.a).toLocaleString('ko-KR')}` : ' 아쉽다…') : '') + ' · 다시 배팅하면 새 경주';
    root.append(sub);
    // 경주 트랙
    const cv = document.createElement('canvas'); cv.width = 300; cv.height = HORSE_COUNT * 22 + 8; cv.className = 'track';
    this.canvas = cv; root.append(cv);
    // 말 목록 + 배팅 버튼
    const bets = Object.values(st.round?.bets || {});
    const canBet = (st.phase === 'none' || st.phase === 'done' || (st.phase === 'open' && !st.myBet)) && st.leftMs > 1500 || st.phase === 'none' || st.phase === 'done';
    const list = el('div', { class: 'horses' });
    for (let i = 0; i < HORSE_COUNT; i++) {
      const hs = HORSES[i];
      const row = el('div', { class: 'horse' + (st.myBet?.h === i ? ' mine' : '') + (st.phase === 'done' && st.winner === i ? ' win' : '') });
      const who = bets.filter((b) => b.h === i).map((b) => `${b.n} ${b.a}`).join(', ');
      row.append(el('span', { class: 'ic', text: hs.icon, style: `color:${hs.color}` }), el('span', { class: 'nm', text: `${i + 1}. ${hs.name}`, style: `color:${hs.color}` }), el('span', { class: 'who', text: who }));
      const b = el('button', { class: 'btn small primary', text: '배팅' });
      b.disabled = !canBet || this.h.wallet.balance < this.amount;
      b.onclick = async () => {
        b.disabled = true;
        if (!(await confirmModal(`${hs.icon} ${hs.name}에 ${fmtCoins(this.amount)}을 걸까요? 맞히면 ${fmtCoins(payoutOf(this.amount))}`))) { this.render(true); return; }
        const r = await this.h.casino.bet(i, this.amount);
        if (r === 'ok') this.h.toast(`🏇 ${hs.name}에 ${this.amount.toLocaleString('ko-KR')}코인!`);
        else if (r === 'coins') this.h.toast('코인이 모자랍니다.', true);
        else if (r === 'late') this.h.toast('마감 직전이라 다음 경주에 걸어 주세요.', true);
        else if (r === 'dup') this.h.toast('이번 경주에는 이미 걸었어요.', true);
        else this.h.toast('배팅하지 못했어요.', true);
        this.render(true);
      };
      row.append(b);
      list.append(row);
    }
    root.append(list);
    // 금액
    const amts = el('div', { class: 'amts' });
    const options = [100, 500, 1000, 3000, 5000, 10000].filter((a) => a <= max); // 최대 10,000 (2026-11-10)
    if (!options.includes(max)) options.push(max);
    for (const a of options) {
      const b = el('button', { class: 'btn small' + (a === this.amount ? ' on' : ''), text: a.toLocaleString('ko-KR') });
      b.onclick = () => { this.amount = a; this.render(true); };
      amts.append(b);
    }
    const custom = el('input', { type: 'number', min: String(BET_MIN), max: String(max), step: String(BET_STEP), value: String(this.amount), title: '직접 입력 (100 단위)' });
    custom.onchange = () => { const v = Math.round((Number(custom.value) || 0) / BET_STEP) * BET_STEP; this.amount = Math.max(BET_MIN, Math.min(max, v)); this.render(true); };
    amts.append(custom);
    root.append(el('div', { class: 'sub', text: `배팅액 (잔액 ${fmtCoins(this.h.wallet.balance)})` }), amts);
    this.tickDynamic(st.leftMs, st.phase);
    this.drawTrack(st.phase, st.round?.at, st.winner);
  }

  private tickDynamic(leftMs: number, phase: string): void {
    const c = this.root?.querySelector('#casino-left');
    if (c) c.textContent = phase === 'open' ? `마감까지 ${Math.ceil(leftMs / 1000)}초` : phase === 'racing' ? '🏁 경주 중' : phase === 'done' ? '결과' : '대기 중';
    const st = this.h.casino.state();
    this.drawTrack(st.phase, st.round?.at, st.winner);
  }

  private drawTrack(phase: string, at: number | undefined, winner: number | null): void {
    const cv = this.canvas; if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const W = cv.width, laneH = 22;
    ctx.clearRect(0, 0, W, cv.height);
    ctx.fillStyle = 'rgba(60, 40, 20, 0.6)'; ctx.fillRect(0, 0, W, cv.height);
    // 결승선
    ctx.fillStyle = '#ffffff'; for (let y = 0; y < cv.height; y += 6) ctx.fillRect(W - 14, y, 4, 3);
    const start = this.h.casino.raceStart();
    let t = 0;
    if (phase === 'racing' && start) t = Math.min(1, (performance.now() - start) / RACE_MS);
    else if (phase === 'done') t = 1;
    for (let i = 0; i < HORSE_COUNT; i++) {
      const y = 4 + i * laneH;
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'; ctx.fillRect(0, y, W, laneH);
      const p = at !== undefined && (phase === 'racing' || phase === 'done') ? raceProgress(at, i, t) : 0;
      const x = 6 + p * (W - 34);
      ctx.font = '16px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(HORSES[i].icon, x, y + laneH / 2 + (phase === 'racing' ? Math.sin(performance.now() / 60 + i) * 1.5 : 0));
      ctx.font = 'bold 10px sans-serif'; ctx.fillStyle = HORSES[i].color; ctx.fillText(String(i + 1), x - 4, y + laneH / 2 - 7);
      if (phase === 'done' && winner === i) { ctx.font = '12px sans-serif'; ctx.fillStyle = '#ffd84d'; ctx.fillText('🏆', x + 18, y + laneH / 2); }
    }
    if (phase === 'done' && at !== undefined && winner === null) winnerOf(at); // (타입 참조용)
  }
}
