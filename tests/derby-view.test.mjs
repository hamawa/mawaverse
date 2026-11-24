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
    where: 'park', now: () => NOW, hours: () => HOURS, env: () => ENV, balance: () => 5000, raceCap: () => 100000,
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

// ---- 발매 연결 DerbyLive (가짜 DB·지갑. 실제 규칙·에뮬레이터 흐름은 tests/derby-e2e.test.mjs) ----
const U = 'LIVE_USER';
const T0 = D.cycleStart(N);
const CLOSE = T0 + D.DERBY_SALE_MS;
const liveRig = (over = {}) => {
  const st = { now: T0 + 10000, watch: new Map(), reads: [], data: {}, buys: [], settles: [], draws: [], reveals: [], toasts: [], next: 0, spent: 0, walletCbs: new Set(), drawWins: true };
  const wallet = {
    derbySpent: () => st.spent, derbyNextIndex: () => st.next,
    listen: (f) => { st.walletCbs.add(f); return () => st.walletCbs.delete(f); },
    buyDerby: async (n, lines, cap) => { st.buys.push({ n, lines, cap }); return st.buyResult(lines); },
    drawDerby: async (n) => { st.draws.push(n); return st.drawWins; },
    revealDerby: async (n) => { st.reveals.push(n); return null; },
    settleDerby: async (n) => { st.settles.push(n); return st.settleResult ?? { paid: 0, tickets: 0, pending: 0 }; },
  };
  const live = new V.DerbyLive({
    where: 'park', uid: U, now: () => st.now, hours: () => HOURS, env: () => ENV, cap: () => 100000,
    watch: (path, cb) => { st.watch.set(path, cb); return () => st.watch.delete(path); },
    read: async (path) => { st.reads.push(path); return st.data[path] ?? null; },
    wallet, toast: (m, e) => st.toasts.push([m, !!e]),
    ...over,
  });
  const fire = (path, v) => st.watch.get(path)(v);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { st, live, fire, flush };
};
const gateOfRank = (n, r) => D.derbyCard(n).runners.find((x) => x.rank === Number(r)).gate;
const rankOfGate = (n, g) => D.derbyCard(n).runners.find((x) => x.gate === g).rank;
const COVER = { s: N - 5, e: N + 5, v: 'x' };
const revealed = (n, digits, at) => ({ at, o: D.derbySecretEntry(n, digits), ...D.derbyResolve(n, digits).res });

test('발매 연결: 경주표·결과표 범위로 발매 중 → 마감 → 집계 중 → 추첨 → 확정. 구독은 결과표 범위와 지금 경주의 추첨·공개 칸뿐', () => {
  const { st, live, fire } = liveRig();
  live.tick(st.now);
  assert.deepEqual([...st.watch.keys()].sort(), ['race/cover', `race/x/${N}`]);
  assert.equal(live.sale(N).statusLabel, '발매 정보를 확인하는 중');
  fire('race/cover', null);
  assert.deepEqual([live.sale(N).status, live.sale(N).statusLabel, live.sale(N).sellable], ['nosale', '발매하지 않는 경주', false]);
  fire('race/cover', COVER);
  assert.deepEqual(live.sale(N), { status: 'selling', statusLabel: '발매 중', sellable: true, authEpoch: T0, closesInMs: D.DERBY_SALE_MS - 10000 });
  assert.equal(live.sale(N + 1).status, 'nosale');
  st.now = CLOSE + 1000;
  assert.deepEqual([live.sale(N).status, live.sale(N).sellable], ['closed', false]);
  st.now = T0 + D.DERBY_FINISH_MS;
  assert.deepEqual([live.sale(N).status, live.sale(N).statusLabel], ['settling', '결과 집계 중']);
  fire(`race/x/${N}`, { at: CLOSE + 500 });
  assert.deepEqual([live.sale(N).status, live.sale(N).statusLabel], ['settling', '결과 집계 중'], '추첨만 되고 공개 전');
  assert.equal(live.result(N), null);
  const x = revealed(N, '1234567', CLOSE + 500);
  fire(`race/x/${N}`, x);
  assert.deepEqual([live.sale(N).status, live.sale(N).statusLabel], ['done', '결과 확정']);
  assert.deepEqual(live.account(N).standings, [x.a, x.b, x.c].map((r) => gateOfRank(N, r)));
  const show = live.result(N);
  assert.deepEqual([...show.order].sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(show.order.slice(0, 3), live.account(N).standings);
  assert.equal(st.settles.length, 0); // 마권이 없으면 환급 쓰기를 하지 않는다
  st.now = T0 + D.DERBY_CYCLE_MS + 1000;
  live.tick(st.now);
  assert.deepEqual([...st.watch.keys()].sort(), ['race/cover', `race/x/${N + 1}`]);
  live.close();
  assert.equal(st.watch.size, 0);
  assert.equal(st.walletCbs.size, 0);
});

test('발매 연결: 결과표 범위 밖이거나 운영 시간 밖인 경주는 팔지 않는다', () => {
  const { st, live, fire } = liveRig();
  live.tick(st.now);
  fire('race/cover', { s: N + 1, e: N + 9 });
  assert.deepEqual([live.sale(N).status, live.sale(N).statusLabel], ['nosale', '발매하지 않는 경주']);
  const closed = liveRig({ hours: () => ({ on: false, d: HOURS.d }) });
  closed.live.tick(closed.st.now);
  closed.fire('race/cover', COVER);
  assert.equal(closed.live.sale(N).sellable, false);
  closed.st.now = CLOSE + 5000;
  assert.deepEqual([closed.live.sale(N).status, closed.live.sale(N).statusLabel], ['nosale', '발매하지 않은 경주']);
});

test('발매 연결: 결과표 범위는 s 이상 e 미만 (s · e−1 은 발매, s−1 · e 는 아님)', () => {
  for (const [cover, sold] of [[{ s: N, e: N + 3 }, true], [{ s: N - 3, e: N + 1 }, true], [{ s: N + 1, e: N + 4 }, false], [{ s: N - 3, e: N }, false]]) {
    const { st, live, fire } = liveRig();
    live.tick(st.now);
    fire('race/cover', cover);
    assert.equal(live.sale(N).sellable, sold, JSON.stringify(cover));
  }
});

test('추첨·공개: 공개가 안 되면(숨은 칸 없음) 간격을 늘려 가며 정해진 횟수만 해 보고 멈춘 뒤 판에 알린다', async () => {
  const { st, live, fire, flush } = liveRig();
  st.data[`race/t/${N}/${U}`] = { '00': { t: 'W', s1: '0', a: 100, od: D.raceOdds(N, 'W', 0) } };
  st.data[`race/u/${U}/${N}`] = { i: true, s: 100, c: 1 };
  st.next = 1; st.spent = 100;
  live.tick(st.now);
  fire('race/cover', COVER);
  fire(`race/x/${N}`, null);
  await flush();
  const at = [];
  for (let t = CLOSE + 1500; t < CLOSE + 15 * 60000; t += 1000) {
    st.now = t;
    const before = st.reveals.length;
    live.tick(t);
    if (st.draws.length === 1 && !live.result(N) && st.watch.has(`race/x/${N}`) && !at.length) fire(`race/x/${N}`, { at: CLOSE + 1500 }); // 내 추첨이 받아들여짐 (공개할 칸은 없음)
    await flush(); await flush();
    if (st.reveals.length > before) at.push(t);
  }
  assert.equal(st.draws.length, 1);
  assert.equal(at.length, V.REVEAL_MAX_TRIES, `${at.length} reveal attempts`);
  const gaps = at.slice(1).map((t, i) => t - at[i]);
  assert.deepEqual(gaps, [V.REVEAL_WAIT_MS, 10000, 20000, 40000], '추첨한 사람(나)의 공개 대기 뒤 5초부터 두 배씩');
  assert.deepEqual([live.sale(N).status, live.sale(N).statusLabel], ['settling', '결과를 공개하지 못했어요 · 다시 접속하면 다시 시도해요']);
  assert.ok(st.watch.has(`race/x/${N}`), '내 마권이 있으니 다른 사람의 공개는 계속 받는다');
});

test('쇼 결과: 1·2·3착과 일어난 일은 공개값을 따른다 (지금 결과 계산과 달라도)', () => {
  const digits = '4071935', cur = D.derbyResolve(N, digits);
  const gate = (r) => gateOfRank(N, r);
  const same = V.derbyShowResult(N, { at: CLOSE, digits, res: cur.res }, D.DERBY_SALE_MS);
  assert.deepEqual(same.order, cur.order.map(gate), '같으면 계산 그대로');
  const res = { a: cur.res.b, b: cur.res.a, c: cur.res.c, e: 'b' + cur.res.c };
  const show = V.derbyShowResult(N, { at: CLOSE, digits, res }, D.DERBY_SALE_MS);
  assert.deepEqual(show.order.slice(0, 3), [res.a, res.b, res.c].map(gate));
  assert.deepEqual([...show.order].sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(show.event, { gate: gate(res.c), kind: 'boost' });
  assert.equal(V.derbyShowResult(N, { at: CLOSE, digits, res: { ...res, e: 'n' } }, D.DERBY_SALE_MS).event, null);
});

test('추첨·공개: 마감 뒤 결과가 없으면 추첨하고, 내 추첨이 받아들여졌으면 바로 공개한다. 다른 사람이 추첨했으면 기다렸다가 공개한다', async () => {
  const { st, live, fire, flush } = liveRig();
  live.tick(st.now);
  fire('race/cover', COVER);
  fire(`race/x/${N}`, null);
  st.now = CLOSE - 1;
  live.tick(st.now);
  assert.deepEqual(st.draws, [], '마감 전에는 추첨하지 않는다');
  st.now = CLOSE + 1500;
  live.tick(st.now); live.tick(st.now);
  await flush(); await flush();
  assert.deepEqual([st.draws, st.reveals], [[N], [N]], '한 번 추첨하고 이겼으니 바로 공개');
  live.tick(st.now);
  assert.equal(st.draws.length, 1, '다시 해 보기 전 간격');

  const o = liveRig();
  o.live.tick(o.st.now);
  o.fire('race/cover', COVER);
  o.fire(`race/x/${N}`, { at: CLOSE + 200 });
  o.st.now = CLOSE + 2000;
  o.live.tick(o.st.now);
  await o.flush();
  assert.deepEqual([o.st.draws, o.st.reveals], [[], []], '다른 사람이 추첨했으면 그 사람의 공개를 기다린다');
  o.st.now = CLOSE + 200 + V.REVEAL_WAIT_MS;
  o.live.tick(o.st.now);
  await o.flush(); await o.flush();
  assert.deepEqual([o.st.draws, o.st.reveals], [[], [N]], '기다려도 없으면 내가 공개한다');

  const lost = liveRig();
  lost.st.drawWins = false;
  lost.live.tick(lost.st.now);
  lost.fire('race/cover', COVER);
  lost.fire(`race/x/${N}`, null);
  lost.st.now = CLOSE + 1500;
  lost.live.tick(lost.st.now);
  await lost.flush(); await lost.flush();
  assert.deepEqual([lost.st.draws, lost.st.reveals], [[N], []], '추첨을 놓치면 공개하지 않고 기다린다');

  const out = liveRig();
  out.live.tick(out.st.now);
  out.fire('race/cover', { s: N + 1, e: N + 9 });
  out.fire(`race/x/${N}`, null);
  out.st.now = CLOSE + 5000;
  out.live.tick(out.st.now);
  await out.flush();
  assert.deepEqual(out.st.draws, [], '결과표가 없는 경주는 추첨하지 않는다');
});

test('발매 연결 구매: 마번 → 인기 순위, 경주 확인, 장마다 결과와 사유, 산 뒤 내 마권을 한 번 읽는다', async () => {
  const { st, live, fire } = liveRig();
  st.buyResult = (lines) => lines.map((_, i) => (i === 0 ? { ok: true, n: N, nn: '00', a: 100, od: 31 } : { ok: false, why: 'cap' }));
  live.tick(st.now);
  fire('race/cover', COVER);
  const tickets = [
    { lineId: 'd1#1', key: 'W:3', kind: 'W', legs: [3], stake: 100 },
    { lineId: 'd1#2', key: 'Q:2-5', kind: 'Q', legs: [5, 2], stake: 200 },
  ];
  const req = { confirmId: 'c1', draftId: 'd1', where: 'park', seenN: N, seenAuth: T0, tickets };
  assert.ok((await live.submit({ ...req, where: 'branch' })).every((l) => !l.ok));
  assert.ok((await live.submit({ ...req, seenN: N + 1 })).every((l) => !l.ok));
  assert.equal(st.buys.length, 0);
  const out = await live.submit(req);
  assert.deepEqual(st.buys, [{ n: N, cap: 100000, lines: [
    { t: 'W', s1: rankOfGate(N, 3), s2: -1, a: 100 },
    { t: 'Q', s1: rankOfGate(N, 5), s2: rankOfGate(N, 2), a: 200 },
  ] }]);
  assert.deepEqual(out.map((l) => [l.lineId, l.ok, l.ticketKey]), [['d1#1', true, `${N}_00`], ['d1#2', false, '']]);
  assert.equal(out[1].error, '이 경주 구매 한도를 넘어요.');
  assert.deepEqual(st.reads.sort(), [`race/t/${N}/${U}`, `race/u/${U}/${N}`]);
  st.now = CLOSE;
  assert.ok((await live.submit(req)).every((l) => !l.ok));
  assert.equal(st.buys.length, 1);
});

test('발매 연결 환급: 결과가 공개되면 그 경주만 settleDerby(n), 마권 상태·적중금이 판에 실린다', async () => {
  const { st, live, fire, flush } = liveRig();
  const x = revealed(N, '0000000', CLOSE + 300);
  const od = (t, s1, s2 = -1) => D.raceOdds(N, t, Number(s1), s2);
  const loser = x.a === '7' ? '6' : '7';
  st.data[`race/t/${N}/${U}`] = { '00': { t: 'W', s1: x.a, a: 100, od: od('W', x.a) }, '01': { t: 'W', s1: loser, a: 100, od: od('W', loser) } };
  st.data[`race/u/${U}/${N}`] = { i: true, s: 200, c: 2 };
  st.next = 2; st.spent = 200;
  live.tick(st.now);
  fire('race/cover', COVER);
  await flush();
  assert.deepEqual(live.account(N).tickets.map((t) => t.status), ['sold', 'sold']);
  assert.equal(live.account(N).spent, 200);
  assert.equal(live.holds(N), true);
  st.now = CLOSE + 2000;
  fire(`race/x/${N}`, { at: x.at });
  await flush();
  assert.deepEqual(st.settles, [], '추첨만으로는 환급하지 않는다');
  st.settleResult = { paid: D.ticketPayout(100, od('W', x.a)), tickets: 2, pending: 0 };
  st.data[`race/u/${U}/${N}`] = { i: true, s: 200, c: 2, '00': true, '01': true };
  fire(`race/x/${N}`, x);
  fire(`race/x/${N}`, x); // 같은 값이 다시 와도 한 번만
  await flush(); await flush();
  assert.deepEqual(st.settles, [N]);
  const tk = live.account(N).tickets;
  assert.deepEqual(tk.map((t) => [t.status, t.legs[0]]), [['won', gateOfRank(N, x.a)], ['lost', gateOfRank(N, loser)]]);
  assert.equal(tk[0].payout, st.settleResult.paid);
  assert.ok(st.toasts.some(([m]) => m.includes('적중')));
});

test('판: 이번 경주에 내 마권이 있으면 마감 뒤에도 그 경주(결과·내 마권)를 보여 주고, 없으면 다음 경주로 넘어간다', () => {
  let now = T0 + D.DERBY_SALE_MS + 5000;
  const { view } = make({ now: () => now });
  let holds = false;
  view.attachLive({
    sale: () => ({ status: 'closed', statusLabel: '', sellable: false, authEpoch: 0, closesInMs: 0 }),
    account: () => null, submit: async () => [], listen: () => () => {}, holds: () => holds,
  });
  assert.equal(view.snapshot().head.n, N + 1);
  holds = true;
  view.changed();
  assert.equal(view.snapshot().head.n, N);
  now = T0 + D.DERBY_CYCLE_MS + 1000;
  assert.equal(view.snapshot().head.n, N + 1);
});

test('config: raceHours 정규화와 한도', () => {
  assert.equal(C.normalizeRaceHours(undefined), null);
  assert.equal(C.normalizeRaceHours('x'), null);
  assert.deepEqual(C.normalizeRaceHours({ on: true, d: { 1: slot } }), { on: true, d: { 1: slot } });
  assert.equal(C.normalizeRaceHours({ on: true, d: 5 }).d, null);
  assert.equal(C.raceHoursOf({ raceHours: { on: false } }).on, false);
  assert.equal(C.raceHoursOf({}), null);
  assert.equal(V.derbyRaceCap(50000, 'park'), 50000);
  assert.equal(V.derbyRaceCap(150, 'park'), D.DERBY_MAX_PARK);
  assert.equal(V.derbyRaceCap(undefined, 'park'), D.DERBY_MAX_PARK);
  assert.equal(V.derbyRaceCap(30000, 'branch'), 30000);
  assert.equal(V.derbyRaceCap(undefined, 'branch'), D.DERBY_MAX_BRANCH);
  assert.equal(V.derbyRaceCap(-100, 'branch'), D.DERBY_MAX_BRANCH);
});

test('분점 판: 분점 모드로 열고, 나가기는 호스트의 나가기로, 미니 중계는 지금 경주의 쇼 입력', async () => {
  const show = { n: N, ms: 1234, runners: [], result: null };
  let left = 0;
  const { view } = make({ where: 'branch', showInput: () => show, leaveBranch: async () => { left++; } });
  assert.equal(view.host.where, 'branch');
  assert.equal(view.snapshot().show, show);
  await view.host.leaveBranch();
  assert.equal(left, 1);
  const park = make().view;
  assert.equal(park.host.where, 'park');
  assert.equal(park.snapshot().show, null, '공원은 맵에 쇼를 그리므로 판에 넣지 않는다');
});

test('분점 발매: 분점 한도로 지갑에 사고(공원에서 산 금액과 합산은 지갑·규칙이 본다), 공원 판의 제출은 받지 않는다', async () => {
  const { st, live, fire } = liveRig({ where: 'branch', cap: () => D.DERBY_MAX_BRANCH });
  st.buyResult = (lines) => lines.map((_, i) => ({ ok: true, nn: String(i).padStart(2, '0') }));
  st.spent = 40000; // 공원에서 이미 산 금액 (race/u 장부·지갑 kt 는 공원·분점 합산)
  live.tick(st.now);
  fire('race/cover', COVER);
  const req = (where) => ({ confirmId: 'c', draftId: 'd', where, seenN: N, seenAuth: T0, tickets: [{ lineId: 'l1', key: 'W:1', kind: 'W', legs: [1], stake: 100 }] });
  assert.deepEqual((await live.submit(req('park'))).map((l) => [l.ok, l.error]), [[false, '이 창구에서는 살 수 없어요.']]);
  assert.equal(st.buys.length, 0);
  assert.equal((await live.submit(req('branch')))[0].ok, true);
  assert.deepEqual(st.buys.map((b) => b.cap), [D.DERBY_MAX_BRANCH]);
  assert.equal(live.account(N).spent, 40000, '남은 한도는 합산 금액 기준');
});
