// 눈사람 부순 벌칙 (순수 함수). 부순 서버 시각 하나(users/{uid}/snowBrokenAt)만 저장하고, 끝나는 때는 그 시각 + SNOW_PENALTY_MS 로 계산한다.
// 판정에는 반드시 serverNow() 를 넘긴다 (기기 시계 금지). 보안 규칙(database.rules.json)의 1800000 과 같은 값이어야 한다 (tests/snowpenalty.test.mjs 가 대조)
export const SNOW_PENALTY_MS = 1800000;
// 다시 부술 수 있기까지의 최소 간격 (연타로 winter/events 전체 알림을 도배하는 것을 막는다). 보안 규칙의 10000 과 같은 값이어야 한다 (tests/snowpenalty.test.mjs 가 대조).
// 직전에 부순 시각(서버 시각) + 이 값 이후에만 새로 부술 수 있고, 허용된 재부수기는 30분을 처음부터 다시 시작한다
export const SNOW_BREAK_GAP_MS = 10000;
// 아직 못 부수는 남은 시간 (ms). 부술 수 있으면 0
export function snowBreakWaitMs(brokenAt: SnowStamp, now: number): number {
  return typeof brokenAt === 'number' && brokenAt > 0 ? Math.max(0, brokenAt + SNOW_BREAK_GAP_MS - now) : 0;
}

// 이름표에 붙이는 붉은 제목 (정확한 글자)
export const SNOW_PENALTY_TITLE = '눈사람 부순사람';
// 눈사람이 부서졌을 때 모든 맵의 접속자에게 띄우는 고정 문구. 저장된 글이 아니라 클라이언트가 이 문구를 쓴다
export const SNOW_BREAK_NOTICE = '누군가 눈사람을 부쉈다!!';

export type SnowStamp = number | null | undefined;

// 벌칙 중인가: 부순 시각이 있고 아직 끝나는 시각 전
export function snowActive(brokenAt: SnowStamp, now: number): boolean {
  return typeof brokenAt === 'number' && brokenAt > 0 && now < brokenAt + SNOW_PENALTY_MS;
}
// 남은 시간 (ms). 벌칙 중이 아니면 0
export function snowRemainingMs(brokenAt: SnowStamp, now: number): number {
  return snowActive(brokenAt, now) ? (brokenAt as number) + SNOW_PENALTY_MS - now : 0;
}
