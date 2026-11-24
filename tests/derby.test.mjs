import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 쇼가 그리는 스프라이트(pixel.ts)는 생성자 매개변수 속성을 써서 transform 모드로 읽는다 (derby-view.test.mjs 와 같은 갈고리)
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

const {
  derbyFrame, derbyPhaseAt, derbyCaption, derbySoundEvents, derbyHoofActive,
  derbyFocusAt, derbyNearestRunner, derbyMiniView, derbyNameTags, derbyGateColor,
  mockDerbyField, mockDerbyResult, derbyDistanceFor, DERBY_CYCLE_MS,
} = await import('../src/game/derbyshow.ts');
const { RACE_WINNER_CIRCLE: WC, RACE_PARADE_PATH, RACE_LOOP, RACE_PADDOCK_SLOTS, buildRaceParkMap } = await import('../src/game/map.ts');
const TUNNEL = { x: RACE_PARADE_PATH[1][0], y: RACE_PARADE_PATH[1][1] }; // 확정 단계에 말이 사라지는 지하마도

const field = (n, ms, result) => {
  const runners = mockDerbyField(n);
  return { n, ms, distance: derbyDistanceFor(n), runners, result: result === undefined ? mockDerbyResult(n) : result };
};

test('6분 주기 단계가 SPEC 시간표 경계에 맞는다', () => {
  assert.equal(derbyPhaseAt(0).phase, 'paddock');
  assert.equal(derbyPhaseAt(99999).phase, 'paddock');
  assert.equal(derbyPhaseAt(100000).phase, 'mount');
  assert.equal(derbyPhaseAt(130000).phase, 'parade');
  assert.equal(derbyPhaseAt(160000).phase, 'warmup');
  assert.equal(derbyPhaseAt(200000).phase, 'gate');
  assert.equal(derbyPhaseAt(240000).phase, 'race');
  assert.equal(derbyPhaseAt(280000).phase, 'ceremony');
  assert.equal(derbyPhaseAt(320000).phase, 'payout');
  assert.equal(derbyPhaseAt(359999).phase, 'payout');
  assert.equal(DERBY_CYCLE_MS, 360000);
});

test('같은 입력이면 같은 장면이 나온다 (늦게 들어와도 같다)', () => {
  const a = derbyFrame(field(5, 255000));
  const b = derbyFrame(field(5, 255000));
  assert.deepEqual(a.horses, b.horses);
  assert.equal(a.leaderGate, b.leaderGate);
});

test('경주는 주어진 착순대로 끝나고 늦은 결과도 대열에서 이어 붙는다', () => {
  const n = 9, runners = mockDerbyField(n), result = mockDerbyResult(n);
  assert.equal(result.order.length, 8);
  assert.deepEqual([...result.order].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8]);
  // 결승 뒤 세리머니: 1착마가 위너스 서클에 있다
  const c = derbyFrame({ n, ms: 300000, distance: derbyDistanceFor(n), runners, result });
  const win = c.horses.find((h) => h.gate === result.order[0]);
  assert.ok(!win.hidden && win.rider && win.headHigh, '우승마가 주로 위에서 세리머니를 해야 함');
  // 결과가 늦게 와도(대열 유지) 수렴하면 같은 선두다 (spliceMs=270000 → 279000 에는 q=1)
  const late = derbyFrame({ n, ms: 279000, distance: derbyDistanceFor(n), runners, result: { ...result, spliceMs: 270000 } });
  const onTime = derbyFrame({ n, ms: 279000, distance: derbyDistanceFor(n), runners, result });
  assert.equal(late.leaderGate, onTime.leaderGate);
});

test('낙마 이벤트가 있으면 그 말이 기수 없이 꼴찌다', () => {
  const n = 24; // (24>>3)%4===3 → fall
  const runners = mockDerbyField(n), result = mockDerbyResult(n);
  assert.equal(result.event?.kind, 'fall');
  assert.equal(result.order[7], result.event.gate);
  const f = derbyFrame({ n, ms: 275000, distance: derbyDistanceFor(n), runners, result });
  const fallen = f.horses.find((h) => h.gate === result.event.gate);
  assert.equal(fallen.rider, false);
  assert.equal(fallen.riderDown, true);
});

test('7종 몸짓이 목 출전표에 빠짐없이 드러난다', () => {
  const kinds = new Set(mockDerbyField(0).map((r) => r.behavior));
  for (const k of ['dash', 'wild', 'gallopIn', 'side', 'lazy', 'unseat', 'calm', null]) assert.ok(kinds.has(k), `몸짓 ${k}`);
});

// 자막은 경주를 번호(일곱 자리)가 아니라 시작 시각(한국 시간)으로 부른다: 경주 n 은 n × 6분 (UTC) = 09:00 + n × 6분 (KST)
const clock = (n) => { const m = (n * 6 + 540) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
test('장내 방송 자막이 SPEC 시간표 문구다', () => {
  const n = 3, runners = mockDerbyField(n), result = mockDerbyResult(n);
  const info = { n, distance: derbyDistanceFor(n), runners, result };
  assert.equal(derbyCaption(50000, info), '09:18 경주 출전마 예시 중입니다');
  assert.equal(derbyCaption(110000, info), '기수 기승');
  assert.ok(derbyCaption(140000, info).includes('번') && derbyCaption(140000, info).includes('기수'));
  assert.ok(!derbyCaption(140000, info).includes('단승'), '실제 배당 없으면 숫자를 지어내지 않는다');
  assert.equal(derbyCaption(210000, info), '마권 발매 마감 30초 전');
  assert.equal(derbyCaption(241000, info), '09:18 경주 출발!');
  assert.ok(derbyCaption(270000, info).includes('코너 돌아 선두는'));
  assert.equal(derbyCaption(290000, info), `1착 ${result.order[0]}번, 2착 ${result.order[1]}번, 3착 ${result.order[2]}번`);
  assert.equal(derbyCaption(330000, info), '09:18 경주 승식별 확정 배당');
});

test('소리가 경계에서 한 번씩 나고 말발굽은 경주 중에만 난다', () => {
  assert.deepEqual(derbySoundEvents(99000, 101000), ['derbyBell']);
  assert.deepEqual(derbySoundEvents(239000, 241000), ['gate', 'fanfare']);
  assert.deepEqual(derbySoundEvents(278000, 279500), ['cheer']);
  assert.deepEqual(derbySoundEvents(359000, 1000), []); // 주기를 넘어가면 조용히
  assert.deepEqual(derbySoundEvents(278000, 279500, false), []); // 결과 없으면 결승 함성 없음
  assert.equal(derbyHoofActive(250000), true);
  assert.equal(derbyHoofActive(100000), false);
});

test('경계에서 말이 텔레포트하지 않는다 (게이트→경주→세리머니→확정)', () => {
  for (const n of [9, 24]) {
    const runners = mockDerbyField(n), result = mockDerbyResult(n);
    const dist = derbyDistanceFor(n);
    const spots = (ms, res) => {
      const f = derbyFrame({ n, ms, distance: dist, runners, result: res });
      const m = new Map();
      for (const h of f.horses) m.set(h.gate, h);
      return m;
    };
    const pairs = [
      [239000, 240500, result, 4], // 게이트 박스 → 발주 (시작 자세 연속)
      [279000, 280500, result, 4], // 결승 → 세리머니
      [319000, 320500, result, 4], // 세리머니 → 확정
      [1000, 2500, result, 4], // 예시장 행진 중
      [279000, 280500, null, 4], // 결과 없음: 대열 끝에서 서성이기
      [319000, 320500, null, 4], // 결과 없음: 마방으로 들어가 대기
    ];
    for (const [a, b, res, bound] of pairs) {
      const A = spots(a, res), B = spots(b, res);
      for (const [g, ha] of A) {
        const hb = B.get(g);
        if (ha.hidden) { assert.ok(!hb || hb.hidden || Math.hypot(hb.x - TUNNEL.x, hb.y - TUNNEL.y) < 4, `숨은 말 ${g}번이 문 아닌 곳에 나타나면 안 됨`); continue; }
        if (!hb || hb.hidden) continue; // 마방에 들어감 (퇴장)은 허용
        const d = Math.hypot(hb.x - ha.x, hb.y - ha.y);
        assert.ok(d < bound, `n=${n} ${a}→${b} ${g}번이 ${d}칸 점프`);
      }
    }
    // 늦은 결과도 매 프레임 연속이다 (500ms 간격으로 전 구간 훑기)
    // 정시 결과는 촘촘하게(2.1칸), 늦은 결과는 따라잡기(8칸)를 허용하되 끊김은 없음
    // (2.1칸 = 옛 1.5칸 × 주로 둘레 74.8→105.3칸. 경주 시간은 그대로라 둘레만큼 빨리 달린다)
    {
      let prev = spots(240000, result);
      for (let ms = 240500; ms <= 285000; ms += 500) {
        const cur = spots(ms, result);
        for (const [g, h] of cur) {
          const p = prev.get(g);
          if (!p || p.hidden || h.hidden) continue;
          const d = Math.hypot(h.x - p.x, h.y - p.y);
          assert.ok(d < 2.1, `n=${n} ${ms - 500}→${ms} ${g}번이 ${d}칸 점프`);
        }
        prev = cur;
      }
      const late = { ...result, spliceMs: 270000 };
      let prevLate = spots(240000, late);
      for (let ms = 240500; ms <= 285000; ms += 500) {
        const cur = spots(ms, late);
        for (const [g, h] of cur) {
          const p = prevLate.get(g);
          if (!p || p.hidden || h.hidden) continue;
          const d = Math.hypot(h.x - p.x, h.y - p.y);
          assert.ok(d < 8, `n=${n} ${ms - 500}→${ms} ${g}번이 ${d}칸 점프`);
        }
        prevLate = cur;
      }
      // 늦게 온 결과도(결승 직전 279000, 세리머니 도중 290000) 세리머니 끝에는 정시 결과와 같은 배치로 수렴한다 (낙마한 말 포함)
      const onTime = spots(319999, result);
      for (const spliceMs of [279000, 290000]) {
        const converged = derbyFrame({ n, ms: 319999, distance: dist, runners, result: { ...result, spliceMs } });
        for (const h of converged.horses) {
          const o = onTime.get(h.gate);
          if (h.hidden || !o || o.hidden) { assert.equal(!!h.hidden, !!(!o || o.hidden), `n=${n} ${h.gate}번 숨음 상태`); continue; }
          assert.ok(Math.hypot(h.x - o.x, h.y - o.y) < 0.5, `n=${n} spliceMs=${spliceMs} ${h.gate}번이 수렴하지 않음 (${Math.hypot(h.x - o.x, h.y - o.y)}칸)`);
        }
      }
    }
  }
});

test('주로 모서리에서 바깥·안쪽 차선 말이 끊기지 않는다 (경주 중 20ms 단위)', () => {
  for (const n of [3, 9, 24]) {
    const runners = mockDerbyField(n), result = mockDerbyResult(n), distance = derbyDistanceFor(n);
    let prev = null;
    for (let ms = 240000; ms < 279000; ms += 20) {
      const cur = new Map(derbyFrame({ n, ms, distance, runners, result }).horses.map((h) => [h.gate, h]));
      if (prev) for (const [g, h] of cur) {
        const p = prev.get(g);
        const d = Math.hypot(h.x - p.x, h.y - p.y);
        assert.ok(d < 0.25, `n=${n} ${ms - 20}→${ms} ${g}번이 ${d}칸 튐`);
      }
      prev = cur;
    }
  }
});

test('6분 전체에서 말이 단계 경계마다 순간이동하지 않는다 (50ms 걸음, 결과 정시·늦음·없음)', () => {
  // 단계별 정상 걸음 상한 (타일/50ms). 경주·세리머니는 늦은 결과를 따라잡는 질주(최대 약 0.54)까지 허용한다
  const LIMIT = { paddock: 0.25, mount: 0.25, parade: 0.3, warmup: 0.35, gate: 0.3, race: 0.6, ceremony: 0.6, payout: 0.3 };
  for (const n of [3, 9, 24]) {
    const runners = mockDerbyField(n), result = mockDerbyResult(n), distance = derbyDistanceFor(n);
    const at = (ms, res) => new Map(derbyFrame({ n, ms, distance, runners, result: res }).horses.map((h) => [h.gate, h]));
    const results = [result, { ...result, spliceMs: 279000 }, { ...result, spliceMs: 281000 }, { ...result, spliceMs: 290000 }, null];
    for (const res of results) {
      const tag = res ? `spliceMs=${res.spliceMs}` : '결과 없음';
      let prev = at(0, res);
      for (let ms = 50; ms < 360000; ms += 50) {
        const cur = at(ms, res), lim = LIMIT[derbyPhaseAt(ms).phase];
        for (const [g, h] of cur) {
          const p = prev.get(g);
          if (h.hidden || p.hidden) continue;
          const d = Math.hypot(h.x - p.x, h.y - p.y);
          assert.ok(d <= lim, `n=${n} ${tag} ${ms - 50}→${ms} ${g}번이 ${d.toFixed(2)}칸 튐 (상한 ${lim})`);
        }
        prev = cur;
      }
      // 단계 경계 한 걸음은 더 엄격하게: 기승 인계·준비운동→게이트·경주 끝 인계·서성이기 반경 변화
      for (const b of [100000, 200000, 280000, 281000]) {
        const A = at(b - 1, res), B = at(b, res);
        for (const [g, h] of B) {
          if (h.hidden || A.get(g).hidden) continue;
          const d = Math.hypot(h.x - A.get(g).x, h.y - A.get(g).y);
          assert.ok(d < 0.1, `n=${n} ${tag} ${b - 1}→${b} ${g}번이 ${d.toFixed(2)}칸 튐`);
        }
      }
    }
  }
});

test('말은 예시장 펜스 안·지하마도·주로 밖으로 나가지 않는다 (6분 전체, 결과 정시·늦음·없음)', () => {
  const m = buildRaceParkMap();
  const tracks = m.zones.filter((z) => z.kind === 'track');
  const pd = m.zones.find((z) => z.kind === 'paddock');
  const inside = (tx, ty) => tracks.some((z) => tx >= z.x && tx < z.x + z.w && ty >= z.y && ty < z.y + z.h)
    || (tx > pd.x && tx < pd.x + pd.w - 1 && ty > pd.y && ty < pd.y + pd.h - 1); // 예시장은 펜스 줄을 뺀 안쪽
  for (const n of [3, 9, 24]) {
    const runners = mockDerbyField(n), result = mockDerbyResult(n), distance = derbyDistanceFor(n);
    for (const res of [result, { ...result, spliceMs: 290000 }, null]) {
      for (let ms = 0; ms < 360000; ms += 250) {
        for (const h of derbyFrame({ n, ms, distance, runners, result: res }).horses) {
          if (h.hidden) continue;
          const tx = Math.floor(h.x + 0.5), ty = Math.floor(h.y + 0.9); // 그림의 발밑 칸
          assert.ok(inside(tx, ty), `n=${n} ${res ? res.spliceMs : '결과 없음'} ${ms}ms ${h.gate}번이 (${tx},${ty}) 에 나감`);
        }
      }
    }
  }
});

test('선두·카메라는 달린 거리로 정한다 (늦은 경주에 1착이 선두)', () => {
  for (const n of [9, 13, 24]) {
    const runners = mockDerbyField(n), result = mockDerbyResult(n);
    const f = derbyFrame({ n, ms: 277000, distance: derbyDistanceFor(n), runners, result });
    assert.equal(f.leaderGate, result.order[0]);
    const focus = derbyFocusAt(f);
    const win = f.horses.find((h) => h.gate === result.order[0]);
    assert.ok(Math.hypot(focus.x - win.x, focus.y - win.y) < 4, '카메라가 선두 무리를 봐야 함');
  }
});

test('낙마한 말은 기수 없이 꼴찌로 들어오고 다시 태워지지 않는다', () => {
  const n = 24; // (24>>3)%4===3 → fall
  const runners = mockDerbyField(n), result = mockDerbyResult(n);
  assert.equal(result.event?.kind, 'fall');
  for (const ms of [275000, 285000, 295000, 310000]) {
    const f = derbyFrame({ n, ms, distance: derbyDistanceFor(n), runners, result });
    const fallen = f.horses.find((h) => h.gate === result.event.gate);
    assert.equal(fallen.rider, false, `${ms} 기수가 없어야 함`);
    assert.equal(fallen.riderDown, true, `${ms} 떨어진 채로 있어야 함`);
  }
});

test('결과 없으면 결승 선언·세리머니 없이 서성이다 마방에서 대기한다', () => {
  const n = 9, runners = mockDerbyField(n), dist = derbyDistanceFor(n);
  const info = { n, distance: dist, runners, result: null };
  const c = derbyFrame({ n, ms: 290000, distance: dist, runners, result: null });
  assert.ok(c.horses.every((h) => !h.hidden), '서성이는 동안 숨는 말이 없어야 함');
  assert.ok(c.horses.every((h) => Math.hypot(h.x - WC.x, h.y - WC.y) > 3), '위너 서클이 비어 있어야 함');
  assert.equal(c.leaderGate, 0);
  const p = derbyFrame({ n, ms: 350000, distance: dist, runners, result: null });
  assert.ok(p.horses.every((h) => h.hidden), '확정 단계에는 마방에서 대기해야 함');
  assert.equal(derbyCaption(290000, info), `${clock(n)} 경주 결과 확인 중입니다`);
  assert.equal(derbyCaption(330000, info), `${clock(n)} 경주 결과 확인 중입니다`);
  assert.deepEqual(derbySoundEvents(278000, 279500, false), []);
});

test('빈 출전표·일부 출전표에도 그림·자막·미니가 버틴다', () => {
  const n = 9, dist = derbyDistanceFor(n);
  const empty = derbyFrame({ n, ms: 50000, distance: dist, runners: [], result: null });
  assert.deepEqual(empty.horses, []);
  assert.equal(empty.leaderGate, 0);
  assert.equal(derbyCaption(50000, { n, distance: dist, runners: [], result: null }), `${clock(n)} 경주 출전마 예시 중입니다`);
  assert.equal(derbyCaption(140000, { n, distance: dist, runners: [], result: null }), `${clock(n)} 경주 출전마 입장 중입니다`);
  const fin = derbyFocusAt(empty);
  assert.deepEqual([fin.x, fin.y], [...RACE_LOOP[0]]); // 결승선 (빈 들판 기본값)
  assert.equal(derbyNearestRunner(empty, ...RACE_PADDOCK_SLOTS[0]), null);
  const partial = mockDerbyField(n).filter((r) => r.gate <= 5);
  const f = derbyFrame({ n, ms: 260000, distance: dist, runners: partial, result: mockDerbyResult(n) });
  assert.equal(f.horses.length, 5);
  assert.ok(f.leaderGate >= 1 && f.leaderGate <= 5);
});

test('분점 미니 경계에 단계 관심지가 들어간다 (예시 단계 예시장 포함)', () => {
  const n = 9, runners = mockDerbyField(n), result = mockDerbyResult(n), dist = derbyDistanceFor(n);
  const pad = derbyMiniView({ n, ms: 50000, distance: dist, runners, result });
  assert.ok(pad.paddock, '예시 단계에 예시장 링');
  const inside = (v, x, y) => x >= v.x0 && x <= v.x1 && y >= v.y0 && y <= v.y1;
  for (const h of pad.horses) assert.ok(inside(pad, h.x, h.y), `말이 미니 밖에 있으면 안 됨 (${h.x},${h.y})`);
  for (const [x, y] of RACE_PADDOCK_SLOTS) assert.ok(inside(pad, x, y), `예시장 자리 (${x},${y})`);
  const race = derbyMiniView({ n, ms: 250000, distance: dist, runners, result });
  assert.equal(race.paddock, null);
  for (const h of race.horses) assert.ok(inside(race, h.x, h.y), `말이 미니 밖에 있으면 안 됨 (${h.x},${h.y})`);
  // 세리머니: 위너스 서클의 1~3착도 미니 안에 든다
  const cer = derbyMiniView({ n, ms: 310000, distance: dist, runners, result });
  assert.ok(cer.horses.length >= 3);
  for (const h of cer.horses) assert.ok(inside(cer, h.x, h.y), `세리머니 말이 미니 밖에 있으면 안 됨 (${h.x},${h.y})`);
});

test('출전마 이름표: 보이는 말마다 "번호 이름"과 마번 고유 색, 숨은 말은 없다', () => {
  // 8마리 색이 서로 달라야 색으로 보고 고를 수 있다
  assert.equal(new Set([1, 2, 3, 4, 5, 6, 7, 8].map((g) => derbyGateColor(g).bg)).size, 8);
  const n = 9, runners = mockDerbyField(n), result = mockDerbyResult(n), dist = derbyDistanceFor(n);
  const f = derbyFrame({ n, ms: 50000, distance: dist, runners, result });
  const tags = derbyNameTags(f);
  assert.equal(tags.length, f.horses.filter((h) => !h.hidden).length);
  for (const t of tags) {
    const r = runners.find((x) => t.text === `${x.gate}번 ${x.name}`);
    assert.ok(r, `이름표 ${t.text}`);
    assert.deepEqual(t.color, derbyGateColor(r.gate));
  }
  const p = derbyFrame({ n, ms: 350000, distance: dist, runners, result: null });
  assert.deepEqual(derbyNameTags(p), []); // 마방에서 대기 중(모두 숨음)
});

test('펜스 앞에서 가까운 출전마만 고른다 (없으면 null)', () => {
  const n = 9, runners = mockDerbyField(n), result = mockDerbyResult(n), dist = derbyDistanceFor(n);
  const f = derbyFrame({ n, ms: 50000, distance: dist, runners, result });
  const h0 = f.horses[0];
  const near = derbyNearestRunner(f, h0.x, h0.y, 4);
  assert.ok(near && near.gate === h0.gate);
  const { spawn } = buildRaceParkMap();
  assert.equal(derbyNearestRunner(f, spawn.x, spawn.y, 4), null); // 스폰(입구 광장)에서는 닿지 않는다
});

test('제보된 경계 프레임이 끊기지 않는다 (1ms 단위)', () => {
  const n = 9, runners = mockDerbyField(n), result = mockDerbyResult(n);
  const dist = derbyDistanceFor(n);
  const spots = (ms, res) => {
    const f = derbyFrame({ n, ms, distance: dist, runners, result: res });
    const m = new Map();
    for (const h of f.horses) m.set(h.gate, h);
    return m;
  };
  // mount→parade 인계 (기승 한 바퀴 끝 = 퍼레이드 시작점)
  {
    const A = spots(129999, result), B = spots(130000, result);
    for (const [g, ha] of A) {
      const hb = B.get(g);
      if (!hb || hb.hidden || ha.hidden) continue;
      const d = Math.hypot(hb.x - ha.x, hb.y - ha.y);
      assert.ok(d < 0.5, `게이트 ${g}번 129999→130000 ${d}칸 점프`);
    }
  }
  // 늦은 결과의 세리머니 입장 (n=9, spliceMs=279000, 5번)
  {
    const late = { ...result, spliceMs: 279000 };
    const A = spots(283975, late), B = spots(283976, late);
    for (const [g, ha] of A) {
      const hb = B.get(g);
      if (!hb || hb.hidden || ha.hidden) continue;
      const d = Math.hypot(hb.x - ha.x, hb.y - ha.y);
      assert.ok(d < 0.5, `게이트 ${g}번 283975→283976 ${d}칸 점프`);
    }
  }
  // 확정 단계 인계: 세리머니 끝 → 주로 따라 들어가기(320000), 1착마 주로 끝 → 지하마도로 걷기(338000)
  for (const at of [320000, 338000]) {
    const A = spots(at - 1, result), B = spots(at, result);
    let seen = 0;
    for (const [g, ha] of A) {
      const hb = B.get(g);
      if (!hb || hb.hidden || ha.hidden) continue;
      seen++;
      const d = Math.hypot(hb.x - ha.x, hb.y - ha.y);
      assert.ok(d < 0.5, `게이트 ${g}번 ${at - 1}→${at} ${d}칸 점프`);
    }
    assert.ok(seen > 0, `${at} 에 보이는 말이 있어야 비교가 된다`);
  }
});

test('세리머니 도중 결과가 와도 서성이던 자리에서 이어진다', () => {
  const n = 9, runners = mockDerbyField(n), result = mockDerbyResult(n);
  const dist = derbyDistanceFor(n);
  const before = derbyFrame({ n, ms: 290000, distance: dist, runners, result: null });
  const after = derbyFrame({ n, ms: 290001, distance: dist, runners, result: { ...result, spliceMs: 290000 } });
  for (const h of before.horses) {
    const a = after.horses.find((x) => x.gate === h.gate);
    const d = Math.hypot(a.x - h.x, a.y - h.y);
    assert.ok(d < 1, `게이트 ${h.gate}번이 도착 순간에 ${d}칸 점프`);
  }
});

test('자막 선두는 장면과 같은 스냅샷 거리로 정하고 배당은 실제 값만 쓴다', () => {
  const n = 9, runners = mockDerbyField(n), result = mockDerbyResult(n);
  const late = { ...result, spliceMs: 270000 };
  const f = derbyFrame({ n, ms: 274000, distance: 1000, runners, result: late });
  assert.equal(f.leaderGate, 8); // 제보된 케이스: 늦은 결과 + 1000m 에서 8번
  const cap = derbyCaption(274000, { n, distance: 1000, runners, result: late });
  assert.ok(cap.includes('8번'), `자막이 장면과 같은 선두를 말해야 함: ${cap}`);
  // 아직 안 온 결과는 확인 중 (순위를 미리 말하지 않는다)
  const early = derbyCaption(285000, { n, distance: 1000, runners, result: { ...result, spliceMs: 290000 } });
  assert.ok(early.includes('결과 확인 중'), early);
  // 배당: 없으면 뺀다, 있으면 쓴다
  const pad = derbyCaption(140000, { n, distance: 1000, runners, result: late });
  assert.ok(!pad.includes('배당') && !pad.includes('단승'), `가짜 배당 금지: ${pad}`);
  const withOdds = derbyCaption(140000, { n, distance: 1000, runners, result: late, winOdds: { 3: 3.3 } }); // 140000ms에 소개되는 3번
  assert.ok(withOdds.includes('3.3배'), withOdds);
});
