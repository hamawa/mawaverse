// 채팅 전송 시험 (src/game/chat.ts). 실행: node --test tests/chat.test.mjs
// 2026-11-17 제보("귓속말을 빨리 치고 보내면 마지막 한 글자가 전체 채팅으로도 나간다")를 다시 내지 않게:
// 한글 조합 중 Enter 로 입력창의 전송이 두 번 돌 때(글 전체 → 끝 글자) 두 번째가 공개 채팅으로 새지 않는지 본다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Firebase 대신 기록만 하는 가짜. 쓰기는 FB.updates 에 쌓인다. 닉네임 찾기는 실제처럼 한 박자 늦게 답한다
const FB = (globalThis.__fbChat = { updates: [], nicks: { 상대: 'u2', 나: 'me' }, n: 0 });
globalThis.window = globalThis;
const stub = (src) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });
const STUBS = {
  'firebase/database': `
    const FB = globalThis.__fbChat;
    export const ref = (_db, path) => ({ path: path ?? '' });
    export const push = () => ({ key: 'k' + (++FB.n) });
    export const update = async (_r, upd) => { FB.updates.push(upd); };
    export const remove = async () => {};
    export const get = async () => ({ exists: () => false, val: () => null, forEach: () => {} });
    export const query = (r) => r, orderByChild = () => 0, endAt = () => 0, limitToFirst = () => 0;
    export const onChildAdded = () => () => {};
    export const serverTimestamp = () => '__ts';`,
  '../firebase/app': 'export const db = {};',
  '../firebase/db': 'export const serverNow = () => 1_800_000_000_000; export const onNewChild = () => () => {};',
  '../firebase/auth': `
    export const uidByNick = async (nick) => { await new Promise((r) => setTimeout(r, 20)); return globalThis.__fbChat.nicks[nick] ?? null; };`,
};
registerHooks({
  resolve(spec, ctx, next) {
    if (spec in STUBS) return stub(STUBS[spec]);
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

const { Chat } = await import('../src/game/chat.ts');
const { MSG_MIN_INTERVAL_MS } = await import('../src/shared/config.ts');

// 시각은 시험이 정한다 (chat.ts 는 간격 제한에 Date.now 를 쓴다)
let T = 1_800_000_000_000;
Date.now = () => T;

function setup() {
  FB.updates.length = 0;
  T += 60_000; // 앞 시험의 "방금 보냄"이 남지 않게
  const toasts = [];
  const w = {
    uid: 'me', profile: { nick: '나' }, me: { x: 3, y: 4 }, mapId: 'main', switching: false,
    players: new Map([['u2', {}]]), nickOf: () => '상대',
    toast: (m) => toasts.push(m), setBubble: () => {}, events: { emit: () => {} },
  };
  return { chat: new Chat(w), toasts };
}
const paths = () => FB.updates.flatMap((u) => Object.keys(u));
const publicWrites = () => paths().filter((p) => p.startsWith('chat/public/'));
const whisperWrites = () => paths().filter((p) => p.startsWith('chat/whisper/'));

test('귓속말과 같은 순간에 끝 글자만 또 오면 공개 채팅으로 나가지 않는다', async () => {
  const { chat, toasts } = setup();
  const first = chat.send('/w 상대 안녕'); // 닉네임을 찾느라 기다리는 중
  await chat.send('녕'); // 조합 중이던 끝 글자로 입력창의 Enter 처리가 한 번 더 돈 경우
  await first;
  assert.equal(whisperWrites().length, 1, '귓속말은 한 번 나간다');
  assert.deepEqual(publicWrites(), [], '끝 글자가 공개 채팅으로 나가면 안 된다');
  assert.deepEqual(toasts, [], '안내도 띄우지 않는다');
  const sent = FB.updates[0][whisperWrites()[0]];
  assert.equal(sent.t, '안녕');
});

test('귓속말 답을 기다리는 사이에 온 다른 글은 간격 제한에 걸린다', async () => {
  const { chat, toasts } = setup();
  const first = chat.send('/w 상대 안녕');
  await chat.send('뭐해');
  await first;
  assert.deepEqual(publicWrites(), []);
  assert.deepEqual(toasts, ['너무 빠르게 보내고 있습니다.']);
});

test('공개 채팅도 끝 글자 되풀이는 안내 없이 버리고, 다른 글은 종전대로 안내한다', async () => {
  const { chat, toasts } = setup();
  await chat.send('안녕');
  await chat.send('녕');
  assert.equal(publicWrites().length, 1);
  assert.deepEqual(toasts, []);
  await chat.send('하');
  assert.equal(publicWrites().length, 1);
  assert.deepEqual(toasts, ['너무 빠르게 보내고 있습니다.']);
});

test('간격이 지난 뒤에는 같은 글자도 그대로 보낸다', async () => {
  const { chat, toasts } = setup();
  await chat.send('안녕');
  T += MSG_MIN_INTERVAL_MS;
  await chat.send('녕');
  assert.equal(publicWrites().length, 2);
  assert.deepEqual(toasts, []);
});

test('귓속말을 보낸 뒤에는 그 상대에게 이어 보내는 명령을 미리 넣어 준다 (끝 글자가 끼어들어도)', async () => {
  const { chat } = setup();
  const first = chat.send('/w 상대 안녕');
  await chat.send('녕');
  await first;
  assert.equal(chat.stickyPrefix(), '/w 상대 ');
});
