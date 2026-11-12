// 1:1 내기: 주사위 대결 (2026-11-12). 설계와 규칙 검증은 shared/duel.ts 머리말.
// 신청하는 쪽: 캐릭터 메뉴 → 판돈 고르기 → duel/{id} 만들기 + 판돈 내기 + 상대에게 초대(duelInv/{상대}) 를 쓰기 한 번에 → 수락을 기다린다
// 받는 쪽: duelInv/{내 uid} 를 보고 수락/거절 창. 수락하면 판돈 내기 + acc(서버 시각) 를 쓰기 한 번에
// 결과는 acc 로 정해지고(둘 다 같은 주사위를 본다), 이긴 사람의 화면이 정산한다. 정산 전에 나가도 다음 접속 때 받는다(recover)
import { ref, push, get, update, remove, onValue, query, orderByChild, endAt, limitToFirst, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import { el } from '../shared/util';
import { betMax } from '../shared/casino';
import { fmtCoins } from '../shared/shop';
import { DUEL_MIN, DUEL_ACCEPT_MS, DUEL_KEEP_MS, duelFee, duelPayout, duelWinner, duelDice, duelExpired, type Duel, type DuelInvite } from '../shared/duel';
import { modal } from './ui';
import type { WorldCtx } from './state';

const DICE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const num = (n: number): string => Math.floor(n).toLocaleString('ko-KR');
const OPT_KEY = (uid: string) => `mv-noduel-${uid}`;

export class DuelMgr {
  private unsubs: (() => void)[] = [];
  private busy = false;                    // 신청했거나 수락 창이 떠 있거나 주사위가 구르는 중
  private shown = new Set<string>();       // 결과 창을 띄운 내기 (같은 내기를 두 번 보여 주지 않게)
  private optOut = false;
  // 내기 신청을 받지 않는다는 표시를 접속 표시(presence)에 싣는 일은 world 가 넘겨준다
  constructor(private w: WorldCtx, private setNoDuel: (on: boolean) => void) {}

  start(): void {
    const w = this.w;
    try { this.optOut = localStorage.getItem(OPT_KEY(w.uid)) === '1'; } catch { /* ignore */ }
    if (this.optOut) this.setNoDuel(true);
    this.unsubs.push(onValue(ref(db, `duelInv/${w.uid}`), (s) => { const inv = s.val() as DuelInvite | null; if (inv) void this.onInvite(inv); }, () => {}));
    void this.recover();
  }
  stop(): void { for (const u of this.unsubs) u(); this.unsubs = []; }

  optedOut(): boolean { return this.optOut; }
  setOptOut(on: boolean): void {
    this.optOut = on;
    try { if (on) localStorage.setItem(OPT_KEY(this.w.uid), '1'); else localStorage.removeItem(OPT_KEY(this.w.uid)); } catch { /* ignore */ }
    this.setNoDuel(on);
  }

  private fee(): number { return duelFee(this.w.config.duelFee); }

  // ---- 신청하는 쪽 ----
  // 캐릭터 메뉴에서: 판돈을 고르는 창
  openChallenge(uid: string): void {
    const w = this.w;
    const rp = w.players.get(uid);
    if (!rp) { w.toast('상대가 접속해 있지 않습니다.', true); return; }
    if (this.busy) { w.toast('진행 중인 내기가 있습니다.', true); return; }
    if (w.me.roomId) { w.toast('방 안에서는 내기를 신청할 수 없습니다.', true); return; }
    if (rp.st.r) { w.toast(`${rp.st.n} 님은 방 안에 있어 신청할 수 없습니다.`, true); return; }
    if (rp.st.nd) { w.toast(`${rp.st.n} 님은 내기 신청을 받지 않습니다.`, true); return; }
    const max = betMax(w.config.casinoMax), fee = this.fee();
    let stake = Math.min(1000, max);
    const body = el('div', { class: 'duel-pick' });
    const info = el('p', { class: 'muted' });
    const amts = el('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' });
    const paint = () => {
      info.textContent = `판돈 ${fmtCoins(stake)} 씩 걸고 주사위를 굴립니다. 이기면 ${fmtCoins(duelPayout(stake, fee))} (수수료 ${fee}%). 상대가 20초 안에 수락하지 않으면 돌려받습니다.`;
      amts.querySelectorAll('button').forEach((b) => b.classList.toggle('primary', Number(b.dataset.a) === stake));
    };
    const options = [100, 500, 1000, 3000, 5000, 10000].filter((a) => a <= max);
    if (!options.includes(max)) options.push(max);
    for (const a of options) { const b = el('button', { class: 'btn small', 'data-a': String(a), text: num(a) }); b.onclick = () => { stake = a; paint(); }; amts.append(b); }
    body.append(el('p', { text: `🎲 ${rp.st.n} 님에게 주사위 대결을 신청합니다.` }), amts, info);
    paint();
    modal('🎲 주사위 대결', body, [{ label: '취소', onClick: () => {} }, { label: '신청', primary: true, onClick: () => { void this.challenge(uid, stake); } }]);
  }

  private async challenge(uid: string, stake: number): Promise<void> {
    const w = this.w;
    const rp = w.players.get(uid);
    if (!rp || this.busy) return;
    if (stake < DUEL_MIN || w.wallet.balance < stake) { w.toast('코인이 모자랍니다.', true); return; }
    this.busy = true;
    const id = push(ref(db, 'duel')).key!;
    const duel = { a: w.uid, b: uid, an: w.profile.nick, bn: rp.st.n, k: 'dice', s: stake, o: serverTimestamp() };
    const inv = { id, f: w.uid, fn: w.profile.nick, s: stake, k: 'dice', t: serverTimestamp() };
    if (!(await w.wallet.duelStake(id, stake, { [`duel/${id}`]: duel, [`duelInv/${uid}`]: inv }))) {
      this.busy = false;
      w.toast('신청하지 못했습니다. 상대가 다른 신청을 받는 중이거나 접속해 있지 않을 수 있어요.', true);
      return;
    }
    w.toast(`🎲 ${rp.st.n} 님에게 주사위 대결을 신청했습니다. (판돈 ${num(stake)})`);
    this.waitFor(id);
  }

  // 내가 신청한 내기를 지켜본다: 수락되면 주사위, 거절·시간 초과면 돌려받는다
  private waitFor(id: string): void {
    const w = this.w;
    let done = false, timer = 0;
    const finish = () => { done = true; off(); clearInterval(timer); };
    const check = (d: Duel | null) => {
      if (done) return;
      if (!d || d.paid) { finish(); this.busy = false; return; }
      if (d.acc) { finish(); void this.play(id, d); return; }
      if (d.no || duelExpired(d, serverNow())) {
        finish();
        void w.wallet.duelClaim(id, d.s).then((ok) => { this.busy = false; if (ok) w.toast(d.no ? `🎲 ${d.bn} 님이 내기를 거절했습니다. 판돈을 돌려받았습니다.` : `🎲 ${d.bn} 님이 수락하지 않아 판돈을 돌려받았습니다.`); });
      }
    };
    let last: Duel | null = null;
    const off = onValue(ref(db, `duel/${id}`), (s) => { last = s.val() as Duel | null; check(last); }, () => {});
    timer = window.setInterval(() => { if (last) check(last); }, 1000); // 시간 초과는 값이 바뀌지 않아도 봐야 한다
  }

  // ---- 받는 쪽 ----
  private async onInvite(inv: DuelInvite): Promise<void> {
    const w = this.w;
    if (!inv || typeof inv.id !== 'string' || this.shown.has(inv.id)) return;
    this.shown.add(inv.id);
    const left = inv.t + DUEL_ACCEPT_MS - serverNow();
    if (left < 2000) { remove(ref(db, `duelInv/${w.uid}`)).catch(() => {}); return; } // 지나간 초대
    // 받을 수 없는 상태면 바로 거절한다 (신청한 사람이 기다리지 않게)
    if (this.busy || this.optOut || w.me.roomId || w.wallet.balance < inv.s) { await this.decline(inv.id); return; }
    this.busy = true;
    const fee = this.fee();
    const body = el('div');
    const count = el('b');
    body.append(el('p', { text: `🎲 ${inv.fn} 님이 주사위 대결을 신청했습니다.` }), el('p', { class: 'muted', text: `판돈 ${fmtCoins(inv.s)} 씩. 이기면 ${fmtCoins(duelPayout(inv.s, fee))} (수수료 ${fee}%)` }), el('p', { class: 'muted' }, [count]));
    let answered = false;
    const m = modal('🎲 주사위 대결 신청', body, [
      { label: '거절', onClick: () => { answered = true; clearInterval(timer); void this.decline(inv.id).then(() => { this.busy = false; }); } },
      { label: '수락', primary: true, onClick: () => { answered = true; clearInterval(timer); void this.accept(inv); } },
    ], false, () => { if (!answered) { answered = true; clearInterval(timer); void this.decline(inv.id).then(() => { this.busy = false; }); } }); // Esc 로 닫으면 거절
    const tick = () => {
      const l = Math.max(0, Math.ceil((inv.t + DUEL_ACCEPT_MS - serverNow()) / 1000));
      count.textContent = `${l}초 안에 정해 주세요`;
      if (l <= 0 && !answered) { answered = true; clearInterval(timer); m.close(); void this.decline(inv.id).then(() => { this.busy = false; }); }
    };
    const timer = window.setInterval(tick, 500);
    tick();
  }

  private async decline(id: string): Promise<void> {
    await update(ref(db), { [`duel/${id}/no`]: true, [`duelInv/${this.w.uid}`]: null }).catch(() => remove(ref(db, `duelInv/${this.w.uid}`)).catch(() => {}));
  }

  private async accept(inv: DuelInvite): Promise<void> {
    const w = this.w;
    const ok = await w.wallet.duelStake(inv.id, inv.s, { [`duel/${inv.id}/acc`]: serverTimestamp(), [`duelInv/${w.uid}`]: null });
    if (!ok) { w.toast('수락하지 못했습니다. (시간이 지났거나 코인이 모자랍니다)', true); await this.decline(inv.id); this.busy = false; return; }
    const d = (await get(ref(db, `duel/${inv.id}`))).val() as Duel | null; // 서버가 적은 acc
    if (!d?.acc) { this.busy = false; return; }
    await this.play(inv.id, d);
  }

  // ---- 주사위 ----
  private async play(id: string, d: Duel): Promise<void> {
    const w = this.w;
    if (!d.acc) return;
    const me: 'a' | 'b' = d.a === w.uid ? 'a' : 'b';
    const winner = duelWinner(d.acc), [da, db2] = duelDice(d.acc);
    const won = winner === me;
    const fee = this.fee(), pay = duelPayout(d.s, fee);
    // 굴리는 창
    const body = el('div', { class: 'duel-roll' });
    const left = el('div', { class: 'side' }, [el('div', { class: 'nm', text: d.an }), el('div', { class: 'die', text: '🎲' })]);
    const right = el('div', { class: 'side' }, [el('div', { class: 'nm', text: d.bn }), el('div', { class: 'die', text: '🎲' })]);
    const res = el('p', { class: 'res', text: '주사위를 굴립니다…' });
    body.append(el('div', { class: 'row', style: 'justify-content:space-around' }, [left, el('div', { class: 'vs', text: 'VS' }), right]), res);
    modal('🎲 주사위 대결', body, [{ label: '닫기', onClick: () => {} }]);
    const dl = left.querySelector('.die') as HTMLElement, dr = right.querySelector('.die') as HTMLElement;
    const start = performance.now();
    await new Promise<void>((done) => {
      const tick = () => {
        const t = performance.now() - start;
        dl.textContent = t >= 1100 ? DICE[da] : DICE[1 + Math.floor(Math.random() * 6)];
        dr.textContent = t >= 1700 ? DICE[db2] : DICE[1 + Math.floor(Math.random() * 6)];
        if (t >= 1700) done(); else window.setTimeout(tick, 80);
      };
      tick();
    });
    (winner === 'a' ? left : right).classList.add('win');
    const winNick = winner === 'a' ? d.an : d.bn;
    res.textContent = won ? `${da} : ${db2} · 이겼다! 💰 +${num(pay)}` : `${da} : ${db2} · ${winNick} 님 승리. 판돈 ${num(d.s)}코인을 잃었습니다.`;
    if (won) {
      const ok = await w.wallet.duelClaim(id, pay);
      if (ok) w.toast(`🎲 주사위 대결 승리! 💰 +${num(pay)}`);
      else res.textContent += ' (정산을 못 했어요. 다시 접속하면 받습니다)';
    }
    w.events.emit('log', { channel: 'sys', from: '', text: `🎲 주사위 대결 ${d.an} ${da} : ${db2} ${d.bn} · ${won ? `승리 💰+${num(pay)}` : `패배 (판돈 ${num(d.s)})`}`, ts: serverNow() });
    this.busy = false;
    void this.cleanupOld();
  }

  // 접속할 때: 마지막으로 판돈을 낸 내기(지갑 dl)를 아직 정산하지 않았으면 살펴본다 (이겼는데 못 받았거나, 신청해 둔 채 나갔거나)
  private async recover(): Promise<void> {
    const w = this.w;
    await new Promise<void>((res) => { if (w.wallet.loaded) res(); else { const off = w.wallet.listen(() => { if (w.wallet.loaded) { off(); res(); } }); } });
    const id = w.wallet.wallet.dl;
    if (!id || w.wallet.wallet.dc === id) return;
    try {
      const d = (await get(ref(db, `duel/${id}`))).val() as Duel | null;
      if (!d || d.paid) return;
      const me: 'a' | 'b' = d.a === w.uid ? 'a' : 'b';
      if (d.acc) {
        if (duelWinner(d.acc) !== me) return;
        const pay = duelPayout(d.s, this.fee());
        if (await w.wallet.duelClaim(id, pay)) w.toast(`🎲 지난 주사위 대결의 💰 ${num(pay)} 을 받았습니다.`);
      } else if (me === 'a') {
        if (d.no || duelExpired(d, serverNow())) { if (await w.wallet.duelClaim(id, d.s)) w.toast(`🎲 수락되지 않은 내기의 판돈 💰 ${num(d.s)} 을 돌려받았습니다.`); }
        else { this.busy = true; this.waitFor(id); }
      }
    } catch { /* ignore */ }
  }

  // 하루 지난 내기 정리 (아무나)
  private async cleanupOld(): Promise<void> {
    try {
      const s = await get(query(ref(db, 'duel'), orderByChild('o'), endAt(serverNow() - DUEL_KEEP_MS), limitToFirst(5)));
      const upd: Record<string, null> = {};
      s.forEach((c) => { upd[`duel/${c.key}`] = null; });
      if (Object.keys(upd).length) await update(ref(db), upd);
    } catch { /* ignore */ }
  }
}

