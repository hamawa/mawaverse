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
