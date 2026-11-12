// 인디언 포커 진행 (2026-11-12). 설계와 규칙 검증은 shared/poker.ts 머리말.
// 포커 방 안에 있는 동안만 테이블(pkt)과 그 판(pkh)을 구독한다. 내가 낀 판은 500ms 마다 살펴 자동으로 할 일을 한다:
// 상대 카드 적기 → 베팅 시작 → (내 차례 20초 넘기면 다이 / 상대가 넘기면 시간 초과 승리) → 공개되면 결과 적기 → 끝나면 내 몫 정산.
// 방을 나가면 진행 중인 내 판은 다이(기다리던 판은 취소)로 처리한다. 정산을 못 하고 나갔으면 다음 접속 때 한다(recover)
import { ref, push, get, set, update, onValue, query, orderByChild, endAt, limitToFirst, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import { duelFee } from '../shared/duel';
import { POKER_TABLES, POKER_TURN_MS, POKER_TURN_GRACE_MS, POKER_DEAL_LIMIT_MS, POKER_TABLE_STALE_MS, POKER_KEEP_MS, otherSide, sideOf, putOf, pokerCard, pokerWinner, pokerPayout, pokerOptions, type PokerHand, type Side } from '../shared/poker';
import type { WorldCtx } from './state';

export interface TableView { t: string; hid: string | null; hand: PokerHand | null; mySide: Side | null; oppCard: number | null; cards: { a?: number; b?: number } }
const num = (n: number): string => Math.floor(n).toLocaleString('ko-KR');

export class PokerMgr {
  private opened = false;
  private offs: (() => void)[] = [];
  private hid: Record<string, string | null> = {};
  private hands: Record<string, PokerHand | null> = {};        // 판 id → 판
  private handOff: Record<string, () => void> = {};
  private oppCards: Record<string, number> = {};               // 판 id → 상대 카드 (내가 낀 판)
  private oppOff: Record<string, () => void> = {};
  private shownCards: Record<string, { a?: number; b?: number }> = {}; // 공개된 판의 두 카드
  private did = new Set<string>();                             // 한 번만 할 일의 표시 ("deal:판", "claim:판" …)
  private lastTry: Record<string, number> = {};
  private timer = 0;
  private busy = false;                                        // 쓰기 하나가 끝날 때까지 다음 행동을 막는다
  private listeners = new Set<() => void>();

  constructor(private w: WorldCtx) {}

  listen(f: () => void): () => void { this.listeners.add(f); return () => this.listeners.delete(f); }
  private emit(): void { this.listeners.forEach((f) => f()); }
  private fee(): number { return duelFee(this.w.config.duelFee); }

  // ---- 포커 방에 들어왔다 / 나갔다 ----
  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.offs.push(onValue(ref(db, 'pkt'), (s) => {
      const v = (s.val() as Record<string, { hid?: string }> | null) || {};
      for (const t of POKER_TABLES) this.watch(t, v[t]?.hid ?? null);
      this.emit();
    }, () => {}));
    this.timer = window.setInterval(() => { void this.tick(); }, 500);
  }
  close(): void {
    if (!this.opened) return;
    this.opened = false;
    void this.leaveHands(); // 진행 중인 내 판은 다이, 기다리던 판은 취소
    for (const off of this.offs) off();
    this.offs = [];
    for (const k of Object.keys(this.handOff)) this.handOff[k]();
    for (const k of Object.keys(this.oppOff)) this.oppOff[k]();
    this.handOff = {}; this.oppOff = {}; this.hid = {}; this.hands = {};
    clearInterval(this.timer);
  }
  private watch(t: string, hid: string | null): void {
    const old = this.hid[t];
    if (old === hid) return;
    if (old) {
      // 테이블이 다음 판으로 넘어갔다: 앞 판은 그만 보되, 내가 낀 판이면 정산을 마저 한다 (끝나자마자 남이 새 판을 열면 tick 이 정산하기 전에 여기로 온다)
      this.handOff[old]?.(); delete this.handOff[old];
      const h = this.hands[old]; delete this.hands[old];
      if (h && sideOf(h, this.w.uid)) void this.finish(old);
    }
    this.hid[t] = hid;
    if (!hid) return;
    this.handOff[hid] = onValue(ref(db, `pkh/${hid}`), (s) => { this.hands[hid] = s.val() as PokerHand | null; this.onHand(hid); this.emit(); }, () => {});
  }
  // 판이 바뀔 때: 내가 낀 판이면 상대 카드를 구독하고, 공개됐으면 두 카드를 읽는다
  private onHand(hid: string): void {
    const h = this.hands[hid]; if (!h) return;
    const me = sideOf(h, this.w.uid);
    if (me && h.st !== 'wait' && !this.oppOff[hid]) {
      this.oppOff[hid] = onValue(ref(db, `pkc/${hid}/${otherSide(me)}/at`), (s) => { const at = s.val(); if (typeof at === 'number') { this.oppCards[hid] = pokerCard(at); this.emit(); } }, () => {});
    }
    if ((h.st === 'show' || h.st === 'done') && !this.shownCards[hid] && !this.did.has('cards:' + hid)) {
      this.did.add('cards:' + hid);
      void this.readCards(hid).then((c) => { if (c) { this.shownCards[hid] = c; this.emit(); } else this.did.delete('cards:' + hid); });
    }
  }
  private async readCards(hid: string): Promise<{ a?: number; b?: number } | null> {
    try {
      const [a, b] = await Promise.all([get(ref(db, `pkc/${hid}/a/at`)), get(ref(db, `pkc/${hid}/b/at`))]);
      const c: { a?: number; b?: number } = {};
      if (typeof a.val() === 'number') c.a = pokerCard(a.val());
      if (typeof b.val() === 'number') c.b = pokerCard(b.val());
      return c;
    } catch { return null; }
  }

  tables(): TableView[] {
    return POKER_TABLES.map((t) => {
      const hid = this.hid[t] ?? null, hand = hid ? this.hands[hid] ?? null : null;
      const mySide = hand ? sideOf(hand, this.w.uid) : null;
      return { t, hid, hand, mySide, oppCard: hid ? this.oppCards[hid] ?? null : null, cards: (hid && this.shownCards[hid]) || {} };
    });
  }
  // 내가 낀, 아직 안 끝난 판
  myActive(): { hid: string; hand: PokerHand; side: Side } | null {
    for (const [hid, h] of Object.entries(this.hands)) {
      if (!h || h.st === 'done') continue;
      const side = sideOf(h, this.w.uid);
      if (side) return { hid, hand: h, side };
    }
    return null;
  }
  // 새 판에 들어갈 수 있나: 진행 중인 판이 없고 지난 판을 정산했다
  private free(): boolean { const wl = this.w.wallet.wallet; return !this.myActive() && (!wl.pk || wl.pk === wl.pc); }
  // 그 테이블에 새 판을 열 수 있나
  tableOpen(v: TableView): boolean { return !v.hand || v.hand.st === 'done' || v.hand.o < serverNow() - POKER_TABLE_STALE_MS; }

  // ---- 행동 ----
  private async run(fn: () => Promise<boolean>, fail: string): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true; this.emit();
    let ok = false;
    try { ok = await fn(); } catch { ok = false; }
    this.busy = false; this.emit();
    if (!ok && fail) this.w.toast(fail, true);
    return ok;
  }
  get working(): boolean { return this.busy; }

  openHand(t: string, ante: number): Promise<boolean> {
    const w = this.w;
    if (!this.free()) { w.toast('진행 중이거나 정산하지 않은 판이 있습니다.', true); return Promise.resolve(false); }
    if (w.wallet.balance < ante) { w.toast('코인이 모자랍니다.', true); return Promise.resolve(false); }
    const hid = push(ref(db, 'pkh')).key!;
    const hand = { t, A: ante, a: w.uid, an: w.profile.nick, pa: ante, pb: 0, st: 'wait', o: serverTimestamp() };
    return this.run(() => w.wallet.pokerPut(hid, 'a', ante, { [`pkh/${hid}`]: hand, [`pkt/${t}/hid`]: hid }), '판을 열지 못했습니다. 그새 다른 판이 열렸을 수 있어요.');
  }
  join(hid: string): Promise<boolean> {
    const w = this.w, h = this.hands[hid];
    if (!h || h.st !== 'wait') return Promise.resolve(false);
    if (!this.free()) { w.toast('진행 중이거나 정산하지 않은 판이 있습니다.', true); return Promise.resolve(false); }
    if (w.wallet.balance < h.A) { w.toast('코인이 모자랍니다.', true); return Promise.resolve(false); }
    const P = `pkh/${hid}`;
    return this.run(() => w.wallet.pokerPut(hid, 'b', h.A, { [`${P}/st`]: 'deal', [`${P}/b`]: w.uid, [`${P}/bn`]: w.profile.nick, [`${P}/pb`]: h.A, [`${P}/tj`]: serverTimestamp() }), '참가하지 못했습니다. 그새 다른 사람이 들어갔을 수 있어요.');
  }
  private write(hid: string, o: Record<string, unknown>): Promise<boolean> {
    const upd: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) upd[`pkh/${hid}/${k}`] = v;
    return update(ref(db), upd).then(() => true, () => false);
  }
  cancel(hid: string): Promise<boolean> { return this.run(() => this.write(hid, { st: 'done', w: 'void', why: 'cancel' }), '취소하지 못했습니다.'); }
  fold(hid: string, side: Side): Promise<boolean> { return this.run(() => this.write(hid, { st: 'done', w: otherSide(side), why: 'fold' }), '다이하지 못했습니다.'); }
  // 체크 또는 콜 (모자라면 가진 만큼 올인)
  call(hid: string): Promise<boolean> {
    const w = this.w, h = this.hands[hid]; if (!h) return Promise.resolve(false);
    const side = sideOf(h, w.uid); if (!side || h.st !== 'bet' || h.turn !== side) return Promise.resolve(false);
    const o = pokerOptions(h, side, w.wallet.balance);
    if (o.canCheck) return this.run(() => this.write(hid, (h.n || 0) === 0 ? { turn: otherSide(side), n: 1, ta: serverTimestamp() } : { st: 'show' }), '체크하지 못했습니다.');
    const P = `pkh/${hid}`;
    return this.run(() => w.wallet.pokerPut(hid, side, o.callAdd, { [`${P}/p${side}`]: putOf(h, side) + o.callAdd, [`${P}/st`]: 'show' }), '콜하지 못했습니다.');
  }
  // 레이즈: 상대가 건 돈보다 by 만큼 더
  raise(hid: string, by: number): Promise<boolean> {
    const w = this.w, h = this.hands[hid]; if (!h) return Promise.resolve(false);
    const side = sideOf(h, w.uid); if (!side || h.st !== 'bet' || h.turn !== side) return Promise.resolve(false);
    const o = pokerOptions(h, side, w.wallet.balance);
    if (by <= 0 || by > o.maxRaise || by % h.A !== 0) return Promise.resolve(false);
    const target = putOf(h, otherSide(side)) + by, P = `pkh/${hid}`;
    return this.run(() => w.wallet.pokerPut(hid, side, target - putOf(h, side), { [`${P}/p${side}`]: target, [`${P}/turn`]: otherSide(side), [`${P}/n`]: (h.n || 0) + 1, [`${P}/ta`]: serverTimestamp() }), '레이즈하지 못했습니다.');
  }

  // ---- 자동으로 할 일 (500ms 마다) ----
  private due(key: string, gapMs: number): boolean { const now = performance.now(); if (now - (this.lastTry[key] || 0) < gapMs) return false; this.lastTry[key] = now; return true; }
  private async tick(): Promise<void> {
    if (!this.opened || this.busy) return;
    const w = this.w, now = serverNow();
    for (const [hid, h] of Object.entries(this.hands)) {
      if (!h) continue;
      const side = sideOf(h, w.uid);
      if (!side) continue;
      const opp = otherSide(side);
      if (h.st === 'deal') {
        // 상대 카드를 적는다 (한 번). 그 뒤로는 둘 다 나왔는지 내가 알 수 없으므로(내 카드는 못 읽는다) 베팅 시작을 간격을 두고 시도한다
        if (!this.did.has('deal:' + hid)) { this.did.add('deal:' + hid); set(ref(db, `pkc/${hid}/${opp}`), { at: serverTimestamp() }).catch(() => {}); }
        else if (h.tj && now > h.tj + POKER_DEAL_LIMIT_MS + 1500 && this.due('void:' + hid, 3000)) void this.write(hid, { st: 'done', w: 'void', why: 'deal' });
        else if (this.due('start:' + hid, 1500)) void this.write(hid, { st: 'bet', turn: 'b', n: 0, ta: serverTimestamp() });
      } else if (h.st === 'bet' && h.ta) {
        if (h.turn === side) {
          if (now > h.ta + POKER_TURN_MS && this.due('fold:' + hid, 3000)) { w.toast('⏰ 시간이 지나 다이 처리됐습니다.', true); void this.write(hid, { st: 'done', w: opp, why: 'time' }); }
        } else {
          const oppUid = side === 'a' ? h.b : h.a;
          const gone = !!oppUid && !w.players.has(oppUid);
          if ((now > h.ta + POKER_TURN_MS + POKER_TURN_GRACE_MS + 500 || (gone && now > h.ta + 3000)) && this.due('time:' + hid, 3000)) void this.write(hid, { st: 'done', w: side, why: 'time' });
        }
      } else if (h.st === 'show') {
        if (this.due('res:' + hid, 2000)) void this.resolve(hid);
      } else if (h.st === 'done' && !h[side === 'a' ? 'xa' : 'xb'] && this.due('claim:' + hid, 4000)) void this.claim(hid, h, side, true);
    }
  }
  private async resolve(hid: string): Promise<void> {
    const c = await this.readCards(hid);
    if (!c || c.a === undefined || c.b === undefined) return;
    await this.write(hid, { st: 'done', w: pokerWinner(c.a, c.b), why: 'show' });
  }
  private claiming = new Set<string>();
  private async claim(hid: string, h: PokerHand, side: Side, announce: boolean): Promise<boolean> {
    const w = this.w;
    if (this.claiming.has(hid) || w.wallet.wallet.pc === hid) return false;
    this.claiming.add(hid);
    const pay = pokerPayout(h, side, this.fee());
    const ok = await w.wallet.pokerClaim(hid, side, pay).finally(() => this.claiming.delete(hid));
    if (!ok) return false;
    if (announce) {
      const put = putOf(h, side);
      const text = h.w === 'void' ? `🃏 판이 취소되어 ${num(pay)}코인을 돌려받았습니다.`
        : h.w === 'tie' ? `🃏 비겼습니다. 건 돈 ${num(pay)}코인을 돌려받았습니다.`
        : h.w === side ? `🃏 인디언 포커 승리! 💰 +${num(pay - put)} (받은 돈 ${num(pay)})`
        : `🃏 인디언 포커 패배. ${num(put - pay)}코인을 잃었습니다.`;
      w.toast(text, h.w !== side && h.w !== 'tie' && h.w !== 'void');
      w.events.emit('log', { channel: 'sys', from: '', text, ts: serverNow() });
    }
    this.emit();
    void this.cleanupOld();
    return true;
  }

  // 방을 나갈 때: 기다리던 내 판은 취소, 진행 중이면 다이. 정산은 recover 가 한다(방 밖에서는 판을 구독하지 않는다)
  private async leaveHands(): Promise<void> {
    const mine = this.myActive();
    if (!mine) return;
    const { hid, hand, side } = mine;
    if (hand.st === 'wait') await this.write(hid, { st: 'done', w: 'void', why: 'cancel' });
    else if (hand.st === 'deal' || hand.st === 'bet') { await this.write(hid, { st: 'done', w: otherSide(side), why: 'fold' }); this.w.toast('🃏 방을 나가 진행 중인 판은 다이 처리됐습니다.', true); }
    await this.finish(hid);
  }

  // 정산하지 않은 내 판(지갑 pk != pc)을 마무리한다: 접속할 때와 방을 나갈 때
  async recover(): Promise<void> {
    const w = this.w;
    await new Promise<void>((res) => { if (w.wallet.loaded) res(); else { const off = w.wallet.listen(() => { if (w.wallet.loaded) { off(); res(); } }); } });
    const hid = w.wallet.wallet.pk;
    if (!hid || w.wallet.wallet.pc === hid) return;
    try {
      const h = (await get(ref(db, `pkh/${hid}`))).val() as PokerHand | null;
      if (!h) return;
      const side = sideOf(h, w.uid); if (!side) return;
      if (this.opened) return; // 방 안에서는 tick 이 한다
      // 방 밖에서 접속했다: 기다리던 판은 취소, 진행 중이던 판은 다이 (방을 나간 것과 같다)
      if (h.st === 'wait') await this.write(hid, { st: 'done', w: 'void', why: 'cancel' });
      else if (h.st === 'deal' || h.st === 'bet') await this.write(hid, { st: 'done', w: otherSide(side), why: 'fold' });
      await this.finish(hid);
    } catch { /* 다음 접속 때 다시 */ }
  }
  // 끝난(또는 공개된) 판 하나의 내 몫을 받는다. 화면이 그 판을 보고 있지 않아도 된다
  private async finish(hid: string): Promise<void> {
    const w = this.w;
    try {
      let h = (await get(ref(db, `pkh/${hid}`))).val() as PokerHand | null;
      if (h?.st === 'show') { await this.resolve(hid); h = (await get(ref(db, `pkh/${hid}`))).val() as PokerHand | null; }
      const side = h ? sideOf(h, w.uid) : null;
      if (h && side && h.st === 'done' && !h[side === 'a' ? 'xa' : 'xb']) await this.claim(hid, h, side, true);
    } catch { /* 다음 접속 때 다시 */ }
  }

  // 하루 지난 판 정리 (아무나): 판을 지운 뒤 그 카드도 지운다
  private async cleanupOld(): Promise<void> {
    try {
      const s = await get(query(ref(db, 'pkh'), orderByChild('o'), endAt(serverNow() - POKER_KEEP_MS), limitToFirst(5)));
      const ids: string[] = [];
      s.forEach((c) => { const v = c.val() as PokerHand; if (c.key && v?.st === 'done') ids.push(c.key); });
      for (const id of ids) {
        await update(ref(db), { [`pkh/${id}`]: null });
        await update(ref(db), { [`pkc/${id}/a`]: null, [`pkc/${id}/b`]: null }).catch(() => {});
      }
    } catch { /* ignore */ }
  }
}
