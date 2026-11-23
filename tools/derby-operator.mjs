// 경마공원 운영 프로그램 (운영 PC 에서 직접 실행하는 로컬 CLI. 별도 호스팅 없음, Firebase Spark 그대로).
// 실행: node --env-file=<보호된 env 파일> tools/derby-operator.mjs      (환경변수만 읽는다. 파일을 스스로 열지 않는다)
// 필요한 값: DERBY_OPERATOR_EMAIL · DERBY_OPERATOR_PASSWORD (전용 Firebase Authentication 계정) + 기존 VITE_FIREBASE_* 5개.
// Admin SDK 키는 쓰지 않는다. 클라이언트 Auth SDK 로 그 계정에 로그인하고, 데이터는 SDK 의 캐시·재전송 큐 없이
// 인증된 REST 요청(auth=<ID 토큰>)으로 읽고 쓴다: 규칙이 허용한 칸(race/op/hb, race/r/{n}, race/x/{n})만 쓴다.
// 동작과 계약은 tools/derby-operator-core.mjs 머리말, 운영 방법은 README "경마 운영 프로그램".
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDerbyOperator } from './derby-operator-core.mjs';
import { localDataVersion, parseBreaks, readJson } from './derby-shared.mjs';

export const FIREBASE_ENV = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_DATABASE_URL', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'];
export const OPERATOR_ENV = ['DERBY_OPERATOR_EMAIL', 'DERBY_OPERATOR_PASSWORD'];
export const IO_TIMEOUT_MS = 15000;
export const SERVER_TS = Object.freeze({ '.sv': 'timestamp' });
const EMULATOR_DB = 'http://127.0.0.1:9000';

// 환경변수 → 설정. 빠진 이름만 알려 준다(값은 어디에도 싣지 않는다)
export function parseOperatorEnv(env) {
  const emulator = env.VITE_USE_EMULATOR === '1';
  const need = [...OPERATOR_ENV, ...(emulator ? [] : FIREBASE_ENV)];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) return { ok: false, missing };
  const firebase = emulator
    ? { apiKey: 'demo-api-key', authDomain: 'demo-mawaverse.firebaseapp.com', projectId: 'demo-mawaverse', databaseURL: 'https://demo-mawaverse-default-rtdb.firebaseio.com', appId: 'demo-app' }
    : { apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID, databaseURL: env.VITE_FIREBASE_DATABASE_URL, appId: env.VITE_FIREBASE_APP_ID };
  return { ok: true, emulator, firebase, email: env.DERBY_OPERATOR_EMAIL, password: env.DERBY_OPERATOR_PASSWORD };
}

// 전송 오류. code 한 단어와 net 여부만 가진다(주소·토큰·응답 본문은 담지 않는다).
// net=true: 끊김·시간 초과·5xx·읽다 만 응답처럼 서버가 받았는지 알 수 없는 오류. net=false: 서버가 분명히 거절(쓰기가 적용되지 않았다).
export class RestError extends Error {
  constructor(code, net, status) { super(code); this.name = 'RestError'; this.code = code; this.net = net; this.status = status; }
}

// 인증된 REST 로 읽고 쓰는 저장소. 요청마다 시간 제한과 취소가 있고, 자동 재전송·캐시는 없다.
//  getToken(forceRefresh) -> Firebase ID 토큰, fetchFn/setTimer/clearTimer 는 바깥에서 넣는다(시험은 가짜).
//  namespace 는 에뮬레이터에서만 쓴다(?ns=).
export function createRestStore({ databaseURL, namespace = null, uid, getToken, fetchFn, setTimer, clearTimer, timeoutMs = IO_TIMEOUT_MS, onClose = null, identity = () => true }) {
  const base = databaseURL.replace(/\/+$/, '');
  const inflight = new Set();
  let closed = false, refresh = false, closing = null;
  const checkIdentity = () => { if (!identity()) throw new RestError('identity', true); };

  async function request(method, path, { query = {}, body } = {}) {
    if (closed) throw new RestError('closed', true);
    checkIdentity();
    const ac = new AbortController();
    inflight.add(ac);
    let timedOut = false;
    const timer = setTimer(() => { timedOut = true; ac.abort(); }, timeoutMs);
    const lost = () => new RestError(closed ? 'closed' : timedOut ? 'timeout' : 'network', true);
    // 취소·시간 초과는 전송 쪽이 신호를 무시해도 이 요청을 끝낸다(응답이 늦게 와도 버린다)
    const aborted = new Promise((_, rej) => ac.signal.addEventListener('abort', () => rej(lost()), { once: true }));
    aborted.catch(() => {});
    const guard = (p) => Promise.race([p, aborted]);
    try {
      let token;
      try { token = await guard(getToken(refresh)); refresh = false; } catch (e) {
        if (e instanceof RestError) throw e;
        throw new RestError(e && typeof e.code === 'string' && /^auth\/[\w-]{1,50}$/.test(e.code) ? e.code : 'auth', true);
      }
      if (closed || ac.signal.aborted) throw lost();
      checkIdentity();
      const params = new URLSearchParams(query);
      params.set('auth', token);
      if (namespace) params.set('ns', namespace);
      let res;
      try {
        res = await guard(fetchFn(`${base}/${path}.json?${params}`, {
          method, signal: ac.signal, cache: 'no-store', redirect: 'error',
          headers: { 'cache-control': 'no-store, no-cache', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        }));
      } catch { throw lost(); }
      const s = res.status;
      if (s === 401 || s === 403) { if (s === 401) refresh = true; throw new RestError('permission', false, s); }
      if (s >= 500 || s === 429 || s === 408) throw new RestError(`http${s}`, true, s);
      if (s < 200 || s >= 300) throw new RestError(`http${s}`, false, s);
      let data;
      try { data = await guard(res.json()); } catch { throw closed || timedOut ? lost() : new RestError('badbody', true, s); }
      if (closed || ac.signal.aborted) throw lost();
      checkIdentity();
      return data;
    } finally {
      clearTimer(timer);
      inflight.delete(ac);
    }
  }

  return {
    get uid() { return identity() ? uid : null; },
    SERVER_TS,
    get: (path) => request('GET', path),
    // 쓴 값(서버 시각이 풀린 것)을 돌려준다
    put: (path, value) => request('PUT', path, { body: value }),
    // 과거부터 현재까지 키 순으로 한정한다.
    async range(path, fromKey, limit, throughKey) {
      const data = await request('GET', path, { query: {
        orderBy: '"$key"', startAt: JSON.stringify(String(fromKey)), limitToFirst: String(limit),
        ...(throughKey === undefined ? {} : { endAt: JSON.stringify(String(throughKey)) }),
      } });
      if (Array.isArray(data)) return Object.fromEntries(data.map((v, i) => [i, v]).filter(([, v]) => v != null));
      return data ?? {};
    },
    close() {
      if (closed) return closing;
      closed = true;
      for (const ac of inflight) ac.abort();
      closing = Promise.resolve().then(() => onClose?.());
      return closing;
    },
  };
}

// Firebase 클라이언트 Auth SDK 로 로그인해 core 가 쓰는 store 를 만든다
export async function createFirebaseStore(cfg) {
  const { initializeApp, deleteApp } = await import('firebase/app');
  const { getAuth, signInWithEmailAndPassword, connectAuthEmulator } = await import('firebase/auth');
  const app = initializeApp(cfg.firebase);
  const auth = getAuth(app);
  if (cfg.emulator) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  let user;
  try { ({ user } = await signInWithEmailAndPassword(auth, cfg.email, cfg.password)); }
  catch (e) { await deleteApp(app); throw e; }
  return createRestStore({
    databaseURL: cfg.emulator ? EMULATOR_DB : cfg.firebase.databaseURL,
    namespace: cfg.emulator ? new URL(cfg.firebase.databaseURL).hostname.split('.')[0] : null,
    uid: user.uid,
    identity: () => auth.currentUser === user,
    getToken: async (force) => {
      if (auth.currentUser !== user) throw new RestError('identity', true);
      const token = await user.getIdToken(force);
      if (auth.currentUser !== user) throw new RestError('identity', true);
      return token;
    },
    fetchFn: (url, init) => fetch(url, init),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h),
    onClose: () => deleteApp(app),
  });
}

export async function main(env = process.env) {
  const stamp = () => new Date().toISOString().slice(11, 19);
  const log = (msg) => console.log(`[${stamp()}] ${msg}`);
  const cfg = parseOperatorEnv(env);
  if (!cfg.ok) {
    console.error(`필요한 환경변수가 없습니다: ${cfg.missing.join(', ')}\n보호된 env 파일에 넣고 node --env-file=<파일> tools/derby-operator.mjs 로 실행하세요(README "경마 운영 프로그램").`);
    return 1;
  }
  log('이 PC 의 고정 자료 버전을 계산하는 중...');
  const localVersion = localDataVersion();
  let store;
  try { store = await createFirebaseStore(cfg); } catch (e) {
    const code = typeof e?.code === 'string' && /^auth\/[\w-]{1,50}$/.test(e.code) ? e.code : 'error';
    console.error(`로그인 또는 연결에 실패했습니다(${code}). 운영 계정과 VITE_FIREBASE_* 값을 확인하세요.`);
    return 1;
  }
  if (cfg.emulator) log('에뮬레이터에 연결합니다(VITE_USE_EMULATOR=1).');
  const op = createDerbyOperator({
    store, localVersion, log,
    clock: { wall: () => Date.now(), mono: () => performance.now() },
    timers: { setInterval: (f, ms) => setInterval(f, ms), clearInterval: (h) => clearInterval(h) },
    holidays: readJson('../holidays.json'),
    breaks: parseBreaks(readJson('../hours.json').breaks),
  });
  return new Promise((done) => {
    const quit = () => {
      process.removeListener('SIGINT', quit);
      process.removeListener('SIGTERM', quit);
      op.stop().then(() => done(0), () => done(1));
    };
    process.once('SIGINT', quit);
    process.once('SIGTERM', quit);
    op.start();
  });
}

// 직접 실행했을 때만 돈다 (불러오기만 해서는 아무 일도 하지 않는다)
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => {
    process.exitCode = code;
    setTimeout(() => process.exit(code), 3000).unref(); // Auth SDK 가 남긴 타이머가 있어도 정리 뒤에는 끝낸다
  });
}
