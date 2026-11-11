// 이용 시간 판정: 평일(월~금) 09:00~18:00 KST 에는 이용할 수 없다. 단 쉬는 시간(hours.json 의 breaks)에는 풀어 준다.
// 주말과 공휴일(holidays.json)은 종일 허용. 관리자는 예외(부르는 쪽에서 건너뛴다).
// 이 차단은 관리자 설정(config/hoursBlock)이 켜져 있을 때만 적용한다(기본 꺼짐). 켜져 있는지는 부르는 쪽이 먼저 확인한다.
// 순수 함수라 시각을 인자로 받는다 (테스트에서 시각을 넣어 본다). 실제로 막는 것은 보안 규칙이고(tools/gen-gate.cjs 가 같은 조건을 넣는다),
// 여기는 화면 안내와 안내 알림·종료 타이머에 쓴다. 부를 때는 기기 시계가 아니라 서버 시각(serverNow)을 넘길 것.
// 이 파일은 다른 파일을 불러오지 않는다 (Node 내장 테스트가 그대로 불러 쓴다). 설정 파일을 읽어 넘겨주는 쪽은 src/shared/schedule.ts.

export const BLOCK_START_MIN = 9 * 60;   // 09:00 부터
export const BLOCK_END_MIN = 18 * 60;    // 18:00 전까지 차단
export const WARN_MIN = 5;               // 차단이 시작되기 5분 전부터 안내 (08:55, 그리고 쉬는 시간이 끝나기 5분 전)

export const WARN_MESSAGE = '5분 뒤 이용 시간이 종료됩니다';

const KST_MS = 9 * 3600000;
const DAY_MS = 86400000;

// 쉬는 시간: [시작 분, 끝 분] 목록 (자정부터 센 분. 끝은 포함하지 않는다)
export type Breaks = [number, number][];

// hours.json 의 [["10:30","10:45"], …] → 분 단위. 형식이 틀리면 던진다 (빌드·테스트에서 바로 드러나게)
export function parseBreaks(list: readonly (readonly string[])[]): Breaks {
  const toMin = (s: string): number => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m || +m[1] > 24 || +m[2] > 59) throw new Error(`hours.json: 시각 형식이 잘못됐습니다 "${s}" (HH:MM)`);
    return +m[1] * 60 + +m[2];
  };
  return list.map(([a, b]) => {
    const s = toMin(a), e = toMin(b);
    if (!(s < e) || s < BLOCK_START_MIN || e > BLOCK_END_MIN) throw new Error(`hours.json: 쉬는 시간이 잘못됐습니다 "${a}"~"${b}" (09:00~18:00 안에서 시작 < 끝)`);
    return [s, e] as [number, number];
  }).sort((x, y) => x[0] - y[0]);
}

// KST 기준 날짜 번호(1970-01-01 = 0), 요일(0=일 … 6=토), 자정부터 지난 분, 날짜 열쇠 "YYYY-MM-DD"
export function kstParts(ts: number): { day: number; dow: number; min: number; key: string } {
  const t = ts + KST_MS;
  const day = Math.floor(t / DAY_MS);
  return { day, dow: (day + 4) % 7, min: Math.floor((t - day * DAY_MS) / 60000), key: new Date(t).toISOString().slice(0, 10) };
}

// "YYYY-MM-DD" → KST 날짜 번호 (규칙이 보는 holidays/{번호} 의 열쇠)
export function dayNumberOf(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

// 그 시각이 차단 중인가: 평일이고 공휴일이 아니며, 09:00~18:00 안이고, 쉬는 시간이 아닐 때
function blockedAt(ts: number, holidays: Record<string, unknown>, breaks: Breaks): boolean {
  const p = kstParts(ts);
  if (p.dow === 0 || p.dow === 6) return false;
  if (Object.prototype.hasOwnProperty.call(holidays, p.key)) return false;
  if (p.min < BLOCK_START_MIN || p.min >= BLOCK_END_MIN) return false;
  return !breaks.some(([s, e]) => p.min >= s && p.min < e);
}

// 클라이언트는 차단 3초 전부터 차단으로 본다. 차단 시각이 지나면 규칙이 쓰기를 거부해서 퇴장 처리(접속 표시·자리 지우기)까지 막히기 때문에,
// 그 전에 내보내고 들여보내지 않는다. 풀리는 쪽(18:00, 쉬는 시간 시작)은 당기지 않는다 (규칙이 열리기 전에 들여보내면 입장이 거부된다)
export const CLIENT_EARLY_MS = 3000;
export function clientBlocked(ts: number, holidays: Record<string, unknown>, breaks: Breaks = []): boolean {
  return blockedAt(ts, holidays, breaks) || blockedAt(ts + CLIENT_EARLY_MS, holidays, breaks);
}

export type HoursState = 'open' | 'warn' | 'blocked';

// open: 이용 가능, warn: 5분 안에 차단이 시작된다(08:55~09:00, 쉬는 시간이 끝나기 5분 전), blocked: 차단 중
export function hoursState(ts: number, holidays: Record<string, unknown>, breaks: Breaks = []): HoursState {
  if (blockedAt(ts, holidays, breaks)) return 'blocked';
  if (blockedAt(ts + WARN_MIN * 60000, holidays, breaks)) return 'warn';
  return 'open';
}

// 차단 안내 문구. 쉬는 시간이 있으면 함께 알려 준다
export function blockMessage(breaks: Breaks = []): string {
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  if (!breaks.length) return 'MawaVerse는 평일 오전 9시~오후 6시에는 이용할 수 없어요. 오후 6시 이후에 만나요!';
  return `MawaVerse는 평일 오전 9시~오후 6시에는 이용할 수 없어요. 쉬는 시간(${breaks.map(([s, e]) => `${hm(s)}~${hm(e)}`).join(', ')})이나 오후 6시 이후에 만나요!`;
}
