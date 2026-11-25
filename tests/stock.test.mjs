// 거래소 계산 시험 (2026-11-19). 실행: node --test tests/stock.test.mjs
// 가격 한 걸음의 식, 수수료, 규칙에 든 숫자가 코드와 같은지 본다. 규칙이 실제로 받고 거부하는지는 tests/rules-gate.test.mjs (에뮬레이터)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
const S = await import('../src/shared/stock.ts');
const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules.stock;

test('수수료: 거래액의 2% 를 올림하고, 사고 바로 팔면 그만큼 손해다', () => {
  assert.equal(S.stockFee(0), 0);
  assert.equal(S.stockFee(1000), 20);
  assert.equal(S.stockFee(1001), 21);
  assert.equal(S.stockFee(49), 1);
  assert.equal(S.buyCost(1, 1000), 1020);
  assert.equal(S.sellNet(1, 1000), 980);
  assert.equal(S.buyCost(100, 1234), 123400 + 2468);
  for (const [q, p] of [[1, 100], [7, 333], [100, 9999], [13, 1017]]) {
    assert.ok(Number.isInteger(S.buyCost(q, p)) && Number.isInteger(S.sellNet(q, p)));
    assert.ok(S.buyCost(q, p) - S.sellNet(q, p) >= q * p * 0.04 - 1e-9, '왕복 수수료는 4% 이상');
  }
});

test('가격 한 걸음: 같은 값이면 같은 결과, 한 번에 정해진 폭 안에서만 움직이고 범위를 벗어나지 않는다', () => {
  for (const s of S.STOCKS) {
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < 4000; k++) {
      const at = 1_800_000_000_000 + k * 7919 + (k % 13);
      const v = S.stepPrice(1000, at, s.sym);
      assert.equal(v, S.stepPrice(1000, at, s.sym));
      assert.ok(Number.isInteger(v));
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    assert.ok(lo >= 1000 - s.amp - 1 && hi <= 1000 + s.amp + 1, `${s.name} ${lo}~${hi}`);
    assert.ok(hi - lo >= s.amp, `${s.name} 은 폭을 넓게 쓴다 (${lo}~${hi})`);
  }
  assert.equal(S.stepPrice(100, 1_800_000_000_499, 'c') >= S.STOCK_MIN, true);
  assert.equal(S.stepPrice(9999, 1_800_000_000_999, 'c') <= S.STOCK_MAX, true);
  // 같은 순간에 굴려도 종목마다 다르게 움직인다
  const same = [...Array(200)].filter((_, k) => { const at = 1_800_000_123_000 + k; return Math.sign(S.stepPrice(1000, at, 'a') - 1000) === Math.sign(S.stepPrice(1000, at, 'c') - 1000); }).length;
  assert.ok(same > 40 && same < 160, `방향이 같은 횟수 ${same}/200`);
});

test('가격: 오래 굴려도 중앙값이 중심 근처에 머물고(아래로 눌러앉지 않는다), 급등락 종목일수록 넓게 움직인다', () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const spread = {};
  for (const s of S.STOCKS) {
    let v = S.STOCK_BASE, at = 1_800_000_000_000;
    const N = 150000, vals = new Array(N);
    for (let k = 0; k < N; k++) { at += S.TICK_MS + Math.floor(rnd() * 20000); v = S.stepPrice(v, at, s.sym); vals[k] = v; }
    vals.sort((a, b) => a - b);
    const med = vals[N >> 1], lo = vals[Math.floor(N * 0.05)], hi = vals[Math.floor(N * 0.95)];
    // 급등락 종목은 한 번 멀리 가면 오래 머물러서 표본의 중앙값도 꽤 흔들린다: 넉넉하게 본다
    assert.ok(med > (s.sym === 'c' ? 450 : 800) && med < (s.sym === 'c' ? 2200 : 1250), `${s.name} 중앙값 ${med}`);
    assert.ok(vals[0] >= S.STOCK_MIN && vals[N - 1] <= S.STOCK_MAX);
    spread[s.sym] = hi / lo;
  }
  assert.ok(spread.a < spread.b && spread.b < spread.c, JSON.stringify(spread));
});

test('규칙에 든 숫자와 식이 코드와 같다', () => {
  const p = rules.p.$sym['.validate'], h = rules.h.$uid['.validate'], hist = rules.hist.$sym.$slot['.validate'];
  for (const s of S.STOCKS) { assert.ok(p.includes(`$sym == '${s.sym}' ? ${s.amp}`) || p.includes(`: ${s.amp})`), `${s.name} 폭`); assert.ok(p.includes(String(s.mul)), `${s.name} 섞는 수`); }
  assert.ok(p.includes('% 100003') && p.includes('* 2 - 999) / 999') && p.includes(`/ 6000 + (${S.STOCK_BASE} - `) && p.includes(`) / (${S.STOCK_BASE} + `));
  assert.ok(p.includes(`+ ${S.TICK_MS})`) && p.includes("newData.child('at').val() == now"));
  assert.ok(p.includes(`== ${S.STOCK_MIN} &&`) && p.includes(`== ${S.STOCK_MAX} &&`));
  assert.ok(h.includes(`+ ${S.STOCK_FEE_DIV - 1} - (`) && h.includes(`% ${S.STOCK_FEE_DIV}) / ${S.STOCK_FEE_DIV}`));
  assert.ok(rules.h.$uid.$sym.q['.validate'].includes(`<= ${S.STOCK_CAP}`));
  assert.ok(hist.includes(`% ${S.HIST_SLOTS})`) && hist.includes(`% ${S.TICK_MS}) / ${S.TICK_MS}`));
  // 반영되지 않은 가격으로는 거래할 수 없다 (세 종목 모두)
  for (const s of S.STOCKS) assert.ok(h.includes(`root.child('stock/p/${s.sym}/sa').val() == root.child('stock/p/${s.sym}/at').val()`));
  // 보유만 지워서 규칙을 비켜 가지 못한다: 지갑이 남아 있으면 지울 수 없다
  assert.ok(rules.h.$uid['.write'].includes("newData.exists() || !newData.parent().parent().parent().child('wallet/' + $uid).exists()"));
});

test('하락 상품: 값은 1,000,000 ÷ 가격(내림)이고, 가격이 내리면 오른다', () => {
  assert.equal(S.invPrice(1000), 1000);
  assert.equal(S.invPrice(500), 2000);
  assert.equal(S.invPrice(2000), 500);
  assert.equal(S.invPrice(1500), 666);
  assert.equal(S.invPrice(S.STOCK_MIN), 10000);
  assert.equal(S.invPrice(S.STOCK_MAX), 100);
  for (let v = S.STOCK_MIN; v <= S.STOCK_MAX; v++) {
    const p = S.invPrice(v);
    assert.ok(Number.isInteger(p) && p >= 100 && p <= 10000, `v=${v} → ${p}`);
    if (v > S.STOCK_MIN) assert.ok(p <= S.invPrice(v - 1), `v=${v}: 가격이 오르면 값은 오르지 않는다`);
    // 규칙의 식 (x - x % 1) 과 같은 값이다. 소수부가 0 이 아니면 1/9999 이상이라 실수 오차에 걸리지 않는다
    const x = 1000000 / v, frac = x % 1;
    assert.equal(x - frac, p);
    assert.ok(frac === 0 || frac > 0.00009, `v=${v} 소수부 ${frac}`);
  }
  assert.ok(S.STOCK_INV_CAP < S.STOCK_CAP, '하락 상품의 한도는 보통 종목보다 낮다');
  // 가격이 20% 내리면 하락 상품은 25% 오른다 (수수료 전)
  assert.equal(S.invPrice(800), 1250);
  assert.ok(S.sellNet(10, S.invPrice(800)) > S.buyCost(10, S.invPrice(1000)));
});

test('손익 순위: 평가 손익과 실현 손익을 더해 줄 세운다', () => {
  const price = (sym) => ({ a: 1000, b: 800, c: 2000 }[sym]);
  const rows = S.stockRank({
    u1: { a: { q: 10, a: 9000 } },                                  // 평가: sellNet(10, 1000) - 9000
    u2: { c: { iq: 10, ia: 10200, r: 300 }, b: { q: 0, a: 0, r: -5000 } }, // 하락 상품: 값 500
    u3: { a: { q: 0, a: 0, r: 7000 } },                              // 다 팔았다: 실현만
    u4: { a: { q: 0, a: 0 } },                                       // 기록 전에 다 판 사람은 안 나온다
    u5: null,
  }, price);
  assert.deepEqual(rows.map((r) => r.uid), ['u3', 'u1', 'u2']);
  const [r3, r1, r2] = rows;
  assert.deepEqual([r3.total, r3.open, r3.real, r3.pct, r3.held.length], [7000, 0, 7000, null, 0]);
  assert.equal(r1.open, S.sellNet(10, 1000) - 9000);
  assert.equal(r1.total, r1.open);
  assert.ok(Math.abs(r1.pct - (r1.open / 9000) * 100) < 1e-9);
  assert.equal(r2.worth, S.sellNet(10, 500));
  assert.equal(r2.total, S.sellNet(10, 500) - 10200 + 300 - 5000);
  assert.deepEqual(r2.held, [{ sym: 'c', q: 0, iq: 10 }]);
  assert.deepEqual(S.stockRank(null, price), []);
});

test('규칙: 하락 상품의 금액 식·한도·반영 확인이 코드와 같다', () => {
  const h = rules.h.$uid['.validate'], sym = rules.h.$uid.$sym;
  for (const s of S.STOCKS) {
    const v = `root.child('stock/p/${s.sym}/v').val()`;
    assert.ok(h.includes(`(${S.STOCK_INV_NUM} / ${v} - ${S.STOCK_INV_NUM} / ${v} % 1)`), `${s.name} 하락 상품의 값`);
    assert.ok(h.includes(`newData.child('${s.sym}/iq')`) && h.includes(`data.child('${s.sym}/iq')`), `${s.name} 하락 상품 보유`);
    // 반영되지 않은 가격으로는 하락 상품도 거래할 수 없다
    assert.ok(new RegExp(`\\(\\(.{0,220}child\\('${s.sym}/iq'\\).{0,220}\\) \\|\\| root\\.child\\('stock/p/${s.sym}/sa'\\)\\.val\\(\\) == root\\.child\\('stock/p/${s.sym}/at'\\)\\.val\\(\\)\\)`).test(h), `${s.name} 반영 확인`);
  }
  assert.ok(sym.iq['.validate'].includes(`<= ${S.STOCK_INV_CAP}`) && sym.iq['.validate'].includes('% 1 == 0') && sym.iq['.validate'].includes('>= 0'));
  assert.ok(sym.ia && sym.r && sym.$other['.validate'] === false);
  assert.ok(sym['.validate'].includes("newData.hasChild('q') || newData.hasChild('iq')"));
});
