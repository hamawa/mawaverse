// 눈사람 부순 벌칙 시험 (src/shared/snowpenalty.ts, shop.ts guardedOf, game/snowpenalty.ts). 실행: node --test tests/snowpenalty.test.mjs
// Firebase 는 가짜로 바꾼다: 구독 콜백과 update 의 추정값 → 서버값 순서를 시험이 직접 흉내 낸다. 보안 규칙의 동작은 에뮬레이터가 있어야 증명된다 (여기서는 상수 일치만 본다)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FB = (globalThis.__fb = { now: 1_800_000_000_000, listeners: {}, updates: [], onUpdate: null, feed: [], unsubs: 0, keys: 0 });
const stub = (src) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });
const STUBS = {
  'firebase/database': `
    const FB = globalThis.__fb;
    export const ref = (_db, path) => ({ path });
    export const serverTimestamp = () => '__ts';
    export const orderByChild = (k) => ({ order: k });
    export const startAt = (v) => ({ startAt: v });
    export const limitToLast = (n) => ({ limit: n });
    export const query = (r, ...c) => ({ path: r.path, c });
    const sub = (kind) => (q, cb) => { FB.feed.push({ kind, path: q.path, order: q.c.find((x) => 'order' in x)?.order, since: q.c.find((x) => 'startAt' in x)?.startAt, n: q.c.find((x) => 'limit' in x)?.limit, cb }); return () => { FB.unsubs++; }; };
    export const onChildAdded = sub('added');
    export const onChildChanged = sub('changed');
    export const onValue = (r, cb) => { FB.listeners[r.path] = cb; return () => { FB.unsubs++; delete FB.listeners[r.path]; }; };
    export const update = async (_r, map) => { FB.updates.push(map); if (FB.onUpdate) await FB.onUpdate(map); };`,
  '../firebase/app': 'export const db = {};',
  '../firebase/db': `
    const FB = globalThis.__fb;
    export const serverNow = () => FB.now;`,
};
registerHooks({
  resolve(spec, ctx, next) {
    if (spec in STUBS) return stub(STUBS[spec]);
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

const { SNOW_PENALTY_MS, SNOW_BREAK_GAP_MS, snowBreakWaitMs, snowActive, snowRemainingMs } = await import('../src/shared/snowpenalty.ts');
const { guardedOf, guardBrokenOf } = await import('../src/shared/shop.ts');
const { SnowPenaltyMgr } = await import('../src/game/snowpenalty.ts');

const T0 = 1_800_000_000_000;
const reset = () => { Object.assign(FB, { now: T0, listeners: {}, updates: [], onUpdate: null, feed: [], unsubs: 0, keys: 0 }); };
const PATH = 'users/me/snowBrokenAt';

test('벌칙은 부순 서버 시각 + 30분 전까지만 켜져 있다 (경계 포함)', () => {
  assert.equal(SNOW_PENALTY_MS, 30 * 60 * 1000);
  assert.equal(snowActive(T0, T0), true);
  assert.equal(snowActive(T0, T0 + SNOW_PENALTY_MS - 1), true);
  assert.equal(snowActive(T0, T0 + SNOW_PENALTY_MS), false);
  assert.equal(snowRemainingMs(T0, T0 + 1000), SNOW_PENALTY_MS - 1000);
  assert.equal(snowRemainingMs(T0, T0 + SNOW_PENALTY_MS + 5), 0);
  for (const none of [0, null, undefined]) assert.equal(snowActive(none, T0), false);
});

test('다시 부수면 새 시각부터 30분이 다시 시작된다', () => {
  const later = T0 + 20 * 60 * 1000;
  assert.equal(snowActive(T0, later + 15 * 60 * 1000), false); // 처음 시각이라면 이미 끝났을 때
  assert.equal(snowActive(later, later + 15 * 60 * 1000), true);
});

test('guardedOf: 벌칙 중에는 갑옷·펫 방어가 없고, 끝나면 그대로 돌아온다 (장비는 그대로)', () => {
  const armored = { pa: true, ta: true, pt: 'turtle', pl: 99999999 };
  assert.equal(guardedOf(armored, 'push', T0), true);
  assert.equal(guardedOf(armored, 'toss', T0), true);
  const hit = { ...armored, sn: T0 };
  assert.equal(guardedOf(hit, 'push', T0 + 1), false);
  assert.equal(guardedOf(hit, 'toss', T0 + 1), false);
  assert.equal(guardedOf({ pt: 'turtle', pl: 99999999, sn: T0 }, 'push', T0 + 1), false); // 펫 방어만 있는 사람도
  assert.equal(guardedOf(hit, 'push', T0 + SNOW_PENALTY_MS), true);
  assert.equal(guardedOf({ ...armored, sn: null }, 'push', T0), true);
});

test('guardedOf: 빠따의 방어 깨짐(gb)은 따로 그대로 동작한다', () => {
  const armored = { pa: true, ta: true };
  assert.equal(guardedOf({ ...armored, gb: T0 + 60000 }, 'push', T0), false);
  assert.equal(guardedOf({ ...armored, gb: T0 - 1 }, 'push', T0), true);
  assert.equal(guardBrokenOf({ sn: T0 }, T0), false); // 벌칙은 gb 60초 상태가 아니다
});

test('batGuardField: 빠따 방어 깨짐이 남았을 때만 gb 를 싣고, 눈사람 벌칙만 있거나 guardUntil 이 0·지난 시각이면 싣지 않는다', async () => {
  const { batGuardField } = await import('../src/shared/shop.ts');
  assert.deepEqual(batGuardField(T0 + 5000, T0), { gb: T0 + 5000 });
  assert.deepEqual(batGuardField(0, T0), {});          // 벌칙으로 guardBroken() 이 켜져도 guardUntil 은 0
  assert.deepEqual(batGuardField(T0 - 1, T0), {});
  assert.deepEqual(batGuardField(T0, T0), {});
});

test('구독: 접속(새로고침)하면 저장된 시각이 바로 전달되고 같은 값은 반복하지 않는다', () => {
  reset();
  const got = [];
  const m = new SnowPenaltyMgr('me', (t) => got.push(t));
  m.start();
  FB.listeners[PATH]({ val: () => T0 - 1000 });
  FB.listeners[PATH]({ val: () => T0 - 1000 });
  assert.deepEqual(got, [T0 - 1000]);
  FB.listeners[PATH]({ val: () => null }); // 지워졌다
  assert.deepEqual(got, [T0 - 1000, 0]);
  m.stop();
  assert.equal(FB.unsubs, 1);
  assert.equal(PATH in FB.listeners, false);
});

test('저장된 값이 없으면 알리지 않는다 (벌칙 없는 사람)', () => {
  reset();
  const got = [];
  new SnowPenaltyMgr('me', (t) => got.push(t)).start();
  FB.listeners[PATH]({ val: () => null });
  assert.deepEqual(got, []);
});

test('breakSnowman: 벌칙 시각·내 presence sn·알림 항목을 쓰기 한 번에 쓰고 성공해야 true', async () => {
  reset();
  const m = new SnowPenaltyMgr('me', () => {});
  m.start();
  assert.equal(await m.breakSnowman(), true);
  assert.equal(FB.updates.length, 1);
  const upd = FB.updates[0];
  const keys = Object.keys(upd);
  assert.equal(keys.length, 3);
  assert.equal(upd[PATH], '__ts');
  assert.equal(upd['players/me/sn'], '__ts');
  // 알림 기록은 계정당 하나(내 uid 키): 푸시 키로 쌓지 않는다
  assert.deepEqual(keys.filter((k) => k.startsWith('winter/events/')), ['winter/events/me']);
  assert.deepEqual(upd['winter/events/me'], { ts: '__ts' }); // 누가 했는지·문구는 저장하지 않는다
  assert.equal(keys.some((k) => k.startsWith('wallet') || k.includes('/gb')), false);
});

test('breakSnowman: 연속으로 여러 번 불러도 알림 기록 키는 늘 내 uid 하나다 (쌓이지 않는다)', async () => {
  reset();
  const m = new SnowPenaltyMgr('me', () => {});
  m.start();
  for (let i = 0; i < 3; i++) {
    FB.now += SNOW_BREAK_GAP_MS;
    FB.onUpdate = async () => { FB.listeners[PATH]({ val: () => FB.now }); };
    assert.equal(await m.breakSnowman(), true);
  }
  const evKeys = new Set(FB.updates.flatMap((u) => Object.keys(u).filter((k) => k.startsWith('winter/events/'))));
  assert.deepEqual([...evKeys], ['winter/events/me']);
});

test('간격: 직전 부순 시각 + SNOW_BREAK_GAP_MS 전에는 쓰지 않고 거부한다 (경계 포함)', async () => {
  assert.equal(SNOW_BREAK_GAP_MS, 10000);
  for (const none of [0, null, undefined]) assert.equal(snowBreakWaitMs(none, T0), 0);
  assert.equal(snowBreakWaitMs(T0, T0), SNOW_BREAK_GAP_MS);
  assert.equal(snowBreakWaitMs(T0, T0 + SNOW_BREAK_GAP_MS - 1), 1);
  assert.equal(snowBreakWaitMs(T0, T0 + SNOW_BREAK_GAP_MS), 0);   // 딱 간격이 지난 순간부터 가능
  assert.equal(snowBreakWaitMs(T0, T0 + SNOW_BREAK_GAP_MS + 1), 0);
  reset();
  let notices = 0;
  const m = new SnowPenaltyMgr('me', () => {}, () => { notices++; });
  m.start();
  FB.listeners[PATH]({ val: () => T0 });          // 방금 부순 상태로 접속
  FB.now = T0 + SNOW_BREAK_GAP_MS - 1;
  assert.equal(m.waitMs(), 1);
  assert.equal(await m.breakSnowman(), false);
  assert.equal(FB.updates.length, 0);              // 쓰지도 않고
  assert.equal(notices, 0);                        // 알림도 없다
  FB.now = T0 + SNOW_BREAK_GAP_MS;
  assert.equal(m.waitMs(), 0);
  assert.equal(await m.breakSnowman(), true);
  assert.equal(FB.updates.length, 1);
  assert.equal(notices, 1);
});

test('breakSnowman: 쓰기가 거부되면 false 이고 상태를 바꾸지 않는다', async () => {
  reset();
  const got = [];
  const m = new SnowPenaltyMgr('me', (t) => got.push(t));
  m.start();
  FB.onUpdate = async () => { FB.listeners[PATH]({ val: () => T0 }); FB.listeners[PATH]({ val: () => null }); throw new Error('permission_denied'); };
  assert.equal(await m.breakSnowman(), false);
  assert.deepEqual(got, []);
  FB.onUpdate = null;
  assert.equal(await m.breakSnowman(), true); // 실패 뒤에도 다시 부술 수 있다
});

test('breakSnowman: 임시 추정 시각은 걸러지고 서버 시각 하나만 전달된다', async () => {
  reset();
  const got = [];
  const m = new SnowPenaltyMgr('me', (t) => got.push(t));
  m.start();
  FB.onUpdate = async () => { FB.listeners[PATH]({ val: () => T0 + 5 }); FB.listeners[PATH]({ val: () => T0 + 12 }); };
  await m.breakSnowman();
  assert.deepEqual(got, [T0 + 12]);
});

test('breakSnowman: 서버 값이 확인보다 늦게 와도 마지막 값으로 맞춘다', async () => {
  reset();
  const got = [];
  const m = new SnowPenaltyMgr('me', (t) => got.push(t));
  m.start();
  FB.onUpdate = async () => { FB.listeners[PATH]({ val: () => T0 + 5 }); };
  await m.breakSnowman();
  FB.listeners[PATH]({ val: () => T0 + 12 });
  assert.deepEqual(got, [T0 + 5, T0 + 12]);
});

test('다시 부수면 시각이 갱신되어 전달된다 (30분 재시작)', async () => {
  reset();
  const got = [];
  const m = new SnowPenaltyMgr('me', (t) => got.push(t));
  m.start();
  FB.listeners[PATH]({ val: () => T0 });
  FB.now = T0 + 10 * 60 * 1000;
  FB.onUpdate = async () => { FB.listeners[PATH]({ val: () => FB.now }); };
  assert.equal(await m.breakSnowman(), true);
  assert.deepEqual(got, [T0, T0 + 10 * 60 * 1000]);
  assert.equal(snowActive(got[1], T0 + 35 * 60 * 1000), true);
  assert.equal(snowActive(got[0], T0 + 35 * 60 * 1000), false);
});

test('breakSnowman 이 진행 중이면 겹쳐 부수지 않는다', async () => {
  reset();
  const m = new SnowPenaltyMgr('me', () => {});
  m.start();
  let release;
  FB.onUpdate = () => new Promise((res) => { release = res; });
  const first = m.breakSnowman();
  assert.equal(await m.breakSnowman(), false);
  release();
  assert.equal(await first, true);
  assert.equal(FB.updates.length, 1);
});

// 전체 알림 시험용: 구독이 건 두 리스너(child_added·child_changed)에 같은 기록을 보낸다
const snap = (key, ts) => ({ key, val: () => (ts === undefined ? null : { ts }) });
const feedOf = (kind) => FB.feed.find((e) => e.kind === kind);
const startWithNotices = () => {
  const notices = { n: 0 };
  const m = new SnowPenaltyMgr('me', () => {}, () => { notices.n++; });
  m.start();
  return { m, notices };
};

test('전체 알림: 입장 이후 갱신된 기록만 받는 쿼리를 걸고(added·changed), 콜백이 없으면 구독하지 않는다', () => {
  reset();
  new SnowPenaltyMgr('me', () => {}).start();
  assert.equal(FB.feed.length, 0);
  FB.now = T0 + 777;
  const { m } = startWithNotices();
  assert.deepEqual(FB.feed.map((e) => e.kind).sort(), ['added', 'changed']);
  for (const e of FB.feed) { assert.equal(e.path, 'winter/events'); assert.equal(e.order, 'ts'); assert.equal(e.since, T0 + 777); assert.equal(e.n, 20); }
  m.stop();
  assert.equal(FB.unsubs >= 3, true); // 값 구독 + 리스너 둘
});

test('start 를 두 번 불러도 구독은 한 번이다', () => {
  reset();
  const m = new SnowPenaltyMgr('me', () => {}, () => {});
  m.start(); m.start();
  assert.equal(FB.feed.length, 2);
});

test('전체 알림(남): 새 기록은 한 번, 같은 (uid, ts) 가 added·changed·재연결로 다시 와도 한 번', () => {
  reset();
  const { notices } = startWithNotices();
  const ts = T0 + 500;
  feedOf('added').cb(snap('other', ts));
  assert.equal(notices.n, 1);
  feedOf('added').cb(snap('other', ts));      // 재연결로 같은 기록이 다시
  feedOf('changed').cb(snap('other', ts));
  assert.equal(notices.n, 1);
});

test('전체 알림(남): 같은 사람이 다시 부수면(ts 가 바뀐 기록) 새 알림이고, 다른 사람의 같은 ts 도 따로 센다', () => {
  reset();
  const { notices } = startWithNotices();
  feedOf('added').cb(snap('other', T0 + 500));
  feedOf('changed').cb(snap('other', T0 + 20000));
  assert.equal(notices.n, 2);
  feedOf('changed').cb(snap('third', T0 + 20000)); // uid 가 다르면 같은 ts 여도 별개의 파괴
  assert.equal(notices.n, 3);
  feedOf('changed').cb(snap('other', T0 + 20000));
  assert.equal(notices.n, 3);
});

test('전체 알림(남): 입장 전 기록(옛 ts)·ts 없는 기록은 알리지 않는다', () => {
  reset();
  FB.now = T0 + 100000;
  const { notices } = startWithNotices();
  feedOf('added').cb(snap('other', T0 + 99999));   // since 보다 이전 = 지난 기록
  feedOf('changed').cb(snap('other', T0));
  feedOf('added').cb(snap('other2', undefined));
  feedOf('added').cb({ key: 'other3', val: () => ({ ts: '__ts' }) });
  assert.equal(notices.n, 0);
  feedOf('added').cb(snap('other', T0 + 100000));  // 정확히 since 인 기록은 새 것
  assert.equal(notices.n, 1);
});

test('전체 알림(내 기록): 구독에서는 어떤 ts 로 오든 언제나 무시한다 (임시 추정·서버 확정 모두)', () => {
  reset();
  const { notices } = startWithNotices();
  feedOf('added').cb(snap('me', T0 + 5));       // 쓰기 직후 임시 추정
  feedOf('changed').cb(snap('me', T0 + 12));    // 서버 확정
  feedOf('changed').cb(snap('me', T0 + 99999));
  assert.equal(notices.n, 0);
});

test('전체 알림(내 쓰기): 성공하면 임시·서버 두 번 갱신돼도 정확히 한 번', async () => {
  reset();
  const { m, notices } = startWithNotices();
  FB.onUpdate = async () => {
    FB.listeners[PATH]({ val: () => T0 + 5 });
    feedOf('added').cb(snap('me', T0 + 5));
    FB.listeners[PATH]({ val: () => T0 + 12 });
    feedOf('changed').cb(snap('me', T0 + 12));
    assert.equal(notices.n, 0); // 확정 전에는 알리지 않는다
  };
  assert.equal(await m.breakSnowman(), true);
  assert.equal(notices.n, 1);
});

test('전체 알림(내 쓰기): 규칙이 거부한 쓰기는 낙관적 갱신이 있어도 알림 0 (눈사람도 그대로)', async () => {
  reset();
  const { m, notices } = startWithNotices();
  FB.onUpdate = async () => {
    feedOf('added').cb(snap('me', T0 + 5));    // 로컬 추정 이벤트
    FB.listeners[PATH]({ val: () => T0 + 5 });
    feedOf('changed').cb(snap('me', undefined));
    FB.listeners[PATH]({ val: () => null });   // 서버 거부로 되돌아감
    throw new Error('permission_denied');
  };
  assert.equal(await m.breakSnowman(), false);
  assert.equal(notices.n, 0);
});

test('전체 알림: 부모 검증이 거부하는 쓰기(presence 없음 → sn 만 있는 반쪽 노드)는 알림 0, 그 뒤 정상 쓰기는 1', async () => {
  reset();
  const { m, notices } = startWithNotices();
  FB.onUpdate = async () => { throw new Error('permission_denied: players/me validate'); };
  assert.equal(await m.breakSnowman(), false);
  assert.equal(notices.n, 0);
  FB.onUpdate = null;
  assert.equal(await m.breakSnowman(), true);   // 거부는 마지막 시각을 바꾸지 않아 간격에 걸리지 않는다
  assert.equal(notices.n, 1);
});

test('보안 규칙의 시간 상수가 코드와 같다: 벌칙 30분, 재부수기 간격 10초 (구조 대조일 뿐 규칙의 동작 증명이 아니다)', () => {
  const rules = readFileSync(fileURLToPath(new URL('../database.rules.json', import.meta.url)), 'utf8');
  const tree = JSON.parse(rules).rules;
  // 벌칙: users/$uid 의 쓰기 조건들이 비교하는 '끝난 시각' 상수
  const penalty = [...rules.matchAll(/snowBrokenAt'\)\.val\(\) <= now - (\d+)(?!\d)/g)].map((m) => Number(m[1])).filter((n) => n !== SNOW_BREAK_GAP_MS);
  assert.ok(penalty.length >= 3);
  for (const n of penalty) assert.equal(n, SNOW_PENALTY_MS);
  // 간격: 값 검증(users)과 알림 기록 쓰기(winter/events)가 같은 값을 쓴다
  const gapValidate = tree.users.$uid.snowBrokenAt['.validate'];
  assert.match(gapValidate, new RegExp(`data\\.val\\(\\) <= now - ${SNOW_BREAK_GAP_MS}\\)`));
  assert.match(tree.winter.events.$uid['.write'], new RegExp(`snowBrokenAt'\\)\\.val\\(\\) <= now - ${SNOW_BREAK_GAP_MS}\\)`));
});

test('규칙 구조: 알림 기록은 uid 키 하나뿐이다 (푸시 키 아래로 쌓이는 길이 없다)', () => {
  const rules = JSON.parse(readFileSync(fileURLToPath(new URL('../database.rules.json', import.meta.url)), 'utf8')).rules;
  const ev = rules.winter.events;
  assert.deepEqual(Object.keys(ev).filter((k) => k.startsWith('$')), ['$uid']);
  assert.match(ev.$uid['.write'], /auth\.uid == \$uid/);
  assert.deepEqual(Object.keys(ev.$uid).filter((k) => !k.startsWith('.')).sort(), ['$other', 'ts']);
});

test('개인정보 삭제 경로 세 곳(탈퇴·관리자 삭제·CLI)이 정확히 자기 uid 의 알림 기록만 지운다', () => {
  const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
  for (const p of ['../src/firebase/auth.ts', '../src/admin/main.ts', '../tools/admin-cli.mjs']) {
    const src = read(p);
    assert.equal([...src.matchAll(/\[`winter\/events\/\$\{uid\}`\]: null/g)].length, 1, p);
    assert.equal([...src.matchAll(/winter\/events/g)].length, 1, `${p}: winter/events 는 그 한 줄뿐 (넓은 삭제 없음)`);
  }
});
