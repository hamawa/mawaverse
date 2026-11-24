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
