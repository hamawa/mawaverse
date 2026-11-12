import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// TS 소스를 바로 불러온다. 생성자 매개변수 속성(collection.ts)은 타입 지우기만으로는 못 읽어 transform 으로 바꾼다 (portal-runtime.test.mjs 와 같은 방식)
registerHooks({
  resolve(spec, ctx, next) {
    try { return next(spec, ctx); } catch (e) {
      if (spec.startsWith('.') && !/\.[cm]?[jt]s$/.test(spec)) return next(`${spec}.ts`, ctx);
      throw e;
    }
  },
  load(url, ctx, next) {
    if (!url.startsWith('file:') || !url.endsWith('.ts')) return next(url, ctx);
    return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
  },
});

const { rollGold, MINE_MS, MINE_GAP_MS, MINE_MAX, PICK_MAX, PICK_COST_UNIT, PICK_TOTAL_COST, PICK_ITEM, pickCost, pickLevelOf, pickBonus, pickAttempts, goldMax } = await import('../src/shared/mine.ts');
test('킹 도감의 완성 대상에는 겨울 어종과 꽝이 들어가지 않는다', async () => {
  const { kingEligibleFish } = await import('../src/shared/winter.ts');
  const eligible = kingEligibleFish([{ id: 'carp' }, { id: 'ice-smelt' }, { id: 'boot', junk: true }]);
  assert.deepEqual(eligible.map((f) => f.id), ['carp']);
  const book = { carp: { k: 1 } };
  assert.equal(eligible.filter((f) => book[f.id]?.k > 0).length, eligible.length);
});
const { rodTierOf, ROD_BOOST, ROD_JUNK, ROD_GOODS, isOwnItem, itemById, kingChance, enhanceChance, starFactor, ICE_ROD, ICE_ROD_ID, ICE_ROD_TIER, ICE_ROD_STARS, SCROLL, KING_ROD_ID, KING_BASE_STARS, KING_MAX_STARS, KING_CRAFT_GOLD, KING_NEED_STARS, ROD_MAX_STARS } = await import('../src/shared/shop.ts');
const { fishColl, rollSize, rollKingSize, DEFAULT_FISH } = await import('../src/shared/fish.ts');

test('채광: 한 번에 1~3개, 1개 75% · 2개 20% · 3개 5%', () => {
  assert.equal(rollGold(() => 0), 1);
  assert.equal(rollGold(() => 0.7499), 1);
  assert.equal(rollGold(() => 0.75), 2);
  assert.equal(rollGold(() => 0.9499), 2);
  assert.equal(rollGold(() => 0.95), 3);
  assert.equal(rollGold(() => 0.9999), 3);
  let sum = 0; const N = 20000; let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < N; i++) { const n = rollGold(rnd); assert.ok(n >= 1 && n <= MINE_MAX); sum += n; }
  assert.ok(Math.abs(sum / N - 1.3) < 0.03, `평균 ${sum / N}`);
  // 규칙의 최소 간격은 곡괭이질보다 조금 짧다 (통신 지연으로 정상 쓰기가 거부되지 않게)
  assert.ok(MINE_GAP_MS < MINE_MS && MINE_GAP_MS >= 2000);
});

test('규칙 생성기의 상수가 클라이언트와 같다 (채광 간격·최대 개수·제작 금덩이)', () => {
  const gen = readFileSync(new URL('../tools/gen-rules.cjs', import.meta.url), 'utf8');
  const m = /const MINE_GAP_MS = (\d+), MINE_MAX = (\d+), KING_CRAFT_GOLD = (\d+);/.exec(gen);
  assert.ok(m, 'gen-rules.cjs 에서 상수를 찾지 못함');
  assert.deepEqual([Number(m[1]), Number(m[2]), Number(m[3])], [MINE_GAP_MS, MINE_MAX, KING_CRAFT_GOLD]);
  const p = /const PICK_MAX = (\d+), PICK_COST_UNIT = (\d+);/.exec(gen);
  assert.ok(p, 'gen-rules.cjs 에서 곡괭이 상수를 찾지 못함');
  assert.deepEqual([Number(p[1]), Number(p[2])], [PICK_MAX, PICK_COST_UNIT]);
});

// ---- 곡괭이 업그레이드: 코인 전용 확정, 최대 10 ----
test('곡괭이: 목표 단계 L 의 값은 정확히 1000·L², 0→10 합계 385,000, 0단계는 무료 기본', () => {
  assert.equal(PICK_MAX, 10); assert.equal(PICK_COST_UNIT, 1000); assert.equal(PICK_ITEM, 'pick');
  for (let l = 1; l <= PICK_MAX; l++) assert.equal(pickCost(l), 1000 * l * l);
  assert.equal(PICK_TOTAL_COST, 385000);
  assert.equal(pickLevelOf(undefined), 0); assert.equal(pickLevelOf(null), 0); assert.equal(pickLevelOf(0), 0); // pi 칸이 없으면 0 (옛 지갑 호환)
  assert.equal(pickLevelOf(4), 4); assert.equal(pickLevelOf(99), PICK_MAX); assert.equal(pickLevelOf(-3), 0);
  assert.equal(isOwnItem(PICK_ITEM), false);   // 보관함 품목이 아니다: 결제 표시 b 만 남는다
  assert.equal(itemById(PICK_ITEM), undefined);
});

test('곡괭이: F 한 번에 단계+1 번, 금덩이는 기본 1/2/3(75/20/5%) + floor(단계/2), 10단계는 6~8개', () => {
  assert.equal(pickAttempts(0), 1); assert.equal(pickAttempts(10), 11);
  assert.equal(pickBonus(0), 0); assert.equal(pickBonus(1), 0); assert.equal(pickBonus(2), 1); assert.equal(pickBonus(9), 4); assert.equal(pickBonus(10), 5);
  assert.equal(goldMax(0), 3); assert.equal(goldMax(10), 8);
  assert.equal(rollGold(() => 0, 10), 6); assert.equal(rollGold(() => 0.75, 10), 7); assert.equal(rollGold(() => 0.95, 10), 8);
  assert.equal(rollGold(() => 0, 0), 1); assert.equal(rollGold(() => 0.99), 3);
  for (let lv = 0; lv <= PICK_MAX; lv++) for (const r of [0, 0.5, 0.8, 0.99]) { const n = rollGold(() => r, lv); assert.ok(n >= 1 + pickBonus(lv) && n <= goldMax(lv)); }
});

// ---- 얼음 낚싯대: 단일 영구 품목, 명품 20성급 고정, 강화·킹 없음 ----
test('얼음 낚싯대: 가격표 기본 1,000 코인의 보관함 품목, 등급 2·20성 고정, 일반 낚싯대와 서로 영향 없음', () => {
  assert.equal(ICE_ROD_ID, 'iceRod'); assert.equal(ICE_ROD.id, 'iceRod'); assert.equal(ICE_ROD.name, '얼음 낚싯대');
  assert.equal(ICE_ROD.price, 1000);
  assert.equal(itemById('iceRod'), ICE_ROD); assert.equal(isOwnItem('iceRod'), true); // 일반 구매(b='iceRod')로 보관함에 들어간다
  assert.equal(ICE_ROD_TIER, 2); assert.equal(ICE_ROD_STARS, 20);
  assert.ok(ICE_ROD.desc.includes('20성급') && ICE_ROD.desc.includes('강화'));
  // 얼음 계열 등급: 보유하면 2(명품 배수), 아니면 0. 일반 낚싯대는 얼음 낚시에 영향이 없고 반대도 같다
  assert.equal(rodTierOf({}, 'ice'), 0);
  assert.equal(rodTierOf({ iceRod: true }, 'ice'), 2);
  assert.equal(rodTierOf({ rod1: true, rod2: true, rod3: true }, 'ice'), 0);
  assert.equal(rodTierOf({ iceRod: true }), 0); assert.equal(rodTierOf({ iceRod: true }, 'normal'), 0);
  assert.equal(rodTierOf({ rod1: true, rod2: true }), 2); assert.equal(rodTierOf({ rod3: true, iceRod: true }), 3);
  assert.equal(ROD_BOOST[ICE_ROD_TIER], ROD_BOOST[2]); assert.equal(ROD_JUNK[ICE_ROD_TIER], ROD_JUNK[2]);
  assert.ok(starFactor(ICE_ROD_STARS) < starFactor(ROD_MAX_STARS)); // 명품 30성보다 약하다
  // 얼음 강화 경로가 없다: 지갑 칸·주문서 문구·계열 표가 남아 있지 않다
  assert.ok(!SCROLL.desc.includes('얼음'));
  assert.equal(itemById('iceRod1'), undefined); assert.equal(itemById('iceRod2'), undefined); assert.equal(itemById('iceRod3'), undefined);
});

test('킹 낚싯대: 등급 3, 배수는 명품과 같고 확률용 성은 35로 고정, 보관함 품목', () => {
  assert.equal(rodTierOf({}), 0);
  assert.equal(rodTierOf({ rod1: true }), 1);
  assert.equal(rodTierOf({ rod1: true, rod2: true }), 2);
  assert.equal(rodTierOf({ rod1: true, rod2: true, rod3: true }), 3);
  assert.equal(ROD_BOOST.length, 4); assert.equal(ROD_JUNK.length, 4);
  assert.equal(ROD_BOOST[3], ROD_BOOST[2]); assert.equal(ROD_JUNK[3], ROD_JUNK[2]);
  assert.equal(KING_BASE_STARS, 35);
  assert.ok(starFactor(KING_BASE_STARS) > starFactor(ROD_MAX_STARS)); // 만드는 순간 명품 30성보다 조금 좋다
  assert.equal(KING_NEED_STARS, ROD_MAX_STARS);
  assert.equal(ROD_GOODS[2].id, KING_ROD_ID);
  assert.equal(isOwnItem(KING_ROD_ID), true);   // 보관함(own)에 들어간다: 부서지면 지운다
  assert.equal(itemById(KING_ROD_ID).price, 20000);
  // 강화 확률표와 상한은 명품과 같다
  assert.equal(KING_MAX_STARS, 30);
  assert.equal(enhanceChance(0), 1); assert.equal(enhanceChance(9), 1);
  assert.ok(Math.abs(enhanceChance(29) - 0.817) < 1e-9);
});

test('킹 사이즈: 확률 0성 1% → 30성 5%, 크기는 최대 크기 × 1.5~2.0 이라 보통 낚시의 최대보다 항상 크다', () => {
  assert.ok(Math.abs(kingChance(0) - 0.01) < 1e-12);
  assert.ok(Math.abs(kingChance(10) - 0.0233333) < 1e-6);
  assert.ok(Math.abs(kingChance(30) - 0.05) < 1e-12);
  assert.equal(kingChance(99), kingChance(30));
  for (const f of DEFAULT_FISH) {
    if (f.junk) { assert.equal(rollKingSize(f, () => 0.5), 0); continue; }
    const lo = rollKingSize(f, () => 0), hi = rollKingSize(f, () => 0.999999), usual = rollSize(f, () => 0.999999);
    assert.ok(lo >= f.max * 1.5 - 0.5 && hi <= f.max * 2 + 0.5, `${f.id} ${lo}~${hi}`);
    assert.ok(lo > usual, `${f.id}: 킹 사이즈 최소 ${lo} 가 보통 최대 ${usual} 보다 커야 함`);
    assert.ok(usual <= f.max);
  }
  // 큰 쪽일수록 드물다: 가운데 난수는 범위의 아래쪽에 떨어진다
  const f = DEFAULT_FISH.find((x) => !x.junk && x.max >= 100) || DEFAULT_FISH.find((x) => !x.junk);
  assert.ok(fishColl.rollKingSize(f, () => 0.5) < f.max * 1.75);
});

// ---- 빠따: 방어 깨기 (2026-11-11 밸런스 패치) ----
const { BAT, GUARD_BREAK_MS, guardedOf, guardBrokenOf, assignBats } = await import('../src/shared/shop.ts');

test('빠따: 방어 판정은 갑옷 종류별·펫 Lv8 공통, 깨져 있는 동안은 방어가 없다', () => {
  const now = 1_000_000;
  assert.equal(BAT.id, 'bat'); assert.equal(BAT.kind, 'use'); assert.equal(BAT.price, 1000);
  assert.equal(isOwnItem('bat'), false); // 소모품: 보관함이 아니라 지갑(bt)에 센다
  assert.equal(GUARD_BREAK_MS, 60000);
  assert.equal(guardedOf(undefined, 'push', now), false);
  assert.equal(guardedOf({}, 'push', now), false);
  // 철벽 갑옷은 밀치기·끌기만, 푹신 갑옷은 말랑이만
  assert.equal(guardedOf({ pa: true }, 'push', now), true);
  assert.equal(guardedOf({ pa: true }, 'toss', now), false);
  assert.equal(guardedOf({ ta: true }, 'toss', now), true);
  assert.equal(guardedOf({ ta: true }, 'push', now), false);
  // 펫 Lv8(먹이 170) 이상은 둘 다 막는다. 데리고 있을 때만
  assert.equal(guardedOf({ pt: 'petdog', pl: 170 }, 'push', now), true);
  assert.equal(guardedOf({ pt: 'petdog', pl: 170 }, 'toss', now), true);
  assert.equal(guardedOf({ pt: 'petdog', pl: 169 }, 'push', now), false);
  assert.equal(guardedOf({ pl: 300 }, 'push', now), false);
  // 깨진 상태: gb(풀리는 시각)가 지금보다 뒤면 갑옷도 펫도 없는 것으로 본다. 시간이 지나면 저절로 돌아온다
  const broken = { pa: true, ta: true, pt: 'petdog', pl: 300, gb: now + 1 };
  assert.equal(guardBrokenOf(broken, now), true);
  assert.equal(guardedOf(broken, 'push', now), false);
  assert.equal(guardedOf(broken, 'toss', now), false);
  assert.equal(guardBrokenOf(broken, now + 1), false);
  assert.equal(guardedOf(broken, 'push', now + 1), true);
  assert.equal(guardBrokenOf({ gb: null }, now), false);
});

test('빠따: 방어 중인 사람에게만 한 개씩 쓰고, 모자라면 나머지는 막힌다', () => {
  assert.deepEqual(assignBats([], 5), []);
  assert.deepEqual(assignBats([false, false], 5), [{ bat: false, blocked: false }, { bat: false, blocked: false }]); // 방어가 없으면 안 쓴다
  assert.deepEqual(assignBats([true, false, true, true], 2), [
    { bat: true, blocked: false }, { bat: false, blocked: false }, { bat: true, blocked: false }, { bat: false, blocked: true },
  ]);
  assert.deepEqual(assignBats([true, true], 0), [{ bat: false, blocked: true }, { bat: false, blocked: true }]); // 빠따가 없거나 자동 사용을 껐다
  assert.equal(assignBats([true, true, true], 99).filter((x) => x.bat).length, 3);
});

// ---- 만렙 펫: 타고 다닐지 데리고 다닐지 (2026-11-12 건의 반영) ----
test('펫 탑승: 만렙(먹이 300)이고 내리기를 고르지 않았을 때만 탄다', async () => {
  const { petRiding, petCanRide, petSpeedMul, petGuard } = await import('../src/shared/shop.ts');
  assert.equal(petRiding(299), false);
  assert.equal(petRiding(300), true);           // 기본은 지금까지처럼 탄다
  assert.equal(petRiding(300, null), true);
  assert.equal(petRiding(300, false), true);
  assert.equal(petRiding(300, true), false);    // 내려서 데리고 다니기
  assert.equal(petRiding(100, true), false);
  // 내려도 탈 수 있는 레벨이라는 사실과 펫 효과(속도·방어)는 그대로다: 모습만 바뀐다
  assert.equal(petCanRide(300), true);
  assert.equal(petSpeedMul(300), 1.25);
  assert.equal(petGuard(300), true);
});

// ---- MineMgr: F 한 번에 단계+1 번, 그다음 멈춤 ----
const { mock } = await import('node:test');
const { MineMgr } = await import('../src/game/mine.ts');
const { G_GOLD } = await import('../src/game/map.ts');

function rig(level) {
  let t = 1000;
  mock.method(performance, 'now', () => t);
  const writes = [], pending = [];
  const rigState = { hold: false, ok: true };
  const w = {
    mapId: 'gold-mine', switching: false,
    map: { w: 3, h: 3, ground: Array.from({ length: 9 }, (_, i) => (i === 7 ? G_GOLD : 0)) }, // (1,2) 가 금덩어리
    me: { x: 1, y: 1, dir: 0, moving: false, locked: false, roomId: null },
    wallet: {
      pickLevel: level, gold: 0,
      mine(n) { writes.push({ n, at: t }); if (rigState.hold) return new Promise((r) => pending.push(r)); return Promise.resolve(rigState.ok); },
    },
    notes: [], note(m) { this.notes.push(m); }, catchNote() {}, toast() {},
  };
  const marks = [];
  const mgr = new MineMgr(w, { setMining: (on) => marks.push(on), stat() {} });
  const step = async (ms) => { for (let i = 0; i < ms / 100; i++) { t += 100; mgr.tick(t); await new Promise((r) => setImmediate(r)); } };
  return { w, mgr, writes, pending, rigState, marks, step, restore: () => mock.restoreAll() };
}

test('MineMgr: 곡괭이 단계+1 번을 차례로 치고 멈춘다 (0단계 1번, 10단계 11번), 쓰기 간격은 곡괭이질 시간 이상, 끝난 뒤 자동 재시작 없음', async () => {
  for (const level of [0, 3, 10]) {
    const r = rig(level);
    try {
      assert.equal(r.mgr.nextAttempts, level + 1);
      assert.equal(r.mgr.begin(), true);
      assert.equal(r.mgr.remaining, level + 1); assert.equal(r.mgr.attempts, level + 1);
      assert.equal(r.mgr.begin(), false); // 치는 중 F 무시
      await r.step(MINE_MS);
      assert.equal(r.writes.length, 1);
      if (level > 0) assert.equal(r.mgr.begin(), false); // 아직 치는 중이라 무시
      await r.step(MINE_MS * (level + 3));
      assert.equal(r.writes.length, level + 1);
      assert.equal(r.mgr.active, false);
      for (let i = 1; i < r.writes.length; i++) assert.ok(r.writes[i].at - r.writes[i - 1].at >= MINE_GAP_MS);
      for (const x of r.writes) assert.ok(x.n >= 1 + pickBonus(level) && x.n <= goldMax(level));
      if (level === 10) assert.ok(r.writes.every((x) => x.n >= 6 && x.n <= 8));
    } finally { r.restore(); }
  }
});

test('MineMgr: 한 묶음이 끝나면 멈춘다 (다시 F 를 누르기 전에는 더 안 친다)', async () => {
  const r = rig(2);
  try {
    r.mgr.begin();
    await r.step(MINE_MS * 5);
    assert.equal(r.writes.length, 3); assert.equal(r.mgr.active, false); assert.equal(r.mgr.remaining, 0);
    await r.step(MINE_MS * 5);
    assert.equal(r.writes.length, 3);
    assert.equal(r.mgr.begin(), true); // 다시 F: 새 묶음
    assert.equal(r.mgr.remaining, 3);
  } finally { r.restore(); }
});

test('MineMgr: 이동·돌아서기·맵 이동·단계 변경은 남은 횟수를 취소하고, 저장된 보상은 남는다', async () => {
  const cases = {
    '이동': (r) => { r.w.me.x = 2; },
    '이동 중': (r) => { r.w.me.moving = true; },
    '돌아서기': (r) => { r.w.me.dir = 1; },
    '맵 이동': (r) => { r.w.mapId = 'main'; },
    '맵 전환 중': (r) => { r.w.switching = true; },
    '업그레이드로 단계 변경': (r) => { r.w.wallet.pickLevel = 5; },
  };
  for (const [name, act] of Object.entries(cases)) {
    const r = rig(4);
    try {
      r.mgr.begin();
      await r.step(MINE_MS * 2);              // 두 번 저장됨
      assert.equal(r.writes.length, 2, name);
      await r.step(MINE_MS - 300);            // 세 번째 곡괭이질 도중
      act(r);
      await r.step(MINE_MS * 5);
      assert.equal(r.writes.length, 2, `${name}: 끝나지 않은 곡괭이질은 보상 없음`);
      assert.equal(r.mgr.active, false, name);
    } finally { r.restore(); }
  }
});

test('MineMgr: 저장을 기다리는 동안 취소·새 F 가 있어도 옛 비동기 완료가 다음 곡괭이질을 시작하거나 새 묶음을 바꾸지 않는다', async () => {
  const r = rig(3);
  try {
    r.rigState.hold = true;
    r.mgr.begin();
    await r.step(MINE_MS);
    assert.equal(r.writes.length, 1); assert.equal(r.mgr.saving, true);
    assert.equal(r.mgr.begin(), false);      // 저장 중 F 무시
    r.mgr.cancel();                          // (밀림 등) 저장 중에 취소
    assert.equal(r.mgr.active, false);
    r.rigState.hold = false;
    assert.equal(r.mgr.begin(), true);       // 새 묶음
    assert.equal(r.mgr.remaining, 4);
    r.pending.shift()(true);                 // 옛 저장이 이제 끝난다
    await new Promise((x) => setImmediate(x));
    assert.equal(r.mgr.remaining, 4);        // 새 묶음은 그대로
    assert.equal(r.writes.length, 1);
    await r.step(MINE_MS);
    assert.equal(r.writes.length, 2);        // 새 묶음의 첫 곡괭이질만
    // 맵 이동(left) 뒤 옛 저장 완료도 아무것도 시작하지 않는다
    r.rigState.hold = true;
    await r.step(MINE_MS);
    assert.equal(r.writes.length, 3);
    r.mgr.left(); r.w.mapId = 'main';
    r.rigState.hold = false;
    r.pending.shift()(true);
    await r.step(MINE_MS * 5);
    assert.equal(r.writes.length, 3); assert.equal(r.mgr.active, false);
  } finally { r.restore(); }
});

test('MineMgr: 저장이 실패하면 남은 횟수를 접고 멈춘다', async () => {
  const r = rig(5);
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (f) => realSetTimeout(f, 0); // 재시도 대기(700ms)를 줄인다
  try {
    r.rigState.ok = false;
    r.mgr.begin();
    await r.step(MINE_MS);
    await new Promise((x) => realSetTimeout(x, 20));
    assert.equal(r.writes.length, 2);        // 한 번 재시도
    assert.equal(r.mgr.active, false);
    await r.step(MINE_MS * 3);
    assert.equal(r.writes.length, 2);
  } finally { globalThis.setTimeout = realSetTimeout; r.restore(); }
});

test('MineMgr: 채광 중 표시(mn)는 곡괭이질마다 쓰지 않고 처음 한 번 켠다', async () => {
  const r = rig(4);
  try {
    r.mgr.begin();
    await r.step(MINE_MS * 6);
    assert.deepEqual(r.marks, [true]);
  } finally { r.restore(); }
});

test('겨울 물고기 풀: 일반 풀과 겹치지 않고 DB 목록에 영향받지 않는다', async () => {
  const { WINTER_FISH, pickWinterFish, winterFishById, isWinterFish } = await import('../src/shared/winter.ts');
  const { DEFAULT_FISH, fishById, setFishDefs } = await import('../src/shared/fish.ts');
  const ordinary = new Set(DEFAULT_FISH.map((f) => f.id));
  for (const f of WINTER_FISH) { assert.ok(isWinterFish(f.id)); assert.ok(!ordinary.has(f.id)); assert.equal(fishById(f.id), undefined); assert.ok(!f.time); }
  for (let i = 0; i < 300; i++) { const f = pickWinterFish(); assert.ok(winterFishById(f.id)); }
  setFishDefs([{ id: 'x', name: 'x', icon: 'x', rarity: 0, min: 1, max: 2, w: 1 }]); // 관리자 DB 목록을 바꿔도
  try { assert.ok(winterFishById(pickWinterFish().id)); } finally { setFishDefs(null); }
  assert.equal(pickWinterFish(() => 0, { noJunk: true, minRarity: 1 }).junk ?? false, false);
});
