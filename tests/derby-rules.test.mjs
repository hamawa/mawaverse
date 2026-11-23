// Defensive, local-only rule contract fixtures. This evaluator exercises the
// generated expressions; it does NOT replace the RTDB compiler/emulator check.
// The same sale/settlement cases run against the emulator from rules-gate.test.mjs.
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
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
const D = await import('../src/shared/derby.ts');
const { hoursState } = await import('../src/shared/hours.ts');
const ROOT = fileURLToPath(new URL('../', import.meta.url));
// rules-gate invokes the shared emulator cases, not this expression-only lane.
const test = process.env.FIREBASE_DATABASE_EMULATOR_HOST ? () => {} : nodeTest;
const U = 'DERBY_USER', O = 'DERBY_OPERATOR', OTHER = 'DERBY_OTHER';
const START = Date.parse('2026-11-14T19:00:00+09:00');
const N = String(START / 360000);
const HOURS = { on: true, d: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, { s: 0, e: 1440 }])) };
const clone = (x) => structuredClone(x);
const getAt = (root, path) => path.split('/').filter(Boolean).reduce((v, k) => v?.[k], root) ?? null;
function putAt(root, path, value) {
  const parts = path.split('/').filter(Boolean), last = parts.pop();
  let v = root;
  for (const p of parts) v = v[p] ??= {};
  if (value === null) delete v[last]; else v[last] = clone(value);
}

function fixture(start = START) {
  const n = String(start / 360000), sc = D.derbyStaticScenario(Number(n) % 10000);
  const entry = D.derbyBaseEntry(sc.p, 0);
  return {
    _test: { now: start + 1000 },
    admins: { ADMIN: true }, approved: { [U]: true, [OTHER]: true },
    config: { raceOperatorUid: O, hoursBlock: false, raceHours: clone(HOURS), prices: { bait: 5 } },
    raceData: { v: 'fixture-v1', sc: { [Number(n) % 10000]: sc }, tbl: { [sc.p]: { 0: Object.fromEntries([...entry].map((v, i) => ['abcd'[i], v])) } }, odds: { [sc.p]: D.derbyOddsTable(sc.p) } },
    race: { r: { [n]: { g: true, v: 'fixture-v1', at: start } }, op: { hb: start + 1000 } },
    wallet: { [U]: { c: 200000, e: 200000 } },
    players: { [U]: { n: '닉', a: 'm-1', x: 10, y: 10, d: 0, s: 'session', m: 'race-park', hb: start } },
    occ: { 'race-park~10_10': U },
  };
}
function purchase(n = N, nn = '00', a = 100, t = 'W', s1 = '0', s2, spent = 0, start = Number(n) * 360000) {
  const od = D.raceOdds(Number(n), t, Number(s1), s2 === undefined ? -1 : Number(s2));
  return {
    [`wallet/${U}/c`]: { '.sv': { increment: -a } }, [`wallet/${U}/sp`]: { '.sv': { increment: a } },
    [`wallet/${U}/b`]: 'derby', [`wallet/${U}/gt`]: null,
    [`wallet/${U}/kd`]: n, [`wallet/${U}/kb`]: nn, [`wallet/${U}/kt`]: spent + a,
    [`race/t/${n}/${U}/${nn}`]: { t, s1, ...(s2 === undefined ? {} : { s2 }), a, od },
    [`race/u/${U}/${n}/i`]: true, [`race/u/${U}/${n}/s`]: spent + a, [`race/u/${U}/${n}/c`]: Number(nn) + 1,
  };
}
function claim(n, nn, amount) {
  return {
    [`wallet/${U}/c`]: { '.sv': { increment: amount } }, [`wallet/${U}/e`]: { '.sv': { increment: amount } },
    [`wallet/${U}/kn`]: n, [`wallet/${U}/kr`]: nn, [`race/u/${U}/${n}/${nn}`]: true,
  };
}

// Only trusted local rule expressions are evaluated. Permission inheritance and
// pre/post snapshots are modeled here; RTDB typing/compiler behavior remains an
// explicitly separate verification lane.
class Snap {
  constructor(tree, path = '') { this.tree = tree; this.path = path; }
  val() { return this.path ? getAt(this.tree, this.path) : this.tree; }
  child(path) { return new Snap(this.tree, [this.path, String(path)].filter(Boolean).join('/')); }
  parent() { return new Snap(this.tree, this.path.split('/').slice(0, -1).join('/')); }
  exists() { const v = this.val(); return v !== null && (typeof v !== 'object' || Object.keys(v).length > 0); }
  hasChild(p) { return this.child(p).exists(); }
  hasChildren(ps) { return ps.every((p) => this.hasChild(p)); }
  isNumber() { return typeof this.val() === 'number' && Number.isFinite(this.val()); }
  isString() { return typeof this.val() === 'string'; }
  isBoolean() { return typeof this.val() === 'boolean'; }
}
const compiled = new Map();
function evaluate(expr, old, next, path, uid, vars = {}, q = {}) {
  if (typeof expr === 'boolean') return expr;
  let fn = compiled.get(expr);
  if (!fn) {
    fn = new Function('root', 'data', 'newData', 'auth', 'now', 'query', '$n', '$uid', '$nn', '$k',
      `return !!(${expr.replaceAll('.matches(', '.match(').replaceAll('.beginsWith(', '.startsWith(')});`);
    compiled.set(expr, fn);
  }
  return fn(new Snap(old), new Snap(old, path), new Snap(next, path), uid ? { uid } : null,
    old._test.now, q, vars.$n, vars.$uid, vars.$nn, vars.$k);
}
function branch(rule, key) {
  if (rule[key]) return [rule[key], {}];
  const name = Object.keys(rule).find((k) => k.startsWith('$') && k !== '$other') ?? (rule.$other ? '$other' : null);
  return name ? [rule[name], { [name]: key }] : [null, {}];
}
class Local {
  constructor(rules, initial = fixture()) { this.rules = rules; this.data = clone(initial); }
  reset(value) { this.data = clone(value); }
  force(path, value) { putAt(this.data, path, value); }
  read(uid, path, q = {}) {
    let rule = this.rules, vars = {}, at = '';
    for (const key of [...path.split('/').filter(Boolean), null]) {
      if (rule['.read'] !== undefined && evaluate(rule['.read'], this.data, this.data, at, uid, vars, q)) return true;
      if (key === null) break;
      const [child, more] = branch(rule, key);
      if (!child) break;
      rule = child; vars = { ...vars, ...more }; at = [at, key].filter(Boolean).join('/');
    }
    return false;
  }
  update(uid, updates) {
    const next = clone(this.data), paths = Object.keys(updates);
    for (const [p, value] of Object.entries(updates)) {
      const inc = value?.['.sv']?.increment;
      putAt(next, p, inc === undefined ? value : (getAt(this.data, p) || 0) + inc);
    }
    for (const path of paths) {
      let rule = this.rules, vars = {}, at = '', allowed = false;
      for (const key of [...path.split('/'), null]) {
        if (rule['.write'] !== undefined && evaluate(rule['.write'], this.data, next, at, uid, vars)) { allowed = true; break; }
        if (key === null) break;
        const [child, more] = branch(rule, key);
        if (!child) break;
        rule = child; vars = { ...vars, ...more }; at = [at, key].filter(Boolean).join('/');
      }
      if (!allowed) return false;
    }
    const check = (rule, path = '', vars = {}) => {
      const touched = paths.some((p) => !path || p === path || p.startsWith(path + '/') || path.startsWith(p + '/'));
      if (!touched) return true;
      const sn = new Snap(next, path);
      if (sn.exists() && rule['.validate'] !== undefined && !evaluate(rule['.validate'], this.data, next, path, uid, vars)) return false;
      if (!sn.exists() || typeof sn.val() !== 'object') return true;
      for (const key of Object.keys(sn.val())) {
        const [child, more] = branch(rule, key);
        if (child && !check(child, [path, key].filter(Boolean).join('/'), { ...vars, ...more })) return false;
      }
      return true;
    };
    if (!check(this.rules)) return false;
    this.data = next;
    return true;
  }
}

// A real emulator adapter runs exactly these core cases, not a live database.
async function contract(store, expect) {
  const reset = (f = fixture()) => store.reset(f);
  const allow = (label, uid, patch) => expect(label, true, () => store.update(uid, patch));
  const deny = (label, uid, patch) => expect(label, false, () => store.update(uid, patch));
  await reset();
  await deny('ticket cannot be created without debit', U, { [`race/t/${N}/${U}/00`]: { t: 'W', s1: '0', a: 100, od: D.raceOdds(Number(N), 'W', 0) } });
  const p = purchase();
  const markerOnly = { ...p }; delete markerOnly[`race/t/${N}/${U}/00`];
  await deny('debit cannot exist without ticket', U, markerOnly);
  await deny('old balance cannot accompany a new stake', U, { ...p, [`wallet/${U}/c`]: 200000 });
  await deny('earnings cannot offset the debit', U, { ...p, [`wallet/${U}/c`]: 200000, [`wallet/${U}/e`]: 200100 });
  await deny('one debit cannot buy two tickets', U, { ...p, [`race/t/${N}/${U}/01`]: p[`race/t/${N}/${U}/00`] });
  await allow('atomic ticket and exact debit', U, p);
  await deny('ticket cannot be replaced', U, purchase(N, '00', 100, 'W', '0', undefined, 100));
  await deny('ticket cannot be deleted', U, { [`race/t/${N}/${U}/00`]: null });
  await deny('purchase total cannot be reset', U, { [`race/u/${U}/${N}/s`]: null });
  await deny('private index cannot be removed', U, { [`race/u/${U}/${N}/i`]: null });
  await deny('used marker cannot issue another ticket', U, { [`race/t/${N}/${U}/01`]: p[`race/t/${N}/${U}/00`] });
  await allow('next line preserves balance and cumulative spend', U, purchase(N, '01', 200, 'W', '1', undefined, 100));
  await deny('stale-tab total cannot overwrite a newer purchase', U, purchase(N, '02', 100, 'W', '0', undefined, 0));
  await allow('normal earning preserves derby markers', U, { [`wallet/${U}/c`]: { '.sv': { increment: 5 } }, [`wallet/${U}/e`]: { '.sv': { increment: 5 } } });
  await deny('generic earning cannot change purchase keys', U, { [`wallet/${U}/kd`]: '1', [`wallet/${U}/c`]: { '.sv': { increment: 1 } }, [`wallet/${U}/e`]: { '.sv': { increment: 1 } } });
  for (const [label, change] of [
    ['missing heartbeat', { 'race/op/hb': null }],
    ['60-second-old heartbeat', { 'race/op/hb': START + 1000 - 60000 }],
    ['future heartbeat', { 'race/op/hb': START + 1001 }],
    ['missing operator', { 'config/raceOperatorUid': null }],
    ['operator must not be a player', { [`approved/${O}`]: true }],
    ['static version changed', { 'raceData/v': 'fixture-v2' }],
    ['closed sale', { '_test/now': START + 240000 }],
    ['operator disabled', { 'config/raceHours/on': false }],
    ['no occupancy', { 'occ/race-park~10_10': null }],
  ]) {
    const f = fixture(); for (const [path, value] of Object.entries(change)) putAt(f, path, value);
    await reset(f); await deny(label, U, purchase());
  }
  for (const [label, t, a, b] of [
    ['duplicate legs', 'E', '2', '2'], ['unordered quinella', 'Q', '3', '2'],
    ['unordered wide', 'R', '7', '0'], ['numeric leg', 'W', 0, undefined],
    ['single bet with second leg', 'P', '0', '1'], ['out of range leg', 'W', '8', undefined],
  ]) {
    await reset();
    const bad = purchase(); bad[`race/t/${N}/${U}/00`] = { t, s1: a, ...(b === undefined ? {} : { s2: b }), a: 100, od: 10 };
    await deny(label, U, bad);
  }
  await reset(); await deny('stake must be a 100 multiple', U, purchase(N, '00', 150));
  await deny('odds must match pinned profile', U, { ...purchase(), [`race/t/${N}/${U}/00`]: { t: 'W', s1: '0', a: 100, od: 999999 } });
  await deny('operator cannot use wallet', O, { [`wallet/${O}`]: { c: 100, e: 100 } });
  await deny('operator cannot create player presence', O, { [`players/${O}`]: { n: 'op', a: 'm-1', x: 1, y: 1, d: 0, s: 'x' } });
  await deny('operator UID cannot rotate during an authorized sale', 'ADMIN', { 'config/raceOperatorUid': 'NEXT_OPERATOR', 'race/op/hb': null });
  const f = fixture(); f._test.now = START + 240000; await reset(f);
  await deny('rotation cannot inherit old heartbeat', 'ADMIN', { 'config/raceOperatorUid': 'NEXT_OPERATOR' });
  await allow('rotation clears heartbeat atomically after cutoff', 'ADMIN', { 'config/raceOperatorUid': 'NEXT_OPERATOR', 'race/op/hb': null });
  await deny('revoked operator cannot heartbeat', O, { 'race/op/hb': START + 240000 });

  const br = fixture();
  br.players[U] = { ...br.players[U], x: 35, y: 6, r: 'casino' }; delete br.players[U].m;
  br.occ = { '35_6': U }; br.rooms = { casino: { cap: 10, round: 1, state: 'open', members: { [U]: { n: '닉', ready: false, losses: 0, at: START } } } };
  await reset(br); await allow('actual branch membership and placement', U, purchase(N, '00', 50000));
  await deny('branch cumulative cap', U, purchase(N, '01', 100, 'W', '0', undefined, 50000));
  const off = clone(br); off.players[U].x = 1; off.occ = { '1_6': U }; await reset(off);
  await deny('room label alone outside actual branch does not qualify', U, purchase());
  const nomember = clone(br); delete nomember.rooms; await reset(nomember);
  await deny('branch placement without membership does not qualify', U, purchase());
  await reset(); await allow('park default combined cap', U, purchase(N, '00', 100000));
  await allow('legacy wallet deletion does not erase the race ledger', U, { [`wallet/${U}`]: null });
  await allow('generic wallet reinitialization stays available', U, { [`wallet/${U}`]: { c: 200000, e: 200000 } });
  await deny('wallet reset cannot bypass a race cap', U, purchase(N, '01', 100));

  await reset(); await allow('ticket retained for void refund', U, purchase());
  await deny('players cannot draw the result', U, { [`race/x/${N}`]: { k: 0, g: 999, ...D.derbyResolve(Number(N), '0000999').res, at: START + 1000 } });
  const vf = fixture(); vf.race.t = { [N]: { [U]: { '00': purchase()[`race/t/${N}/${U}/00`] } } };
  vf.race.u = { [U]: { [N]: { i: true, s: 100, c: 1 } } };
  vf.wallet[U] = { c: 199900, e: 200000, sp: 100, b: 'derby', kd: N, kb: '00', kt: 100 };
  vf._test.now = START + 240000 + 86400000 - 1; await reset(vf);
  await deny('void is forbidden before 24 hours', U, { [`race/x/${N}`]: { v: true, at: vf._test.now } });
  vf._test.now++; await reset(vf);
  await deny('spectator cannot void without an actual ticket', OTHER, { [`race/x/${N}`]: { v: true, at: vf._test.now } });
  await allow('ticket holder can void at exactly 24 hours', U, { [`race/x/${N}`]: { v: true, at: vf._test.now } });
  await deny('void cannot be replaced by a draw', O, { [`race/x/${N}`]: { k: 0, g: 999, ...D.derbyResolve(Number(N), '0000999').res, at: vf._test.now } });
  await deny('refund amount must equal principal', U, claim(N, '00', 200));
  await deny('credit alone cannot claim a receipt', U, Object.fromEntries(Object.entries(claim(N, '00', 100)).filter(([k]) => !k.startsWith('race/'))));
  await deny('receipt alone cannot claim money', U, { [`race/u/${U}/${N}/00`]: true });
  await allow('void principal refund', U, claim(N, '00', 100));
  await deny('second refund is rejected', U, claim(N, '00', 100));
  await deny('refund receipt cannot be deleted', U, { [`race/u/${U}/${N}/00`]: null });
  await deny('unknown ticket cannot be settled', U, claim(N, '99', 0));
}

const temp = mkdtempSync(join(tmpdir(), 'derby-rules-'));
let rules;
let bytes;
try {
  mkdirSync(join(temp, 'tools'));
  for (const p of ['tools/gen-rules.cjs', 'tools/gen-gate.cjs', 'database.rules.json', 'hours.json', 'holidays.json']) copyFileSync(join(ROOT, p), join(temp, p));
  execFileSync(process.execPath, [join(temp, 'tools/gen-rules.cjs'), 'final']);
  execFileSync(process.execPath, [join(temp, 'tools/gen-gate.cjs')]);
  rules = JSON.parse(readFileSync(join(temp, 'database.rules.deploy.json'), 'utf8')).rules;
  bytes = statSync(join(temp, 'database.rules.deploy.json')).size;
} finally {
  rmSync(temp, { recursive: true, force: true });
}

test('ticket debit, per-race cap and once-only refund contract', async () => {
  const local = new Local(rules);
  await contract(local, async (label, expected, action) => assert.equal(await action(), expected, label));
});

test('authorization is narrow: no public race lists or private tickets', () => {
  const l = new Local(rules);
  for (const path of ['race', 'race/r', 'race/x', 'race/t', `race/t/${N}/${U}`, `race/u/${U}`, 'wallet', `wallet/${U}`, 'players', 'config', 'raceData']) {
    assert.equal(l.read(O, path), false, `operator ${path}`);
    if (!path.startsWith('config') && path !== 'players') assert.equal(l.read(null, path), false, `anonymous ${path}`);
  }
  assert.equal(l.read(O, `admins/${O}`), false);
  assert.equal(l.read(O, `approved/${O}`), false);
  assert.equal(l.read(U, `race/r/${N}`), true);
  assert.equal(l.read(U, `race/x/${N}`), true);
  assert.equal(l.read(OTHER, `race/t/${N}/${U}`), false);
  for (const path of [`race/r/${N}`, `race/x/${N}`, 'config/raceOperatorUid', 'config/raceHours', 'config/hoursBlock', 'holidays', 'raceData/v']) assert.equal(l.read(O, path), true, path);
  const recovery = { orderByKey: true, startAt: N, endAt: String(Number(N) + 239), limitToFirst: 260 };
  for (const path of ['race/r', 'race/x']) {
    assert.equal(l.read(O, path, recovery), true, path);
    assert.equal(l.read(U, path, recovery), false, 'players have no range reads');
    for (const changed of [
      { startAt: null }, { endAt: null }, { startAt: Number(N) }, { endAt: Number(N) + 239 },
      { orderByKey: false }, { limitToFirst: 261 }, { limitToFirst: 300 },
      { limitToFirst: null, limitToLast: 260 },
    ]) assert.equal(l.read(O, path, { ...recovery, ...changed }), false, JSON.stringify(changed));
  }
});

test('grant and heartbeat are exclusively server-timestamped operator writes', () => {
  const l = new Local(rules), grant = { g: true, v: 'fixture-v1', at: START + 1000 };
  delete l.data.race.r;
  assert.equal(l.update(U, { [`race/r/${N}`]: grant }), false);
  assert.equal(l.update(O, { [`race/r/${N}`]: { ...grant, v: 'wrong' } }), false);
  assert.equal(l.update(O, { [`race/r/${N}`]: { ...grant, at: START } }), false);
  assert.equal(l.update(O, { [`race/r/${N}`]: { ...grant, at: String(START + 1000) } }), false);
  assert.equal(l.update(O, { [`race/r/${Number(N) + 1}`]: grant }), false);
  assert.equal(l.update(O, { [`race/r/${N}`]: grant }), true);
  assert.equal(l.update(O, { [`race/r/${N}/at`]: START + 1000 }), false);
  assert.equal(l.update(O, { 'race/op/hb': START }), false);
  assert.equal(l.update(O, { 'race/op/hb': String(START + 1000) }), false);
  assert.equal(l.update(O, { 'race/op/hb': START + 1000 }), true);
});

test('result correspondence uses the real generated scenario/table/event layout', () => {
  // Include a calm slot so promotion, elimination, stability, no-event and
  // their cumulative half-open boundaries all use the core's actual tables.
  const calm = Array.from({ length: 10000 }, (_, i) => i).find((i) => D.derbyStaticScenario(i).h.some((h) => h.k === 'calm'));
  for (const s of [0, 2, calm]) {
    const n = 5000000 + s, start = n * 360000, sc = D.derbyStaticScenario(s);
    const gs = new Set([0, 999, ...sc.h.flatMap((h) => [h.b - 1, h.b, h.d - 1, h.d, h.l - 1, h.l]).filter((g) => g >= 0 && g < 1000)]);
    for (const g of gs) {
      const f = fixture(start); f._test.now = start + 240000;
      const result = { k: 0, g, ...D.derbyResolve(n, '0000' + String(g).padStart(3, '0')).res, at: f._test.now };
      const l = new Local(rules, f), p = `race/x/${n}`;
      assert.equal(l.update(O, { [p]: { ...result, e: result.e === 'n' ? 'b7' : 'n' } }), false, `event ${s}/${g}`);
      assert.equal(l.update(O, { [p]: { ...result, a: result.b, b: result.a } }), false, `order ${s}/${g}`);
      assert.equal(l.update(O, { [p]: result }), true, `valid ${s}/${g}`);
      assert.equal(l.update(O, { [p]: result }), false, 'result immutable');
    }
    const f = fixture(start); f._test.now = start + 240000 + 86400000;
    assert.equal(new Local(rules, f).update(O, { [`race/x/${n}`]: { k: 0, g: 999, ...D.derbyResolve(n, '0000999').res, at: f._test.now } }), false, 'draw stops exactly at refund deadline');
  }
});

test('all five bet kinds pay pinned odds, with out-of-order receipts and off-hours settlement', () => {
  for (const [t, s1, s2, wins] of [
    ['W', '0', undefined, true], ['P', '2', undefined, true], ['Q', '0', '1', true],
    ['E', '0', '1', true], ['R', '0', '2', true], ['W', '7', undefined, false],
  ]) {
    const l = new Local(rules);
    assert.equal(l.update(U, purchase(N, '00', 100, t, s1, s2)), true);
    assert.equal(l.update(U, purchase(N, '01', 100, t, s1, s2, 100)), true);
    l.force(`race/x/${N}`, { a: '0', b: '1', c: '2', e: 'n', k: 0, g: 999, at: START + 240000 });
    l.force('raceData', { v: 'new-data-without-old-odds' });
    l.force('config/hoursBlock', true);
    l.force('_test/now', Date.parse('2026-11-16T10:00:00+09:00'));
    const pay = wins ? D.raceOdds(Number(N), t, Number(s1), s2 === undefined ? -1 : Number(s2)) * 10 : 0;
    assert.equal(l.update(U, { ...claim(N, '01', pay), [`wallet/${U}/bait`]: 1 }), false, 'claim cannot smuggle gear off-hours');
    assert.equal(l.update(U, claim(N, '01', pay + 100)), false);
    assert.equal(l.update(U, claim(N, '01', pay)), true);
    assert.equal(l.update(U, claim(N, '00', pay)), true, 'earlier ticket remains claimable');
    assert.equal(l.update(U, claim(N, '01', pay)), false);
  }
});

test('safe integer payout divides stake before multiplying pinned odds', () => {
  // Multiplying these two safe integers first rounds the intermediate product,
  // although the contractual final payout is itself a safe integer.
  const a = 4094181479427700, od = 22;
  const pay = Number(BigInt(a) / 10n * BigInt(od));
  assert.equal(pay, 9007199254740940);
  const f = fixture();
  const p = f.raceData.sc[Number(N) % 10000].p;
  f.raceData.odds[p].W['0'] = od;
  f.config.raceMax = { park: a, branch: 50000 };
  f.wallet[U] = { c: a, e: 0 };
  const l = new Local(rules, f), patch = purchase(N, '00', a);
  patch[`race/t/${N}/${U}/00`].od = od;
  assert.equal(l.update(U, patch), true);
  l.force(`race/x/${N}`, { a: '0', b: '1', c: '2', e: 'n', k: 0, g: 999, at: START + 240000 });
  assert.equal(l.update(U, claim(N, '00', pay + 1)), false);
  assert.equal(l.update(U, claim(N, '00', pay)), true);
});

test('pinned odds must still be an integer multiplier of at least 1.0', () => {
  for (const od of [0.5, 9]) {
    const f = fixture(), p = f.raceData.sc[Number(N) % 10000].p;
    f.raceData.odds[p].W['0'] = od;
    const patch = purchase(); patch[`race/t/${N}/${U}/00`].od = od;
    assert.equal(new Local(rules, f).update(U, patch), false);
  }
});

test('compact gate preserves the existing hours policy and derby requires the entire sale window', () => {
  const l = new Local(rules), breaks = JSON.parse(readFileSync(join(ROOT, 'hours.json'), 'utf8')).breaks.map(([a, b]) => [a, b].map((x) => x.split(':').reduce((h, m) => +h * 60 + +m)));
  l.force('config/hoursBlock', true);
  l.force('race/r', {});
  const first = Date.parse('2026-11-09T00:00:00+09:00');
  for (let i = 0; i < 7 * 1440; i++) {
    const now = first + i * 60000; l.force('_test/now', now);
    assert.equal(l.read(U, 'config'), hoursState(now, {}, breaks) !== 'blocked', new Date(now).toISOString());
    const n = Math.floor(now / 360000), start = n * 360000, g = { g: true, v: 'fixture-v1', at: now };
    const expected = now % 360000 < 240000 && D.raceScheduled(n, HOURS, { holidays: {}, hoursBlock: true, breaks });
    assert.equal(l.update(O, { [`race/r/${n}`]: g }), expected, `sale window ${new Date(now).toISOString()}`);
    l.force(`race/r/${n}`, null);
  }
});

test('deployment artifact stays below the byte limit', () => assert.ok(bytes <= 262144));

let clientStore;
const stub = (s) => ({ url: `data:text/javascript,${encodeURIComponent(s)}`, shortCircuit: true });
const clientHooks = registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'firebase/database') return stub(`
      export const ref = (_db, path = '') => ({ path });
      export const query = (r) => r;
      export const orderByChild = () => null, equalTo = () => null;
      export const increment = (n) => ({ '.sv': { increment: n } });
      export const serverTimestamp = () => globalThis.__derbyRuleClient.now();
      export const get = async (r) => { const value = globalThis.__derbyRuleClient.read(r.path); return { val: () => value }; };
      export const update = async (r, fields) => globalThis.__derbyRuleClient.write(Object.fromEntries(Object.entries(fields).map(([k,v]) => [[r.path,k].filter(Boolean).join('/'),v])));
      export const set = async (r, v) => globalThis.__derbyRuleClient.write({ [r.path]: v });
      export const onValue = () => () => {};
      export const runTransaction = () => { throw new Error('unexpected transaction in derby flow'); };
    `);
    if (spec === '../firebase/app') return stub('export const db = {};');
    if (spec === '../firebase/db') return stub('export const serverNow = () => globalThis.__derbyRuleClient.now();');
    return next(spec, ctx);
  },
});
const { WalletMgr } = await import('../src/game/wallet.ts');
clientHooks.deregister();
function clients(f = fixture()) {
  clientStore = new Local(rules, f);
  globalThis.__derbyRuleClient = {
    now: () => clientStore.data._test.now,
    read: (path) => {
      assert.ok(clientStore.read(U, path), `client read permission ${path}`);
      return clone(getAt(clientStore.data, path));
    },
    write: (patch) => {
      if (!clientStore.update(U, patch)) throw new Error('permission_denied');
    },
  };
  const make = () => new WalletMgr({ uid: U, toast: () => {}, events: { emit: () => {} } });
  return [make(), make()];
}
test('WalletMgr rapid batch lines and two tabs debit without lost balances', async () => {
  const [a, b] = clients();
  const line = { t: 'W', s1: 0, s2: -1, a: 100 };
  const results = (await Promise.all([a.buyDerby(Number(N), [line, line], 100000), b.buyDerby(Number(N), [line, line], 100000)])).flat();
  assert.equal(results.filter((r) => r.ok).length, 4);
  assert.equal(new Set(results.map((r) => r.nn)).size, 4);
  assert.equal(getAt(clientStore.data, `wallet/${U}/c`), 199600);
  assert.equal(getAt(clientStore.data, `wallet/${U}/sp`), 400);
  assert.equal(getAt(clientStore.data, `race/u/${U}/${N}/s`), 400);
});
test('WalletMgr retains an earlier unknown result, then refunds once across tabs', async () => {
  const [a, b] = clients();
  const r = await a.buyDerby(Number(N), [{ t: 'W', s1: 0, s2: -1, a: 100 }], 100000);
  assert.equal(r[0].ok, true);
  assert.equal((await a.settleDerby()).pending, 1);
  assert.equal(getAt(clientStore.data, `race/u/${U}/${N}/i`), true);
  clientStore.force('_test/now', START + 240000 + 86400000);
  const result = await Promise.all([a.settleDerby(), b.settleDerby()]);
  assert.equal(result.reduce((sum, x) => sum + x.refunded, 0), 100);
  assert.equal(getAt(clientStore.data, `race/x/${N}/v`), true);
  assert.equal(getAt(clientStore.data, `wallet/${U}/c`), 200000);
  assert.equal(getAt(clientStore.data, `race/u/${U}/${N}/00`), true);
  assert.equal((await a.settleDerby()).refunded, 0);
  delete globalThis.__derbyRuleClient;
});

export async function derbyEmulatorCases({ root, as, expect }) {
  if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST || !(process.env.GCLOUD_PROJECT || 'demo-mawaverse').startsWith('demo-')) throw new Error('Derby tests require a local demo emulator');
  const dbs = { [U]: as(U), [O]: as(O), [OTHER]: as(OTHER) };
  const store = {
    reset: (value) => root.ref().set(value),
    update: async (uid, patch) => {
      try {
        // Use the privileged fixture handle for ADMIN only via an explicit auth override.
        await (dbs[uid] ??= as(uid === 'ADMIN' ? 'DERBY_ADMIN' : uid)).ref().update(patch);
        return true;
      } catch (e) { if (/permission/i.test(String(e.message))) return false; throw e; }
    },
  };
  // Existing suite already owns the ADMIN app; use a separate approved admin UID.
  const baseReset = store.reset;
  store.reset = async (f) => { const v = clone(f); v.admins.DERBY_ADMIN = true; await baseReset(v); };
  await contract(store, (label, expected, action) => expect(`경마공원: ${label}`, expected ? 'allow' : 'deny', async () => {
    if (!await action()) throw new Error('permission: denied');
  }));
  await store.reset(fixture());
  for (const path of ['race/r', 'race/x']) {
    const range = (db) => db.ref(path).orderByKey().startAt(N).endAt(String(Number(N) + 239));
    await expect(`경마공원: bounded operator recovery ${path}`, 'allow', () => range(dbs[O]).limitToFirst(260).get());
    await expect(`경마공원: no unbounded operator recovery ${path}`, 'deny', () => range(dbs[O]).get());
    await expect(`경마공원: no broad player recovery ${path}`, 'deny', () => range(dbs[U]).limitToFirst(260).get());
  }
}
