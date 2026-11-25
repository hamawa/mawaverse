// 가입 신청 알림(tools/signup-notify.mjs)의 판단을 시험한다. DB 와 디스코드는 가짜로 바꿔 돌린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run, pendingUids, firstText, newText, STATE_PATH } from '../tools/signup-notify.mjs';

const URL_ = 'https://example.web.app/admin.html';

/** 가짜 DB: 경로로 읽고 쓴다. shallow 는 진짜처럼 자식 값을 true 로 줄인다. 읽은 경로를 적어 둔다 */
function fakeDb(root) {
  const reads = [];
  const walk = (path) => path.split('/').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), root);
  return {
    root,
    reads,
    async get(path, shallow = false) {
      reads.push(shallow ? `${path}?shallow` : path);
      const v = walk(path);
      if (v === undefined) return null;
      if (shallow && v && typeof v === 'object') return Object.fromEntries(Object.keys(v).map((k) => [k, true]));
      return structuredClone(v);
    },
    async put(path, value) {
      const keys = path.split('/');
      let o = root;
      for (const k of keys.slice(0, -1)) o = o[k] ??= {};
      o[keys.at(-1)] = structuredClone(value);
    },
  };
}

function setup(root) {
  const db = fakeDb(root);
  const sent = [];
  const logs = [];
  let fail = false;
  const send = async (text) => {
    if (fail) throw new Error('디스코드 전송 실패: HTTP 500');
    sent.push(text);
  };
  const go = (extra = {}) => run({ db, send, url: URL_, log: (s) => logs.push(s), ...extra });
  return { db, sent, logs, go, failing: (v) => { fail = v; } };
}

const form = (at) => ({ name: '홍길동', reason: '친구 소개', at });
const state = (root) => root.ops?.signupNotify;

test('가입 알림: 승인 안 된 신청만 대기로 센다', () => {
  assert.deepEqual(pendingUids({ a: true, b: true, c: true }, { a: true }), ['b', 'c']);
  assert.deepEqual(pendingUids(null, null), []);
  assert.deepEqual(pendingUids({ a: true }, null), ['a']);
});

test('가입 알림: 처음 돌면 연결 알림을 한 번 보내고 그때까지의 신청은 다시 알리지 않는다', async () => {
  const s = setup({ signups: { u1: form(100), u2: form(200), u3: form(50) }, approved: { u3: true } });
  const r = await s.go();
  assert.equal(r.sent, true);
  assert.deepEqual(s.sent, [firstText(2, URL_)]);
  assert.deepEqual(state(s.db.root), { t: 200 });
  await s.go();
  assert.equal(s.sent.length, 1);
});

test('가입 알림: 처음 돌 때 대기가 없어도 연결 알림은 간다', async () => {
  const s = setup({});
  await s.go();
  assert.deepEqual(s.sent, [firstText(0, URL_)]);
  assert.deepEqual(state(s.db.root), { t: 0 });
});

test('가입 알림: 새 신청은 한 번만 알린다', async () => {
  const s = setup({ signups: { u1: form(100) }, approved: { u1: true }, ops: { signupNotify: { t: 100 } } });
  await s.go();
  assert.deepEqual(s.sent, []);
  s.db.root.signups.u2 = form(300);
  s.db.root.signups.u3 = form(250);
  const r = await s.go();
  assert.deepEqual([r.fresh, r.pending], [2, 2]);
  assert.deepEqual(s.sent, [newText(2, 2, URL_)]);
  assert.deepEqual(state(s.db.root), { t: 300 });
  await s.go();
  assert.equal(s.sent.length, 1);
  // 하나 더 들어오면 그 한 건만 새 것으로 센다(대기는 셋)
  s.db.root.signups.u4 = form(400);
  await s.go();
  assert.equal(s.sent[1], newText(1, 3, URL_));
});

test('가입 알림: 승인하면 대기에서 빠지고, 거절 뒤 다시 신청하면 또 알린다', async () => {
  const s = setup({ signups: { u1: form(100), u2: form(200) }, ops: { signupNotify: { t: 200 } } });
  s.db.root.approved = { u1: true };   // 승인
  delete s.db.root.signups.u2;          // 거절(신청서 삭제)
  await s.go();
  assert.deepEqual(s.sent, []);
  s.db.root.signups.u2 = form(900);     // 다시 신청
  await s.go();
  assert.deepEqual(s.sent, [newText(1, 1, URL_)]);
});

test('가입 알림: 전송이 실패하면 처음 한 번만 실패로 끝내고, 되살아나면 밀린 것을 알린다', async () => {
  const s = setup({ signups: { u1: form(500) }, ops: { signupNotify: { t: 100 } } });
  s.failing(true);
  await assert.rejects(s.go(), /디스코드 전송 실패/);
  assert.deepEqual(state(s.db.root), { t: 100, e: 1 });
  const r = await s.go();   // 이어지는 실패는 조용히
  assert.deepEqual([r.failed, r.sent], [true, false]);
  assert.deepEqual(state(s.db.root), { t: 100, e: 1 });
  s.failing(false);
  await s.go();
  assert.deepEqual(s.sent, [newText(1, 1, URL_)]);
  assert.deepEqual(state(s.db.root), { t: 500 });
});

test('가입 알림: 처음 연결 알림이 실패해도 다음에 다시 시도한다', async () => {
  const s = setup({ signups: { u1: form(500) } });
  s.failing(true);
  await assert.rejects(s.go());
  assert.deepEqual(state(s.db.root), { e: 1 });
  s.failing(false);
  await s.go();
  assert.deepEqual(s.sent, [firstText(1, URL_)]);
  assert.deepEqual(state(s.db.root), { t: 500 });
});

test('가입 알림: 실명·사유를 읽지 않고, 글과 기록에 uid·이름이 없다', async () => {
  const s = setup({ signups: { 'uid-secret-1': form(300) }, approved: { other: true }, ops: { signupNotify: { t: 100 } } });
  await s.go();
  assert.deepEqual(s.db.reads, ['signups?shallow', 'approved?shallow', STATE_PATH, 'signups/uid-secret-1/at']);
  for (const text of [...s.sent, ...s.logs]) {
    assert.ok(!text.includes('uid-secret-1'), text);
    assert.ok(!text.includes('홍길동') && !text.includes('친구 소개'), text);
  }
});

test('가입 알림: --dry 는 보내지도 적지도 않는다', async () => {
  const s = setup({ signups: { u1: form(300) }, ops: { signupNotify: { t: 100 } } });
  const r = await s.go({ dry: true });
  assert.deepEqual([r.fresh, r.sent], [1, false]);
  assert.deepEqual(s.sent, []);
  assert.deepEqual(state(s.db.root), { t: 100 });
});

test('가입 알림: 워크플로가 이 도구를 5분마다 돌리고 필요한 값을 넘긴다', () => {
  const yml = readFileSync(new URL('../.github/workflows/signup-notify.yml', import.meta.url), 'utf8');
  const src = readFileSync(new URL('../tools/signup-notify.mjs', import.meta.url), 'utf8');
  assert.match(yml, /cron: '2-59\/5 \* \* \* \*'/);
  assert.match(yml, /run: node tools\/signup-notify\.mjs/);
  for (const name of ['FIREBASE_SERVICE_ACCOUNT', 'DATABASE_URL', 'DISCORD_WEBHOOK_URL']) {
    assert.match(yml, new RegExp(`^\\s+${name}: \\$\\{\\{ secrets\\.`, 'm'), name);
    assert.ok(src.includes(`process.env.${name}`), name);
  }
});
