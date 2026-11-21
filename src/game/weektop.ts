// 주간 랭킹 1위 표시 (2026-11-21, 건의 반영. 설계는 shared/weektop.ts 머리말).
// 접속할 때 지난 주의 낚시·곤충·말랑이 기록을 한 번씩 읽어 1위를 계산해 둔다 (셋을 합쳐 3KB 안팎). 주가 바뀌면(월요일 0시) 다시 읽는다. 서버에 쓰지 않는다.
import { ref, get } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import { weekKey } from '../shared/fish';
import type { WeekEntry } from '../shared/collection';
import { WEEK_LABELS, WEEK_MARKS, topCatch, topToss, weekKindsOf, weekMarks, type TossWeekLike, type WeekTops } from '../shared/weektop';
import type { WorldCtx } from './state';

const WEEK_MS = 7 * 86400000;
const CHECK_MS = 60000; // 주가 바뀌었는지 보는 간격

export class WeekTopMgr {
  private tops: WeekTops = {};
  private loadedFor = ''; // 어느 주(지난 주의 열쇠)의 1위를 읽어 두었나
  private loading = false;
  private timer = 0;

  constructor(private w: WorldCtx) {}

  start(): void {
    void this.load();
    this.timer = window.setInterval(() => { if (this.prevKey() !== this.loadedFor) void this.load(); }, CHECK_MS);
  }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = 0; } }

  // 이름표 앞에 붙는 표시 (🎣🐛🧸 가운데 그 사람 것. 없으면 빈 글)
  marks(uid: string): string { return weekMarks(this.tops, uid); }

  private prevKey(): string { return weekKey(serverNow() - WEEK_MS); }

  private async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    const key = this.prevKey();
    try {
      const [f, b, t] = await Promise.all([get(ref(db, `fish/week/${key}`)), get(ref(db, `bug/week/${key}`)), get(ref(db, `toss/week/${key}`))]);
      this.tops = {
        fish: topCatch(f.val() as Record<string, WeekEntry> | null),
        bug: topCatch(b.val() as Record<string, WeekEntry> | null),
        toss: topToss(t.val() as Record<string, TossWeekLike> | null),
      };
      this.loadedFor = key;
      this.congratulate(key);
    } catch { /* 못 읽었으면 다음 확인 때 다시 */ }
    finally { this.loading = false; }
  }

  // 내가 1위였으면 그 주에 한 번만 알린다 (이 브라우저에 적어 둔다)
  private congratulate(key: string): void {
    const mine = weekKindsOf(this.tops, this.w.uid);
    if (!mine.length) return;
    const k = `mv-weektop-${this.w.uid}`;
    try { if (localStorage.getItem(k) === key) return; localStorage.setItem(k, key); } catch { /* 저장소를 못 쓰면 접속할 때마다 알린다 */ }
    this.w.toast(`${mine.map((x) => WEEK_MARKS[x]).join('')} 지난 주 ${mine.map((x) => WEEK_LABELS[x]).join('·')} 랭킹 1위! 이번 주 동안 이름표에 표시가 붙습니다.`);
  }
}
