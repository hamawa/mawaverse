// 경마 진행 시험 (src/game/casino.ts). 실행: node --test tests/casino.test.mjs
// 2026-11-12 제보("마감 직전에 배팅하면 앞사람 배팅이 날아간다")를 다시 내지 않게: 달리는 경주 위에 새 라운드를 열지 않는지, 화면이 넘어가도 배당을 받는지 본다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Firebase 대신 기록만 하는 가짜. 읽기는 FB.rounds 에서, 쓰기는 FB.sets 에 쌓고 라운드를 만들면 FB.rounds 에도 넣는다
const FB = (globalThis.__fb = { rounds: {}, sets: [], listener: null, now: 1_800_000_000_000 });
globalThis.window = globalThis;
const stub = (src) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });
const STUBS = {
  'firebase/database': `
    const FB = globalThis.__fb;
    const snap = (key, v) => ({ key, val: () => v, exists: () => v != null });
    export const ref = (_db, path) => ({ path });
    export const query = (r, ...mods) => ({ path: r.path, last: mods.some((m) => m === 'last') });
    export const orderByKey = () => 'key', limitToLast = () => 'last', limitToFirst = () => 'first', endAt = () => 'end';
    export const serverTimestamp = () => '__ts';
    export const increment = (n) => ({ inc: n });
    export const onValue = (_q, cb) => { FB.listener = cb; return () => {}; };
    export const update = async () => {};
    export const set = async (r, v) => {
      const m = /^casino\\/r\\/([^/]+)(\\/at)?$/.exec(r.path);
      if (m && m[2]) { if (FB.rounds[m[1]]?.at) throw new Error('permission_denied'); FB.rounds[m[1]].at = FB.now; }
      else if (m) FB.rounds[m[1]] = { ...v, o: FB.now };
      FB.sets.push(r.path);
    };
    export const get = async (r) => {
      if (r.path === 'casino/r') {
        const keys = Object.keys(FB.rounds).sort();
        const list = r.last ? keys.slice(-1) : [];
        return { forEach: (f) => list.forEach((k) => f(snap(k, FB.rounds[k]))) };
      }
      const m = /^casino\\/r\\/([^/]+)$/.exec(r.path);
      return snap(m?.[1] ?? null, m ? (FB.rounds[m[1]] ?? null) : null);
    };`,
  '../firebase/app': 'export const db = {};',
  '../firebase/db': 'export const serverNow = () => globalThis.__fb.now;',
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

const { CasinoMgr } = await import('../src/game/casino.ts');
const { BET_MS, RACE_MS, RACE_GRACE_MS, raceRunning, winnerOf, payoutOf } = await import('../src/shared/casino.ts');

const NOW = FB.now;
// at % 5 가 말 번호: 2번 말이 이기는 마감 시각
const atFor = (horse, near) => { let at = near; while (winnerOf(at) !== horse) at--; return at; };

function rig({ rounds = {}, wallet = {}, room = 'casino' } = {}) {
  FB.rounds = structuredClone(rounds); FB.sets = []; FB.now = NOW;
  const calls = { bets: [], claims: [], toasts: [] };
  const w = {
    uid: 'me', profile: { nick: '나' }, config: {}, me: { roomId: room },
    wallet: {
      loaded: true, balance: 5000, wallet: { c: 5000, e: 5000, ...wallet },
      betRace: async (rid, h, a) => { calls.bets.push([rid, h, a]); (FB.rounds[rid].bets ??= {}).me = { h, a, n: '나' }; w.wallet.wallet.cb = rid; return true; },
      claimRace: async (rid, win) => { calls.claims.push([rid, win]); w.wallet.wallet.cr = rid; return true; },
    },
    toast: (m) => calls.toasts.push(m),
    events: { emit: () => {} },
  };
  const mgr = new CasinoMgr(w);
  mgr.start();
  // 화면은 최신 라운드 하나만 본다
  const show = () => { const k = Object.keys(FB.rounds).sort().at(-1); FB.listener({ forEach: (f) => { if (k) f({ key: k, val: () => structuredClone(FB.rounds[k]) }); } }); };
  show();
  return { mgr, w, calls, show };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

test('경주가 달리는 중인지: 마감 뒤 경주 시간 + 여유 동안', () => {
  assert.equal(raceRunning(null, NOW), false);
  assert.equal(raceRunning({ o: NOW - 5000 }, NOW), false); // 아직 배팅 중인 라운드는 달리는 게 아니다
  assert.equal(raceRunning({ at: NOW }, NOW), true);
  assert.equal(raceRunning({ at: NOW - RACE_MS }, NOW), true);
  assert.equal(raceRunning({ at: NOW - RACE_MS - RACE_GRACE_MS }, NOW), false);
});

test('달리는 경주 위에는 새 라운드를 열지 않는다 (앞사람 배팅이 화면에서 사라지던 버그)', async () => {
  const at = NOW - 2000; // 2초 전에 마감: 경주 중
  const { mgr, calls } = rig({ rounds: { R1: { o: at - BET_MS, by: 'other', at, bets: { other: { h: 1, a: 300, n: '남' } } } } });
  assert.equal(await mgr.bet(2, 100), 'racing');
  assert.deepEqual(FB.sets, [], '새 라운드를 만들지 않았다');
  assert.deepEqual(calls.bets, []);
  // 경주가 끝나면 새 라운드를 열 수 있다
  FB.now = at + RACE_MS + RACE_GRACE_MS;
  assert.equal(await mgr.bet(2, 100), 'ok');
  assert.equal(FB.sets.length, 1);
  assert.equal(calls.bets.length, 1);
  assert.notEqual(calls.bets[0][0], 'R1');
});

test('확인 창을 보는 사이에 마감된 라운드에 건 배팅은 거절한다 (조용히 새 라운드를 열지 않는다)', async () => {
  const at = NOW - 60000; // 한참 전에 끝난 경주
  const { mgr, calls } = rig({ rounds: { R1: { o: at - BET_MS, by: 'other', at } } });
  assert.equal(await mgr.bet(2, 100, 'R1'), 'late');
  assert.deepEqual(FB.sets, []);
  assert.deepEqual(calls.bets, []);
  // 누를 때 열린 라운드가 없었으면(새 경주를 시작하려던 것) 그대로 새 라운드
  assert.equal(await mgr.bet(2, 100, null), 'ok');
});

test('열려 있는 라운드에는 그대로 건다. 마감 1.5초 전부터는 거절', async () => {
  const { mgr, calls, show } = rig({ rounds: { R1: { o: NOW - 5000, by: 'other' } } });
  assert.equal(await mgr.bet(3, 500, 'R1'), 'ok');
  assert.deepEqual(calls.bets, [['R1', 3, 500]]);
  show(); // 내 배팅이 화면에 반영된 뒤
  assert.equal(await mgr.bet(3, 500, 'R1'), 'dup');
  const late = rig({ rounds: { R1: { o: NOW - BET_MS + 1000, by: 'other' } } });
  assert.equal(await late.mgr.bet(3, 500, 'R1'), 'late');
  assert.deepEqual(late.calls.bets, []);
});

test('화면이 다음 라운드로 넘어가도 앞 라운드의 배당을 받는다', async () => {
  const { mgr, calls, show } = rig({ rounds: { R1: { o: NOW - BET_MS - 1000, by: 'me', bets: { me: { h: 2, a: 300, n: '나' } } } }, wallet: { cb: 'R1' } });
  // 마감되자마자(경주가 화면에서 끝나기 전에) 다른 클라이언트가 새 라운드를 열었다
  FB.rounds.R1.at = atFor(2, NOW);
  FB.rounds.R2 = { o: NOW, by: 'other' };
  show();
  await flush(); await flush();
  assert.deepEqual(calls.claims, [['R1', payoutOf(300)]]);
  assert.equal(mgr.state().rid, 'R2');
});

test('새로 걸기 전에 지난 배팅의 배당을 먼저 받는다 (cb 를 덮어쓰기 전에)', async () => {
  const old = atFor(4, NOW - 3600000);
  const { mgr, calls } = rig({
    rounds: { R0: { o: old - BET_MS, by: 'me', at: old, bets: { me: { h: 4, a: 1000, n: '나' } } }, R5: { o: NOW - 600000, by: 'other', at: NOW - 500000 } },
    wallet: { cb: 'R0' },
  });
  assert.equal(await mgr.bet(1, 100), 'ok');
  assert.deepEqual(calls.claims, [['R0', payoutOf(1000)]]);
  assert.equal(calls.bets.length, 1);
});

test('내 배팅이 최신이 아닌 라운드에 남았으면: 끝나기 전에는 새로 못 걸고, 때가 되면 내가 닫고 받는다', async () => {
  const { mgr, calls } = rig({
    rounds: { R0: { o: NOW - 5000, by: 'me', bets: { me: { h: 2, a: 300, n: '나' } } }, R1: { o: NOW - 4000, by: 'other' } },
    wallet: { cb: 'R0' },
  });
  assert.equal(await mgr.bet(1, 100, 'R1'), 'racing');
  assert.deepEqual(calls.bets, [], 'cb 를 덮어쓰지 않았다');
  // 마감 시각이 지나면 tick 이 그 라운드를 닫고 결과를 받는다 (닫는 시각이 결과를 정한다)
  FB.now = atFor(2, NOW + BET_MS);
  mgr.tick();
  await flush(); await flush(); await flush();
  assert.ok(FB.sets.includes('casino/r/R0/at'), '최신이 아닌 내 라운드를 닫았다');
  assert.deepEqual(calls.claims, [['R0', payoutOf(300)]]);
});

test('이미 받은 라운드는 다시 읽지도 받지도 않는다', async () => {
  const at = atFor(2, NOW - 3600000);
  const { mgr, calls } = rig({
    rounds: { R0: { o: at - BET_MS, by: 'me', at, bets: { me: { h: 2, a: 300, n: '나' } } }, R1: { o: NOW - 600000, by: 'other', at: NOW - 500000 } },
    wallet: { cb: 'R0', cr: 'R0' },
  });
  mgr.tick();
  await flush();
  assert.deepEqual(calls.claims, []);
});
