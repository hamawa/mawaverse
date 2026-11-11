import { ref, onValue, get, query, orderByChild, startAt, limitToLast, onChildAdded, type DatabaseReference, type DataSnapshot } from 'firebase/database';
import { db } from './app';
import { DEFAULT_CONFIG } from '../shared/config';
import type { ServerConfig } from '../shared/types';

export const r = (path: string): DatabaseReference => ref(db, path);

let serverOffset = 0;
let offsetKnown = false;
const offsetWaiters: (() => void)[] = [];
onValue(ref(db, '.info/serverTimeOffset'), (s) => {
  serverOffset = (s.val() as number) || 0;
  offsetKnown = true;
  offsetWaiters.splice(0).forEach((f) => f());
});
export const serverNow = () => Date.now() + serverOffset;
// 서버 시각 차이를 한 번 받을 때까지 기다린다 (최대 3초). 이용 시간 판정처럼 기기 시계를 믿으면 안 되는 곳에서 serverNow 를 쓰기 전에 부른다
export function serverTimeReady(): Promise<void> {
  if (offsetKnown) return Promise.resolve();
  return new Promise((res) => { offsetWaiters.push(res); setTimeout(res, 3000); });
}

let connected = false;
const connListeners = new Set<(c: boolean) => void>();
onValue(ref(db, '.info/connected'), (s) => {
  connected = !!s.val();
  connListeners.forEach((f) => f(connected));
});
export const isConnected = () => connected;
export function onConnection(f: (c: boolean) => void): () => void {
  connListeners.add(f);
  f(connected);
  return () => { connListeners.delete(f); };
}

// "지금부터 새로 생기는 것만" 받는 리스너 (채팅·소식. ts 로 정렬된 목록). 마지막 n개 창을 건다:
// 창이 없으면 연결이 다시 붙을 때마다 리슨을 건 시각 이후의 전부를 다시 내려받는다 (탭을 오래 켜 둘수록 커진다. 2026-11-10 한 번에 204KB).
// 창 안의 항목이 지워지면 더 옛것이 창으로 들어오며 child_added 가 또 오므로, 이미 본 키는 건너뛴다.
export function onNewChild(path: string, since: number, n: number, cb: (s: DataSnapshot) => void): () => void {
  const order: string[] = [];
  const seen = new Set<string>();
  return onChildAdded(query(ref(db, path), orderByChild('ts'), startAt(since), limitToLast(n)), (s) => {
    const k = s.key;
    if (!k || seen.has(k)) return;
    seen.add(k); order.push(k);
    if (order.length > 400) seen.delete(order.shift()!);
    cb(s);
  });
}

// 내 기록 한 칸(도감 등)을 세션 동안 기억해 두고 읽는다: 같은 계정은 한 곳에서만 접속하므로 내 기록은 나만 바꾼다.
// 쓴 뒤에는 rememberOwn 으로 맞춰 두고, 쓰기가 실패하면 forgetOwn 으로 버려 다음에 다시 읽게 한다.
const ownCache = new Map<string, unknown>();
export async function readOwn<T>(path: string): Promise<T | null> {
  if (ownCache.has(path)) return ownCache.get(path) as T | null;
  const v = (await get(ref(db, path))).val() as T | null;
  ownCache.set(path, v);
  return v;
}
export function rememberOwn(path: string, v: unknown): void { ownCache.set(path, v); }
export function forgetOwn(path: string): void { ownCache.delete(path); }

// 평일 근무시간 이용 차단이 켜져 있나 (관리자 설정 config/hoursBlock. 이 칸만은 로그인 전에도 읽을 수 있다: 가입·로그인 화면이 미리 알아야 하므로)
export async function hoursBlockOn(): Promise<boolean> {
  try { return (await get(ref(db, 'config/hoursBlock'))).val() === true; } catch { return false; }
}

export function mergeConfig(raw: Partial<ServerConfig> | null | undefined): ServerConfig {
  const c = raw || {};
  return {
    ...DEFAULT_CONFIG,
    ...c,
    maintenance: { ...DEFAULT_CONFIG.maintenance, ...(c.maintenance || {}) },
    logRetention: { ...DEFAULT_CONFIG.logRetention, ...(c.logRetention || {}) },
    announcement: c.announcement ?? null,
    contest: { ...DEFAULT_CONFIG.contest!, ...(c.contest || {}) },
  };
}

export function watchConfig(cb: (c: ServerConfig) => void): () => void {
  return onValue(ref(db, 'config'), (s) => cb(mergeConfig(s.val())));
}

export async function readConfig(): Promise<ServerConfig> {
  return mergeConfig((await get(ref(db, 'config'))).val());
}

export async function isAdmin(uid: string): Promise<boolean> {
  try {
    return (await get(ref(db, `admins/${uid}`))).val() === true;
  } catch {
    return false;
  }
}
