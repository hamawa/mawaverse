// 카지노 경마 진행 (2026-11-09). 설계는 shared/casino.ts 머리말 참고.
// 라운드 노드 casino/r/{rid}: 가장 최근 하나만 구독한다. 배팅은 지갑 결제(b='race', cb/ch/ca) → bets/{uid} 두 단계. 마감(at)은 시간이 되면 방 안의 아무 클라이언트가 쓴다.
// 결과는 at % 5. 맞힌 사람은 경주 애니메이션이 끝난 뒤(또는 다음 접속 때) cr=rid 로 배당을 받는다.
import { ref, get, set, update, query, orderByKey, limitToLast, limitToFirst, endAt, onValue, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import { BET_MS, RACE_MS, ROUND_KEEP_MS, betMax, payoutOf, winnerOf, type RaceRound, type RaceBet } from '../shared/casino';
import { HORSES } from '../shared/casino';
import type { WorldCtx } from './state';

export type RacePhase = 'none' | 'open' | 'racing' | 'done';
export interface RaceState {
  rid: string | null;
  round: RaceRound | null;
  phase: RacePhase;
  leftMs: number;          // open: 마감까지 / racing: 결승까지
  myBet: RaceBet | null;
  winner: number | null;   // done/racing 때 (racing 중에는 UI 가 숨긴다)
  claimed: boolean;        // 이 라운드 배당을 받았나 (또는 받을 게 없나)
}

export class CasinoMgr {
  private unsub: (() => void) | null = null;
  private rid: string | null = null;
  private round: RaceRound | null = null;
  private raceStartAt = 0;        // 결과(at)를 처음 본 시각 (performance.now): 애니메이션 기준
  private claimedRid: string | null = null;
  private closing = false;
  private listeners = new Set<() => void>();

  constructor(private w: WorldCtx) {}

  start(): void {
    const q = query(ref(db, 'casino/r'), orderByKey(), limitToLast(1));
    this.unsub = onValue(q, (s) => {
      const found: { rid: string; round: RaceRound }[] = [];
      s.forEach((c) => { if (c.key) found.push({ rid: c.key, round: c.val() as RaceRound }); });
      const rid = found[0]?.rid ?? null, round = found[0]?.round ?? null;
      const changed = rid !== this.rid;
      this.rid = rid; this.round = round;
      if (changed) { this.raceStartAt = 0; this.closing = false; }
      if (round?.at && !this.raceStartAt) {
        // 마감 직후면 지금부터 경주. 한참 지난 뒤에 보는 거면(늦게 들어옴) 바로 결과
        this.raceStartAt = serverNow() - round.at < RACE_MS + 2000 ? performance.now() : performance.now() - RACE_MS - 1;
        window.setTimeout(() => this.afterRace(), Math.max(0, this.raceStartAt + RACE_MS - performance.now()) + 50);
      }
      this.emit();
    });
    void this.claimPending();
  }
  stop(): void { this.unsub?.(); this.unsub = null; this.listeners.clear(); }
  listen(f: () => void): () => void { this.listeners.add(f); return () => this.listeners.delete(f); }
  private emit(): void { this.listeners.forEach((f) => f()); }

  state(): RaceState {
    const r = this.round, rid = this.rid;
    if (!r || !rid) return { rid: null, round: null, phase: 'none', leftMs: 0, myBet: null, winner: null, claimed: true };
    const myBet = r.bets?.[this.w.uid] || null;
    if (!r.at) {
      const left = Math.max(0, r.o + BET_MS - serverNow());
      return { rid, round: r, phase: 'open', leftMs: left, myBet, winner: null, claimed: true };
    }
    const raceLeft = this.raceStartAt ? Math.max(0, this.raceStartAt + RACE_MS - performance.now()) : 0;
    const winner = winnerOf(r.at);
    const won = !!myBet && myBet.h === winner;
    const claimed = !won || this.claimedRid === rid || (this.w.wallet.wallet.cr !== undefined && this.w.wallet.wallet.cr >= rid);
    return { rid, round: r, phase: raceLeft > 0 ? 'racing' : 'done', leftMs: raceLeft, myBet, winner, claimed };
  }
  // 경주 시작 시각 (애니메이션용). 0 이면 아직
  raceStart(): number { return this.raceStartAt; }

  // 매 프레임: 마감 시각이 지났는데 아무도 안 닫았으면 내가 닫는다 (방 안에 있을 때만)
  tick(): void {
    const r = this.round, rid = this.rid;
    if (!r || !rid || r.at || this.closing) return;
    if (this.w.me.roomId !== 'casino') return;
    if (serverNow() < r.o + BET_MS + 300) return;
    this.closing = true;
    set(ref(db, `casino/r/${rid}/at`), serverTimestamp()).catch(() => { this.closing = false; });
  }

  // 배팅: 열린 라운드가 없으면 새로 연다. 결제(지갑) → 기록(bets). 'late' 는 마감 직전이라 거절
  async bet(horse: number, amount: number): Promise<'ok' | 'coins' | 'late' | 'dup' | 'fail'> {
    const w = this.w;
    const max = betMax(w.config.casinoMax);
    if (amount < 100 || amount > max || amount % 100 !== 0) return 'fail';
    let rid = this.rid, r = this.round;
    if (!r || !rid || r.at) {
      // 새 라운드 열기 (id 는 서버 시각 추정값: 키 순서가 시간순이 되게)
      rid = String(serverNow());
      try { await set(ref(db, `casino/r/${rid}`), { o: serverTimestamp(), by: w.uid }); } catch { return 'fail'; }
      // 거의 동시에 남이 연 라운드가 더 새것이면 그쪽으로
      const latest = await get(query(ref(db, 'casino/r'), orderByKey(), limitToLast(1)));
      latest.forEach((c) => { const v = c.val() as RaceRound; if (c.key && c.key > rid! && !v.at) rid = c.key; });
      r = (await get(ref(db, `casino/r/${rid}`))).val() as RaceRound | null;
      if (!r) return 'fail';
    }
    if (r.bets?.[w.uid]) return 'dup';
    if (serverNow() > r.o + BET_MS - 1500) return 'late';
    if (!(await w.wallet.betRace(rid, horse, amount))) return 'coins';
    try {
      await set(ref(db, `casino/r/${rid}/bets/${w.uid}`), { h: horse, a: amount, n: w.profile.nick } as RaceBet);
    } catch (e) { console.warn('bet record failed', e); return 'fail'; }
    return 'ok';
  }

  // 경주가 끝났다: 맞혔으면 배당을 받는다
  private async afterRace(): Promise<void> {
    const r = this.round, rid = this.rid;
    if (!r || !rid || !r.at) return;
    const my = r.bets?.[this.w.uid];
    const winner = winnerOf(r.at);
    if (my && my.h === winner) {
      const win = payoutOf(my.a);
      if (await this.w.wallet.claimRace(rid, win)) {
        this.claimedRid = rid;
        this.w.toast(`🏇 ${HORSES[winner].name} 우승! 💰 +${win.toLocaleString('ko-KR')}`);
        this.w.events.emit('log', { channel: 'sys', from: '', text: `🏇 경마 ${HORSES[winner].name} 우승 · 배팅 ${my.a} → 배당 💰+${win}`, ts: serverNow() });
      }
    } else if (my) {
      this.w.events.emit('log', { channel: 'sys', from: '', text: `🏇 경마 ${HORSES[winner].name} 우승 · ${HORSES[my.h].name}에 건 ${my.a}코인은 날아갔다`, ts: serverNow() });
    }
    this.emit();
    void this.cleanupOld();
  }

  // 접속할 때: 마지막으로 배팅한 라운드(cb)의 배당을 아직 안 받았으면 받는다 (경주 중에 나갔거나 끊긴 경우)
  private async claimPending(): Promise<void> {
    const w = this.w;
    // 지갑이 읽힐 때까지 기다린다
    await new Promise<void>((res) => { if (w.wallet.loaded) res(); else { const off = w.wallet.listen(() => { if (w.wallet.loaded) { off(); res(); } }); } });
    const cb = w.wallet.wallet.cb, cr = w.wallet.wallet.cr;
    if (!cb || (cr && cr >= cb)) return;
    try {
      const r = (await get(ref(db, `casino/r/${cb}`))).val() as RaceRound | null;
      if (!r?.at) return;
      const my = r.bets?.[w.uid];
      if (!my || my.h !== winnerOf(r.at)) return;
      const win = payoutOf(my.a);
      if (await w.wallet.claimRace(cb, win)) w.toast(`🏇 지난 경마 배당 💰 +${win.toLocaleString('ko-KR')} 을 받았습니다.`);
    } catch { /* ignore */ }
  }

  // 하루 지난 라운드 정리 (아무나). 라운드 키가 연 시각이라 키로 하루 지난 것만 골라 읽는다:
  // 예전엔 판이 끝날 때마다 모두가 최근 30판(5KB)을 통째로 읽었다 (2026-11-10 점심 33분에 0.4MB)
  private async cleanupOld(): Promise<void> {
    try {
      const s = await get(query(ref(db, 'casino/r'), orderByKey(), endAt(String(serverNow() - ROUND_KEEP_MS - 60000)), limitToFirst(10)));
      const upd: Record<string, null> = {};
      s.forEach((c) => { const v = c.val() as RaceRound; if (v && v.o < serverNow() - ROUND_KEEP_MS) upd[`casino/r/${c.key}`] = null; });
      if (Object.keys(upd).length) await update(ref(db), upd);
    } catch { /* ignore */ }
  }
}
