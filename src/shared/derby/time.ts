// 경마공원 시간표와 운영 시간 판정 (순수 함수). 시각은 부르는 쪽이 서버 시각(serverNow)을 넘긴다.
// 운영 시간 설정은 config/raceHours = { on, d: { 0~7: { s, e } } } (한국 시간 하루 안의 분, 10분 단위, s < e ≤ 1440, 7 = 공휴일).
// 값이 없거나 on 이 true 가 아니면 휴장. 이용 시간 차단(config/hoursBlock)이 켜져 있으면 차단 시간도 건너뛴다 (hours.ts 판정 그대로).
import { hoursState, kstParts } from '../hours';
import type { Breaks } from '../hours';

export const DERBY_CYCLE_MS = 360000;      // 6분마다 한 경주
export const DERBY_SALE_MS = 240000;       // 0:00 발매 시작 → 4:00 마감·출발
export const DERBY_FINISH_MS = 280000;     // 4:40 결승
export const DERBY_CONFIRM_MS = 320000;    // 5:20 확정 배당

// 장면 시작 시각(주기 안의 ms). 끝은 다음 장면의 시작(마지막은 6:00)
export const DERBY_PHASES = [
  { id: 'paddock', at: 0, label: '예시장 주회' },
  { id: 'mount', at: 100000, label: '기수 기승' },
  { id: 'parade', at: 130000, label: '본마장 입장' },
  { id: 'warmup', at: 160000, label: '준비운동' },
  { id: 'gate', at: 200000, label: '게이트 입장' },
  { id: 'ready', at: 235000, label: '발주 대기' },
  { id: 'race', at: 240000, label: '경주' },
  { id: 'ceremony', at: 280000, label: '결승 직후' },
  { id: 'payout', at: 320000, label: '확정 배당' },
] as const;
export type DerbyPhase = (typeof DERBY_PHASES)[number]['id'];

export interface DerbyPhaseInfo { n: number; phase: DerbyPhase; label: string; t: number; start: number; end: number; left: number }

export function raceNo(ms: number): number { return Math.floor(ms / DERBY_CYCLE_MS); }
export function cycleStart(n: number): number { return n * DERBY_CYCLE_MS; }

// 그 시각의 경주 번호와 장면. t = 주기 안의 경과 ms, start/end = 장면 구간, left = 장면이 끝날 때까지 남은 ms
export function derbyPhase(ms: number): DerbyPhaseInfo {
  const n = raceNo(ms), t = ms - cycleStart(n);
  let i = DERBY_PHASES.length - 1;
  while (DERBY_PHASES[i].at > t) i--;
  const end = i + 1 < DERBY_PHASES.length ? DERBY_PHASES[i + 1].at : DERBY_CYCLE_MS;
  return { n, phase: DERBY_PHASES[i].id, label: DERBY_PHASES[i].label, t, start: DERBY_PHASES[i].at, end, left: end - t };
}

// 발매 진행도 0..1 (마감 뒤 1)
export function saleProgress(ms: number): number {
  return Math.min(1, Math.max(0, (ms - cycleStart(raceNo(ms))) / DERBY_SALE_MS));
}

export interface RaceSlot { s?: unknown; e?: unknown }
// RTDB 는 숫자 열쇠 객체를 배열로 돌려줄 수 있어 배열도 받는다
export interface RaceHours { on?: unknown; d?: { [k: number]: RaceSlot | null | undefined } | null }
export interface RaceHoursEnv {
  holidays: Record<string, unknown>;   // holidays.json 형식 ("YYYY-MM-DD" 열쇠)
  hoursBlock?: boolean;                // config/hoursBlock 이 켜져 있는가
  breaks?: Breaks;                     // hours.json 의 쉬는 시간 (schedule.ts BREAKS)
}
export const DERBY_HOLIDAY_SLOT = 7;

const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// 경주를 부르는 이름: 시작 시각(한국 시간) "19:06". 경주 번호(서버 시각 ÷ 6분)는 일곱 자리라 화면·자막·알림에 쓰지 않는다 (2026-11-24, 검토 반영)
export function raceClock(n: number): string { return hm(kstParts(cycleStart(n)).min); }

// 그 칸의 운영 구간. 형식이 틀리면 그날은 휴장으로 본다
export function raceSlot(cfg: RaceHours | null | undefined, k: number): { s: number; e: number } | null {
  const v = cfg?.d?.[k];
  if (!v) return null;
  const s = v.s, e = v.e;
  if (typeof s !== 'number' || typeof e !== 'number' || !Number.isInteger(s) || !Number.isInteger(e)) return null;
  if (s % 10 || e % 10 || s < 0 || !(s < e) || e > 1440) return null;
  return { s, e };
}

// 경주 n 이 열리는가: 발매 4분 전체가 그날(공휴일이면 7번 칸) 운영 구간 안이고, 이용 시간 차단이 켜져 있으면 그 4분 동안 차단이 아닐 것.
// 주기는 한국 시간 6분 단위로 맞물려 있어(하루 1440분 = 6 × 240) 경주는 늘 하루 안에 든다
export function raceScheduled(n: number, cfg: RaceHours | null | undefined, env: RaceHoursEnv): boolean {
  if (!cfg || cfg.on !== true) return false;
  const st = cycleStart(n), p = kstParts(st);
  const slot = raceSlot(cfg, Object.prototype.hasOwnProperty.call(env.holidays, p.key) ? DERBY_HOLIDAY_SLOT : p.dow);
  if (!slot || p.min < slot.s || p.min + DERBY_SALE_MS / 60000 > slot.e) return false;
  if (env.hoursBlock) {
    for (let m = 0; m < DERBY_SALE_MS / 60000; m++) if (hoursState(st + m * 60000, env.holidays, env.breaks ?? []) === 'blocked') return false;
  }
  return true;
}

// 지금 발매 중인가 (그 경주가 열리고 마감 전)
export function raceSaleOpen(ms: number, cfg: RaceHours | null | undefined, env: RaceHoursEnv): boolean {
  return ms - cycleStart(raceNo(ms)) < DERBY_SALE_MS && raceScheduled(raceNo(ms), cfg, env);
}

// ms 뒤로 처음 발매가 끝나지 않은 열리는 경주 (지금 발매 중이면 그 경주). maxDays 안에 없으면 null
export function nextScheduledRace(ms: number, cfg: RaceHours | null | undefined, env: RaceHoursEnv, maxDays = 8): number | null {
  if (!cfg || cfg.on !== true) return null;
  let n = raceNo(ms);
  if (ms - cycleStart(n) >= DERBY_SALE_MS) n++;
  const last = n + maxDays * (86400000 / DERBY_CYCLE_MS);
  for (; n <= last; n++) if (raceScheduled(n, cfg, env)) return n;
  return null;
}

// 전광판·판 안내 문구
export function derbyStatusText(ms: number, cfg: RaceHours | null | undefined, env: RaceHoursEnv): string {
  const n = raceNo(ms);
  if (raceScheduled(n, cfg, env)) {
    if (ms - cycleStart(n) < DERBY_SALE_MS) return `발매 중 · ${hm(kstParts(cycleStart(n) + DERBY_SALE_MS).min)} 마감`;
    return '경주 진행 중';
  }
  if (cfg && cfg.on === false) return '임시 휴장';
  const next = nextScheduledRace(ms, cfg, env);
  if (next === null) return '휴장';
  const p = kstParts(cycleStart(next));
  return `휴장 · 다음 경주 ${DOW_KO[p.dow]}요일 ${hm(p.min)}`;
}
