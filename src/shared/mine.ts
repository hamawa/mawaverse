// 금광 채광 (2026-11-11). 금광 맵의 거대한 금덩어리 옆에서 F 한 번에 곡괭이질 한 번(3초), 끝나면 금덩이가 지갑(gn)에 들어온다.
// 코인은 나오지 않고 하루 상한도 없다: 금광에 있는 동안은 낚시를 못 하는 것이 유일한 비용이다. 자동 채광은 없다: F 한 번에 곡괭이 단계+1 번만 이어서 치고 멈춘다.
// 몇 개가 나오는지는 클라이언트가 굴린다(낚시와 같은 신뢰 수준). 규칙은 "지난 채광에서 MINE_GAP_MS 이상 지났고 한 번에 1~MINE_MAX 개"만 본다
export const MINE_MS = 3000;            // 곡괭이질 한 번에 걸리는 시간
export const MINE_GAP_MS = 2500;        // 규칙이 보는 최소 간격. 곡괭이질보다 조금 짧게: 통신 지연으로 정상 쓰기가 거부되지 않게 (tools/gen-rules.cjs 의 MINE_GAP_MS 와 같아야 한다)
export const MINE_MAX = 3;              // 한 번에 나오는 최대 개수 (gen-rules.cjs 의 MINE_MAX 와 같아야 한다)
export const MINE_IDLE_OFF_MS = 10000;  // 이만큼 안 치면 남에게 보이는 "채광 중" 표시를 끈다 (곡괭이질마다 쓰지 않으려고 켜 두는 것)

// ---- 곡괭이 업그레이드 (코인 전용, 확정) ----
// 지갑 pi 에 단계(0~PICK_MAX, 없으면 0)를 적는다. 0단계는 무료 기본. 목표 단계 L 로 올리는 값은 정확히 1000·L² 코인이고 한 번에 한 단계씩 확정으로 오른다(실패·하락 없음).
// 금덩이·주문서·보유 품목·선물은 쓰지 않는다. 규칙은 b='pick' 쓰기에서 pi 가 +1 이고 사용액이 정확히 PICK_COST_UNIT·pi² 일 때만 pi 변경을 받는다 (tools/gen-rules.cjs 와 같은 값)
export const PICK_MAX = 10;
export const PICK_COST_UNIT = 1000;
export const PICK_ITEM = 'pick';        // 지갑 b 에 적는 결제 표시 (보관함 품목이 아니다)
export function pickLevelOf(pi: unknown): number { return typeof pi === 'number' && pi > 0 ? Math.min(PICK_MAX, Math.floor(pi)) : 0; }
export function pickCost(target: number): number { return PICK_COST_UNIT * target * target; } // target 단계로 올리는 값
export const PICK_TOTAL_COST = Array.from({ length: PICK_MAX }, (_, i) => pickCost(i + 1)).reduce((a, b) => a + b, 0); // 0→10: 385,000
export function pickBonus(level: number): number { return Math.floor(level / 2); }   // 곡괭이질 한 번마다 더해지는 금덩이
export function pickAttempts(level: number): number { return level + 1; }            // F 한 번에 이어서 치는 횟수 (0단계 1번 … 10단계 11번)
export function goldMax(level: number): number { return MINE_MAX + pickBonus(level); } // 한 번에 나올 수 있는 최대 개수 (규칙이 내 지갑의 pi 로 본다)

// 한 번에 나오는 금덩이: 기본 1개 75%, 2개 20%, 3개 5% (평균 1.3개) + 곡괭이 단계의 보너스 floor(단계/2). 10단계는 6~8개
export function rollGold(rand: () => number = Math.random, level = 0): number {
  const r = rand();
  return (r < 0.75 ? 1 : r < 0.95 ? 2 : 3) + pickBonus(level);
}
export const fmtGold = (n: number): string => `🟡 ${Math.floor(n).toLocaleString('ko-KR')}`;
