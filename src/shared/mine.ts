// 금광 채광 (2026-11-11). 금광 맵의 거대한 금덩어리 옆에서 F 한 번에 곡괭이질 한 번(3초), 끝나면 금덩이가 지갑(gn)에 들어온다.
// 코인은 나오지 않고 하루 상한도 없다: 금광에 있는 동안은 낚시를 못 하는 것이 유일한 비용이다. 자동 채광은 없다(누를 때마다 한 번).
// 몇 개가 나오는지는 클라이언트가 굴린다(낚시와 같은 신뢰 수준). 규칙은 "지난 채광에서 MINE_GAP_MS 이상 지났고 한 번에 1~MINE_MAX 개"만 본다
export const MINE_MS = 3000;            // 곡괭이질 한 번에 걸리는 시간
export const MINE_GAP_MS = 2500;        // 규칙이 보는 최소 간격. 곡괭이질보다 조금 짧게: 통신 지연으로 정상 쓰기가 거부되지 않게 (tools/gen-rules.cjs 의 MINE_GAP_MS 와 같아야 한다)
export const MINE_MAX = 3;              // 한 번에 나오는 최대 개수 (gen-rules.cjs 의 MINE_MAX 와 같아야 한다)
export const MINE_IDLE_OFF_MS = 10000;  // 이만큼 안 치면 남에게 보이는 "채광 중" 표시를 끈다 (곡괭이질마다 쓰지 않으려고 켜 두는 것)

// 한 번에 나오는 금덩이: 1개 75%, 2개 20%, 3개 5% (평균 1.3개)
export function rollGold(rand: () => number = Math.random): number {
  const r = rand();
  return r < 0.75 ? 1 : r < 0.95 ? 2 : 3;
}
export const fmtGold = (n: number): string => `🟡 ${Math.floor(n).toLocaleString('ko-KR')}`;
