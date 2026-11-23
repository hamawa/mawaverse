import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// derby-ui.test.mjs 와 같은 갈고리: .ts 는 transform 모드로 읽고 derbyui.css 만 빈 모듈로 받는다
const stub = (src) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.endsWith('/derbyui.css')) return stub('export default {};');
    try {
      return next(spec, ctx);
    } catch (e) {
      if (spec.startsWith('.') && !/\.[cm]?[jt]s$/.test(spec)) {
        try { return next(`${spec}.ts`, ctx); } catch { return next(`${spec}/index.ts`, ctx); }
      }
      throw e;
    }
  },
  load(url, ctx, next) {
    if (!url.startsWith('file:') || !url.endsWith('.ts')) return next(url, ctx);
    return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
  },
});

const V = await import('../src/game/derbyview.ts');
const D = await import('../src/shared/derby.ts');
const C = await import('../src/shared/config.ts');

// 2026-11-23(월) 12:01 KST. 운영 시간은 매일 10:00~24:00
const NOW = Date.parse('2026-11-23T12:01:00+09:00');
const N = D.raceNo(NOW);
const slot = { s: 600, e: 1440 };
const HOURS = { on: true, d: { 0: slot, 1: slot, 2: slot, 3: slot, 4: slot, 5: slot, 6: slot, 7: slot } };
const ENV = { holidays: {}, hoursBlock: false };

const make = (over = {}) => {
  const log = { toasts: [], fields: new Map() };
  const deps = {
    now: () => NOW, hours: () => HOURS, env: () => ENV, balance: () => 5000, raceCap: () => 100000,
    hasField: (n) => log.fields.has(n), setField: (s) => log.fields.set(s.n, s),
    toast: (m, e) => log.toasts.push([m, !!e]),
    ...over,
  };
  return { view: new V.DerbyView(deps), log };
};

test('쇼 출전표: 진짜 코어 출전표와 같고 결과는 null', () => {
  const s = V.derbyFieldSnapshot(N);
  const card = D.derbyCard(N);
  assert.equal(s.n, N);
  assert.equal(s.result, null);
  assert.equal(s.distance, card.distance);
  assert.deepEqual(s.runners.map((r) => r.gate), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const r of s.runners) {
    const c = card.runners.find((x) => x.gate === r.gate);
    assert.equal(r.name, c.horse.name);
    assert.equal(r.jockey, c.jockey.name);
    assert.equal(r.style, c.horse.style);
    assert.equal(r.behavior, c.behavior);
    assert.deepEqual(r.silk, [c.jockey.silk.body, c.jockey.silk.sleeve]);
    assert.match(r.coat, /^#[0-9a-f]{6}$/);
    assert.equal(s.winOdds[r.gate], D.raceOdds(N, 'W', c.rank) / 10);
  }
  assert.deepEqual(V.derbyFieldSnapshot(N), s); // 결정적
});

test('견적: 마번을 순위로 바꿔 고정 배당표에서 읽는다', () => {
  const card = D.derbyCard(N);
  const rk = (g) => card.runners.find((r) => r.gate === g).rank;
  const [w] = V.derbyQuote(N, 'W', [[3]], 100);
  assert.equal(w.key, 'W:3');
  assert.equal(w.odds, D.raceOdds(N, 'W', rk(3)) / 10);
  assert.equal(w.est, D.ticketPayout(100, D.raceOdds(N, 'W', rk(3))));
  const [e12, e21] = V.derbyQuote(N, 'E', [[1, 2], [2, 1]], 200);
  assert.equal(e12.odds, D.raceOdds(N, 'E', rk(1), rk(2)) / 10);
  assert.equal(e21.odds, D.raceOdds(N, 'E', rk(2), rk(1)) / 10);
  const [q] = V.derbyQuote(N, 'Q', [[5, 3]], 100);
  assert.equal(q.key, 'Q:3-5');
  assert.equal(q.odds, D.raceOdds(N, 'Q', rk(3), rk(5)) / 10);
  // 잘못된 조합·금액은 견적 없음
  const bad = V.derbyQuote(N, 'Q', [[3, 3], [9, 1], [1]], 100);
  assert.deepEqual(bad.map((b) => [b.odds, b.est]), [[null, null], [null, null], [null, null]]);
  assert.equal(V.derbyQuote(N, 'W', [[2]], 150)[0].est, null);
});

test('판 스냅샷: 운영 시간 안이어도 발매 중이 아니다(보기 전용)', () => {
  const s = V.derbyPanelSnapshot({ nowMs: NOW, viewN: N, hours: HOURS, env: ENV, balance: 5000, raceCap: 100000, v: 1 });
  assert.equal(s.head.n, N);
  assert.equal(s.head.status, 'nosale');
  assert.equal(s.head.sellable, false);
  assert.equal(s.head.closesInMs, 0);
  assert.equal(s.closed, false);
  assert.match(s.head.label, /보기 전용/);
  assert.match(s.head.statusLabel, /발매 연결 전/);
  assert.equal(s.card.length, 8);
  assert.ok(s.card.every((h) => h.sex && h.age > 0 && h.winOdds >= 1 && h.placeOdds >= 1));
  assert.equal(s.standings, null);
  assert.equal(s.nextN, N); // 지금 발매 시간 안
  assert.ok(s.schedule.length >= 2 && s.schedule[0].n === N);
  assert.equal(s.schedule[0].timeLabel, '12:00');
  assert.ok(s.schedule.every((i) => i.status === 'nosale'));
  assert.equal(s.balance, 5000);
  assert.equal(s.raceRemain, 100000);
  assert.deepEqual(s.tickets, []);
});

test('판 스냅샷: 단승·연승·복승·쌍승·복연승 배당과 NPC 매출이 코어 식과 맞는다', () => {
  const s = V.derbyPanelSnapshot({ nowMs: NOW, viewN: N, hours: HOURS, env: ENV, balance: 0, raceCap: 100000, v: 1 });
  const card = D.derbyCard(N);
  const sizes = { W: 8, P: 8, Q: 28, E: 56, R: 28 };
  const pools = D.derbyPools(N, D.saleProgress(D.cycleStart(N) + V.saleBucket(NOW, N) * 30000));
  for (const t of D.DERBY_BET_TYPES) {
    const cells = Object.entries(s.odds[t]);
    assert.equal(cells.length, sizes[t]);
    for (const [, c] of cells) {
      assert.equal(D.poolOddsX10(pools[t].total, c.pool, t), Math.round(c.odds * 10));
    }
  }
  const h = s.card[0];
  const r = card.runners.find((x) => x.gate === h.gate);
  assert.equal(h.sales, pools.W.cells[`${r.rank}`]);
});

test('휴장: 설정이 없거나 꺼져 있으면 닫힘, 다음 예정은 비어 있다', () => {
  for (const hours of [null, { on: false, d: HOURS.d }, { on: true, d: {} }]) {
    const s = V.derbyPanelSnapshot({ nowMs: NOW, viewN: V.derbyViewRace(NOW, hours, ENV, null), hours, env: ENV, balance: 0, raceCap: 100000, v: 1 });
    assert.equal(s.closed, true);
    assert.equal(s.head.sellable, false);
    assert.equal(s.head.n, N); // 달력의 지금 경주(쇼가 보여 주는 말)
    assert.equal(s.nextN, null);
    assert.match(s.head.statusLabel, /휴장/);
    assert.equal(s.card.length, 8); // 휴장이어도 출마표는 보인다
  }
});

test('휴장이면 다음 예정 경주와 요일·시각을 안내한다', () => {
  const tonight = { on: true, d: { 1: { s: 1200, e: 1440 } } }; // 월요일 20:00~
  const s = V.derbyPanelSnapshot({ nowMs: NOW, viewN: V.derbyViewRace(NOW, tonight, ENV, null), hours: tonight, env: ENV, balance: 0, raceCap: 100000, v: 1 });
  assert.equal(s.closed, true);
  assert.ok(s.nextN > N);
  assert.equal(s.schedule.find((i) => i.n === s.nextN).timeLabel, '20:00');
  assert.match(s.head.statusLabel, /다음 경주 월요일 20:00/);
});

test('hoursBlock 이 켜져 있으면 차단 시간(평일 09~18시)은 건너뛴다', () => {
  const env = { holidays: {}, hoursBlock: true, breaks: [] };
  const all = { on: true, d: { 1: { s: 540, e: 1440 } } };
  assert.equal(D.raceScheduled(N, all, env), false); // 12:00 평일 차단 시간
  assert.equal(V.derbyPanelSnapshot({ nowMs: NOW, viewN: N, hours: all, env, balance: 0, raceCap: 1, v: 1 }).closed, true);
});

test('컨트롤러: 쇼 출전표는 이번·다음 경주만 채우고 이미 있는 것은 덮지 않는다', () => {
  const { view, log } = make();
  const mine = { n: N + 1, distance: 1000, runners: [], result: { order: [1, 2, 3, 4, 5, 6, 7, 8], event: null, spliceMs: 0 } };
  log.fields.set(N + 1, mine); // 나중 컨트롤러가 먼저 넣은 결과 포함 스냅샷
  view.sync();
  assert.deepEqual([...log.fields.keys()].sort(), [N, N + 1]);
  assert.equal(log.fields.get(N + 1), mine);
  assert.equal(log.fields.get(N).result, null);
});

test('컨트롤러: 제출은 아무것도 수락하지 않고 쓰기도 없다', async () => {
  const { view, log } = make();
  const res = await view.host.submit({ confirmId: 'c1', draftId: 'd1', where: 'park', seenN: N, seenAuth: 0, tickets: [{ lineId: 'd1#1', key: 'W:1', kind: 'W', legs: [1], stake: 100 }] });
  assert.deepEqual(res, []);
  assert.equal(log.toasts.length, 1);
  assert.equal(log.toasts[0][1], true);
  assert.equal(view.snapshot().head.sellable, false);
});

test('컨트롤러: 판 스냅샷은 바뀔 때만 새 버전, 경주 고르기는 범위 안에서만', () => {
  let now = NOW;
  const { view, log } = make({ now: () => now });
  const a = view.snapshot();
  assert.equal(view.snapshot(), a); // 같은 값이면 같은 객체
  let pings = 0;
  const off = view.host.listen(() => { pings++; });
  now = NOW + 31000; // 30초 단계가 바뀐다
  view.sync();
  assert.equal(pings, 1);
  const b = view.snapshot();
  assert.ok(b.v > a.v);
  view.host.selectRace(N - 5); // 지난 경주
  assert.equal(log.toasts.length, 1);
  assert.equal(view.snapshot().head.n, N);
  view.host.selectRace(N + 3);
  assert.equal(view.snapshot().head.n, N + 3);
  assert.equal(view.host.quote('W', [[1]], 100)[0].odds, D.raceOdds(N + 3, 'W', D.derbyCard(N + 3).runners.find((r) => r.gate === 1).rank) / 10);
  off();
  view.dispose();
  view.sync();
  assert.equal(pings >= 1, true);
});

test('컨트롤러: 설정이 바뀌면(휴장 → 운영) 알려 준다', () => {
  let hours = null;
  const { view } = make({ hours: () => hours });
  assert.equal(view.snapshot().closed, true);
  let pings = 0;
  view.host.listen(() => { pings++; });
  hours = HOURS;
  view.changed();
  assert.equal(pings, 1);
  assert.equal(view.snapshot().closed, false);
});

test('컨트롤러를 닫으면 말 정보 창도 닫히고 이전 버튼은 경주 선택을 바꾸지 않는다', () => {
  const { view } = make();
  let pick;
  let closed = 0;
  view.showRunnerCard(N + 1, 1, (onPick, onClose) => {
    pick = onPick;
    return { close: () => { closed++; onClose(); } };
  });
  view.dispose();
  assert.equal(closed, 1);
  pick();
  assert.equal(view.snapshot().head.n, N);
  assert.equal(view.open, false);
});

test('발매 연결 이음매: 꽂으면 그 값이 판에 실리고 떼면 다시 보기 전용', async () => {
  const { view } = make();
  let cb = () => {};
  const live = {
    sale: () => ({ status: 'selling', statusLabel: '', sellable: true, authEpoch: 3, closesInMs: 60000 }),
    account: () => ({ spent: 300, ticketUsed: 2, tickets: [], standings: null }),
    submit: async () => [{ lineId: 'x', key: 'W:1', ok: true, ticketKey: `${N}_00`, error: '' }],
    listen: (f) => { cb = f; return () => { cb = () => {}; }; },
  };
  view.attachLive(live);
  const s = view.snapshot();
  assert.equal(s.head.sellable, true);
  assert.equal(s.head.authEpoch, 3);
  assert.equal(s.raceRemain, 99700);
  assert.equal((await view.host.submit({})).length, 1);
  view.attachLive(null);
  assert.equal(view.snapshot().head.sellable, false);
  assert.deepEqual(await view.host.submit({}), []);
});

test('config: raceHours 정규화와 한도', () => {
  assert.equal(C.normalizeRaceHours(undefined), null);
  assert.equal(C.normalizeRaceHours('x'), null);
  assert.deepEqual(C.normalizeRaceHours({ on: true, d: { 1: slot } }), { on: true, d: { 1: slot } });
  assert.equal(C.normalizeRaceHours({ on: true, d: 5 }).d, null);
  assert.equal(C.raceHoursOf({ raceHours: { on: false } }).on, false);
  assert.equal(C.raceHoursOf({}), null);
  assert.equal(V.derbyParkCap(50000), 50000);
  assert.equal(V.derbyParkCap(150), D.DERBY_MAX_PARK);
  assert.equal(V.derbyParkCap(undefined), D.DERBY_MAX_PARK);
});
