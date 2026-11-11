// 낚시 대회: 매주 정해진 요일·시각에 일정 시간. 점수·코인 2배, 대회 한정 어종. (DOM/Firebase 의존 없음)
export interface ContestCfg { on: boolean; weekday: number; hour: number; minutes: number } // weekday 0=일 … 6=토
export const DEFAULT_CONTEST: ContestCfg = { on: true, weekday: 5, hour: 16, minutes: 60 };
export const CONTEST_MULT = 2;
export const WEEKDAY_NAME = ['일', '월', '화', '수', '목', '금', '토'];

export interface ContestWindow { key: string; start: number; end: number } // key = 시작일 YYYYMMDD (로컬)

const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
function keyOf(ts: number): string { const d = new Date(ts); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; }

// 진행 중이거나 다음에 올 대회
export function contestWindow(cfg: ContestCfg, now = Date.now()): ContestWindow | null {
  if (!cfg.on) return null;
  const d = new Date(now);
  const start = new Date(d);
  start.setHours(cfg.hour, 0, 0, 0);
  start.setDate(start.getDate() + ((cfg.weekday - start.getDay() + 7) % 7));
  let s = start.getTime();
  const len = Math.max(1, cfg.minutes) * 60000;
  if (s + len <= now) s += 7 * 86400000; // 이번 주 것이 끝났으면 다음 주
  return { key: keyOf(s), start: s, end: s + len };
}
// 가장 최근에 끝난 대회 (진행 중이면 그 전 것)
export function prevContestWindow(cfg: ContestCfg, now = Date.now()): ContestWindow | null {
  const w = contestWindow(cfg, now);
  if (!w) return null;
  const s = w.start - 7 * 86400000;
  return { key: keyOf(s), start: s, end: s + (w.end - w.start) };
}
export function contestActive(cfg: ContestCfg, now = Date.now()): ContestWindow | null {
  const w = contestWindow(cfg, now);
  return w && now >= w.start && now < w.end ? w : null;
}
export function fmtContestWhen(cfg: ContestCfg): string {
  const endMin = cfg.hour * 60 + cfg.minutes;
  return `${WEEKDAY_NAME[cfg.weekday]}요일 ${pad(cfg.hour)}:00~${pad(Math.floor(endMin / 60) % 24)}:${pad(endMin % 60)}`;
}
export function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

// ---- DB 레코드 ----
export interface ContestEntry { n: string; p: number; c: number; at: number }           // fish/contest/{key}/{uid}
export interface ContestResult { at: number; top?: { u: string; n: string; p: number }[] } // fish/contest/{key}/result (끝난 뒤 한 번만)
export interface Champion { u: string; n: string; key: string; at: number }             // fish/champion: 마지막 대회 1위 (이름표 🏆)
