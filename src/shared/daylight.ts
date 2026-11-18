// 낮과 밤 (2026-11-18, 사용자 요청): 실제 시각(한국 시간)에 따라 바깥 맵에 빛깔을 덧칠한다. 화면에만 있는 효과라 서버·규칙과 무관하다.
// 시각은 서버 시각으로 잰다(기기 시계가 틀려도 모두 같은 하늘을 본다). 집 안과 금광은 실내라 그대로 둔다 (world.ts 가 맵을 보고 정한다)
// a: 덧칠 세기(0 = 낮 그대로), lamp: 가로등·창문 불빛 세기(0~1). 밤 세기는 사용자가 고른 "보통"(가장 어두울 때 0.42)

export interface DayTint { r: number; g: number; b: number; a: number; lamp: number }

// [하루 중 분, r, g, b, a, lamp]. 사이는 곧게 잇는다. 첫 줄과 끝 줄은 같은 밤이라 자정을 넘어가도 이어진다
const KEYS: readonly (readonly [number, number, number, number, number, number])[] = [
  [0, 12, 20, 60, 0.42, 1],
  [4 * 60 + 30, 12, 20, 60, 0.42, 1],        // 깊은 밤
  [5 * 60 + 30, 40, 40, 90, 0.3, 0.8],       // 동트기 전
  [6 * 60 + 30, 255, 170, 150, 0.12, 0.2],   // 새벽 분홍빛
  [7 * 60 + 30, 255, 200, 160, 0, 0],        // 아침: 덧칠 없음
  [16 * 60 + 30, 255, 150, 70, 0, 0],        // 낮 끝
  [17 * 60 + 45, 255, 140, 60, 0.14, 0.1],   // 노을
  [18 * 60 + 45, 180, 90, 110, 0.22, 0.5],   // 해 진 뒤 붉은 보랏빛
  [19 * 60 + 45, 40, 40, 100, 0.34, 0.9],    // 땅거미
  [21 * 60, 12, 20, 60, 0.42, 1],            // 밤
  [24 * 60, 12, 20, 60, 0.42, 1],
];

export const KST_OFFSET_MS = 9 * 3600 * 1000;
// 서버 시각(ms) → 한국 시간의 하루 중 분 (0 ~ 1439.99)
export function kstMinuteOfDay(serverMs: number): number {
  const day = 24 * 3600 * 1000;
  return ((((serverMs + KST_OFFSET_MS) % day) + day) % day) / 60000;
}

export function dayTint(minute: number): DayTint {
  const m = Math.max(0, Math.min(24 * 60, minute));
  let i = 0;
  while (i < KEYS.length - 2 && m >= KEYS[i + 1][0]) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = b[0] === a[0] ? 0 : (m - a[0]) / (b[0] - a[0]);
  const mix = (k: 1 | 2 | 3 | 4 | 5) => a[k] + (b[k] - a[k]) * t;
  return { r: Math.round(mix(1)), g: Math.round(mix(2)), b: Math.round(mix(3)), a: mix(4), lamp: mix(5) };
}

// 밤인가 (배경음악이 밤 곡을 고를 때 쓴다): 불빛이 거의 다 켜진 시간
export function isNight(minute: number): boolean { return dayTint(minute).lamp >= 0.85; }
