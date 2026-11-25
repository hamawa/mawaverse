#!/usr/bin/env node
// 가입 신청 알림: 승인을 기다리는 새 가입 신청이 있으면 디스코드로 알린다.
// 서버가 없어서 GitHub Actions(.github/workflows/signup-notify.yml)가 5분마다 이 파일을 돌린다.
// 의존 패키지가 없다(Node 18 이상의 fetch·crypto 만 쓴다): 돌 때마다 npm ci 를 하지 않으려고.
//
// 하는 일
//   1) signups·approved 의 열쇠만 읽는다(shallow). 실명·가입 사유는 내려받지 않는다.
//   2) 승인 안 된 신청의 신청 시각(at)만 읽어, 지난번에 알린 시각(ops/signupNotify/t)보다 뒤의 것이 있으면 알린다.
//   3) 보낸 뒤에 그 시각을 적는다. 신청 하나에 알림 한 번.
// 알림 글에는 건수와 관리자 페이지 주소만 들어간다(닉네임·실명·사유 없음).
// 저장소가 공개라 Actions 의 실행 기록도 공개다: 기록에는 건수만 찍고 uid·주소·토큰을 찍지 않는다.
//
// 환경변수
//   DISCORD_WEBHOOK_URL       디스코드 웹후크 주소. 없으면 아무것도 하지 않고 끝낸다(설정하기 전에 실패 메일이 쏟아지지 않게)
//   FIREBASE_SERVICE_ACCOUNT  서비스 계정 키(JSON 글자 전체). 없으면 SERVICE_ACCOUNT(파일 경로) 또는 루트의 serviceAccount.json
//   DATABASE_URL              Realtime Database 주소. 없으면 .env.local 의 VITE_FIREBASE_DATABASE_URL
//   ADMIN_URL                 알림 글에 넣을 관리자 페이지 주소. 없으면 https://{프로젝트 id}.web.app/admin.html
//   FIREBASE_DATABASE_EMULATOR_HOST  있으면 에뮬레이터에 붙는다(서비스 계정이 필요 없다)
// 옵션
//   --dry   읽기만 한다. 보내지도 적지도 않는다

import { readFileSync, existsSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 지난번에 알린 신청 시각(t)과 전송 실패 표시(e)를 두는 곳. 규칙에 없는 경로라 서비스 계정만 읽고 쓴다 */
export const STATE_PATH = 'ops/signupNotify';

/** 승인을 기다리는 uid 들. 둘 다 shallow 로 읽은 값이다(열쇠 → true) */
export function pendingUids(signups, approved) {
  const ok = approved || {};
  return Object.keys(signups || {}).filter((uid) => !ok[uid]);
}

/** 처음 연결됐을 때 한 번 보내는 글 */
export function firstText(pending, url) {
  return `✅ MawaVerse 가입 알림이 연결됐습니다. 지금 승인을 기다리는 신청: ${pending}건\n<${url}>`;
}

/** 새 신청이 들어왔을 때 보내는 글 */
export function newText(fresh, pending, url) {
  return `🔔 MawaVerse 가입 신청 ${fresh}건이 들어왔습니다. (승인 대기 ${pending}건)\n<${url}>`;
}

/**
 * 한 번 확인한다.
 * db: { get(path, shallow?), put(path, value) } · send(글) · log(글)
 * 전송이 실패하면 던진다. 다만 실패가 이어지는 동안에는 처음 한 번만 던진다(5분마다 실패 메일이 가지 않게).
 */
export async function run({ db, send, url, dry = false, log = console.log }) {
  // 읽기는 하나씩 차례로 한다: 한꺼번에 보내면 연결을 여러 개 열고, 연결을 여는 비용도 다운로드 한도에 든다
  const signups = await db.get('signups', true);
  const approved = await db.get('approved', true);
  const state = await db.get(STATE_PATH);
  const pend = pendingUids(signups, approved);
  const last = state && typeof state.t === 'number' ? state.t : null;   // null = 처음 도는 것

  const ats = [];
  for (const uid of pend) {
    const at = await db.get(`signups/${uid}/at`);
    if (typeof at === 'number') ats.push(at);
  }
  const fresh = last === null ? ats.length : ats.filter((at) => at > last).length;
  const out = { pending: pend.length, fresh, sent: false, failed: false };

  if (last !== null && fresh === 0) {
    log(`새 가입 신청 없음 (승인 대기 ${pend.length}건)`);
    return out;
  }
  const text = last === null ? firstText(pend.length, url) : newText(fresh, pend.length, url);
  if (dry) {
    log(`[dry] ${last === null ? '처음 연결 알림' : `새 신청 ${fresh}건 알림`}을 보낼 차례 (승인 대기 ${pend.length}건). 보내지 않음`);
    return out;
  }

  try {
    await send(text);
  } catch (e) {
    out.failed = true;
    if (state && state.e === 1) {
      log(`알림 전송이 계속 실패하고 있습니다: ${e.message}`);
      return out;
    }
    await db.put(STATE_PATH, last === null ? { e: 1 } : { t: last, e: 1 });
    throw e;
  }
  // 보낸 뒤에 적는다: 반대로 하면 전송이 실패했을 때 그 신청을 영영 알리지 못한다
  await db.put(STATE_PATH, { t: Math.max(last ?? 0, ...ats) });
  out.sent = true;
  log(last === null ? `연결 알림을 보냈습니다 (승인 대기 ${pend.length}건)` : `새 가입 신청 ${fresh}건을 알렸습니다 (승인 대기 ${pend.length}건)`);
  return out;
}

// ───────────── 아래는 실제로 붙는 부분 ─────────────

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email';
const EMULATOR_NS = 'demo-mawaverse-default-rtdb';

/** fetch 가 연결조차 못 했을 때의 오류를 우리 글로 바꾼다 (원래 오류에는 주소가 섞여 나올 수 있다) */
async function reach(what, url, init) {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw new Error(`${what}: 연결하지 못했습니다${e?.cause?.code ? ` (${e.cause.code})` : ''}`);
  }
}

/** 서비스 계정으로 구글 액세스 토큰을 받는다 (서명한 JWT 를 토큰으로 바꾼다) */
async function accessToken(sa) {
  const aud = sa.token_uri || TOKEN_URL;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: SCOPES, aud, iat: now, exp: now + 600 })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const r = await reach('구글 인증 실패', aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  if (!r.ok) throw new Error(`구글 인증 실패: HTTP ${r.status}`);
  const token = (await r.json()).access_token;
  if (!token) throw new Error('구글 인증 실패: 토큰이 없습니다');
  return token;
}

/** Realtime Database REST. 오류 글에는 경로의 맨 앞 마디만 넣는다(uid 가 실행 기록에 남지 않게) */
function restDb({ base, ns, token }) {
  const at = (path, params = {}) => {
    const u = new URL(`${base}/${path.split('/').map(encodeURIComponent).join('/')}.json`);
    if (ns) u.searchParams.set('ns', ns);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u;
  };
  const auth = { Authorization: `Bearer ${token}` };
  const top = (path) => path.split('/')[0];
  return {
    async get(path, shallow = false) {
      const r = await reach(`DB 읽기 실패 (${top(path)})`, at(path, shallow ? { shallow: 'true' } : {}), { headers: auth });
      if (!r.ok) throw new Error(`DB 읽기 실패 (${top(path)}): HTTP ${r.status}`);
      return r.json();
    },
    async put(path, value) {
      const r = await reach(`DB 쓰기 실패 (${top(path)})`, at(path, { print: 'silent' }), { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
      if (!r.ok) throw new Error(`DB 쓰기 실패 (${top(path)}): HTTP ${r.status}`);
    },
  };
}

function discordSender(webhook) {
  return async (content) => {
    const r = await reach('디스코드 전송 실패', webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
    if (!r.ok) throw new Error(`디스코드 전송 실패: HTTP ${r.status}`);
  };
}

function loadEnvLocal(rootDir) {
  const p = resolve(rootDir, '.env.local');
  const out = {};
  if (existsSync(p)) for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const webhook = (process.env.DISCORD_WEBHOOK_URL || '').trim();
  if (!webhook && !dry) {
    console.log('DISCORD_WEBHOOK_URL 이 없어 아무것도 하지 않습니다.');
    return;
  }
  if (webhook) {
    let ok = false;
    try { ok = /^https?:$/.test(new URL(webhook).protocol); } catch { /* 아래에서 알린다 */ }
    if (!ok) throw new Error('DISCORD_WEBHOOK_URL 이 주소 모양이 아닙니다.');
  }

  const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const databaseURL = (process.env.DATABASE_URL || loadEnvLocal(rootDir).VITE_FIREBASE_DATABASE_URL || '').trim().replace(/\/+$/, '');
  const emulator = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || '').trim();

  let db;
  let url = (process.env.ADMIN_URL || '').trim();
  if (emulator) {
    const ns = databaseURL ? new URL(databaseURL).hostname.split('.')[0] : EMULATOR_NS;
    db = restDb({ base: `http://${emulator}`, ns, token: 'owner' });
    url ||= 'http://localhost:5173/admin.html';
  } else {
    if (!databaseURL) throw new Error('DATABASE_URL (또는 .env.local 의 VITE_FIREBASE_DATABASE_URL) 이 필요합니다.');
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT || readFileSync(process.env.SERVICE_ACCOUNT || resolve(rootDir, 'serviceAccount.json'), 'utf8');
    const sa = JSON.parse(raw);
    db = restDb({ base: databaseURL, token: await accessToken(sa) });
    url ||= `https://${sa.project_id}.web.app/admin.html`;
  }

  await run({ db, send: webhook ? discordSender(webhook) : async () => {}, url, dry });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    // 주소·토큰이 섞여 나오지 않게 우리가 만든 글만 찍는다
    const msg = e instanceof Error && /^(구글 인증|DB |디스코드|DISCORD_|DATABASE_)/.test(e.message) ? e.message : `실패: ${e?.name || 'Error'}${e?.cause?.code ? ` (${e.cause.code})` : ''}`;
    console.error(msg);
    process.exit(1);
  });
}
