// 겨울 눈싸움(스키 장갑) 시험: 상점 품목·장착 칸, 순수 상태(src/game/snowfight.ts), 말랑이 경로 위의 던지기·맞기(src/game/toss.ts), 규칙 생성기·규칙 파일의 구조.
// 실행: node --test tests/snowfight.test.mjs
// Firebase 는 가짜로 바꾼다. 보안 규칙이 실제로 쓰기를 막는지는 에뮬레이터(CLI)가 있어야 증명된다 — 이 파일의 규칙 시험은 문자열·구조 대조일 뿐 동작 증명이 아니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FB = (globalThis.__fb = { now: 1_800_000_000_000, updates: [] });
const stub = (src) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });
const STUBS = {
  'firebase/database': `
    const FB = globalThis.__fb;
    export const ref = (_db, path) => ({ path });
    export const serverTimestamp = () => '__ts';
    export const get = async () => ({ val: () => null });
    export const update = async (_r, map) => { FB.updates.push(map); };`,
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

test('모바일 상호작용은 이전 키보드 F 반복 상태를 지우고 단발 입력으로 전달한다', async () => {
  const { Input } = await import('../src/game/input.ts');
  const previous = globalThis.window;
  globalThis.window = { addEventListener() {} };
  try {
    const input = new Input();
    input.interactRepeat = true;
    const received = [];
    input.onAction = (action) => received.push([action, input.interactRepeat]);
    input.trigger('interact');
    assert.deepEqual(received, [['interact', false]]);
  } finally {
    globalThis.window = previous;
  }
});

// 시계와 타이머를 시험이 쥔다 (TossMgr 는 performance.now 와 window.setTimeout 을 쓴다)
let clock = 1000;
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true });
const timers = [];
globalThis.window = { setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } };
const fire = () => { while (timers.length) timers.shift().fn(); };

const shop = await import('../src/shared/shop.ts');
const { SKI_GLOVES, SKI_GLOVES_ID, SKI_GLOVES_EQ, TOGGLE_KEY, ARMOR_KEY, ALL_ITEMS, EQUIP_KEY, isOwnItem, priceOf, itemById, guardedOf, GUARD_BREAK_MS } = shop;
const sf = await import('../src/game/snowfight.ts');
const { snowfightAction, SnowfightState, snowGateAt, pickSnowTarget, planSnowThrow, snowStillThere, snowMsgValid, SNOW_RANGE, SNOW_PACK_HINT, SNOW_THROW_HINT } = sf;
const { TossMgr, TOSS_COOLDOWN_MS, TOSS_STUN_MS } = await import('../src/game/toss.ts');
const { buildWinterMap, buildDefaultMap, groundAt, G_SNOW, G_ICE } = await import('../src/game/map.ts');

const gate = (o = {}) => ({ winter: true, gloves: true, onSnow: true, busy: false, ...o });

// ---------- 상점 품목·장착 칸 ----------
test('스키 장갑: 영구 gear 품목 기본 2,000 코인, 보관함 품목, 전체 품목에 등록, 가격표로 바뀐다', () => {
  assert.equal(SKI_GLOVES_ID, 'skigloves');
  assert.equal(SKI_GLOVES.kind, 'gear'); assert.equal(SKI_GLOVES.price, 2000);
  assert.equal(itemById('skigloves'), SKI_GLOVES);
  assert.equal(ALL_ITEMS.filter((i) => i.id === 'skigloves').length, 1);
  assert.equal(isOwnItem('skigloves'), true);
  assert.equal(priceOf(SKI_GLOVES, null), 2000);
  assert.equal(priceOf(SKI_GLOVES, { skigloves: 3500 }), 3500);
  assert.ok(SKI_GLOVES.id.length <= 20); // 지갑 b 칸 길이 제한
});

test('장착 칸 sg: 다른 장착 칸과 겹치지 않고, 갑옷(presence 에 실리는 것)과 달리 장갑만 프로필 전용이다', () => {
  assert.equal(SKI_GLOVES_EQ, 'sg');
  assert.equal(TOGGLE_KEY.skigloves, 'sg');
  assert.equal(TOGGLE_KEY.pusharmor, 'pa'); assert.equal(TOGGLE_KEY.tossarmor, 'ta'); // 기존 갑옷 매핑 그대로
  assert.deepEqual(ARMOR_KEY, { pusharmor: 'pa', tossarmor: 'ta' });
  const taken = [...Object.values(EQUIP_KEY), 'pa', 'ta', 'nr'];
  assert.equal(taken.includes('sg'), false);
});

// ---------- 순수 상태 ----------
test('F 동작표: 겨울 맵·장갑·바쁘지 않음이 모두 맞아야 하고, 뭉치기는 눈 바닥에서만 던지기는 어디서나', () => {
  assert.equal(snowfightAction(false, gate()), 'pack');
  assert.equal(snowfightAction(true, gate()), 'throw');
  assert.equal(snowfightAction(false, gate({ onSnow: false })), null);          // 얼음 위에서는 못 뭉친다
  assert.equal(snowfightAction(true, gate({ onSnow: false })), 'throw');         // 하지만 던질 수는 있다
  for (const bad of [{ winter: false }, { gloves: false }, { busy: true }]) {
    assert.equal(snowfightAction(false, gate(bad)), null);
    assert.equal(snowfightAction(true, gate(bad)), null);
  }
  assert.equal(SNOW_PACK_HINT, 'F · 눈뭉치기'); assert.equal(SNOW_THROW_HINT, 'F · 눈덩이 던지기');
});

test('게이트: 겨울 맵의 눈/얼음 칸과 다른 맵을 가른다', () => {
  const w = buildWinterMap();
  const snow = { x: 20, y: 19 }, ice = { x: 30, y: 10 };
  assert.equal(groundAt(w, snow.x, snow.y), G_SNOW); assert.equal(groundAt(w, ice.x, ice.y), G_ICE);
  assert.equal(snowGateAt(w, 'winter', snow.x, snow.y, true, false).onSnow, true);
  assert.equal(snowGateAt(w, 'winter', ice.x, ice.y, true, false).onSnow, false);
  assert.equal(snowGateAt(buildDefaultMap(), 'main', 5, 5, true, false).winter, false);
  assert.equal(snowfightAction(false, snowGateAt(buildDefaultMap(), 'main', 5, 5, true, false)), null);
});

test('F 두 번: 첫 F 는 뭉치기, 다음 F 는 던지기. 키를 누르고 있어 반복된 F 는 뭉치기도 던지기도 못 한다', () => {
  const s = new SnowfightState();
  assert.equal(s.press(gate(), true), null);          // 반복 F 로는 뭉치지 않는다
  assert.equal(s.packed, false);
  assert.equal(s.press(gate(), false), 'pack');        // 신뢰된 첫 F
  assert.equal(s.packed, true);
  assert.equal(s.press(gate(), true), null);          // 같은 키를 계속 누르는 동안 던지지 않는다
  assert.equal(s.packed, true);
  assert.equal(s.press(gate(), false), 'throw');       // 다시 눌러야 던진다
  assert.equal(s.packed, true);                        // 실제로 던질 때까지(consume) 남아 있다: 쿨타임이면 그대로
  assert.equal(s.press(gate(), false), 'throw');
  s.consume();
  assert.equal(s.packed, false);
  assert.equal(s.press(gate(), false), 'pack');        // 던진 뒤에는 다시 뭉쳐야 한다
});

test('바쁜 동안의 F(이동 중·스턴·모달·맵 이동)는 아무것도 안 하고 뭉친 눈도 안 버린다. 장갑 해제·겨울 맵 이탈·초기화는 버린다', () => {
  const s = new SnowfightState();
  s.press(gate(), false);
  assert.equal(s.press(gate({ busy: true }), false), null);
  s.sync(gate({ busy: true }));
  assert.equal(s.packed, true);
  s.sync(gate({ gloves: false })); assert.equal(s.packed, false);       // 장갑을 뺐다
  s.press(gate(), false); s.sync(gate({ winter: false })); assert.equal(s.packed, false); // 겨울 맵이 아니다
  s.press(gate(), false); s.reset(); assert.equal(s.packed, false);     // 맵 이동·종료
  assert.equal(s.press(gate({ winter: false }), false), null);
  assert.equal(s.press(gate({ gloves: false }), false), null);
});

// ---------- 겨냥 ----------
const P = (uid, x, y, st = {}) => ({ uid, x, y, st });
const finder = (list) => (x, y) => list.find((p) => Math.round(p.x) === x && Math.round(p.y) === y) || null;

test('겨냥: 바라보는 방향 앞 4칸(frontTiles) 안 가장 가까운 사람, 카지노 안 사람은 제외, 뒤·범위 밖은 빗나감', () => {
  const me = { x: 10, y: 10, dir: 2 }; // 오른쪽
  assert.equal(SNOW_RANGE, 4);
  const near = P('near', 12, 10), far = P('far', 14, 10), behind = P('behind', 8, 10), out = P('out', 15, 10), seated = P('seated', 11, 10, { r: 'casino' });
  assert.equal(pickSnowTarget(me.x, me.y, me.dir, finder([far, near, behind]))?.uid, 'near');
  assert.equal(pickSnowTarget(me.x, me.y, me.dir, finder([far]))?.uid, 'far');        // 정확히 4칸
  assert.equal(pickSnowTarget(me.x, me.y, me.dir, finder([out, behind])), null);       // 5칸 밖·뒤쪽
  assert.equal(pickSnowTarget(me.x, me.y, me.dir, finder([seated, near]))?.uid, 'near'); // 보호된 사람은 건너뛰고 다음 사람
  assert.equal(pickSnowTarget(me.x, me.y, me.dir, finder([seated])), null);
  assert.equal(pickSnowTarget(me.x, me.y, 1, finder([near, far])), null);              // 왼쪽을 보면 오른쪽 사람은 안 맞는다
});

test('던지기 계획: 대상이 있으면 그 칸, 없으면 바라보는 쪽 4칸 앞으로 날아간다', () => {
  const t = planSnowThrow({ x: 10, y: 10, dir: 3 }, finder([P('a', 10, 8)]));
  assert.deepEqual([t.target.uid, t.tx, t.ty], ['a', 10, 8]);
  const miss = planSnowThrow({ x: 10, y: 10, dir: 3 }, finder([]));
  assert.deepEqual([miss.target, miss.tx, miss.ty], [null, 10, 6]);
  const moving = planSnowThrow({ x: 10, y: 10, dir: 0 }, finder([P('b', 10.4, 12.2)]));
  assert.deepEqual([moving.tx, moving.ty], [10, 12]); // 보간 좌표는 반올림한 칸을 겨냥
});

test('착지 판정과 받는 쪽 검사: 추적 없음, 겨울 맵끼리·범위 안에서만', () => {
  assert.equal(snowStillThere({ x: 5.2, y: 5.4 }, 5, 5), true);
  assert.equal(snowStillThere({ x: 6, y: 5 }, 5, 5), false);  // 옆으로 피했다
  assert.equal(snowStillThere(undefined, 5, 5), false);
  const m = { fx: 10, fy: 10, tx: 14, ty: 12 };
  assert.equal(snowMsgValid('winter', 'winter', m), true);
  assert.equal(snowMsgValid('main', 'winter', m), false);          // 나는 겨울 맵이 아니다
  assert.equal(snowMsgValid('winter', 'main', m), false);          // 던진 사람이 다른 맵
  assert.equal(snowMsgValid('winter', undefined, m), false);       // 던진 사람을 모른다
  assert.equal(snowMsgValid('winter', 'winter', { ...m, tx: 15 }), false); // 범위 밖 좌표
  assert.equal(snowMsgValid('winter', 'winter', { ...m, ty: 5 }), false);
});

// ---------- 말랑이 경로 위의 던지기·맞기 (TossMgr) ----------
function setup(over = {}) {
  const sent = [], spy = { bats: 0, breaks: [], cancel: 0, notes: [], toasts: [] };
  const w = {
    uid: 'me', mapId: 'winter', guardUntil: 0, snowBrokenAt: 0,
    profile: { nick: '나', eq: {}, own: {} },
    me: { x: 10, y: 10, dir: 2, hitAt: -1e9, blockAt: -1e9, stunUntil: 0, roomId: null },
    players: new Map(),
    wallet: { batsReady: () => { spy.bats++; return 9; } },
    toast: (m) => spy.toasts.push(m), note: (t) => spy.notes.push(t), batNote: () => {},
    nickOf: (u) => (u === 'me' ? '나' : w.players.get(u)?.st.n || u),
    playerAt: (x, y) => finder([...w.players.values()])(x, y),
    onMyMap: () => true, guardBroken: () => false, petGuard: () => false, petReflect: () => false,
    breakGuard: (n) => spy.breaks.push(n),
    ...over,
  };
  const net = { toss: (uid, m) => sent.push([uid, m]), tossMany: (shots) => sent.push(...shots.map((s) => [s.uid, s.m])), stat: () => {} };
  const mgr = new TossMgr(w, net, { cancelFishing: () => spy.cancel++ });
  const other = (uid, x, y, st = {}) => { const rp = { uid, x, y, st: { n: uid, m: 'winter', ...st }, hitAt: -1e9, blockAt: -1e9 }; w.players.set(uid, rp); return rp; };
  return { w, mgr, sent, spy, other };
}
const snowMsg = (o = {}) => ({ f: 'att', fx: 7, fy: 10, tx: 10, ty: 10, t: 1, s: 1, ...o });

test('던지기: 앞 사람에게 말랑이 경로로 s=1 을 보낸다 (b·r 없음, 빠따는 조회도 소모도 없다)', () => {
  const { w, mgr, sent, spy, other } = setup();
  const target = other('t1', 12, 10, { ta: true, pt: 'petturtle', pl: 99999999 }); // 방어 중인 사람
  clock = 5000;
  assert.equal(mgr.throwSnow(), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 't1');
  assert.deepEqual(sent[0][1], { f: 'me', fx: 10, fy: 10, tx: 12, ty: 10, s: 1 });
  assert.equal('b' in sent[0][1], false); assert.equal('r' in sent[0][1], false);
  assert.equal(spy.bats, 0);                                  // 빠따 개수를 보지도 않는다
  assert.equal(mgr.views(clock).length, 1);
  assert.equal(mgr.views(clock)[0].snow, true);
  fire();
  assert.equal(target.hitAt > -1e9, true);                      // 방어(ta·펫)와 무관하게 맞은 표시
  assert.equal(target.blockAt, -1e9);                           // 🛡 가 뜨지 않는다
  assert.deepEqual(spy.breaks, []);
  assert.equal(w.guardUntil, 0);
  assert.ok(sent.every(([, m]) => m.s === 1));
  assert.ok(w.profile.eq.ta === undefined);                     // 내 장비도 그대로
});

test('던지기: 대상이 움직여 그 칸을 떠나면 빗나가고(추적 없음), 맵을 옮기면 착지 판정을 버린다', () => {
  clock = 10_000;
  const a = setup(); const t = a.other('t', 12, 10);
  a.mgr.throwSnow();
  t.x = 12; t.y = 11;
  fire();
  assert.equal(t.hitAt, -1e9);
  assert.match(a.spy.notes.at(-1), /피했다/);
  clock = 20_000;
  const b = setup(); const t2 = b.other('t', 12, 10);
  b.mgr.throwSnow();
  b.mgr.clear();                                  // enterMap 이 부르는 것
  fire();
  assert.equal(t2.hitAt, -1e9); assert.deepEqual(b.spy.notes, []);
});

test('던지기: 아무도 없으면 눈덩이만 날아가고 DB 쓰기·알림·토스트가 없으며 쿨타임은 시작한다', () => {
  clock = 30_000;
  const { mgr, sent, spy } = setup();
  assert.equal(mgr.throwSnow(), true);
  assert.equal(sent.length, 0);
  assert.equal(mgr.views(clock).length, 1);
  fire();
  assert.deepEqual(spy.toasts, []); assert.deepEqual(spy.notes, []);
  assert.ok(mgr.cooldownLeft() > 0);
});

test('쿨타임: 실제로 던진 뒤 TOSS_COOLDOWN_MS 동안 다시 못 던지고(거부는 토스트 한 번), 지나면 던진다. 뭉치기는 쿨타임을 쓰지 않는다', () => {
  assert.equal(TOSS_COOLDOWN_MS, 3000);
  clock = 40_000;
  const { mgr, sent, spy, other } = setup();
  other('t', 12, 10);
  const s = new SnowfightState();
  assert.equal(s.press(gate(), false), 'pack');
  assert.equal(mgr.cooldownLeft(), 0);               // 뭉치기는 쿨타임을 시작하지 않는다
  assert.equal(mgr.throwSnow(), true); s.consume();
  s.press(gate(), false);                             // 다시 뭉치기는 쿨타임 중에도 된다
  clock += TOSS_COOLDOWN_MS - 1;
  assert.equal(mgr.throwSnow(), false);               // 쿨타임: 던지지 않고
  assert.equal(s.packed, true);                       // 뭉친 눈은 남는다 (호출한 쪽이 consume 하지 않음)
  assert.equal(sent.length, 1); assert.equal(spy.toasts.length, 1);
  clock += 1;
  assert.equal(mgr.throwSnow(), true);
  assert.equal(sent.length, 2);
});

test('말랑이와 쿨타임을 같이 쓴다: 눈덩이를 던진 직후 보통 말랑이도 쿨타임, 보통 말랑이의 동작은 그대로(빠따 조회)', () => {
  clock = 50_000;
  const { mgr, sent, spy, other } = setup();
  other('t', 12, 10, { ta: true });
  mgr.throwSnow();
  assert.equal(mgr.throwAt(), false);                 // 쿨타임
  clock += TOSS_COOLDOWN_MS;
  assert.equal(mgr.throwAt(), true);
  assert.equal(spy.bats >= 1, true);                  // 보통 말랑이는 방어 중인 상대에게 빠따를 배정한다
  assert.equal(sent.at(-1)[1].s, undefined);          // 보통 말랑이에는 눈덩이 표시가 없다
  assert.equal(sent.at(-1)[1].b, 1);
});

test('맞기: 눈덩이는 갑옷·펫 방어·되받아치기를 무시하고 말랑이와 같은 스턴, gb·방어 깨짐·장비 변화는 없다', () => {
  for (const guard of [{}, { eq: { ta: true } }, { petGuard: () => true, petReflect: () => true }, { guardBroken: () => false, eq: { ta: true }, petGuard: () => true }]) {
    clock = 60_000;
    const { w, mgr, sent, spy, other } = setup({ ...guard });
    if (guard.eq) w.profile.eq = { ...guard.eq };
    other('att', 7, 10);
    mgr.onHitMe(snowMsg());
    fire();
    assert.equal(w.me.stunUntil, clock + TOSS_STUN_MS);
    assert.equal(TOSS_STUN_MS, 1000);
    assert.equal(w.me.hitAt, clock);
    assert.equal(w.me.blockAt, -1e9);
    assert.equal(spy.cancel, 1);                         // 낚시 취소
    assert.deepEqual(spy.breaks, []);                    // 방어 깨짐 없음
    assert.equal(w.guardUntil, 0);
    assert.deepEqual(sent, []);                          // 되던지지 않는다
    assert.equal(spy.bats, 0);
    assert.deepEqual(w.profile.eq, guard.eq || {});      // 갑옷을 벗기지 않는다
  }
});

test('맞기: 보통 말랑이는 여전히 갑옷·펫 방어에 막히고, 빠따(b=1)는 방어를 깨며, 그 로직에 눈덩이가 끼지 않는다', () => {
  clock = 70_000;
  const armored = setup(); armored.w.profile.eq = { ta: true };
  armored.other('att', 7, 10);
  armored.mgr.onHitMe({ f: 'att', fx: 7, fy: 10, tx: 10, ty: 10, t: 1 });
  fire();
  assert.equal(armored.w.me.stunUntil, 0); assert.equal(armored.w.me.blockAt, clock); // 막힘
  const pet = setup({ petGuard: () => true });
  pet.other('att', 7, 10);
  pet.mgr.onHitMe({ f: 'att', fx: 7, fy: 10, tx: 10, ty: 10, t: 1 });
  fire();
  assert.equal(pet.w.me.stunUntil, 0);
  const bat = setup(); bat.w.profile.eq = { ta: true };
  bat.other('att', 7, 10);
  bat.mgr.onHitMe({ f: 'att', fx: 7, fy: 10, tx: 10, ty: 10, t: 1, b: 1 });
  fire();
  assert.equal(bat.spy.breaks.length, 1);               // 빠따만 방어를 깬다
});

test('맞기: 그 칸에 없으면 피함, 겨울 맵이 아니거나 던진 사람이 다른 맵·미확인이면 무시, 맵 이동은 착지를 취소', () => {
  clock = 80_000;
  const dodge = setup(); dodge.other('att', 7, 10);
  dodge.mgr.onHitMe(snowMsg({ tx: 11 }));               // 내 칸(10,10)이 아니다
  fire();
  assert.equal(dodge.w.me.stunUntil, 0); assert.match(dodge.spy.toasts.at(-1), /피했다/);
  const notWinter = setup({ mapId: 'main' }); notWinter.other('att', 7, 10);
  notWinter.mgr.onHitMe(snowMsg()); fire();
  assert.equal(notWinter.w.me.stunUntil, 0); assert.equal(notWinter.mgr.views(clock).length, 0);
  const elsewhere = setup(); elsewhere.other('att', 7, 10, { m: 'portal-garden' });
  elsewhere.mgr.onHitMe(snowMsg()); fire();
  assert.equal(elsewhere.w.me.stunUntil, 0);
  const unknown = setup();
  unknown.mgr.onHitMe(snowMsg()); fire();
  assert.equal(unknown.w.me.stunUntil, 0);
  const far = setup(); far.other('att', 2, 10);
  far.mgr.onHitMe(snowMsg({ fx: 2 })); fire();           // 범위 밖(8칸)
  assert.equal(far.w.me.stunUntil, 0);
  const gone = setup(); gone.other('att', 7, 10);
  gone.mgr.onHitMe(snowMsg()); gone.mgr.clear(); fire();
  assert.equal(gone.w.me.stunUntil, 0);
  const seated = setup(); seated.w.me.roomId = 'casino'; seated.other('att', 7, 10);
  seated.mgr.onHitMe(snowMsg()); fire();
  assert.equal(seated.w.me.stunUntil, 0);
});

test('남이 맞는 모습(onRemote): 눈덩이는 방어 중인 사람도 맞은 표시(🛡 없음), 그 칸을 떠났으면 표시 없음', () => {
  clock = 90_000;
  const { mgr, other } = setup();
  const t = other('v', 10, 12, { ta: true }); other('att', 7, 12);
  mgr.onRemote('v', snowMsg({ fy: 12, ty: 12, tx: 10, fx: 7 }));
  fire();
  assert.equal(t.hitAt > -1e9, true); assert.equal(t.blockAt, -1e9);
  const t2 = other('v2', 10, 14); other('att2', 7, 14);
  mgr.onRemote('v2', snowMsg({ f: 'att2', fx: 7, fy: 14, tx: 10, ty: 14 }));
  t2.x = 11;
  fire();
  assert.equal(t2.hitAt, -1e9);
  mgr.onRemote('v', snowMsg({ f: 'me' }));               // 내가 던진 건 이미 그렸으므로 무시
  assert.equal(timers.length, 0);
});

// ---------- 규칙 생성기·규칙 파일 (구조 대조: 동작 증명 아님) ----------
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rulesJson = () => JSON.parse(readFileSync(join(ROOT, 'database.rules.json'), 'utf8')).rules;

test('규칙 구조: eq.sg 는 skigloves 보유가 있어야 켜진다, 존재하지 않는 이름 칸은 계속 거부', () => {
  const eq = rulesJson().users.$uid.eq;
  assert.match(eq.sg['.validate'], /newData\.isBoolean\(\)/);
  assert.match(eq.sg['.validate'], /own\/skigloves'\)\.val\(\) === true/);
  assert.equal(eq.$other['.validate'], false);
  assert.equal('sg' in rulesJson().players.$uid, false); // presence 에는 싣지 않는다
});

test('규칙 구조: toss s=1 은 b·r 없이 장갑 보유·착용한 겨울 맵의 보낸 사람 + 겨울 맵 대상 + 범위 4 안에서만', () => {
  const v = rulesJson().players.$uid.toss['.validate'];
  const clause = v.slice(v.indexOf("!newData.hasChild('s')"));
  for (const part of ["newData.child('s').val() == 1", "!newData.hasChild('b')", "!newData.hasChild('r')", "users/' + auth.uid + '/eq/sg').val() === true", "users/' + auth.uid + '/own/skigloves').val() === true",
    "players/' + auth.uid + '/m').val() == 'winter'", "newData.parent().child('m').val() == 'winter'"]) assert.ok(clause.includes(part), part);
  assert.equal((clause.match(/<= 4/g) || []).length, 4);            // 좌표 4개 방향 모두 범위 4
  assert.match(v, /newData\.child\('b'\)\.val\(\) == 1 && newData\.parent\(\)\.parent\(\)\.parent\(\)\.child\('wallet\/' \+ auth\.uid \+ '\/bt'\)/); // 기존 빠따 조건 그대로
  let d = 0; for (const c of v) { if (c === '(') d++; if (c === ')') d--; assert.ok(d >= 0); } assert.equal(d, 0);
});

test('생성기: gen-rules.cjs final 이 만든 eq 규칙이 database.rules.json 과 같다 (생성기에도 sg 가 들어 있다)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'snowfight-rules-'));
  mkdirSync(join(dir, 'tools'));
  copyFileSync(join(ROOT, 'tools', 'gen-rules.cjs'), join(dir, 'tools', 'gen-rules.cjs'));
  copyFileSync(join(ROOT, 'database.rules.json'), join(dir, 'database.rules.json'));
  execFileSync(process.execPath, [join(dir, 'tools', 'gen-rules.cjs'), 'final'], { stdio: 'pipe' });
  const generated = JSON.parse(readFileSync(join(dir, 'database.rules.json'), 'utf8')).rules;
  assert.deepEqual(generated.users.$uid.eq, rulesJson().users.$uid.eq);
  assert.ok('sg' in generated.users.$uid.eq);
  assert.deepEqual(generated.wallet, rulesJson().wallet);            // 지갑 규칙은 그대로
  assert.deepEqual(generated.players.$uid.toss, rulesJson().players.$uid.toss);
});
