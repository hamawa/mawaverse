// 인디언 포커 계산 시험 (src/shared/poker.ts). 실행: node --test tests/poker.test.mjs
// 카드·정산 금액 계산은 규칙 생성기(tools/gen-rules.cjs)에도 같은 식으로 들어 있다. 판을 끝까지 치는 흐름은 에뮬레이터 규칙 시험(tests/rules-gate.test.mjs)이 본다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

register(new URL('./resolve-hook.mjs', import.meta.url));
const P = await import('../src/shared/poker.ts');
const { POKER_ANTES, POKER_CAP_MULT, POKER_TURN_MS, POKER_TURN_GRACE_MS, POKER_DEAL_LIMIT_MS, POKER_TABLE_STALE_MS, pokerCard, pokerWinner, pokerFee, pokerPayout, pokerOptions, pokerCap, sideOf, otherSide } = P;
const { SLOT_MOD } = await import('../src/shared/slots.ts');

const T0 = 1_794_500_000_000;

test('카드는 1~10 이 고르게 나온다', () => {
  const count = new Array(11).fill(0);
  for (let t = T0; t < T0 + SLOT_MOD; t++) { const c = pokerCard(t); assert.ok(Number.isInteger(c) && c >= 1 && c <= 10); count[c]++; }
  for (let c = 1; c <= 10; c++) assert.ok(Math.abs(count[c] / SLOT_MOD - 0.1) < 0.001, `${c}: ${count[c]}`);
  assert.equal(pokerWinner(7, 3), 'a'); assert.equal(pokerWinner(2, 9), 'b'); assert.equal(pokerWinner(5, 5), 'tie');
});

test('정산: 겨룬 돈은 둘 중 적게 건 쪽. 이기면 건 돈 + 그만큼 − 수수료, 지면 못 따라온 초과분만, 비김·취소는 그대로', () => {
  // 둘 다 3,000
  assert.equal(pokerPayout({ pa: 3000, pb: 3000, w: 'a' }, 'a', 5), 5700);
  assert.equal(pokerPayout({ pa: 3000, pb: 3000, w: 'a' }, 'b', 5), 0);
  assert.equal(pokerPayout({ pa: 3000, pb: 3000, w: 'tie' }, 'a', 5), 3000);
  assert.equal(pokerPayout({ pa: 3000, pb: 3000, w: 'void' }, 'b', 5), 3000);
  // 다이: 100 씩 걸린 판
  assert.equal(pokerPayout({ pa: 100, pb: 100, w: 'a' }, 'a', 5), 190);
  // 레이즈를 받고 다이: a 가 3,000 까지 올렸고 b 는 1,000 에서 다이 → a 는 3,000 + 1,000 − 100
  assert.equal(pokerPayout({ pa: 3000, pb: 1000, w: 'a' }, 'a', 5), 3900);
  assert.equal(pokerPayout({ pa: 3000, pb: 1000, w: 'a' }, 'b', 5), 0);
  // 올인: a 5,000, b 는 1,700 밖에 못 냈다
  assert.equal(pokerPayout({ pa: 5000, pb: 1700, w: 'a' }, 'a', 5), 6530);
  assert.equal(pokerPayout({ pa: 5000, pb: 1700, w: 'b' }, 'b', 5), 3230);
  assert.equal(pokerPayout({ pa: 5000, pb: 1700, w: 'b' }, 'a', 5), 3300, '진 쪽도 상대가 못 따라온 돈은 돌려받는다');
  // 수수료는 겨룬 돈의 합을 100 단위로 내린 값에서: 올인으로 100 단위가 아니어도 정수
  assert.equal(pokerFee(1700, 5), 170);
  assert.equal(pokerFee(157, 5), 15); // 314 → 300 의 5%
  for (const m of [1, 57, 157, 999, 1234]) for (const pct of [0, 1, 5, 13, 50]) assert.ok(Number.isInteger(pokerFee(m, pct)));
  // 어떤 판이든 두 사람이 받는 돈의 합 = 건 돈의 합 − 수수료(승패가 났을 때만)
  for (const [pa, pb] of [[1000, 1000], [5000, 1700], [300, 4100], [50000, 50000]]) {
    for (const w of ['a', 'b', 'tie', 'void']) {
      const sum = pokerPayout({ pa, pb, w }, 'a', 5) + pokerPayout({ pa, pb, w }, 'b', 5);
      const fee = w === 'a' || w === 'b' ? pokerFee(Math.min(pa, pb), 5) : 0;
      assert.equal(sum, pa + pb - fee, `${pa} ${pb} ${w}`);
    }
  }
});

test('내 차례에 할 수 있는 일: 체크·콜·올인 콜·레이즈 폭', () => {
  const base = { t: 't1', A: 1000, a: 'A', an: 'a', b: 'B', bn: 'b', st: 'bet', o: 0, turn: 'a', n: 0 };
  // 건 돈이 같다: 체크, 레이즈는 참가비의 1·2·5·10배
  let o = pokerOptions({ ...base, pa: 1000, pb: 1000 }, 'a', 100000);
  assert.equal(o.canCheck, true); assert.equal(o.callAdd, 0); assert.deepEqual(o.raises, [1000, 2000, 5000, 10000]);
  assert.equal(o.maxRaise, 49000, '상대가 건 1,000 위로 상한(50,000)까지');
  // 레이즈를 받았다: 콜은 차액
  o = pokerOptions({ ...base, pa: 1000, pb: 4000 }, 'a', 100000);
  assert.equal(o.canCheck, false); assert.equal(o.callAdd, 3000); assert.equal(o.callAllIn, false);
  // 돈이 모자라면 가진 만큼 올인, 레이즈는 못 한다
  o = pokerOptions({ ...base, pa: 1000, pb: 4000 }, 'a', 700);
  assert.equal(o.callAdd, 700); assert.equal(o.callAllIn, true); assert.deepEqual(o.raises, []); assert.equal(o.maxRaise, 0);
  // 콜하고 남는 돈만큼만 레이즈
  o = pokerOptions({ ...base, pa: 1000, pb: 4000 }, 'a', 5500);
  assert.deepEqual(o.raises, [1000, 2000]); assert.equal(o.maxRaise, 2000);
  // 상한에 닿으면 더 못 올린다
  o = pokerOptions({ ...base, pa: 1000, pb: 50000 }, 'a', 999999);
  assert.equal(o.maxRaise, 0); assert.equal(o.callAdd, 49000);
  assert.equal(pokerCap(1000), 50000);
  assert.equal(sideOf(base, 'A'), 'a'); assert.equal(sideOf(base, 'B'), 'b'); assert.equal(sideOf(base, 'C'), null);
  assert.equal(otherSide('a'), 'b');
});

test('규칙 생성기의 숫자가 클라이언트와 같다', () => {
  const gen = readFileSync(new URL('../tools/gen-rules.cjs', import.meta.url), 'utf8');
  const m = /const POKER_ANTES = (\[[\d, ]+\]), POKER_CAP_MULT = (\d+), POKER_TURN_LIMIT_MS = (\d+), POKER_DEAL_LIMIT_MS = (\d+), POKER_TABLE_STALE_MS = (\d+);/.exec(gen);
  assert.ok(m, 'gen-rules.cjs 에서 상수를 찾지 못함');
  assert.deepEqual(JSON.parse(m[1]), [...POKER_ANTES]);
  assert.deepEqual(m.slice(2).map(Number), [POKER_CAP_MULT, POKER_TURN_MS + POKER_TURN_GRACE_MS, POKER_DEAL_LIMIT_MS, POKER_TABLE_STALE_MS]);
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules;
  assert.ok(rules.pkh && rules.pkc && rules.pkt, '포커 규칙 블록이 원본에 들어 있다 (node tools/gen-rules.cjs final)');
  // 카드 주인은 자기 카드를 못 읽는다: a 의 카드는 b 만, b 의 카드는 a 만 (공개 전)
  assert.ok(rules.pkc.$hid.a['.read'].includes("'/b').val() == auth.uid") && !rules.pkc.$hid.a['.read'].includes("'/a').val() == auth.uid"));
  assert.ok(rules.pkc.$hid.b['.read'].includes("'/a').val() == auth.uid") && !rules.pkc.$hid.b['.read'].includes("'/b').val() == auth.uid"));
  assert.equal(rules.pkc.$hid['.read'], undefined, '카드 묶음째로는 읽을 수 없다');
  const wv = rules.wallet.$uid['.validate'];
  for (const s of ["== 'poker'", "child('pk')", "child('pc')", "child('ps')"]) assert.ok(wv.includes(s), s);
});
