// 겨울 맵의 빙판 관성·눈덩이 시험 (src/game/winterplay.ts). 실제 게임(world.ts)과 미리보기(dev/main.ts)가 같은 로직을 쓴다.
// 실행: node --test tests/winterplay.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolve-hook.mjs', import.meta.url));

const { WinterPlay, SLIDE_EXTRA, LARGE_ROLLS, SNOW_SEEDS, MAX_SNOWMEN, MIN_BALLS } = await import('../src/game/winterplay.ts');
const { buildWinterMap, buildDefaultMap, emptyMap, isWalkable, portalNear, groundAt, G_SNOW, G_ICE, G_ICE_HOLE, O } = await import('../src/game/map.ts');
const { STEP_MS } = await import('../src/shared/config.ts');

const DX = [0, -1, 1, 0], DY = [1, 0, 0, -1];

// 월드 tick 과 같은 순서로 관성을 돌린다: 방향키 걸음 하나가 끝난 자리에서 시작해, 이어 갈 칸이 없을 때까지. 걸음마다 한 칸(= Net.step 한 번)
function slide(play, map, from, dir, canStep = (x, y) => isWalkable(map, x, y)) {
  play.armSlide(dir);
  const path = [];
  let { x, y } = from;
  for (let i = 0; i < 20; i++) {
    const s = play.slideStep(x, y, canStep);
    if (!s) break;
    assert.equal(Math.abs(s.x - x) + Math.abs(s.y - y), 1, '한 번에 한 칸');
    assert.equal(s.dir, dir);
    ({ x, y } = s); path.push({ x, y });
  }
  return path;
}
// 작은 시험 맵: 왼쪽 눈, x=5..14 빙판
function miniMap(id = 'winter') {
  const m = emptyMap(id, 't', 20, 10);
  m.ground.fill(G_SNOW);
  for (let y = 0; y < 10; y++) for (let x = 5; x <= 14; x++) m.ground[y * 20 + x] = G_ICE;
  return m;
}

test('빙판: 방향키를 떼면 같은 방향으로 최대 3칸 더 미끄러진다', () => {
  const m = miniMap(); const p = new WinterPlay(m);
  assert.equal(SLIDE_EXTRA, 3);
  assert.deepEqual(slide(p, m, { x: 6, y: 4 }, 2), [{ x: 7, y: 4 }, { x: 8, y: 4 }, { x: 9, y: 4 }]);
  assert.equal(p.sliding, false);
  assert.deepEqual(slide(p, m, { x: 8, y: 2 }, 0), [{ x: 8, y: 3 }, { x: 8, y: 4 }, { x: 8, y: 5 }]); // 대각선이 아니라 한 방향
  assert.deepEqual(slide(p, m, { x: 10, y: 8 }, 3).length, 3);
  assert.deepEqual(slide(p, m, { x: 10, y: 8 }, 1).length, 3);
});

test('빙판: 방향을 다시 누르면(새 걸음) 남은 칸이 다시 3칸으로 채워진다', () => {
  const m = miniMap(); const p = new WinterPlay(m);
  p.armSlide(2);
  assert.ok(p.slideStep(6, 4, () => true)); assert.ok(p.slideStep(7, 4, () => true));
  p.armSlide(0); // 아래로 새로 걸음
  assert.deepEqual([p.slideStep(7, 5, () => true), p.slideStep(7, 6, () => true), p.slideStep(7, 7, () => true)].map((s) => s && s.dir), [0, 0, 0]);
  assert.equal(p.slideStep(7, 8, () => true), null);
});

test('빙판: 장애물·사람·눈·구멍을 만나면 멈춘다 (구멍 가장자리까지만)', () => {
  const m = miniMap(); const p = new WinterPlay(m);
  m.objects[4 * 20 + 9] = O.PINE;                       // 나무
  assert.deepEqual(slide(p, m, { x: 6, y: 4 }, 2), [{ x: 7, y: 4 }, { x: 8, y: 4 }]);
  m.objects[4 * 20 + 9] = O.NONE;
  assert.deepEqual(slide(p, m, { x: 6, y: 4 }, 2, (x, y) => isWalkable(m, x, y) && !(x === 8 && y === 4)), [{ x: 7, y: 4 }]); // 사람
  assert.deepEqual(slide(p, m, { x: 13, y: 4 }, 2), [{ x: 14, y: 4 }]);    // 눈(x=15)에서 멈춤
  assert.deepEqual(slide(p, m, { x: 6, y: 4 }, 1), [{ x: 5, y: 4 }]);      // 왼쪽 눈(x=4)에서 멈춤
  m.ground[4 * 20 + 9] = G_ICE_HOLE;                    // 구멍
  assert.deepEqual(slide(p, m, { x: 6, y: 4 }, 2), [{ x: 7, y: 4 }, { x: 8, y: 4 }]);
  assert.equal(slide(p, m, { x: 8, y: 4 }, 2).length, 0); // 구멍 바로 옆에서는 더 못 간다 (낚시 자리)
});

test('빙판: 눈 위에서는 미끄러지지 않는다', () => {
  const m = miniMap(); const p = new WinterPlay(m);
  assert.deepEqual(slide(p, m, { x: 2, y: 4 }, 2), []);
  assert.deepEqual(slide(p, m, { x: 4, y: 4 }, 2), []); // 눈에서 막 얼음으로 들어서려는 칸: 현재 칸이 눈이면 관성 없음
});

test('빙판: 초기화(F·밀림·순간이동·맵 이동·뒤쪽 탭)하면 더 미끄러지지 않는다', () => {
  const m = miniMap(); const p = new WinterPlay(m);
  p.armSlide(2); assert.equal(p.sliding, true);
  p.resetSlide();
  assert.equal(p.sliding, false);
  assert.equal(p.slideStep(6, 4, () => true), null);
  p.armSlide(2); p.slideStep(6, 4, () => true);
  const reentered = new WinterPlay(m); // 맵에 다시 들어오면 새 인스턴스
  assert.equal(reentered.slideStep(7, 4, () => true), null);
});

test('다른 맵에서는 얼음 바닥이 있어도 미끄러지지 않는다', () => {
  for (const m of [miniMap('main'), miniMap('portal-garden'), buildDefaultMap()]) {
    const p = new WinterPlay(m);
    p.armSlide(2);
    assert.equal(p.sliding, false);
    assert.equal(p.slideStep(6, 4, () => true), null);
  }
});

test('겨울 맵 실제 배치: 세로 구멍 옆에서 멈추고 구멍 안으로 들어가지 않는다', () => {
  const m = buildWinterMap(); const p = new WinterPlay(m);
  const hole = m.ground.findIndex((g) => g === G_ICE_HOLE); const hx = hole % m.w, hy = Math.floor(hole / m.w);
  assert.equal(groundAt(m, hx - 1, hy), G_ICE);
  const path = slide(p, m, { x: hx - 3, y: hy + 2 }, 2);
  assert.deepEqual(path, [{ x: hx - 2, y: hy + 2 }, { x: hx - 1, y: hy + 2 }]);
  assert.ok(path.every((t) => groundAt(m, t.x, t.y) === G_ICE));
  assert.deepEqual(slide(p, m, { x: hx, y: hy - 2 }, 0), [{ x: hx, y: hy - 1 }]); // 위에서 구멍 줄로 내려오는 길
  assert.deepEqual(slide(p, m, { x: 29, y: 10 }, 1), [{ x: 28, y: 10 }]);          // 눈 광장과 얼음의 경계
});

// ---------------- 눈덩이: 걸어 들어가 밀기 ----------------
const open = () => false;
const ballTiles = (p) => p.views().filter((v) => v.kind === 'ball').map((v) => `${v.x},${v.y}`);
const manTiles = (p) => p.views().filter((v) => v.kind === 'man').map((v) => `${v.x},${v.y}`);
// 시험용으로 눈덩이를 직접 놓는다 ([x, y, 굴린 횟수])
function setBalls(p, list) {
  p.balls.length = 0;
  for (const [x, y, rolls = 0] of list) p.balls.push({ x, y, rolls, fromX: x, fromY: y, at: -Infinity });
}
const SNOW_FAR = [[3, 20, 0], [5, 20, 0]]; // 시험과 상관없는 눈덩이 둘 (눈덩이가 모자라 시작 눈덩이가 다시 채워지는 일이 없게)

test('시작 눈덩이: 눈 광장 (12,5) 둘레의 눈 위에 작은 눈덩이로, 나무·포탈·빙판·구멍·시작 자리와 겹치지 않는다', () => {
  const m = buildWinterMap(); const p = new WinterPlay(m);
  const v = p.views();
  assert.equal(v.length, SNOW_SEEDS.length);
  assert.equal(new Set(v.map((b) => `${b.x},${b.y}`)).size, v.length);
  assert.ok(v.some((b) => b.x === 12 && b.y === 5));
  for (const b of v) {
    assert.equal(b.kind, 'ball'); assert.equal(b.rolls, 0); assert.equal(b.large, false);
    assert.equal(groundAt(m, b.x, b.y), G_SNOW); assert.ok(isWalkable(m, b.x, b.y));
    assert.equal(portalNear(m, b.x, b.y), undefined);
    assert.ok(!(b.x === m.spawn.x && b.y === m.spawn.y));
    assert.ok(p.toyAt(b.x, b.y));
  }
  assert.equal(p.toyAt(m.spawn.x, m.spawn.y), false);
});

test('다른 맵에는 눈덩이가 없다', () => {
  for (const m of [buildDefaultMap(), miniMap('main')]) {
    const p = new WinterPlay(m);
    assert.deepEqual(p.views(), []);
    assert.equal(p.pushPlan(5, 5, 2, open), null);
    assert.equal(p.toyAt(12, 5), false);
    assert.equal(p.manAhead(5, 5, 2), null);
  }
});

test('밀기: 눈덩이 쪽으로 걸어 들어가면 한 칸 밀리고 굴린 만큼 커진다. 서 있기만 하거나 다른 방향이면 안 밀린다', () => {
  const m = buildWinterMap(); const p = new WinterPlay(m);
  assert.equal(p.pushPlan(12, 5, 2, open), null);            // 눈덩이 위에 서 있다: 앞 (13,5) 에는 없음
  assert.equal(p.pushPlan(11, 6, 2, open), null);            // 앞(12,6)에 눈덩이 없음
  assert.equal(p.pushPlan(11, 5, 2, (x, y) => x === 13 && y === 5), null, '도착 칸에 사람이 있으면 못 민다');
  const plan = p.pushPlan(11, 5, 2, open);
  assert.deepEqual([plan.kind, plan.x, plan.y], ['roll', 13, 5]);
  assert.ok(ballTiles(p).includes('12,5'));                  // 계획만으로는 안 움직인다
  p.applyPush(plan, 1000, open);
  assert.ok(ballTiles(p).includes('13,5')); assert.ok(!ballTiles(p).includes('12,5'));
  assert.equal(p.views().find((v) => v.x === 13 && v.y === 5).rolls, 1);
});

test('밀기: 굴러가는 동안 칸 사이를 보간해 보인다', () => {
  const m = buildWinterMap(); const p = new WinterPlay(m);
  p.applyPush(p.pushPlan(11, 5, 2, open), 5000, open);
  const at = (t) => p.views(t).find((v) => v.y === 5 && v.x >= 12 && v.x <= 13).x;
  assert.equal(at(5000), 12);
  assert.equal(at(5000 + STEP_MS / 2), 12.5);
  assert.equal(at(5000 + STEP_MS), 13);
  assert.equal(p.toyAt(13, 5), true); // 판정은 도착 칸 기준
});

test('밀기: 눈 위에서 LARGE_ROLLS 번 굴리면 큰 눈덩이가 된다', () => {
  const m = buildWinterMap(); const p = new WinterPlay(m);
  for (let i = 0; i < LARGE_ROLLS; i++) {
    assert.equal(p.views().find((v) => v.x === 12 + i && v.y === 5).large, false);
    p.applyPush(p.pushPlan(11 + i, 5, 2, open), i, open);
  }
  const big = p.views().find((v) => v.x === 12 + LARGE_ROLLS && v.y === 5);
  assert.deepEqual([big.rolls, big.large], [LARGE_ROLLS, true]);
});

test('밀기: 도착 칸이 눈이 아니거나(빙판·구멍) 나무·포탈 옆이면 안 밀리고 길만 막는다', () => {
  const m = miniMap(); const p = new WinterPlay(m);
  setBalls(p, [[3, 4, 0], ...SNOW_FAR]);
  assert.equal(p.pushPlan(2, 4, 2, open).kind, 'roll');       // (4,4) 눈
  assert.equal(p.stepBlocked(2, 4, 3, 4, open), false);        // 밀 수 있으니 걸어 들어갈 수 있다
  p.balls[0].x = 4;
  assert.equal(p.pushPlan(3, 4, 2, open), null);               // (5,4) 빙판
  assert.equal(p.stepBlocked(3, 4, 4, 4, open), true);         // 못 밀면 눈덩이는 벽
  m.ground[4 * 20 + 5] = G_SNOW; m.objects[4 * 20 + 5] = O.PINE;
  assert.equal(p.pushPlan(3, 4, 2, open), null);               // 나무
  m.objects[4 * 20 + 5] = O.NONE; m.ground[4 * 20 + 5] = G_ICE_HOLE;
  assert.equal(p.pushPlan(3, 4, 2, open), null);               // 구멍
  assert.equal(p.stepBlocked(3, 4, 5, 4, open), false);         // 눈덩이 없는 칸은 눈덩이가 막지 않는다
});

test('밀기: 어디까지 밀어도 눈 위의 빈 칸(포탈 옆 제외)만 밟는다', () => {
  const m = buildWinterMap();
  for (let s = 0; s < SNOW_SEEDS.length; s++) for (let dir = 0; dir < 4; dir++) {
    const p = new WinterPlay(m);
    let [x, y] = SNOW_SEEDS[s];
    for (let i = 0; i < 60; i++) {
      const plan = p.pushPlan(x - DX[dir], y - DY[dir], dir, open);
      if (!plan || plan.kind !== 'roll') break;
      p.applyPush(plan, i, open);
      x = plan.x; y = plan.y;
      assert.equal(groundAt(m, x, y), G_SNOW); assert.ok(isWalkable(m, x, y)); assert.equal(portalNear(m, x, y), undefined);
    }
  }
  // 오른쪽으로 끝까지: 빙판 앞(x=27)에서 멈춘다
  const p = new WinterPlay(m); let x = 16;
  while (p.pushPlan(x - 1, 4, 2, open)) { p.applyPush(p.pushPlan(x - 1, 4, 2, open), 0, open); x++; }
  assert.equal(x, 27);
});

test('합치기: 큰 눈덩이를 큰 눈덩이에 밀어 붙일 때만 눈사람이 된다 (작은 것이 낀 합치기는 막힌다)', () => {
  const m = buildWinterMap();
  const L = LARGE_ROLLS;
  for (const [a, b, ok] of [[L, L, true], [L + 3, L, true], [L - 1, L, false], [L, L - 1, false], [0, 0, false], [0, L, false], [L, 0, false], [L - 1, L - 1, false]]) {
    const p = new WinterPlay(m); setBalls(p, [[20, 10, a], [21, 10, b], ...SNOW_FAR]);
    const plan = p.pushPlan(19, 10, 2, open);
    assert.equal(plan?.kind ?? null, ok ? 'snowman' : null, `${a}+${b}`);
    assert.equal(p.stepBlocked(19, 10, 20, 10, open), !ok); // 합칠 수 없으면 그 눈덩이는 길을 막는 벽
  }
});

test('눈사람: 큰 눈덩이 둘이 사라지고 그 자리에 눈사람이 남아 길을 막고, 굴러오는 눈덩이도 못 들어간다', () => {
  const m = buildWinterMap(); const p = new WinterPlay(m);
  setBalls(p, [[20, 10, LARGE_ROLLS], [21, 10, LARGE_ROLLS], ...SNOW_FAR]);
  p.applyPush(p.pushPlan(19, 10, 2, open), 0, open);
  assert.deepEqual(manTiles(p), ['21,10']);
  assert.ok(!ballTiles(p).includes('20,10') && !ballTiles(p).includes('21,10'));
  assert.equal(p.toyAt(21, 10), true);
  assert.equal(p.stepBlocked(20, 10, 21, 10, open), true);   // 눈사람은 밀 수 없다
  assert.equal(p.pushPlan(21, 10, 0, open), null);
  p.balls.push({ x: 22, y: 10, rolls: 0, fromX: 22, fromY: 10, at: -Infinity });
  assert.equal(p.pushPlan(23, 10, 1, open), null); // (21,10) 눈사람 칸으로는 못 민다
});

test('눈사람 부수기: 바로 앞 눈사람을 찾고, 지우면 사라진다 (지우기는 서버 벌칙이 성공한 뒤 world 가 부른다)', () => {
  const m = buildWinterMap(); const p = new WinterPlay(m);
  p.men.push({ x: 21, y: 10 });
  assert.deepEqual(p.manAhead(20, 10, 2), { x: 21, y: 10 });
  assert.equal(p.manAhead(20, 10, 1), null);
  assert.equal(p.manAhead(19, 10, 2), null); // 바로 옆이 아니다
  assert.equal(p.removeMan(5, 5), false);
  assert.equal(p.removeMan(21, 10), true);
  assert.equal(p.manAhead(20, 10, 2), null);
  assert.equal(p.toyAt(21, 10), false);
});

test('밀기를 되돌린다: 서버가 걸음을 거부하면 눈덩이도 원래 칸·크기로. 그 사이 다른 변화가 있었으면 건드리지 않는다', () => {
  const m = buildWinterMap(); const p = new WinterPlay(m);
  setBalls(p, [[20, 10, 2], [25, 10, 0], ...SNOW_FAR]);
  const before = JSON.stringify(p.views());
  const undo = p.applyPush(p.pushPlan(19, 10, 2, open), 0, open);
  assert.notEqual(JSON.stringify(p.views()), before);
  undo();
  assert.equal(JSON.stringify(p.views()), before);
  undo(); // 두 번째는 아무 일 없음
  assert.equal(JSON.stringify(p.views()), before);
  // 눈사람이 될 밀기도 되돌린다
  setBalls(p, [[20, 10, LARGE_ROLLS], [21, 10, LARGE_ROLLS], ...SNOW_FAR]);
  const b2 = JSON.stringify(p.views());
  const undo2 = p.applyPush(p.pushPlan(19, 10, 2, open), 0, open);
  assert.equal(manTiles(p).length, 1);
  undo2();
  assert.equal(JSON.stringify(p.views()), b2); assert.equal(manTiles(p).length, 0);
  // 그 뒤에 또 바뀌었으면(다른 밀기) 옛 되돌리기는 무시
  const undo3 = p.applyPush(p.pushPlan(19, 10, 2, open), 0, open);
  assert.equal(p.removeMan(21, 10), true);
  const mid = JSON.stringify(p.views());
  undo3();
  assert.equal(JSON.stringify(p.views()), mid);
});

test('다시 채우기: 합칠 눈덩이가 모자라면 밀기 뒤에만 시작 눈덩이를 채우고, 사람 자리는 피한다', () => {
  const m = buildWinterMap(); const p = new WinterPlay(m);
  setBalls(p, [[20, 10, LARGE_ROLLS], [21, 10, LARGE_ROLLS]]);
  const before = JSON.stringify(p.views());
  assert.equal(JSON.stringify(p.views(123)), JSON.stringify(p.views(123)));
  assert.equal(MIN_BALLS, 2);
  p.applyPush(p.pushPlan(19, 10, 2, open), 0, (x, y) => x === 10 && y === 7); // 눈사람이 생겨 눈덩이 0개 → 채움. (10,7) 에는 누가 서 있다
  const t = ballTiles(p);
  assert.ok(t.length > 1 && t.length <= SNOW_SEEDS.length);
  assert.ok(!t.includes('10,7'));
  for (const s of SNOW_SEEDS) if (!(s[0] === 10 && s[1] === 7)) assert.ok(t.includes(`${s[0]},${s[1]}`));
  assert.notEqual(JSON.stringify(p.views()), before);
});

test('다시 채우기: 눈사람이 MAX_SNOWMEN 개 쌓이면 더는 채우지 않는다', () => {
  const m = buildWinterMap(); const p = new WinterPlay(m);
  for (let i = 0; i < MAX_SNOWMEN - 1; i++) p.men.push({ x: 3 + i, y: 22 });
  setBalls(p, [[20, 10, LARGE_ROLLS], [21, 10, LARGE_ROLLS]]);
  p.applyPush(p.pushPlan(19, 10, 2, open), 0, open);
  assert.equal(p.men.length, MAX_SNOWMEN);
  assert.equal(ballTiles(p).length, 0);
});

test('맵에 다시 들어오면 눈덩이·눈사람이 처음 상태로 돌아온다 (지역 상태)', () => {
  const m = buildWinterMap(); const p = new WinterPlay(m);
  p.applyPush(p.pushPlan(11, 5, 2, open), 0, open);
  p.men.push({ x: 5, y: 5 });
  const again = new WinterPlay(m);
  assert.equal(again.views().length, SNOW_SEEDS.length);
  assert.ok(again.views().every((v) => v.kind === 'ball' && v.rolls === 0));
  assert.ok(ballTiles(again).includes('12,5'));
});
