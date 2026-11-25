import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 프로젝트 관례(fishing/chat/casino 시험과 같은 갈고리): .ts는 transform 모드로
// 읽고, derbyui.ts의 `import './derbyui.css'`만 빈 모듈로 받는다 (의존성 추가 아님).
const stub = (src) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === './derbyui.css' || spec.endsWith('/derbyui.css')) return stub('export default {};');
    try {
      return next(spec, ctx);
    } catch (e) {
      if (spec.startsWith('.') && !/\.[cm]?[jt]s$/.test(spec)) {
        try {
          return next(`${spec}.ts`, ctx);
        } catch {
          return next(`${spec}/index.ts`, ctx);
        }
      }
      throw e;
    }
  },
  load(url, ctx, next) {
    if (!url.startsWith('file:') || !url.endsWith('.ts')) return next(url, ctx);
    return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
  },
});

const {
  COMBO_KEY,
  describeHorse,
  horseTag,
  DerbyPanel,
} = await import('../src/game/derbyui.ts');

// ---- 테스트용 가짜 스냅샷 (호스트가 주는 모양 그대로) ----
const snap = (over = {}) => ({
  v: 1,
  head: {
    n: 7,
    distance: 1200,
    status: 'selling',
    statusLabel: '',
    sellable: true,
    authEpoch: 11,
    closesInMs: 60000,
    label: '제7경주',
  },
  schedule: [
    { n: 7, label: '제7경주', status: 'selling', timeLabel: '19:00' },
    { n: 8, label: '제8경주', status: 'nosale', timeLabel: '19:06' },
  ],
  nextN: 8,
  card: [],
  odds: {},
  standings: null,
  balance: 100000,
  spent: 0,
  raceCap: 100000,
  raceRemain: 100000,
  ticketUsed: 0,
  ticketMax: 100,
  tickets: [],
  show: null,
  showCaption: '',
  closed: false,
  ...over,
});

// ---- (5) 성별·나이 노출 ----
test('말 카드 문구는 성별·나이를 빠뜨리지 않는다', () => {
  const h = { gate: 3, name: '번개', sex: '수', age: 4, jockey: '김기수', last5: '1-2-3-4-5', rating: 102, winOdds: 3.3, placeOdds: 1.5, sales: 10000 };
  assert.equal(horseTag(h), '수·4세');
  const d = describeHorse(h);
  assert.ok(d.includes('수'));
  assert.ok(d.includes('4세'));
  assert.ok(d.includes('김기수'));
});

// ---- 정규 키 ----
test('정규 키는 승식·순서를 구분하고 복승계는 정렬한다', () => {
  assert.equal(COMBO_KEY('W', [3]), 'W:3');
  assert.equal(COMBO_KEY('Q', [3, 1]), 'Q:1-3');
  assert.equal(COMBO_KEY('R', [5, 3]), 'R:3-5');
  assert.equal(COMBO_KEY('E', [1, 2]), 'E:1>2');
  assert.equal(COMBO_KEY('E', [2, 1]), 'E:2>1');
});

// 마권 요약의 DOM과 구매 버튼을 모의 호스트에 연결한다.
function fixture(t, kind = 'W') {
  const oldDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      return {
        children: [], attrs: {}, isConnected: true,
        append(...children) { this.children.push(...children); },
        setAttribute(k, v) { this.attrs[k] = v; },
      };
    },
  };
  t.after(() => {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  });
  const requests = [], toasts = [];
  const host = {
    where: 'park',
    snap: snap(),
    odds: 7.5,
    snapshot() { return this.snap; },
    quote(k, combos, stake) {
      return combos.map((legs) => ({ key: COMBO_KEY(k, legs), legs, odds: this.odds, est: this.odds * stake }));
    },
    async submit(req) {
      requests.push(req);
      return req.tickets.map((l) => ({ ...l, ok: true, ticketKey: '7_00' }));
    },
    toast(msg, err) { toasts.push({ msg, err }); },
  };
  const panel = new DerbyPanel(host);
  panel.kind = kind;
  panel.root = {};
  panel.render = () => {};
  panel.update(host.snap);
  const quote = () => {
    const box = panel.buildQuote(host.snap);
    return { summary: box.children[0].children.map((el) => el.textContent), go: box.children.at(-1) };
  };
  return { host, panel, quote, requests, toasts };
}

test('쌍승 2착까지 고르면 배율이 뜨고 즉시 구매 한 번으로 그 조합만 산다', async (t) => {
  const { panel, quote, requests, toasts } = fixture(t, 'E');
  panel.prefill(3);
  assert.equal(quote().go.disabled, true);
  panel.toggleGate(2);
  assert.deepEqual(quote().summary, ['쌍승 3번 → 2번', '7.5배', '예상 적중금 750코인']);
  assert.equal(requests.length, 0);
  const go = quote().go;
  go.onclick();
  go.onclick();
  await Promise.resolve();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].seenN, 7);
  assert.equal(requests[0].seenAuth, 11);
  assert.deepEqual(requests[0].tickets.map(({ key, legs, stake }) => ({ key, legs, stake })), [
    { key: 'E:3>2', legs: [3, 2], stake: 100 },
  ]);
  assert.equal(toasts.at(-1).msg, '마권 1장을 샀어요.');
  assert.equal(quote().go.disabled, true);
});

test('구매 직전 배율·경주·발매 상태·잔액·한도·남은 장수를 다시 확인한다', (t) => {
  const { panel, host, quote, requests, toasts } = fixture(t);
  panel.prefill(3);
  for (const [change, expected] of [
    [() => { host.odds = 10; }, /배율/],
    [() => { host.snap.head.n++; }, /경주/],
    [() => { host.snap.head.authEpoch++; }, /발매 상태/],
    [() => { host.snap.head.closesInMs = 0; }, /발매 중/],
    [() => { host.snap.balance = 0; }, /코인/],
    [() => { host.snap.raceRemain = 0; }, /한도/],
    [() => { host.snap.ticketUsed = 100; }, /더 살 수 없/],
  ]) {
    host.odds = 7.5;
    host.snap = snap();
    const go = quote().go;
    change();
    go.onclick();
    assert.match(toasts.at(-1).msg, expected);
  }
  assert.equal(requests.length, 0);
});

// ---- 마감 시계 (2026-11-24 검토: 스냅숏은 30초 단계로만 새로 만들어져서, 스냅숏에 든 남은 시간만 그리면 시계가 30초씩 멈췄다. 2분 32초 남았는데 3:00 으로 보였다) ----
test('마감 시계는 스냅숏이 그대로여도 서버 시각을 따라 줄고, 마감 시각이 지나면 구매를 막는다', (t) => {
  const { panel, host, quote } = fixture(t);
  let now = 1000000;
  host.now = () => now;
  host.snap = snap({ head: { ...snap().head, closesInMs: 180000, closesAt: now + 180000 } });
  panel.update(host.snap);
  assert.equal(panel.left(host.snap), 180000);
  now += 28000; // 스냅숏은 그대로 (closesInMs 180000)
  assert.equal(panel.left(host.snap), 152000);
  panel.prefill(3);
  assert.equal(quote().go.disabled, false);
  now += 152000; // 마감 시각
  assert.equal(panel.left(host.snap), 0);
  assert.equal(quote().go.disabled, true, '스냅숏이 아직 발매 중이어도 마감 시각이 지나면 살 수 없다');
  delete host.now; // 시각을 주지 않는 호스트: 스냅숏의 값 그대로
  assert.equal(panel.left(host.snap), 180000);
});

test('명시적으로 발매된 마권이 없으면 성공으로 표시하지 않는다', async (t) => {
  const { panel, quote, host, toasts } = fixture(t, 'Q');
  panel.prefill(3);
  panel.toggleGate(2);
  assert.equal(quote().summary[0], '복승 2번 · 3번');
  host.submit = async () => [];
  quote().go.onclick();
  await Promise.resolve();
  assert.match(toasts.at(-1).msg, /내 마권을 확인/);
  assert.equal(quote().summary[0], '복승 2번 · 3번');
});

// ---- 탭으로 나눈 창 (2026-11-25, 저장소 주인 요청: 한 화면에 전부 담겨 조잡했다 → 구매 · 출마표 · 배당 · 내 마권) ----
const { derbyClampPos, DERBY_DRAG_TOP, DERBY_DRAG_KEEP, DERBY_TABS, DERBY_KIND_HELP, DERBY_KINDS } = await import('../src/game/derbyui.ts');

// 그리기까지 보는 가짜 DOM (el() 이 쓰는 것만: className·textContent·append·setAttribute + 마번 색을 입히는 style)
function tabFixture(t, over = {}) {
  const make = (tag) => ({
    tag, children: [], attrs: {}, style: {}, isConnected: true, className: '', textContent: '',
    append(...c) { this.children.push(...c); }, setAttribute(k, v) { this.attrs[k] = v; },
  });
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: make };
  t.after(() => { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; });
  const card = Array.from({ length: 8 }, (_, i) => ({ gate: i + 1, name: `말${i + 1}`, sex: i % 2 ? '수' : '암', age: 3, jockey: `기수${i + 1}`, last5: '준비 중', rating: 80 + i, winOdds: 2 + i, placeOdds: 1.5 + i, sales: 1000 * (i + 1) }));
  const odds = { Q: {}, E: {}, R: {} };
  for (let a = 1; a <= 8; a++) for (let b = 1; b <= 8; b++) {
    if (a === b) continue;
    odds.E[COMBO_KEY('E', [a, b])] = { odds: a * 10 + b, pool: 100 };
    if (a < b) { odds.Q[COMBO_KEY('Q', [a, b])] = { odds: a * 100 + b, pool: 100 }; odds.R[COMBO_KEY('R', [a, b])] = { odds: a * 1000 + b, pool: 100 }; }
  }
  const host = {
    where: 'park', snap: snap({ card, odds, ...over }), snapshot() { return this.snap; },
    quote(k, combos, stake) { return combos.map((legs) => ({ key: COMBO_KEY(k, legs), legs, odds: 7.5, est: 7.5 * stake })); },
    async submit() { return []; }, toast() {}, selectRace(n) { this.selected = n; },
  };
  const panel = new DerbyPanel(host);
  panel.root = make('div');
  panel.snap = host.snap;
  panel.selectionRace = host.snap.head.n;
  let renders = 0;
  panel.render = () => { renders++; };
  const draw = (fn) => { panel.bodyEl = make('div'); fn(); return panel.bodyEl; };
  const all = (n, out = []) => { out.push(n); for (const c of n.children || []) all(c, out); return out; };
  const byClass = (n, c) => all(n).filter((x) => typeof x.className === 'string' && x.className.split(' ').includes(c));
  const byKey = (n, k) => all(n).find((x) => x.attrs && x.attrs['data-dk'] === k);
  return { host, panel, make, draw, all, byClass, byKey, renders: () => renders };
}

test('끌어 옮긴 자리: 화면 안에 가두고 제목 줄은 늘 잡히게 남긴다', () => {
  assert.deepEqual(derbyClampPos(300, 200, 340, 1024, 768), { x: 300, y: 200 });
  assert.deepEqual(derbyClampPos(-50, 10, 340, 1024, 768), { x: 0, y: DERBY_DRAG_TOP }, '왼쪽 밖·위쪽 버튼 줄 위로는 못 간다');
  assert.deepEqual(derbyClampPos(5000, 5000, 340, 1024, 768), { x: 1024 - 340, y: 768 - DERBY_DRAG_KEEP }, '오른쪽·아래: 제목 줄만큼은 화면에 남는다');
  assert.deepEqual(derbyClampPos(100, 100, 340, 300, 768), { x: 0, y: 100 }, '창보다 좁은 화면에서는 왼쪽에 붙인다');
});

test('탭 줄: 넷이고, 내 마권에는 산 장수가, 적중이 있으면 표시가 붙는다', (t) => {
  assert.deepEqual([...DERBY_TABS], ['buy', 'card', 'odds', 'mine']);
  const tk = (status) => ({ key: '7_00', kind: 'W', legs: [3], stake: 100, status, payout: status === 'won' ? 300 : 0, note: '' });
  const f = tabFixture(t, { tickets: [tk('sold'), tk('won')] });
  const root = f.make('div');
  f.panel.buildTabBar(root, f.host.snap);
  const tabs = f.byClass(root, 'd-tab');
  assert.deepEqual(tabs.map((b) => b.textContent), ['구매', '출마표', '배당', '내 마권']);
  assert.ok(tabs[0].className.split(' ').includes('on'), '처음은 구매 탭');
  assert.ok(tabs[3].className.split(' ').includes('won'));
  assert.deepEqual(f.byClass(root, 'd-badge').map((b) => b.textContent), ['2']);
  tabs[2].onclick();
  assert.equal(f.panel.tab, 'odds');
  assert.equal(f.renders(), 1);
});

test('구매 탭: 승식마다 설명 한 줄이 있고, 마번 단추 아래에 그 말(또는 먼저 고른 말과의 짝)의 배당이 뜬다', (t) => {
  for (const k of DERBY_KINDS) assert.ok(DERBY_KIND_HELP[k].length > 5, k);
  const f = tabFixture(t);
  const chips = () => f.byClass(f.draw(() => f.panel.buildBuy(f.host.snap)), 'd-num').map((b) => b.children.map((c) => c.textContent));
  assert.deepEqual(chips().map((c) => c[0]), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.deepEqual(chips().map((c) => c[1]), ['2', '3', '4', '5', '6', '7', '8', '9'], '단승: 그 말의 단승 배당');
  f.panel.kind = 'P';
  assert.equal(chips()[2][1], '3.5', '연승: 그 말의 연승 배당');
  f.panel.kind = 'E';
  assert.deepEqual(chips().map((c) => c[1]), ['', '', '', '', '', '', '', ''], '두 마리 승식: 고르기 전에는 비어 있다');
  f.panel.legs = [3];
  assert.deepEqual(chips().map((c) => c[1]), ['31', '32', '1착', '34', '35', '36', '37', '38'], '쌍승: 3번을 1착으로 했을 때의 배당');
  f.panel.kind = 'Q';
  assert.deepEqual(chips().map((c) => c[1]), ['103', '203', '', '304', '305', '306', '307', '308'], '복승: 순서 없이 3번과 짝지은 배당');
});

test('구매 단추가 지금 할 일을 말한다: 고르는 법 → 금액 → 살 수 없는 까닭', (t) => {
  const f = tabFixture(t);
  const go = () => f.panel.buildQuote(f.host.snap).children.at(-1);
  assert.equal(go().textContent, '말 한 마리를 고르세요.');
  assert.equal(go().disabled, true);
  f.panel.kind = 'E';
  assert.equal(go().textContent, '1착, 2착 순서로 고르세요.');
  f.panel.legs = [3];
  assert.equal(go().textContent, '2착 말을 고르세요.');
  f.panel.kind = 'R';
  assert.equal(go().textContent, '한 마리 더 고르세요.');
  f.panel.legs = [3, 5];
  f.panel.stakeText = '1000';
  assert.equal(go().textContent, '즉시 구매 · 1,000코인');
  assert.equal(go().disabled, false);
  f.panel.stakeText = '150';
  assert.match(go().textContent, /100코인 단위/);
  f.host.snap.balance = 0;
  f.panel.stakeText = '1000';
  assert.equal(go().textContent, '코인이 모자라요.');
  assert.equal(go().disabled, true);
  f.host.snap.head.status = 'closed';
  f.panel.legs = [];
  assert.equal(go().textContent, '지금은 발매 중이 아니에요.', '발매 중이 아니면 고르는 법보다 그 말이 먼저다');
});

test('금액 단추: 누르면 그 금액이 된다', (t) => {
  const f = tabFixture(t);
  const b = f.byKey(f.draw(() => f.panel.buildStake()), 'stake-5000');
  assert.equal(b.textContent, '5천');
  b.onclick();
  assert.equal(f.panel.stakeText, '5000');
  assert.ok(f.byKey(f.draw(() => f.panel.buildStake()), 'stake-5000').className.split(' ').includes('on'));
});

test('출마표 탭: 여덟 줄, 누르면 아래에 나머지 정보와 고르기 단추가 뜨고 고르면 구매 탭으로 간다', (t) => {
  const f = tabFixture(t);
  let body = f.draw(() => f.panel.buildCard(f.host.snap));
  assert.equal(f.byClass(body, 'd-horse').length, 8);
  assert.equal(f.byKey(body, 'card-pick'), undefined);
  f.byKey(body, 'info-3').onclick();
  assert.equal(f.panel.detailGate, 3);
  body = f.draw(() => f.panel.buildCard(f.host.snap));
  assert.match(f.byClass(body, 'd-dt')[0].textContent, /3번 · 레이팅 82 · 매출 3,000/);
  f.panel.tab = 'card';
  f.byKey(body, 'card-pick').onclick();
  assert.deepEqual(f.panel.legs, [3]);
  assert.equal(f.panel.tab, 'buy');
  // 두 마리 승식에서 한 마리를 골라 둔 뒤에 출마표에서 고르면 둘째로 더해진다
  f.panel.kind = 'Q';
  f.panel.tab = 'card';
  f.panel.detailGate = 6;
  f.byKey(f.draw(() => f.panel.buildCard(f.host.snap)), 'card-pick').onclick();
  assert.deepEqual(f.panel.legs, [3, 6]);
});

test('배당 탭: 한 번에 한 승식의 표. 칸을 누르면 그 조합을 골라 구매 탭으로 간다', (t) => {
  const f = tabFixture(t);
  f.panel.tab = 'odds';
  const cells = (k) => { f.panel.gridKind = k; return f.byClass(f.draw(() => f.panel.buildOdds(f.host.snap)), 'pick'); };
  assert.equal(cells('E').length, 56, '쌍승: 같은 말끼리만 빼고 전부');
  assert.equal(cells('Q').length, 28, '복승: 같은 조합은 한 번만 (오른쪽 위 절반)');
  assert.equal(cells('R').length, 28);
  const e = cells('E').find((td) => td.title.startsWith('5번 → 2번'));
  assert.equal(e.textContent, '52');
  e.onclick();
  assert.equal(f.panel.kind, 'E');
  assert.deepEqual(f.panel.legs, [5, 2]);
  assert.equal(f.panel.tab, 'buy');
  // 고른 조합은 표에서 표시된다
  assert.deepEqual(cells('E').filter((td) => td.className.split(' ').includes('sel')).map((td) => td.textContent), ['52']);
  assert.equal(cells('Q').filter((td) => td.className.split(' ').includes('sel')).length, 0, '다른 승식의 표에는 표시하지 않는다');
});

test('내 마권 탭: 결과 한 줄과 산 마권, 합계', (t) => {
  const tk = (i, kind, legs, stake, status, payout = 0) => ({ key: `7_0${i}`, kind, legs, stake, status, payout, note: '' });
  const f = tabFixture(t, { standings: [3, 5, 1], spent: 2500, ticketUsed: 3, tickets: [tk(0, 'W', [3], 1000, 'won', 4000), tk(1, 'E', [3, 5], 500, 'won', 17500), tk(2, 'Q', [1, 2], 1000, 'lost')] });
  f.host.snap.head.status = 'done';
  let body = f.draw(() => f.panel.buildMine(f.host.snap));
  assert.deepEqual(f.byClass(body, 'd-place').map((p) => p.textContent + p.children[0].textContent), ['1착3', '2착5', '3착1']);
  assert.deepEqual(f.byClass(body, 'd-tk').map((x) => x.textContent), ['단승 3 · 1,000', '쌍승 3→5 · 500', '복승 1-2 · 1,000']);
  assert.deepEqual(f.byClass(body, 'd-tst').map((x) => x.textContent), ['적중 +4,000', '적중 +17,500', '낙첨']);
  assert.equal(f.byClass(body, 'd-total')[0].textContent, '산 금액 2,500 · 3/100장 · 적중금 +21,500');
  // 마권이 없고 아직 발매 중
  const g = tabFixture(t);
  body = g.draw(() => g.panel.buildMine(g.host.snap));
  assert.match(g.byClass(body, 'd-dt')[0].textContent, /경주가 끝나면/);
  assert.match(g.byClass(body, 'd-hint')[0].textContent, /산 마권이 없어요/);
});

test('경주 넘기기: 예정표의 앞뒤 경주로 가고, 끝에서는 잠긴다', (t) => {
  const f = tabFixture(t);
  const root = f.make('div');
  f.panel.buildHead(root, f.host.snap);
  const prev = f.byKey(root, 'race-prev'), next = f.byKey(root, 'race-next');
  assert.equal(prev.disabled, true, '맨 앞 경주에서는 앞으로 못 간다');
  assert.equal(next.disabled, false);
  next.onclick();
  assert.equal(f.host.selected, 8);
});

test('말을 골라 둔 채로 열면 (prefill) 구매 탭이다', (t) => {
  const f = tabFixture(t);
  f.panel.tab = 'mine';
  f.panel.prefill(4);
  assert.equal(f.panel.tab, 'buy');
  assert.deepEqual(f.panel.legs, [4]);
});
