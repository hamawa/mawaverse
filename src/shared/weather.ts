// 날씨 (2026-11-18, 사용자 요청): 가끔 비가 온다. 서버에 저장하지 않는다: 서버 시각으로 계산해서 모두가 같은 날씨를 본다.
// 30분 단위로 비가 올지 정하고(전체의 약 15%), 비가 시작하고 그칠 때는 90초에 걸쳐 굵어지고 가늘어진다.
// 비가 오는 동안에는 바깥 맵에 빗줄기와 빗소리가 나고, 비 오는 날에만 나오는 물고기가 낚인다 (shared/collection.ts 의 시간대 'rain').
import { cyrb53 } from './hash';

export const WEATHER_BLOCK_MS = 30 * 60 * 1000;
export const RAIN_PERMILLE = 150;   // 1000 중 비가 오는 구간 수
const FADE_MS = 90 * 1000;

// i 번째 구간에 비가 오는가
export function rainBlock(i: number): boolean { return cyrb53(`rain|${i}`) % 1000 < RAIN_PERMILLE; }

// 지금 비의 세기 (0 = 맑음, 1 = 한창)
export function rainLevel(serverMs: number): number {
  const i = Math.floor(serverMs / WEATHER_BLOCK_MS);
  if (!rainBlock(i)) return 0;
  const into = serverMs - i * WEATHER_BLOCK_MS, left = WEATHER_BLOCK_MS - into;
  let k = 1;
  if (!rainBlock(i - 1)) k = Math.min(k, into / FADE_MS);     // 막 시작했다
  if (!rainBlock(i + 1)) k = Math.min(k, left / FADE_MS);     // 곧 그친다
  return Math.max(0, Math.min(1, k));
}
export function isRaining(serverMs: number): boolean { return rainLevel(serverMs) > 0; }
