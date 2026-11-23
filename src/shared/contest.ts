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

// ---- 상금·참가상·메달·순위표 (2026-11-23, 건의 반영. 금액은 사용자가 정했다) ----
// 상금은 결과(fish/contest/{key}/result)가 확정된 뒤 각자의 화면이 스스로 받는다: 지갑 +금액과 받았다는 표시(fish/cprize/{key}/{uid} = 금액)를 쓰기 한 번에.
// 규칙이 그 표시의 금액을 결과·내 마릿수와 대조하고, 표시가 이미 있으면 거부한다 (두 번 받지 않는다). 접속해 있지 않았으면 다음에 들어올 때 받는다 (대회가 끝나고 7일 안)
// 표시를 fish/contest/{key} 안에 두지 않는 것은 옛 화면의 대회 탭이 그 아래의 칸을 전부 참가자로 읽기 때문이다
export const CONTEST_PRIZES = [30000, 20000, 10000] as const; // 1~3등
export const CONTEST_JOIN_MIN = 100;      // 참가상: 대회 중에 이만큼 낚은 사람 모두 (1~3등도 같이 받는다)
export const CONTEST_JOIN_PRIZE = 5000;
// 상금은 이 날짜부터 시작한 대회에만 준다 (대회의 열쇠 = 시작일 YYYYMMDD). 이 기능을 넣은 날 저녁에 이미 끝난 11/23 대회는 빼 두었다:
// 한 번 받은 상금은 되돌릴 수 없어서, 그 대회에도 줄지는 사용자에게 물어보고 정한다 (준다면 이 값을 그 대회의 열쇠로 내리면 된다. 끝나고 7일 안이면 각자 들어올 때 받는다)
export const CONTEST_PRIZE_FROM = '20261124';
export const CONTEST_MEDALS = ['🏆', '🥈', '🥉'] as const;   // 다음 대회까지 이름표 앞에
// 이름표 앞의 메달. top: 그 대회 결과의 1~3등 uid (아직 못 읽었으면 null: 챔피언 칸의 1등만 안다)
export function contestMedal(uid: string, championUid: string | null | undefined, top: readonly string[] | null): string {
  const i = top ? top.indexOf(uid) : championUid === uid ? 0 : -1;
  return i >= 0 && i < CONTEST_MEDALS.length ? CONTEST_MEDALS[i] : '';
}
// rank: 0~2 = 1~3등, 그 밖(-1 등)은 순위 상금 없음. count: 대회 중에 낚은 마릿수
export function contestPrize(rank: number, count: number): number {
  return (rank >= 0 && rank < CONTEST_PRIZES.length ? CONTEST_PRIZES[rank] : 0) + (count >= CONTEST_JOIN_MIN ? CONTEST_JOIN_PRIZE : 0);
}
// 순위표: 점수가 큰 순, 같으면 많이 낚은 순, 그것도 같으면 먼저 닿은 순 (도감의 대회 탭과 같은 순서)
export interface ContestRow { u: string; n: string; p: number; c: number; at: number }
export function contestRows(v: Record<string, unknown> | null | undefined): ContestRow[] {
  const out: ContestRow[] = [];
  for (const [u, e] of Object.entries(v || {})) {
    const r = e as Partial<ContestEntry> | null;
    if (u === 'result' || !r || typeof r.p !== 'number') continue;
    out.push({ u, n: typeof r.n === 'string' ? r.n : '?', p: r.p, c: r.c || 0, at: r.at || 0 });
  }
  return out.sort((a, b) => (b.p - a.p) || (b.c - a.c) || (a.at - b.at));
}
