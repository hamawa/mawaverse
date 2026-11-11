// 포탈 맵 이동의 클라이언트 쪽 판단 시험 (src/game/portal.ts). 실행: node --test tests/portal-runtime.test.mjs
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Firebase 없이 낚시 타이머를 돌려 보려고 연결 모듈을 빈 함수로 바꾼다
const stub = (src) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });
const STUBS = {
  'firebase/database': 'const f = () => ({}); export const ref = f, update = f, push = f, set = f, get = f, serverTimestamp = f, increment = f, onValue = f;'
    + ' export const runTransaction = async (r, fn) => { (globalThis.__tx ??= []).push(fn(null)); return { committed: true }; };'
    + ' export const onDisconnect = () => ({ remove: async () => {}, cancel: async () => {} });',
  '../firebase/app': 'export const db = {};',
  '../firebase/db': 'const f = () => {}; export const serverNow = () => Date.now(), onNewChild = f, readOwn = f, rememberOwn = f, forgetOwn = f;',
};
// src 는 번들러 방식(확장자 없는 import)이라 Node 가 그대로 못 찾는다: 상대 경로에 .ts 를 붙여 다시 찾는다
registerHooks({
  resolve(spec, ctx, next) {
    if (spec in STUBS) return stub(STUBS[spec]);
    try { return next(spec, ctx); } catch (e) {
      if (spec.startsWith('.') && !/\.[cm]?[jt]s$/.test(spec)) return next(`${spec}.ts`, ctx);
      throw e;
    }
  },
  // 생성자 매개변수 속성(constructor(private w ...))은 Node 의 타입 지우기만으로는 못 읽어 transform 으로 바꾼다
  load(url, ctx, next) {
    if (!url.startsWith('file:') || !url.endsWith('.ts')) return next(url, ctx);
    return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
  },
});
const { mapSource, parseSavedMap, arrivalTile, lastPosOf, savedMapId, mapSwitchUpdate, portalBlock, portalYields } = await import('../src/game/portal.ts');
const { emptyMap, buildDefaultMap, buildPortalGarden, portalNear, portalDests, isWalkable, isWater, roomAt, G, O } = await import('../src/game/map.ts');

test('맵 id 마다 읽는 곳이 정해져 있고 이상한 id 는 거부한다', () => {
  assert.equal(mapSource('main'), 'active');
  assert.equal(mapSource('portal-garden'), 'builtin');
  assert.equal(mapSource('island_2'), 'saved');
  for (const bad of ['', 'maps/x', '../x', 'a'.repeat(21), null, 3]) assert.equal(mapSource(bad), null);
});

test('저장된 맵이 없거나 깨졌으면 기본 맵으로 바꾸지 않고 오류', () => {
  assert.throws(() => parseSavedMap(null, 'island'));
  assert.throws(() => parseSavedMap({ w: 2, h: 2, ground: [0], objects: [0, 0, 0, 0] }, 'island'));
  const ok = parseSavedMap({ id: 'island', name: '섬', w: 2, h: 1, ground: [0, 0], objects: [0, 0], zones: [], spawn: { x: 0, y: 0 } }, 'island');
  assert.equal(ok.name, '섬');
});

test('도착 칸은 같은 맵의 남이 선 칸을 피해 가장 가까운 빈 땅', () => {
  const m = emptyMap('t', 't', 5, 5);
  const taken = (x, y) => x === 2 && y === 2;
  const t = arrivalTile(m, { x: 2, y: 2 }, taken);
  assert.ok(t);
  assert.notDeepEqual(t, { x: 2, y: 2 });
  assert.equal(Math.abs(t.x - 2) + Math.abs(t.y - 2), 1);
});

test('빈 땅이 없으면 물·벽·남의 자리에 떨어뜨리지 않고 null', () => {
  const water = emptyMap('w', 'w', 3, 3); water.ground.fill(G.WATER);
  assert.equal(arrivalTile(water, { x: 1, y: 1 }, () => false), null);
  const walls = emptyMap('k', 'k', 3, 3); walls.objects.fill(O.WALL);
  assert.equal(arrivalTile(walls, { x: 1, y: 1 }, () => false), null);
  const full = emptyMap('f', 'f', 2, 1);
  assert.equal(arrivalTile(full, { x: 0, y: 0 }, () => true), null);
});

test('맵 이동 쓰기: 새 맵 자리 점유와 맵·위치를 한 번에, 옛 맵에 걸린 효과는 비운다', () => {
  const upd = mapSwitchUpdate('u1', { mapId: 'main', x: 3, y: 4, ownsOld: true }, { mapId: 'portal-garden', x: 5, y: 6, d: 2 });
  assert.equal(upd['occ/portal-garden~5_6'], 'u1');
  assert.equal(upd['occ/3_4'], null);
  assert.ok('occ/3_4' in upd);
  assert.equal(upd['players/u1/m'], 'portal-garden');
  assert.deepEqual([upd['players/u1/x'], upd['players/u1/y'], upd['players/u1/d']], [5, 6, 2]);
  for (const k of ['f', 'e', 'push', 'pull', 'toss', 'tp']) { assert.ok(`players/u1/${k}` in upd, k); assert.equal(upd[`players/u1/${k}`], null); }
});

test('맵 이동 쓰기: 내 것으로 확인되지 않은 옛 자리는 지우지 않는다', () => {
  const upd = mapSwitchUpdate('u1', { mapId: 'portal-garden', x: 3, y: 4, ownsOld: false }, { mapId: 'main', x: 3, y: 4, d: 0 });
  assert.equal('occ/portal-garden~3_4' in upd, false);
  assert.equal(upd['occ/3_4'], 'u1'); // 기본 맵은 옛 키 형식 그대로
  assert.equal(upd['players/u1/m'], null); // 기본 맵으로 돌아오면 m 을 지워 옛 클라이언트와 같은 모양
});

test('마지막 위치: 기본 맵이면 m 없이 저장하고, m 이 없거나 이상하면 기본 맵', () => {
  assert.deepEqual(lastPosOf('main', 1, 2, 3), { x: 1, y: 2, d: 3 });
  assert.deepEqual(lastPosOf('portal-garden', 1, 2, 0), { x: 1, y: 2, d: 0, m: 'portal-garden' });
  assert.equal(savedMapId({ x: 1, y: 2 }), 'main');
  assert.equal(savedMapId(null), 'main');
  assert.equal(savedMapId({ x: 1, y: 2, m: 'a/b' }), 'main');
  assert.equal(savedMapId({ x: 1, y: 2, m: 'portal-garden' }), 'portal-garden');
});

test('포탈을 못 쓰는 경우: 마피아 참가·이동 중·같은 맵·잘못된 목적지·이미 옮기는 중', () => {
  const base = { from: 'main', target: 'portal-garden', switching: false, entering: false, locked: false, moving: false, mafia: false };
  assert.equal(portalBlock(base), null);
  assert.ok(portalBlock({ ...base, entering: true })); // 방 입장 응답을 기다리는 중 (응답이 맵을 옮긴 뒤 옛 좌표로 걷지 않게)
  assert.ok(portalBlock({ ...base, mafia: true }));
  assert.ok(portalBlock({ ...base, moving: true }));
  assert.ok(portalBlock({ ...base, locked: true }));
  assert.ok(portalBlock({ ...base, switching: true }));
  assert.ok(portalBlock({ ...base, target: 'main' }));
  assert.ok(portalBlock({ ...base, target: 'a/b' }));
  assert.ok(portalBlock({ ...base, target: undefined }));
});

test('포탈 옆의 F: 하던 낚시·옆 벌레·삽질·발밑 보물 자리가 포탈보다 먼저, 자동 낚시는 포탈을 막지 않는다', () => {
  const none = { fishing: false, autoFishing: false, bug: false, digging: false, digSpot: false };
  assert.equal(portalYields(none), false);
  assert.equal(portalYields({ ...none, digSpot: true }), true);  // 포탈 옆에 잡힌 보물 자리를 팔 수 있어야 한다
  assert.equal(portalYields({ ...none, digging: true }), true);  // 삽질 중에 F 를 눌러도 맵을 옮기지 않는다
  assert.equal(portalYields({ ...none, bug: true }), true);
  assert.equal(portalYields({ ...none, fishing: true }), true);  // 입질이 왔을 때 F 는 당기기
  assert.equal(portalYields({ ...none, fishing: true, autoFishing: true }), false);
});

test('기본 맵 ↔ 포탈 정원 왕복: 양쪽 포탈의 도착 칸이 걸을 수 있는 땅이다', () => {
  const main = buildDefaultMap(), garden = buildPortalGarden();
  const toGarden = main.zones.find((z) => z.kind === 'portal' && portalDests(z).some((d) => d.map === 'portal-garden'));
  assert.ok(toGarden);
  const gardenDest = portalDests(toGarden).find((d) => d.map === 'portal-garden');
  const back = garden.zones.find((z) => z.kind === 'portal' && z.targetMap === 'main');
  assert.ok(back);
  for (const [m, want] of [[garden, gardenDest.spawn ?? garden.spawn], [main, back.targetSpawn ?? main.spawn]]) {
    const t = arrivalTile(m, want, () => false);
    assert.ok(t);
    assert.ok(isWalkable(m, t.x, t.y) && !isWater(m, t.x, t.y) && !roomAt(m, t.x, t.y));
  }
  // 포탈 옆에 서면 그 포탈이 잡힌다 (F 안내)
  assert.equal(portalNear(main, toGarden.x, toGarden.y), toGarden);
});

// 자동 낚시 워커 타이머(autoTick)는 맵을 옮기는 동안 옛 맵 물에 다시 던지지 않는다 (2026: 포탈 목적지를 읽는 사이 재투척)
globalThis.window ??= globalThis;
const { Fishing } = await import('../src/game/fishing.ts');
function fishingRig() {
  const map = emptyMap('t', 't', 3, 3);
  map.ground[2 * 3 + 1] = G.WATER; // 내 앞(아래) 칸이 물
  const w = {
    switching: false, map,
    me: { x: 1, y: 1, dir: 0, moving: false, locked: false, roomId: null },
    profile: { own: {} },
    wallet: { autoReelActive: () => true, bait: 0, baitOn: false, stars: 0, fishStars: 0, shownStars: 0, kingStars: 0, takeBait: async () => {} },
    contest: { active: () => null },
    catchNote() {}, toast() {},
  };
  const writes = [];
  const net = { setFishing: (t) => writes.push(t), stat() {} };
  return { w, writes, fishing: new Fishing(w, net) };
}

test('맵 이동 중에는 자동 낚시 타이머와 직접 던지기가 찌를 던지지 않는다', () => {
  const { w, writes, fishing } = fishingRig();
  w.switching = true;
  fishing.autoTick();
  assert.equal(fishing.active, false);
  assert.equal(fishing.cast(), false);
  assert.deepEqual(writes, []);
});

test('맵 이동이 끝나면 다음 타이머 주기에 다시 던진다', () => {
  const { w, writes, fishing } = fishingRig();
  w.switching = true;
  fishing.autoTick();
  w.switching = false;
  fishing.autoTick();
  try {
    assert.equal(fishing.active, true);
    assert.deepEqual(writes.at(-1), { x: 1, y: 2 });
  } finally { fishing.cancel(); }
});

// 커피 내기 방·카지노 상태(rooms/{zone id})는 맵 구분이 없다: 다른 맵에서는 입장 자체를 막는다
const { Rooms } = await import('../src/game/rooms.ts');
test('다른 맵의 방·카지노에는 입장 트랜잭션을 걸지 않고 거부, 기본 맵은 그대로 입장', async () => {
  const w = { mapId: 'portal-garden', uid: 'me', profile: { nick: '닉', losses: 0 }, map: { zones: [] } };
  const rooms = new Rooms(w);
  globalThis.__tx = [];
  assert.equal(await rooms.tryEnter({ id: 'cafe', kind: 'room', x: 0, y: 0, w: 2, h: 2, cap: 2 }), false);
  assert.equal(await rooms.tryEnter({ id: 'casino', kind: 'casino', x: 0, y: 0, w: 2, h: 2, cap: 8 }), false);
  assert.equal(globalThis.__tx.length, 0);
  w.mapId = 'main';
  assert.equal(await rooms.tryEnter({ id: 'cafe', kind: 'room', x: 0, y: 0, w: 2, h: 2, cap: 2 }), true);
  assert.equal(globalThis.__tx.length, 1);
});

// 말랑이: 맵을 옮기면(clear) 날아가던 것의 착지 판정(스턴·낚시 취소·명중·기록)을 버린다
const { TossMgr, TOSS_FLY_MS } = await import('../src/game/toss.ts');
function tossRig() {
  const rp = { uid: 'o', x: 2, y: 3, st: {} };
  const calls = { cancel: 0, toast: 0, note: 0, sent: 0 };
  const w = {
    uid: 'me', me: { x: 2, y: 2, dir: 0, roomId: null }, profile: { own: {}, eq: {}, nick: '닉' },
    players: new Map([['o', rp]]),
    playerAt: (x, y) => (x === rp.x && y === rp.y ? rp : null),
    petGuard: () => false, petReflect: () => false, nickOf: () => '상대',
    toast: () => { calls.toast++; }, note: () => { calls.note++; },
  };
  const net = { toss: () => { calls.sent++; }, tossMany() {}, stat() {} };
  const toss = new TossMgr(w, net, { cancelFishing: () => { calls.cancel++; } });
  return { w, rp, calls, toss };
}
const hitMe = { f: 'o', fx: 2, fy: 4, tx: 2, ty: 2 };

test('말랑이: 착지 전에 맵을 옮기면 스턴·낚시 취소·명중 판정이 일어나지 않는다', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { w, rp, calls, toss } = tossRig();
    toss.onHitMe(hitMe);
    toss.onRemote('o', { f: 'x', fx: 0, fy: 3, tx: 2, ty: 3 });
    assert.equal(toss.throwAt(), true);
    toss.clear();
    mock.timers.tick(TOSS_FLY_MS + 1);
    assert.equal(w.me.stunUntil, undefined);
    assert.equal(rp.hitAt, undefined);
    assert.deepEqual({ cancel: calls.cancel, toast: calls.toast, note: calls.note }, { cancel: 0, toast: 0, note: 0 });
  } finally { mock.timers.reset(); }
});

test('말랑이: 같은 맵에 있으면 그대로 맞고 낚시가 취소된다', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { w, rp, calls, toss } = tossRig();
    toss.onHitMe(hitMe);
    toss.onRemote('o', { f: 'x', fx: 0, fy: 3, tx: 2, ty: 3 });
    mock.timers.tick(TOSS_FLY_MS + 1);
    assert.ok(w.me.stunUntil > 0);
    assert.ok(rp.hitAt > 0);
    assert.equal(calls.cancel, 1);
  } finally { mock.timers.reset(); }
});

test('행선지 선택 창: 이름·설명은 행선지에 적힌 것이 먼저, 지금 있는 맵과 잘못된 id 는 고를 수 없다', async () => {
  const { destView, MAP_INFO } = await import('../src/game/portal.ts');
  assert.equal(mapSource('gold-mine'), 'builtin');
  assert.deepEqual(destView({ map: 'gold-mine' }, 'main', 3), { map: 'gold-mine', name: MAP_INFO['gold-mine'].name, desc: MAP_INFO['gold-mine'].desc, count: 3, ok: true });
  assert.equal(destView({ map: 'island', label: '섬', desc: '바다 건너' }, 'main', 0).name, '섬');
  assert.equal(destView({ map: 'island' }, 'main', 0).name, 'island'); // 이름을 모르는 저장 맵은 id 로
  assert.equal(destView({ map: 'main' }, 'main', 5).ok, false);
  assert.equal(destView({ map: 'a/b' }, 'main', 0).ok, false);
});
