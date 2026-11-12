import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as fbSignOut, onAuthStateChanged,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider, deleteUser, type User,
} from 'firebase/auth';
import { ref, get, runTransaction, update, serverTimestamp } from 'firebase/database';
import { auth, db } from './app';
import { sha256Hex } from '../shared/hash';
import { idKey, nickKey, safeKey, validateNick } from '../shared/util';
import type { UserProfile } from '../shared/types';

// 아이디 -> Firebase 이메일 (이메일은 어디에도 발송되지 않음)
export function emailFor(id: string): string {
  return `u${sha256Hex('mawaverse-id|' + idKey(id)).slice(0, 32)}@users.mawaverse.app`;
}
// 비밀번호 -> 고정 길이 키 (Firebase 6자 최소 제한을 우회하고, 원문 비밀번호는 전송하지 않음)
export function pwKey(id: string, pw: string): string {
  return sha256Hex(`mawaverse-pw|${idKey(id)}|${pw}`);
}
export const idPathKey = (id: string) => safeKey(idKey(id));

export function waitForAuth(): Promise<User | null> {
  return new Promise((res) => {
    const off = onAuthStateChanged(auth, (u) => { off(); res(u); });
  });
}

// 가입 신청 때 함께 받는 것: 실명과 가입 사유(관리자만 볼 수 있는 signups/{uid} 에 따로 둔다), 개인정보 수집 동의
export interface SignupExtra { realName: string; reason: string; agreed: boolean }
export const REAL_NAME_MAX = 20;
export const REASON_MAX = 100;

export async function signup(id: string, pw: string, nick: string, avatar: string, extra: SignupExtra): Promise<string> {
  const idTrim = id.normalize('NFC').trim();
  if (!idTrim) throw new Error('아이디를 입력하세요.');
  if (idTrim.length > 64) throw new Error('아이디가 너무 깁니다.');
  if (!pw) throw new Error('비밀번호를 입력하세요.');
  const realName = extra.realName.normalize('NFC').trim();
  if (!realName) throw new Error('실명을 입력하세요.');
  if (realName.length > REAL_NAME_MAX) throw new Error(`실명은 ${REAL_NAME_MAX}자까지 입력할 수 있습니다.`);
  const reason = extra.reason.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!reason) throw new Error('가입 사유를 입력하세요.');
  if (reason.length > REASON_MAX) throw new Error(`가입 사유는 ${REASON_MAX}자까지 입력할 수 있습니다.`);
  if (!extra.agreed) throw new Error('개인정보 수집에 동의해야 가입할 수 있습니다.');
  const nickTrim = nick.normalize('NFC').trim();
  const nickErr = validateNick(nickTrim);
  if (nickErr) throw new Error(nickErr);
  const ik = idPathKey(idTrim);
  const nk = nickKey(nickTrim);
  // 아이디 중복은 Auth(이메일 중복)가, 닉네임 중복은 아래 트랜잭션이 막는다 (로그인 전에는 DB 를 읽을 수 없음)
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, emailFor(idTrim), pwKey(idTrim, pw));
  } catch (e: unknown) {
    const code = (e as { code?: string }).code || '';
    if (code === 'auth/email-already-in-use') throw new Error('이미 사용 중인 아이디입니다.');
    throw new Error('회원가입에 실패했습니다. ' + code);
  }
  const uid = cred.user.uid;
  const nickRes = await runTransaction(ref(db, `nicknames/${nk}`), (cur) => (cur === null ? uid : undefined));
  if (!nickRes.committed) {
    await deleteUser(cred.user).catch(() => {});
    throw new Error('이미 사용 중인 닉네임입니다.');
  }
  const profile: Omit<UserProfile, 'createdAt'> & { createdAt: object } = {
    id: idTrim, nick: nickTrim, avatar, losses: 0, createdAt: serverTimestamp(),
  };
  // 실명·가입 사유는 프로필(users)에 넣지 않는다: 관리자만 읽을 수 있는 signups 에 따로 둔다. 승인(approved/{uid})은 관리자가 한다
  await update(ref(db), { [`users/${uid}`]: profile, [`ids/${ik}`]: uid, [`signups/${uid}`]: { name: realName, reason, at: serverTimestamp() } });
  return uid;
}

// 가입 승인 여부. 관리자가 관리자 페이지에서 approved/{uid} 를 true 로 쓴다
export async function isApproved(uid: string): Promise<boolean> {
  try { return (await get(ref(db, `approved/${uid}`))).val() === true; } catch { return false; }
}

// 탈퇴(가입 신청 취소 포함): 비밀번호를 다시 확인하고, 내 정보(실명·프로필·닉네임·코인·도감)를 지운 뒤 로그인 계정을 지운다. 되돌릴 수 없다.
// beforeDelete: 비밀번호가 맞은 뒤, 지우기 전에 할 일 (게임 안에서는 먼저 게임에서 나가 접속 표시와 자리를 정리한다)
export async function withdraw(uid: string, profile: Pick<UserProfile, 'id' | 'nick'>, pw: string, beforeDelete?: () => Promise<void>): Promise<void> {
  const user = auth.currentUser;
  if (!user || user.uid !== uid) throw new Error('로그인이 필요합니다.');
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(emailFor(profile.id), pwKey(profile.id, pw)));
  } catch {
    throw new Error('비밀번호가 올바르지 않습니다.');
  }
  if (beforeDelete) await beforeDelete();
  await update(ref(db), {
    [`signups/${uid}`]: null, [`approved/${uid}`]: null,
    [`users/${uid}`]: null, [`ids/${idPathKey(profile.id)}`]: null, [`nicknames/${nickKey(profile.nick)}`]: null,
    [`players/${uid}`]: null, [`sessions/${uid}`]: null, [`duelInv/${uid}`]: null, [`wallet/${uid}`]: null, [`fish/book/${uid}`]: null, [`bug/book/${uid}`]: null,
    [`winter/events/${uid}`]: null,
  });
  await deleteUser(user);
}

// 프로필이 없는 로그인 계정(가입이 거절됐거나 관리자가 지운 계정의 껍데기)을 지운다: 같은 아이디로 다시 가입할 수 있게.
// 로그인한 지 오래된 세션이면 지우지 못하고 로그아웃만 한다 (다음에 직접 로그인할 때 지워진다)
export async function dropOrphanAccount(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  try { await deleteUser(user); } catch { await fbSignOut(auth).catch(() => {}); }
}

export async function login(id: string, pw: string): Promise<string> {
  const idTrim = id.normalize('NFC').trim();
  if (!idTrim || !pw) throw new Error('아이디와 비밀번호를 입력하세요.');
  try {
    const cred = await signInWithEmailAndPassword(auth, emailFor(idTrim), pwKey(idTrim, pw));
    return cred.user.uid;
  } catch (e: unknown) {
    const code = (e as { code?: string }).code || '';
    if (code === 'auth/too-many-requests') throw new Error('시도가 너무 많습니다. 잠시 후 다시 시도하세요.');
    if (code === 'auth/network-request-failed') throw new Error('네트워크 오류입니다.');
    throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
  }
}

export async function logout(): Promise<void> {
  await fbSignOut(auth);
}

export async function changeNick(uid: string, oldNick: string, newNick: string, online: boolean): Promise<string> {
  const n = newNick.normalize('NFC').trim();
  const err = validateNick(n);
  if (err) throw new Error(err);
  const oldKey = nickKey(oldNick);
  const newKey = nickKey(n);
  if (n === oldNick) return n;
  if (newKey !== oldKey) {
    const res = await runTransaction(ref(db, `nicknames/${newKey}`), (cur) => (cur === null ? uid : undefined));
    if (!res.committed) throw new Error('이미 사용 중인 닉네임입니다.');
  }
  const upd: Record<string, unknown> = { [`users/${uid}/nick`]: n };
  if (online) upd[`players/${uid}/n`] = n;
  if (newKey !== oldKey) upd[`nicknames/${oldKey}`] = null;
  await update(ref(db), upd);
  return n;
}

export async function changePassword(id: string, oldPw: string, newPw: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  if (!newPw) throw new Error('새 비밀번호를 입력하세요.');
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(emailFor(id), pwKey(id, oldPw)));
  } catch {
    throw new Error('현재 비밀번호가 올바르지 않습니다.');
  }
  await updatePassword(user, pwKey(id, newPw));
}

export async function loadProfile(uid: string): Promise<UserProfile | null> {
  const s = await get(ref(db, `users/${uid}`));
  return s.exists() ? (s.val() as UserProfile) : null;
}

export async function uidByNick(nick: string): Promise<string | null> {
  const s = await get(ref(db, `nicknames/${nickKey(nick)}`));
  return s.exists() ? (s.val() as string) : null;
}
