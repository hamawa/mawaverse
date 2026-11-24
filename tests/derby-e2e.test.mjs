// 경마공원 끝까지 시험 (로컬 에뮬레이터 전용, 실제 시간으로 돈다: 한 경주 6분이라 최대 약 8분 걸린다). 운영 PC·운영 프로그램 없이:
// 진짜 배포 규칙(npm run emulators 가 올린 database.rules.deploy.json) · 진짜 지갑 코드(WalletMgr) · 진짜 발매 연결(DerbyLive)로,
// 시험 플레이어가 경마공원 창구 앞에서 코인으로 마권을 사고 → 마감 뒤 그 화면이 추첨을 쓰고 → 숨은 결과표를 2진수 앞자리 묻기로 공개하고 →
// 고정 배당대로 적중금을 받는지(영수증·잔액) 본다. 거부돼야 하는 쓰기·읽기(숨은 결과표 읽기, 마감 전 추첨, 두 번째 추첨, 마감 뒤 구매,
// 꾸민 공개, 꾸민·부풀린 환급)도 같은 규칙에 대 본다.
// 실행: 터미널 1 npm run emulators → 터미널 2 node --test tests/derby-e2e.test.mjs   (에뮬레이터가 없으면 건너뛴다. npm test 에는 넣지 않았다)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const up = await fetch('http://127.0.0.1:9099/', { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);

test('경마공원: 에뮬레이터에서 코인으로 마권을 사고, 마감 뒤 화면이 추첨·공개하고, 고정 배당대로 적중금을 받는다', { skip: !up && 'Auth 에뮬레이터(127.0.0.1:9099)가 없습니다. npm run emulators 를 먼저 실행하세요.', timeout: 15 * 60000 }, async () => {
  const { seedDerbyEmulator, SEED, ownerPatch, ownerGet } = await import('../tools/derby-emulator-seed.mjs');
  const seed = await seedDerbyEmulator({ log: (m) => console.log(`[seed] ${m}`) });
  const uid = seed.playerUid, P = SEED.player, spot = SEED.spawn, occKey = `race-park~${spot.x}_${spot.y}`;
  await ownerPatch({ [`players/${uid}`]: null, [`occ/${occKey}`]: null });

  // 화면 코드가 쓰는 firebase/app 설정 모듈(import.meta.env·location 을 읽는다)만 이 시험의 에뮬레이터 앱으로 바꾼다
  const stub = (s) => ({ url: `data:text/javascript,${encodeURIComponent(s)}`, shortCircuit: true });
  registerHooks({
    resolve(spec, ctx, next) {
      if (spec.endsWith('/derbyui.css')) return stub('export default {};');
      if (spec === '../firebase/app' || (spec === './app' && ctx.parentURL?.endsWith('/src/firebase/db.ts'))) {
        return stub('export const app = globalThis.__derbyE2E.app, auth = globalThis.__derbyE2E.auth, db = globalThis.__derbyE2E.db, useEmulator = true, isConfigured = true;');
      }
      try { return next(spec, ctx); } catch (e) {
        if (spec.startsWith('.') && !/\.[cm]?[jt]s$/.test(spec)) return next(`${spec}/index.ts`, ctx); // 폴더 모듈 (sprites/)
        throw e;
      }
    },
  });
  const { initializeApp, deleteApp } = await import('firebase/app');
  const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = await import('firebase/auth');
  const { getDatabase, connectDatabaseEmulator, ref, get, set, onValue, update, increment, serverTimestamp } = await import('firebase/database');
  const { emailFor, pwKey } = await import('../src/firebase/auth.ts');
  const app = initializeApp({ apiKey: 'demo-api-key', authDomain: 'demo-mawaverse.firebaseapp.com', projectId: 'demo-mawaverse', databaseURL: 'https://demo-mawaverse-default-rtdb.firebaseio.com', appId: 'demo-app' }, 'derby-e2e');
  const auth = getAuth(app), db = getDatabase(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectDatabaseEmulator(db, '127.0.0.1', 9000);
  globalThis.__derbyE2E = { app, auth, db };

  const until = async (label, ok, ms) => {
    const end = Date.now() + ms;
    while (!ok()) {
      if (Date.now() > end) throw new Error(`시간 초과: ${label}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  // 규칙이 거부해야 하는 요청: permission_denied 로 끝나야 한다
  const denied = async (label, fn) => {
    const err = await fn().then(() => null, (e) => e);
    assert.ok(err && /permission/i.test(String(err.message)), `거부돼야 함: ${label} (${err ? err.message : '허용됨'})`);
    console.log(`[e2e] 거부 확인: ${label}`);
  };

  let wallet = null, live = null, timer = null, inBranch = null;
  try {
    await signInWithEmailAndPassword(auth, emailFor(P.id), pwKey(P.id, P.pw));
    // 공원 창구 앞에 선다 (Net.join 과 같은 모양: 접속 표시 + 자리를 쓰기 한 번에. 규칙이 자리와 접속 표시를 대조한다)
    await update(ref(db), {
      [`players/${uid}`]: { n: P.nick, a: P.avatar, x: spot.x, y: spot.y, d: spot.d, s: 'derby-e2e', m: spot.m, hb: serverTimestamp() },
      [`occ/${occKey}`]: uid,
    });

    const D = await import('../src/shared/derby.ts');
    const { normalizeRaceHours } = await import('../src/shared/config.ts');
    const { parseBreaks } = await import('../src/shared/hours.ts');
    const { serverNow, serverTimeReady } = await import('../src/firebase/db.ts');
    const { WalletMgr } = await import('../src/game/wallet.ts');
    const { DerbyLive } = await import('../src/game/derbyview.ts');
    await serverTimeReady();
    const toasts = [];
    const profile = (await get(ref(db, `users/${uid}`))).val(); // world.ts 처럼 로그인 때 읽은 내 프로필 (지갑이 보유 품목을 본다)
    wallet = new WalletMgr({ uid, profile, toast: (m) => { toasts.push(m); console.log(`[toast] ${m}`); }, events: { emit() {} } });
    wallet.start();
    await until('지갑 읽기', () => wallet.loaded, 20000);
    const hours = normalizeRaceHours((await get(ref(db, 'config/raceHours'))).val());
    const env = { holidays: JSON.parse(readFileSync(new URL('../holidays.json', import.meta.url), 'utf8')), breaks: parseBreaks(JSON.parse(readFileSync(new URL('../hours.json', import.meta.url), 'utf8')).breaks), hoursBlock: false };
    const cap = (await get(ref(db, 'config/raceMax/park'))).val();
    // DerbyLive 에는 진짜 지갑을 그대로 넘긴다. 환급만 시험이 문을 열 때까지 미룬다 (공개 뒤·환급 전에 꾸민 환급이 거부되는지 보려고)
    let openSettle;
    const settleGate = new Promise((r) => { openSettle = r; });
    const calls = { draw: {}, reveal: {} };
    const liveWallet = {
      derbySpent: (n) => wallet.derbySpent(n), derbyNextIndex: (n) => wallet.derbyNextIndex(n), listen: (cb) => wallet.listen(cb),
      buyDerby: (...a) => wallet.buyDerby(...a),
      // 경주별로 센다: 시험이 사는 경주를 기다리는 동안 마감한 앞 경주도 이 화면이 추첨·공개한다
      drawDerby: (n) => { calls.draw[n] = (calls.draw[n] ?? 0) + 1; return wallet.drawDerby(n); },
      revealDerby: (n) => { calls.reveal[n] = (calls.reveal[n] ?? 0) + 1; return wallet.revealDerby(n); },
      settleDerby: async (n) => { await settleGate; return wallet.settleDerby(n); },
    };
    live = new DerbyLive({
      where: 'park', uid, now: serverNow, hours: () => hours, env: () => env, cap: () => cap,
      watch: (path, cb) => onValue(ref(db, path), (s) => cb(s.val()), () => {}),
      read: async (path) => (await get(ref(db, path))).val(),
      wallet: liveWallet, toast: (m, e) => { toasts.push(m); console.log(`[toast${e ? ' 오류' : ''}] ${m}`); },
    });
    timer = setInterval(() => live.tick(serverNow()), 250);

    // 결과표가 덮은 발매 중 경주를, 마감까지 25초 넘게 남았을 때 산다 (그 경주를 놓쳤으면 다음 경주를 기다린다)
    let n = -1;
    await until('발매 중 경주', () => { n = D.raceNo(serverNow()); const s = live.sale(n); return s?.status === 'selling' && s.sellable && s.closesInMs > 45000; }, 7 * 60000);
    console.log(`[e2e] 제${n}경주 발매 중 (마감까지 ${Math.round(live.sale(n).closesInMs / 1000)}초, 결과표 ${seed.cover.s}~${seed.cover.e - 1})`);
    await denied('숨은 결과표 읽기', () => get(ref(db, `raceSecret/${n}`)));
    await denied('마감 전 추첨', () => set(ref(db, `race/x/${n}/at`), serverTimestamp()));
    await denied('추첨 전 묻기', () => set(ref(db, `race/q/${n}/1`), null));

    await wallet.settleDerby(); // 앞선 시험이 남긴 마권의 로그인 정산이 끝난 뒤의 잔액에서 센다 (정산은 탭 안에서 차례로 돈다)
    const start = wallet.balance;
    const gates = [1, 2, 3, 4, 5, 6, 7, 8];
    const tickets = [
      ...gates.map((g) => ({ kind: 'W', legs: [g], stake: 100 })),  // 단승 8마리: 꼭 한 장은 맞는다
      ...gates.map((g) => ({ kind: 'P', legs: [g], stake: 100 })),  // 연승 8마리: 꼭 세 장은 맞는다
      { kind: 'Q', legs: [5, 2], stake: 200 }, { kind: 'E', legs: [2, 5], stake: 100 }, { kind: 'R', legs: [1, 3], stake: 100 },
    ].map((t, i) => ({ ...t, lineId: `e2e#${i}`, key: `${t.kind}:${t.legs.join('-')}` }));
    const total = tickets.reduce((s, t) => s + t.stake, 0);
    const seenAuth = live.sale(n).authEpoch;
    const out = await live.submit({ confirmId: 'c1', draftId: 'e2e', where: 'park', seenN: n, seenAuth, tickets });
    assert.deepEqual(out.filter((l) => !l.ok).map((l) => l.error), [], '모든 장이 팔려야 한다');
    assert.equal(new Set(out.map((l) => l.ticketKey)).size, tickets.length);
    await until('지갑 차감 반영', () => wallet.balance === start - total, 20000);
    let rows = (await get(ref(db, `race/t/${n}/${uid}`))).val();
    assert.equal(Object.keys(rows).length, tickets.length);
    for (const r of Object.values(rows)) assert.equal(r.od, D.raceOdds(n, r.t, Number(r.s1), r.s2 === undefined ? -1 : Number(r.s2)), '마권에 발표 때의 고정 배당이 적힌다');
    const acct = live.account(n);
    assert.deepEqual([acct.spent, acct.ticketUsed, acct.tickets.length], [total, tickets.length, tickets.length]);
    assert.ok(acct.tickets.every((t) => t.status === 'sold'));
    console.log(`[e2e] ${tickets.length}장 · ${total} 코인 구매, 잔액 ${start} → ${wallet.balance}`);

    // 한도: 이 경주에 이미 산 금액 + 새 금액이 공원 한도(config/raceMax/park)를 넘으면 지갑이 막는다 (코인이 빠지지 않는다)
    const over = await live.submit({ confirmId: 'c2', draftId: 'e2e2', where: 'park', seenN: n, seenAuth, tickets: [{ lineId: 'cap#0', key: 'W:1', kind: 'W', legs: [1], stake: cap - total + 100 }] });
    assert.deepEqual(over.map((l) => [l.ok, l.error]), [[false, '이 경주 구매 한도를 넘어요.']]);
    assert.equal(wallet.balance, start - total);

    // 경마분점: 광장 카지노 방에 앉아(world.seatInRoom 과 같은 모양: 방 등록 + 접속 표시 r='casino' + 방 안 자리를 쓰기 한 번에) 같은 경주를 산다.
    // 분점 한도(config/raceMax/branch)는 공원에서 산 금액과 합산해 본다 (지갑 kt · race/u 장부. 규칙도 같은 값을 본다)
    const capB = (await get(ref(db, 'config/raceMax/branch'))).val();
    const occB = `${SEED.branchSeat.x}_${SEED.branchSeat.y}`;
    await update(ref(db), {
      'rooms/casino/cap': 8, 'rooms/casino/round': 1, 'rooms/casino/state': 'open',
      [`rooms/casino/members/${uid}`]: { n: P.nick, ready: false, losses: 0, at: serverNow() },
      [`players/${uid}/m`]: null, [`players/${uid}/x`]: SEED.branchSeat.x, [`players/${uid}/y`]: SEED.branchSeat.y, [`players/${uid}/d`]: 0, [`players/${uid}/r`]: 'casino',
      [`occ/${occKey}`]: null, [`occ/${occB}`]: uid,
    });
    inBranch = occB;
    const liveB = new DerbyLive({
      where: 'branch', uid, now: serverNow, hours: () => hours, env: () => env, cap: () => capB,
      watch: (path, cb) => onValue(ref(db, path), (s) => cb(s.val()), () => {}),
      read: async (path) => (await get(ref(db, path))).val(),
      wallet: liveWallet, toast: (m, e) => { toasts.push(m); console.log(`[toast${e ? ' 오류' : ''}] ${m}`); },
    });
    const timerB = setInterval(() => liveB.tick(serverNow()), 250);
    const stakeB = capB - total; // 공원 total + 분점 stakeB = 분점 한도
    try {
      await until('분점 발매 중', () => liveB.sale(n)?.status === 'selling', 10000);
      const seenB = liveB.sale(n).authEpoch;
      const outB = await liveB.submit({ confirmId: 'b1', draftId: 'e2eB', where: 'branch', seenN: n, seenAuth: seenB, tickets: [{ lineId: 'b#0', key: 'Q:3-4', kind: 'Q', legs: [3, 4], stake: stakeB }] });
      assert.deepEqual(outB.map((l) => [l.ok, l.error]), [[true, '']], '분점에서 산다');
      const overB = await liveB.submit({ confirmId: 'b2', draftId: 'e2eB2', where: 'branch', seenN: n, seenAuth: seenB, tickets: [{ lineId: 'b#1', key: 'W:1', kind: 'W', legs: [1], stake: 100 }] });
      assert.deepEqual(overB.map((l) => [l.ok, l.error]), [[false, '이 경주 구매 한도를 넘어요.']], '공원 + 분점 합계가 분점 한도에 닿았다');
    } finally { clearInterval(timerB); liveB.close(); }
    await until('분점 차감 반영', () => wallet.balance === start - total - stakeB, 20000);
    rows = (await get(ref(db, `race/t/${n}/${uid}`))).val();
    assert.equal(Object.keys(rows).length, tickets.length + 1);
    const ledgerB = (await get(ref(db, `race/u/${uid}/${n}`))).val();
    assert.deepEqual([ledgerB.s, ledgerB.c], [capB, tickets.length + 1], '공원·분점 한 장부');
    console.log(`[e2e] 분점(광장 카지노 방)에서 ${stakeB} 코인 구매 · 이 경주 합계 ${ledgerB.s} = 분점 한도 ${capB}, 잔액 ${wallet.balance}`);
    const paidIn = total + stakeB;

    // 마감 → 이 화면(DerbyLive)이 추첨을 쓰고 바로 공개한다 (운영 PC 없음)
    const closeAt = D.cycleStart(n) + D.DERBY_SALE_MS;
    const W = `wallet/${uid}`;
    await until('마감', () => serverNow() >= closeAt, closeAt - serverNow() + 10000);
    const ledger0 = (await get(ref(db, `race/u/${uid}/${n}`))).val();
    const nn = String(ledger0.c).padStart(2, '0'), od = D.raceOdds(n, 'W', 0);
    await denied('마감 뒤 구매', () => update(ref(db), {
      [`${W}/c`]: increment(-100), [`${W}/sp`]: increment(100), [`${W}/b`]: 'derby', [`${W}/gt`]: null,
      [`${W}/kd`]: String(n), [`${W}/kb`]: nn, [`${W}/kt`]: ledger0.s + 100,
      [`race/t/${n}/${uid}/${nn}`]: { t: 'W', s1: '0', a: 100, od }, [`race/u/${uid}/${n}/i`]: true,
      [`race/u/${uid}/${n}/s`]: ledger0.s + 100, [`race/u/${uid}/${n}/c`]: ledger0.c + 1,
    }));
    await until('추첨과 공개', () => live.sale(n)?.status === 'done', 60000);
    const x = (await get(ref(db, `race/x/${n}`))).val();
    assert.ok(typeof x.at === 'number' && x.at >= closeAt, '추첨 시각은 마감 뒤 서버 시각');
    assert.equal(calls.draw[n], 1, '이 화면이 추첨했다');
    assert.equal(calls.reveal[n], 1, '추첨한 화면이 바로 공개했다');
    const digits = D.derbyBitsDigits(x.o.slice(0, D.DERBY_SECRET_BITS));
    assert.deepEqual({ a: x.a, b: x.b, c: x.c, e: x.e }, D.derbyResolve(n, digits).res, '공개된 결과 = 그 숫자의 결과');
    assert.equal(x.o, D.derbySecretEntry(n, digits));
    let probes = 0;
    for (let i = 0; i < D.DERBY_SECRET_BITS; i++) if (D.derbyBitMayBeOne(x.o.slice(0, i))) probes++;
    console.log(`[e2e] 제${n}경주 추첨 칸 ${x.at % D.DERBY_DRAW_SLOTS}, 숫자 ${digits}, 착순 ${x.a}-${x.b}-${x.c} (인기 순위), 일어난 일 ${x.e}, 묻기 ${probes}번`);
    assert.equal(await ownerGet(`race/q/${n}`), null, '묻기는 아무것도 남기지 않는다');

    // 공개 뒤 · 환급 전: 꾸민 쓰기는 규칙이 막는다
    assert.equal(await wallet.drawDerby(n), false, '두 번째 추첨은 거부된다');
    await denied('두 번째 추첨', () => set(ref(db, `race/x/${n}/at`), serverTimestamp()));
    const fake = D.derbySecretEntry(n, digits === '0000000' ? '0000001' : '0000000'), fr = D.derbyResolve(n, digits === '0000000' ? '0000001' : '0000000').res;
    await denied('꾸민 공개', () => update(ref(db, `race/x/${n}`), { o: fake, ...fr }));
    const res = { a: x.a, b: x.b, c: x.c, e: x.e };
    const entries = Object.entries(rows);
    const [winNn, winRow] = entries.find(([, r]) => D.ticketWins(r, res));
    const [loseNn] = entries.find(([, r]) => !D.ticketWins(r, res));
    const claimOf = (k, amount) => ({ [`${W}/c`]: increment(amount), [`${W}/e`]: increment(amount), [`${W}/kn`]: String(n), [`${W}/kr`]: k, [`race/u/${uid}/${n}/${k}`]: true });
    const winPay = D.ticketPayout(winRow.a, winRow.od);
    await denied('부풀린 적중금', () => update(ref(db), claimOf(winNn, winPay + 100)));
    await denied('낙첨 마권의 적중금', () => update(ref(db), claimOf(loseNn, 100)));
    assert.equal(wallet.balance, start - paidIn);

    // 환급: DerbyLive 가 settleDerby(n) 으로 받는다
    let want = 0;
    for (const r of Object.values(rows)) if (D.ticketWins(r, res)) want += D.ticketPayout(r.a, r.od);
    openSettle();
    await until('적중금 반영', () => wallet.balance === start - paidIn + want, 30000);
    let ledger = null;
    for (let i = 0; i < 40 && !Object.keys(rows).every((k) => ledger?.[k] === true); i++) { // 낙첨 마권의 0원 영수증은 적중금 뒤에도 이어서 쓰인다
      ledger = (await get(ref(db, `race/u/${uid}/${n}`))).val();
      await new Promise((r) => setTimeout(r, 250));
    }
    for (const k of Object.keys(rows)) assert.equal(ledger[k], true, `영수증 ${k}`);
    await until('판 갱신', () => live.account(n).tickets.every((t) => t.status === 'won' || t.status === 'lost'), 10000);
    const after = live.account(n);
    assert.equal(after.tickets.filter((t) => t.kind === 'W' && t.status === 'won').length, 1);
    assert.equal(after.tickets.filter((t) => t.kind === 'P' && t.status === 'won').length, 3);
    assert.equal(after.tickets.reduce((s, t) => s + t.payout, 0), want);
    assert.deepEqual(after.standings, live.result(n).order.slice(0, 3));
    assert.ok(toasts.some((m) => m.includes(`제${n}경주 적중`)));
    await denied('이미 받은 마권 다시 받기', () => update(ref(db), claimOf(winNn, winPay)));
    assert.equal(wallet.balance, start - paidIn + want);
    console.log(`[e2e] 적중금 ${want} (고정 배당 그대로), 잔액 ${start} → ${wallet.balance}, 영수증 ${Object.keys(rows).length}장`);
  } finally {
    if (timer) clearInterval(timer);
    live?.close();
    wallet?.stop();
    await update(ref(db), { [`players/${uid}`]: null, [inBranch ? `occ/${inBranch}` : `occ/${occKey}`]: null, ...(inBranch ? { [`rooms/casino/members/${uid}`]: null } : {}) }).catch(() => {});
    await deleteApp(app).catch(() => {});
    setTimeout(() => process.exit(process.exitCode ?? 0), 1000).unref();
  }
});
