// 기본 공간은 기존 클라이언트의 지도 식별자 없는 presence·점유 키와 호환한다.
export const MAIN_MAP_ID = 'main';
export const GARDEN_MAP_ID = 'portal-garden';
export const GOLD_MINE_MAP_ID = 'gold-mine';
// 코드에 든 맵(저장된 maps/{id} 가 아니라 빌더로 만든다). 늘릴 때 같이 고칠 곳: portal.ts mapSource·MAP_INFO, map.ts isReservedMapId, world.ts loadMap,
// database.rules.json 의 players/$uid/m 검증(글자로 들어 있다), 관리자 편집기 불러오기 목록, dev/main.ts
export const BUILTIN_MAP_IDS: readonly string[] = [GARDEN_MAP_ID, GOLD_MINE_MAP_ID];

export function isMapId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_-]{1,20}$/i.test(value);
}

export function playerMapId(player: { m?: string | null }): string {
  return player.m || MAIN_MAP_ID;
}

export function sameMap(a: { m?: string | null }, b: { m?: string | null }): boolean {
  return playerMapId(a) === playerMapId(b);
}

export function occupancyKey(mapId: string, x: number, y: number): string {
  return `${mapId === MAIN_MAP_ID ? '' : `${mapId}~`}${x}_${y}`;
}
