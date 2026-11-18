// 낚시 찌 지킴이 시험 (src/game/fishing.ts guard, src/shared/fish.ts bobberNear). 실행: node --test tests/fishing.test.mjs
// 2026-11-18 제보(물에서 일곱 칸 떨어진 사람의 낚싯대가 물까지 뻗어 보였다)를 다시 내지 않게:
// 서 있는 자리와 떨어진 찌는 그리지 않고, 던진 사람 쪽에서도 자리가 바뀌었거나 서버의 찌가 어긋났으면 스스로 바로잡는지 본다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis;
const stub = (src) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });
const STUBS = {
  'firebase/database': `
    export const ref = (_db, path) => ({ path: path ?? '' });
    export const push = () => ({ key: 'k' });
    export const update = async () => {}, set = async () => {};
    export const runTransaction = async () => ({ committed: false, snapshot: { val: () => null } });
    export const serverTimestamp = () => '__ts', increment = (n) => n;
    export const onValue = () => () => {};`,
  '../firebase/app': 'export const db = {};',
  '../firebase/db': 'export const serverNow = () => 1_800_000_000_000; export const onNewChild = () => () => {}; export const readOwn = async () => null; export const rememberOwn = () => {}; export const forgetOwn = () => {};',
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

const { Fishing } = await import('../src/game/fishing.ts');
const { bobberNear, BOBBER_FIX_GAP_MS } = await import('../src/shared/fish.ts');
const { emptyMap, G } = await import('../src/game/map.ts');

// 시각은 시험이 정한다 (지킴이의 다시 쓰기 간격은 performance.now 로 잰다)
let T = 1000;
performance.now = () => T;

// 물은 (5,5) 한 칸. 나는 그 오른쪽 (6,5)에서 왼쪽을 보고 선다
function setup({ auto = false } = {}) {
  T += 60_000;
  const map = emptyMap('t', 't', 12, 10);
  map.ground[5 * map.w + 5] = G.WATER;
  const w = {
    uid: 'me', mapId: 'main', map, switching: false, profile: { own: {} },
    me: { x: 6, y: 5, dir: 1, moving: false, locked: false, roomId: null },
    wallet: { bait: 0, baitOn: false, kingStars: 0, autoReelActive: () => auto, fishStarsFor: () => 0, shownStarsFor: () => 0, takeBait: async () => {}, earn: async () => {} },
    contest: { active: () => null, multiplier: () => 1 },
    toast: () => {}, catchNote: () => {}, fishCaught: () => {}, banner: () => {}, catchLog: { add: () => {} },
  };
  // 가짜 Net: 쓴 찌를 기록하고, echo 가 켜져 있으면 서버에도 그대로 올라간 것으로 보여 준다
  const net = {
    sets: [], seen: null, echo: true,
    setFishing(t) { this.sets.push(t ? `${t.x},${t.y}` : null); if (this.echo) this.seen = t ? `${t.x},${t.y}` : null; },
    seenFishing() { return this.seen; },
    stat: () => {},
  };
  const f = new Fishing(w, net);
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { T += 500; f.autoTick(); } };
  return { f, w, net, tick };
}

test('찌는 낚는 사람의 바로 옆 칸에 있을 때만 그린다', () => {
  assert.equal(bobberNear(6, 5, 5, 5), true);
  assert.equal(bobberNear(5, 4, 5, 5), true);
  assert.equal(bobberNear(12, 5, 5, 5), false, '일곱 칸 떨어진 찌 (제보된 모습)');
  assert.equal(bobberNear(7, 5, 5, 5), false, '두 칸');
  assert.equal(bobberNear(6, 6, 5, 5), false, '대각선');
  assert.equal(bobberNear(5, 5, 5, 5), false, '같은 칸');
});

test('던져 둔 채로 자리가 바뀌면 어떤 길로 바뀌었든 찌를 거둔다', () => {
  const { f, w, net, tick } = setup();
  assert.equal(f.cast(), true);
  assert.deepEqual(net.sets, ['5,5']);
  tick(4);
  assert.deepEqual(net.sets, ['5,5'], '제자리에서는 그대로 둔다');
  Object.assign(w.me, { x: 12, y: 5 }); // 걸음·밀림을 거치지 않고 자리만 바뀐 경우 (순간이동 등)
  tick();
  assert.equal(f.active, false);
  assert.deepEqual(net.sets, ['5,5', null]);
});

test('거둔 찌가 서버에 남아 있으면 다시 지운다 (다시 쓰기는 간격을 둔다)', () => {
  const { f, net, tick } = setup();
  f.cast();
  net.echo = false; // 이 뒤의 쓰기는 서버에 닿지 않는다
  f.cancel();
  assert.deepEqual(net.sets, ['5,5', null]);
  assert.equal(net.seen, '5,5', '서버에는 찌가 그대로 남았다');
  tick(2);
  assert.equal(net.sets.length, 2, '잠깐 어긋난 것은 기다린다');
  tick();
  assert.deepEqual(net.sets, ['5,5', null, null], '1초 넘게 어긋나 있으면 다시 지운다');
  tick(6);
  assert.equal(net.sets.length, 3, '바로 또 쓰지는 않는다');
  T += BOBBER_FIX_GAP_MS;
  tick(3);
  assert.equal(net.sets.length, 4, '간격이 지나면 다시 시도한다');
  net.echo = true; net.seen = null;
  tick(10);
  assert.equal(net.sets.length, 4, '맞춰진 뒤에는 쓰지 않는다');
});

test('재등록으로 서버의 찌가 빠지면 다시 올린다 (낚는 중인데 남에게 안 보이던 경우)', () => {
  const { f, net, tick } = setup();
  f.cast();
  net.seen = null; // 내 노드가 통째로 다시 쓰이며 찌가 빠졌다
  tick(3);
  assert.deepEqual(net.sets, ['5,5', '5,5']);
  f.cancel();
});

test('내 노드가 없는 동안에는 다시 쓰지 않는다', () => {
  const { f, net, tick } = setup();
  f.cast();
  net.seen = undefined; // 재등록 전
  tick(10);
  assert.deepEqual(net.sets, ['5,5']);
  f.cancel();
});

test('자동 낚시: 제자리에서는 찌를 다시 쓰지 않고, 밀려난 뒤에는 거둔다', () => {
  const { f, w, net, tick } = setup({ auto: true });
  tick(); // 물가에 서 있으니 알아서 던진다
  assert.deepEqual(net.sets, ['5,5']);
  tick(6);
  assert.deepEqual(net.sets, ['5,5']);
  Object.assign(w.me, { x: 7, y: 5 });
  tick();
  assert.deepEqual(net.sets, ['5,5', null]);
  tick(10);
  assert.deepEqual(net.sets, ['5,5', null], '물가가 아니면 다시 던지지 않는다');
});
