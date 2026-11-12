// 슬롯 방 판 (2026-11-12): 슬롯 방에 들어가 있는 동안 뜨는 패널. 탭 두 개: 🎰 슬롯 · 🎲 홀짝. 결과 계산과 규칙 검증 설계는 shared/slots.ts.
// 경마 판과 같은 자리·같은 모양을 쓴다(#casino 의 스타일을 그대로 받는다. 방은 한 번에 하나만 들어가므로 두 판이 같이 뜨지 않는다). 모바일은 화면 전체.
// 흐름: 돌리기/홀·짝 → 지갑 베팅 쓰기(서버 시각 it) → 그 시각으로 결과가 정해진다 → 그림을 돌린 뒤 정산 쓰기. 정산 전에 나가면 다음 접속 때 받는다(WalletMgr.settlePendingInstant)
import { ref, onValue, push, set, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/app';
import { el } from '../shared/util';
import { BET_STEP, betMax } from '../shared/casino';
import { fmtCoins } from '../shared/shop';
import { INSTANT_MIN, JACKPOT_MIN_BET, SLOT_TIERS, slotReels, slotResult, oddEvenFace, oddEvenParity, ODD_EVEN_NUM, ODD_EVEN_DEN } from '../shared/slots';
import type { RouletteFeed } from '../shared/roulette';
import type { WalletMgr } from './wallet';
import type { ServerConfig } from '../shared/types';

export interface SlotHost { uid: string; profile: { nick: string }; wallet: WalletMgr; config: ServerConfig; toast(msg: string, err?: boolean): void; leaveCasino(): Promise<void>; chat: { systemMessage(text: string): void } }

const SPIN_MS = 1300;                       // 그림이 도는 시간
const SPIN_ICONS = ['🍒', '🍋', '🔔', '🍇', '⭐', '🍉', '7️⃣', '🍀'];
const DICE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const num = (n: number): string => Math.floor(n).toLocaleString('ko-KR');
const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

export class SlotPanel {
  private root: HTMLElement | null = null;
  private offs: (() => void)[] = [];
  private tab: 'slot' | 'oe' = 'slot';
  private amount = 100;
  private busy = false;
  private pool = 0;                         // 잭팟에 쌓인 금액 (slot/jp)
  private streak = 0;                       // 홀짝 연승
  private lastWin = 0;                      // 방금 딴 돈 (홀짝 "그대로 다시 걸기")
  private msg = '';                         // 결과 한 줄
  private reels: [string, string, string] = ['🍒', '🔔', '🍋'];
  private face = 0;                         // 홀짝에서 마지막에 나온 수
  constructor(private h: SlotHost) {}

  get open(): boolean { return !!this.root; }

  show(): void {
    if (this.root) return;
    const root = el('div', { id: 'casino', class: 'slots' });
    (document.getElementById('app') || document.body).append(root);
    document.body.classList.add('in-casino');
    this.root = root;
    this.offs.push(onValue(ref(db, 'slot/jp'), (s) => { this.pool = Number(s.val()) || 0; this.paintPool(); }, () => {}));
    this.offs.push(this.h.wallet.listen(() => { if (!this.busy) this.render(); }));
    this.msg = '';
    this.render();
    // 돌리는 중에 방을 나갔다 다시 들어온 경우 등: 정산 안 한 판이 있으면 받는다
    if (this.h.wallet.instantPending()) void this.finish(false);
  }
  hide(): void {
    if (!this.root) return;
    for (const off of this.offs) off();
    this.offs = [];
    this.root.remove(); this.root = null;
    document.body.classList.remove('in-casino');
  }

  private max(): number { return betMax(this.h.config.casinoMax); }
  private paintPool(): void {
    const e = this.root?.querySelector('.jp b');
    if (e) e.textContent = num(this.pool);
  }

  private render(): void {
    const root = this.root; if (!root) return;
    const max = this.max();
    this.amount = Math.max(INSTANT_MIN, Math.min(max, this.amount));
    root.innerHTML = '';
    const out = el('button', { class: 'btn small out', text: '🚪 나가기', title: '슬롯 방에서 나가기' });
    out.onclick = () => { out.disabled = true; void this.h.leaveCasino().finally(() => { out.disabled = false; }); };
    root.append(el('div', { class: 'ch' }, [el('b', { text: '🎰 슬롯 방' }), el('span', { class: 'cnt' }), out]));
    const tabs = el('div', { class: 'tabs' });
    for (const [id, label] of [['slot', '🎰 슬롯'], ['oe', '🎲 홀짝']] as const) {
      const b = el('button', { class: 'btn small' + (this.tab === id ? ' on' : ''), text: label });
      b.disabled = this.busy;
      b.onclick = () => { if (this.busy || this.tab === id) return; this.tab = id; this.msg = ''; this.render(); };
      tabs.append(b);
    }
    root.append(tabs);
    if (this.tab === 'slot') this.renderSlot(root); else this.renderOddEven(root);
  }

  // 금액 고르기 (경마 판과 같은 모양)
  private amounts(): HTMLElement {
    const max = this.max();
    const amts = el('div', { class: 'amts' });
    const options = [100, 500, 1000, 3000, 5000, 10000].filter((a) => a <= max);
    if (!options.includes(max)) options.push(max);
    for (const a of options) {
      const b = el('button', { class: 'btn small' + (a === this.amount ? ' on' : ''), text: a.toLocaleString('ko-KR') });
      b.disabled = this.busy;
      b.onclick = () => { this.amount = a; this.render(); };
      amts.append(b);
    }
    const custom = el('input', { type: 'number', min: String(INSTANT_MIN), max: String(max), step: String(BET_STEP), value: String(this.amount), title: '직접 입력 (100 단위)' });
    custom.disabled = this.busy;
    custom.onchange = () => { const v = Math.round((Number(custom.value) || 0) / BET_STEP) * BET_STEP; this.amount = Math.max(INSTANT_MIN, Math.min(max, v)); this.render(); };
    custom.addEventListener('keydown', (e) => e.stopPropagation());
    amts.append(custom);
    return amts;
  }

  private renderSlot(root: HTMLElement): void {
    const jp = el('div', { class: 'jp' });
    jp.append('💎 잭팟 ', el('b', { text: num(this.pool) }), ` 코인 · ${num(JACKPOT_MIN_BET)}코인 이상 걸면 도전`);
    const reels = el('div', { class: 'reels' });
    for (const s of this.reels) reels.append(el('span', { text: s }));
    const res = el('div', { class: 'res', text: this.msg || '세 칸이 맞으면 당첨!' });
    const go = el('button', { class: 'btn primary go', text: `돌리기 (${num(this.amount)}코인)` });
    go.disabled = this.busy || this.h.wallet.balance < this.amount;
    go.onclick = () => { void this.spin(); };
    let prev = 0;
    const table = SLOT_TIERS.slice(1).map((t, i) => { const p = ((t.below - (i === 0 ? SLOT_TIERS[0].below : prev)) / 99.73).toFixed(1); prev = t.below; return `${t.icon} ${t.name} ×${t.mult} (${p}%)`; }).join(' · ');
    root.append(jp, reels, res, el('div', { class: 'sub', text: `베팅액 (잔액 ${fmtCoins(this.h.wallet.balance)})` }), this.amounts(), go, el('div', { class: 'sub pay', text: table }));
  }

  private renderOddEven(root: HTMLElement): void {
    const die = el('div', { class: 'reels die' }, [el('span', { text: this.face ? DICE[this.face] : '🎲' })]);
    const res = el('div', { class: 'res', text: this.msg || `홀·짝을 맞히면 ${ODD_EVEN_NUM / ODD_EVEN_DEN}배!` });
    const row = el('div', { class: 'picks' });
    for (const [pick, label] of [[1, '홀 (1·3·5)'], [0, '짝 (2·4·6)']] as const) {
      const b = el('button', { class: 'btn primary go', text: label });
      b.disabled = this.busy || this.h.wallet.balance < this.amount;
      b.onclick = () => { void this.roll(pick); };
      row.append(b);
    }
    root.append(die, res, el('div', { class: 'sub', text: `베팅액 (잔액 ${fmtCoins(this.h.wallet.balance)})${this.streak > 1 ? ` · 🔥 ${this.streak}연승` : ''}` }), this.amounts(), row);
    // 방금 딴 돈을 그대로 다시 걸기 (100 단위로 내리고 한도까지)
    const again = Math.min(this.max(), Math.floor(this.lastWin / BET_STEP) * BET_STEP);
    if (again >= INSTANT_MIN && again !== this.amount) {
      const b = el('button', { class: 'btn small', text: `🔥 딴 돈 그대로 다시 걸기 (${num(again)}코인)` });
      b.disabled = this.busy;
      b.onclick = () => { this.amount = again; this.render(); };
      root.append(b);
    }
  }

  // 슬롯 한 판
  private async spin(): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.msg = ''; this.render();
    const bet = this.amount;
    const at = await this.h.wallet.instantBet('s', bet);
    if (at === null) { this.busy = false; this.msg = '베팅하지 못했어요. (코인이 모자라거나 너무 빨리 눌렀어요)'; this.render(); return; }
    const final = slotReels(at, bet);
    // 그림 돌리기: 칸마다 차례로 멈춘다
    const spans = [...(this.root?.querySelectorAll('.reels span') || [])] as HTMLElement[];
    const start = performance.now();
    const stops = [SPIN_MS * 0.5, SPIN_MS * 0.75, SPIN_MS];
    await new Promise<void>((done) => {
      const tick = () => {
        const t = performance.now() - start;
        spans.forEach((sp, i) => { sp.textContent = t >= stops[i] ? final[i] : SPIN_ICONS[Math.floor(Math.random() * SPIN_ICONS.length)]; });
        if (t >= SPIN_MS) done(); else window.setTimeout(tick, 70);
      };
      tick();
    });
    this.reels = final;
    await this.finish(true);
  }

  // 홀짝 한 판. pick: 1 홀 · 0 짝
  private async roll(pick: 0 | 1): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.msg = ''; this.render();
    const at = await this.h.wallet.instantBet('o', this.amount, pick);
    if (at === null) { this.busy = false; this.msg = '베팅하지 못했어요. (코인이 모자라거나 너무 빨리 눌렀어요)'; this.render(); return; }
    const face = oddEvenFace(at);
    const sp = this.root?.querySelector('.reels span') as HTMLElement | null;
    const start = performance.now();
    while (performance.now() - start < SPIN_MS * 0.7) { if (sp) sp.textContent = DICE[1 + Math.floor(Math.random() * 6)]; await wait(80); }
    this.face = face;
    await this.finish(true);
  }

  // 정산하고 결과를 알린다. fresh: 방금 돌린 판 (아니면 지난번에 못 받은 판)
  private async finish(fresh: boolean): Promise<void> {
    const h = this.h;
    const r = await h.wallet.instantSettle();
    this.busy = false;
    if (!r) { if (fresh) this.msg = '정산하지 못했어요. 다시 들어오면 받을 수 있어요.'; this.render(); return; }
    if (r.kind === 's') {
      const res = slotResult(r.at, r.bet);
      this.reels = slotReels(r.at, r.bet);
      if (r.jackpot) { this.msg = `💎 잭팟!! +${num(r.win)}코인`; this.feed('jp', r.win); h.toast(`💎 잭팟!! 💰 +${num(r.win)}`); }
      else if (r.win > 0) { this.msg = `${SLOT_TIERS[res.tier].icon} ${SLOT_TIERS[res.tier].name}! +${num(r.win)}코인`; if (res.mult >= 50) this.feed('777', r.win); }
      else this.msg = '꽝… 다시 한 번!';
      if (r.jackpot || res.mult >= 10) h.chat.systemMessage(`🎰 슬롯 ${num(r.bet)}코인 → ${r.jackpot ? '잭팟' : SLOT_TIERS[res.tier].name} 💰+${num(r.win)}`); // 큰 당첨만 채팅창에 남긴다 (판마다 남기면 도배)
    } else {
      const parity = oddEvenParity(r.at);
      this.face = oddEvenFace(r.at);
      if (r.win > 0) { this.streak++; this.lastWin = r.win; this.msg = `${this.face} ${parity ? '홀' : '짝'}! 맞혔다 +${num(r.win)}코인`; }
      else { this.streak = 0; this.lastWin = 0; this.msg = `${this.face} ${parity ? '홀' : '짝'}… 틀렸다`; }
    }
    this.render();
  }

  // 잭팟·트리플 세븐은 모두에게 알린다 (오늘의 룰렛 공지와 같은 길)
  private feed(k: 'jp' | '777', v: number): void {
    if (v < 500) return;
    const f: RouletteFeed = { u: this.h.uid, n: this.h.profile.nick, v, ts: serverTimestamp() as unknown as number, k };
    set(push(ref(db, 'roulette/feed')), f).catch(() => {});
  }
}
