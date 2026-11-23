// All HTTP/Auth/clock boundaries are controlled; this file never contacts Firebase.
// Run: node --test tests/derby-operator.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createRestStore, SERVER_TS, parseOperatorEnv,
} from '../tools/derby-operator.mjs';
import { createDerbyOperator } from '../tools/derby-operator-core.mjs';
import {
  derbyResolve, derbyStaticData, localDataVersion, raceNo, cycleStart, parseBreaks, readJson,
} from '../tools/derby-shared.mjs';

const V = '0123456789abcdef', UID = 'dedicated-operator';
const T = (h, m = 0, s = 0) => Date.UTC(2026, 11, 2, h - 9, m, s); // Wednesday, KST
const CLOSE = (n) => cycleStart(n) + 240000;
const N = raceNo(T(10));
const HOURS = { on: true, d: { 3: { s: 600, e: 720 } } };
const GRANT = (n, v = V) => ({ g: true, v, at: cycleStart(n) });
// Expected result comes from the game's published resolver, not operator code.
const RESULT = (n) => ({ k: 7, g: 5, ...derbyResolve(n, '0007005').res, at: CLOSE(n) + 1000 });
const reply = (data, status = 200) => ({ status, json: async () => structuredClone(data) });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// The real REST adapter runs against this small authoritative endpoint fixture.
// Holding an HTTP reply never holds the simulated server's ability to commit.
function fixture(t, { at = T(10), cfg = {}, data, holidays = {} } = {}) {
  const f = {
    time: { server: at, wall: at + 5 * 3600000, mono: 0 },
    data: data ?? new Map([
      ['config/raceOperatorUid', UID], ['config/raceHours', HOURS],
      ['config/hoursBlock', false], ['raceData/v', V],
    ]),
    requests: [], accepted: [], tokens: [], randoms: [], logs: [],
    deadlines: new Set(), intervals: new Set(), disposed: 0, currentIdentity: true,
    intercept: null, auth: async () => 'fixture-id-token',
  };
  for (const [p, v] of Object.entries(cfg)) f.data.set(p, v);
  f.store = createRestStore({
    databaseURL: 'http://127.0.0.1:9000', namespace: 'demo-mawaverse-default-rtdb',
    uid: UID, identity: () => f.currentIdentity,
    getToken: (force) => { f.tokens.push(force); return f.auth(force); },
    setTimer: (fn) => { const h = { fn }; f.deadlines.add(h); return h; },
    clearTimer: (h) => f.deadlines.delete(h),
    onClose: () => { f.disposed++; },
    fetchFn: async (address, init) => {
      const url = new URL(address);
      const req = {
        path: decodeURIComponent(url.pathname).slice(1, -5), method: init.method,
        body: init.body ? JSON.parse(init.body) : undefined,
        query: url.searchParams, signal: init.signal, init,
      };
      f.requests.push(req);
      const commit = () => {
        if (req.method === 'GET') {
          if (!req.query.has('orderBy')) return reply(f.data.get(req.path) ?? null);
          const from = +JSON.parse(req.query.get('startAt'));
          const through = +JSON.parse(req.query.get('endAt'));
          const limit = +req.query.get('limitToFirst');
          const rows = [...f.data].filter(([p]) => p.startsWith(`${req.path}/`))
            .map(([p, v]) => [Number(p.slice(req.path.length + 1)), v])
            .filter(([n]) => n >= from && n <= through).sort((a, b) => a[0] - b[0]).slice(0, limit);
          return reply(Object.fromEntries(rows));
        }
        if (/^race\/[rx]\//.test(req.path) && f.data.has(req.path)) return reply(null, 401);
        const value = req.path === 'race/op/hb'
          ? f.time.server : { ...req.body, at: f.time.server };
        f.data.set(req.path, value);
        f.accepted.push({ path: req.path, value: structuredClone(value) });
        return reply(value);
      };
      return f.intercept ? f.intercept(req, commit) : commit();
    },
  });
  f.op = createDerbyOperator({
    store: f.store, localVersion: V, holidays, breaks: parseBreaks(readJson('../hours.json').breaks),
    clock: { mono: () => f.time.mono, wall: () => f.time.wall },
    timers: {
      setInterval: (fn) => { const h = { fn }; f.intervals.add(h); return h; },
      clearInterval: (h) => f.intervals.delete(h),
    },
    random: { int: (a, b) => { f.randoms.push([a, b]); return b === 10000 ? 7 : 5; } },
    log: (msg) => f.logs.push(msg),
  });
  f.op.start();
  f.move = (ms) => { f.time.server += ms; f.time.wall += ms; f.time.mono += ms; };
  f.advance = async (ms) => {
    for (let left = ms; left > 0;) {
      const step = Math.min(left, 1000);
      f.move(step); await f.op.tick(); left -= step;
    }
  };
  f.expireRequests = () => { for (const h of [...f.deadlines]) h.fn(); };
  f.grants = () => f.accepted.filter((w) => w.path.startsWith('race/r/'));
  f.draws = () => f.accepted.filter((w) => w.path.startsWith('race/x/'));
  f.hbs = () => f.accepted.filter((w) => w.path === 'race/op/hb');
  t.after(async () => {
    await f.op.stop();
    assert.equal(f.deadlines.size, 0);
    assert.equal(f.intervals.size, 0);
  });
  return f;
}

test('REST uses Auth ID tokens, resolved write acknowledgements, and bounded chronological queries', async (t) => {
  const f = fixture(t);
  assert.equal(await f.store.put('race/op/hb', SERVER_TS), T(10));
  assert.deepEqual(await f.store.range('race/r', N - 241, 260, N), {});
  const [write, read] = f.requests;
  assert.equal(write.query.get('auth'), 'fixture-id-token');
  assert.equal(write.query.get('ns'), 'demo-mawaverse-default-rtdb');
  assert.deepEqual(write.body, { '.sv': 'timestamp' });
  assert.equal(write.init.cache, 'no-store');
  assert.equal(write.init.redirect, 'error');
  assert.match(read.init.headers['cache-control'], /no-store/);
  assert.equal(read.query.get('orderBy'), '"$key"');
  assert.equal(read.query.get('startAt'), `"${N - 241}"`);
  assert.equal(read.query.get('endAt'), `"${N}"`);
  assert.equal(read.query.get('limitToFirst'), '260');
});

test('REST refreshes credentials after 401 without replaying a write or exposing fetch diagnostics', async (t) => {
  const f = fixture(t);
  f.intercept = () => reply({ error: 'sensitive server body' }, 401);
  await assert.rejects(f.store.put(`race/r/${N}`, GRANT(N)), (e) => {
    assert.equal(e.code, 'permission'); assert.equal(e.net, false);
    assert.doesNotMatch(String(e) + JSON.stringify(e), /fixture-id-token|auth=|sensitive/);
    return true;
  });
  assert.equal(f.requests.length, 1);
  f.intercept = null;
  await f.store.get('raceData/v');
  assert.deepEqual(f.tokens, [false, true]);
  f.intercept = () => { throw new Error('https://host/?auth=fixture-id-token'); };
  await assert.rejects(f.store.get('raceData/v'), (e) => e.code === 'network' && !String(e).includes('auth='));
});

test('REST deadlines include token refresh and cannot dispatch after cancellation', async (t) => {
  const f = fixture(t), token = deferred();
  f.auth = () => token.promise;
  const p = f.store.get('raceData/v');
  f.expireRequests();
  await assert.rejects(p, (e) => e.code === 'timeout' && e.net);
  token.resolve('late-token');
  await Promise.resolve();
  assert.equal(f.requests.length, 0);
  await f.store.close();
  await f.store.close();
  await assert.rejects(f.store.get('raceData/v'), (e) => e.code === 'closed');
  assert.equal(f.disposed, 1);
});

test('a changed Auth identity invalidates an outstanding HTTP acknowledgement', async (t) => {
  const f = fixture(t), waiting = deferred(), reached = deferred();
  f.intercept = (req, commit) => { reached.resolve(); return waiting.promise.then(commit); };
  const p = f.store.put('race/op/hb', SERVER_TS);
  await reached.promise;
  f.currentIdentity = false;
  waiting.resolve();
  await assert.rejects(p, (e) => e.code === 'identity' && e.net);
  assert.equal(f.hbs().length, 1, 'the server may already have written it');
  await assert.rejects(f.store.get('raceData/v'), (e) => e.code === 'identity');
  assert.equal(f.requests.length, 1);
});

test('missing credentials report names only; static version follows the published generator convention', () => {
  const env = {
    DERBY_OPERATOR_EMAIL: 'fixture@example.invalid', DERBY_OPERATOR_PASSWORD: 'fixture-password',
    VITE_FIREBASE_API_KEY: 'fixture-key', VITE_FIREBASE_AUTH_DOMAIN: 'fixture.invalid',
    VITE_FIREBASE_DATABASE_URL: 'https://fixture.invalid', VITE_FIREBASE_PROJECT_ID: 'fixture',
    VITE_FIREBASE_APP_ID: 'fixture-app',
  };
  assert.equal(parseOperatorEnv(env).ok, true);
  assert.deepEqual(parseOperatorEnv({ ...env, DERBY_OPERATOR_PASSWORD: '', VITE_FIREBASE_APP_ID: undefined }),
    { ok: false, missing: ['DERBY_OPERATOR_PASSWORD', 'VITE_FIREBASE_APP_ID'] });
  assert.equal(localDataVersion(), createHash('sha256').update(JSON.stringify(derbyStaticData())).digest('hex').slice(0, 16));
});

test('UID, missing/mismatched data, and unreadable settings fail closed before heartbeat bootstrap', async (t) => {
  for (const cfg of [
    { 'config/raceOperatorUid': 'not-this-account' },
    { 'raceData/v': null }, { 'raceData/v': 'ffffffffffffffff' },
  ]) {
    const f = fixture(t, { cfg });
    await f.op.tick();
    assert.equal(f.accepted.length, 0);
    assert.ok(f.logs.some((l) => /raceOperatorUid|게시|다릅니다/.test(l)));
  }
  const f = fixture(t);
  f.intercept = (req, commit) => req.path === 'config/raceHours' ? reply(null, 401) : commit();
  await f.op.tick();
  assert.equal(f.accepted.length, 0);
  assert.ok(f.logs.some((l) => l.includes('설정')));
});

test('startup is anchored by a heartbeat, never the skewed PC clock; grants once at start with economical heartbeat', async (t) => {
  const f = fixture(t, { at: T(9, 59, 58) });
  await f.op.tick();
  assert.equal(f.hbs()[0].value, T(9, 59, 58));
  assert.equal(f.grants().length, 0);
  await f.advance(1000);
  assert.equal(f.grants().length, 0);
  await f.advance(1000);
  assert.deepEqual(f.grants(), [{ path: `race/r/${N}`, value: { g: true, v: V, at: T(10) } }]);
  await f.advance(60000);
  assert.equal(f.grants().length, 1);
  assert.equal(f.hbs().length, 4);
  assert.ok(f.hbs().every((w, i, arr) => !i || w.value - arr[i - 1].value === 20000));
});

test('only a whole four-minute sale in current hours/breaks/holidays is authorized; no late grant', async (t) => {
  for (const opts of [
    { cfg: { 'config/raceHours': { on: false } } },
    { cfg: { 'config/raceHours': { on: true, d: { 3: { s: 600, e: 603 } } } } },
    { cfg: { 'config/hoursBlock': true } },
    { at: T(10, 42), cfg: { 'config/hoursBlock': true } },
    { holidays: { '2026-12-02': 'fixture holiday' } },
    { at: T(10, 3, 50) },
  ]) {
    const f = fixture(t, opts);
    await f.op.tick();
    assert.equal(f.grants().length, 0);
  }
  const allowed = fixture(t, { at: T(10, 36), cfg: { 'config/hoursBlock': true } });
  await allowed.op.tick();
  assert.equal(allowed.grants().length, 1);
});

test('no randomness before safe close; seven padded digits produce one published result and no entropy logs', async (t) => {
  const f = fixture(t);
  await f.op.tick();
  await f.advance(240000);
  assert.equal(f.draws().length, 0);
  assert.equal(f.randoms.length, 0);
  await f.advance(1000);
  assert.deepEqual(f.draws(), [{ path: `race/x/${N}`, value: RESULT(N) }]);
  assert.deepEqual(f.randoms, [[0, 10000], [0, 1000]]);
  await f.advance(30000);
  assert.equal(f.draws().length, 1);
  assert.ok(f.logs.every((l) => !l.includes('"k"') && !l.includes('"g"')));
});

test('already granted races continue when hours and hoursBlock close new sales', async (t) => {
  const f = fixture(t);
  await f.op.tick();
  await f.advance(60000);
  f.data.set('config/raceHours', { on: false });
  f.data.set('config/hoursBlock', true);
  await f.advance(300000);
  assert.equal(f.grants().length, 1);
  assert.equal(f.draws().length, 1);
  assert.ok(f.hbs().some((w) => w.value > T(10, 2) && w.value < T(10, 4)));
});

test('restart scans bounded chronological grants, accepts void terminals, and continues open granted races while closed', async (t) => {
  const at = T(10, 12, 30), n = raceNo(at);
  const f = fixture(t, { at, cfg: { 'config/raceHours': { on: false } } });
  for (const r of [n - 400, n - 3, n - 2, n - 1, n]) f.data.set(`race/r/${r}`, GRANT(r));
  f.data.set(`race/x/${n - 3}`, { v: true, at });
  await f.op.tick();
  assert.deepEqual(f.draws().map((w) => w.path), [`race/x/${n - 2}`, `race/x/${n - 1}`]);
  const scans = f.requests.filter((r) => r.query.has('orderBy'));
  assert.equal(scans.length, 2);
  assert.ok(scans.every((r) => r.query.get('startAt') === `"${raceNo(at - 86400000 - 240000)}"` && r.query.get('limitToFirst') === '260'));
  await f.advance(CLOSE(n) + 1000 - at);
  assert.deepEqual(f.draws().map((w) => w.path), [`race/x/${n - 2}`, `race/x/${n - 1}`, `race/x/${n}`]);
  assert.equal(f.grants().length, 0);
});

test('draws stop before the 24h refund boundary and never overwrite late terminals or other versions', async (t) => {
  const before = fixture(t, { at: CLOSE(N) + 86400000 - 10000, cfg: { 'config/raceHours': null } });
  before.data.set(`race/r/${N}`, GRANT(N));
  await before.op.tick();
  assert.equal(before.draws().length, 1);
  const cutoff = fixture(t, { at: CLOSE(N) + 86400000 - 4000, cfg: { 'config/raceHours': null } });
  cutoff.data.set(`race/r/${N}`, GRANT(N));
  await cutoff.op.tick();
  assert.equal(cutoff.draws().length, 0);
  assert.equal(cutoff.randoms.length, 0);
  assert.ok(cutoff.logs.some((l) => l.includes('환급')));
  const late = fixture(t, { at: CLOSE(N) + 86400000 + 1000, cfg: { 'config/raceHours': null } });
  late.data.set(`race/r/${N}`, GRANT(N));
  late.data.set(`race/x/${N}`, { v: true, at: late.time.server });
  await late.op.tick();
  assert.equal(late.draws().length, 0);
  const other = fixture(t, { at: CLOSE(N) + 1000, cfg: { 'config/raceHours': null } });
  other.data.set(`race/r/${N}`, GRANT(N, 'ffffffffffffffff'));
  await other.op.tick();
  assert.equal(other.randoms.length, 0);
  assert.ok(other.logs.some((l) => l.includes('추첨할 수 없습니다')));
});

test('ambiguous timeout plus incomplete/stale reads retains the draw, never claims a phantom final, and retries identical values', async (t) => {
  const f = fixture(t, { at: CLOSE(N) + 1000, cfg: { 'config/raceHours': null } });
  f.data.set(`race/r/${N}`, GRANT(N));
  const reached = deferred(), waiting = deferred();
  f.intercept = (req, commit) => {
    if (req.method === 'PUT' && req.path === `race/x/${N}`) {
      commit(); reached.resolve(); return waiting.promise; // commit is real, acknowledgement is lost
    }
    return commit();
  };
  const first = f.op.tick();
  await reached.promise;
  f.expireRequests();
  await first;
  assert.equal(f.op.status().tracked[0].pending, true);
  assert.equal(f.op.status().tracked[0].done, false);
  assert.equal(f.op.status().needScan, true);
  f.intercept = (req, commit) => {
    if (req.path === 'race/x') return reply({ [N]: { k: 7, g: 5, at: f.time.server } });
    if (req.path === `race/x/${N}` && req.method === 'GET') return reply(null);
    return commit();
  };
  await f.advance(2000);
  assert.equal(f.op.status().tracked[0].pending, true);
  assert.equal(f.op.status().tracked[0].done, false);
  assert.ok(f.logs.some((l) => l.includes('서버가 거절')));
  const attempts = f.requests.filter((r) => r.method === 'PUT' && r.path === `race/x/${N}`);
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0].body, attempts[1].body);
  assert.equal(f.randoms.length, 2);
  f.intercept = null;
  await f.advance(60000);
  assert.equal(f.draws().length, 1);
  assert.equal(f.randoms.length, 2);
  assert.equal(f.op.status().tracked[0].done, true);
});

test('offline intervals grant no missed rounds; reconnection recovers only server-confirmed grants', async (t) => {
  const f = fixture(t);
  await f.op.tick();
  f.intercept = () => { throw new TypeError('offline'); };
  await f.advance(20000);
  const offlineAccepted = f.accepted.length;
  f.move(20 * 60000);
  await f.op.tick();
  assert.equal(f.accepted.length, offlineAccepted);
  assert.equal(f.draws().length, 0);
  f.intercept = null;
  await f.advance(5000);
  assert.equal(f.draws().length, 1);
  assert.equal(f.draws()[0].path, `race/x/${N}`);
  assert.deepEqual(f.grants().map((w) => w.path), [`race/r/${N}`, `race/r/${raceNo(f.time.server)}`]);
});

test('an unconfirmed draw is discarded at the refund boundary without a late write or fresh randomness', async (t) => {
  const f = fixture(t, { at: CLOSE(N) + 1000, cfg: { 'config/raceHours': null } });
  f.data.set(`race/r/${N}`, GRANT(N));
  const reached = deferred(), waiting = deferred();
  f.intercept = (req, commit) => {
    if (req.path === `race/x/${N}`) { reached.resolve(); return waiting.promise; }
    return commit();
  };
  const first = f.op.tick();
  await reached.promise;
  f.expireRequests();
  await first;
  assert.equal(f.op.status().tracked[0].pending, true);
  f.intercept = null;
  f.move(86400000);
  await f.op.tick();
  assert.equal(f.op.status().tracked[0].pending, false);
  assert.equal(f.randoms.length, 2);
  assert.equal(f.draws().length, 0);
  assert.ok(f.logs.some((l) => l.includes('환급')));
});

test('PC wall jumps cannot advance server time, and stale heartbeat timestamps cannot reauthorize a resumed process', async (t) => {
  const f = fixture(t, { at: T(10, 3, 59), cfg: { 'config/raceHours': null } });
  f.data.set(`race/r/${N}`, GRANT(N));
  await f.op.tick();
  assert.equal(f.draws().length, 0);
  const old = f.time.server;
  f.time.wall += 5 * 3600000;
  await f.op.tick();
  assert.equal(f.op.status().serverNow, old);
  assert.equal(f.randoms.length, 0);
  f.intercept = (req, commit) => req.path === 'race/op/hb' ? reply(old) : commit();
  f.move(20000); // process resume / old connection sample
  await f.op.tick();
  assert.equal(f.op.status().serverNow, null);
  assert.equal(f.randoms.length, 0);
  f.intercept = null;
  await f.advance(2000);
  assert.equal(f.draws().length, 1);
});

test('a paused monotonic clock while a heartbeat reply is held fails closed until a fresh observation', async (t) => {
  const f = fixture(t, { at: T(10, 3, 59), cfg: { 'config/raceHours': null } });
  f.data.set(`race/r/${N}`, GRANT(N));
  const reached = deferred(), waiting = deferred();
  f.intercept = (req, commit) => {
    if (req.path !== 'race/op/hb') return commit();
    const observed = commit();
    reached.resolve();
    return waiting.promise.then(() => observed);
  };
  const tick = f.op.tick();
  await reached.promise;
  f.time.wall += 60000; f.time.server += 60000; // performance clock did not include suspend
  waiting.resolve();
  await tick;
  assert.equal(f.randoms.length, 0);
  assert.equal(f.op.status().serverNow, null);
  f.intercept = null;
  await f.advance(2000);
  assert.equal(f.draws().length, 1);
});

test('shutdown cancels transport but not possible remote completion; restart recovers that completion without another draw', async (t) => {
  const f = fixture(t, { at: CLOSE(N) + 1000, cfg: { 'config/raceHours': null } });
  f.data.set(`race/r/${N}`, GRANT(N));
  const reached = deferred(), release = deferred(), completed = deferred();
  f.intercept = (req, commit) => {
    if (req.path !== `race/x/${N}`) return commit();
    reached.resolve();
    return release.promise.then(() => { const res = commit(); completed.resolve(); return res; });
  };
  const tick = f.op.tick();
  await reached.promise;
  await f.op.stop();
  await tick;
  const requestCount = f.requests.length, logCount = f.logs.length;
  release.resolve();
  await completed.promise;
  await f.op.tick();
  assert.equal(f.requests.length, requestCount);
  assert.equal(f.logs.length, logCount);
  assert.equal(f.op.status().tracked[0].done, false);
  assert.equal(f.disposed, 1);
  assert.equal(f.draws().length, 1);
  const restarted = fixture(t, { at: f.time.server + 1000, data: f.data });
  await restarted.op.tick();
  assert.equal(restarted.randoms.length, 0);
  assert.equal(restarted.draws().length, 0);
  assert.equal(restarted.op.status().tracked[0].done, true);
});

test('a denied recovery read is throttled and recovery resumes when reads are allowed', async (t) => {
  const f = fixture(t, { at: CLOSE(N) + 1000, cfg: { 'config/raceHours': null } });
  f.data.set(`race/r/${N}`, GRANT(N));
  f.intercept = (req, commit) => req.path === 'race/x' ? reply(null, 401) : commit();
  await f.op.tick();
  const rangeReads = () => f.requests.filter((r) => r.query.has('orderBy')).length;
  assert.equal(rangeReads(), 2);
  await f.advance(10000);
  assert.equal(rangeReads(), 2);
  assert.ok(f.tokens.filter(Boolean).length <= 1);
  assert.equal(f.draws().length, 0);
  f.intercept = null;
  await f.advance(60000);
  assert.equal(rangeReads(), 4);
  assert.equal(f.draws().length, 1);
});

test('old asynchronous scan completion cannot consume a newer reconnect recovery request', async (t) => {
  const f = fixture(t, { at: CLOSE(N) + 1000, cfg: { 'config/raceHours': null } });
  f.data.set(`race/r/${N}`, GRANT(N));
  const old = deferred(), newer = deferred(), reached = deferred();
  let scans = 0;
  f.intercept = (req, commit) => {
    if (req.path === 'race/r') {
      scans++;
      if (scans === 1) return old.promise;
      reached.resolve(); return newer.promise;
    }
    if (req.path === 'race/x' && scans === 1) throw new TypeError('connection lost');
    return commit();
  };
  await f.op.tick();
  assert.equal(f.op.status().needScan, true);
  f.move(2000);
  const retry = f.op.tick();
  await reached.promise;
  old.resolve(reply({ [N]: GRANT(N) }));
  await Promise.resolve();
  assert.equal(f.op.status().needScan, true);
  assert.equal(f.draws().length, 0);
  newer.resolve(reply({ [N]: GRANT(N) }));
  await retry;
  assert.equal(scans, 2);
  assert.equal(f.draws().length, 1);
});

test('an old scan after a clock/epoch change cannot finish a record or clear recovery', async (t) => {
  const f = fixture(t, { at: CLOSE(N) + 1000, cfg: { 'config/raceHours': null } });
  f.data.set(`race/r/${N}`, GRANT(N));
  const reached = deferred(), waiting = deferred();
  f.intercept = (req, commit) => {
    if (req.path === 'race/x') { reached.resolve(); return waiting.promise; }
    return commit();
  };
  const tick = f.op.tick();
  await reached.promise;
  f.time.wall += 3600000;
  const overlapping = f.op.tick(); // invalidates the in-flight scan, not a second worker
  waiting.resolve(reply({ [N]: { v: true, at: f.time.server } }));
  await Promise.all([tick, overlapping]);
  assert.equal(f.op.status().needScan, true);
  assert.equal(f.op.status().tracked.length, 0);
  f.intercept = null;
  await f.op.tick();
  assert.equal(f.draws().length, 1);
});
