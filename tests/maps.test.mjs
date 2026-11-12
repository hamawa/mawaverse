import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolve-hook.mjs', import.meta.url));

const {
  buildDefaultMap,
  buildPortalGarden,
  buildGoldMine,
  portalNear,
  portalDests,
  isWater,
  SOLID_GROUND,
  G_GOLD,
  PORTAL_MAX_DESTS,
  validatePortalZone,
  validateZone,
  isReservedMapId,
  sanitizeMap,
  isWalkable,
  objectAt,
  roomAt,
  roomSeat,
  findFreeTile,
  G,
  O,
} = await import('../src/game/map.ts');
const { MAIN_MAP_ID, GARDEN_MAP_ID, GOLD_MINE_MAP_ID } = await import('../src/shared/maps.ts');

test('기본 맵은 default ID와 안전한 외향 포탈을 포함한다', () => {
  const map = buildDefaultMap();
  assert.equal(map.id, 'default');
  assert.equal(map.spawn.x, 30);
  assert.equal(map.spawn.y, 28);

  const portal = map.zones.find((z) => z.kind === 'portal');
  assert.ok(portal, '기본 맵에 포탈 구역이 있어야 함');
  // 행선지는 포탈 정원과 금광 두 곳 (2개 이상이라 F 를 누르면 고르는 창이 뜬다)
  assert.deepEqual(portalDests(portal).map((d) => d.map), [GARDEN_MAP_ID, GOLD_MINE_MAP_ID]);
  assert.ok(validateZone(portal));
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
  assert.ok(map.zones.some((z) => z.id === 'casino'), '카지노 보존');
  assert.ok(!map.zones.some((z) => z.kind === 'room'), '커피 내기 방은 없앴다 (2026-11-12)');
  assert.ok(map.zones.some((z) => z.id === 'lbl-plaza'), '광장 라벨 보존');
});

// 카지노: 들어오면 빈 자리에 앉혀 고정한다 (2026-11-12)
test('카지노 자리: 문에서 먼 빈 칸부터, 문 칸은 비워 두고, 정원만큼 앉을 수 있다', () => {
  const map = buildDefaultMap();
  const z = map.zones.find((x) => x.id === 'casino');
  assert.ok(z && z.door && z.exit);
  assert.equal(roomAt(map, z.door.x, z.door.y), z, '문 칸은 방 안이다 (들어서면 입장)');
  assert.equal(roomAt(map, z.exit.x, z.exit.y), undefined, '나가는 칸은 방 밖이다');
  assert.equal(isWalkable(map, z.exit.x, z.exit.y), true);
  const taken = new Set();
  const occupied = (x, y) => taken.has(`${x},${y}`);
  let prev = Infinity;
  for (let i = 0; i < z.cap; i++) {
    const s = roomSeat(map, z, occupied);
    assert.ok(s, `${i + 1}번째 자리`);
    assert.ok(!(s.x === z.door.x && s.y === z.door.y), '문 칸에는 앉히지 않는다');
    assert.equal(roomAt(map, s.x, s.y), z);
    assert.equal(isWalkable(map, s.x, s.y), true);
    const d = Math.abs(s.x - z.door.x) + Math.abs(s.y - z.door.y);
    assert.ok(d <= prev, '문에서 먼 자리부터 채운다');
    prev = d;
    taken.add(`${s.x},${s.y}`);
  }
  assert.equal(taken.size, z.cap);
  // 방 안이 꽉 차 있으면 자리가 없다
  assert.equal(roomSeat(map, z, () => true), null);
  // 나가기: 문 앞이 차 있어도 방 밖의 가까운 빈 칸을 고른다
  const out = findFreeTile(map, z.exit.x, z.exit.y, (x, y) => x === z.exit.x && y === z.exit.y, true);
  assert.equal(roomAt(map, out.x, out.y), undefined);
  assert.ok(Math.abs(out.x - z.exit.x) + Math.abs(out.y - z.exit.y) === 1);
});

test('옛 커피 내기 방 구역(kind room)이 저장된 맵에 남아 있어도 방으로 치지 않는다', () => {
  const map = buildDefaultMap();
  map.zones.push({ id: 'room10', kind: 'room', x: 19, y: 6, w: 4, h: 4, cap: 10 });
  assert.equal(validateZone(map.zones.at(-1)), true, '저장된 맵을 읽을 때 버리지는 않는다');
  assert.equal(roomAt(map, 20, 7), undefined);
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

test('포탈 행선지: 옛 형식은 1개짜리로 읽고, 목록은 1~6개의 올바른 맵 id 만 받는다', () => {
  const base = { id: 'p', kind: 'portal', x: 1, y: 1, w: 1, h: 1 };
  // 옛 형식 (이미 저장된 맵)
  assert.deepEqual(portalDests({ ...base, targetMap: 'main' }), [{ map: 'main' }]);
  assert.deepEqual(portalDests({ ...base, targetMap: 'island', targetSpawn: { x: 3, y: 4 } }), [{ map: 'island', spawn: { x: 3, y: 4 } }]);
  assert.deepEqual(portalDests(base), []);
  // 목록이 있으면 목록이 먼저
  const two = { ...base, targets: [{ map: GARDEN_MAP_ID, spawn: { x: 12, y: 13 } }, { map: GOLD_MINE_MAP_ID, label: '금광', desc: '설명' }] };
  assert.equal(portalDests(two).length, 2);
  assert.ok(validateZone(two));
  assert.ok(validateZone({ ...base, targets: [{ map: 'main' }] }));
  // 거부: 빈 목록, 너무 많음, 잘못된 id·좌표·이름, 목록도 targetMap 도 없음
  assert.equal(validateZone({ ...base, targets: [] }), false);
  assert.equal(validateZone({ ...base, targets: Array.from({ length: PORTAL_MAX_DESTS + 1 }, (_, i) => ({ map: 'm' + i })) }), false);
  assert.equal(validateZone({ ...base, targets: [{ map: 'a/b' }] }), false);
  assert.equal(validateZone({ ...base, targets: [{ map: 'main', spawn: { x: 1.5, y: 2 } }] }), false);
  assert.equal(validateZone({ ...base, targets: [{ map: 'main', label: 3 }] }), false);
  assert.equal(validateZone({ ...base, targets: 'main' }), false);
  assert.equal(validateZone(base), false);
  // 저장된 맵을 읽을 때도 목록이 보존된다
  const m = sanitizeMap({ w: 2, h: 2, ground: [0, 0, 0, 0], objects: [0, 0, 0, 0], zones: [two] }, buildDefaultMap());
  assert.equal(portalDests(m.zones[0]).length, 2);
});

test('금광: 24×18, 물·잔디·꽃밭이 없고 가운데 6×5 금덩어리 둘레에 설 자리가 22칸', () => {
  const m = buildGoldMine();
  assert.equal(m.id, GOLD_MINE_MAP_ID);
  assert.equal(m.w, 24); assert.equal(m.h, 18);
  // 낚시터(물)와 곤충이 나오는 바닥(잔디·진한 잔디·꽃밭)이 없다
  for (const g of m.ground) assert.ok(g !== G.WATER && g !== G.GRASS && g !== G.GRASS2 && g !== G.FLOWER);
  const gold = m.zones.find((z) => z.kind === 'mine');
  assert.ok(gold);
  assert.equal(gold.w, 6); assert.equal(gold.h, 5);
  // 금덩어리 칸은 지나갈 수 없다
  assert.ok(SOLID_GROUND.has(G_GOLD));
  let goldTiles = 0;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.ground[y * m.w + x] === G_GOLD) {
    goldTiles++;
    assert.equal(isWalkable(m, x, y), false);
    assert.ok(x >= gold.x && x < gold.x + gold.w && y >= gold.y && y < gold.y + gold.h);
  }
  assert.equal(goldTiles, 30);
  // 금덩어리와 맞닿은(상하좌우) 설 수 있는 칸
  const stand = new Set();
  for (let y = gold.y; y < gold.y + gold.h; y++) for (let x = gold.x; x < gold.x + gold.w; x++) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isWalkable(m, x + dx, y + dy)) stand.add(`${x + dx},${y + dy}`);
  }
  assert.equal(stand.size, 22);
  // 돌아가는 포탈은 행선지가 기본 맵 하나 (고르는 창 없이 바로)
  const portal = m.zones.find((z) => z.kind === 'portal');
  assert.deepEqual(portalDests(portal), [{ map: MAIN_MAP_ID }]);
  // 캐는 자리에서는 포탈이 잡히지 않는다 (F 가 겹치지 않게), 시작 자리도 포탈 범위 밖
  for (const k of stand) { const [x, y] = k.split(',').map(Number); assert.equal(portalNear(m, x, y), undefined); }
  assert.equal(portalNear(m, m.spawn.x, m.spawn.y), undefined);
  assert.ok(isWalkable(m, m.spawn.x, m.spawn.y));
  // 시작 자리에서 캐는 자리와 포탈까지 걸어갈 수 있다
  const seen = new Set([`${m.spawn.x},${m.spawn.y}`]); const q = [m.spawn]; let reachPortal = false;
  for (let h = 0; h < q.length; h++) {
    const { x, y } = q[h];
    if (portalNear(m, x, y)) reachPortal = true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = `${x + dx},${y + dy}`; if (!seen.has(k) && isWalkable(m, x + dx, y + dy)) { seen.add(k); q.push({ x: x + dx, y: y + dy }); } }
  }
  assert.ok(reachPortal);
  for (const k of stand) assert.ok(seen.has(k), `캐는 자리 ${k} 에 갈 수 있어야 함`);
  assert.equal(isReservedMapId(GOLD_MINE_MAP_ID), true);
});

test('겨울 낚시터: 빙판의 구멍만 낚시 가능하고 구멍에 들어갈 수 없으며 정원과 왕복할 수 있다', async () => {
  const { buildWinterMap, buildPortalGarden, isFishable, G_ICE, G_ICE_HOLE, G_SNOW, isWalkable, portalNear, portalDests, isReservedMapId } = await import('../src/game/map.ts');
  const { WINTER_MAP_ID, BUILTIN_MAP_IDS } = await import('../src/shared/maps.ts');
  const m = buildWinterMap();
  assert.equal(m.id, WINTER_MAP_ID); assert.ok(BUILTIN_MAP_IDS.includes(WINTER_MAP_ID)); assert.equal(isReservedMapId(WINTER_MAP_ID), true);
  assert.ok(m.ground.includes(G_ICE_HOLE));
  assert.equal(m.ground[m.spawn.y * m.w + m.spawn.x], G_SNOW);
  const holes = m.ground.flatMap((g, i) => g === G_ICE_HOLE ? [{ x: i % m.w, y: Math.floor(i / m.w) }] : []);
  assert.ok(holes.length > 1);
  assert.equal(new Set(holes.map((p) => p.x)).size, 1);
  assert.ok(holes.every((p) => p.x > m.spawn.x));
  assert.equal(Math.max(...holes.map((p) => p.y)) - Math.min(...holes.map((p) => p.y)) + 1, holes.length);
  for (let i = 0; i < m.ground.length; i++) {
    const x = i % m.w, y = Math.floor(i / m.w);
    assert.equal(isFishable(m, x, y), m.ground[i] === G_ICE_HOLE);
    if (m.ground[i] === G_ICE_HOLE) {
      assert.equal(isWalkable(m, x, y), false);
      assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => m.ground[(y + dy) * m.w + x + dx] === G_ICE && isWalkable(m, x + dx, y + dy)));
    }
  }
  for (const g of m.ground) assert.ok(g !== G.GRASS && g !== G.GRASS2 && g !== G.FLOWER);
  assert.ok(isWalkable(m, m.spawn.x, m.spawn.y)); assert.equal(portalNear(m, m.spawn.x, m.spawn.y), undefined);
  const back = m.zones.find((z) => z.kind === 'portal');
  assert.deepEqual(portalDests(back), [{ map: 'portal-garden' }]);
  const garden = buildPortalGarden();
  const go = garden.zones.find((z) => z.kind === 'portal' && z.targetMap === WINTER_MAP_ID);
  assert.ok(go);
  assert.equal(garden.zones.find((z) => z.kind === 'portal').targetMap, 'main'); // 첫 포탈(귀환)은 그대로
  assert.equal(portalNear(garden, garden.spawn.x, garden.spawn.y), undefined);
});
