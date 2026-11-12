// 새 규칙 시험: PRE 경로(기본 rtest/, 실제 경로는 PRE= 로) 아래에서 가짜 uid 로 "허용돼야 할 쓰기"와 "막혀야 할 쓰기"를 실제로 해 본다.
// 사용: node tools/rules-test.mjs  (시험용 경로 rtest/, 먼저 gen-rules.cjs sandbox 를 배포)  |  PRE= GRACE=1 node tools/rules-test.mjs  (실제 경로, 유예 기간 중)
// serviceAccount.json 필요. 끝나면 시험 데이터는 지운다.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase, ServerValue } from 'firebase-admin/database';
const sa = JSON.parse(readFileSync('serviceAccount.json', 'utf8'));
// DB 주소는 .env.local 의 VITE_FIREBASE_DATABASE_URL (또는 환경변수 DATABASE_URL) 에서 읽는다
const databaseURL = process.env.DATABASE_URL || (/^\s*VITE_FIREBASE_DATABASE_URL\s*=\s*["']?([^"'\r\n]+)/m.exec(readFileSync('.env.local', 'utf8')) || [])[1];
if (!databaseURL) throw new Error('.env.local 의 VITE_FIREBASE_DATABASE_URL 또는 환경변수 DATABASE_URL 이 필요합니다.');
const rootDb = getDatabase(initializeApp({ credential: cert(sa), databaseURL }));
const T = 'zz-rules-test';
const userDb = getDatabase(initializeApp({ credential: cert(sa), databaseURL, databaseAuthVariableOverride: { uid: T } }, 'asUser'));
// 관리자인 척: admins 에 등록된 첫 uid
const ADMIN_UID = Object.keys((await rootDb.ref('admins').get()).val() || {})[0];
const adminDb = getDatabase(initializeApp({ credential: cert(sa), databaseURL, databaseAuthVariableOverride: { uid: ADMIN_UID } }, 'asAdmin'));
const ONLY_WALLET = process.env.ONLY === 'wallet'; // 실제 경로에서 프로필·접속 노드를 만들지 않고 지갑 규칙만 본다
const PRE = process.env.PRE ?? 'rtest/';
const WP = `${PRE}wallet/${T}`, UP = `${PRE}users/${T}`, PP = `${PRE}players/${T}`;
const TS = ServerValue.TIMESTAMP;
const prices = (await rootDb.ref('config/prices').get()).val();
// 배포된 규칙은 가입 승인된 계정만 통과시킨다(tools/gen-gate.cjs): 시험 계정을 승인 목록에 넣었다가 끝에 뺀다.
// 평일 09~18시(KST)에는 관리자가 아닌 계정의 쓰기가 전부 거부되므로 그 시간에는 결과가 맞지 않는다
await rootDb.ref('approved').update({ [T]: true, 'zz-rules-gift': true });
// 가짜 uid 로 바꿔 쓰는 연결이 실제로 그 uid 로 인증될 때까지 기다린다. 에뮬레이터에서는 처음 몇 초 동안 관리 권한으로 붙어 있어 "거부돼야 할 쓰기"가 전부 통과했다 (2026-11-11).
// 관리자만 쓸 수 있는 칸에 써 보고 거부되면 준비된 것 (통과한 값은 지운다)
for (let i = 0; ; i++) {
  let denied = false;
  try { await userDb.ref('config/zzProbe').set(true); } catch { denied = true; }
  if (denied) break;
  await rootDb.ref('config/zzProbe').remove();
  if (i >= 40) { console.error('가짜 uid 인증이 적용되지 않는다 (config 쓰기가 계속 통과). 중단'); process.exit(1); }
  await new Promise((r) => setTimeout(r, 500));
}
const kstToday = () => { const t = Date.now() + 32400000; return t - (t % 86400000); };
let pass = 0, fail = 0;
const seed = (w) => rootDb.ref(WP).set(w);
const cur = async () => (await rootDb.ref(WP).get()).val();
async function expect(want, label, fn) {
  let got = 'allow', err = '';
  try { await fn(); } catch (e) { got = 'deny'; err = e.code || e.message; }
  const ok = got === want;
  if (ok) pass++; else fail++;
  console.log((ok ? '  ok  ' : '  FAIL') + ` [${want === 'allow' ? '허용' : '거부'} 기대] ${label}` + (ok ? '' : ` → 실제 ${got} ${err}`));
}
const W = (obj) => userDb.ref(WP).set(obj);

console.log('가격표: straw', prices.straw, 'autoreel', prices.autoreel, 'bait', prices.bait, 'wave', prices.wave, 'petfood', prices.petfood, 'scroll', prices.scroll, '| 경로 접두사:', JSON.stringify(PRE));
if (!prices.petfood || !prices.scroll) { console.error('config/prices 에 petfood·scroll 이 없다. 먼저 넣을 것'); process.exit(1); }
// A. 획득 (2026-11-10 속도 상한 삭제: 금액 제한 없음. 옛 wt/we 칸은 있어도 무시)
await seed({ c: 5000, e: 5000 });
await expect('allow', 'A1 획득 +50', () => W({ c: 5050, e: 5050 }));
let w = await cur();
await expect('allow', 'A2 한 번에 +5000 (상한 없음)', () => W({ ...w, c: w.c + 5000, e: w.e + 5000 }));
w = await cur();
await expect('deny', 'A5 잔액만 +500', () => W({ ...w, c: w.c + 500 }));
await expect('deny', 'A7 누적 획득 줄이기', () => W({ ...w, e: w.e - 1 }));
await seed({ c: 100, e: 100, wt: Date.now() - 5000, we: 3000, md: kstToday() });
w = await cur();
await expect('allow', 'A8 옛 창(wt/we/md)이 꽉 찬 지갑에도 획득 +10 (칸을 지우며)', () => W({ c: 110, e: 110 }));
await expect('allow', 'A9 옛 칸을 그대로 둔 채 획득', () => W({ ...w, c: 120, e: 120 }));
// D. 룰렛
await seed({ c: 0, e: 0 });
await expect('deny', 'D13 날짜를 엉뚱한 값으로 바꾸며 +1000', () => W({ c: 1000, e: 1000, rd: kstToday() + 86400000 }));
await expect('deny', 'D14 날짜를 문자열로 바꾸며 +1000', () => W({ c: 1000, e: 1000, rd: 'aaaaaaaa' }));
await expect('allow', 'D15 오늘 룰렛 +1000', () => W({ c: 1000, e: 1000, rd: kstToday() }));
w = await cur();
await expect('allow', 'D16 같은 날 rd 그대로 +1000 (2026-11-10 획득 상한이 없어져 보통 획득과 구분 못 함. 룰렛 중복은 클라이언트가 rd 로 막는다)', () => W({ ...w, c: 2000, e: 2000 }));
await seed({ c: 0, e: 0, rd: '20261105' });
await expect('allow', 'D17 옛 문자열 날짜에서 오늘로 (+500)', () => W({ c: 500, e: 500, rd: kstToday() }));
// E. 사용
await seed({ c: 5000, e: 5000 });
await expect('deny', 'E18 돈 안 내고 자동 낚시 시간 쓰기', () => W({ c: 5000, e: 5000, ar: Date.now() + 600000 }));
await expect('deny', 'E19 자동 낚시를 1코인에', () => W({ c: 4999, e: 5000, sp: 1, b: 'autoreel', ar: Date.now() + 600000 }));
await expect('deny', 'E20 사용액만 적고 잔액은 그대로', () => W({ c: 5000, e: 5000, sp: prices.autoreel, b: 'autoreel', ar: Date.now() + 600000 }));
await expect('deny', 'E21 자동 낚시 10분을 사고 시간은 70분으로 (상한 61분)', () => W({ c: 5000 - prices.autoreel, e: 5000, sp: prices.autoreel, b: 'autoreel', ar: Date.now() + 4200000 }));
await expect('deny', 'E21b 자동 낚시 1시간을 10분 값에', () => W({ c: 5000 - prices.autoreel, e: 5000, sp: prices.autoreel, b: 'autoreel60', ar: Date.now() + 3600000 }));
await expect('allow', 'E21c 자동 낚시 1시간 정상 구매 (autoreel60)', () => W({ c: 5000 - prices.autoreel60, e: 5000, sp: prices.autoreel60, b: 'autoreel60', ar: Date.now() + 3600000 }));
w = await cur();
await expect('allow', 'E21d 자동 채집 30분 정상 구매 (autobug30)', () => W({ ...w, c: w.c - prices.autobug30, sp: w.sp + prices.autobug30, b: 'autobug30', ab: Date.now() + 1800000 }));
w = await cur();
await expect('allow', 'E21e 자동 낚시가 켜진 채로 10분 더 (이어 붙이기, 상한 안)', () => W({ ...w, c: w.c - prices.autoreel, sp: w.sp + prices.autoreel, b: 'autoreel', ar: Math.min(w.ar + 600000, Date.now() + 3600000) }));
await expect('deny', 'E21f 자동 낚시 10분 값으로 시간을 상한 너머로', () => W({ ...w, c: w.c - prices.autoreel, sp: w.sp + prices.autoreel, b: 'autoreel', ar: Date.now() + 3700000 }));
await seed({ c: 5000, e: 5000 });
await expect('deny', 'E22 돈 안 내고 구매 표시만 바꾸기 (b=wave)', () => W({ c: 5000, e: 5000, b: 'wave' }));
await expect('allow', 'E23 자동 낚시 정상 구매', () => W({ c: 5000 - prices.autoreel, e: 5000, sp: prices.autoreel, b: 'autoreel', ar: Date.now() + 600000 }));
w = await cur();
await expect('deny', 'E24 구매 없이 자동 낚시 시간 늘리기', () => W({ ...w, ar: w.ar + 1000 }));
await expect('deny', 'E25 미끼 5개를 1개 값에', () => W({ ...w, c: w.c - prices.bait, sp: w.sp + prices.bait, b: 'bait', bait: 5 }));
await expect('deny', 'E26 돈 안 내고 미끼 늘리기', () => W({ ...w, bait: 3 }));
await expect('deny', 'E27 자동 낚시 값으로 미끼까지 같이', () => W({ ...w, c: w.c - prices.autoreel, sp: w.sp + prices.autoreel, b: 'autoreel', ar: Date.now() + 600000, bait: 3 }));
await expect('allow', 'E28 미끼 5개 정상 구매', () => W({ ...w, c: w.c - prices.bait * 5, sp: w.sp + prices.bait * 5, b: 'bait', bait: 5 }));
w = await cur();
await expect('allow', 'E29 미끼 하나 쓰기', () => W({ ...w, bait: 4 }));
await expect('deny', 'E30 누적 사용액 줄이기', () => W({ ...w, sp: w.sp - 1 }));
await expect('allow', 'E31 자동 채집 정상 구매', () => W({ ...w, bait: 4, c: w.c - prices.autobug, sp: w.sp + prices.autobug, b: 'autobug', ab: Date.now() + 600000 }));
// H. 관리자 지급 (관리자 페이지의 코인 지급/회수)
await seed({ c: 1000, e: 1000 });
w = await cur();
await expect('deny', 'H53 본인이 지급 표시(gf)를 만들어 +500', () => W({ ...w, c: 1500, e: 1500, gf: { n: 500, at: Date.now() } }));
await expect('deny', 'H54 본인이 지급 표시만 쓰기', () => W({ ...w, gf: { n: 500, at: Date.now() } }));
await expect('allow', 'H55 관리자가 +500 지급', () => adminDb.ref(WP).set({ ...w, c: 1500, e: 1500, gf: { n: 500, at: TS } }));
w = await cur();
await expect('allow', 'H56 지급받은 뒤 본인의 보통 획득 (gf 그대로)', () => W({ ...w, c: w.c + 50, e: w.e + 50 }));
w = await cur();
await expect('deny', 'H57 본인이 지급 표시의 금액 고치기', () => W({ ...w, gf: { ...w.gf, n: 99999 } }));
await expect('allow', 'H58 관리자가 300 회수', () => adminDb.ref(WP).set({ ...w, c: w.c - 300, gf: { n: -300, at: TS } }));
await expect('allow', 'H59 관리자가 한 번에 +50000 지급 (상한 제외)', () => adminDb.ref(WP).set({ c: 60000, e: 60000, gf: { n: 50000, at: TS } }));
if (!ONLY_WALLET) {
// F. 보유·착용
if (PRE === '') {
  // 실제 경로: 프로필과 접속 노드가 온전해야 자식 칸을 쓸 수 있다 (users·players 의 노드 단위 규칙)
  await rootDb.ref(UP).set({ id: 'zz-rules-test', nick: '규칙시험', avatar: 'm01', losses: 0 });
  await rootDb.ref(PP).set({ n: '규칙시험', a: 'm01', x: 1, y: 1, d: 0, s: 'rules-test', hb: Date.now(), j: Date.now() });
} else { await rootDb.ref(UP).remove(); await rootDb.ref(PP).remove(); }
await seed({ c: 5000, e: 5000 });
await expect('deny', 'F32 결제 없이 장풍 보유', () => userDb.ref(`${UP}/own/wave`).set(true));
await expect('deny', 'F33 장풍을 301코인에 (가격 불일치)', () => W({ c: 4699, e: 5000, sp: 301, b: 'wave' }));
await expect('allow', 'F34 밀짚모자 값 지불', () => W({ c: 5000 - prices.straw, e: 5000, sp: prices.straw, b: 'straw' }));
await expect('deny', 'F35 밀짚모자 값 내고 왕관 보유', () => userDb.ref(`${UP}/own/crown`).set(true));
await expect('deny', 'F36 밀짚모자 값 내고 장풍 보유', () => userDb.ref(`${UP}/own/wave`).set(true));
await expect('allow', 'F37 밀짚모자 보유 등록', () => userDb.ref(`${UP}/own/straw`).set(true));
await expect('allow', 'F38 이미 가진 것 다시 쓰기', () => userDb.ref(`${UP}/own/straw`).set(true));
await expect('allow', 'F39 가진 모자 착용', () => userDb.ref(`${UP}/eq/h`).set('straw'));
await expect('deny', 'F40 없는 모자 착용', () => userDb.ref(`${UP}/eq/h`).set('crown'));
await expect('deny', 'F41 없는 갑옷 입기 (프로필)', () => userDb.ref(`${UP}/eq/pa`).set(true));
await expect('deny', 'F42 없는 갑옷 표시 (접속 노드)', () => userDb.ref(`${PP}/pa`).set(true));
await expect('deny', 'F43 없는 이펙트 표시 (접속 노드)', () => userDb.ref(`${PP}/fx`).set('fire'));
await expect('allow', 'F44 가진 모자 표시 (접속 노드)', () => userDb.ref(`${PP}/h`).set('straw'));
await expect('allow', 'F45 자리 비움 표시', () => userDb.ref(`${PP}/z`).set(true));
await rootDb.ref(`${UP}/own/pusharmor`).set(true);
await expect('allow', 'F46 가진 갑옷 입기 (프로필)', () => userDb.ref(`${UP}/eq/pa`).set(true));
await expect('allow', 'F47 가진 갑옷 표시 (접속 노드)', () => userDb.ref(`${PP}/pa`).set(true));
await expect('allow', 'F48 착용 해제 (null)', () => userDb.ref(`${UP}/eq/h`).set(null));

// I. 선물 (2026-11-09): 보내는 사람 G 가 결제(b=품목, gt=받는 사람)하고 받는 사람 T 의 own·gifts·gift 를 쓴다
const G = 'zz-rules-gift';
const gDb = getDatabase(initializeApp({ credential: cert(sa), databaseURL, databaseAuthVariableOverride: { uid: G } }, 'asGiver'));
const WG = `${PRE}wallet/${G}`, UG = `${PRE}users/${G}`;
const WGw = (obj) => gDb.ref(WG).set(obj);
if (PRE === '') await rootDb.ref(UG).set({ id: 'zz-rules-gift', nick: '선물시험', avatar: 'm01', losses: 0 });
await rootDb.ref(WG).set({ c: 5000, e: 5000 });
await rootDb.ref(`${UP}/own/cap`).remove();
await expect('deny', 'I60 결제 없이 남의 보유 쓰기', () => gDb.ref(`${UP}/own/cap`).set(true));
await expect('allow', 'I61 선물 결제 (캡모자, gt=받는 사람)', () => WGw({ c: 5000 - prices.cap, e: 5000, sp: prices.cap, b: 'cap', gt: T }));
let wg = (await rootDb.ref(WG).get()).val();
await expect('deny', 'I62 선물 결제로 내 보유 등록 (gt 가 있으면 안 됨)', () => gDb.ref(`${UG}/own/cap`).set(true));
await expect('deny', 'I63 선물 결제한 품목과 다른 것 전달', () => gDb.ref(`${UP}/own/crown`).set(true));
await expect('deny', 'I64 결제하지 않은 제3자가 전달', () => userDb.ref(`${UG}/own/cap`).set(true));
await expect('deny', 'I65 받는 사람이 아닌 다른 사람에게 전달', () => gDb.ref(`${UG}/own/cap`).set(true));
await expect('allow', 'I66 선물 전달 (own + gifts + gift 한 번에)', () => gDb.ref().update({ [`${UP}/own/cap`]: true, [`${UP}/gifts/cap`]: true, [`${UP}/gift`]: { f: G, fn: '선물시험', i: 'cap', m: '생일 축하', at: TS } }));
await expect('deny', 'I67 선물 표시의 품목을 다른 것으로', () => gDb.ref(`${UP}/gift`).set({ f: G, fn: '선물시험', i: 'crown', at: TS }));
await expect('deny', 'I68 메시지 41자', () => gDb.ref(`${UP}/gift`).set({ f: G, fn: '선물시험', i: 'cap', m: 'x'.repeat(41), at: TS }));
await expect('deny', 'I69 받는 사람이 자기 물건을 선물로 표시', () => userDb.ref(`${UP}/gifts/straw`).set(true));
await expect('deny', 'I70 남이 받은 사람의 보유를 지우기', () => gDb.ref(`${UP}/own/cap`).remove());
await expect('deny', 'I71 결제 없이 gt 만 바꾸기', () => WGw({ ...wg, gt: G }));
await expect('deny', 'I72 결제 없이 gt 지우기', () => WGw({ c: wg.c, e: wg.e, sp: wg.sp, b: wg.b }));
await expect('allow', 'I73 이어서 내 것 구매 (비니, gt 지움)', () => WGw({ c: wg.c - prices.beanie, e: wg.e, sp: wg.sp + prices.beanie, b: 'beanie' }));
await expect('allow', 'I74 내 보유 등록', () => gDb.ref(`${UG}/own/beanie`).set(true));
await expect('deny', 'I75 내 것으로 산 비니를 남에게도 전달 (받는 사람은 비니가 없음)', () => gDb.ref(`${UP}/own/beanie`).set(true));
await expect('allow', 'I76 받는 사람이 선물받은 모자 착용', () => userDb.ref(`${UP}/eq/h`).set('cap'));
await rootDb.ref().update({ [WG]: null, [UG]: null });

} // !ONLY_WALLET

// J. 카지노 경마 (2026-11-09). 라운드는 실제 경로 casino/r 에 시험용 id 로 만들고 끝나면 지운다
const rid1 = `zz-rules-${Date.now()}`, rid2 = `zz-rules-${Date.now() + 1}`, rid0 = `zz-rules-${Date.now() - 1}`;
const casinoMax = (await rootDb.ref('config/casinoMax').get()).val() || 10000; // 기본값 10,000 (2026-11-10)
await seed({ c: 5000, e: 5000 });
await expect('deny', 'J80 라운드 만들기: by 가 남', () => userDb.ref(`casino/r/${rid1}`).set({ o: TS, by: 'someone' }));
await expect('deny', 'J81 라운드 만들기: o 가 서버 시각이 아님', () => userDb.ref(`casino/r/${rid1}`).set({ o: 123, by: T }));
await expect('allow', 'J82 라운드 만들기', () => userDb.ref(`casino/r/${rid1}`).set({ o: TS, by: T }));
w = await cur();
await expect('deny', 'J83 배팅 결제: 150 (100 단위 아님)', () => W({ ...w, c: w.c - 150, sp: 150, b: 'race', cb: rid1, ch: 2, ca: 150 }));
await expect('deny', 'J84 배팅 결제: 최대치 초과', () => W({ ...w, c: w.c - (casinoMax + 100), sp: casinoMax + 100, b: 'race', cb: rid1, ch: 2, ca: casinoMax + 100 }));
await expect('deny', 'J85 배팅 결제: 말 번호 5', () => W({ ...w, c: w.c - 300, sp: 300, b: 'race', cb: rid1, ch: 5, ca: 300 }));
await expect('deny', 'J86 배팅 결제: 없는 라운드', () => W({ ...w, c: w.c - 300, sp: 300, b: 'race', cb: 'nope', ch: 2, ca: 300 }));
await expect('deny', 'J87 배팅 결제: 낸 돈(100)과 배팅액(300)이 다름', () => W({ ...w, c: w.c - 100, sp: 100, b: 'race', cb: rid1, ch: 2, ca: 300 }));
await expect('deny', 'J88 미끼 사면서 배팅 표시 끼워 넣기', () => W({ ...w, c: w.c - prices.bait, sp: prices.bait, b: 'bait', bait: 1, cb: rid1, ch: 2, ca: 1000 }));
await expect('allow', 'J89 배팅 결제 300 (2번 말)', () => W({ ...w, c: w.c - 300, sp: 300, b: 'race', cb: rid1, ch: 2, ca: 300 }));
w = await cur();
// 배팅 기록 규칙은 실제 경로 wallet/{uid} 의 cb/ch/ca 를 본다: 시험용 경로(rtest)에서 돌릴 때는 실제 지갑에 같은 값을 복사해 둔다 (끝나면 지움)
if (PRE !== '') await rootDb.ref(`wallet/${T}`).set({ c: w.c, e: w.e, sp: w.sp, b: 'race', cb: rid1, ch: 2, ca: 300 });
await expect('deny', 'J90 배팅 기록: 금액이 결제와 다름', () => userDb.ref(`casino/r/${rid1}/bets/${T}`).set({ h: 2, a: 1000, n: '규칙시험' }));
await expect('deny', 'J91 배팅 기록: 말이 결제와 다름', () => userDb.ref(`casino/r/${rid1}/bets/${T}`).set({ h: 3, a: 300, n: '규칙시험' }));
await expect('deny', 'J92 배팅 기록: 남의 이름으로', () => userDb.ref(`casino/r/${rid1}/bets/someone`).set({ h: 2, a: 300, n: 'x' }));
await expect('allow', 'J93 배팅 기록', () => userDb.ref(`casino/r/${rid1}/bets/${T}`).set({ h: 2, a: 300, n: '규칙시험' }));
await expect('deny', 'J94 배팅 기록 다시 (한 라운드 한 번)', () => userDb.ref(`casino/r/${rid1}/bets/${T}`).set({ h: 2, a: 300, n: '규칙시험' }));
await expect('deny', 'J95 마감: 20초 전에', () => userDb.ref(`casino/r/${rid1}/at`).set(TS));
await rootDb.ref(`casino/r/${rid1}/o`).set(Date.now() - 25000);
await expect('deny', 'J96 마감: 서버 시각이 아닌 값', () => userDb.ref(`casino/r/${rid1}/at`).set(12345));
await expect('allow', 'J97 마감 (20초 지남)', () => userDb.ref(`casino/r/${rid1}/at`).set(TS));
await expect('deny', 'J98 마감 뒤 배팅 결제', () => W({ ...w, c: w.c - 100, sp: w.sp + 100, b: 'race', cb: rid1, ch: 1, ca: 100 }));
// 결과를 내 말(2)이 이기게 맞춰 둔다 (실제로는 서버 시각이 정하지만 규칙 식은 같다)
await rootDb.ref(`casino/r/${rid1}/at`).set(1794000000002);
await expect('deny', 'J99 배당 수령: 금액이 4.5배가 아님', () => W({ ...w, c: w.c + 1000, e: w.e + 1000, cr: rid1 }));
await expect('allow', 'J100 cr 안 적고 +1350 (획득 상한이 없어져 보통 획득으로 통과. 배당 검증은 cr 을 적는 쓰기에만 의미가 있다)', () => W({ ...w, c: w.c + 1350, e: w.e + 1350 }));
w = await cur();
await expect('deny', 'J101 보통 획득 쓰기로 cr 바꾸기', () => W({ ...w, c: w.c + 10, e: w.e + 10, cr: rid0 }));
await expect('allow', 'J102 배당 수령 1,350 (300 × 4.5)', () => W({ ...w, c: w.c + 1350, e: w.e + 1350, cr: rid1 }));
w = await cur();
await expect('allow', 'J103 같은 라운드 배당 다시 (cr 그대로라 보통 획득으로 통과. 상한 삭제 뒤 배당 중복은 클라이언트의 cr 비교에만 기댄다)', () => W({ ...w, c: w.c + 1350, e: w.e + 1350, cr: rid1 }));
await expect('deny', 'J104 cr 을 낮춰 쓰기', () => W({ ...w, cr: rid0 }));
// 진 라운드: 말 1에 걸었는데 결과는 2
await rootDb.ref(`casino/r/${rid2}`).set({ o: Date.now() - 30000, by: T, bets: { [T]: { h: 1, a: 100, n: '규칙시험' } }, at: 1794000000002 });
await expect('deny', 'J105 진 라운드 배당 수령', () => W({ ...w, c: w.c + 450, e: w.e + 450, cr: rid2 }));
await expect('deny', 'J106 하루 안 된 라운드 지우기', () => userDb.ref(`casino/r/${rid2}`).remove());
await rootDb.ref(`casino/r/${rid2}/o`).set(Date.now() - 90000000);
await expect('allow', 'J107 하루 지난 라운드 지우기', () => userDb.ref(`casino/r/${rid2}`).remove());
await rootDb.ref().update({ [`casino/r/${rid1}`]: null, [`casino/r/${rid2}`]: null, ...(PRE !== '' ? { [`wallet/${T}`]: null } : {}) });
// K. 신화 등급 보상: 2026-11-10 획득 상한이 없어져 보통 획득으로 받는다 (md 분기 삭제)
await seed({ c: 100, e: 100 });
w = await cur();
await expect('allow', 'K108 신화 보상 +1000 (보통 획득)', () => W({ ...w, c: w.c + 1000, e: w.e + 1000 }));
w = await cur();
await expect('allow', 'K109 같은 날 두 번째 신화 +2000', () => W({ ...w, c: w.c + 2000, e: w.e + 2000 }));
// L. 펫 먹이 (2026-11-10): b='petfood', pp=펫, px/펫 += k. 사용액 == 기본가 × k + 4 × (k × 먹은 수 + k(k−1)/2) (먹을수록 비싸짐). 다른 펫의 px 는 그대로
const PF = prices.petfood, STEP = 4;
const feedCost = (xp, k) => PF * k + STEP * (k * xp + (k * (k - 1)) / 2);
await seed({ c: 20000, e: 20000 });
w = await cur();
await expect('deny', 'L120 돈 안 내고 px 올리기', () => W({ ...w, px: { petdog: 1 } }));
await expect('deny', 'L121 먹이 1개 값으로 2개', () => W({ ...w, c: w.c - PF, sp: PF, b: 'petfood', pp: 'petdog', px: { petdog: 2 } }));
await expect('deny', 'L122 pp 없이 px 올리기', () => W({ ...w, c: w.c - PF, sp: PF, b: 'petfood', px: { petdog: 1 } }));
await expect('deny', 'L123 강아지 먹이 값 내고 고양이도 같이', () => W({ ...w, c: w.c - PF, sp: PF, b: 'petfood', pp: 'petdog', px: { petdog: 1, petcat: 1 } }));
await expect('deny', 'L124 pp 는 강아지인데 고양이가 오름', () => W({ ...w, c: w.c - PF, sp: PF, b: 'petfood', pp: 'petdog', px: { petcat: 1 } }));
await expect('deny', 'L125 첫 먹이에 1 코인 더 냄', () => W({ ...w, c: w.c - PF - 1, sp: PF + 1, b: 'petfood', pp: 'petdog', px: { petdog: 1 } }));
await expect('deny', 'L125b 2개를 옛 값(기본가 × 2)으로', () => W({ ...w, c: w.c - PF * 2, sp: PF * 2, b: 'petfood', pp: 'petdog', px: { petdog: 2 } }));
await expect('deny', 'L125c 먹이 0.5개', () => W({ ...w, c: w.c - 50, sp: 50, b: 'petfood', pp: 'petdog', px: { petdog: 0.5 } }));
await expect('allow', 'L126 강아지 먹이 3개 (100+104+108)', () => W({ ...w, c: w.c - feedCost(0, 3), sp: feedCost(0, 3), b: 'petfood', pp: 'petdog', px: { petdog: 3 } }));
w = await cur();
await expect('deny', 'L126b 4번째 먹이를 첫 값(100)으로', () => W({ ...w, c: w.c - PF, sp: w.sp + PF, b: 'petfood', pp: 'petdog', px: { petdog: 4 } }));
await expect('allow', 'L126c 4번째 먹이 112', () => W({ ...w, c: w.c - feedCost(3, 1), sp: w.sp + feedCost(3, 1), b: 'petfood', pp: 'petdog', px: { petdog: 4 } }));
w = await cur();
await expect('allow', 'L126d 강아지 10개 묶음 (4→14)', () => W({ ...w, c: w.c - feedCost(4, 10), sp: w.sp + feedCost(4, 10), b: 'petfood', pp: 'petdog', px: { petdog: 14 } }));
w = await cur();
await expect('allow', 'L127 고양이 첫 먹이 100 (강아지는 그대로)', () => W({ ...w, c: w.c - PF, sp: w.sp + PF, b: 'petfood', pp: 'petcat', px: { petdog: 14, petcat: 1 } }));
w = await cur();
await expect('deny', 'L128 자동 낚시 사면서 px 끼워 넣기', () => W({ ...w, c: w.c - prices.autoreel, sp: w.sp + prices.autoreel, b: 'autoreel', ar: Date.now() + 600000, px: { ...w.px, petdog: 9 } }));
await expect('deny', 'L129 미끼 사면서 px 끼워 넣기', () => W({ ...w, c: w.c - prices.bait, sp: w.sp + prices.bait, b: 'bait', bait: 1, px: { ...w.px, petdog: 9 } }));
await expect('deny', 'L130 획득하면서 px 줄이기', () => W({ ...w, c: w.c + 10, e: w.e + 10, px: { ...w.px, petdog: 1 } }));
await expect('allow', 'L131 획득 (px 그대로)', () => W({ ...w, c: w.c + 10, e: w.e + 10 }));
// M. 낚싯대 강화 (2026-11-10): 주문서(es)는 b='scroll' 결제로만 늘고, 성(rs)은 es 가 1 줄어드는 쓰기에서만 +1 또는 0. rs > 0 이면 rod2 보유
const SC = prices.scroll;
await seed({ c: 5000, e: 5000 });
if (!ONLY_WALLET) await rootDb.ref(`${UP}/own/rod2`).remove();
w = await cur();
await expect('deny', 'M140 돈 안 내고 주문서 늘리기', () => W({ ...w, es: 5 }));
await expect('deny', 'M141 주문서 5장을 1장 값에', () => W({ ...w, c: w.c - SC, sp: SC, b: 'scroll', es: 5 }));
await expect('allow', 'M142 주문서 5장 구매', () => W({ ...w, c: w.c - SC * 5, sp: SC * 5, b: 'scroll', es: 5 }));
w = await cur();
await expect('deny', 'M143 주문서를 안 쓰고 +1성', () => W({ ...w, rs: 1 }));
if (!ONLY_WALLET) await expect('deny', 'M144 명품 낚싯대 없이 강화 (+1성)', () => W({ ...w, es: 4, rs: 1 }));
await rootDb.ref(`${UP}/own/rod2`).set(true); // 지갑만 보는 모드에서도 rs > 0 검사(rodOwned)가 통하도록 가짜 사용자에 명품 낚싯대를 준다 (끝에 UP 통째로 지움)
await expect('deny', 'M145 주문서 1장으로 +2성', () => W({ ...w, es: 4, rs: 2 }));
await expect('deny', 'M146 주문서 2장 쓰고 +1성', () => W({ ...w, es: 3, rs: 1 }));
await expect('allow', 'M147 강화 성공 (+1성, 주문서 −1)', () => W({ ...w, es: 4, rs: 1 }));
w = await cur();
await expect('allow', 'M148 강화 성공 (2성)', () => W({ ...w, es: 3, rs: 2 }));
w = await cur();
await expect('deny', 'M149 미끼 사면서 +1성 끼워 넣기', () => W({ ...w, c: w.c - prices.bait, sp: w.sp + prices.bait, b: 'bait', bait: 1, rs: 3 }));
await expect('deny', 'M150 주문서 사면서 +1성 끼워 넣기', () => W({ ...w, c: w.c - SC, sp: w.sp + SC, b: 'scroll', es: w.es + 1, rs: 3 }));
await expect('allow', 'M151 강화하면서 코인도 +10 (획득은 제한이 없으므로 같이 써도 된다)', () => W({ ...w, c: w.c + 10, e: w.e + 10, es: 2, rs: 3 }));
w = await cur();
await expect('allow', 'M152 강화 실패 (0성, 주문서 −1)', () => W({ ...w, es: w.es - 1, rs: 0 }));
w = await cur();
await expect('allow', 'M153 획득 (es·rs 그대로)', () => W({ ...w, c: w.c + 10, e: w.e + 10 }));
await seed({ c: 5000, e: 5000, es: 1, rs: 30 });
w = await cur();
await expect('deny', 'M154 31성', () => W({ ...w, es: 0, rs: 31 }));
await expect('allow', 'M155 30성에서 실패 → 0성', () => W({ ...w, es: 0, rs: 0 }));
if (!ONLY_WALLET) {
  // N. 펫 경험치 표시 (접속 노드): pl 은 지갑 px 의 그 펫 값 이하. (등껍질 sh·스킬 sk 는 2026-11-10 밤 스킬 삭제와 함께 뺐다; 방어는 pt·pl 로 서로 확인)
  await seed({ c: 0, e: 0, px: { petdog: 10, petturtle: 170 } });
  await rootDb.ref(`${UP}/own`).update({ petdog: true, petturtle: true });
  await expect('allow', 'N160 강아지 데리고 다니기', () => userDb.ref(`${PP}/pt`).set('petdog'));
  await expect('allow', 'N161 강아지 경험치 10 표시', () => userDb.ref(`${PP}/pl`).set(10));
  await expect('deny', 'N162 강아지 경험치 11 (지갑은 10)', () => userDb.ref(`${PP}/pl`).set(11));
  await expect('allow', 'N164 거북이로 바꾸고 경험치 170 (Lv8 방어)', () => userDb.ref(PP).update({ pt: 'petturtle', pl: 170 }));
  await expect('deny', 'N165 거북이 경험치 171 (지갑은 170)', () => userDb.ref(`${PP}/pl`).set(171));
}
// G. 입장 버전 (실제 경로에서만): 노드를 새로 만들 때 v 가 config/minVersion 이상이어야 한다
if (PRE === '' && !ONLY_WALLET) {
  const minV = (await rootDb.ref('config/minVersion').get()).val();
  const node = (v) => ({ n: '규칙시험', a: 'm01', x: 1, y: 1, d: 0, s: 'rules-test', hb: Date.now(), ...(v === undefined ? {} : { v }) });
  await rootDb.ref(PP).remove();
  await expect('deny', 'G49 버전 표시 없는 옛 클라이언트의 입장 (minVersion ' + minV + ')', () => userDb.ref(PP).set(node(undefined)));
  await expect('deny', 'G50 버전 ' + (minV - 1) + ' 클라이언트의 입장', () => userDb.ref(PP).set(node(minV - 1)));
  await expect('allow', 'G51 버전 ' + minV + ' 클라이언트의 입장', () => userDb.ref(PP).set(node(minV)));
  await expect('allow', 'G52 이미 들어와 있는 노드의 이동 쓰기', () => userDb.ref(PP + '/x').set(2));
}
// O. 금광·킹 낚싯대 (2026-11-11): 금덩이(gn)는 채광 쓰기(간격 2.5초, 1~3개)로만 늘고, 제작(b='rod3')은 명품 30성 + 금덩이 100개 + 가격표, 킹 성(ks)은 주문서 1장 + 금덩이 1개가 같이 줄 때만
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!prices.rod3) { console.error('config/prices 에 rod3 가 없다. 먼저 넣을 것'); process.exit(1); }
const KP = prices.rod3;
await rootDb.ref(`${UP}/own`).update({ rod2: true, rod3: null });
await seed({ c: 50000, e: 50000 });
w = await cur();
await expect('deny', 'O170 채광 시각 없이 금덩이 +1', () => W({ ...w, gn: 1 }));
await expect('deny', 'O171 채광 시각을 과거로 적고 금덩이 +1', () => W({ ...w, gn: 1, ga: Date.now() - 60000 }));
await expect('deny', 'O172 한 번에 금덩이 4개', () => W({ ...w, gn: 4, ga: TS }));
await expect('deny', 'O173 금덩이 0.5개', () => W({ ...w, gn: 0.5, ga: TS }));
await expect('deny', 'O174 채광하면서 코인도 +10', () => W({ ...w, c: w.c + 10, e: w.e + 10, gn: 1, ga: TS }));
await expect('allow', 'O175 채광 +3', () => W({ ...w, gn: 3, ga: TS }));
w = await cur();
await expect('deny', 'O176 2.5초가 지나기 전에 또 채광', () => W({ ...w, gn: w.gn + 1, ga: TS }));
await expect('deny', 'O177 채광 시각만 바꾸기 (금덩이 그대로)', () => W({ ...w, ga: TS }));
await expect('deny', 'O178 미끼 사면서 금덩이 끼워 넣기', () => W({ ...w, c: w.c - prices.bait, sp: prices.bait, b: 'bait', bait: 1, gn: w.gn + 1, ga: TS }));
await expect('deny', 'O179 주문서 사면서 금덩이 끼워 넣기', () => W({ ...w, c: w.c - SC, sp: SC, b: 'scroll', es: 1, gn: w.gn + 100 }));
await expect('deny', 'O180 단품(밀짚모자) 사면서 킹 성 끼워 넣기', () => W({ ...w, c: w.c - prices.straw, sp: prices.straw, b: 'straw', ks: 1 }));
await expect('deny', 'O181 펫 먹이 사면서 금덩이 끼워 넣기', () => W({ ...w, c: w.c - prices.petfood, sp: prices.petfood, b: 'petfood', pp: 'petdog', px: { petdog: 1 }, gn: w.gn + 1, ga: TS }));
await expect('allow', 'O182 획득 (금덩이·채광 시각 그대로)', () => W({ ...w, c: w.c + 10, e: w.e + 10 }));
await sleep(2700);
w = await cur();
await expect('allow', 'O183 2.5초 뒤 다시 채광 +1', () => W({ ...w, gn: w.gn + 1, ga: TS }));
// 제작
await seed({ c: 50000, e: 50000, gn: 150, rs: 29, es: 5 });
w = await cur();
const craft = (o = {}) => ({ ...w, c: w.c - KP, sp: (w.sp || 0) + KP, b: 'rod3', gn: w.gn - 100, ks: 0, ...o });
await expect('deny', 'O190 명품 29성으로 제작', () => W(craft()));
await seed({ c: 50000, e: 50000, gn: 150, rs: 30, es: 5 });
w = await cur();
await expect('deny', 'O191 금덩이를 99개만 내고 제작', () => W(craft({ gn: w.gn - 99 })));
await expect('deny', 'O192 금덩이를 안 내고 제작', () => W(craft({ gn: w.gn })));
await expect('deny', 'O193 코인을 1 덜 내고 제작', () => W(craft({ c: w.c - KP + 1, sp: KP - 1 })));
await expect('deny', 'O194 제작하면서 킹 성 5', () => W(craft({ ks: 5 })));
await expect('deny', 'O195 제작하면서 명품 성을 0 으로', () => W(craft({ rs: 0 })));
await expect('deny', 'O196 제작을 선물로 (gt)', () => W(craft({ gt: 'zz-rules-gift' })));
await expect('deny', 'O197 일반 구매 분기로 rod3 (금덩이 그대로, 값만 냄)', () => W({ ...w, c: w.c - KP, sp: KP, b: 'rod3' }));
if (!ONLY_WALLET) {
  await rootDb.ref(`${UP}/own/rod2`).remove();
  await expect('deny', 'O198 명품 낚싯대 없이 제작 (성만 30)', () => W(craft()));
  await rootDb.ref(`${UP}/own/rod2`).set(true);
  await expect('deny', 'O199 결제 전에 킹 낚싯대 보유 등록', () => userDb.ref(`${UP}/own/rod3`).set(true));
}
await expect('allow', 'O200 킹 낚싯대 제작 (금덩이 −100, 가격표대로)', () => W(craft()));
w = await cur();
if (!ONLY_WALLET) await expect('deny', 'O201 킹 낚싯대 없이 킹 강화 (+1성)', () => W({ ...w, es: w.es - 1, gn: w.gn - 1, ks: 1 }));
if (!ONLY_WALLET) await expect('allow', 'O202 결제 뒤 킹 낚싯대 보유 등록', () => userDb.ref(`${UP}/own/rod3`).set(true));
else await rootDb.ref(`${UP}/own/rod3`).set(true);
// 킹 강화
await expect('deny', 'O203 주문서만 쓰고 킹 성 +1 (금덩이 그대로)', () => W({ ...w, es: w.es - 1, ks: 1 }));
await expect('deny', 'O204 금덩이만 쓰고 킹 성 +1 (주문서 그대로)', () => W({ ...w, gn: w.gn - 1, ks: 1 }));
await expect('deny', 'O205 한 번에 킹 성 +2', () => W({ ...w, es: w.es - 1, gn: w.gn - 1, ks: 2 }));
await expect('deny', 'O206 킹 강화에 명품 성 변경 끼워 넣기', () => W({ ...w, es: w.es - 1, gn: w.gn - 1, ks: 1, rs: 0 }));
await expect('allow', 'O207 킹 강화 성공 (+1성, 주문서 −1, 금덩이 −1)', () => W({ ...w, es: w.es - 1, gn: w.gn - 1, ks: 1 }));
w = await cur();
await expect('deny', 'O208 강화 성공인데 구매 표시(b)를 지움 (실패 쓰기에서만 지울 수 있다)', () => { const n = { ...w, es: w.es - 1, gn: w.gn - 1, ks: 2 }; delete n.b; return W(n); });
await expect('deny', 'O209 아무것도 안 하고 구매 표시(b)만 지움', () => { const n = { ...w }; delete n.b; return W(n); });
await expect('allow', 'O210 킹 강화 실패 (킹 성 0, 구매 표시 지움)', () => { const n = { ...w, es: w.es - 1, gn: w.gn - 1, ks: 0 }; delete n.b; return W(n); });
w = await cur();
if (!ONLY_WALLET) {
  await rootDb.ref(`${UP}/own/rod3`).remove(); // 부서져서 보관함에서 지움
  await expect('deny', 'O211 부서진 킹 낚싯대를 값 안 내고 다시 보유 등록 (구매 표시가 지워졌다)', () => userDb.ref(`${UP}/own/rod3`).set(true));
}
await expect('allow', 'O212 부서진 뒤 명품 30성은 그대로 두고 획득', () => W({ ...w, c: w.c + 10, e: w.e + 10 }));
// 명품 낚싯대도 같다: 마지막 구매가 rod2 인 채 부서져도 공짜로 되살릴 수 없다 (2026-11-11 수정)
await seed({ c: 50000, e: 50000, sp: prices.rod2, b: 'rod2', es: 2, rs: 12 });
w = await cur();
await expect('allow', 'O213 명품 강화 실패 (성 0, 구매 표시 지움)', () => { const n = { ...w, es: 1, rs: 0 }; delete n.b; return W(n); });
if (!ONLY_WALLET) {
  await rootDb.ref(`${UP}/own/rod2`).remove();
  await expect('deny', 'O214 부서진 명품 낚싯대를 값 안 내고 다시 보유 등록', () => userDb.ref(`${UP}/own/rod2`).set(true));
}
await seed({ c: 50000, e: 50000, sp: prices.rod2, b: 'rod2', es: 2, rs: 12 });
w = await cur();
await expect('allow', 'O215 옛 클라이언트의 실패 쓰기 (구매 표시를 안 지움)도 그대로 통과', () => W({ ...w, es: 1, rs: 0 }));
// P. 빠따 (2026-11-11): 개수(bt)는 b='bat' 결제에서만 늘고(늘어난 만큼 × 가격), 그 밖의 쓰기에서는 줄기만 한다
if (!prices.bat) { console.error('config/prices 에 bat 이 없다. 먼저 넣을 것'); process.exit(1); }
const BP = prices.bat;
await seed({ c: 50000, e: 50000 });
w = await cur();
await expect('deny', 'P220 돈 안 내고 빠따 늘리기', () => W({ ...w, bt: 3 }));
await expect('deny', 'P221 빠따 5개를 1개 값에', () => W({ ...w, c: w.c - BP, sp: BP, b: 'bat', bt: 5 }));
await expect('deny', 'P222 빠따 0.5개', () => W({ ...w, c: w.c - BP / 2, sp: BP / 2, b: 'bat', bt: 0.5 }));
await expect('deny', 'P223 값만 내고 개수는 그대로 (일반 구매 분기로 빠져나가기)', () => W({ ...w, c: w.c - BP, sp: BP, b: 'bat' }));
await expect('allow', 'P224 빠따 5개 구매', () => W({ ...w, c: w.c - BP * 5, sp: BP * 5, b: 'bat', bt: 5 }));
w = await cur();
await expect('deny', 'P225 미끼 사면서 빠따 끼워 넣기', () => W({ ...w, c: w.c - prices.bait, sp: w.sp + prices.bait, b: 'bait', bait: 1, bt: 6 }));
await expect('deny', 'P226 주문서 사면서 빠따 끼워 넣기', () => W({ ...w, c: w.c - SC, sp: w.sp + SC, b: 'scroll', es: 1, bt: 6 }));
await expect('deny', 'P227 획득하면서 빠따 늘리기', () => W({ ...w, c: w.c + 10, e: w.e + 10, bt: 6 }));
await expect('allow', 'P228 빠따 하나 쓰기 (개수만 −1)', () => W({ ...w, bt: 4 }));
w = await cur();
await expect('allow', 'P229 자동 사용 끄기', () => W({ ...w, bo: false }));
w = await cur();
await expect('deny', 'P230 자동 사용 칸에 숫자', () => W({ ...w, bo: 1 }));
await expect('allow', 'P231 빠따를 가진 채 미끼 구매 (빠따 그대로)', () => W({ ...w, c: w.c - prices.bait, sp: w.sp + prices.bait, b: 'bait', bait: 1 }));
await seed({ c: 2000000, e: 2000000, bt: 995 });
w = await cur();
await expect('deny', 'P232 999개를 넘겨 구매', () => W({ ...w, c: w.c - BP * 5, sp: BP * 5, b: 'bat', bt: 1000 }));
// Q. 낚싯대 없이 성만 남은 지갑 (2026-11-11 실제 발생): 통째로 막히지 않고, 스스로 0 으로 되돌릴 수 있다. 부서지는 쓰기는 지갑과 보관함을 한 번에
await rootDb.ref(`${UP}/own`).update({ rod2: null, rod3: null });
await seed({ c: 1000, e: 1000, es: 3, rs: 1, ks: 2 });
w = await cur();
await expect('allow', 'Q240 성이 남았는데 낚싯대가 없어도 코인 획득', () => W({ ...w, c: w.c + 10, e: w.e + 10 }));
w = await cur();
await expect('allow', 'Q241 성이 남았는데 낚싯대가 없어도 미끼 구매', () => W({ ...w, c: w.c - prices.bait, sp: (w.sp || 0) + prices.bait, b: 'bait', bait: 1 }));
w = await cur();
if (!ONLY_WALLET) await expect('deny', 'Q242 낚싯대 없이 성 올리기', () => W({ ...w, es: w.es - 1, rs: 2 }));
await expect('deny', 'Q243 주문서 없이 킹 성 올리기', () => W({ ...w, ks: 3 }));
await expect('deny', 'Q244 바로잡는 척하며 코인도 +100 은 되지만 성을 다른 값으로는 못 바꾼다', () => W({ ...w, c: w.c + 100, e: w.e + 100, rs: 5 }));
if (!ONLY_WALLET) await expect('allow', 'Q245 낚싯대가 없으니 주문서 없이 성을 0 으로 (접속할 때 바로잡기)', () => W({ ...w, rs: 0, ks: 0 }));
await rootDb.ref(`${UP}/own/rod2`).set(true);
await seed({ c: 1000, e: 1000, sp: 15000, b: 'rod2', es: 3, rs: 12 });
w = await cur();
await expect('deny', 'Q246 낚싯대가 있는데 주문서 없이 성을 0 으로', () => W({ ...w, rs: 0 }));
if (!ONLY_WALLET) {
  await expect('deny', 'Q247 부서지는 쓰기인데 주문서를 안 씀', () => userDb.ref().update({ [`${WP}/rs`]: 0, [`${WP}/b`]: null, [`${UP}/own/rod2`]: null }));
  await expect('allow', 'Q248 강화 실패를 한 번에: 주문서 −1·성 0·구매 표시 삭제·보관함의 낚싯대 삭제', () => userDb.ref().update({ [`${WP}/es`]: ServerValue.increment(-1), [`${WP}/rs`]: 0, [`${WP}/b`]: null, [`${UP}/own/rod2`]: null }));
  const after = await cur(), ownAfter = (await rootDb.ref(`${UP}/own/rod2`).get()).val();
  if (after.rs !== 0 || after.es !== 2 || after.b !== undefined || ownAfter !== null) { fail++; console.log('  FAIL 부서진 뒤 상태가 기대와 다름', JSON.stringify(after), ownAfter); } else pass++;
  await expect('deny', 'Q249 부서진 명품 낚싯대를 값 안 내고 다시 보유 등록', () => userDb.ref(`${UP}/own/rod2`).set(true));
}
// R. 만렙 펫을 타지 않고 데리고 다니기 (2026-11-12): 프로필 eq.nr 는 참·거짓만, 접속 노드 nr 은 true 만
if (!ONLY_WALLET) {
  await expect('allow', 'R260 펫에서 내리기 (프로필 eq.nr = true)', () => userDb.ref(`${UP}/eq/nr`).set(true));
  await expect('deny', 'R261 eq.nr 에 문자열', () => userDb.ref(`${UP}/eq/nr`).set('yes'));
  await expect('allow', 'R262 다시 타기 (eq.nr 삭제)', () => userDb.ref(`${UP}/eq/nr`).remove());
  await expect('deny', 'R263 프로필 eq 에 모르는 칸', () => userDb.ref(`${UP}/eq/zz`).set(true));
}
// S. 곡괭이 업그레이드 (코인 전용·확정): b='pick', pk 가 정확히 +1(최대 10), 사용액이 정확히 1000·pk². 채광 보너스는 내 지갑의 pk 로 본다: 한 번에 최대 3 + floor(pk/2)
const PICKC = (l) => 1000 * l * l;
await seed({ c: 2000000, e: 2000000, es: 3, gn: 500, bait: 2 });
w = await cur();
const up = (from, o = {}) => ({ ...w, pk: from + 1, c: w.c - PICKC(from + 1), sp: (w.sp || 0) + PICKC(from + 1), b: 'pick', ...o });
await expect('allow', 'S270 곡괭이 0→1 (옛 지갑: pk 칸 없음, 1000 코인)', () => W(up(0)));
w = await cur();
await expect('deny', 'S271 곡괭이 1→2 를 1000 에 (값이 모자람)', () => W(up(1, { c: w.c - 1000, sp: w.sp + 1000 })));
await expect('deny', 'S272 곡괭이 1→3 (한 번에 두 단계)', () => W(up(1, { pk: 3, c: w.c - PICKC(3), sp: w.sp + PICKC(3) })));
await expect('deny', 'S273 돈 안 내고 곡괭이 올리기', () => W({ ...w, pk: 2 }));
await expect('deny', 'S274 곡괭이 내리기', () => W({ ...w, pk: 0 }));
await expect('deny', 'S275 곡괭이 업그레이드를 선물로 (gt)', () => W(up(1, { gt: 'zz-rules-gift' })));
await expect('deny', 'S276 업그레이드에 금덩이를 같이 냄', () => W(up(1, { gn: w.gn - 10 })));
await expect('deny', 'S277 업그레이드에 주문서를 같이 냄', () => W(up(1, { es: w.es - 1 })));
await expect('deny', 'S278 업그레이드에 명품 성을 끼워 넣기', () => W(up(1, { rs: 1 })));
await expect('deny', 'S279 곡괭이 0.5 단계', () => W({ ...w, pk: 1.5, c: w.c - 1500, sp: w.sp + 1500, b: 'pick' }));
await expect('deny', 'S280 미끼 사면서 곡괭이 끼워 넣기', () => W({ ...w, c: w.c - prices.bait, sp: w.sp + prices.bait, b: 'bait', bait: w.bait + 1, pk: 2 }));
await expect('deny', 'S281 주문서 사면서 곡괭이 끼워 넣기', () => W({ ...w, c: w.c - SC, sp: w.sp + SC, b: 'scroll', es: w.es + 1, pk: 2 }));
await expect('deny', 'S282 획득하면서 곡괭이 끼워 넣기', () => W({ ...w, c: w.c + 10, e: w.e + 10, pk: 2 }));
await expect('deny', 'S283 단품(밀짚모자) 사면서 곡괭이 끼워 넣기', () => W({ ...w, c: w.c - prices.straw, sp: w.sp + prices.straw, b: 'straw', pk: 2 }));
await expect('allow', 'S284 곡괭이가 있는 채 획득 (그대로)', () => W({ ...w, c: w.c + 10, e: w.e + 10 }));
await seed({ c: 2000000, e: 2000000, pk: 10 });
w = await cur();
await expect('deny', 'S285 곡괭이 10→11', () => W({ ...w, pk: 11, c: w.c - PICKC(11), sp: PICKC(11), b: 'pick' }));
await seed({ c: 100, e: 100, pk: 10, gn: 5, ga: Date.now() - 60000 });
w = await cur();
await expect('deny', 'S290 10단계 채광 9개 (최대 3 + 5 = 8)', () => W({ ...w, gn: w.gn + 9, ga: TS }));
await expect('allow', 'S291 10단계 채광 8개', () => W({ ...w, gn: w.gn + 8, ga: TS }));
await seed({ c: 100, e: 100, pk: 3, gn: 5, ga: Date.now() - 60000 });
w = await cur();
await expect('deny', 'S292 3단계 채광 5개 (최대 3 + 1 = 4)', () => W({ ...w, gn: w.gn + 5, ga: TS }));
await expect('deny', 'S293 채광하면서 곡괭이 올리기', () => W({ ...w, gn: w.gn + 1, ga: TS, pk: 4 }));
await expect('allow', 'S294 3단계 채광 4개', () => W({ ...w, gn: w.gn + 4, ga: TS }));
await seed({ c: 100, e: 100, gn: 5, ga: Date.now() - 60000 });
w = await cur();
await expect('deny', 'S295 0단계 채광 4개 (최대 3)', () => W({ ...w, gn: w.gn + 4, ga: TS }));
// T. 얼음 낚싯대: 단일 영구 품목(b='iceRod', 가격표 기본 1000). 일반 구매 분기로만 사고, 강화·킹·성 칸(irs/iks)은 없다. 가격표에 iceRod 가 없으면 이 구간은 건너뜀
if (!prices.iceRod) console.log('  (건너뜀) config/prices 에 iceRod 가 없어 T 구간은 시험하지 않는다');
else {
  const IP = prices.iceRod;
  await rootDb.ref(`${UP}/own`).update({ iceRod: null });
  await seed({ c: 500000, e: 500000, es: 5, gn: 150, rs: 7 });
  w = await cur();
  const buy = (o = {}) => ({ ...w, c: w.c - IP, sp: (w.sp || 0) + IP, b: 'iceRod', ...o });
  await expect('deny', 'T300 얼음 낚싯대를 가격보다 싸게', () => W(buy({ c: w.c - IP + 1, sp: IP - 1 })));
  await expect('deny', 'T301 얼음 낚싯대를 사면서 일반 성 올리기', () => W(buy({ rs: 8 })));
  await expect('deny', 'T302 얼음 낚싯대를 사면서 곡괭이 올리기', () => W(buy({ pk: 1 })));
  await expect('deny', 'T303 얼음 성 칸(irs) 만들기: 얼음 낚싯대는 강화할 수 없다', () => W(buy({ irs: 1 })));
  await expect('deny', 'T304 얼음 킹 성 칸(iks) 만들기', () => W(buy({ iks: 1 })));
  await expect('deny', 'T305 주문서를 쓰고 irs 올리기', () => W({ ...w, es: w.es - 1, irs: 1 }));
  await expect('allow', 'T306 얼음 낚싯대 구매 (선행 조건 없음)', () => W(buy()));
  if (!ONLY_WALLET) {
    await expect('allow', 'T307 결제 뒤 얼음 낚싯대 보유 등록', () => userDb.ref(`${UP}/own/iceRod`).set(true));
    await rootDb.ref(`${UP}/own/iceRod`).remove();
    await seed({ c: 500000, e: 500000 });
    await expect('deny', 'T308 결제 없이 얼음 낚싯대 보유 등록', () => userDb.ref(`${UP}/own/iceRod`).set(true));
  }
}
await rootDb.ref().update({ [WP]: null, [UP]: null, [PP]: null });
await rootDb.ref('approved').update({ [T]: null, 'zz-rules-gift': null });
console.log(`\n결과: 통과 ${pass}, 실패 ${fail}`);
process.exit(fail ? 1 : 0);
