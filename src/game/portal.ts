// 포탈로 맵을 옮기는 데 쓰는 순수 함수들 (Firebase 없이 시험할 수 있게 world/net 에서 뺐다)
import type { Dir } from '../shared/types';
import type { MapData, PortalDest } from './map';
import { isWalkable, isWater, roomAt, findFreeTile, sanitizeMap } from './map';
import { MAIN_MAP_ID, GARDEN_MAP_ID, GOLD_MINE_MAP_ID, WINTER_MAP_ID, BUILTIN_MAP_IDS, isMapId, occupancyKey } from '../shared/maps';

// 맵 id 를 어디서 읽나: main 은 기존 config/activeMap, 포탈 정원·금광은 코드에 든 맵, 그 밖의 올바른 id 는 저장된 maps/{id}
export function mapSource(id: unknown): 'active' | 'builtin' | 'saved' | null {
  if (id === MAIN_MAP_ID) return 'active';
  if (typeof id === 'string' && BUILTIN_MAP_IDS.includes(id)) return 'builtin';
  return isMapId(id) ? 'saved' : null;
}

// 행선지 선택 창에 보이는 맵 이름·한 줄 설명 (행선지에 label·desc 가 적혀 있으면 그쪽이 먼저)
export const MAP_INFO: Record<string, { name: string; desc: string }> = {
  [MAIN_MAP_ID]: { name: '광장', desc: '모두가 모이는 기본 맵' },
  [GARDEN_MAP_ID]: { name: '포탈 정원', desc: '연못과 꽃밭이 있는 작은 정원' },
  [GOLD_MINE_MAP_ID]: { name: '금광', desc: '거대한 금덩어리에서 금덩이를 캔다. 낚시는 못 해요' },
  [WINTER_MAP_ID]: { name: '겨울 얼음 낚시터', desc: '얼어붙은 연못에서 겨울 전용 물고기를 낚는다. 얼음 낚싯대가 필요해요' },
};
export interface DestView { map: string; name: string; desc: string; count: number; ok: boolean } // ok: 지금 갈 수 있는 곳 (올바른 id 이고 내가 있는 맵이 아님)
// 선택 창 한 줄. count: 지금 그 맵에 있는 사람 수 (접속자 목록에 모든 맵의 사람이 있어 따로 묻지 않는다)
export function destView(d: PortalDest, from: string, count: number): DestView {
  const info = MAP_INFO[d.map];
  return { map: d.map, name: d.label || info?.name || d.map, desc: d.desc || info?.desc || '', count, ok: !!mapSource(d.map) && d.map !== from };
}

// 저장된 맵을 엄격하게 읽는다: 깨졌으면 기본 맵으로 바꾸지 않고 오류 (포탈 이동이 실패하고 원래 맵에 남는다)
export function parseSavedMap(raw: unknown, id: string): MapData {
  const bad = { id: '', name: '', w: 0, h: 0, ground: [], objects: [], zones: [], spawn: { x: 0, y: 0 } } as MapData;
  const m = sanitizeMap(raw as Partial<MapData> | null, bad);
  if (m === bad) throw new Error(`map ${id} is missing or invalid`);
  return m;
}

// 도착 칸: 원하는 자리에서 가장 가까운 빈 땅. 없으면 null (물·벽·방·남의 자리에 떨어뜨리지 않는다)
export function arrivalTile(m: MapData, want: { x: number; y: number }, taken: (x: number, y: number) => boolean): { x: number; y: number } | null {
  const t = findFreeTile(m, want.x, want.y, taken, true);
  return isWalkable(m, t.x, t.y) && !isWater(m, t.x, t.y) && !roomAt(m, t.x, t.y) && !taken(t.x, t.y) ? t : null;
}

// 저장해 둘 마지막 위치. 기본 맵이면 m 을 빼서 옛 형식과 같게
export function lastPosOf(mapId: string, x: number, y: number, d: Dir): { x: number; y: number; d: Dir; m?: string } {
  return mapId === MAIN_MAP_ID ? { x, y, d } : { x, y, d, m: mapId };
}
// 다시 들어올 때 돌아갈 맵 (m 이 없거나 이상하면 기본 맵)
export function savedMapId(lp: { m?: unknown } | null | undefined): string {
  return lp && isMapId(lp.m) ? lp.m : MAIN_MAP_ID;
}

// 맵을 옮기는 쓰기 한 번: 새 자리 점유 + 맵·위치·방향 + 옛 맵에 걸려 있던 찌·이모트·받을 밀치기/말랑이/끌기/관리자 이동 비우기.
// 옛 자리는 서버 값이 내 것으로 확인됐을 때만 지운다 (삭제는 규칙 검증을 건너뛰므로 남의 자리를 지우면 안 된다)
export function mapSwitchUpdate(uid: string, from: { mapId: string; x: number; y: number; ownsOld: boolean }, to: { mapId: string; x: number; y: number; d: Dir }): Record<string, unknown> {
  const p = `players/${uid}`;
  const upd: Record<string, unknown> = {
    [`occ/${occupancyKey(to.mapId, to.x, to.y)}`]: uid,
    [`${p}/m`]: to.mapId === MAIN_MAP_ID ? null : to.mapId,
    [`${p}/x`]: to.x, [`${p}/y`]: to.y, [`${p}/d`]: to.d,
    [`${p}/f`]: null, [`${p}/e`]: null, [`${p}/mn`]: null, [`${p}/push`]: null, [`${p}/pull`]: null, [`${p}/toss`]: null, [`${p}/tp`]: null,
  };
  if (from.ownsOld) upd[`occ/${occupancyKey(from.mapId, from.x, from.y)}`] = null;
  return upd;
}

// 카지노는 기본 맵에서만: 방 상태(rooms/{zone id})가 맵 구분 없이 하나라, 맵을 복제하면 같은 방을 나눠 쓰게 된다
export const PRIMARY_ONLY_ROOM_MSG = '🏇 경마장·🎰 슬롯 방은 기본 맵에서만 들어갈 수 있어요';
export function primaryOnlyRoom(mapId: string, z: { kind: string } | null | undefined): boolean {
  return !!z && z.kind === 'casino' && mapId !== MAIN_MAP_ID;
}

// 포탈 옆에서 F 를 다른 일에 양보하나: 직접 던진 낚시·바로 옆 벌레·삽질 중·발밑 보물 자리가 있으면 그쪽이 먼저다.
// 자동 낚시는 안내도 F 동작도 없으므로 양보하지 않는다 (양보하면 물가 옆 포탈을 탈 방법이 없어진다)
export function portalYields(s: { fishing: boolean; autoFishing: boolean; bug: boolean; digging: boolean; digSpot: boolean }): boolean {
  return (s.fishing && !s.autoFishing) || s.bug || s.digging || s.digSpot;
}

// 지금 포탈을 쓸 수 없으면 그 이유 (쓸 수 있으면 null). entering: 방에 들어가는 중 (그 응답이 맵을 옮긴 뒤에 오면 옛 맵 좌표로 걷게 된다)
export function portalBlock(s: { from: string; target: unknown; switching: boolean; entering: boolean; locked: boolean; moving: boolean; mafia: boolean }): string | null {
  if (s.switching) return '이동 중입니다.';
  if (s.entering) return '멈춘 뒤에 다시 시도하세요.';
  if (!mapSource(s.target) || s.target === s.from) return '지금은 이 포탈을 쓸 수 없습니다.';
  if (s.mafia) return '마피아 게임에 참가 중에는 포탈을 쓸 수 없습니다.';
  if (s.locked) return '지금은 이동할 수 없습니다.';
  if (s.moving) return '멈춘 뒤에 다시 시도하세요.';
  return null;
}
