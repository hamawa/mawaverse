// 경마공원 로컬 시험 준비 (에뮬레이터 전용). 실제 Firebase 프로젝트에는 붙지 않는다:
//  주소는 127.0.0.1 의 Auth(9099)·DB(9000) 에뮬레이터와 demo 프로젝트로 고정이고, 환경변수·serviceAccount 를 읽지 않으며,
//  Auth 에뮬레이터가 자기 자신이라고 답하지 않으면 아무것도 쓰지 않고 멈춘다.
// 실행: 터미널 1 에서 npm run emulators → 터미널 2 에서 node tools/derby-emulator-seed.mjs [--branch]   (다시 돌려도 된다: 코인·위치를 처음 값으로 되돌린다. --branch 는 광장 경마분점 문 앞에서 시작)
// 하는 일 (README "경마공원 로컬 시험"):
//  - 시험 계정 둘: 플레이어(승인·코인 100,000·다음 로그인 때 경마공원 창구 앞에서 시작), 관리자
//  - config/raceHours(매일 종일 운영) · config/raceMax(공원 100,000 · 분점 50,000) · config/hoursBlock=false
//  - raceData(이 PC 의 코드로 계산한 공개 고정 자료. raceData/v 가 같으면 다시 올리지 않는다) · holidays(holidays.deploy.json)
//  - 숨은 결과표 raceSecret + race/cover: 지금 경주부터 SEED.secretDays 일 (실제 운영의 node tools/gen-derby.mjs secret 과 같은 함수로)
// 아이디 → 이메일, 비밀번호 → 키는 src/firebase/auth.ts 의 emailFor · pwKey 를 그대로 불러 쓴다.
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

registerHooks({
  resolve(spec, ctx, next) {
    // auth.ts 의 './app' 은 브라우저 설정(import.meta.env·location)을 읽는다: 여기서는 emailFor·pwKey 만 쓰므로 빈 모듈로 바꾼다
    if (spec === './app' && ctx.parentURL?.endsWith('/src/firebase/auth.ts')) {
      return { url: `data:text/javascript,${encodeURIComponent('export const app = null, auth = null, db = null;')}`, shortCircuit: true };
    }
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

const { emailFor, pwKey, idPathKey } = await import('../src/firebase/auth.ts');
const { nickKey } = await import('../src/shared/util.ts');
const { raceNo } = await import('../src/shared/derby.ts');
const { publicRaceData, uploadSecret } = await import('./gen-derby.mjs');

export const EMU = Object.freeze({
  auth: 'http://127.0.0.1:9099',
  db: 'http://127.0.0.1:9000',
  project: 'demo-mawaverse',
  ns: 'demo-mawaverse-default-rtdb', // src/firebase/app.ts 의 에뮬레이터 databaseURL 과 같은 이름
  apiKey: 'demo-api-key',
});
// 시험 계정 (에뮬레이터 안에만 있는 값)
export const SEED = Object.freeze({
  player: { id: 'racer', pw: 'racer1234', nick: '경마손님', avatar: 'm01', coins: 100000 },
  admin: { id: 'admin', pw: 'admin1234', nick: '관리자', avatar: 'f01' },
  secretDays: 2,
  // 경마공원 관람석 뒤 창구(18,32) 바로 앞 (map.ts RACE_TELLERS. 창구의 북쪽 칸에 선다). 0 = 아래(창구)를 본다
  spawn: { x: 18, y: 31, d: 0, m: 'race-park' },
  // 광장 경마분점(카지노 방 zone x 35~40 · y 6~9, map.ts buildCoffeeStreet)의 첫 자리. 시험(tests/derby-e2e)이 여기 앉아 분점에서 산다
  branchSeat: { x: 35, y: 6 },
  // --branch: 다음 로그인 때 광장 경마분점 문 앞(zone exit 38,10. 기본 맵이라 m 을 싣지 않는다)에서 시작한다. 3 = 위(문)를 본다
  branchDoor: { x: 38, y: 10, d: 3 },
  hours: { on: true, d: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, { s: 0, e: 1440 }])) },
  raceMax: { park: 100000, branch: 50000 },
});

// 에뮬레이터인지 먼저 확인한다 (127.0.0.1 고정 주소라 실제 서버일 수는 없지만, 다른 프로그램이 그 포트를 쓰는 경우를 막는다)
export async function assertEmulator() {
  let ok = false;
  try {
    const res = await fetch(`${EMU.auth}/`, { signal: AbortSignal.timeout(3000) });
    ok = res.ok && (await res.json())?.authEmulator?.ready === true;
  } catch { ok = false; }
  if (!ok) throw new Error(`Auth 에뮬레이터(${EMU.auth})가 응답하지 않습니다. 먼저 npm run emulators 를 실행하세요. 에뮬레이터가 아니면 아무것도 쓰지 않습니다.`);
  try {
    const res = await fetch(`${EMU.db}/.json?ns=${EMU.ns}&shallow=true`, { headers: { Authorization: 'Bearer owner' }, signal: AbortSignal.timeout(3000) });
    ok = res.ok;
  } catch { ok = false; }
  if (!ok) throw new Error(`DB 에뮬레이터(${EMU.db})가 응답하지 않습니다. 먼저 npm run emulators 를 실행하세요.`);
}

async function authCall(op, body) {
  const res = await fetch(`${EMU.auth}/identitytoolkit.googleapis.com/v1/accounts:${op}?key=${EMU.apiKey}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, returnSecureToken: true }),
  });
  const data = await res.json();
  return res.ok ? { ok: true, uid: data.localId } : { ok: false, code: data?.error?.message ?? String(res.status) };
}
// 계정을 만들거나(이미 있으면 같은 비밀번호로 로그인해) uid 를 얻는다
async function ensureAccount(email, password) {
  const made = await authCall('signUp', { email, password });
  if (made.ok) return made.uid;
  if (made.code !== 'EMAIL_EXISTS') throw new Error(`에뮬레이터 계정을 만들지 못했습니다 (${made.code})`);
  const signed = await authCall('signInWithPassword', { email, password });
  if (!signed.ok) throw new Error(`에뮬레이터 계정에 로그인하지 못했습니다 (${signed.code}). 에뮬레이터 UI 에서 그 계정을 지우고 다시 실행하세요.`);
  return signed.uid;
}

// 관리자 권한(owner)으로 DB 에뮬레이터에 쓴다: 규칙을 거치지 않는다 (준비용)
async function dbCall(method, path, body) {
  const res = await fetch(`${EMU.db}/${path}.json?ns=${EMU.ns}`, {
    method, headers: { Authorization: 'Bearer owner', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`DB 에뮬레이터 ${method} ${path || '/'} 실패 (${res.status})`);
  return res.json();
}
export const ownerGet = (path) => dbCall('GET', path);
export const ownerPatch = (patch) => dbCall('PATCH', '', patch);

// 게임 계정 하나 (가입 + 승인과 같은 모양: users · ids · nicknames · signups · approved)
function gameUser(uid, u, extra) {
  const at = { '.sv': 'timestamp' };
  return {
    [`users/${uid}`]: { id: u.id, nick: u.nick, avatar: u.avatar, losses: 0, createdAt: at, ...extra },
    [`ids/${idPathKey(u.id)}`]: uid,
    [`nicknames/${nickKey(u.nick)}`]: uid,
    [`signups/${uid}`]: { name: '에뮬레이터 시험', reason: '경마공원 로컬 시험 계정', at },
    [`approved/${uid}`]: true,
  };
}

export async function seedDerbyEmulator({ log = console.log, start = 'park' } = {}) {
  await assertEmulator();
  const { player, admin } = SEED;
  const playerUid = await ensureAccount(emailFor(player.id), pwKey(player.id, player.pw));
  const adminUid = await ensureAccount(emailFor(admin.id), pwKey(admin.id, admin.pw));

  // 플레이어가 접속해 있지 않을 때만 자리를 비운다 (접속 중이면 그 화면이 자기 자리를 쥐고 있다)
  const online = (await ownerGet(`players/${playerUid}`)) !== null;
  const patch = {
    ...gameUser(playerUid, player, { lastPos: start === 'branch' ? SEED.branchDoor : SEED.spawn }),
    ...gameUser(adminUid, admin, {}),
    [`admins/${adminUid}`]: true,
    [`wallet/${playerUid}`]: { c: player.coins, e: player.coins },
    'config/raceHours': SEED.hours,
    'config/raceMax': SEED.raceMax,
    'config/hoursBlock': false,
  };
  await ownerPatch(patch);
  if (online) log('플레이어가 접속 중입니다: 시작 위치는 다음 로그인 때부터 적용됩니다.');

  const data = publicRaceData(), v = data.v;
  if ((await ownerGet('raceData/v')) !== v) {
    log('공개 고정 자료(raceData)를 올리는 중...');
    await dbCall('PUT', 'raceData', data);
  }
  const holidaysFile = fileURLToPath(new URL('../holidays.deploy.json', import.meta.url));
  if (existsSync(holidaysFile)) await dbCall('PUT', 'holidays', JSON.parse(readFileSync(holidaysFile, 'utf8')));
  else log('holidays.deploy.json 이 없어 공휴일은 올리지 않았습니다 (npm run rules 로 만듭니다).');

  // 숨은 결과표: 이미 덮은 범위는 그대로 두고 뒤에 잇는다 (에뮬레이터는 이 PC 의 시계를 쓴다)
  const cover = await ownerGet('race/cover');
  log('숨은 결과표(raceSecret)를 올리는 중...');
  const plan = await uploadSecret({ write: ownerPatch, cur: raceNo(Date.now()), cover, days: SEED.secretDays, replace: !!cover && cover.v !== v, v });
  return { playerUid, adminUid, raceDataVersion: v, cover: { s: plan.s, e: plan.end } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const start = process.argv.includes('--branch') ? 'branch' : 'park';
  seedDerbyEmulator({ start }).then((r) => {
    console.log('에뮬레이터 준비 완료.');
    console.log(`  플레이어   아이디 ${SEED.player.id} / 비밀번호 ${SEED.player.pw} (코인 ${SEED.player.coins.toLocaleString('ko-KR')}, ${start === 'branch' ? '광장 경마분점 문 앞' : '경마공원 창구 앞'}에서 시작) uid ${r.playerUid}`);
    console.log(`  관리자     아이디 ${SEED.admin.id} / 비밀번호 ${SEED.admin.pw} uid ${r.adminUid}`);
    console.log(`  경마공원   고정 자료 버전 ${r.raceDataVersion}, 숨은 결과표 경주 ${r.cover.s} ~ ${r.cover.e - 1}`);
  }, (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
