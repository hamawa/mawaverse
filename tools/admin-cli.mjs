#!/usr/bin/env node
// MawaVerse 관리자 CLI (Firebase Admin SDK 사용)
// 준비: Firebase 콘솔 > 프로젝트 설정 > 서비스 계정 > 새 비공개 키 생성 → 프로젝트 루트에 serviceAccount.json 으로 저장
//       .env.local 에 VITE_FIREBASE_DATABASE_URL 이 있어야 함 (또는 환경변수 DATABASE_URL)
//
// 사용법:
//   node tools/admin-cli.mjs set-admin <아이디>
//   node tools/admin-cli.mjs unset-admin <아이디>
//   node tools/admin-cli.mjs reset-password <아이디> <새비밀번호>
//   node tools/admin-cli.mjs set-nick <아이디> <새닉네임>
//   node tools/admin-cli.mjs delete-user <아이디>
//   node tools/admin-cli.mjs list-users
//   node tools/admin-cli.mjs patch-note <제목> <본문 파일> [작성자 아이디]   (게시판 '패치 노트' 글 + 접속자 알림. 작성자를 안 적으면 관리자가 한 명일 때 그 계정)
//   node tools/admin-cli.mjs deploy-rules-check   (규칙 파일 JSON 검사)

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';

const rootDir = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const [cmd, ...args] = process.argv.slice(2);

function loadEnv() {
  const p = resolve(rootDir, '.env.local');
  const out = {};
  if (existsSync(p)) for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = loadEnv();
const databaseURL = process.env.DATABASE_URL || env.VITE_FIREBASE_DATABASE_URL;
const saPath = process.env.SERVICE_ACCOUNT || resolve(rootDir, 'serviceAccount.json');

function usage() {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 15).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
}

// 클라이언트(src/firebase/auth.ts)와 동일한 파생 규칙
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const normKey = (s) => s.normalize('NFC').trim().toLowerCase();
const safeKey = (s) => encodeURIComponent(s).replace(/\./g, '%2E');
const emailFor = (id) => `u${sha('mawaverse-id|' + normKey(id)).slice(0, 32)}@users.mawaverse.app`;
const pwKey = (id, pw) => sha(`mawaverse-pw|${normKey(id)}|${pw}`);
const nickKey = (n) => safeKey(normKey(n));

async function main() {
  if (!cmd || cmd === 'help') { usage(); return; }
  if (cmd === 'deploy-rules-check') { JSON.parse(readFileSync(resolve(rootDir, 'database.rules.json'), 'utf8')); console.log('database.rules.json OK'); return; }
  if (!existsSync(saPath)) { console.error(`서비스 계정 키가 없습니다: ${saPath}\nFirebase 콘솔 > 프로젝트 설정 > 서비스 계정 > 새 비공개 키 생성 후 저장하세요.`); process.exit(1); }
  if (!databaseURL) { console.error('.env.local 의 VITE_FIREBASE_DATABASE_URL 또는 환경변수 DATABASE_URL 이 필요합니다.'); process.exit(1); }
  initializeApp({ credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))), databaseURL });
  const auth = getAuth();
  const db = getDatabase();

  // ids 노드가 없어도(DB 데이터만 지워진 계정 등) Auth 에서 파생 이메일로 찾는다
  const uidOf = async (id) => {
    const snap = await db.ref(`ids/${safeKey(normKey(id))}`).get();
    if (snap.exists()) return snap.val();
    try { return (await auth.getUserByEmail(emailFor(id))).uid; }
    catch { throw new Error(`아이디를 찾을 수 없습니다: ${id}`); }
  };

  switch (cmd) {
    case 'set-admin': {
      const uid = await uidOf(args[0]);
      await db.ref(`admins/${uid}`).set(true);
      console.log(`관리자 지정 완료: ${args[0]} (${uid})`);
      break;
    }
    case 'unset-admin': {
      const uid = await uidOf(args[0]);
      await db.ref(`admins/${uid}`).remove();
      console.log(`관리자 해제: ${args[0]}`);
      break;
    }
    case 'reset-password': {
      const [id, pw] = args;
      if (!id || !pw) throw new Error('사용법: reset-password <아이디> <새비밀번호>');
      const uid = await uidOf(id);
      await auth.updateUser(uid, { password: pwKey(id, pw) });
      await db.ref(`sessions/${uid}`).set('reset-' + Date.now());
      console.log(`비밀번호를 재설정했습니다: ${id}`);
      break;
    }
    case 'set-nick': {
      const [id, nick] = args;
      const uid = await uidOf(id);
      const u = (await db.ref(`users/${uid}`).get()).val();
      const nk = nickKey(nick);
      const cur = (await db.ref(`nicknames/${nk}`).get()).val();
      if (cur && cur !== uid) throw new Error('이미 사용 중인 닉네임입니다.');
      const upd = { [`users/${uid}/nick`]: nick, [`nicknames/${nk}`]: uid };
      if (u && nickKey(u.nick) !== nk) upd[`nicknames/${nickKey(u.nick)}`] = null;
      await db.ref().update(upd);
      console.log(`닉네임 변경: ${id} -> ${nick}`);
      break;
    }
    case 'delete-user': {
      const id = args[0];
      const uid = await uidOf(id);
      const u = (await db.ref(`users/${uid}`).get()).val();
      await auth.deleteUser(uid).catch((e) => console.warn('auth 삭제 실패(이미 없음?):', e.message));
      const upd = { [`signups/${uid}`]: null, [`approved/${uid}`]: null, [`users/${uid}`]: null, [`ids/${safeKey(normKey(id))}`]: null, [`players/${uid}`]: null, [`sessions/${uid}`]: null, [`duelInv/${uid}`]: null, [`admins/${uid}`]: null, [`invites/${uid}`]: null, [`chat/whisper/${uid}`]: null, [`bans/${uid}`]: null, [`kicks/${uid}`]: null, [`fish/book/${uid}`]: null, [`bug/book/${uid}`]: null, [`wallet/${uid}`]: null };
      if (u?.nick) upd[`nicknames/${nickKey(u.nick)}`] = null;
      await db.ref().update(upd);
      console.log(`삭제 완료: ${id}`);
      break;
    }
    // 게시판에 패치 노트를 올린다 (배포할 때마다. CLAUDE.md "패치 노트"). 클라이언트의 board.ts createPost 와 같은 모양으로 쓰고,
    // config/patchNote 에 글 id·제목을 적어 접속자에게 "새 패치 노트" 한 줄이 뜨게 한다
    case 'patch-note': {
      const [title, file, asId] = args;
      if (!title || !file) throw new Error('사용법: patch-note <제목> <본문 파일> [작성자 아이디]');
      const body = readFileSync(resolve(file), 'utf8').split(/\r?\n/).join('\n').trim();
      if (title.length > 60) throw new Error(`제목이 너무 깁니다 (${title.length}자, 최대 60자)`);
      if (!body || body.length > 2000) throw new Error(`본문 길이를 확인하세요 (${body.length}자, 1~2000자)`);
      let uid;
      if (asId) uid = await uidOf(asId);
      else {
        const admins = Object.keys((await db.ref('admins').get()).val() || {});
        if (admins.length !== 1) throw new Error(`관리자가 ${admins.length}명입니다. 작성자 아이디를 적어 주세요.`);
        uid = admins[0];
      }
      const nick = (await db.ref(`users/${uid}/nick`).get()).val();
      if (!nick) throw new Error('작성자의 닉네임을 찾지 못했습니다.');
      const key = db.ref('board/posts').push().key;
      await db.ref().update({ [`board/posts/${key}`]: { title, body, u: uid, n: nick, ts: { '.sv': 'timestamp' }, cc: 0, cat: 'patch' }, 'config/patchNote': { id: key, t: title } });
      console.log(`패치 노트를 올렸습니다: ${key} (${body.length}자)`);
      break;
    }
    case 'list-users': {
      const users = (await db.ref('users').get()).val() || {};
      const admins = (await db.ref('admins').get()).val() || {};
      console.table(Object.entries(users).map(([uid, u]) => ({ uid, id: u.id, nick: u.nick, admin: admins[uid] ? 'Y' : '', lastLogin: u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '' })));
      break;
    }
    default:
      usage();
  }
  process.exit(0);
}

main().catch((e) => { console.error('오류:', e.message || e); process.exit(1); });
