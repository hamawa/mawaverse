// 하루 한 번 룰렛: 꽝 없음, 5~500코인, 아주 드물게 1000. 기대값 약 46코인/일 (DOM/Firebase 의존 없음)
export interface RouletteSeg { v: number; w: number }
export const ROULETTE: RouletteSeg[] = [
  { v: 5, w: 30 }, { v: 10, w: 25 }, { v: 20, w: 18 }, { v: 50, w: 12 }, { v: 100, w: 8 }, { v: 200, w: 4.5 }, { v: 500, w: 2 }, { v: 1000, w: 0.5 },
];
export const ROULETTE_MAX = 1000;          // 지갑 규칙: 룰렛 날짜가 바뀌는 쓰기 한 번만 이만큼까지 증가 허용
export const ROULETTE_ANNOUNCE = 500;      // 이 이상이면 전체 공지

// 가중치로 칸 하나를 고른다 (인덱스)
export function rollRoulette(rand = Math.random): number {
  const total = ROULETTE.reduce((s, x) => s + x.w, 0);
  let r = rand() * total;
  for (let i = 0; i < ROULETTE.length; i++) { r -= ROULETTE[i].w; if (r <= 0) return i; }
  return ROULETTE.length - 1;
}
export interface RouletteFeed { u: string; n: string; v: number; ts: number; k?: 'jp' | '777' } // roulette/feed: 500 이상 당첨 공지. k: 슬롯 방에서 터진 것 (jp 잭팟, 777 트리플 세븐. 2026-11-12)
