// 슬롯 방의 즉석 게임(슬롯·홀짝) 결과 계산 시험 (src/shared/slots.ts). 실행: node --test tests/slots.test.mjs
// 같은 숫자가 규칙 생성기(tools/gen-rules.cjs)와 규칙 원본(slot/jp)에도 들어 있다: 어긋나면 정산 쓰기가 전부 거부되므로 여기서 대조한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

register(new URL('./resolve-hook.mjs', import.meta.url));
const S = await import('../src/shared/slots.ts');
const { SLOT_MOD, SLOT_MUL, SLOT_ADD, SLOT_TIERS, JACKPOT_MIN_BET, JACKPOT_SEED, JACKPOT_PCT, INSTANT_GAP_MS, ODD_EVEN_NUM, ODD_EVEN_DEN,
  slotHash, slotResult, slotPayout, slotReels, jackpotAdd, oddEvenParity, oddEvenFace, oddEvenPayout, slotBaseRtp } = S;

const T0 = 1_794_500_000_000;
// 해시가 조건에 맞는 시각을 찾는다
const findAt = (pred, from = T0) => { for (let t = from; ; t++) if (pred(slotHash(t))) return t; };
const tierAt = (i) => findAt((h) => h < SLOT_TIERS[i].below && (i === 0 || h >= SLOT_TIERS[i - 1].below));
const loseAt = () => findAt((h) => h >= SLOT_TIERS.at(-1).below);

test('해시: 0~9972 를 고르게 하나씩 쓰고, 이웃한 시각이 멀리 떨어진 값이 된다', () => {
  const seen = new Set();
  for (let t = T0; t < T0 + SLOT_MOD; t++) { const h = slotHash(t); assert.ok(h >= 0 && h < SLOT_MOD && Number.isInteger(h)); seen.add(h); }
  assert.equal(seen.size, SLOT_MOD);
  // 100ms 창 어디를 잡아도 당첨 칸이 평균(27%)에서 크게 벗어나지 않는다: 시각을 대충 맞춰서는 결과를 고를 수 없다
  const winBelow = SLOT_TIERS.at(-1).below;
  for (let w = 0; w < 60; w++) {
    let wins = 0;
    for (let t = T0 + w * 100; t < T0 + w * 100 + 100; t++) if (slotHash(t) < winBelow) wins++;
    assert.ok(wins >= 12 && wins <= 45, `창 ${w}: 당첨 ${wins}/100`);
  }
});

test('슬롯: 칸마다 배수, 잭팟은 1,000코인 이상 걸었을 때만 (적게 걸면 50배)', () => {
  const jp = tierAt(0);
  assert.deepEqual(slotResult(jp, 1000), { tier: 0, jackpot: true, mult: 50 });
  assert.deepEqual(slotResult(jp, 900), { tier: 0, jackpot: false, mult: 50 });
  assert.equal(slotPayout(jp, 1000, 77777), 77777, '잭팟은 쌓인 금액을 통째로');
  assert.equal(slotPayout(jp, 900, 77777), 45000);
  [50, 10, 4, 2, 1].forEach((mult, k) => { const at = tierAt(k + 1); assert.equal(slotResult(at, 300).mult, mult); assert.equal(slotPayout(at, 300, 99999), 300 * mult); });
  const lose = loseAt();
  assert.deepEqual(slotResult(lose, 5000), { tier: -1, jackpot: false, mult: 0 });
  assert.equal(slotPayout(lose, 5000, 99999), 0);
  assert.equal(jackpotAdd(1000), 30);
  assert.equal(jackpotAdd(100), 3);
});

test('슬롯: 환수율은 잭팟을 빼고 87% 안팎 (잭팟 3% 를 더해 약 90%)', () => {
  const base = slotBaseRtp();
  assert.ok(base > 0.865 && base < 0.875, `기본 환수율 ${base}`);
  assert.ok(base + JACKPOT_PCT / 100 < 0.92);
  // 1,000코인 미만은 잭팟 칸이 50배: 그래도 100% 를 넘지 않는다
  assert.ok(slotBaseRtp(false) < 0.93);
  // 실제로 돌려 본 평균 (1,000 미만 베팅)
  let sum = 0; const N = SLOT_MOD;
  for (let t = T0; t < T0 + N; t++) sum += slotPayout(t, 100, 0);
  assert.ok(Math.abs(sum / (N * 100) - slotBaseRtp(false)) < 1e-9);
});

test('슬롯: 화면의 릴 그림이 결과와 맞는다', () => {
  assert.deepEqual(slotReels(tierAt(0), 1000), ['💎', '💎', '💎']);
  assert.deepEqual(slotReels(tierAt(0), 100), ['7️⃣', '7️⃣', '7️⃣']);
  for (const i of [1, 2, 3]) { const r = slotReels(tierAt(i), 100); assert.ok(r[0] === r[1] && r[1] === r[2]); }
  for (let k = 0, t = T0; k < 200; k++) {
    t = findAt((h) => h >= SLOT_TIERS[3].below, t + 1);
    const res = slotResult(t, 100), r = slotReels(t, 100), same = new Set(r).size;
    if (res.tier === 4) assert.equal(same, 2, '페어: 두 칸만 같다');
    else if (res.tier === 5) { assert.equal(r[0], '🍀'); assert.equal(same, 3); }
    else { assert.equal(res.tier, -1); assert.equal(same, 3, '꽝: 세 칸이 다 다르다'); assert.ok(!r.includes('🍀')); }
  }
});

test('홀짝: 반반이고, 보여 주는 수의 홀짝이 결과와 같고, 맞히면 1.9배', () => {
  let odd = 0;
  for (let t = T0; t < T0 + SLOT_MOD; t++) {
    const p = oddEvenParity(t), f = oddEvenFace(t);
    assert.ok(f >= 1 && f <= 6); assert.equal(f % 2, p);
    odd += p;
  }
  assert.ok(Math.abs(odd / SLOT_MOD - 0.5) < 0.001);
  const tOdd = findAt((h) => h % 2 === 1), tEven = findAt((h) => h % 2 === 0);
  assert.equal(oddEvenPayout(tOdd, 1000, 1), 1900);
  assert.equal(oddEvenPayout(tOdd, 1000, 0), 0);
  assert.equal(oddEvenPayout(tEven, 300, 0), 570);
  assert.equal(ODD_EVEN_NUM / ODD_EVEN_DEN, 1.9);
});

test('규칙 생성기와 규칙 원본의 숫자가 클라이언트와 같다', () => {
  const gen = readFileSync(new URL('../tools/gen-rules.cjs', import.meta.url), 'utf8');
  const m = /const SLOT_MOD = (\d+), SLOT_MUL = (\d+), SLOT_ADD = (\d+), JACKPOT_MIN_BET = (\d+), JACKPOT_SEED = (\d+), INSTANT_GAP_MS = (\d+);/.exec(gen);
  assert.ok(m, 'gen-rules.cjs 에서 상수를 찾지 못함');
  assert.deepEqual(m.slice(1).map(Number), [SLOT_MOD, SLOT_MUL, SLOT_ADD, JACKPOT_MIN_BET, JACKPOT_SEED, INSTANT_GAP_MS]);
  const tiers = /const SLOT_TIERS = (\[\[.*?\]\]);/.exec(gen);
  assert.ok(tiers);
  assert.deepEqual(JSON.parse(tiers[1]), SLOT_TIERS.map((t) => [t.below, t.mult]));
  const oe = /const ODD_EVEN_NUM = (\d+), ODD_EVEN_DEN = (\d+);/.exec(gen);
  assert.deepEqual([Number(oe[1]), Number(oe[2])], [ODD_EVEN_NUM, ODD_EVEN_DEN]);
  // 잭팟 금액 규칙(손으로 넣은 줄): 기여 3%, 되돌리는 금액, 해시 식, 잭팟 조건
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules;
  const jp = rules.slot.jp['.validate'];
  assert.ok(jp.includes(`* ${JACKPOT_PCT} / 100`));
  assert.ok(jp.includes(`newData.val() == ${JACKPOT_SEED}`));
  assert.ok(jp.includes(`% ${SLOT_MOD}) * ${SLOT_MUL} + ${SLOT_ADD}) % ${SLOT_MOD} < ${SLOT_TIERS[0].below}`));
  assert.ok(jp.includes(`>= ${JACKPOT_MIN_BET}`));
  // 지갑 규칙에 즉석 게임 분기가 들어 있다
  const wv = rules.wallet.$uid['.validate'];
  for (const s of ["== 'slot'", "== 'oddeven'", "child('ic')", 'slot/jp']) assert.ok(wv.includes(s), s);
});
