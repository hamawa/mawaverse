// 경마공원 공용 계산 시험 (src/shared/derby.ts). 실행: node --test tests/derby-core.test.mjs
// 결정성, 착순표가 모든 조합을 덮는지, 배당 = 칸 수에서 93%·0.1 버림·최저 1.0, 몸짓 효과(SPEC 표), 기대 환급 100% 미만, NPC 매출 → 배당 재현,
// 결과 계산(기세·부진·안정), 운영 시간 경계를 본다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
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
const { parseBreaks } = await import('../src/shared/hours.ts');
const BREAKS = parseBreaks(JSON.parse(readFileSync(new URL('../hours.json', import.meta.url), 'utf8')).breaks);

const kst = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi) - 9 * 3600000;
const TYPES = ['W', 'P', 'Q', 'E', 'R'];
// 착순표 칸을 직접 세어 (코드의 칸 수 배열과 따로) 조합별 맞는 칸 수
function countEntries(p) {
  const c = { W: {}, P: {}, Q: {}, E: {}, R: {} };
  const add = (t, k) => { c[t][k] = (c[t][k] ?? 0) + 1; };
  for (let i = 0; i < 10000; i++) {
    const [a, b, x] = D.derbyBaseEntry(p, i);
    add('W', a); for (const s of [a, b, x]) add('P', s);
    add('E', a + b); add('Q', a < b ? a + b : b + a);
    for (const [u, v] of [[a, b], [a, x], [b, x]]) add('R', u < v ? u + v : v + u);
  }
  return c;
}

test('시간표: 단계 경계와 경주 번호', () => {
  assert.equal(D.DERBY_CYCLE_MS, 360000);
  const at = (t) => D.derbyPhase(D.cycleStart(1000) + t).phase;
  assert.equal(at(0), 'paddock'); assert.equal(at(99999), 'paddock');
  assert.equal(at(100000), 'mount'); assert.equal(at(130000), 'parade'); assert.equal(at(160000), 'warmup');
  assert.equal(at(200000), 'gate'); assert.equal(at(240000), 'race'); assert.equal(at(280000), 'ceremony');
  assert.equal(at(320000), 'payout'); assert.equal(at(359999), 'payout');
  assert.equal(D.raceNo(D.cycleStart(77) + 359999), 77);
  assert.equal(D.raceNo(D.cycleStart(78)), 78);
  assert.equal(D.saleProgress(D.cycleStart(5) + 120000), 0.5);
  assert.equal(D.saleProgress(D.cycleStart(5) + 300000), 1);
});

test('운영 시간: 설정 없음·임시 휴장·형식 오류는 휴장', () => {
  const n = D.raceNo(kst(2026, 11, 25, 19, 0)), env = { holidays: {} };
  assert.equal(D.raceScheduled(n, null, env), false);
  assert.equal(D.raceScheduled(n, { on: true }, env), false);
  assert.equal(D.raceScheduled(n, { on: false, d: { 3: { s: 1140, e: 1380 } } }, env), false);
  assert.equal(D.raceScheduled(n, { on: true, d: { 3: { s: 1145, e: 1380 } } }, env), false, '10분 단위가 아니면 휴장');
  assert.equal(D.raceScheduled(n, { on: true, d: { 3: { s: 1380, e: 1140 } } }, env), false);
  assert.equal(D.derbyStatusText(kst(2026, 11, 25, 19, 0), null, env), '휴장');
  assert.equal(D.derbyStatusText(kst(2026, 11, 25, 19, 0), { on: false, d: { 3: { s: 1140, e: 1380 } } }, env), '임시 휴장');
});

test('운영 시간: 첫 경주 19:00, 마지막 22:54 (발매 4분이 23:00 안)', () => {
  const cfg = { on: true, d: { 3: { s: 1140, e: 1380 } } }, env = { holidays: {} };   // 2026-11-25 수요일
  const ok = (h, mi) => D.raceScheduled(D.raceNo(kst(2026, 11, 25, h, mi)), cfg, env);
  assert.equal(ok(18, 54), false); assert.equal(ok(19, 0), true);
  assert.equal(ok(22, 54), true); assert.equal(ok(23, 0), false);
  assert.equal(D.raceScheduled(D.raceNo(kst(2026, 11, 26, 19, 0)), cfg, env), false, '목요일 칸은 없다');
  // 배열 모양(RTDB 가 숫자 열쇠를 배열로 돌려줄 때)도 같다
  assert.equal(D.raceScheduled(D.raceNo(kst(2026, 11, 25, 19, 0)), { on: true, d: [null, null, null, { s: 1140, e: 1380 }] }, env), true);
  // 마감 뒤에는 다음 경주로, 마지막 뒤에는 다음 주 수요일
  assert.equal(D.nextScheduledRace(kst(2026, 11, 25, 19, 4), cfg, env), D.raceNo(kst(2026, 11, 25, 19, 6)));
  assert.equal(D.nextScheduledRace(kst(2026, 11, 25, 19, 2), cfg, env), D.raceNo(kst(2026, 11, 25, 19, 0)));
  assert.equal(D.nextScheduledRace(kst(2026, 11, 25, 22, 58), cfg, env), D.raceNo(kst(2026, 12, 2, 19, 0)));
  assert.equal(D.derbyStatusText(kst(2026, 11, 25, 23, 10), cfg, env), '휴장 · 다음 경주 수요일 19:00');
  assert.equal(D.derbyStatusText(kst(2026, 11, 25, 19, 1), cfg, env), '발매 중 · 19:04 마감');
  assert.equal(D.derbyStatusText(kst(2026, 11, 25, 19, 5), cfg, env), '경주 진행 중');
  assert.equal(D.raceSaleOpen(kst(2026, 11, 25, 19, 3), cfg, env), true);
  assert.equal(D.raceSaleOpen(kst(2026, 11, 25, 19, 4), cfg, env), false);
});

test('운영 시간: 공휴일은 7번 칸, 자정까지(1440)', () => {
  const env = { holidays: { '2026-11-25': '시험 공휴일' } };
  const n = D.raceNo(kst(2026, 11, 25, 19, 0));
  assert.equal(D.raceScheduled(n, { on: true, d: { 3: { s: 1140, e: 1380 } } }, env), false);
  assert.equal(D.raceScheduled(n, { on: true, d: { 7: { s: 1140, e: 1380 } } }, env), true);
  const late = { on: true, d: { 7: { s: 1380, e: 1440 } } };
  assert.equal(D.raceScheduled(D.raceNo(kst(2026, 11, 25, 23, 54)), late, env), true);
  assert.equal(D.raceScheduled(D.raceNo(kst(2026, 11, 26, 0, 0)), late, env), false, '다음 날은 공휴일이 아니다');
  assert.equal(D.derbyStatusText(kst(2026, 11, 24, 12, 0), late, env), '휴장 · 다음 경주 수요일 23:00');
});

test('운영 시간: 이용 시간 차단이 켜지면 평일 09~18 은 쉬는 시간에만', () => {
  const cfg = { on: true, d: { 3: { s: 0, e: 1440 } } };
  const on = { holidays: {}, hoursBlock: true, breaks: BREAKS }, off = { holidays: {}, hoursBlock: false, breaks: BREAKS };
  const ok = (env, h, mi) => D.raceScheduled(D.raceNo(kst(2026, 11, 25, h, mi)), cfg, env);
  assert.equal(ok(on, 8, 54), true); assert.equal(ok(on, 9, 0), false);
  assert.equal(ok(on, 10, 30), true); assert.equal(ok(on, 10, 42), false, '10:45 에 차단이 다시 시작된다');
  assert.equal(ok(on, 12, 54), true); assert.equal(ok(on, 13, 0), false);
  assert.equal(ok(on, 17, 54), false); assert.equal(ok(on, 18, 0), true);
  assert.equal(ok(off, 9, 0), true);
  // 주말·공휴일은 차단 없음
  assert.equal(D.raceScheduled(D.raceNo(kst(2026, 11, 25, 9, 0)), cfg, { ...on, holidays: { '2026-11-25': 'x' } }), false, '공휴일 칸(7)이 없다');
  assert.equal(D.raceScheduled(D.raceNo(kst(2026, 11, 25, 9, 0)), { on: true, d: { 7: { s: 0, e: 1440 } } }, { ...on, holidays: { '2026-11-25': 'x' } }), true);
  assert.equal(D.raceScheduled(D.raceNo(kst(2026, 11, 28, 9, 0)), { on: true, d: { 6: { s: 0, e: 1440 } } }, on), true);
});

test('말: 매주 4두 데뷔, 4~8주 현역, 현역 약 24두, 이름 겹침·금칙어 없음', () => {
  const w0 = D.derbyWeek(kst(2026, 11, 23, 0, 0));
  assert.equal(D.derbyWeek(kst(2026, 11, 22, 23, 59)), w0 - 1, '주는 한국 시간 월요일에 바뀐다');
  assert.equal(D.derbyWeekStart(w0), kst(2026, 11, 23, 0, 0));
  let total = 0;
  for (let w = w0; w < w0 + 100; w++) {
    const r = D.derbyRoster(w);
    total += r.length;
    assert.ok(r.length >= 16 && r.length <= 32);
    assert.equal(new Set(r.map((h) => h.id)).size, r.length);
    assert.equal(new Set(r.map((h) => h.name)).size, r.length, `${w} 주 이름 겹침`);
    for (const h of r) {
      assert.ok(h.career >= 4 && h.career <= 8 && h.debut <= w && h.retire > w);
      assert.ok(!D.DERBY_NAME_BLOCKLIST.includes(h.name));
      assert.deepEqual(D.derbyHorseById(h.id), h);
    }
    for (const h of D.derbyRetirements(w)) {
      assert.equal(h.retire, w);
      assert.ok(D.derbyRoster(w - 1).some((x) => x.id === h.id) && !r.some((x) => x.id === h.id));
    }
    assert.deepEqual(D.derbyDebuts(w).map((h) => h.id), r.filter((h) => h.debut === w).map((h) => h.id));
  }
  assert.ok(total / 100 > 21 && total / 100 < 27, `평균 현역 ${total / 100}`);
  assert.equal(D.DERBY_JOCKEYS.length, 10);
  assert.equal(D.derbyHorseById('x1_2'), null);
});

test('출마표: 8두·마번·인기 순위·레이팅 벌어짐이 프로필과 같다', () => {
  for (let n = 4_900_000; n < 4_900_200; n++) {
    const c = D.derbyCard(n), sc = D.derbyScenarioFor(n), w = D.DERBY_PROFILES[c.p].w;
    assert.equal(c.p, sc.p);
    assert.deepEqual(c.runners.map((r) => r.gate), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual([...c.runners.map((r) => r.rank)].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.equal(new Set(c.runners.map((r) => r.horse.id)).size, 8);
    assert.equal(new Set(c.runners.map((r) => r.jockey.id)).size, 8);
    const roster = D.derbyRosterAt(D.cycleStart(n)).map((h) => h.id);
    assert.ok(c.runners.every((r) => roster.includes(r.horse.id)));
    assert.ok(D.DERBY_DISTANCES.includes(c.distance));
    const byRank = c.gateOfRank.map((g) => c.runners[g - 1]);
    byRank.forEach((r, i) => {
      assert.equal(r.rank, i);
      if (i) assert.ok(r.rating < byRank[i - 1].rating);
      if (i) assert.ok(Math.abs((byRank[i - 1].rating - r.rating) - 20 * Math.log(w[i - 1] / w[i])) < 0.11);
      assert.ok(Math.abs(r.rating - r.raw - r.cond) < 0.051);
      assert.equal(r.behavior, sc.horses.find((x) => x.r === i)?.k ?? null);
    });
  }
});

test('결정성: 같은 입력이면 같은 말·시나리오·결과', () => {
  assert.deepEqual(D.derbyHorse(3000, 2), D.derbyHorse(3000, 2));
  assert.deepEqual(D.derbyResolve(123456, '4071935'), D.derbyResolve(123456, [4, 0, 7, 1, 9, 3, 5]));
  assert.deepEqual(D.derbyPools(123456, 0.4), D.derbyPools(123456, 0.4));
  // 고정 자료는 계산값 그대로
  const st = D.derbyStaticScenario(77), sc = D.derbyScenario(77);
  assert.equal(st.p, sc.p);
  sc.horses.forEach((h, j) => assert.deepEqual(st.h[j], { r: `${h.r}`, k: h.k, b: h.b, d: h.d, l: h.l }));
  assert.throws(() => D.derbyResolve(1, '123456'));
  assert.throws(() => D.derbyResolve(1, [1, 2, 3, 4, 5, 6, 10]));
});

test('착순표: 1만 칸, 모든 단승·연승·복승·쌍승·복연승 조합이 한 칸 이상, 배당 = 칸 수에서 93%·버림·최저 1.0', () => {
  for (let p = 0; p < D.DERBY_PROFILES.length; p++) {
    const w = D.DERBY_PROFILES[p].w;
    assert.ok(Math.abs(w.reduce((s, x) => s + x, 0) - 1) < 1e-9);
    for (let i = 1; i < 8; i++) assert.ok(w[i] <= w[i - 1]);
    assert.equal(D.derbyTable(p).entries.length, 10000);
    for (let i = 0; i < 10000; i++) assert.match(D.derbyBaseEntry(p, i), /^(?!.*(.).*\1)[0-7]{4}$/);
    const cnt = countEntries(p);
    for (const t of TYPES) {
      const combos = D.derbyCombos(t);
      assert.equal(combos.length, { W: 8, P: 8, Q: 28, E: 56, R: 28 }[t]);
      for (const [a, b] of combos) {
        const key = D.comboKey(t, a, b), c = cnt[t][key] ?? 0;
        assert.ok(c >= 1, `p${p} ${t}${key} 칸 없음`);
        const o = D.derbyOdds(p, t, a, b);
        assert.equal(o, Math.max(10, Math.floor(0.93 / (c / 10000) * 10 + 1e-9)), `p${p} ${t}${key}`);
        assert.equal(D.derbyOddsTable(p)[t][key], o);
      }
    }
  }
});

// 시나리오 슬롯 아래 순위 r 의 단승·연승 확률: 착순표 1만 칸 × 일어날 일을 applyDerbyEvent 로 직접 센다 (outcomeDist 와 따로)
function winPlace(p, slots, r) {
  let W = 0, P = 0;
  const evs = [{ e: 'n', r: 0, w: 1000 - slots.reduce((s, x) => s + x.l - x.start, 0) }];
  for (const s of slots) evs.push({ e: 'b', r: s.r, w: s.b - s.start }, { e: 'd', r: s.r, w: s.d - s.b }, { e: 'l', r: s.r, w: s.l - s.d });
  for (let i = 0; i < 10000; i++) {
    const top4 = [...D.derbyBaseEntry(p, i)].map(Number);
    for (const v of evs) {
      const [a, b, c] = D.applyDerbyEvent(top4, v.e, v.r);
      if (a === r) W += v.w;
      if (a === r || b === r || c === r) P += v.w;
    }
  }
  return { W: W / 1e7, P: P / 1e7 };
}

test('몸짓 효과: 프로필 "보통" 4인기의 단승·연승 변화가 SPEC 표 ±1%p', () => {
  const p = D.DERBY_PROFILES.findIndex((x) => x.name === '보통');
  const SPEC = { dash: [4.8, -2.1], wild: [1.1, -10.0], gallopIn: [-1.2, -8.1], side: [-2.6, -6.1], lazy: [-5.4, -7.4], unseat: [-7.0, -12.5], calm: [-1, 5] };
  const base = winPlace(p, [], 3);
  for (const [k, [dw, dp]] of Object.entries(SPEC)) {
    const x = winPlace(p, D.buildSlots(p, [{ r: 3, k }]), 3);
    const gw = (x.W / base.W - 1) * 100, gp = (x.P / base.P - 1) * 100;
    assert.ok(Math.abs(gw - dw) <= 1, `${k} 단승 ${gw.toFixed(2)}% (SPEC ${dw}%)`);
    assert.ok(Math.abs(gp - dp) <= 1, `${k} 연승 ${gp.toFixed(2)}% (SPEC ${dp}%)`);
  }
});

test('분포 계산(outcomeDist)이 결과 계산(applyDerbyEvent)과 같다', () => {
  const sc = Array.from({ length: 200 }, (_, s) => D.derbyScenario(s)).find((x) => x.horses.length === 3);
  const pr = D.ticketProbs(D.outcomeDist(sc.p, sc.horses));
  for (let r = 0; r < 8; r++) {
    const x = winPlace(sc.p, sc.horses, r);
    assert.ok(Math.abs(pr.W[r] - x.W) < 1e-9 && Math.abs(pr.P[r] - x.P) < 1e-9);
  }
});

test('어떤 몸짓을 보고 사도 기대 환급이 100% 미만 (모든 프로필 · 시나리오 1만 개)', () => {
  for (let p = 0; p < D.DERBY_PROFILES.length; p++) {
    assert.ok(D.maxTicketEV(p, []).ev <= 0.93 + 1e-12);
    const allowed = D.derbyAllowedBehaviors(p);
    assert.ok(allowed.length >= 40, `p${p} 쓸 수 있는 몸짓 ${allowed.length}`);
    for (const x of allowed) assert.ok(D.maxTicketEV(p, D.buildSlots(p, [x])).ev < 1);
  }
  const seen = [0, 0, 0, 0];
  for (let s = 0; s < D.DERBY_SCENARIOS; s++) {
    const sc = D.derbyScenario(s);
    seen[sc.horses.length]++;
    assert.ok(new Set(sc.horses.map((h) => h.r)).size === sc.horses.length);
    assert.ok(!sc.horses.length || sc.horses[sc.horses.length - 1].l <= 1000);
    const m = D.maxTicketEV(sc.p, sc.horses);
    assert.ok(m.ev < 1, `시나리오 ${s}: ${m.t}${m.s1}${m.s2} ${m.ev}`);
  }
  assert.ok(seen.every((x) => x > 100), `몸짓 말 수 분포 ${seen}`);
});

test('NPC 조합별 매출은 총매출과 일치하고, 적중 조합 수를 반영한 고정 배당을 재현한다', () => {
  for (const n of [0, 1, 4_900_017, 4_912_345, 9_999_999]) {
    const p = D.derbyScenarioFor(n).p;
    let prev = null;
    for (const f of [0, 0.37, 0.5, 1]) {
      const pools = D.derbyPools(n, f);
      for (const t of TYPES) {
        const { total, cells } = pools[t];
        const winners = t === 'P' || t === 'R' ? 3n : 1n;
        assert.equal(Object.values(cells).reduce((sum, amt) => sum + amt, 0), total, `n${n} f${f} ${t} 매출 합계`);
        for (const [a, b] of D.derbyCombos(t)) {
          const key = D.comboKey(t, a, b), amt = cells[key], o = D.derbyOdds(p, t, a, b);
          assert.ok(Number.isInteger(amt) && amt >= 1);
          const calculated = Number(BigInt(total) * 93n / (BigInt(amt) * 10n * winners));
          assert.equal(Math.max(10, calculated), o, `n${n} f${f} ${t}${key}`);
          assert.equal(D.poolOddsX10(total, amt, t), o);
          if (prev) assert.ok(amt >= prev[t].cells[key]);
        }
        if (prev) assert.ok(total >= prev[t].total);
      }
      prev = pools;
    }
    assert.ok(D.derbyPools(n, 1).W.total > D.derbyPools(n, 0).W.total * 1.6);
  }
});

test('외부 추첨 숫자의 공백이나 줄바꿈을 0으로 바꿔 결과를 확정하지 않는다', () => {
  assert.throws(() => D.derbyResolve(77, '123 567'), /숫자 7개/);
  assert.throws(() => D.derbyResolve(77, '123456\n'), /숫자 7개/);
});

test('같은 말로 된 복연승 마권은 적중하거나 배당을 받을 수 없다', () => {
  const result = { a: '0', b: '1', c: '2', e: 'n' };
  assert.equal(D.ticketWins({ t: 'R', s1: '1', s2: '1' }, result), false);
  assert.throws(() => D.derbyOdds(0, 'R', 1, 1), RangeError);
});

test('잘못된 배당 계산은 실행을 멈추거나 무한대 금액을 반환하지 않는다', () => {
  assert.throws(() => D.oddsFromCount(0), RangeError);
  assert.throws(() => D.idiv(93, -2), RangeError);
  assert.throws(() => D.ticketPayout(100, Infinity), RangeError);
});

// SPEC 문장 그대로의 결과 계산 (코드와 따로)
function specRes(entry, slots, ev) {
  const t = [...entry].map(Number);
  let at = 0;
  for (const s of slots) {
    const w = { b: s.b - s.start, d: s.d - s.b, l: s.l - s.d };
    if (ev < at + w.b) return { top: [s.r, ...t.filter((x) => x !== s.r)].slice(0, 3), e: `b${s.r}` };
    at += w.b;
    if (ev < at + w.d) return { top: t.filter((x) => x !== s.r).slice(0, 3), e: `d${s.r}` };
    at += w.d;
    if (ev < at + w.l) return { top: t.slice(0, 3).includes(s.r) ? t.slice(0, 3) : [t[0], t[1], s.r], e: `l${s.r}` };
    at += w.l;
  }
  return { top: t.slice(0, 3), e: 'n' };
}

test('결과: 숫자 7개 → 기본 칸·몸짓 추첨이 SPEC 대로 (기세·부진·안정·없음), 8두 착순이 1~3착과 맞다', () => {
  const kinds = new Set();
  let falls = 0;
  for (let s = 0; s < 300; s++) {
    const sc = D.derbyScenario(s);
    if (!sc.horses.length) continue;
    for (let ev = 0; ev < 1000; ev += (s % 7) + 1) {
      const idx = (s * 7919 + ev * 31) % 10000;
      const digits = `${String(idx).padStart(4, '0')}${String(ev).padStart(3, '0')}`;
      const n = 10000 * (s + 3) + s;
      const r = D.derbyResolve(n, digits);
      assert.equal(r.index, idx); assert.equal(r.ev, ev);
      assert.equal(r.entry, D.derbyBaseEntry(sc.p, idx));
      const want = specRes(r.entry, sc.horses, ev);
      assert.deepEqual([r.res.a, r.res.b, r.res.c], want.top.map(String), `s${s} ev${ev}`);
      assert.equal(r.res.e, want.e);
      kinds.add(want.e[0]);
      assert.deepEqual([...r.order].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
      assert.deepEqual(r.order.slice(0, 3).map(String), [r.res.a, r.res.b, r.res.c]);
      if (r.fall) {
        falls++;
        assert.equal(r.event.e, 'd'); assert.equal(r.event.k, 'wild');
        assert.equal(r.order[7], r.event.r);
      }
      if (r.res.e[0] === 'd') assert.equal(r.order[7], r.event.r, '부진한 말은 꼴찌');
    }
  }
  assert.deepEqual([...kinds].sort(), ['b', 'd', 'l', 'n']);
  assert.ok(falls > 0);
});

test('마권: 방식 펼치기·적중·적중금·열쇠·한도', () => {
  const ex = (sel) => D.expandSelection(sel).map((t) => `${t.t}${t.s1}${t.s2 < 0 ? '' : t.s2}`);
  assert.deepEqual(ex({ t: 'W', m: 'single', lines: [[3, 1, 3]] }), ['W1', 'W3']);
  assert.deepEqual(ex({ t: 'Q', m: 'single', lines: [[5], [3]] }), ['Q35']);
  assert.deepEqual(ex({ t: 'Q', m: 'box', lines: [[5, 1, 3]] }), ['Q13', 'Q15', 'Q35']);
  assert.deepEqual(ex({ t: 'E', m: 'box', lines: [[1, 3, 5]] }), ['E13', 'E15', 'E31', 'E35', 'E51', 'E53']);
  assert.deepEqual(ex({ t: 'R', m: 'formation', lines: [[3, 5], [5, 3]] }), ['R35']);
  assert.deepEqual(ex({ t: 'E', m: 'formation', lines: [[3, 5], [5, 3]] }), ['E35', 'E53']);
  assert.deepEqual(ex({ t: 'E', m: 'axis', lines: [[2], [0, 1, 2]] }), ['E20', 'E21']);
  assert.deepEqual(ex({ t: 'E', m: 'axis', axisPos: 2, lines: [[2], [0, 1]] }), ['E02', 'E12']);
  assert.deepEqual(ex({ t: 'Q', m: 'axis', lines: [[6], [7, 0]] }), ['Q06', 'Q67']);
  assert.deepEqual(ex({ t: 'Q', m: 'box', lines: [[9, -1, 2]] }), []);
  const res = { a: '2', b: '5', c: '0', e: 'n' };
  const win = (t, s1, s2) => D.ticketWins({ t, s1, s2 }, res);
  assert.equal(win('W', 2), true); assert.equal(win('W', 5), false);
  assert.equal(win('P', 0), true); assert.equal(win('P', 7), false);
  assert.equal(win('Q', 2, 5), true); assert.equal(win('Q', 5, 2), true); assert.equal(win('Q', 0, 2), false);
  assert.equal(win('E', 2, 5), true); assert.equal(win('E', 5, 2), false);
  assert.equal(win('R', 0, 5), true); assert.equal(win('R', 0, 7), false);
  assert.equal(D.ticketWins({ t: 'E', s1: '2', s2: '5' }, res), true);
  assert.deepEqual(D.ticketRecord({ t: 'W', s1: 4, s2: -1 }, 300), { t: 'W', s1: '4', a: 300 });
  assert.deepEqual(D.ticketRecord({ t: 'R', s1: 1, s2: 4 }, 100), { t: 'R', s1: '1', s2: '4', a: 100 });
  assert.equal(D.ticketPayout(300, 33), 990);
  assert.equal(D.ticketPayout(100, 10), 100);
  assert.equal(D.raceOdds(4_900_001, 'E', 1, 0), D.derbyOdds(D.derbyScenarioFor(4_900_001).p, 'E', 1, 0));
  assert.equal(D.ticketKey(4_912_345, 3), '4912345_03');
  assert.equal(D.ticketKey(4_912_345, 99), '4912345_99');
  assert.deepEqual([D.DERBY_TICKET_MIN, D.DERBY_TICKET_STEP, D.DERBY_MAX_PARK, D.DERBY_MAX_BRANCH, D.DERBY_TICKETS_PER_RACE], [100, 100, 100000, 50000, 100]);
  assert.equal(D.validTicketAmount(100), true); assert.equal(D.validTicketAmount(150), false); assert.equal(D.validTicketAmount(0), false);
});

test('고정 자료 모양: sc 슬롯 3칸(빈 칸 폭 0) · tbl a~d · odds 열쇠', () => {
  for (let s = 0; s < 500; s++) {
    const st = D.derbyStaticScenario(s);
    assert.equal(st.h.length, 3);
    let end = 0;
    for (const x of st.h) {
      assert.ok(end <= x.b && x.b <= x.d && x.d <= x.l && x.l <= 1000);
      if (x.r === '-') assert.ok(x.k === '-' && x.b === end && x.l === end);
      else assert.ok(/^[0-7]$/.test(x.r) && x.k in D.DERBY_BEHAVIORS);
      end = x.l;
    }
  }
  const od = D.derbyOddsTable(0);
  assert.deepEqual(Object.keys(od).sort(), ['E', 'P', 'Q', 'R', 'W']);
  assert.deepEqual(Object.keys(od.W), ['0', '1', '2', '3', '4', '5', '6', '7']);
  assert.ok('01' in od.Q && !('10' in od.Q) && '10' in od.E);
});
