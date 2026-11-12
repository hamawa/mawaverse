// 보안 규칙 시험 (로컬 에뮬레이터): 가입 승인·실명 보호·평일 근무시간 차단을 가짜 사용자와 주입한 시각으로 확인한다.
// 실행: npm run test:rules   (Java 와 firebase-tools 필요. 에뮬레이터를 띄워 이 파일을 돌린다. 실제 프로젝트는 건드리지 않는다)
// 시험용 규칙(database.rules.test.json)은 배포용과 조건식이 같고, 시각만 now 대신 _test/now 에서 읽는다 (tools/gen-gate.cjs).
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getDatabase, ServerValue } from 'firebase-admin/database';

// 거부되는 쓰기마다 SDK 가 찍는 경고는 시험 결과를 가리므로 숨긴다
const warn = console.warn; console.warn = (...a) => { if (!String(a[0]).includes('FIREBASE WARNING')) warn(...a); };

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!HOST) { console.error('에뮬레이터 안에서만 돌린다: npm run test:rules'); process.exit(1); }
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-mawaverse';
const NS = `${PROJECT}-default-rtdb`;
const databaseURL = `http://${HOST}?ns=${NS}`;

// 시험용 규칙을 에뮬레이터에 올린다
const put = await fetch(`http://${HOST}/.settings/rules.json?ns=${NS}`, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: readFileSync(new URL('../database.rules.test.json', import.meta.url)) });
if (!put.ok) { console.error('규칙을 올리지 못했습니다:', put.status, await put.text()); process.exit(1); }

const root = getDatabase(initializeApp({ projectId: PROJECT, databaseURL }, 'root'));
const as = (uid) => getDatabase(initializeApp({ projectId: PROJECT, databaseURL, databaseAuthVariableOverride: uid ? { uid } : null }, 'as-' + (uid || 'anon')));
const admin = as('ADMIN'), ok = as('OK'), pend = as('PEND'), other = as('OTHER'), anon = as(null);

let pass = 0, fail = 0;
async function expect(label, want, fn) {
  let got = 'allow';
  try { await fn(); } catch (e) { got = /permission/i.test(String(e.message || e)) ? 'deny' : 'error: ' + (e.message || e); }
  if (got === want) pass++; else { fail++; console.log(`  ✖ ${label} → ${got} (기대 ${want})`); }
}
const kst = (s) => Date.parse(s.replace(' ', 'T') + '+09:00');
const setNow = (s) => root.ref('_test/now').set(kst(s));
const dayNo = (key) => Date.UTC(...key.split('-').map((n, i) => (i === 1 ? +n - 1 : +n))) / 86400000;
const presence = { n: '닉', a: 'm-1', x: 1, y: 1, d: 0, s: 'sess' };
const profile = (id, nick) => ({ id, nick, avatar: 'm-1', losses: 0, createdAt: 1 });

await root.ref().set({
  admins: { ADMIN: true },
  approved: { OK: true },
  users: { ADMIN: profile('admin', '관리자'), OK: profile('ok', '승인됨'), PEND: profile('pend', '대기중') },
  ids: { ok: 'OK', pend: 'PEND' },
  nicknames: { '승인됨': 'OK', '대기중': 'PEND' },
  signups: { OK: { name: '김승인', reason: '친구 소개', at: 1 }, PEND: { name: '이대기', reason: '궁금해서', at: 2 } },
  holidays: { [dayNo('2026-12-25')]: '2026-12-25 성탄절' },
  config: { maxPlayers: 50, hoursBlock: true }, // 시각별 시험은 차단 설정을 켠 상태로 한다
});

// ---------- 1. 시각별: 승인된 사용자 / 대기 중 / 관리자 ----------
const TIMES = [
  ['평일 08:54', '2026-11-11 08:54:00', true],
  ['평일 08:55', '2026-11-11 08:55:00', true],
  ['평일 08:59:59', '2026-11-11 08:59:59', true],
  ['평일 09:00', '2026-11-11 09:00:00', false],
  ['평일 10:29:59', '2026-11-11 10:29:59', false],
  ['평일 10:30 (쉬는 시간 시작)', '2026-11-11 10:30:00', true],
  ['평일 10:44:59', '2026-11-11 10:44:59', true],
  ['평일 10:45 (쉬는 시간 끝)', '2026-11-11 10:45:00', false],
  ['평일 11:59:59', '2026-11-11 11:59:59', false],
  ['평일 12:00 (점심 시작)', '2026-11-11 12:00:00', true],
  ['평일 12:59:59', '2026-11-11 12:59:59', true],
  ['평일 13:00 (점심 끝)', '2026-11-11 13:00:00', false],
  ['평일 14:00', '2026-11-11 14:00:00', false],
  ['평일 15:29:59', '2026-11-11 15:29:59', false],
  ['평일 15:30 (쉬는 시간 시작)', '2026-11-11 15:30:00', true],
  ['평일 15:44:59', '2026-11-11 15:44:59', true],
  ['평일 15:45 (쉬는 시간 끝)', '2026-11-11 15:45:00', false],
  ['평일 17:59', '2026-11-11 17:59:59', false],
  ['평일 18:00', '2026-11-11 18:00:00', true],
  ['평일 새벽', '2026-11-12 03:00:00', true],
  ['월요일 10:00', '2026-11-09 10:00:00', false],
  ['금요일 10:00', '2026-11-13 10:00:00', false],
  ['토요일 12:00', '2026-11-14 12:00:00', true],
  ['일요일 12:00', '2026-11-15 12:00:00', true],
  ['공휴일(금) 12:00', '2026-12-25 12:00:00', true],
  ['공휴일 다음 평일 11:00', '2026-12-28 11:00:00', false],
];
for (const [name, t, open] of TIMES) {
  await setNow(t);
  const w = open ? 'allow' : 'deny';
  await expect(`${name}: 승인된 사용자가 설정 읽기`, w, () => ok.ref('config').get());
  await expect(`${name}: 승인된 사용자가 접속 표시 쓰기`, w, () => ok.ref('players/OK').set({ ...presence, hb: ServerValue.TIMESTAMP }));
  await expect(`${name}: 승인된 사용자가 걸음(자리+위치) 쓰기`, w, () => ok.ref().update({ 'occ/2_2': 'OK', 'players/OK/x': 2, 'players/OK/y': 2, 'players/OK/d': 1 }));
  await expect(`${name}: 승인된 사용자가 접속자 목록 읽기`, w, () => ok.ref('players').get());
  await expect(`${name}: 대기 중인 사용자가 설정 읽기`, 'deny', () => pend.ref('config').get());
  await expect(`${name}: 대기 중인 사용자가 접속 표시 쓰기`, 'deny', () => pend.ref('players/PEND').set({ ...presence, hb: ServerValue.TIMESTAMP }));
  await expect(`${name}: 대기 중인 사용자가 자기 프로필 읽기`, w, () => pend.ref('users/PEND').get());
  await expect(`${name}: 대기 중인 사용자가 자기 승인 여부 읽기`, 'allow', () => pend.ref('approved/PEND').get());
  await expect(`${name}: 자기가 관리자인지 읽기`, 'allow', () => ok.ref('admins/OK').get());
  await expect(`${name}: 관리자가 설정 읽기`, 'allow', () => admin.ref('config').get());
  await expect(`${name}: 관리자가 접속 표시 쓰기`, 'allow', () => admin.ref('players/ADMIN').set({ ...presence, hb: ServerValue.TIMESTAMP }));
  await expect(`${name}: 관리자가 가입 신청 목록 읽기`, 'allow', () => admin.ref('signups').get());
  await expect(`${name}: 새 사람이 가입 신청서 쓰기`, w, async () => { await as('NEW' + kst(t)).ref(`signups/NEW${kst(t)}`).set({ name: '박신청', reason: '가입 사유', at: ServerValue.TIMESTAMP }); });
  await expect(`${name}: 로그인 안 한 사람이 설정 읽기`, 'deny', () => anon.ref('config').get());
  await root.ref('players').remove(); await root.ref('occ').remove();
}

// ---------- 2. 가입·승인·실명 보호 (이용 시간) ----------
await setNow('2026-11-14 12:00:00');
await expect('실명: 다른 사용자가 남의 신청서 읽기', 'deny', () => ok.ref('signups/PEND').get());
await expect('실명: 다른 사용자가 신청 목록 읽기', 'deny', () => ok.ref('signups').get());
await expect('실명: 대기 중인 사용자가 남의 신청서 읽기', 'deny', () => pend.ref('signups/OK').get());
await expect('실명: 본인은 자기 신청서 읽기', 'allow', () => pend.ref('signups/PEND').get());
await expect('실명: 관리자는 신청서 읽기', 'allow', () => admin.ref('signups/PEND').get());
await expect('실명: 로그인 안 한 사람', 'deny', () => anon.ref('signups/PEND').get());
await expect('프로필: 다른 사용자가 남의 프로필(아이디 포함) 읽기', 'deny', () => ok.ref('users/PEND').get());
await expect('프로필: 닉네임만은 승인된 사용자가 읽기', 'allow', () => ok.ref('users/PEND/nick').get());
await expect('프로필: 대기 중인 사용자는 남의 닉네임도 못 읽음', 'deny', () => pend.ref('users/OK/nick').get());
await expect('승인: 본인이 자기를 승인', 'deny', () => pend.ref('approved/PEND').set(true));
await expect('승인: 다른 사용자가 승인', 'deny', () => ok.ref('approved/PEND').set(true));
await expect('승인: 다른 사용자가 승인 목록 읽기', 'deny', () => ok.ref('approved').get());
await expect('신청서: 이미 낸 신청서 고치기', 'deny', () => pend.ref('signups/PEND').set({ name: '바꾼이름', reason: '바꿈', at: ServerValue.TIMESTAMP }));
await expect('신청서: 남의 이름으로 쓰기', 'deny', () => other.ref('signups/SOMEONE').set({ name: '가짜', reason: '가짜', at: ServerValue.TIMESTAMP }));
await expect('신청서: 실명 21자', 'deny', () => other.ref('signups/OTHER').set({ name: '가'.repeat(21), reason: '사유', at: ServerValue.TIMESTAMP }));
await expect('신청서: 가입 사유 없음', 'deny', () => other.ref('signups/OTHER').set({ name: '홍길동', at: ServerValue.TIMESTAMP }));
await expect('신청서: 가입 사유 101자', 'deny', () => other.ref('signups/OTHER').set({ name: '홍길동', reason: '가'.repeat(101), at: ServerValue.TIMESTAMP }));
await expect('신청서: 시각을 마음대로', 'deny', () => other.ref('signups/OTHER').set({ name: '홍길동', reason: '사유', at: 12345 }));
await expect('가입: 프로필·아이디·신청서를 한 번에 쓰기', 'allow', () => other.ref().update({ 'users/OTHER': { id: 'other', nick: '새사람', avatar: 'm-1', losses: 0, createdAt: ServerValue.TIMESTAMP }, 'ids/other': 'OTHER', 'signups/OTHER': { name: '홍길동', reason: '사유', at: ServerValue.TIMESTAMP } }));
await expect('가입: 닉네임 예약', 'allow', () => other.ref('nicknames/새사람').set('OTHER'));
await expect('가입 직후: 게임 경로는 아직 못 씀', 'deny', () => other.ref('players/OTHER').set({ ...presence, hb: ServerValue.TIMESTAMP }));
await expect('승인: 관리자가 승인', 'allow', () => admin.ref('approved/OTHER').set(true));
await expect('승인 후: 게임 경로를 쓸 수 있음', 'allow', () => other.ref('players/OTHER').set({ ...presence, hb: ServerValue.TIMESTAMP }));
await expect('승인 후에도: 남의 신청서는 못 읽음', 'deny', () => other.ref('signups/PEND').get());

// ---------- 3. 거절·탈퇴 ----------
await expect('거절: 관리자가 신청서·프로필·아이디·닉네임을 한 번에 삭제', 'allow', () => admin.ref().update({ 'signups/PEND': null, 'approved/PEND': null, 'users/PEND': null, 'ids/pend': null, 'nicknames/대기중': null, 'players/PEND': null, 'sessions/PEND': null, 'wallet/PEND': null }));
const left = (await root.ref('signups/PEND').get()).exists() || (await root.ref('users/PEND').get()).exists();
if (left) { fail++; console.log('  ✖ 거절 뒤 개인정보가 남아 있음'); } else pass++;
await expect('탈퇴: 본인이 자기 정보와 승인 표시를 한 번에 삭제', 'allow', () => other.ref().update({ 'signups/OTHER': null, 'approved/OTHER': null, 'users/OTHER': null, 'ids/other': null, 'nicknames/새사람': null, 'players/OTHER': null, 'sessions/OTHER': null, 'wallet/OTHER': null, 'fish/book/OTHER': null, 'bug/book/OTHER': null }));
const left2 = (await root.ref('signups/OTHER').get()).exists() || (await root.ref('users/OTHER').get()).exists() || (await root.ref('approved/OTHER').get()).exists();
if (left2) { fail++; console.log('  ✖ 탈퇴 뒤 개인정보가 남아 있음'); } else pass++;
await expect('탈퇴: 남의 프로필 삭제', 'deny', () => ok.ref('users/ADMIN').remove());
await expect('탈퇴: 남의 신청서 삭제', 'deny', () => ok.ref('signups/OK2').remove().then(() => ok.ref('signups/PEND').remove()));
await root.ref('signups/X').set({ name: '남', reason: '남', at: 1 });
await expect('탈퇴: 남의 신청서 삭제(있는 것)', 'deny', () => ok.ref('signups/X').remove());

// ---------- 4. 공휴일 목록은 관리자만 읽고 아무도 못 쓴다 ----------
await expect('공휴일: 사용자가 쓰기', 'deny', () => ok.ref('holidays/1').set('x'));
await expect('공휴일: 관리자도 쓰기 불가(배포로만)', 'deny', () => admin.ref('holidays/1').set('x'));

// ---------- 5. 차단 설정(config/hoursBlock): 꺼져 있으면(기본) 평일 낮에도 이용할 수 있다. 가입 승인은 그대로 필요하다 ----------
await setNow('2026-11-11 14:00:00');
await expect('설정 켬: 평일 14:00 승인된 사용자 → 차단', 'deny', () => ok.ref('config').get());
await expect('설정: 일반 사용자가 차단 설정을 바꾸기', 'deny', () => ok.ref('config/hoursBlock').set(false));
await expect('설정: 로그인 안 한 사람도 차단 설정 여부는 읽는다', 'allow', () => anon.ref('config/hoursBlock').get());
await expect('설정: 로그인 안 한 사람이 다른 설정 읽기', 'deny', () => anon.ref('config/maxPlayers').get());
await expect('설정: 차단 시간에도 관리자는 설정을 끌 수 있다', 'allow', () => admin.ref('config/hoursBlock').set(false));
await expect('설정 끔: 평일 14:00 승인된 사용자가 설정 읽기', 'allow', () => ok.ref('config').get());
await expect('설정 끔: 평일 14:00 승인된 사용자가 접속 표시 쓰기', 'allow', () => ok.ref('players/OK').set({ ...presence, hb: ServerValue.TIMESTAMP }));
await expect('설정 끔: 평일 14:00 새 사람이 가입 신청서 쓰기', 'allow', () => as('NEWOFF').ref('signups/NEWOFF').set({ name: '박신청', reason: '가입 사유', at: ServerValue.TIMESTAMP }));
await expect('설정 끔: 승인 안 된 사용자는 여전히 못 들어옴', 'deny', () => as('NEWOFF').ref('players/NEWOFF').set({ ...presence, hb: ServerValue.TIMESTAMP }));
await expect('설정: 불리언이 아닌 값', 'deny', () => admin.ref('config/hoursBlock').set('yes'));
await root.ref('config/hoursBlock').remove();
await expect('설정 없음(기본): 평일 14:00 승인된 사용자가 설정 읽기', 'allow', () => ok.ref('config').get());
await expect('설정 없음(기본): 승인 안 된 사용자는 못 들어옴', 'deny', () => as('NEWOFF').ref('config').get());

// ---------- 6. 포탈 맵: 맵별 점유와 공간 상호작용 ----------
await root.ref().update({
  'approved/OTHER': true,
  'players/OK': { ...presence, m: 'main' },
  'players/OTHER': { ...presence, m: 'portal-garden' },
  'players/ADMIN': { ...presence, m: 'main' },
  'maps/island': { id: 'island', name: '섬' },
  occ: null,
});
await expect('맵: 기본 공간의 같은 좌표 점유', 'allow', () => ok.ref('occ/1_1').set('OK'));
await expect('맵: 다른 공간에서는 같은 좌표를 점유 가능', 'allow', () => other.ref('occ/portal-garden~1_1').set('OTHER'));
await expect('맵: 다른 사용자의 유효한 점유 삭제 거부', 'deny', () => ok.ref('occ/portal-garden~1_1').remove());
await expect('맵: 다른 공간의 점유 키를 위조', 'deny', () => ok.ref('occ/island~1_1').set('OK'));
await expect('맵: 다른 공간의 좌표로 점유 키를 위조', 'deny', () => other.ref('occ/portal-garden~9_9').set('OTHER'));
await expect('맵: 존재하지 않는 맵 이동', 'deny', () => ok.ref('players/OK/m').set('missing'));
await expect('맵: 잘못된 맵 ID', 'deny', () => ok.ref('players/OK/m').set('../island'));
await expect('맵: 저장된 맵 ID 허용', 'allow', () => ok.ref('players/OK/m').set('island'));
await expect('맵: 코드에 든 금광 맵 허용', 'allow', () => ok.ref('players/OK/m').set('gold-mine'));
await expect('맵: 채광 중 표시는 true 만', 'allow', () => ok.ref('players/OK/mn').set(true));
await expect('맵: 채광 중 표시에 다른 값', 'deny', () => ok.ref('players/OK/mn').set(1));
await expect('맵: 채광 중 표시 지우기', 'allow', () => ok.ref('players/OK/mn').remove());
await root.ref('players/OK/m').set('main');
await expect('맵: 목적지 점유가 있으면 이동 거부', 'deny', () => ok.ref().update({
  'occ/1_1': null, 'occ/portal-garden~1_1': 'OK', 'players/OK/m': 'portal-garden',
}));
if ((await root.ref('players/OK/m').get()).val() !== 'main' || (await root.ref('occ/1_1').get()).val() !== 'OK') {
  fail++; console.log('  ✖ 거부된 맵 이동이 기존 접속/점유를 변경함');
} else pass++;
await expect('맵: 점유·맵·좌표를 한 번에 이동', 'allow', () => ok.ref().update({
  'occ/1_1': null, 'occ/portal-garden~2_1': 'OK', 'players/OK/m': 'portal-garden', 'players/OK/x': 2,
}));
await expect('맵: 새 맵에서 기존 맵으로 원자적 귀환', 'allow', () => ok.ref().update({
  'occ/portal-garden~2_1': null, 'occ/1_1': 'OK', 'players/OK/m': 'main', 'players/OK/x': 1,
}));
const spatial = {
  push: { f: 'OK', dx: 1, dy: 0, t: 1 },
  pull: { f: 'OK', x: 1, y: 1, t: 1 },
  toss: { f: 'OK', fx: 1, fy: 1, tx: 1, ty: 1, t: 1 },
};
for (const [kind, value] of Object.entries(spatial)) {
  await expect(`맵: 다른 맵 사용자에게 ${kind} 거부`, 'deny', () => ok.ref(`players/OTHER/${kind}`).set(value));
}
await root.ref('players/OK/m').set('portal-garden');
for (const [kind, value] of Object.entries(spatial)) {
  await expect(`맵: 같은 보조 맵 사용자에게 ${kind} 허용`, 'allow', () => ok.ref(`players/OTHER/${kind}`).set(value));
}
await expect('맵: 보조 맵의 근처 채팅 허용', 'allow', () => ok.ref('chat/public/garden-near').set({ u: 'OK', n: '닉', t: '정원', c: 'near', m: 'portal-garden', x: 1, y: 1, ts: 1 }));
await expect('맵: 보조 맵에서 기본 맵 채팅으로 위조 거부', 'deny', () => ok.ref('chat/public/garden-fake').set({ u: 'OK', n: '닉', t: '기본 공간 위조', c: 'near', x: 1, y: 1, ts: 1 }));
await root.ref('players/OK/m').set('main');
await expect('맵: 다른 맵 사용자에게 관리자 순간이동 거부', 'deny', () => admin.ref('players/OTHER/tp').set({ f: 'ADMIN', x: 1, y: 1, t: 1 }));
await root.ref('players/OTHER/m').remove();
for (const [kind, value] of Object.entries(spatial)) {
  await expect(`맵: 식별자 없는 기존 기본 공간 사용자에게 ${kind} 허용`, 'allow', () => ok.ref(`players/OTHER/${kind}`).set(value));
}
await expect('맵: 같은 맵 사용자에게 관리자 순간이동 허용', 'allow', () => admin.ref('players/OTHER/tp').set({ f: 'ADMIN', x: 1, y: 1, t: 1 }));
// 빠따 (2026-11-11): b=1 이 붙은 밀치기·말랑이·끌기는 보낸 사람의 지갑 bt 가 같은 쓰기에서 줄 때만
await root.ref('wallet/OK').set({ c: 0, e: 0, bt: 2 });
await expect('빠따: 지갑을 안 건드리고 b=1 밀치기', 'deny', () => ok.ref('players/OTHER/push').set({ ...spatial.push, b: 1 }));
await expect('빠따: 빠따 수를 그대로 둔 채 b=1 밀치기', 'deny', () => ok.ref().update({ 'players/OTHER/push': { ...spatial.push, b: 1 }, 'wallet/OK/bt': 2 }));
await expect('빠따: 하나를 쓰며 b=1 밀치기', 'allow', () => ok.ref().update({ 'players/OTHER/push': { ...spatial.push, b: 1 }, 'wallet/OK/bt': 1 }));
await expect('빠따: b 에 1 이 아닌 값', 'deny', () => ok.ref().update({ 'players/OTHER/toss': { ...spatial.toss, b: 2 }, 'wallet/OK/bt': 0 }));
await expect('빠따: 하나를 쓰며 b=1 말랑이', 'allow', () => ok.ref().update({ 'players/OTHER/toss': { ...spatial.toss, b: 1 }, 'wallet/OK/bt': 0 }));
await expect('빠따: 남은 게 없는데 b=1 끌기', 'deny', () => ok.ref().update({ 'players/OTHER/pull': { ...spatial.pull, b: 1 }, 'wallet/OK/bt': 0 }));
await expect('빠따: b 없는 보통 끌기는 그대로', 'allow', () => ok.ref('players/OTHER/pull').set(spatial.pull));
await expect('빠따: 돈 안 내고 빠따 늘리기', 'deny', () => ok.ref('wallet/OK/bt').set(5));
await expect('빠따: 방어 깨짐 표시(풀리는 시각)', 'allow', () => other.ref('players/OTHER/gb').set(Date.now() + 60000));
await expect('빠따: 방어 깨짐 표시가 너무 먼 미래', 'deny', () => other.ref('players/OTHER/gb').set(Date.now() + 3600000));
await expect('빠따: 방어 깨짐 표시에 숫자가 아닌 값', 'deny', () => other.ref('players/OTHER/gb').set(true));
await root.ref('wallet/OK').remove();
await root.ref().update({
  'mafia/game/st': 'day',
  'mafia/game/players/OK': { alive: false },
  'mafia/game/players/OTHER': { alive: true },
  'occ/1_1': 'OTHER',
});
await expect('맵: 마피아 유령과 산 사람이 겹친 자리에서도 걸음 가능', 'allow', () => ok.ref().update({
  'occ/1_1': null, 'occ/2_1': 'OK', 'players/OK/x': 2,
}));
await root.ref('mafia').remove();
await expect('맵: 근처 채팅의 맵 위조 거부', 'deny', () => ok.ref('chat/public/fake-map').set({ u: 'OK', n: '닉', t: '다른 공간', c: 'near', m: 'portal-garden', x: 1, y: 1, ts: 1 }));
await expect('맵: 기존 기본 공간의 맵 식별자 없는 채팅 허용', 'allow', () => ok.ref('chat/public/legacy-main').set({ u: 'OK', n: '닉', t: '기본 공간', c: 'near', x: 1, y: 1, ts: 1 }));

// ---------- 경마: 결제와 배팅 기록을 쓰기 한 번에 (2026-11-12) ----------
// 따로 쓰면 그 사이 라운드가 마감될 때 코인만 나간다. 배팅 기록 규칙이 '그 쓰기 안의 지갑 값'을 보므로 한 번에 써도, 옛 클라이언트처럼 따로 써도 된다
await setNow('2026-11-14 12:00:00');
await root.ref().update({ 'wallet/OK': { c: 1000, e: 1000 }, 'casino/r/R1': { o: 1, by: 'OK' }, 'casino/r/R2': { o: 1, by: 'OK' }, 'casino/r/R3': { o: 1, by: 'OK' } });
const raceBet = (rid, pay, rec) => ({ 'wallet/OK/c': 1000 - pay, 'wallet/OK/sp': pay, 'wallet/OK/b': 'race', 'wallet/OK/cb': rid, 'wallet/OK/ch': 2, 'wallet/OK/ca': pay, [`casino/r/${rid}/bets/OK`]: { h: 2, a: rec, n: '닉' } });
await expect('경마: 낸 돈과 다른 금액을 한 번에 기록', 'deny', () => ok.ref().update(raceBet('R1', 300, 1000)));
await expect('경마: 결제 없이 배팅 기록만', 'deny', () => ok.ref('casino/r/R1/bets/OK').set({ h: 2, a: 300, n: '닉' }));
await expect('경마: 결제와 배팅 기록을 한 번에', 'allow', () => ok.ref().update(raceBet('R1', 300, 300)));
await root.ref('casino/r/R2/at').set(5);
await root.ref('wallet/OK').set({ c: 1000, e: 1000 });
await expect('경마: 마감된 라운드에 한 번에 쓰면 통째로 거부', 'deny', () => ok.ref().update(raceBet('R2', 300, 300)));
await expect('경마: 거부된 배팅은 코인을 빼지 않는다', 'allow', async () => { const c = (await root.ref('wallet/OK/c').get()).val(); if (c !== 1000) throw new Error('permission: 잔액이 ' + c); });
await expect('경마: 옛 방식(결제 먼저)', 'allow', () => ok.ref('wallet/OK').set({ c: 700, e: 1000, sp: 300, b: 'race', cb: 'R3', ch: 2, ca: 300 }));
await expect('경마: 옛 방식(기록 나중)', 'allow', () => ok.ref('casino/r/R3/bets/OK').set({ h: 2, a: 300, n: '닉' }));

// ---------- 슬롯 방: 슬롯·홀짝 (2026-11-12) ----------
// 베팅(it = 서버 시각) → 정산(ic = it, 받는 돈은 it 에서 계산한 결과와 같아야) 두 단계.
// 시험용 규칙도 이용 시간 말고는 진짜 서버 시각을 쓴다. 그래서 베팅은 서버 시각으로 쓰고, 정산은 "원하는 결과가 나오는 시각에 베팅해 둔 지갑"을 만들어 놓고 본다
{
  const SH = (t) => ((t % 9973) * 7919 + 4421) % 9973;
  const TIERS = [[10, 50], [40, 50], [240, 10], [739, 4], [1936, 2], [2734, 1]];
  const TS = ServerValue.TIMESTAMP;
  let cursor = Date.now() - 3600000;
  const atWhere = (pred) => { for (let t = cursor + 1; ; t++) if (pred(SH(t))) { cursor = t; return t; } }; // 지난 한 시간 안의 시각
  await setNow('2026-11-14 13:00:00');
  const fresh = (w = {}) => root.ref('wallet/OK').set({ c: 100000, e: 100000, ...w });
  // 그 시각(t)에 걸어 둔 지갑 (아직 정산 전)
  const betAt = (t, bet, kind, pick) => fresh({ c: 100000 - bet, sp: bet, b: kind === 's' ? 'slot' : 'oddeven', ik: kind, ib: bet, ...(kind === 'o' ? { ip: pick } : {}), it: t });
  const betW = (bet, kind, pick, extra = {}) => ({ 'wallet/OK/c': 100000 - bet, 'wallet/OK/sp': bet, 'wallet/OK/b': kind === 's' ? 'slot' : 'oddeven', 'wallet/OK/ik': kind, 'wallet/OK/ib': bet, ...(kind === 'o' ? { 'wallet/OK/ip': pick } : {}), 'wallet/OK/it': TS, ...extra });
  const settleW = (t, bet, win, extra = {}) => ({ 'wallet/OK/c': 100000 - bet + win, 'wallet/OK/e': 100000 + win, 'wallet/OK/ic': t, ...extra });
  await root.ref('slot/jp').set(12000);

  // 베팅 쓰기
  await fresh();
  await expect('슬롯: 150코인 (100 단위 아님)', 'deny', () => ok.ref().update(betW(150, 's')));
  await expect('슬롯: 한도(10,000) 초과', 'deny', () => ok.ref().update(betW(10100, 's')));
  await expect('슬롯: 시각이 서버 시각이 아님', 'deny', () => ok.ref().update(betW(500, 's', 0, { 'wallet/OK/it': Date.now() - 5000 })));
  await expect('슬롯: 낸 돈과 건 돈이 다름', 'deny', () => ok.ref().update({ ...betW(500, 's'), 'wallet/OK/c': 99900, 'wallet/OK/sp': 100 }));
  await expect('슬롯: 홀짝 표시(ip)를 끼워 넣음', 'deny', () => ok.ref().update({ ...betW(500, 's'), 'wallet/OK/ip': 1 }));
  await expect('슬롯: 잭팟에 3% 보다 많이 쌓기', 'deny', () => ok.ref().update(betW(500, 's', 0, { 'slot/jp': 12000 + 5000 })));
  await expect('슬롯: 베팅 없이 잭팟 금액만 올리기', 'deny', () => ok.ref('slot/jp').set(99999));
  await expect('슬롯: 잭팟 금액 지우기', 'deny', () => ok.ref('slot/jp').remove());
  await expect('슬롯: 베팅 + 잭팟 3%', 'allow', () => ok.ref().update(betW(500, 's', 0, { 'slot/jp': 12015 })));
  await expect('슬롯: 정산 전에 또 베팅', 'deny', () => ok.ref().update({ 'wallet/OK/c': 99000, 'wallet/OK/sp': 1000, 'wallet/OK/b': 'slot', 'wallet/OK/ik': 's', 'wallet/OK/ib': 500, 'wallet/OK/it': TS }));
  await expect('슬롯: 정산 전에도 보통 획득은 된다', 'allow', () => ok.ref().update({ 'wallet/OK/c': 99510, 'wallet/OK/e': 100010 }));
  await expect('슬롯: 보통 획득에 베팅 시각을 바꿔 끼우기', 'deny', () => ok.ref().update({ 'wallet/OK/c': 99520, 'wallet/OK/e': 100020, 'wallet/OK/it': TS }));
  await expect('슬롯: 보통 획득에 정산 표시를 끼워 큰돈 받기', 'deny', async () => { const it = (await root.ref('wallet/OK/it').get()).val(); return ok.ref().update({ 'wallet/OK/c': 999510, 'wallet/OK/e': 1000010, 'wallet/OK/ic': it }); });

  // 정산: 칸마다 받는 돈이 정확히 같아야 한다 (500코인을 건 판)
  const tierCases = [...TIERS.map(([below, mult], i) => ({ name: `${mult}배 칸(${i})`, pred: (h) => h < below && (i === 0 || h >= TIERS[i - 1][0]), mult })), { name: '꽝', pred: (h) => h >= 2734, mult: 0 }];
  for (const c of tierCases) {
    const t = atWhere(c.pred), win = 500 * c.mult;
    await betAt(t, 500, 's');
    await expect(`슬롯 정산 ${c.name}: 더 많이 받기`, 'deny', () => ok.ref().update(settleW(t, 500, win + 500)));
    if (win > 0) await expect(`슬롯 정산 ${c.name}: 덜 받기`, 'deny', () => ok.ref().update(settleW(t, 500, win - 500)));
    await expect(`슬롯 정산 ${c.name}: 다른 시각으로 표시`, 'deny', () => ok.ref().update(settleW(t + 1, 500, win)));
    await expect(`슬롯 정산 ${c.name}: 정확히 ${win}`, 'allow', () => ok.ref().update(settleW(t, 500, win)));
    await expect(`슬롯 정산 ${c.name}: 두 번 받기`, 'deny', () => ok.ref().update({ 'wallet/OK/c': 100000 - 500 + win * 2 + 100, 'wallet/OK/e': 100000 + win * 2 + 100, 'wallet/OK/ic': t + 1 }));
  }

  // 잭팟: 1,000코인 이상 건 잭팟 칸. 쌓인 금액을 받고 같은 쓰기에서 시작 금액(10,000)으로 되돌려야 한다
  let t = atWhere((h) => h < 10);
  await betAt(t, 1000, 's'); await root.ref('slot/jp').set(34590);
  await expect('잭팟: 되돌리지 않고 받기', 'deny', () => ok.ref().update(settleW(t, 1000, 34590)));
  await expect('잭팟: 쌓인 금액보다 많이', 'deny', () => ok.ref().update(settleW(t, 1000, 60000, { 'slot/jp': 10000 })));
  await expect('잭팟: 50배로 받기', 'deny', () => ok.ref().update(settleW(t, 1000, 50000)));
  await expect('잭팟: 쌓인 금액을 받고 되돌리기', 'allow', () => ok.ref().update(settleW(t, 1000, 34590, { 'slot/jp': 10000 })));
  await expect('잭팟: 받은 뒤 또 되돌리기', 'deny', () => ok.ref('slot/jp').set(10000));
  // 잭팟이 아닌 판에서 금액 되돌리기
  t = atWhere((h) => h >= 2734);
  await betAt(t, 1000, 's'); await root.ref('slot/jp').set(50000);
  await expect('잭팟: 꽝인 판에서 금액 되돌리기', 'deny', () => ok.ref().update(settleW(t, 1000, 0, { 'slot/jp': 10000 })));
  await expect('잭팟: 꽝인 판에서 쌓인 금액 받기', 'deny', () => ok.ref().update(settleW(t, 1000, 50000, { 'slot/jp': 10000 })));
  await expect('슬롯 정산 꽝: 0', 'allow', () => ok.ref().update(settleW(t, 1000, 0)));

  // 간격: 지난 판에서 1초 안에는 다음 판을 못 연다
  await fresh({ ik: 's', ib: 1000, it: Date.now() - 300, ic: Date.now() - 300 });
  await root.ref('wallet/OK').update({ ic: (await root.ref('wallet/OK/it').get()).val() });
  await expect('슬롯: 지난 판에서 1초 안에 다시', 'deny', () => ok.ref().update(betW(100, 's')));
  const old = Date.now() - 5000;
  await fresh({ ik: 's', ib: 1000, it: old, ic: old });
  await expect('슬롯: 1초 넘게 지난 뒤', 'allow', () => ok.ref().update(betW(100, 's')));

  // 홀짝
  await fresh();
  await expect('홀짝: 고른 쪽이 없음', 'deny', () => ok.ref().update({ ...betW(1000, 'o', 1), 'wallet/OK/ip': null }));
  await expect('홀짝: 고른 쪽이 2', 'deny', () => ok.ref().update(betW(1000, 'o', 2)));
  await expect('홀짝: 홀에 1,000', 'allow', () => ok.ref().update(betW(1000, 'o', 1)));
  t = atWhere((h) => h % 2 === 1);
  await betAt(t, 1000, 'o', 1);
  await expect('홀짝: 맞혔는데 2배 받기', 'deny', () => ok.ref().update(settleW(t, 1000, 2000)));
  await expect('홀짝: 정산하며 고른 쪽 바꾸기', 'deny', () => ok.ref().update(settleW(t, 1000, 1900, { 'wallet/OK/ip': 0 })));
  await expect('홀짝: 맞혀서 1.9배', 'allow', () => ok.ref().update(settleW(t, 1000, 1900)));
  t = atWhere((h) => h % 2 === 0);
  await betAt(t, 1000, 'o', 1);
  await expect('홀짝: 틀렸는데 받기', 'deny', () => ok.ref().update(settleW(t, 1000, 1900)));
  await expect('홀짝: 틀려서 0', 'allow', () => ok.ref().update(settleW(t, 1000, 0)));
  await root.ref().update({ 'wallet/OK': null, 'slot/jp': null });
}

// ---------- 1:1 내기: 주사위 대결 (2026-11-12) ----------
// 신청(내기 만들기 + 판돈 + 초대) → 수락(판돈 + acc = 서버 시각) → 이긴 사람이 정산. 수락되지 않으면 신청한 사람이 돌려받는다
{
  const SH = (t) => ((t % 9973) * 7919 + 4421) % 9973;
  const TS = ServerValue.TIMESTAMP;
  await setNow('2026-11-14 14:00:00');
  await root.ref().update({ 'approved/OTHER': true, 'wallet/OK': { c: 50000, e: 50000 }, 'wallet/OTHER': { c: 50000, e: 50000 }, 'players/OK': presence, 'players/OTHER': presence, 'duel': null, 'duelInv': null });
  const duelOf = (s, extra = {}) => ({ a: 'OK', b: 'OTHER', an: '닉', bn: '닉2', k: 'dice', s, o: TS, ...extra });
  const invOf = (id, s) => ({ id, f: 'OK', fn: '닉', s, k: 'dice', t: TS });
  const stake = (uid, bal, s, id) => ({ [`wallet/${uid}/c`]: bal - s, [`wallet/${uid}/sp`]: s, [`wallet/${uid}/b`]: 'duel', [`wallet/${uid}/dl`]: id });
  const claim = (uid, bal, sp, amount, id) => ({ [`wallet/${uid}/c`]: bal + amount, [`wallet/${uid}/e`]: 50000 + amount, [`wallet/${uid}/sp`]: sp, [`wallet/${uid}/dc`]: id, [`duel/${id}/paid`]: true });

  // 신청
  await expect('내기: 판돈 없이 내기만 만들기', 'deny', () => ok.ref('duel/D1').set(duelOf(1000)));
  await expect('내기: 내기 없이 판돈 표시만', 'deny', () => ok.ref().update(stake('OK', 50000, 1000, 'D1')));
  await expect('내기: 낸 돈과 판돈이 다름', 'deny', () => ok.ref().update({ 'duel/D1': duelOf(1000), ...stake('OK', 50000, 100, 'D1') }));
  await expect('내기: 150코인 (100 단위 아님)', 'deny', () => ok.ref().update({ 'duel/D1': duelOf(150), ...stake('OK', 50000, 150, 'D1') }));
  await expect('내기: 남의 이름으로 신청', 'deny', () => ok.ref().update({ 'duel/D1': duelOf(1000, { a: 'OTHER', b: 'OK' }), ...stake('OK', 50000, 1000, 'D1') }));
  await expect('내기: 자기 자신에게', 'deny', () => ok.ref().update({ 'duel/D1': duelOf(1000, { b: 'OK' }), ...stake('OK', 50000, 1000, 'D1') }));
  await expect('내기: 접속해 있지 않은 상대', 'deny', () => ok.ref().update({ 'duel/D1': duelOf(1000, { b: 'NOBODY' }), ...stake('OK', 50000, 1000, 'D1') }));
  await expect('내기: 수락까지 같이 적어 신청', 'deny', () => ok.ref().update({ 'duel/D1': duelOf(1000, { acc: TS }), ...stake('OK', 50000, 1000, 'D1') }));
  await expect('내기: 초대만 보내기 (내기 없음)', 'deny', () => ok.ref('duelInv/OTHER').set(invOf('D1', 1000)));
  await expect('내기: 신청 (내기 + 판돈 + 초대)', 'allow', () => ok.ref().update({ 'duel/D1': duelOf(1000), 'duelInv/OTHER': invOf('D1', 1000), ...stake('OK', 50000, 1000, 'D1') }));
  await expect('내기: 초대는 받는 사람만 읽는다', 'deny', () => ok.ref('duelInv/OTHER').get());
  await expect('내기: 받는 사람이 초대 읽기', 'allow', () => other.ref('duelInv/OTHER').get());
  await expect('내기: 방금 초대받은 사람에게 또 신청', 'deny', () => ok.ref().update({ 'duel/D1b': duelOf(1000), 'duelInv/OTHER': invOf('D1b', 1000), ...stake('OK', 49000, 1000, 'D1b') }));
  await expect('내기: 수락 전에 신청한 사람이 돌려받기', 'deny', () => ok.ref().update(claim('OK', 49000, 1000, 1000, 'D1')));

  // 수락
  await expect('내기: 신청한 사람이 대신 수락', 'deny', () => ok.ref('duel/D1/acc').set(TS));
  await expect('내기: 판돈 없이 수락', 'deny', () => other.ref('duel/D1/acc').set(TS));
  await expect('내기: 수락 시각이 서버 시각이 아님', 'deny', () => other.ref().update({ 'duel/D1/acc': Date.now() - 3000, ...stake('OTHER', 50000, 1000, 'D1') }));
  await expect('내기: 판돈보다 적게 내고 수락', 'deny', () => other.ref().update({ 'duel/D1/acc': TS, ...stake('OTHER', 50000, 100, 'D1') }));
  await expect('내기: 수락 (판돈 + acc + 초대 지우기)', 'allow', () => other.ref().update({ 'duel/D1/acc': TS, 'duelInv/OTHER': null, ...stake('OTHER', 50000, 1000, 'D1') }));
  await expect('내기: 수락한 뒤 거절 표시', 'deny', () => other.ref('duel/D1/no').set(true));
  await expect('내기: 두 번 수락', 'deny', () => other.ref('duel/D1/acc').set(TS));

  // 정산: 이긴 사람만, 정확한 금액(1,000 × 2 − 5% = 1,900)
  const acc = (await root.ref('duel/D1/acc').get()).val();
  const win = SH(acc) % 2 === 0 ? 'OK' : 'OTHER', lose = win === 'OK' ? 'OTHER' : 'OK';
  const dbOf = (uid) => (uid === 'OK' ? ok : other);
  await expect('내기: 진 사람이 정산', 'deny', () => dbOf(lose).ref().update(claim(lose, 49000, 1000, 1900, 'D1')));
  await expect('내기: 이긴 사람이 수수료 없이 받기', 'deny', () => dbOf(win).ref().update(claim(win, 49000, 1000, 2000, 'D1')));
  await expect('내기: paid 표시 없이 받기', 'deny', () => dbOf(win).ref().update({ [`wallet/${win}/c`]: 50900, [`wallet/${win}/e`]: 51900, [`wallet/${win}/sp`]: 1000, [`wallet/${win}/dc`]: 'D1' }));
  await expect('내기: 돈은 안 받고 paid 만 적기', 'deny', () => dbOf(lose).ref('duel/D1/paid').set(true));
  await expect('내기: 이긴 사람이 1,900 받기', 'allow', () => dbOf(win).ref().update(claim(win, 49000, 1000, 1900, 'D1')));
  await expect('내기: 두 번 받기', 'deny', () => dbOf(win).ref().update({ [`wallet/${win}/c`]: 52800, [`wallet/${win}/e`]: 53800, [`wallet/${win}/dc`]: 'D1x', 'duel/D1/paid': true }));
  await expect('내기: 하루 안 된 내기 지우기', 'deny', () => ok.ref('duel/D1').remove());

  // 수수료 설정을 바꾸면 그 값으로
  await root.ref().update({ 'config/duelFee': 10, 'wallet/OK': { c: 50000, e: 50000 }, 'wallet/OTHER': { c: 50000, e: 50000 }, 'duel/D2': { a: 'OK', b: 'OTHER', an: '닉', bn: '닉2', k: 'dice', s: 500, o: Date.now() - 5000, acc: Date.now() - 2000 } });
  const acc2 = (await root.ref('duel/D2/acc').get()).val();
  const win2 = SH(acc2) % 2 === 0 ? 'OK' : 'OTHER';
  await expect('내기: 수수료 10% 인데 5% 로 받기', 'deny', () => dbOf(win2).ref().update({ [`wallet/${win2}/c`]: 50950, [`wallet/${win2}/e`]: 50950, [`wallet/${win2}/dc`]: 'D2', 'duel/D2/paid': true }));
  await expect('내기: 수수료 10% 로 900 받기', 'allow', () => dbOf(win2).ref().update({ [`wallet/${win2}/c`]: 50900, [`wallet/${win2}/e`]: 50900, [`wallet/${win2}/dc`]: 'D2', 'duel/D2/paid': true }));
  await root.ref('config/duelFee').remove();

  // 거절 → 신청한 사람이 판돈 그대로 돌려받는다
  await root.ref().update({ 'wallet/OK': { c: 50000, e: 50000 }, 'duelInv': null });
  await ok.ref().update({ 'duel/D3': duelOf(2000), 'duelInv/OTHER': invOf('D3', 2000), ...stake('OK', 50000, 2000, 'D3') });
  await expect('내기: 남이 거절 표시', 'deny', () => ok.ref('duel/D3/no').set(true));
  await expect('내기: 받는 사람이 거절', 'allow', () => other.ref().update({ 'duel/D3/no': true, 'duelInv/OTHER': null }));
  await expect('내기: 거절한 뒤 수락', 'deny', () => other.ref().update({ 'duel/D3/acc': TS, ...stake('OTHER', 50000, 2000, 'D3') }));
  await expect('내기: 거절됐는데 더 많이 돌려받기', 'deny', () => ok.ref().update(claim('OK', 48000, 2000, 3800, 'D3')));
  await expect('내기: 받는 사람이 대신 돌려받기', 'deny', () => other.ref().update({ 'wallet/OTHER/c': 52000, 'wallet/OTHER/e': 52000, 'wallet/OTHER/dc': 'D3', 'duel/D3/paid': true }));
  await expect('내기: 신청한 사람이 판돈 돌려받기', 'allow', () => ok.ref().update(claim('OK', 48000, 2000, 2000, 'D3')));

  // 시간 초과: 25초가 지나야 돌려받고, 그 뒤에는 수락할 수 없다
  await root.ref().update({ 'wallet/OK': { c: 48000, e: 50000, sp: 2000, b: 'duel', dl: 'D4' }, 'duel/D4': { a: 'OK', b: 'OTHER', an: '닉', bn: '닉2', k: 'dice', s: 2000, o: Date.now() - 10000 } });
  await expect('내기: 10초밖에 안 지났는데 돌려받기', 'deny', () => ok.ref().update(claim('OK', 48000, 2000, 2000, 'D4')));
  await root.ref('duel/D4/o').set(Date.now() - 26000);
  await expect('내기: 시간이 지난 뒤 수락', 'deny', () => other.ref().update({ 'duel/D4/acc': TS, ...stake('OTHER', 50000, 2000, 'D4') }));
  await expect('내기: 시간이 지나 돌려받기', 'allow', () => ok.ref().update(claim('OK', 48000, 2000, 2000, 'D4')));
  await expect('내기: 돌려받은 뒤 수락', 'deny', () => other.ref().update({ 'duel/D4/acc': TS, ...stake('OTHER', 50000, 2000, 'D4') }));

  // 끼워 넣기: 다른 쓰기에 내기 표시를 바꿔 넣지 못한다
  await root.ref('wallet/OK').set({ c: 50000, e: 50000 });
  await expect('내기: 보통 획득에 정산 표시 끼우기', 'deny', () => ok.ref().update({ 'wallet/OK/c': 50010, 'wallet/OK/e': 50010, 'wallet/OK/dc': 'D1' }));
  await expect('내기: 보통 획득에 결제 표시 끼우기', 'deny', () => ok.ref().update({ 'wallet/OK/c': 50010, 'wallet/OK/e': 50010, 'wallet/OK/dl': 'D9' }));
  await expect('내기: 접속 표시에 신청 안 받음', 'allow', () => ok.ref('players/OK/nd').set(true));
  await expect('내기: 접속 표시에 이상한 값', 'deny', () => ok.ref('players/OK/nd').set('x'));
  await root.ref().update({ 'wallet/OK': null, 'wallet/OTHER': null, duel: null, duelInv: null, 'players/OK/nd': null });
}

// ---------- 게시판: 패치 노트 분류는 관리자만 (2026-11-12) ----------
const post = (u, cat) => ({ title: '제목', body: '내용', u, n: '닉', ts: 1, cc: 0, cat });
await expect('게시판: 일반 사용자가 똥글 쓰기', 'allow', () => ok.ref('board/posts/p-junk').set(post('OK', 'junk')));
await expect('게시판: 일반 사용자가 패치 노트 쓰기', 'deny', () => ok.ref('board/posts/p-fake').set(post('OK', 'patch')));
await expect('게시판: 없는 분류', 'deny', () => ok.ref('board/posts/p-bad').set(post('OK', 'notice')));
await expect('게시판: 관리자가 패치 노트와 알림 칸을 한 번에 쓰기', 'allow', () => admin.ref().update({ 'board/posts/p-patch': post('ADMIN', 'patch'), 'config/patchNote': { id: 'p-patch', t: '제목' } }));
await expect('게시판: 일반 사용자가 패치 노트 알림 칸 쓰기', 'deny', () => ok.ref('config/patchNote').set({ id: 'x', t: '가짜' }));
await expect('게시판: 일반 사용자가 패치 노트 알림 칸 읽기', 'allow', () => ok.ref('config/patchNote').get());

console.log(`규칙 시험: 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
