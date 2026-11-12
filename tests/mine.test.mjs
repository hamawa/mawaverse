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

const { rollGold, MINE_MS, MINE_GAP_MS, MINE_MAX } = await import('../src/shared/mine.ts');
const { rodTierOf, ROD_BOOST, ROD_JUNK, ROD_GOODS, isOwnItem, itemById, kingChance, enhanceChance, starFactor, KING_ROD_ID, KING_BASE_STARS, KING_MAX_STARS, KING_CRAFT_GOLD, KING_NEED_STARS, ROD_MAX_STARS } = await import('../src/shared/shop.ts');
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
