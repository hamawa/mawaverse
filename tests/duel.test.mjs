// 1:1 내기(주사위 대결) 결과 계산 시험 (src/shared/duel.ts). 실행: node --test tests/duel.test.mjs
// 승자·금액 계산은 규칙 생성기(tools/gen-rules.cjs)와 규칙 원본(duel)에도 같은 식으로 들어 있다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

register(new URL('./resolve-hook.mjs', import.meta.url));
const { DUEL_ACCEPT_MS, DUEL_ACCEPT_GRACE_MS, DUEL_FEE_DEFAULT, duelFee, duelPayout, duelWinner, duelDice, duelExpired } = await import('../src/shared/duel.ts');
const { slotHash, SLOT_MOD } = await import('../src/shared/slots.ts');

const T0 = 1_794_500_000_000;

test('승패는 반반이고, 주사위 눈은 이긴 쪽이 더 크다 (비기는 판이 없다)', () => {
  let a = 0;
  const faces = new Set();
  for (let t = T0; t < T0 + SLOT_MOD; t++) {
    const w = duelWinner(t), [da, db] = duelDice(t);
    assert.ok(da >= 1 && da <= 6 && db >= 1 && db <= 6);
    assert.notEqual(da, db);
    assert.equal(w, da > db ? 'a' : 'b');
    assert.equal(w, slotHash(t) % 2 === 0 ? 'a' : 'b');
    if (w === 'a') a++;
    faces.add(`${da}:${db}`);
  }
  assert.ok(Math.abs(a / SLOT_MOD - 0.5) < 0.001);
  assert.equal(faces.size, 30, '서로 다른 눈 30가지가 다 나온다');
});

test('받는 돈: 판돈 합계 − 수수료. 수수료 설정은 숫자면 그대로 쓴다 (규칙과 같게)', () => {
  assert.equal(duelPayout(1000, 5), 1900);
  assert.equal(duelPayout(100, 5), 190);
  assert.equal(duelPayout(10000, 0), 20000);
  assert.equal(duelPayout(300, 10), 540);
  assert.equal(duelFee(undefined), DUEL_FEE_DEFAULT);
  assert.equal(duelFee(null), DUEL_FEE_DEFAULT);
  assert.equal(duelFee(0), 0);
  assert.equal(duelFee(12), 12);
  for (const s of [100, 700, 2500, 10000]) for (const p of [0, 1, 5, 13, 50]) assert.ok(Number.isInteger(duelPayout(s, p)), `${s} ${p}`);
});

test('수락 제한: 20초 + 여유 5초가 지나야 신청한 사람이 돌려받는다', () => {
  const d = { o: T0 };
  assert.equal(duelExpired(d, T0 + DUEL_ACCEPT_MS), false);
  assert.equal(duelExpired(d, T0 + DUEL_ACCEPT_MS + DUEL_ACCEPT_GRACE_MS), false);
  assert.equal(duelExpired(d, T0 + DUEL_ACCEPT_MS + DUEL_ACCEPT_GRACE_MS + 1), true);
  assert.equal(duelExpired({ o: T0, acc: T0 + 1000 }, T0 + 999999), false, '수락된 내기는 끝나지 않는다');
});

test('규칙 생성기와 규칙 원본의 숫자가 클라이언트와 같다', () => {
  const gen = readFileSync(new URL('../tools/gen-rules.cjs', import.meta.url), 'utf8');
  const m = /const DUEL_ACCEPT_LIMIT_MS = (\d+), DUEL_FEE_DEFAULT = (\d+);/.exec(gen);
  assert.ok(m, 'gen-rules.cjs 에서 상수를 찾지 못함');
  assert.deepEqual([Number(m[1]), Number(m[2])], [DUEL_ACCEPT_MS + DUEL_ACCEPT_GRACE_MS, DUEL_FEE_DEFAULT]);
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules;
  assert.ok(rules.duel.$id.acc['.validate'].includes(`+ ${DUEL_ACCEPT_MS + DUEL_ACCEPT_GRACE_MS}`));
  const wv = rules.wallet.$uid['.validate'];
  for (const s of ["== 'duel'", "child('dl')", "child('dc')", 'config/duelFee', "child('paid')"]) assert.ok(wv.includes(s), s);
});
