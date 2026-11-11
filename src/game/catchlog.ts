// 내 낚시·채집 기록 (개인 로그). 채팅에는 더 이상 안 남기고(2026-11-09) 화면 아래 한 줄 알림과 이 로그로만 본다.
// 브라우저(localStorage)에 최근 CATCH_LOG_MAX 건을 남겨 접속마다 이어진다. 서버에는 안 올린다 (다운로드 한도).
export interface CatchEntry { ts: number; kind: 'fish' | 'bug' | 'etc'; text: string }
export const CATCH_LOG_MAX = 200;

export class CatchLog {
  private entries: CatchEntry[] = [];
  private readonly key: string;
  constructor(uid: string) {
    this.key = `mv-catchlog-${uid}`;
    try {
      const raw = localStorage.getItem(this.key);
      const v = raw ? (JSON.parse(raw) as unknown) : null;
      if (Array.isArray(v)) this.entries = v.filter((e): e is CatchEntry => !!e && typeof e.ts === 'number' && typeof e.text === 'string').slice(-CATCH_LOG_MAX);
    } catch { /* ignore */ }
  }
  add(kind: CatchEntry['kind'], text: string, ts = Date.now()): void {
    this.entries.push({ ts, kind, text });
    if (this.entries.length > CATCH_LOG_MAX) this.entries.splice(0, this.entries.length - CATCH_LOG_MAX);
    try { localStorage.setItem(this.key, JSON.stringify(this.entries)); } catch { /* ignore */ }
  }
  // 최신 것부터
  list(): CatchEntry[] { return [...this.entries].reverse(); }
  clear(): void { this.entries = []; try { localStorage.removeItem(this.key); } catch { /* ignore */ } }
}
