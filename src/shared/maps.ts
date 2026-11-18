// 기본 공간은 기존 클라이언트의 지도 식별자 없는 presence·점유 키와 호환한다.
export const MAIN_MAP_ID = 'main';
export const GARDEN_MAP_ID = 'portal-garden';
export const GOLD_MINE_MAP_ID = 'gold-mine';
export const CLUB_MAP_ID = 'club';     // 클럽 (2026-11-18, 사용자 제안): 춤추는 펫, 신나는 음악, 이모트가 전부 춤이 되는 방
export const WINTER_MAP_ID = 'winter'; // 겨울 얼음 낚시터: 전용 물고기 풀(shared/winter.ts)과 얼음 낚싯대 계열만 쓰는 코드에 든 맵
// 코드에 든 맵(저장된 maps/{id} 가 아니라 빌더로 만든다). 늘릴 때 같이 고칠 곳: portal.ts mapSource·MAP_INFO, map.ts isReservedMapId, world.ts loadMap,
// database.rules.json 의 players/$uid/m 검증(글자로 들어 있다), 관리자 편집기 불러오기 목록, dev/main.ts
export const BUILTIN_MAP_IDS: readonly string[] = [GARDEN_MAP_ID, GOLD_MINE_MAP_ID, WINTER_MAP_ID, CLUB_MAP_ID];

export function isMapId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_-]{1,20}$/i.test(value);
}

// 내 집(2026-11-17): 집 안은 사람마다 따로인 맵이고 id 는 h-{주인 uid}. 저장된 맵 id(20자 이하)와 겹치지 않게 따로 판정한다. 규칙의 players/$uid/m 검증에 같은 모양이 들어 있다
export const HOME_MAP_PREFIX = 'h-';
export function isHomeMapId(value: unknown): value is string {
  return typeof value === 'string' && /^h-[A-Za-z0-9]{1,40}$/.test(value);
}
export function homeMapId(uid: string): string { return HOME_MAP_PREFIX + uid; }
export function homeOwnerOf(mapId: string): string { return mapId.slice(HOME_MAP_PREFIX.length); }

export function playerMapId(player: { m?: string | null }): string {
  return player.m || MAIN_MAP_ID;
}

export function sameMap(a: { m?: string | null }, b: { m?: string | null }): boolean {
  return playerMapId(a) === playerMapId(b);
}

export function occupancyKey(mapId: string, x: number, y: number): string {
  return `${mapId === MAIN_MAP_ID ? '' : `${mapId}~`}${x}_${y}`;
}
