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
  ['평일 12:00', '2026-11-11 12:00:00', false],
  ['평일 17:59', '2026-11-11 17:59:59', false],
  ['평일 18:00', '2026-11-11 18:00:00', true],
  ['평일 새벽', '2026-11-12 03:00:00', true],
  ['월요일 10:00', '2026-11-09 10:00:00', false],
  ['금요일 10:00', '2026-11-13 10:00:00', false],
  ['토요일 12:00', '2026-11-14 12:00:00', true],
  ['일요일 12:00', '2026-11-15 12:00:00', true],
  ['공휴일(금) 12:00', '2026-12-25 12:00:00', true],
  ['공휴일 다음 평일 12:00', '2026-12-28 12:00:00', false],
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
await setNow('2026-11-11 12:00:00');
await expect('설정 켬: 평일 12:00 승인된 사용자 → 차단', 'deny', () => ok.ref('config').get());
await expect('설정: 일반 사용자가 차단 설정을 바꾸기', 'deny', () => ok.ref('config/hoursBlock').set(false));
await expect('설정: 로그인 안 한 사람도 차단 설정 여부는 읽는다', 'allow', () => anon.ref('config/hoursBlock').get());
await expect('설정: 로그인 안 한 사람이 다른 설정 읽기', 'deny', () => anon.ref('config/maxPlayers').get());
await expect('설정: 차단 시간에도 관리자는 설정을 끌 수 있다', 'allow', () => admin.ref('config/hoursBlock').set(false));
await expect('설정 끔: 평일 12:00 승인된 사용자가 설정 읽기', 'allow', () => ok.ref('config').get());
await expect('설정 끔: 평일 12:00 승인된 사용자가 접속 표시 쓰기', 'allow', () => ok.ref('players/OK').set({ ...presence, hb: ServerValue.TIMESTAMP }));
await expect('설정 끔: 평일 12:00 새 사람이 가입 신청서 쓰기', 'allow', () => as('NEWOFF').ref('signups/NEWOFF').set({ name: '박신청', reason: '가입 사유', at: ServerValue.TIMESTAMP }));
await expect('설정 끔: 승인 안 된 사용자는 여전히 못 들어옴', 'deny', () => as('NEWOFF').ref('players/NEWOFF').set({ ...presence, hb: ServerValue.TIMESTAMP }));
await expect('설정: 불리언이 아닌 값', 'deny', () => admin.ref('config/hoursBlock').set('yes'));
await root.ref('config/hoursBlock').remove();
await expect('설정 없음(기본): 평일 12:00 승인된 사용자가 설정 읽기', 'allow', () => ok.ref('config').get());
await expect('설정 없음(기본): 승인 안 된 사용자는 못 들어옴', 'deny', () => as('NEWOFF').ref('config').get());

console.log(`규칙 시험: 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
