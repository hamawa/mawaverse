// Defensive, local-only rule contract fixtures. This evaluator exercises the
// generated expressions; it does NOT replace the RTDB compiler/emulator check.
// The same sale/draw/reveal/settlement cases run against the emulator from rules-gate.test.mjs.
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
const U = 'DERBY_USER', OTHER = 'DERBY_OTHER';
const START = Date.parse('2026-11-14T19:00:00+09:00');
const N = String(START / 360000);
const CLOSE = START + 240000;
const FIN = START + 280000; // 결승 (DERBY_FINISH_MS): 환급은 결승 뒤에 한다
const HOURS = { on: true, d: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, { s: 0, e: 1440 }])) };
// 숨은 결과표 칸 4개 (칸 = 추첨 시각 % 4)
const DIGITS = ['0000000', '4071935', '9999999', '1234567'];
const secretOf = (n) => DIGITS.map((d) => D.derbySecretEntry(Number(n), d));
const clone = (x) => structuredClone(x);
const getAt = (root, path) => path.split('/').filter(Boolean).reduce((v, k) => v?.[k], root) ?? null;
function putAt(root, path, value) {
  const parts = path.split('/').filter(Boolean), last = parts.pop();
  let v = root;
  for (const p of parts) v = v[p] ??= {};
  if (value === null) delete v[last]; else v[last] = clone(value);
}

function fixture(start = START) {
  const n = String(start / 360000), s = Number(n) % 10000, p = D.derbyScenario(s).p;
  return {
    _test: { now: start + 1000 },
    admins: { ADMIN: true }, approved: { [U]: true, [OTHER]: true },
    config: { hoursBlock: false, raceHours: clone(HOURS), prices: { bait: 5 } },
    raceData: { v: 'fixture-v1', sc: { [s]: p }, odds: { [p]: D.derbyOddsTable(p) } },
    raceSecret: { [n]: secretOf(n) },
    wallet: { [U]: { c: 200000, e: 200000 } },
    players: { [U]: { n: '닉', a: 'm-1', x: 10, y: 10, d: 0, s: 'session', m: 'race-park', hb: start } },
    occ: { 'race-park~10_10': U },
  };
}
function purchase(n = N, nn = '00', a = 100, t = 'W', s1 = '0', s2, spent = 0) {
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
// 공개 쓰기 (칸 글자열 o 와 그 결과 a·b·c·e)
function reveal(n, digits) {
  const res = D.derbyResolve(Number(n), digits).res;
  return { [`race/x/${n}/o`]: D.derbySecretEntry(Number(n), digits), [`race/x/${n}/a`]: res.a, [`race/x/${n}/b`]: res.b, [`race/x/${n}/c`]: res.c, [`race/x/${n}/e`]: res.e };
}
// 화면(WalletMgr.revealDerby)과 같은 순서로 2진수 앞자리를 묻는다. 허용된 묻기 = 그 앞자리
async function probeBits(ask, n) {
  let bits = '', asked = 0;
  while (bits.length < D.DERBY_SECRET_BITS) {
    if (!D.derbyBitMayBeOne(bits)) { bits += '0'; continue; }
    asked++;
    bits += (await ask({ [`race/q/${n}/${bits}1`]: null })) ? '1' : '0';
  }
  return { digits: D.derbyBitsDigits(bits), asked };
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
    fn = new Function('root', 'data', 'newData', 'auth', 'now', 'query', '$n', '$uid', '$nn', '$k', '$p',
      `return !!(${expr.replaceAll('.matches(', '.match(').replaceAll('.beginsWith(', '.startsWith(')});`);
    compiled.set(expr, fn);
  }
  try {
    return fn(new Snap(old), new Snap(old, path), new Snap(next, path), uid ? { uid } : null,
      old._test.now, q, vars.$n, vars.$uid, vars.$nn, vars.$k, vars.$p);
  } catch { return false; } // RTDB: 식에서 오류가 나면(없는 값의 메서드 등) 그 조건은 거짓
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
  await deny('ticket count cannot be reset', U, { [`race/u/${U}/${N}/c`]: null });
  // 내 경주 색인(i)은 본인이 내릴 수 있다 (다 받은 경주가 로그인 때의 환급 확인에 다시 내려오지 않게. 2026-11-24). 내려도 합계·장수는 그대로라 한도를 비켜 가지 못한다
  await deny('another player cannot drop my race index', OTHER, { [`race/u/${U}/${N}/i`]: null });
  await allow('owner may drop the race index', U, { [`race/u/${U}/${N}/i`]: null });
  await deny('dropping the index does not reset the purchase total', U, purchase(N, '01', 100, 'W', '1', undefined, 0));
  await deny('used marker cannot issue another ticket', U, { [`race/t/${N}/${U}/01`]: p[`race/t/${N}/${U}/00`] });
  await allow('next line preserves balance and cumulative spend', U, purchase(N, '01', 200, 'W', '1', undefined, 100));
  await deny('stale-tab total cannot overwrite a newer purchase', U, purchase(N, '02', 100, 'W', '0', undefined, 0));
  await allow('normal earning preserves derby markers', U, { [`wallet/${U}/c`]: { '.sv': { increment: 5 } }, [`wallet/${U}/e`]: { '.sv': { increment: 5 } } });
  await deny('generic earning cannot change purchase keys', U, { [`wallet/${U}/kd`]: '1', [`wallet/${U}/c`]: { '.sv': { increment: 1 } }, [`wallet/${U}/e`]: { '.sv': { increment: 1 } } });
  for (const [label, change] of [
    ['race outside the hidden table', { [`raceSecret/${N}`]: null }],
    ['buying after close', { '_test/now': CLOSE }],
    ['race hours off', { 'config/raceHours/on': false }],
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
  { // 관람석 뒤 창구(18,32) 앞 (18,31), 동남쪽 구석 (36,31): 공원 맵 38×34 어디서나 살 수 있다. 맵 밖 좌표는 안 된다 (2026-11-24 에 84×49 에서 줄였다)
    const f = fixture(); f.players[U].x = 18; f.players[U].y = 31; f.occ = { 'race-park~18_31': U };
    await reset(f); await allow('teller spot behind the stands', U, purchase());
    f.players[U].x = 36; f.players[U].y = 31; f.occ = { 'race-park~36_31': U };
    await reset(f); await allow('far corner of the park', U, purchase());
    f.players[U].x = 38; f.occ = { 'race-park~38_31': U };
    await reset(f); await deny('outside the park map (x)', U, purchase());
    f.players[U].x = 18; f.players[U].y = 34; f.occ = { 'race-park~18_34': U };
    await reset(f); await deny('outside the park map (y)', U, purchase());
    f.players[U].x = 62; f.players[U].y = 31; f.occ = { 'race-park~62_31': U }; // 옛 큰 맵의 자리
    await reset(f); await deny('a spot of the old 84x49 map', U, purchase());
  }
  await reset(); await deny('stake must be a 100 multiple', U, purchase(N, '00', 150));
  await deny('odds must match pinned profile', U, { ...purchase(), [`race/t/${N}/${U}/00`]: { t: 'W', s1: '0', a: 100, od: 999999 } });

  const br = fixture();
  br.players[U] = { ...br.players[U], x: 35, y: 6, r: 'casino' }; delete br.players[U].m;
  br.occ = { '35_6': U }; br.rooms = { casino: { cap: 10, round: 1, state: 'open', members: { [U]: { n: '닉', ready: false, losses: 0, at: START } } } };
  await reset(br); await allow('actual branch membership and placement', U, purchase(N, '00', 5000));
  await deny('branch cumulative cap', U, purchase(N, '01', 100, 'W', '0', undefined, 5000));
  const off = clone(br); off.players[U].x = 1; off.occ = { '1_6': U }; await reset(off);
  await deny('room label alone outside actual branch does not qualify', U, purchase());
  const nomember = clone(br); delete nomember.rooms; await reset(nomember);
  await deny('branch placement without membership does not qualify', U, purchase());
  await reset(); await allow('park default combined cap', U, purchase(N, '00', 10000));
  await allow('legacy wallet deletion does not erase the race ledger', U, { [`wallet/${U}`]: null });
  await allow('generic wallet reinitialization stays available', U, { [`wallet/${U}`]: { c: 200000, e: 200000 } });
  await deny('wallet reset cannot bypass a race cap', U, purchase(N, '01', 100));

  { // 마감 경계: 마감 1ms 전까지 사고, 마감 시각부터 추첨한다
    const f = fixture(); f._test.now = CLOSE - 1; await reset(f);
    await allow('buy at CLOSE-1', U, purchase());
    await deny('draw at CLOSE-1', OTHER, { [`race/x/${N}/at`]: CLOSE - 1 });
    const g = fixture(); g._test.now = CLOSE; await reset(g);
    await deny('buy at CLOSE', U, purchase());
    await allow('draw at CLOSE', OTHER, { [`race/x/${N}/at`]: CLOSE });
  }
  { // 경주 번호 자릿수가 바뀐 뒤에도 자릿수가 적은 지난 경주는 추첨할 수 있다 (자릿수가 많은 앞날 경주는 아래에서 거부)
    const f = fixture(); f._test.now = CLOSE + 5; f.raceSecret['999999'] = secretOf('999999'); f.raceSecret[`${N}0`] = secretOf(`${N}0`); await reset(f);
    await allow('draw for a past race with fewer digits', OTHER, { 'race/x/999999/at': CLOSE + 5 });
    await deny('draw for a race with more digits', OTHER, { [`race/x/${N}0/at`]: CLOSE + 5 });
  }

  // ---- 추첨 · 공개 · 환급 ----
  await reset(); await allow('ticket for the draw', U, purchase());
  await deny('draw before close', OTHER, { [`race/x/${N}/at`]: START + 1000 });
  await deny('probe before the draw', OTHER, { [`race/q/${N}/1`]: null });
  const df = fixture(); df._test.now = CLOSE + 2; // 칸 = (CLOSE + 2) % 4
  df.race = { t: { [N]: { [U]: { '00': purchase()[`race/t/${N}/${U}/00`] } } }, u: { [U]: { [N]: { i: true, s: 100, c: 1 } } } };
  df.wallet[U] = { c: 199900, e: 200000, sp: 100, b: 'derby', kd: N, kb: '00', kt: 100 };
  await reset(df);
  const slot = df._test.now % 4, digits = DIGITS[slot], other = DIGITS[(slot + 1) % 4];
  await deny('draw time must be the server time', OTHER, { [`race/x/${N}/at`]: df._test.now - 1 });
  await deny('no draw for a race without the hidden table', OTHER, { [`race/x/${Number(N) - 1}/at`]: df._test.now });
  await deny('no draw for a future race', OTHER, { [`race/x/${Number(N) + 1}/at`]: df._test.now });
  await deny('draw cannot carry a guessed result', OTHER, { [`race/x/${N}/at`]: df._test.now, ...reveal(N, other) });
  await allow('any approved player draws once after close', OTHER, { [`race/x/${N}/at`]: df._test.now });
  await deny('draw is write-once', U, { [`race/x/${N}/at`]: df._test.now });
  await deny('claim before the reveal', U, claim(N, '00', 0));
  const entry = D.derbySecretEntry(Number(N), digits);
  await allow('probe matching the drawn entry', OTHER, { [`race/q/${N}/${entry.slice(0, 3)}`]: null });
  await deny('probe not matching the drawn entry', OTHER, { [`race/q/${N}/${entry.slice(0, 2)}${entry[2] === '0' ? '1' : '0'}`]: null });
  await deny('probe cannot store anything', OTHER, { [`race/q/${N}/${entry.slice(0, 3)}`]: true });
  await deny('forged reveal: another slot of the table', OTHER, reveal(N, other));
  await deny('forged reveal: true entry with other placings', OTHER, { ...reveal(N, digits), [`race/x/${N}/a`]: reveal(N, digits)[`race/x/${N}/b`], [`race/x/${N}/b`]: reveal(N, digits)[`race/x/${N}/a`] });
  await deny('reveal needs every placing', OTHER, { [`race/x/${N}/o`]: entry });
  await allow('reveal matching the drawn entry', OTHER, reveal(N, digits));
  await deny('reveal is write-once', OTHER, reveal(N, digits));
  const res = D.derbyResolve(Number(N), digits).res;
  const pay = D.ticketWins({ t: 'W', s1: '0' }, res) ? D.ticketPayout(100, D.raceOdds(Number(N), 'W', 0)) : 0;
  await deny('forged over-payout', U, claim(N, '00', pay + 100));
  await deny('credit alone cannot claim a receipt', U, Object.fromEntries(Object.entries(claim(N, '00', pay)).filter(([k]) => !k.startsWith('race/'))));
  await deny('receipt alone cannot claim money', U, { [`race/u/${U}/${N}/00`]: true });
  await deny('spectator cannot claim the ticket', OTHER, { ...claim(N, '00', pay) });
  await allow('exact fixed-odds payout', U, claim(N, '00', pay));
  await deny('second payout is rejected', U, claim(N, '00', pay));
  await deny('receipt cannot be deleted', U, { [`race/u/${U}/${N}/00`]: null });
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

test('ticket debit, per-race cap, draw, reveal and once-only payout contract', async () => {
  const local = new Local(rules);
  await contract(local, async (label, expected, action) => assert.equal(await action(), expected, label));
});

test('authorization is narrow: nobody reads the hidden table, no public race lists or private tickets', () => {
  const l = new Local(rules);
  for (const uid of [U, 'ADMIN', null]) {
    for (const path of ['raceSecret', `raceSecret/${N}`, `raceSecret/${N}/0`, 'race', 'race/x', 'race/q', 'race/t', 'race/u', 'raceData']) assert.equal(l.read(uid, path), false, `${uid} ${path}`);
  }
  assert.equal(l.read(U, `race/x/${N}`), true);
  assert.equal(l.read(U, 'race/cover'), true);
  assert.equal(l.read(null, `race/x/${N}`), false);
  assert.equal(l.read('PENDING', `race/x/${N}`), false, 'unapproved accounts');
  assert.equal(l.read(OTHER, `race/t/${N}/${U}`), false);
  assert.equal(l.update('ADMIN', { [`raceSecret/${N}/0`]: 'x' }), false, 'clients never write the hidden table');
  assert.equal(l.update(U, { 'race/cover': { s: 0, e: 1 } }), false);
});

test('every slot: the probe protocol recovers exactly the drawn entry in at most 24 probes, and only that entry is accepted', async () => {
  for (let slot = 0; slot < 4; slot++) {
    const f = fixture(); f._test.now = CLOSE + 10 + slot - ((CLOSE + 10) % 4);
    const l = new Local(rules, f);
    assert.equal(l.update(OTHER, { [`race/x/${N}/at`]: f._test.now }), true);
    const want = DIGITS[f._test.now % 4];
    const { digits, asked } = await probeBits((patch) => l.update(OTHER, patch), N);
    assert.equal(digits, want, `slot ${slot}`);
    assert.ok(asked <= 24, `${asked} probes`);
    const leaves = (v) => (v && typeof v === 'object' ? Object.values(v).some(leaves) : v !== null && v !== undefined);
    assert.equal(leaves(getAt(l.data, 'race/q')), false, 'probes store nothing');
    for (const d of DIGITS) if (d !== want) assert.equal(l.update(OTHER, reveal(N, d)), false, `slot ${slot} rejects ${d}`);
    assert.equal(l.update(OTHER, reveal(N, want)), true);
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
    l.force(`race/x/${N}`, { a: '0', b: '1', c: '2', e: 'n', o: 'revealed', at: CLOSE });
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
  const p = f.raceData.sc[Number(N) % 10000];
  f.raceData.odds[p].W['0'] = od;
  f.config.raceMax = { park: a, branch: 50000 };
  f.wallet[U] = { c: a, e: 0 };
  const l = new Local(rules, f), patch = purchase(N, '00', a);
  patch[`race/t/${N}/${U}/00`].od = od;
  assert.equal(l.update(U, patch), true);
  l.force(`race/x/${N}`, { a: '0', b: '1', c: '2', e: 'n', o: 'revealed', at: CLOSE });
  assert.equal(l.update(U, claim(N, '00', pay + 1)), false);
  assert.equal(l.update(U, claim(N, '00', pay)), true);
});

test('pinned odds must still be an integer multiplier of at least 1.0', () => {
  for (const od of [0.5, 9]) {
    const f = fixture(), p = f.raceData.sc[Number(N) % 10000];
    f.raceData.odds[p].W['0'] = od;
    const patch = purchase(); patch[`race/t/${N}/${U}/00`].od = od;
    assert.equal(new Local(rules, f).update(U, patch), false);
  }
});

test('compact gate preserves the existing hours policy and derby sale needs the whole sale window in the schedule', () => {
  const breaks = JSON.parse(readFileSync(join(ROOT, 'hours.json'), 'utf8')).breaks.map(([a, b]) => [a, b].map((x) => x.split(':').reduce((h, m) => +h * 60 + +m)));
  const l = new Local(rules);
  l.force('config/hoursBlock', true);
  const first = Date.parse('2026-11-09T00:00:00+09:00');
  for (let i = 0; i < 7 * 1440; i++) {
    const now = first + i * 60000; l.force('_test/now', now);
    assert.equal(l.read(U, 'config'), hoursState(now, {}, breaks) !== 'blocked', new Date(now).toISOString());
  }
  for (let start = first; start < first + 7 * 86400000; start += 360000) {
    const n = start / 360000, expected = D.raceScheduled(n, HOURS, { holidays: {}, hoursBlock: true, breaks });
    const f = fixture(start); f.config.hoursBlock = true;
    const local = new Local(rules, f), buy = purchase(String(n));
    for (const [at, open] of [[start, expected], [start + 239999, expected], [start + 240000, false]]) {
      local.reset(f); local.force('_test/now', at);
      assert.equal(local.update(U, buy), open, `sale ${new Date(at).toISOString()}`);
    }
  }
});

test('deployment artifact stays below the byte limit', () => assert.ok(bytes <= 262144, `${bytes}`));

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
const { WalletMgr, DERBY_SETTLE_RACES } = await import('../src/game/wallet.ts');
clientHooks.deregister();
function clients(f = fixture()) {
  clientStore = new Local(rules, f);
  const log = { probes: 0, draws: 0, reads: [] };
  globalThis.__derbyRuleClient = {
    now: () => clientStore.data._test.now,
    read: (path) => {
      log.reads.push(path);
      assert.ok(clientStore.read(U, path), `client read permission ${path}`);
      return clone(getAt(clientStore.data, path));
    },
    write: (patch) => {
      if (Object.keys(patch).some((k) => k.startsWith('race/q/'))) log.probes++;
      if (Object.keys(patch).some((k) => /^race\/x\/\d+\/at$/.test(k))) log.draws++;
      if (!clientStore.update(U, patch)) throw new Error('permission_denied');
    },
  };
  const make = () => new WalletMgr({ uid: U, toast: () => {}, events: { emit: () => {} } });
  return [make(), make(), log];
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
  delete globalThis.__derbyRuleClient;
});
test('WalletMgr settleDerby keeps an open race pending, then draws, reveals and pays it once across tabs', async () => {
  const [a, b, log] = clients();
  const lines = [0, 1, 2, 3, 4, 5, 6, 7].map((s1) => ({ t: 'W', s1, s2: -1, a: 100 }));
  assert.equal((await a.buyDerby(Number(N), lines, 100000)).filter((r) => r.ok).length, 8);
  assert.deepEqual(await a.settleDerby(), { paid: 0, tickets: 0, pending: 1 });
  assert.equal(log.draws, 0, 'no draw before close');
  clientStore.force('_test/now', CLOSE + 7); // 경주 중 (결승 전): 받지 않는다
  assert.deepEqual(await a.settleDerby(), { paid: 0, tickets: 0, pending: 1 });
  assert.equal(getAt(clientStore.data, `wallet/${U}/c`), 200000 - 800, 'no payout while the race is still running');
  clientStore.force('_test/now', FIN + 7);
  const both = await Promise.all([a.settleDerby(), b.settleDerby()]);
  const x = getAt(clientStore.data, `race/x/${N}`);
  assert.equal(x.at, FIN + 7);
  const res = D.derbyResolve(Number(N), DIGITS[x.at % 4]).res;
  assert.deepEqual({ a: x.a, b: x.b, c: x.c, e: x.e }, res);
  const want = D.ticketPayout(100, D.raceOdds(Number(N), 'W', Number(res.a)));
  assert.equal(both.reduce((s, r) => s + r.paid, 0), want);
  assert.equal(both.reduce((s, r) => s + r.tickets, 0), 8);
  assert.equal(getAt(clientStore.data, `wallet/${U}/c`), 200000 - 800 + want);
  assert.ok(log.probes <= 2 * 24, `${log.probes} probes`);
  assert.deepEqual(await a.settleDerby(), { paid: 0, tickets: 0, pending: 0 });
  assert.equal(getAt(clientStore.data, `race/u/${U}/${N}/i`), null, 'a fully settled race leaves the login scan (index dropped)');
  assert.deepEqual([getAt(clientStore.data, `race/u/${U}/${N}/s`), getAt(clientStore.data, `race/u/${U}/${N}/c`)], [800, 8], 'the ledger stays');
  delete globalThis.__derbyRuleClient;
});
test('WalletMgr settleDerby(n) settles only that race and pays an already revealed result once', async () => {
  const [a, , log] = clients();
  const lines = [0, 1, 2, 3, 4, 5, 6, 7].map((s1) => ({ t: 'W', s1, s2: -1, a: 100 }));
  assert.equal((await a.buyDerby(Number(N), lines, 100000)).filter((r) => r.ok).length, 8);
  assert.deepEqual(await a.settleDerby(Number(N) + 1), { paid: 0, tickets: 0, pending: 0 });
  const at = CLOSE + 1, digits = DIGITS[at % 4], res = D.derbyResolve(Number(N), digits).res;
  clientStore.force('_test/now', FIN + 1000);
  clientStore.force(`race/x/${N}`, { at, o: D.derbySecretEntry(Number(N), digits), ...res });
  const want = D.ticketPayout(100, D.raceOdds(Number(N), 'W', Number(res.a)));
  assert.deepEqual(await a.settleDerby(Number(N)), { paid: want, tickets: 8, pending: 0 });
  assert.equal(log.probes, 0, 'a revealed result needs no probes');
  assert.equal(getAt(clientStore.data, `wallet/${U}/c`), 200000 - 800 + want);
  assert.deepEqual(await a.settleDerby(Number(N)), { paid: 0, tickets: 0, pending: 0 });
  delete globalThis.__derbyRuleClient;
});
const W8 = [0, 1, 2, 3, 4, 5, 6, 7].map((s1) => ({ t: 'W', s1, s2: -1, a: 100 }));
test('WalletMgr reveals and pays the stored entry when the current resolver would give other placings', async () => {
  // 결과표를 만든 뒤 계산 코드가 바뀐 경우: 칸의 뒷부분(1·2착을 맞바꿈)이 지금 계산과 다르다
  const f = fixture(), cur = DIGITS.map((d) => D.derbyResolve(Number(N), d).res);
  f.raceSecret[N] = DIGITS.map((d, i) => Number(d).toString(2).padStart(24, '0') + cur[i].b + cur[i].a + cur[i].c + cur[i].e);
  const [a, , log] = clients(f);
  assert.equal((await a.buyDerby(Number(N), W8, 100000)).filter((r) => r.ok).length, 8);
  clientStore.force('_test/now', FIN + 9);
  const r = await a.settleDerby(Number(N));
  const x = getAt(clientStore.data, `race/x/${N}`), slot = x.at % 4;
  assert.equal(x.o, f.raceSecret[N][slot], 'the stored entry is revealed as is');
  assert.deepEqual({ a: x.a, b: x.b, c: x.c, e: x.e }, { a: cur[slot].b, b: cur[slot].a, c: cur[slot].c, e: cur[slot].e });
  const want = D.ticketPayout(100, D.raceOdds(Number(N), 'W', Number(cur[slot].b)));
  assert.deepEqual(r, { paid: want, tickets: 8, pending: 0 });
  assert.equal(getAt(clientStore.data, `wallet/${U}/c`), 200000 - 800 + want);
  assert.ok(log.probes <= 24 + 36, `${log.probes} probes`);
  delete globalThis.__derbyRuleClient;
});
test('WalletMgr gives up a reveal whose drawn slot is missing after a bounded number of probes', async () => {
  const f = fixture(), at = CLOSE + 7; // 칸 3
  assert.equal(at % 4, 3);
  f.raceSecret[N] = secretOf(N).slice(0, 3);
  f._test.now = at;
  const [a, , log] = clients(f);
  const x = await a.revealDerby(Number(N));
  assert.deepEqual([x.at, x.res], [at, null]);
  assert.ok(log.probes <= 24 + 8, `${log.probes} probes`);
  delete globalThis.__derbyRuleClient;
});
test('a reveal interrupted mid-probe is completed from scratch by another client', async () => {
  const [a, b] = clients();
  assert.equal((await a.buyDerby(Number(N), W8, 100000)).filter((r) => r.ok).length, 8);
  const at = CLOSE + 6;
  clientStore.force('_test/now', at);
  assert.equal(clientStore.update(OTHER, { [`race/x/${N}/at`]: at }), true);
  let bits = ''; // 다른 화면이 10번 묻고 끊겼다
  for (let i = 0; i < 10; i++) bits += clientStore.update(OTHER, { [`race/q/${N}/${bits}1`]: null }) ? '1' : '0';
  assert.equal(getAt(clientStore.data, `race/x/${N}/o`), null);
  clientStore.force('_test/now', FIN + 1); // 환급(과 그에 앞선 공개)은 결승 뒤에
  const r = await b.settleDerby(Number(N));
  const x = getAt(clientStore.data, `race/x/${N}`), res = D.derbyResolve(Number(N), DIGITS[at % 4]).res;
  assert.equal(x.o, secretOf(N)[at % 4]);
  assert.deepEqual(r, { paid: D.ticketPayout(100, D.raceOdds(Number(N), 'W', Number(res.a))), tickets: 8, pending: 0 });
  delete globalThis.__derbyRuleClient;
});
// 지난 경주 색인: 경주마다 단승 8장(순위 0~7, 한 장은 꼭 맞는다). done 은 다 받은 경주, secret 은 숨은 칸이 있는(공개할 수 있는) 경주
function backlog(f, races, { done = [], secret = [] } = {}) {
  const u = {}, t = {};
  for (const n of races) {
    u[n] = { i: true, s: 800, c: 8, ...(done.includes(n) ? Object.fromEntries(W8.map((_, k) => [`0${k}`, true])) : {}) };
    t[n] = { [U]: Object.fromEntries(W8.map((l, k) => [`0${k}`, { t: 'W', s1: String(l.s1), a: 100, od: D.raceOdds(Number(n), 'W', l.s1) }])) };
  }
  for (const n of secret) f.raceSecret[n] = secretOf(n);
  f.race = { u: { [U]: u }, t };
}
const backlogPay = (n) => { const x = getAt(clientStore.data, `race/x/${n}`); return D.ticketPayout(100, D.raceOdds(Number(n), 'W', Number(x.a))); };
const racesTouched = (log) => new Set(log.reads.filter((p) => p !== `race/u/${U}`).map((p) => p.split('/')[2]));
test('WalletMgr settleDerby reads nothing for fully settled races and visits each unsettled race once per call', async () => {
  const f = fixture(); f._test.now = CLOSE + 1000;
  const done = [1, 2, 3, 4, 5].map((i) => String(Number(N) - 100 - i));
  const open = Array.from({ length: DERBY_SETTLE_RACES + 2 }, (_, i) => String(Number(N) - i - 1)); // 숨은 칸이 없어 추첨이 거부되는 미정산 경주
  backlog(f, [...done, ...open], { done });
  const [a, , log] = clients(f);
  assert.deepEqual(await a.settleDerby(), { paid: 0, tickets: 0, pending: open.length });
  const touched = racesTouched(log);
  for (const n of done) assert.equal(touched.has(n), false, `settled race ${n} was read`);
  assert.deepEqual([...touched].sort(), open.slice().sort(), 'every unsettled race is tried');
  assert.equal(log.draws, open.length, 'one (denied) draw attempt per race');
  delete globalThis.__derbyRuleClient;
});
test('WalletMgr login settlement pays a backlog of DERBY_SETTLE_RACES + 1 valid races in one call', async () => {
  const f = fixture(); f._test.now = CLOSE + 1000;
  const races = Array.from({ length: DERBY_SETTLE_RACES + 1 }, (_, i) => String(Number(N) - i - 1));
  assert.equal(races.length, 9);
  backlog(f, races, { secret: races });
  const [a] = clients(f);
  const r = await a.settleDerby();
  const want = races.reduce((s, n) => s + backlogPay(n), 0);
  assert.deepEqual(r, { paid: want, tickets: 8 * races.length, pending: 0 });
  for (const n of races) assert.equal(Object.keys(getAt(clientStore.data, `race/u/${U}/${n}`)).filter((k) => /^\d\d$/.test(k)).length, 8, `race ${n} receipts`);
  assert.equal(getAt(clientStore.data, `wallet/${U}/c`), 200000 + want);
  assert.deepEqual(await a.settleDerby(), { paid: 0, tickets: 0, pending: 0 });
  delete globalThis.__derbyRuleClient;
});
test('WalletMgr login settlement: the oldest unrevealable races do not block later ones and are not retried in the session', async () => {
  const f = fixture(); f._test.now = CLOSE + 1000;
  const stuck = Array.from({ length: DERBY_SETTLE_RACES }, (_, i) => String(Number(N) - 20 - i)); // 가장 오래된 8경주: 숨은 칸 없음
  const later = [1, 2, 3].map((i) => String(Number(N) - i));
  backlog(f, [...stuck, ...later], { secret: later });
  const [a, , log] = clients(f);
  const r = await a.settleDerby();
  const want = later.reduce((s, n) => s + backlogPay(n), 0);
  assert.deepEqual(r, { paid: want, tickets: 8 * later.length, pending: stuck.length });
  assert.equal(getAt(clientStore.data, `wallet/${U}/c`), 200000 + want);
  log.reads.length = 0; log.probes = 0; log.draws = 0;
  assert.deepEqual(await a.settleDerby(), { paid: 0, tickets: 0, pending: stuck.length });
  assert.deepEqual([...racesTouched(log)], [], 'stuck races are not read again in this session');
  assert.deepEqual([log.draws, log.probes], [0, 0]);
  delete globalThis.__derbyRuleClient;
});

export async function derbyEmulatorCases({ root, as, expect }) {
  if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST || !(process.env.GCLOUD_PROJECT || 'demo-mawaverse').startsWith('demo-')) throw new Error('Derby tests require a local demo emulator');
  const dbs = { [U]: as(U), [OTHER]: as(OTHER) };
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
  dbs.DERBY_ADMIN ??= as('DERBY_ADMIN');
  for (const uid of [U, 'DERBY_ADMIN']) {
    await expect(`경마공원: ${uid} cannot read the hidden table`, 'deny', () => dbs[uid].ref(`raceSecret/${N}`).get());
    await expect(`경마공원: ${uid} cannot write the hidden table`, 'deny', () => dbs[uid].ref(`raceSecret/${N}/0`).set('x'));
  }
  await expect('경마공원: players read the race result slot', 'allow', () => dbs[U].ref(`race/x/${N}`).get());
  await expect('경마공원: players read the table range', 'allow', () => dbs[U].ref('race/cover').get());
  await expect('경마공원: no race list reads', 'deny', () => dbs[U].ref('race/x').get());
  // 공개 순서 전체를 진짜 규칙 엔진으로 (추첨 → 24번 이하 묻기 → 공개)
  const f = fixture(); f._test.now = CLOSE + 3; await store.reset(f);
  await expect('경마공원: draw for the probe run', 'allow', async () => { if (!await store.update(OTHER, { [`race/x/${N}/at`]: f._test.now })) throw new Error('permission: denied'); });
  const { digits, asked } = await probeBits((patch) => store.update(OTHER, patch), N);
  await expect(`경마공원: probes recover the drawn entry (${asked} probes)`, 'allow', async () => {
    if (digits !== DIGITS[f._test.now % 4] || asked > 24) throw new Error(`wrong ${digits} ${asked}`);
    if ((await root.ref('race/q').get()).exists()) throw new Error('probes stored data');
  });
  await expect('경마공원: reveal from the probes', 'allow', async () => { if (!await store.update(OTHER, reveal(N, digits))) throw new Error('permission: denied'); });
}
