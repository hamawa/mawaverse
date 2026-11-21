// 계절 (2026-11-19, 사용자 요청). 한국 날짜로 정한다 (서버 시각을 넣는다: 기기 시계가 달라도 모두 같은 계절을 본다). 서버에 쓰지 않는다.
//  - 11월 15일 ~ 1월 31일: 비 대신 눈이 오고(비 오는 날의 물고기는 그대로 낚인다: 사용자 결정), 나무에 단풍이 든다
//  - 4월 1일 ~ 5월 31일: 나무가 벚꽃색
// 소나무는 사계절 초록이고, 겨울 얼음 낚시터·집 안·금광·클럽에는 적용하지 않는다 (world.ts)
//  - 12월 1일 ~ 12월 25일: 크리스마스 철 (2026-11-21, 건의 반영). 바깥 맵의 소나무에 전구와 꼭대기 별이 달리고(겨울 낚시터 포함),
//    배경음악이 캐롤로 바뀌고(audio.ts), 상점에 크리스마스 한정 품목이 나온다 (shared/shop.ts XMAS_IDS)
export type TreeLook = 'autumn' | 'blossom' | null;

const KST_MS = 9 * 3600 * 1000;
// 한국 날짜의 월(1~12)과 일
export function kstMonthDay(serverMs: number): { m: number; d: number } {
  const t = new Date(serverMs + KST_MS);
  return { m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
// 눈이 오는 철인가 (이때는 날씨의 비를 눈으로 그리고 빗소리를 내지 않는다)
export function snowSeason(serverMs: number): boolean {
  const { m, d } = kstMonthDay(serverMs);
  return (m === 11 && d >= 15) || m === 12 || m === 1;
}
// 크리스마스 철인가
export function xmasSeason(serverMs: number): boolean {
  const { m, d } = kstMonthDay(serverMs);
  return m === 12 && d <= 25;
}
// 지금 나무의 빛깔
export function treeLook(serverMs: number): TreeLook {
  if (snowSeason(serverMs)) return 'autumn';
  const { m } = kstMonthDay(serverMs);
  return m === 4 || m === 5 ? 'blossom' : null;
}
