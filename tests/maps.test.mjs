import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolve-hook.mjs', import.meta.url));

const {
  buildDefaultMap,
  buildPortalGarden,
  portalNear,
  validatePortalZone,
  validateZone,
  isReservedMapId,
  sanitizeMap,
  isWalkable,
  objectAt,
  G,
  O,
} = await import('../src/game/map.ts');
const { MAIN_MAP_ID, GARDEN_MAP_ID } = await import('../src/shared/maps.ts');

test('기본 맵은 default ID와 안전한 외향 포탈을 포함한다', () => {
  const map = buildDefaultMap();
  assert.equal(map.id, 'default');
  assert.equal(map.spawn.x, 30);
  assert.equal(map.spawn.y, 28);

  const portal = map.zones.find((z) => z.kind === 'portal');
  assert.ok(portal, '기본 맵에 포탈 구역이 있어야 함');
  assert.equal(portal.targetMap, GARDEN_MAP_ID);
  assert.ok(portal.label && portal.label.includes('정원'));

  // 포탈 위치는 맵 내부여야 하고 스폰과 겹치지 않아야 함
  assert.ok(portal.x >= 0 && portal.x + portal.w <= map.w);
  assert.ok(portal.y >= 0 && portal.y + portal.h <= map.h);
  assert.notEqual(`${portal.x},${portal.y}`, `${map.spawn.x},${map.spawn.y}`);

  // 포탈 위치는 걸을 수 있는 바닥이어야 하며 기존 오브젝트(벽, 건물 등)와 겹치지 않아야 함
  for (let dy = 0; dy < portal.h; dy++) {
    for (let dx = 0; dx < portal.w; dx++) {
      const px = portal.x + dx;
      const py = portal.y + dy;
      assert.equal(objectAt(map, px, py), O.NONE, '포탈 타일에는 장애물 오브젝트가 없어야 함');
      assert.equal(isWalkable(map, px, py), true, '포탈 타일은 걸을 수 있어야 함');
    }
  }

  // 기존 중요 구역 보존 확인
  assert.ok(map.zones.some((z) => z.id === 'board'), '게시판 보존');
  assert.ok(map.zones.some((z) => z.id === 'room10'), '커피 방 보존');
  assert.ok(map.zones.some((z) => z.id === 'casino'), '카지노 보존');
  assert.ok(map.zones.some((z) => z.id === 'lbl-plaza'), '광장 라벨 보존');
});

test('공사 펜스는 스폰에서 포탈 상호작용 거리까지 접근하는 모든 길을 막는다', () => {
  const map = buildDefaultMap();
  const queue = [map.spawn];
  const seen = new Set([`${map.spawn.x},${map.spawn.y}`]);
  for (let head = 0; head < queue.length; head++) {
    const { x, y } = queue[head];
    assert.equal(portalNear(map, x, y), undefined, `도달 가능한 (${x},${y})에서 포탈 사용 불가`);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (seen.has(key) || !isWalkable(map, nx, ny)) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
});

test('포탈 정원은 크기와 스폰 및 귀환 포탈 조건을 만족한다', () => {
  const garden = buildPortalGarden();
  assert.equal(garden.id, GARDEN_MAP_ID);
  assert.ok(garden.w > 0 && garden.h > 0);
  assert.ok(isWalkable(garden, garden.spawn.x, garden.spawn.y), '정원 스폰은 걸을 수 있어야 함');

  const retPortal = garden.zones.find((z) => z.kind === 'portal');
  assert.ok(retPortal, '정원에 귀환 포탈이 있어야 함');
  assert.equal(retPortal.targetMap, MAIN_MAP_ID, '귀환 포탈 목적지는 main');
  assert.equal(retPortal.targetSpawn, undefined, '귀환 포탈은 targetSpawn 없이 main spawn 사용');

  // 스폰 위치는 포탈 위가 아니어서 즉시 바운스되지 않아야 함
  assert.equal(
    garden.spawn.x >= retPortal.x &&
      garden.spawn.x < retPortal.x + retPortal.w &&
      garden.spawn.y >= retPortal.y &&
      garden.spawn.y < retPortal.y + retPortal.h,
    false,
    '스폰은 포탈 내부가 아니어야 함',
  );
});

test('portalNear는 포탈 위와 인접한 타일을 인식하고 먼 거리는 제외한다', () => {
  const garden = buildPortalGarden();
  const retPortal = garden.zones.find((z) => z.kind === 'portal');
  assert.ok(retPortal);

  // 포탈 위
  const onTile = portalNear(garden, retPortal.x, retPortal.y);
  assert.equal(onTile?.id, retPortal.id);

  // 인접 타일 (거리 1)
  const adjTile = portalNear(garden, retPortal.x, retPortal.y - 1);
  assert.equal(adjTile?.id, retPortal.id);

  // 2칸 이상 떨어진 타일
  const farTile = portalNear(garden, retPortal.x, retPortal.y - 3);
  assert.equal(farTile, undefined);
});

test('관리자 저장용 맵 ID 예약어 규칙을 검증한다', () => {
  assert.equal(isReservedMapId('main'), true);
  assert.equal(isReservedMapId('default'), true);
  assert.equal(isReservedMapId('portal-garden'), true);
  assert.equal(isReservedMapId('custom1'), false);
  assert.equal(isReservedMapId('island'), false);
});

test('포탈 구역 검증은 유효한 포탈을 통과시키고 부적합한 데이터는 거부한다', () => {
  const valid = {
    id: 'p1',
    kind: 'portal',
    x: 5,
    y: 5,
    w: 1,
    h: 1,
    targetMap: 'custom1',
    targetSpawn: { x: 10, y: 12 },
  };
  assert.equal(validatePortalZone(valid), true);
  assert.equal(validateZone(valid), true);

  // targetSpawn 생략도 유효
  assert.equal(validatePortalZone({ ...valid, targetSpawn: undefined }), true);

  // 잘못된 targetMap 거부
  assert.equal(validatePortalZone({ ...valid, targetMap: 'invalid/path' }), false);
  assert.equal(validatePortalZone({ ...valid, targetMap: '' }), false);
  assert.equal(validatePortalZone({ ...valid, targetMap: 123 }), false);

  // 부동소수점 및 비정수 좌표 거부
  assert.equal(validatePortalZone({ ...valid, x: 5.5 }), false);
  assert.equal(validatePortalZone({ ...valid, y: NaN }), false);
  assert.equal(validatePortalZone({ ...valid, w: 0 }), false);
  assert.equal(validatePortalZone({ ...valid, h: -1 }), false);

  // targetSpawn 좌표가 정수가 아닌 경우 거부
  assert.equal(validatePortalZone({ ...valid, targetSpawn: { x: 10.5, y: 12 } }), false);
  assert.equal(validatePortalZone({ ...valid, targetSpawn: { x: '10', y: 12 } }), false);
  assert.equal(validatePortalZone({ ...valid, targetSpawn: '10,12' }), false);
});

test('sanitizeMap은 유효한 포탈을 보존하고 잘못된 포탈 구역을 필터링한다', () => {
  const fallback = buildDefaultMap();
  const raw = {
    id: 'test-map',
    name: '테스트 맵',
    w: 2,
    h: 2,
    ground: [0, 0, 0, 0],
    objects: [0, 0, 0, 0],
    zones: [
      { id: 'valid-p', kind: 'portal', x: 0, y: 0, w: 1, h: 1, targetMap: 'main' },
      { id: 'corrupt-p', kind: 'portal', x: 0.5, y: 0, w: 1, h: 1, targetMap: 'invalid/map' },
      { id: 'valid-lbl', kind: 'label', x: 0, y: 0, w: 2, h: 2, label: '테스트' },
    ],
    spawn: { x: 0, y: 0 },
  };

  const sanitized = sanitizeMap(raw, fallback);
  assert.equal(sanitized.zones.length, 2);
  assert.ok(sanitized.zones.some((z) => z.id === 'valid-p'));
  assert.ok(sanitized.zones.some((z) => z.id === 'valid-lbl'));
  assert.ok(!sanitized.zones.some((z) => z.id === 'corrupt-p'), '잘못된 포탈은 제거되어야 함');
});
