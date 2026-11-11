// 기본 공간은 기존 클라이언트의 지도 식별자 없는 presence·점유 키와 호환한다.
export const MAIN_MAP_ID = 'main';
export const GARDEN_MAP_ID = 'portal-garden';

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
