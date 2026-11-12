// 1:1 내기 (2026-11-12): 주사위 대결과 낚시 내기. 설계와 규칙 검증은 shared/duel.ts 머리말.
// 신청하는 쪽: 캐릭터 메뉴 → 판돈 고르기 → duel/{id} 만들기 + 판돈 내기 + 상대에게 초대(duelInv/{상대}) 를 쓰기 한 번에 → 수락을 기다린다
// 받는 쪽: duelInv/{내 uid} 를 보고 수락/거절 창. 수락하면 판돈 내기 + acc(서버 시각) 를 쓰기 한 번에
// 주사위: 결과는 acc 로 정해지고(둘 다 같은 주사위를 본다) 이긴 사람의 화면이 정산한다.
// 낚시: 수락 뒤 5분 동안 각자 잡은 가장 큰 물고기의 크기를 duel/{id}/fa·fb 에 적는다(onCatch). 시간이 끝나면 큰 쪽이 정산, 같으면 각자 환불.
// 정산 전에 나가도 다음 접속 때 받는다(recover)
import { ref, push, get, set, update, remove, onValue, query, orderByChild, endAt, limitToFirst, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import { el } from '../shared/util';
import { betMax } from '../shared/casino';
import { fmtCoins } from '../shared/shop';
import { fmtSize } from '../shared/fish';
import { DUEL_MIN, DUEL_ACCEPT_MS, DUEL_KEEP_MS, DUEL_FISH_MS, duelFee, duelPayout, duelWinner, duelDice, duelExpired, duelMaxStake, fishDuelClosed, fishDuelWinner, type Duel, type DuelInvite, type DuelKind } from '../shared/duel';
import { modal } from './ui';
import type { WorldCtx } from './state';

const DICE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const num = (n: number): string => Math.floor(n).toLocaleString('ko-KR');
const OPT_KEY = (uid: string) => `mv-noduel-${uid}`;
const KIND: Record<DuelKind, { icon: string; name: string }> = { dice: { icon: '🎲', name: '주사위 대결' }, fish: { icon: '🎣', name: '낚시 내기' } };

export class DuelMgr {
  private unsubs: (() => void)[] = [];
  private busy = false;                    // 신청했거나 수락 창이 떠 있거나 내기가 진행 중
  private shown = new Set<string>();       // 초대 창을 띄운 내기 (같은 초대를 두 번 보여 주지 않게)
  private optOut = false;
  // 진행 중인 낚시 내기
  private fish: { id: string; d: Duel; side: 'a' | 'b'; off: () => void; timer: number; bar: HTMLElement; ending: boolean } | null = null;
  // 내기 신청을 받지 않는다는 표시를 접속 표시(presence)에 싣는 일은 world 가 넘겨준다
  constructor(private w: WorldCtx, private setNoDuel: (on: boolean) => void) {}

  start(): void {
    const w = this.w;
    try { this.optOut = localStorage.getItem(OPT_KEY(w.uid)) === '1'; } catch { /* ignore */ }
    if (this.optOut) this.setNoDuel(true);
    this.unsubs.push(onValue(ref(db, `duelInv/${w.uid}`), (s) => { const inv = s.val() as DuelInvite | null; if (inv) void this.onInvite(inv); }, () => {}));
    void this.recover();
  }
  stop(): void { for (const u of this.unsubs) u(); this.unsubs = []; this.endFishUi(); }

  optedOut(): boolean { return this.optOut; }
  setOptOut(on: boolean): void {
    this.optOut = on;
    try { if (on) localStorage.setItem(OPT_KEY(this.w.uid), '1'); else localStorage.removeItem(OPT_KEY(this.w.uid)); } catch { /* ignore */ }
    this.setNoDuel(on);
  }

  private fee(): number { return duelFee(this.w.config.duelFee); }
  private rule(kind: DuelKind, stake: number): string {
    const fee = this.fee(), pay = fmtCoins(duelPayout(stake, fee));
    return kind === 'fish'
      ? `판돈 ${fmtCoins(stake)} 씩 걸고 ${DUEL_FISH_MS / 60000}분 동안 낚시합니다. 더 큰 물고기를 잡은 쪽이 ${pay} (수수료 ${fee}%). 크기가 같거나 둘 다 못 잡으면 돌려받습니다.`
      : `판돈 ${fmtCoins(stake)} 씩 걸고 주사위를 굴립니다. 이기면 ${pay} (수수료 ${fee}%).`;
  }

  // ---- 신청하는 쪽 ----
  // 캐릭터 메뉴에서: 판돈을 고르는 창
  openChallenge(uid: string, kind: DuelKind = 'dice'): void {
    const w = this.w, K = KIND[kind];
    const rp = w.players.get(uid);
    if (!rp) { w.toast('상대가 접속해 있지 않습니다.', true); return; }
    if (this.busy) { w.toast('진행 중인 내기가 있습니다.', true); return; }
    if (w.me.roomId) { w.toast('방 안에서는 내기를 신청할 수 없습니다.', true); return; }
    if (rp.st.r) { w.toast(`${rp.st.n} 님은 방 안에 있어 신청할 수 없습니다.`, true); return; }
    if (rp.st.nd) { w.toast(`${rp.st.n} 님은 내기 신청을 받지 않습니다.`, true); return; }
    const max = duelMaxStake(kind, betMax(w.config.casinoMax));
    let stake = Math.min(1000, max);
    const body = el('div', { class: 'duel-pick' });
    const info = el('p', { class: 'muted' });
    const amts = el('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' });
    const paint = () => {
      info.textContent = `${this.rule(kind, stake)} 상대가 20초 안에 수락하지 않으면 돌려받습니다.`;
      amts.querySelectorAll('button').forEach((b) => b.classList.toggle('primary', Number(b.dataset.a) === stake));
    };
    const options = [100, 500, 1000, 3000, 5000, 10000].filter((a) => a <= max);
    if (!options.includes(max)) options.push(max);
    for (const a of options) { const b = el('button', { class: 'btn small', 'data-a': String(a), text: num(a) }); b.onclick = () => { stake = a; paint(); }; amts.append(b); }
    body.append(el('p', { text: `${K.icon} ${rp.st.n} 님에게 ${K.name}를 신청합니다.` }), amts, info);
    paint();
    modal(`${K.icon} ${K.name}`, body, [{ label: '취소', onClick: () => {} }, { label: '신청', primary: true, onClick: () => { void this.challenge(uid, stake, kind); } }]);
  }

  private async challenge(uid: string, stake: number, kind: DuelKind): Promise<void> {
    const w = this.w, K = KIND[kind];
    const rp = w.players.get(uid);
    if (!rp || this.busy) return;
    if (stake < DUEL_MIN || w.wallet.balance < stake) { w.toast('코인이 모자랍니다.', true); return; }
    this.busy = true;
    const id = push(ref(db, 'duel')).key!;
    const duel = { a: w.uid, b: uid, an: w.profile.nick, bn: rp.st.n, k: kind, s: stake, o: serverTimestamp() };
    const inv = { id, f: w.uid, fn: w.profile.nick, s: stake, k: kind, t: serverTimestamp() };
    if (!(await w.wallet.duelStake(id, stake, { [`duel/${id}`]: duel, [`duelInv/${uid}`]: inv }))) {
      this.busy = false;
      w.toast('신청하지 못했습니다. 상대가 다른 신청을 받는 중이거나 접속해 있지 않을 수 있어요.', true);
      return;
    }
    w.toast(`${K.icon} ${rp.st.n} 님에게 ${K.name}를 신청했습니다. (판돈 ${num(stake)})`);
    this.waitFor(id);
  }

  // 내가 신청한 내기를 지켜본다: 수락되면 시작, 거절·시간 초과면 돌려받는다
  private waitFor(id: string): void {
    const w = this.w;
    let done = false, timer = 0;
    const finish = () => { done = true; off(); clearInterval(timer); };
    const check = (d: Duel | null) => {
      if (done) return;
      if (!d || d.paid) { finish(); this.busy = false; return; }
      if (d.acc) { finish(); void this.begin(id, d); return; }
      if (d.no || duelExpired(d, serverNow())) {
        finish();
        const K = KIND[d.k] || KIND.dice;
        void w.wallet.duelClaim(id, d.s).then((ok) => { this.busy = false; if (ok) w.toast(d.no ? `${K.icon} ${d.bn} 님이 내기를 거절했습니다. 판돈을 돌려받았습니다.` : `${K.icon} ${d.bn} 님이 수락하지 않아 판돈을 돌려받았습니다.`); });
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
    const kind: DuelKind = inv.k === 'fish' ? 'fish' : 'dice', K = KIND[kind];
    // 받을 수 없는 상태면 바로 거절한다 (신청한 사람이 기다리지 않게)
    if (this.busy || this.optOut || w.me.roomId || w.wallet.balance < inv.s) { await this.decline(inv.id); return; }
    this.busy = true;
    const body = el('div');
    const count = el('b');
    body.append(el('p', { text: `${K.icon} ${inv.fn} 님이 ${K.name}를 신청했습니다.` }), el('p', { class: 'muted', text: this.rule(kind, inv.s) }), el('p', { class: 'muted' }, [count]));
    let answered = false;
    const m = modal(`${K.icon} ${K.name} 신청`, body, [
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
    await this.begin(inv.id, d);
  }

  // 수락됐다: 종류에 따라 시작
  private begin(id: string, d: Duel): Promise<void> { return d.k === 'fish' ? this.startFish(id, d) : this.play(id, d); }

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

  // ---- 낚시 내기 ----
  // 위쪽에 작은 띠를 띄우고(남은 시간, 내 최고·상대 최고) 내기 노드를 지켜본다. 물고기를 잡으면 onCatch 가 내 최고 크기를 적는다
  private async startFish(id: string, d: Duel): Promise<void> {
    const w = this.w;
    if (!d.acc || this.fish) return;
    const side: 'a' | 'b' = d.a === w.uid ? 'a' : 'b';
    this.busy = true;
    const bar = el('div', { id: 'duel-bar' });
    (document.getElementById('hud') || document.body).append(bar);
    const f = { id, d, side, off: () => {}, timer: 0, bar, ending: false };
    this.fish = f;
    f.off = onValue(ref(db, `duel/${id}`), (s) => { const v = s.val() as Duel | null; if (v) { f.d = v; this.paintFish(); } }, () => {});
    f.timer = window.setInterval(() => { this.paintFish(); if (fishDuelClosed(f.d, serverNow()) && !f.ending) { f.ending = true; void this.endFish(); } }, 500);
    this.paintFish();
    const opp = side === 'a' ? d.bn : d.an;
    w.toast(`🎣 ${opp} 님과 낚시 내기 시작! ${DUEL_FISH_MS / 60000}분 동안 더 큰 물고기를 잡으세요.`);
    w.events.emit('log', { channel: 'sys', from: '', text: `🎣 ${opp} 님과 낚시 내기 시작 (판돈 ${num(d.s)}, ${DUEL_FISH_MS / 60000}분)`, ts: serverNow() });
  }
  private paintFish(): void {
    const f = this.fish; if (!f) return;
    const d = f.d, mine = (f.side === 'a' ? d.fa : d.fb) || 0, theirs = (f.side === 'a' ? d.fb : d.fa) || 0;
    const left = Math.max(0, (d.acc || 0) + DUEL_FISH_MS - serverNow());
    const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
    const time = left > 0 ? `${mm}:${ss < 10 ? '0' : ''}${ss}` : '집계 중…';
    f.bar.textContent = `🎣 낚시 내기 vs ${f.side === 'a' ? d.bn : d.an} · ${time} · 나 ${mine ? fmtSize(mine) : '-'} / 상대 ${theirs ? fmtSize(theirs) : '-'}`;
    f.bar.classList.toggle('lead', mine > theirs);
  }
  // 물고기를 잡았다 (fishing.ts 가 부른다): 내기 시간 안이고 내 최고보다 크면 적는다
  onCatch(size: number): void {
    const f = this.fish;
    if (!f || !(size > 0) || !f.d.acc || serverNow() > f.d.acc + DUEL_FISH_MS) return;
    const key = f.side === 'a' ? 'fa' : 'fb';
    if (size <= (f.d[key] || 0)) return;
    f.d = { ...f.d, [key]: size }; // 바로 다음 물고기와 견줄 수 있게 먼저 기억한다
    set(ref(db, `duel/${f.id}/${key}`), size).then(() => this.w.toast(`🎣 내기 기록 갱신! ${fmtSize(size)}`), () => {});
    this.paintFish();
  }
  private endFishUi(): void {
    const f = this.fish; if (!f) return;
    f.off(); clearInterval(f.timer); f.bar.remove();
    this.fish = null;
  }
  // 시간이 끝났다: 마지막 값을 다시 읽어 승패를 정하고 내 몫을 받는다
  private async endFish(): Promise<void> {
    const f = this.fish; if (!f) return;
    // 여유 시간(DUEL_FISH_GRACE_MS)까지 적힌 마지막 값을 다시 읽는다
    const d = ((await get(ref(db, `duel/${f.id}`)).catch(() => null))?.val() as Duel | null) || f.d;
    this.endFishUi();
    await this.settleFish(f.id, d, true);
    this.busy = false;
    void this.cleanupOld();
  }
  private async settleFish(id: string, d: Duel, announce: boolean): Promise<void> {
    const w = this.w;
    const me: 'a' | 'b' = d.a === w.uid ? 'a' : 'b';
    const res = fishDuelWinner(d), pay = duelPayout(d.s, this.fee());
    const mine = (me === 'a' ? d.fa : d.fb) || 0, theirs = (me === 'a' ? d.fb : d.fa) || 0;
    const score = `나 ${mine ? fmtSize(mine) : '못 잡음'} : 상대 ${theirs ? fmtSize(theirs) : '못 잡음'}`;
    let text: string;
    if (res === 'tie') {
      const got = d[me === 'a' ? 'ra' : 'rb'] ? true : await w.wallet.duelClaim(id, d.s, me === 'a' ? 'ra' : 'rb');
      text = `🎣 낚시 내기 비김 (${score}). ${got ? `판돈 ${num(d.s)}코인을 돌려받았습니다.` : '판돈은 다시 접속하면 돌려받습니다.'}`;
    } else if (res === me) {
      const got = d.paid ? true : await w.wallet.duelClaim(id, pay);
      text = `🎣 낚시 내기 승리! (${score}) ${got ? `💰 +${num(pay)}` : '정산은 다시 접속하면 받습니다.'}`;
    } else text = `🎣 낚시 내기 패배 (${score}). 판돈 ${num(d.s)}코인을 잃었습니다.`;
    if (!announce) { if (res === me || res === 'tie') w.toast(text); return; }
    w.toast(text, res !== me && res !== 'tie');
    w.events.emit('log', { channel: 'sys', from: '', text, ts: serverNow() });
  }

  // 접속할 때: 마지막으로 판돈을 낸 내기(지갑 dl)를 아직 정산하지 않았으면 살펴본다 (이겼는데 못 받았거나, 신청해 둔 채 나갔거나, 낚시 내기 도중이었거나)
  private async recover(): Promise<void> {
    const w = this.w;
    await new Promise<void>((res) => { if (w.wallet.loaded) res(); else { const off = w.wallet.listen(() => { if (w.wallet.loaded) { off(); res(); } }); } });
    const id = w.wallet.wallet.dl;
    if (!id || w.wallet.wallet.dc === id) return;
    try {
      const d = (await get(ref(db, `duel/${id}`))).val() as Duel | null;
      if (!d || d.paid) return;
      const me: 'a' | 'b' = d.a === w.uid ? 'a' : 'b';
      if (d.acc && d.k === 'fish') {
        if (fishDuelClosed(d, serverNow())) await this.settleFish(id, d, false);
        else await this.startFish(id, d); // 아직 시간 안이다: 이어서 한다
      } else if (d.acc) {
        if (duelWinner(d.acc) !== me) return;
        const pay = duelPayout(d.s, this.fee());
        if (await w.wallet.duelClaim(id, pay)) w.toast(`🎲 지난 주사위 대결의 💰 ${num(pay)} 을 받았습니다.`);
      } else if (me === 'a') {
        if (d.no || duelExpired(d, serverNow())) { if (await w.wallet.duelClaim(id, d.s)) w.toast(`수락되지 않은 내기의 판돈 💰 ${num(d.s)} 을 돌려받았습니다.`); }
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
