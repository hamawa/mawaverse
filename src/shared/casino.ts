// 카지노 경마 (2026-11-09). 서버 코드가 없어 결과는 "배팅 마감 시각(서버 타임스탬프) % 5" 로 정한다:
// 마감을 쓰는 클라이언트도 서버 시각을 ms 단위로 맞힐 수 없어 조작이 안 되고, 보안 규칙이 같은 식으로 배당을 검증한다.
// 흐름: 첫 배팅이 라운드를 연다(casino/r/{rid}, o=서버 시각) → BET_MS 동안 배팅(지갑에 b='race', cb/ch/ca 로 결제 → casino/r/{rid}/bets/{uid}) →
// 누군가 at(서버 시각)를 쓰면 마감 → 모두 같은 경주 애니메이션(시드 = at) → 맞힌 사람은 지갑에 cr=rid 로 배당(ca × PAYOUT)을 받는다 (한 라운드 한 번, cr 은 커지기만)
import { unitRandomFromSeed } from './hash';

export const HORSES = [
  { name: '번개', icon: '🐎', color: '#ffd84d' },
  { name: '콩떡', icon: '🐴', color: '#ff9aa8' },
  { name: '바람돌이', icon: '🦄', color: '#8fd3ff' },
  { name: '질주', icon: '🐎', color: '#8ce99a' },
  { name: '느림보', icon: '🐢', color: '#c79bff' },
] as const;
export const HORSE_COUNT = 5;
export const BET_MIN = 100;
export const BET_STEP = 100;
export const BET_MAX_DEFAULT = 10000;     // config/casinoMax 로 관리자가 조정 (규칙도 같은 기본값을 본다). 2026-11-10 1000 → 10000 (사용자 요청)
export const BET_MS = 20000;              // 첫 배팅부터 마감까지
export const RACE_MS = 8000;              // 경주 애니메이션
export const PAYOUT = 4.5;                // 맞히면 배팅의 4.5배 (5마리 균등이라 기대 90%)
export const ROUND_KEEP_MS = 86400000;    // 끝난 라운드는 하루 뒤 아무나 지울 수 있다 (늦게 들어온 사람의 배당 수령용으로 그동안 남긴다)

export interface RaceBet { h: number; a: number; n: string }
export interface RaceRound { o: number; by: string; at?: number; bets?: Record<string, RaceBet> }

export const winnerOf = (at: number): number => Math.abs(Math.floor(at)) % HORSE_COUNT;
export const payoutOf = (a: number): number => Math.floor(a * PAYOUT);
export const betMax = (cfgMax?: number | null): number => (typeof cfgMax === 'number' && cfgMax >= BET_MIN ? Math.floor(cfgMax / BET_STEP) * BET_STEP : BET_MAX_DEFAULT);

// 경주 진행도 (0..1): 시드(at)로 말마다 다른 속도 굴곡을 만들고, 우승마가 t=1 에 결승선(1.0)에 닿게, 나머지는 0.72~0.96 사이에서 끝나게 맞춘다.
// 모두 같은 at 을 보므로 모든 화면에서 같은 경주가 보인다
export function raceProgress(at: number, horse: number, t: number): number {
  const w = winnerOf(at);
  const r = (k: number) => unitRandomFromSeed(`${at}:${horse}:${k}`);
  const end = horse === w ? 1 : 0.72 + r(0) * 0.24;
  // 기본 선형 + 두 개의 사인 굴곡 (초반 치고 나가기 / 막판 역전 느낌)
  const a1 = (r(1) - 0.5) * 0.18, a2 = (r(2) - 0.5) * 0.12, ph = r(3) * Math.PI;
  const tt = Math.max(0, Math.min(1, t));
  let p = tt + a1 * Math.sin(tt * Math.PI) + a2 * Math.sin(tt * Math.PI * 2 + ph);
  p = Math.max(0, Math.min(1, p));
  return p * end;
}
