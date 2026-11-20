// 모닥불 (2026-11-20, 사용자 요청). 모닥불 키트(상점 장비, 한 번 사면 계속 쓴다)를 가진 사람이 바깥 맵에서 자기 앞 칸에 피운다.
// 피울 때마다 나무 CAMPFIRE_WOOD 개(homes/{uid}/w)가 들고 CAMPFIRE_MS 동안 탄 뒤 꺼진다. 모두에게 보이고 밤에는 둘레가 밝다. 효과는 분위기뿐이다.
// fires/{맵 id}/{x_y} = { u, at }. 지금 있는 맵 것만 구독한다. 꺼지는 데는 쓰기가 없다(시각으로 계산). 다 탄 기록은 다음에 피우는 사람이 몇 개씩 같이 지운다.
// 모닥불 칸은 지나갈 수 없다 (2026-11-20 사용자 결정. 처음에는 길목을 막는 데 쓰일까 봐 지나갈 수 있게 했다). 화면이 막는다(world.canStep): 서버는 불 위의 자리를 막지 않는다.
// 그래서 맵의 시작 자리와 방의 문·나오는 칸에는 피울 수 없게 했다 (campfire.ts light). 잘못 놓인 불은 관리자가 지울 수 있다(규칙).
// 규칙(fires, 손으로 넣은 블록)에 같은 숫자가 글자로 들어 있다 (tests/home.test.mjs 가 대조).
export const CAMPFIRE_ID = 'campfire';
export const CAMPFIRE_MS = 10 * 60 * 1000;
export const CAMPFIRE_WOOD = 30;
export const CAMPFIRE_PRICE = 3000;
export interface FireRec { u: string; at: number }
export function fireBurning(f: FireRec | null | undefined, now: number): boolean { return !!f && typeof f.at === 'number' && now - f.at < CAMPFIRE_MS; }
export const fireKey = (x: number, y: number): string => `${x}_${y}`;
export function fireXY(key: string): { x: number; y: number } | null {
  const m = /^(\d{1,2})_(\d{1,2})$/.exec(key);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}
