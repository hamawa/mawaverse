import { ref, get, onValue, runTransaction, update } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import { DEFAULT_CONTEST, CONTEST_MULT, CONTEST_PRIZES, CONTEST_JOIN_MIN, CONTEST_JOIN_PRIZE, CONTEST_PRIZE_FROM, CONTEST_RANK_POLL_MS, contestActive, contestWindow, prevContestWindow, contestPrize, contestRows, contestOrder, contestMedal, fmtContestWhen, fmtLeft, type ContestRow, type ContestCfg, type ContestWindow, type ContestEntry, type ContestResult, type Champion } from '../shared/contest';
import type { WorldCtx } from './state';

// 낚시 대회 진행: 시작/종료 알림, 종료 시 결과 확정(먼저 본 클라이언트가 한 번만 씀), 챔피언(🏆) 구독
// 2026-11-23 (건의 반영): 1~3등 상금과 참가상을 각자의 화면이 받고(claim), 2·3등도 다음 대회까지 이름표 앞에 메달을 단다 (shared/contest.ts 머리말)
const won = (n: number): string => n.toLocaleString('ko-KR');
const PRIZE_TEXT = `상금 ${CONTEST_PRIZES.map(won).join(' · ')} · ${CONTEST_JOIN_MIN}마리 이상 낚으면 참가상 ${won(CONTEST_JOIN_PRIZE)}`;
export class ContestMgr {
  champion: Champion | null = null;
  private champUnsub: (() => void) | null = null;
  private wasActive = false;
  private lastTick = 0;
  private finalizing = new Set<string>();
  private medalKey = '';            // medalUids 를 읽어 온 대회
  private medalUids: string[] = []; // 그 대회의 1~3등
  private claiming = new Set<string>(); // 이번 접속에서 상금을 받으려 해 본 대회
  // 대회 중 순위 (점수판 game/contestui.ts, 2026-11-24): 판이 떠 있는 동안에만(watch) CONTEST_RANK_POLL_MS 마다 읽는다
  rank: ContestRow[] = [];
  rankLoaded = false;
  private rankKey = '';
  private rankAt = -1e9;
  private rankBusy = false;
  private watching = false;
  private listeners = new Set<() => void>();

  constructor(private w: WorldCtx) {}

  cfg(): ContestCfg { return this.w.config.contest || DEFAULT_CONTEST; }
  active(): ContestWindow | null { return contestActive(this.cfg(), serverNow()); }
  next(): ContestWindow | null { return contestWindow(this.cfg(), serverNow()); }
  multiplier(): number { return this.active() ? CONTEST_MULT : 1; }
  listen(f: () => void): () => void { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  // 점수판이 떴다/사라졌다. 뜰 때는 읽은 지 5초가 넘었으면 바로 다시 읽는다
  watch(on: boolean): void { this.watching = on; if (on) this.pollRank(5000); }
  private pollRank(gap = CONTEST_RANK_POLL_MS): void {
    const a = this.active();
    if (!a || this.rankBusy) return;
    if (a.key !== this.rankKey) { this.rankKey = a.key; this.rank = []; this.rankLoaded = false; this.rankAt = -1e9; }
    const now = performance.now();
    if (now - this.rankAt < gap) return;
    this.rankBusy = true; this.rankAt = now;
    get(ref(db, `fish/contest/${a.key}`)).then((s) => {
      if (this.rankKey !== a.key) return;
      this.rank = contestRows(s.val() as Record<string, unknown> | null); this.rankLoaded = true;
      for (const f of this.listeners) f();
    }).catch(() => {}).finally(() => { this.rankBusy = false; });
  }
  // 방금 내가 대회 중에 낚았다: 다음에 읽어 올 때까지 내 줄만 먼저 올려 둔다 (판을 보고 있을 때 내 점수가 바로 오르게)
  noteCatch(pts: number): void {
    if (!this.rankLoaded || this.rankKey !== this.active()?.key) return;
    const uid = this.w.uid;
    let r = this.rank.find((x) => x.u === uid);
    if (!r) { r = { u: uid, n: this.w.profile.nick, p: 0, c: 0, at: serverNow() }; this.rank.push(r); }
    r.p += pts; r.c += 1;
    this.rank.sort(contestOrder);
    for (const f of this.listeners) f();
  }
  // 이름표 앞의 메달: 지난 대회 1~3등은 다음 대회까지 🏆 · 🥈 · 🥉. 결과를 아직 못 읽었으면 1등만
  medal(uid: string): string { return contestMedal(uid, this.champion?.u, this.medalKey && this.medalKey === this.champion?.key ? this.medalUids : null); }
  // 2·3등은 그 대회의 결과에서 읽는다 (대회마다 한 번, 150B 쯤). 챔피언 칸에 같이 적지 않는 것은 옛 화면이 결과를 확정하면 빠지기 때문이다
  private async loadMedals(): Promise<void> {
    const key = this.champion?.key;
    if (!key || key === this.medalKey) return;
    try {
      const r = (await get(ref(db, `fish/contest/${key}/result`))).val() as ContestResult | null;
      if (this.champion?.key !== key) return; // 읽는 사이에 다음 대회가 끝났다
      this.medalUids = (r?.top || []).map((t) => t.u); this.medalKey = key;
    } catch { /* 못 읽으면 1등만 표시된다 */ }
  }

  start(): void {
    this.champUnsub = onValue(ref(db, 'fish/champion'), (s) => { this.champion = s.val() as Champion | null; void this.loadMedals(); });
    const a = this.active();
    this.wasActive = !!a;
    if (a) this.notice(`🏁 낚시 대회 진행 중! 남은 ${fmtLeft(a.end - serverNow())} · 점수·코인 ${CONTEST_MULT}배 · 대회 한정 어종 등장 · ${PRIZE_TEXT}`);
    // 아무도 없을 때 끝난 지난 대회가 있으면 결과를 마무리한다
    const prev = prevContestWindow(this.cfg(), serverNow());
    if (prev && serverNow() - prev.end < 7 * 86400000) void this.finalize(prev, false);
  }
  stop(): void { this.champUnsub?.(); this.champUnsub = null; }

  // 매 프레임 호출되지만 1초에 한 번만 본다
  tick(now: number): void {
    if (now - this.lastTick < 1000) return;
    this.lastTick = now;
    const a = this.active();
    if (a && !this.wasActive) {
      this.notice(`🏁 낚시 대회 시작! ${fmtLeft(a.end - serverNow())} 동안 점수·코인 ${CONTEST_MULT}배, 대회 한정 어종이 나옵니다. 물가로! (${PRIZE_TEXT})`);
      this.w.toast('🏁 낚시 대회 시작!');
    }
    if (!a && this.wasActive) {
      const prev = prevContestWindow(this.cfg(), serverNow());
      if (prev) void this.finalize(prev, true);
    }
    this.wasActive = !!a;
    if (this.watching) this.pollRank();
  }

  private notice(text: string): void {
    this.w.events.emit('log', { channel: 'notice', from: '', text, ts: serverNow() });
  }

  // 결과 확정: fish/contest/{key}/result 가 없으면 상위 3명을 써 넣고 챔피언 갱신. 이미 있으면(다른 사람이 먼저) 읽어서 알린다
  private async finalize(win: ContestWindow, announce: boolean): Promise<void> {
    if (this.finalizing.has(win.key)) return;
    this.finalizing.add(win.key);
    try {
      const snap = await get(ref(db, `fish/contest/${win.key}`));
      const v = (snap.val() || {}) as Record<string, ContestEntry | ContestResult>;
      if (v.result) { if (announce) this.showResult(win, v.result as ContestResult); void this.claim(win, v.result as ContestResult); return; }
      const top = contestRows(v).slice(0, 3).map((r) => ({ u: r.u, n: r.n, p: r.p })); // 순서는 도감의 대회 탭과 같다 (점수 → 마릿수 → 먼저 닿은 사람)
      if (!top.length && !announce) return; // 참가자 없는 지난 대회는 조용히 넘어간다
      const result: ContestResult = { at: serverNow() };
      if (top.length) result.top = top;
      const resRef = ref(db, `fish/contest/${win.key}/result`);
      const r = await runTransaction(resRef, (cur: ContestResult | null) => (cur ? undefined : result), { applyLocally: false }).catch(() => null);
      if (r && r.committed) {
        if (top[0]) await update(ref(db), { 'fish/champion': { u: top[0].u, n: top[0].n, key: win.key, at: serverNow() } }).catch(() => {});
        this.showResult(win, result);
        void this.claim(win, result);
      } else {
        const again = (await get(resRef)).val() as ContestResult | null;
        if (again && announce) this.showResult(win, again);
        if (again) void this.claim(win, again);
      }
    } finally { this.finalizing.delete(win.key); }
  }

  private showResult(win: ContestWindow, r: ContestResult): void {
    const top = r.top || [];
    const medals = ['🥇', '🥈', '🥉'];
    const line = top.length ? top.map((t, i) => `${medals[i]} ${t.n} ${t.p}점`).join(' · ') : '참가자가 없었습니다';
    this.notice(`🏁 낚시 대회(${win.key.slice(4, 6)}/${win.key.slice(6, 8)}) 결과: ${line}${top[0] ? ` — 1~3등은 다음 대회까지 🏆 · 🥈 · 🥉 를 답니다! (${PRIZE_TEXT})` : ''}`);
    if (top[0]?.u === this.w.uid) this.w.toast('🏆 낚시 대회 우승! 다음 대회까지 이름표에 왕관이 붙습니다.');
  }

  // 상금·참가상 받기 (shared/contest.ts 머리말): 결과가 확정된 대회에서 내가 받을 것이 있으면 한 번만 받는다. 접속해 있지 않았으면 다음에 들어올 때(start → finalize) 여기로 온다.
  // 마릿수는 받기 직전에 다시 읽는다: 규칙이 금액을 서버의 내 마릿수로 계산해 대조하므로, 결과를 확정할 때 읽은 값이 마지막 한 마리만큼 달라도 통째로 거부된다
  private async claim(win: ContestWindow, result: ContestResult): Promise<void> {
    const uid = this.w.uid;
    if (win.key < CONTEST_PRIZE_FROM || this.claiming.has(win.key)) return; // 상금을 주기 전에 끝난 대회는 건너뛴다
    this.claiming.add(win.key);
    try {
      const rank = (result.top || []).findIndex((t) => t.u === uid);
      const [paid, mine] = await Promise.all([get(ref(db, `fish/cprize/${win.key}/${uid}`)), get(ref(db, `fish/contest/${win.key}/${uid}/c`))]);
      if (paid.exists()) return; // 이미 받았다 (다른 기기·지난 접속)
      const count = Number(mine.val()) || 0, amount = contestPrize(rank, count);
      if (amount <= 0 || !(await this.w.wallet.contestPrize(win.key, amount))) return;
      const parts = [rank >= 0 && rank < CONTEST_PRIZES.length ? `${['🥇', '🥈', '🥉'][rank]} ${rank + 1}등 ${won(CONTEST_PRIZES[rank])}` : '', count >= CONTEST_JOIN_MIN ? `참가상 ${won(CONTEST_JOIN_PRIZE)}` : ''].filter(Boolean).join(' + ');
      const text = `🏁 낚시 대회(${win.key.slice(4, 6)}/${win.key.slice(6, 8)}) 상금 💰 ${won(amount)} 을 받았습니다! (${parts})`;
      this.w.toast(text); this.notice(text);
    } catch (e) { console.warn('대회 상금을 받지 못했습니다 (다음 접속 때 다시 시도)', e); }
  }

  // 도감 창에 보여줄 한 줄
  statusText(): string {
    const cfg = this.cfg();
    if (!cfg.on) return '낚시 대회가 꺼져 있습니다.';
    const a = this.active();
    if (a) return `🏁 대회 진행 중! 남은 ${fmtLeft(a.end - serverNow())} · 점수·코인 ${CONTEST_MULT}배`;
    const n = this.next();
    const d = n ? new Date(n.start) : null;
    return `다음 대회: ${fmtContestWhen(cfg)}${d ? ` (${d.getMonth() + 1}/${d.getDate()})` : ''}`;
  }
}
