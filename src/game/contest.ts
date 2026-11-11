import { ref, get, onValue, runTransaction, update } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import { DEFAULT_CONTEST, CONTEST_MULT, contestActive, contestWindow, prevContestWindow, fmtContestWhen, fmtLeft, type ContestCfg, type ContestWindow, type ContestEntry, type ContestResult, type Champion } from '../shared/contest';
import type { WorldCtx } from './state';

// 낚시 대회 진행: 시작/종료 알림, 종료 시 결과 확정(먼저 본 클라이언트가 한 번만 씀), 챔피언(🏆) 구독
export class ContestMgr {
  champion: Champion | null = null;
  private champUnsub: (() => void) | null = null;
  private wasActive = false;
  private lastTick = 0;
  private finalizing = new Set<string>();

  constructor(private w: WorldCtx) {}

  cfg(): ContestCfg { return this.w.config.contest || DEFAULT_CONTEST; }
  active(): ContestWindow | null { return contestActive(this.cfg(), serverNow()); }
  next(): ContestWindow | null { return contestWindow(this.cfg(), serverNow()); }
  multiplier(): number { return this.active() ? CONTEST_MULT : 1; }
  isChampion(uid: string): boolean { return this.champion?.u === uid; }

  start(): void {
    this.champUnsub = onValue(ref(db, 'fish/champion'), (s) => { this.champion = s.val() as Champion | null; });
    const a = this.active();
    this.wasActive = !!a;
    if (a) this.notice(`🏁 낚시 대회 진행 중! 남은 ${fmtLeft(a.end - serverNow())} · 점수·코인 ${CONTEST_MULT}배 · 대회 한정 어종 등장`);
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
      this.notice(`🏁 낚시 대회 시작! ${fmtLeft(a.end - serverNow())} 동안 점수·코인 ${CONTEST_MULT}배, 대회 한정 어종이 나옵니다. 물가로!`);
      this.w.toast('🏁 낚시 대회 시작!');
    }
    if (!a && this.wasActive) {
      const prev = prevContestWindow(this.cfg(), serverNow());
      if (prev) void this.finalize(prev, true);
    }
    this.wasActive = !!a;
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
      if (v.result) { if (announce) this.showResult(win, v.result as ContestResult); return; }
      const entries = Object.entries(v).filter(([k]) => k !== 'result') as [string, ContestEntry][];
      if (!entries.length && !announce) return; // 참가자 없는 지난 대회는 조용히 넘어간다
      const top = entries.map(([u, e]) => ({ u, n: e.n, p: e.p || 0 })).sort((a, b) => b.p - a.p).slice(0, 3);
      const result: ContestResult = { at: serverNow() };
      if (top.length) result.top = top;
      const resRef = ref(db, `fish/contest/${win.key}/result`);
      const r = await runTransaction(resRef, (cur: ContestResult | null) => (cur ? undefined : result), { applyLocally: false }).catch(() => null);
      if (r && r.committed) {
        if (top[0]) await update(ref(db), { 'fish/champion': { u: top[0].u, n: top[0].n, key: win.key, at: serverNow() } }).catch(() => {});
        this.showResult(win, result);
      } else {
        const again = (await get(resRef)).val() as ContestResult | null;
        if (again && announce) this.showResult(win, again);
      }
    } finally { this.finalizing.delete(win.key); }
  }

  private showResult(win: ContestWindow, r: ContestResult): void {
    const top = r.top || [];
    const medals = ['🥇', '🥈', '🥉'];
    const line = top.length ? top.map((t, i) => `${medals[i]} ${t.n} ${t.p}점`).join(' · ') : '참가자가 없었습니다';
    this.notice(`🏁 낚시 대회(${win.key.slice(4, 6)}/${win.key.slice(6, 8)}) 결과: ${line}${top[0] ? ` — ${top[0].n} 님이 다음 대회까지 🏆 를 답니다!` : ''}`);
    if (top[0]?.u === this.w.uid) this.w.toast('🏆 낚시 대회 우승! 다음 대회까지 이름표에 왕관이 붙습니다.');
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
