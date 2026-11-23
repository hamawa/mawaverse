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
  expandDerbySelection,
  appendBasketLines,
  captureConfirmDraft,
  verifyDraftForSubmit,
  isConfirmCurrent,
  applySubmitResult,
  describeHorse,
  horseTag,
  DerbyPanel,
} = await import('../src/game/derbyui.ts');

const S = (a) => new Set(a);
// 줄 식별자 기준 견적표: fresh.get(lineId) -> { odds, est }
const LM = (entries) => new Map(entries.map(([id, odds, est]) => [id, { odds, est }]));

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

const draftOf = (over = {}) => ({
  draftId: 'd1',
  rev: 3,
  raceN: 7,
  lines: [
    { lineId: 'd1#1', key: 'Q:1-2', kind: 'Q', legs: [1, 2], stake: 100, odds: 5.5, est: 550, error: '' },
    { lineId: 'd1#2', key: 'Q:3-4', kind: 'Q', legs: [3, 4], stake: 200, odds: 8.0, est: 1600, error: '' },
  ],
  ...over,
});

const confirmOf = (draft, over = {}) =>
  captureConfirmDraft({
    confirmId: 'c1',
    draft,
    openGen: 2,
    where: 'park',
    authEpoch: 11,
    nowMs: 123456789,
    ...over,
  });

// ---- (3) 포메이션: 같은 말을 양쪽 줄에 둬도 되고, 자기 자신끼리는 빠진다 ----
test('포메이션은 같은 말을 양쪽 줄에 둘 수 있고 자기 자신끼리는 빠진다', () => {
  const out = expandDerbySelection('Q', 'formation', S([]), null, S([1, 2]), S([2, 3]), true);
  assert.deepEqual(out, [
    [1, 2],
    [1, 3],
    [2, 3],
  ]); // Q:2-2 자기 자신 빠짐, Q:3-2→Q:2-3 정규화
});

test('쌍승 포메이션은 방향을 지키고 자기 자신끼리는 빠진다', () => {
  assert.deepEqual(expandDerbySelection('E', 'formation', S([]), null, S([1]), S([1, 2]), true), [[1, 2]]);
  assert.deepEqual(expandDerbySelection('E', 'formation', S([]), null, S([1]), S([1, 2]), false), [[2, 1]]);
});

test('복승·복연승은 순서 뒤집힌 중복을 한 장으로 접는다', () => {
  assert.deepEqual(expandDerbySelection('Q', 'single', S(['1-2', '2-1', '3-4']), null, S([]), S([]), true), [
    [1, 2],
    [3, 4],
  ]);
  assert.deepEqual(expandDerbySelection('E', 'single', S(['2-1', '1-2']), null, S([]), S([]), true), [
    [2, 1],
    [1, 2],
  ]);
});

// ---- 바구니 행 식별자: 담을 때마다 새 행, 편집으로 부활 없음 ----
test('담기는 항상 새 행 식별자를 매긴다 (같은 조합 재담기도 새 행)', () => {
  const prev = [
    { lineId: 'd1#1', key: 'Q:1-2', kind: 'Q', legs: [1, 2], stake: 100, odds: 5.5, est: 550, error: '마감' },
  ];
  const { lines, nextSeq } = appendBasketLines(prev, 'd1', 7, [
    { key: 'Q:1-2', kind: 'Q', legs: [1, 2], stake: 100, odds: 5.5, est: 550 },
  ]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].lineId, 'd1#1'); // 기존 줄 그대로
  assert.equal(lines[0].error, '마감'); // 실패 사유 유지
  assert.equal(lines[1].lineId, 'd1#8'); // 새 행
  assert.equal(nextSeq, 8);
  assert.equal(lines[1].error, '');
});

test('담기는 입력을 바꾸지 않고 승식·금액을 줄마다 가진다', () => {
  const additions = [
    { key: 'W:3', kind: 'W', legs: [3], stake: 100, odds: 3.0, est: 300 },
    { key: 'Q:1-2', kind: 'Q', legs: [1, 2], stake: 200, odds: 5.5, est: 1100 },
  ];
  const { lines } = appendBasketLines([], 'd9', 0, additions);
  assert.deepEqual(lines.map((l) => [l.lineId, l.kind, l.stake]), [
    ['d9#1', 'W', 100],
    ['d9#2', 'Q', 200],
  ]);
  assert.deepEqual(additions[0].legs, [3]); // 입력 불변
});

// ---- (1) 확정 스냅샷: 얼리고 식별한다 ----
test('확정안은 얼고(immutable) 확인 항목을 따로 식별한다', () => {
  const draft = draftOf();
  const c = confirmOf(draft);
  assert.equal(c.confirmId, 'c1');
  assert.equal(c.draftId, 'd1');
  assert.equal(c.draftRev, 3);
  assert.equal(c.openGen, 2);
  assert.equal(c.where, 'park');
  assert.equal(c.raceN, 7);
  assert.equal(c.authEpoch, 11);
  assert.equal(c.totalStake, 300); // 줄별 금액 합 (100 + 200)
  assert.equal(c.capturedAtMs, 123456789);
  assert.ok(Object.isFrozen(c));
  assert.ok(Object.isFrozen(c.lines));
  assert.ok(Object.isFrozen(c.lines[0].legs));
  assert.equal(c.lines[0].kind, 'Q');
  assert.equal(c.lines[1].stake, 200);
  draft.lines[0].legs[0] = 99; // 원본을 바꿔도 확정안은 그대로
  assert.deepEqual(c.lines[0].legs, [1, 2]);
});

// ---- (1) 호출 전·중 검증: 어긋나면 중단 사유 ----
test('경주·승인·상태·잔여 시간이 어긋나면 보내지 않는다', () => {
  const c = confirmOf(draftOf());
  const quotes = LM([['d1#1', 5.5, 550], ['d1#2', 8.0, 1600]]);
  assert.deepEqual(verifyDraftForSubmit(c, snap(), quotes), { ok: true });
  assert.equal(verifyDraftForSubmit(c, snap({ head: { ...snap().head, n: 8 } }), quotes).reason, 'race-changed');
  assert.equal(verifyDraftForSubmit(c, snap({ head: { ...snap().head, authEpoch: 12 } }), quotes).reason, 'auth-changed');
  assert.equal(verifyDraftForSubmit(c, snap({ head: { ...snap().head, status: 'closed' } }), quotes).reason, 'not-selling');
  assert.equal(verifyDraftForSubmit(c, snap({ head: { ...snap().head, sellable: false } }), quotes).reason, 'not-sellable');
  assert.equal(verifyDraftForSubmit(c, snap({ head: { ...snap().head, closesInMs: 0 } }), quotes).reason, 'no-time');
  assert.equal(verifyDraftForSubmit(c, snap({ head: { ...snap().head, closesInMs: NaN } }), quotes).reason, 'no-time');
});

test('견적·잔액·한도·장수가 어긋나면 보내지 않는다', () => {
  const c = confirmOf(draftOf());
  const good = LM([['d1#1', 5.5, 550], ['d1#2', 8.0, 1600]]);
  const stale = LM([['d1#1', 6.0, 600], ['d1#2', 8.0, 1600]]);
  assert.equal(verifyDraftForSubmit(c, snap(), stale).reason, 'quote-changed');
  assert.equal(verifyDraftForSubmit(c, snap(), new Map()).reason, 'quote-invalid'); // 견적 없음
  assert.equal(verifyDraftForSubmit(c, snap(), LM([['d1#1', null, null], ['d1#2', 8.0, 1600]])).reason, 'quote-invalid'); // null 견적
  assert.equal(verifyDraftForSubmit(c, snap(), LM([['d1#1', Infinity, 550], ['d1#2', 8.0, 1600]])).reason, 'quote-invalid'); // 숫자 아님
  assert.equal(verifyDraftForSubmit(c, snap({ balance: 150 }), good).reason, 'insufficient-balance');
  assert.equal(verifyDraftForSubmit(c, snap({ raceRemain: 150 }), good).reason, 'over-allowance');
  assert.equal(verifyDraftForSubmit(c, snap({ ticketUsed: 99 }), good).reason, 'no-slots');
});

// ---- (1)(2) 호출 후 가드: 같은 열림 세대·장소·바구니일 때만 이어진다 ----
test('같은 열림 세대·장소·바구니일 때만 확인이 유효하다', () => {
  const c = confirmOf(draftOf());
  const live = { open: true, openGen: 2, where: 'park', draftId: 'd1', draftRev: 3 };
  assert.equal(isConfirmCurrent(c, live), true);
  assert.equal(isConfirmCurrent(c, { ...live, draftRev: 4 }), false); // 확인 뒤 줄이 바뀜
  assert.equal(isConfirmCurrent(c, { ...live, open: false }), false); // 닫힘
  assert.equal(isConfirmCurrent(c, { ...live, openGen: 3 }), false); // 다른 세대
  assert.equal(isConfirmCurrent(c, { ...live, where: 'branch' }), false);
  assert.equal(isConfirmCurrent(c, { ...live, draftId: 'd2' }), false);
});

// ---- (2) 응답 반영: 수락 줄만 빼고 실패 줄은 사유를 달아 남긴다 ----
test('명시적 수락 줄만 빠지고 실패 줄은 사유와 함께 남는다', () => {
  const draft = draftOf();
  const before = JSON.parse(JSON.stringify(draft));
  const applied = applySubmitResult(draft, [
    { lineId: 'd1#1', key: 'Q:1-2', ok: true, ticketKey: '7_00', error: '' },
    { lineId: 'd1#2', key: 'Q:3-4', ok: false, ticketKey: '', error: '마감' },
    { lineId: 'd9#9', key: 'Q:9-9', ok: true, ticketKey: '7_99', error: '' }, // 남의 바구니: 무시
  ]);
  assert.deepEqual(applied.accepted, ['d1#1']);
  assert.equal(applied.draft.lines.length, 1);
  assert.equal(applied.draft.lines[0].lineId, 'd1#2'); // 실패 줄 유지
  assert.deepEqual(applied.failed, [{ lineId: 'd1#2', key: 'Q:3-4', error: '마감' }]);
  assert.deepEqual(draft, before); // 입력 바구니 불변
});

test('응답에 없는 줄·빈 응답은 수락이 아니라 그대로 둔다', () => {
  const draft = draftOf();
  const partial = applySubmitResult(draft, [{ lineId: 'd1#1', key: 'Q:1-2', ok: true, ticketKey: '7_00', error: '' }]);
  assert.equal(partial.draft.lines.length, 1); // 빠진 d1#2는 그대로
  assert.deepEqual(partial.failed, []);
  const empty = applySubmitResult(draft, []);
  assert.equal(empty.draft.lines.length, 2); // 빈 응답: 손대지 않음
  assert.deepEqual(empty.accepted, []);
});

test('응답이 없는 줄은 이전 사유를 지우지 않는다', () => {
  const draft = draftOf({ lines: [
    { lineId: 'd1#1', key: 'Q:1-2', kind: 'Q', legs: [1, 2], stake: 100, odds: 5.5, est: 550, error: '' },
    { lineId: 'd1#2', key: 'Q:3-4', kind: 'Q', legs: [3, 4], stake: 200, odds: 8.0, est: 1600, error: '마감' },
  ] });
  const applied = applySubmitResult(draft, [
    { lineId: 'd1#1', key: 'Q:1-2', ok: true, ticketKey: '7_00', error: '' },
    // d1#2에 대한 결과 없음: 이전 '마감' 사유 유지
  ]);
  assert.equal(applied.draft.lines.length, 1);
  assert.equal(applied.draft.lines[0].lineId, 'd1#2');
  assert.equal(applied.draft.lines[0].error, '마감');
  assert.deepEqual(applied.failed, [{ lineId: 'd1#2', key: 'Q:3-4', error: '마감' }]);
});

test('호출에 포함되지 않은 줄의 결과는 무시한다', () => {
  const draft = draftOf();
  const submitted = new Set(['d1#1']);
  // d1#2는 호출에 없었는데 ok로 와도 건드리지 않는다
  const applied = applySubmitResult(draft, [
    { lineId: 'd1#1', key: 'Q:1-2', ok: true, ticketKey: '7_00', error: '' },
    { lineId: 'd1#2', key: 'Q:3-4', ok: true, ticketKey: '7_01', error: '' },
  ], submitted);
  assert.deepEqual(applied.accepted, ['d1#1']);
  assert.equal(applied.draft.lines.length, 1);
  assert.equal(applied.draft.lines[0].lineId, 'd1#2');
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

// ---- 실제 패널 경계 회귀: DerbyPanel + 모의 호스트/확인, 브라우저 없음 ----
// private 메서드는 같은 모듈의 경계라 직접 두드린다. render()는 root가 없으면
// 쉰다. show()/hide()의 DOM 대신 opened/openGen 플래그로 열림 생애를 세운다.
// hide()는 root 없이도 opened를 내린다 (닫힘 시뮬레이션용).
const mockHost = (over = {}) => {
  const calls = { quote: 0, submit: 0, toasts: [], selectRace: [], quoteArgs: [] };
  const host = {
    calls,
    where: 'park',
    snap: snap(),
    snapshot() {
      return this.snap;
    },
    listen() {
      return () => {};
    },
    quote(kind, combos, stake) {
      calls.quote++;
      calls.quoteArgs.push([kind, combos.map((c) => [...c]), stake]);
      return combos.map((legs) => ({ key: COMBO_KEY(kind, legs), legs, odds: 10, est: 10 * stake }));
    },
    async submit() {
      calls.submit++;
      return [];
    },
    selectRace(n) {
      calls.selectRace.push(n);
    },
    toast(msg, err) {
      calls.toasts.push({ msg, err: !!err });
    },
    ...over,
  };
  return host;
};

class ScriptPanel extends DerbyPanel {
  constructor(host) {
    super(host);
    this.answers = [];
    this.confirmCalls = 0;
  }
  confirmPurchase(_label) {
    this.confirmCalls++;
    const a = this.answers.length ? this.answers.shift() : false;
    return typeof a === 'function' ? a() : Promise.resolve(!!a);
  }
}

// 열린 패널 흉내: 스냅샷을 깔고 열림 생애를 1세대로 세운다 (DOM은 만들지 않는다).
const openPanel = (host) => {
  const p = new ScriptPanel(host);
  p.snap = host.snapshot();
  p.opened = true;
  p.openGen += 1;
  return p;
};

// 미리보기 조합을 바구니 담기 입력으로 묶는다 (UI [담기]가 하는 일과 같다).
// 견적 호출이 던지면 null 견적으로 묶는다 (UI 미리보기와 같다).
const previewAdditions = (p) => {
  const combos = p.combos();
  let quotes = null;
  try {
    quotes = p.quoteMap(p.kind, combos, p.stake);
  } catch {
    quotes = null;
  }
  return combos.map((legs) => {
    const key = COMBO_KEY(p.kind, legs);
    const q = quotes?.get(key);
    return { key, kind: p.kind, legs, stake: p.stake, odds: q ? q.odds : null, est: q ? q.est : null };
  });
};

const flushSubmitCall = async (host) => {
  for (let i = 0; i < 100 && host.calls.submit === 0; i++) await Promise.resolve();
  assert.equal(host.calls.submit, 1);
};

test('첫 열림의 말 선택은 미리보기만 보여주고 바구니에 넣지 않는다', () => {
  const p = openPanel(mockHost());
  p.prefill(3);
  assert.ok(p.single.has(3));
  assert.equal(p.draft, null); // 바구니 untouched
  assert.deepEqual(p.combos(), [[3]]); // 미리보기는 곧바로 나온다
});

test('선택 편집은 바구니를 바꾸지 않고 담기만 새 행을 만든다', () => {
  const host = mockHost();
  const p = openPanel(host);
  p.toggleGate(3);
  assert.equal(p.draft, null); // 편집만으로 바구니 생기지 않음
  assert.ok(p.addPreviewToBasket(previewAdditions(p)));
  assert.equal(p.draft.lines.length, 1);
  const first = p.draft.lines[0].lineId;
  assert.equal(p.draft.lines[0].key, 'W:3');
  p.toggleGate(5); // 선택 편집
  assert.equal(p.draft.lines.length, 1); // 바구니 그대로
  assert.equal(p.draft.lines[0].lineId, first);
  p.toggleGate(5); // 선택 원복
  assert.ok(p.addPreviewToBasket(previewAdditions(p))); // 같은 조합을 일부러 또 담기
  assert.equal(p.draft.lines.length, 2);
  assert.equal(p.draft.lines[1].key, 'W:3');
  assert.notEqual(p.draft.lines[1].lineId, first); // 새 행 식별자
});

test('확인 도중 닫혔다 다시 열리면 호출하지 않는다', async () => {
  const host = mockHost();
  const p = openPanel(host);
  p.toggleGate(3);
  assert.ok(p.addPreviewToBasket(previewAdditions(p)));
  let resolveConfirm = null;
  p.answers.push(() => new Promise((res) => { resolveConfirm = res; }));
  const flight = p.submit();
  assert.equal(p.confirmCalls, 1);
  p.hide(); // 닫힘 (opened=false)
  p.opened = true; // 다시 열림: 새 세대
  p.openGen += 1;
  resolveConfirm(true);
  await flight;
  assert.equal(host.calls.submit, 0); // 호출 안 됨
  assert.equal(p.draft.lines.length, 1); // 바구니 그대로
  assert.ok(host.calls.toasts.some((t) => t.err)); // 중단 안내
});

test('확인창을 보는 사이 바구니 줄을 넣거나 빼면 호출하지 않는다', async () => {
  for (const edit of ['add', 'remove']) {
    const host = mockHost();
    const p = openPanel(host);
    p.toggleGate(3);
    assert.ok(p.addPreviewToBasket(previewAdditions(p)));
    p.toggleGate(3);
    p.toggleGate(5);
    assert.ok(p.addPreviewToBasket(previewAdditions(p)));
    assert.equal(p.draft.lines.length, 2);
    let resolveConfirm = null;
    p.answers.push(() => new Promise((res) => { resolveConfirm = res; }));
    const flight = p.submit();
    assert.equal(p.confirmCalls, 1);
    if (edit === 'add') {
      p.toggleGate(5);
      p.toggleGate(7);
      assert.ok(p.addPreviewToBasket(previewAdditions(p)));
    } else {
      // 패널의 줄 빼기 버튼과 같은 변경 (개정 번호 +1)
      p.draft = { ...p.draft, rev: p.draft.rev + 1, lines: p.draft.lines.slice(1) };
    }
    resolveConfirm(true);
    await flight;
    assert.equal(host.calls.submit, 0, `${edit}: 바뀐 바구니가 옛 확인으로 나갔다`);
    assert.equal(p.draft.lines.length, edit === 'add' ? 3 : 1, `${edit}: 바구니는 그대로 둔다`);
    assert.ok(host.calls.toasts.some((t) => t.err), `${edit}: 중단 안내`);
  }
});

test('닫혔다 다시 열려도 수락된 줄은 빠지고 실패 사유는 남는다', async () => {
  let resolveSubmit = null;
  const host = mockHost({
    async submit(req) {
      this.calls.submit++;
      return new Promise((res) => {
        resolveSubmit = () =>
          res([
            { lineId: req.tickets[0].lineId, key: req.tickets[0].key, ok: true, ticketKey: '7_00', error: '' },
            { lineId: req.tickets[1].lineId, key: req.tickets[1].key, ok: false, ticketKey: '', error: '마감' },
          ]);
      });
    },
  });
  const p = openPanel(host);
  p.toggleGate(3);
  assert.ok(p.addPreviewToBasket(previewAdditions(p)));
  assert.ok(p.addPreviewToBasket(previewAdditions(p))); // 같은 줄 두 장
  p.answers.push(true);
  const flight = p.submit();
  await flushSubmitCall(host);
  p.hide(); // 날아간 사이에 닫힘
  resolveSubmit();
  await flight;
  assert.equal(p.draft.lines.length, 1); // 닫혀 있어도 수락 줄 빠짐
  assert.equal(p.draft.lines[0].error, '마감'); // 실패 사유 남음
  p.opened = true; // 다시 열기
  p.openGen += 1;
  assert.equal(p.draft.lines.length, 1); // 다시 열어도 부활 없음
  assert.equal(p.draft.lines[0].error, '마감');
});

test('보내는 동안 같은 줄의 다른 구매는 막는다', async () => {
  let resolveSubmit = null;
  const host = mockHost({
    async submit(req) {
      this.calls.submit++;
      return new Promise((res) => {
        resolveSubmit = () => res(req.tickets.map((t) => ({ ...t, ok: true, ticketKey: '7_00', error: '' })));
      });
    },
  });
  const p = openPanel(host);
  p.toggleGate(3);
  assert.ok(p.addPreviewToBasket(previewAdditions(p)));
  p.answers.push(true);
  const flight = p.submit();
  await flushSubmitCall(host);
  await p.submit(); // 겹호출: 보내지 않는다
  assert.equal(host.calls.submit, 1);
  assert.ok(host.calls.toasts.some((t) => /사는 중/.test(t.msg)));
  resolveSubmit();
  await flight;
  assert.equal(p.draft, null); // 전부 수락돼 바구니 비움
});

test('결과에 없는 줄은 이전 사유를 유지하고 예외는 바구니를 그대로 둔다', async () => {
  const host = mockHost({
    async submit() {
      this.calls.submit++;
      return []; // 이번엔 결과 없음
    },
  });
  const p = openPanel(host);
  p.toggleGate(3);
  assert.ok(p.addPreviewToBasket(previewAdditions(p)));
  p.draft.lines[0].error = '마감'; // 이전 실패 사유
  p.answers.push(true);
  await p.submit();
  assert.equal(p.draft.lines.length, 1);
  assert.equal(p.draft.lines[0].error, '마감'); // 지워지지 않음

  const host2 = mockHost({
    async submit() {
      this.calls.submit++;
      throw new Error('끊겼다');
    },
  });
  const p2 = openPanel(host2);
  p2.toggleGate(3);
  assert.ok(p2.addPreviewToBasket(previewAdditions(p2)));
  p2.answers.push(true);
  await p2.submit();
  assert.equal(p2.draft.lines.length, 1); // 그대로
  const errs = host2.calls.toasts.filter((t) => t.err);
  assert.equal(errs.length, 1); // 유용한 오류 하나
  assert.ok(errs[0].msg.includes('끊겼다'));
});

test('견적을 확인할 수 없으면 담지도 보내지도 않는다', async () => {
  const host = mockHost({
    quote() {
      throw new Error('견적 실패');
    },
  });
  const p = openPanel(host);
  p.toggleGate(3);
  assert.equal(p.addPreviewToBasket(previewAdditions(p)), false); // 담기 불가
  assert.equal(p.draft, null);
  // 견적 없이 직접 넣은 줄도 서명 불가
  p.draft = { draftId: 'dX', rev: 1, raceN: 7, lines: [
    { lineId: 'dX#1', key: 'W:3', kind: 'W', legs: [3], stake: 100, odds: null, est: null, error: '' },
  ] };
  p.answers.push(true);
  await p.submit();
  assert.equal(host.calls.submit, 0);
});

test('줄마다 승식·금액을 싣고 배치 단위 값은 보내지 않는다', async () => {
  let gotReq = null;
  const host = mockHost({
    async submit(req) {
      this.calls.submit++;
      gotReq = req;
      return req.tickets.map((t) => ({ ...t, ok: true, ticketKey: '7_00', error: '' }));
    },
  });
  const p = openPanel(host);
  p.toggleGate(3); // W 3번 100원
  assert.ok(p.addPreviewToBasket(previewAdditions(p)));
  p.kind = 'Q'; // 승식 바꾸면 선택은 비워진다 (실제 탭 동작과 같다)
  p.single.clear();
  p.stake = 200;
  p.toggleGate(1);
  p.toggleGate(2); // Q 1-2 200원
  assert.ok(p.addPreviewToBasket(previewAdditions(p)));
  assert.equal(p.draft.lines.length, 2);
  host.calls.quoteArgs.length = 0; // 미리보기 견적 기록 비움: 호출 단계만 본다
  p.answers.push(true);
  await p.submit();
  assert.equal(host.calls.submit, 1);
  assert.ok(!('kind' in gotReq) && !('stakePerCombo' in gotReq)); // 배치 값 없음
  assert.deepEqual(gotReq.tickets.map((t) => [t.key, t.kind, t.stake]), [
    ['W:3', 'W', 100],
    ['Q:1-2', 'Q', 200],
  ]);
  assert.equal(host.calls.quoteArgs.length, 4); // 호출 전 검증 2회 × 묶음 2개
  assert.deepEqual(host.calls.quoteArgs[0][0], 'W');
  assert.deepEqual(host.calls.quoteArgs[1], ['Q', [[1, 2]], 200]);
});
