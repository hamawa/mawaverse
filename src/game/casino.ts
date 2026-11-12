// 카지노 경마 진행 (2026-11-09). 설계는 shared/casino.ts 머리말 참고.
// 라운드 노드 casino/r/{rid}: 가장 최근 하나만 구독한다. 배팅은 지갑 결제(b='race', cb/ch/ca)와 bets/{uid} 기록을 쓰기 한 번에 한다. 마감(at)은 시간이 되면 방 안의 아무 클라이언트가 쓴다.
// 결과는 at % 5. 맞힌 사람은 경주 애니메이션이 끝난 뒤(또는 다음 접속 때) cr=rid 로 배당을 받는다.
//
// 2026-11-12 수정 (제보: "마감 직전에 배팅하면 앞사람 배팅이 날아간다"):
//  - 배팅 확인 창을 보는 사이에 라운드가 마감되면, 그 배팅이 달리는 경주 위에 새 라운드를 열었다. 화면은 최신 라운드 하나만 보므로 모두의 판이 새 라운드로 넘어가
//    달리던 경주와 앞사람 배팅이 사라졌고, 배당 수령도 "지금 보는 라운드"만 봐서 빠졌다(그 뒤에 또 배팅하면 cb 가 덮여 영영 못 받았다).
//  - 지금은 ① 경주가 달리는 동안에는 새 라운드를 열지 않고 ② 확인하는 사이 마감된 라운드에 건 배팅은 거절하며 ③ 배당 수령을 라운드 id 로 처리해
//    화면이 넘어가도 받고 ④ 새로 배팅하기 전에 지난 배팅을 먼저 마무리하고 ⑤ 내 배팅이 최신이 아닌 라운드에 남아도(거의 동시에 둘이 새 라운드를 연 경우) 때가 되면 닫고 받는다.
import { ref, get, set, update, query, orderByKey, limitToLast, limitToFirst, endAt, onValue, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import { BET_MS, RACE_MS, ROUND_KEEP_MS, betMax, payoutOf, winnerOf, raceRunning, type RaceRound, type RaceBet } from '../shared/casino';
import { HORSES } from '../shared/casino';
import type { WorldCtx } from './state';

export type RacePhase = 'none' | 'open' | 'racing' | 'done';
export type BetResult = 'ok' | 'coins' | 'late' | 'dup' | 'racing' | 'fail';
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
  private raceStartAt = 0;        // 경주 애니메이션의 기준 시각 (performance.now). 마감 뒤 지난 만큼 당겨 잡아 모든 화면이 같은 서버 시각에 끝난다
  private closing = false;
  private settled = new Set<string>();   // 마무리한 라운드 (배당을 받았거나 받을 게 없다)
  private settling = new Set<string>();
  private strayAt = 0;                   // 최신이 아닌 내 라운드를 다음에 살펴볼 서버 시각
  private listeners = new Set<() => void>();

  constructor(private w: WorldCtx) {}

  start(): void {
    const q = query(ref(db, 'casino/r'), orderByKey(), limitToLast(1));
    this.unsub = onValue(q, (s) => {
      const found: { rid: string; round: RaceRound }[] = [];
      s.forEach((c) => { if (c.key) found.push({ rid: c.key, round: c.val() as RaceRound }); });
      const rid = found[0]?.rid ?? null, round = found[0]?.round ?? null;
      const changed = rid !== this.rid;
      const prev = changed ? this.rid : null;
      this.rid = rid; this.round = round;
      if (changed) { this.raceStartAt = 0; this.closing = false; }
      // 화면이 다른 라운드로 넘어갔다: 앞 라운드에 내 배팅이 있었으면 그 라운드 id 로 따로 마무리한다
      if (prev) void this.settle(prev);
      if (rid && round?.at && !this.raceStartAt) {
        // 마감 뒤 지난 만큼 건너뛴 자리부터 그린다: 늦게 본 화면도 같은 서버 시각에 끝난다 (예전엔 늦게 본 사람만 처음부터 달려, 그 사이 다음 라운드가 열리곤 했다)
        const elapsed = Math.max(0, serverNow() - round.at);
        this.raceStartAt = performance.now() - Math.min(elapsed, RACE_MS + 1);
        const watched = elapsed < RACE_MS; // 경주를 화면으로 봤나 (한참 지난 라운드를 접속하면서 본 것이면 결과 한 줄을 다시 띄우지 않는다)
        window.setTimeout(() => void this.settle(rid, false, watched), Math.max(0, this.raceStartAt + RACE_MS - performance.now()) + 50);
      }
      this.emit();
    });
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
    const claimed = !won || this.settled.has(rid) || (this.w.wallet.wallet.cr !== undefined && this.w.wallet.wallet.cr >= rid);
    return { rid, round: r, phase: raceLeft > 0 ? 'racing' : 'done', leftMs: raceLeft, myBet, winner, claimed };
  }
  // 경주 시작 시각 (애니메이션용). 0 이면 아직
  raceStart(): number { return this.raceStartAt; }

  // 매 프레임
  tick(): void {
    const now = serverNow();
    const r = this.round, rid = this.rid;
    // 보고 있는 라운드: 마감 시각이 지났는데 아무도 안 닫았으면 내가 닫는다 (방 안에 있거나, 내가 건 라운드일 때. 건 사람이 모두 방을 나가도 경주는 열린다)
    if (r && rid && !r.at && !this.closing && now >= r.o + BET_MS + 300 && (this.w.me.roomId === 'casino' || !!r.bets?.[this.w.uid])) {
      this.closing = true;
      set(ref(db, `casino/r/${rid}/at`), serverTimestamp()).catch(() => { this.closing = false; });
    }
    // 내가 마지막으로 건 라운드(cb)가 화면의 최신 라운드가 아니고 아직 마무리하지 않았다: 지난 접속에서 못 받은 배당이거나,
    // 거의 동시에 두 사람이 새 라운드를 열어 내 배팅이 옛 라운드에 남은 경우다. 그 라운드도 때가 되면 닫고 결과를 받는다
    const cb = this.w.wallet.loaded ? this.w.wallet.wallet.cb : undefined;
    if (cb && cb !== rid && !this.settled.has(cb) && now >= this.strayAt) {
      const cr = this.w.wallet.wallet.cr;
      if (cr && cr >= cb) { this.settled.add(cb); return; } // 이미 받은 라운드: 읽을 것도 없다
      this.strayAt = now + 3000;
      void this.settle(cb, true);
    }
  }

  // 배팅: 열린 라운드가 없으면 새로 연다. seenOpen: 배팅 버튼을 누를 때 열려 있던 라운드 id (없었으면 null).
  // 'late' 는 마감 직전이거나 확인하는 사이 마감됨, 'racing' 은 경주가 달리는 중이라 새 라운드를 열 수 없음
  async bet(horse: number, amount: number, seenOpen: string | null = null): Promise<BetResult> {
    const w = this.w;
    const max = betMax(w.config.casinoMax);
    if (amount < 100 || amount > max || amount % 100 !== 0) return 'fail';
    // 지난 배팅을 먼저 마무리한다: 새 배팅이 지갑의 cb 를 덮어쓰면, 새로고침한 뒤에는 그 라운드의 배당을 찾을 길이 없다.
    // 그 라운드가 아직 안 끝났으면(최신이 아닌 라운드에 남은 내 배팅) 끝날 때까지 새로 걸지 못한다
    const cb = w.wallet.wallet.cb;
    if (cb && !this.settled.has(cb) && !(cb === this.rid && this.round && !this.round.at)) {
      await this.settle(cb, true);
      if (!this.settled.has(cb) && !this.settling.has(cb)) return 'racing';
    }
    let rid = this.rid, r = this.round;
    if (seenOpen && (rid !== seenOpen || r?.at)) return 'late'; // 그 라운드는 확인하는 사이에 마감됐다: 조용히 새 라운드를 열지 않는다
    // 경주가 달리는 동안에는 새 라운드를 열지 않는다: 열면 모두의 화면이 새 라운드로 넘어가 달리던 경주와 그 배팅이 사라진다
    if (raceRunning(r, serverNow())) return 'racing';
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
    if (r.at || serverNow() > r.o + BET_MS - 1500) return 'late';
    if (w.wallet.balance < amount) return 'coins';
    // 결제와 배팅 기록은 쓰기 한 번: 그새 마감됐으면 통째로 거부되어 코인이 빠지지 않는다
    if (!(await w.wallet.betRace(rid, horse, amount, w.profile.nick))) return serverNow() > r.o + BET_MS - 3000 ? 'late' : 'fail';
    return 'ok';
  }

  // 라운드 하나를 마무리한다: 마감됐고 내 배팅이 맞았으면 배당을 받는다. 화면이 보고 있는 라운드가 아니어도 그 id 로 처리한다.
  // close: 아직 안 닫힌 내 라운드면 때가 됐을 때 닫는다 (최신이 아닌 라운드는 아무도 보고 있지 않아 내가 닫아야 한다)
  private async settle(rid: string, close = false, watched = false): Promise<void> {
    const w = this.w;
    if (this.settled.has(rid) || this.settling.has(rid)) return;
    this.settling.add(rid);
    try {
      let r = rid === this.rid && this.round?.at ? this.round : ((await get(ref(db, `casino/r/${rid}`))).val() as RaceRound | null);
      const my = r?.bets?.[w.uid];
      if (!r || !my) { this.settled.add(rid); return; } // 지워진 라운드이거나 내 배팅이 없다
      if (!r.at) {
        const due = r.o + BET_MS + 300;
        if (!close || serverNow() < due) { this.strayAt = Math.max(this.strayAt, due); return; } // 아직 배팅 중이다: 때가 되면 다시 본다
        try { await set(ref(db, `casino/r/${rid}/at`), serverTimestamp()); } catch { /* 그새 남이 닫았다 */ }
        r = (await get(ref(db, `casino/r/${rid}`))).val() as RaceRound | null;
        if (!r?.at) return;
      }
      this.settled.add(rid);
      const winner = winnerOf(r.at);
      const shown = watched && rid === this.rid; // 화면에서 경주를 본 라운드인가
      if (my.h === winner) {
        const win = payoutOf(my.a);
        const cr = w.wallet.wallet.cr;
        if (!(cr && cr >= rid) && (await w.wallet.claimRace(rid, win))) {
          w.toast(shown ? `🏇 ${HORSES[winner].name} 우승! 💰 +${win.toLocaleString('ko-KR')}` : `🏇 지난 경마 배당 💰 +${win.toLocaleString('ko-KR')} 을 받았습니다.`);
          w.events.emit('log', { channel: 'sys', from: '', text: `🏇 ${shown ? '경마' : '지난 경마'} ${HORSES[winner].name} 우승 · 배팅 ${my.a} → 배당 💰+${win}`, ts: serverNow() });
        }
      } else if (shown) {
        w.events.emit('log', { channel: 'sys', from: '', text: `🏇 경마 ${HORSES[winner].name} 우승 · ${HORSES[my.h].name}에 건 ${my.a}코인은 날아갔다`, ts: serverNow() });
      }
      this.emit();
    } catch { /* 네트워크: 다음에 다시 */ } finally { this.settling.delete(rid); }
    if (rid === this.rid) void this.cleanupOld();
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
