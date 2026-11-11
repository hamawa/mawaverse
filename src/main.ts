import './styles.css';
import { ref, get } from 'firebase/database';
import { isConfigured, auth, db } from './firebase/app';
import { waitForAuth, login, signup, logout, loadProfile, isApproved, withdraw, dropOrphanAccount } from './firebase/auth';
import { isAdmin, readConfig, serverNow, serverTimeReady, hoursBlockOn } from './firebase/db';
import { showLoginScreen, showAdminChoice, showMessageScreen, toast, promptModal, confirmModal, closeOverlays } from './game/ui';
import { World } from './game/world';
import { Net } from './game/net';
import { APP_NAME } from './shared/config';
import { clientBlocked, BLOCK_MESSAGE } from './shared/hours';
import HOLIDAYS from '../holidays.json';
import type { UserProfile } from './shared/types';

const root = document.getElementById('app')!;

async function boot(): Promise<void> {
  if (!isConfigured) {
    showMessageScreen(root, APP_NAME, 'Firebase 설정이 없습니다.\n.env.local 파일에 Firebase 웹 설정값을 넣고 다시 빌드하세요. (README.md 참고)');
    return;
  }
  const user = await waitForAuth();
  if (user) await enter(user.uid);
  else showLogin();
}

// 평일 09:00~18:00 KST 차단 중인가. 관리자 설정(config/hoursBlock)이 켜져 있을 때만 차단한다 (기본 꺼짐).
// 서버 시각 기준이고, 실제로 막는 것은 보안 규칙이다(여기는 화면 안내용). 관리자는 부르는 쪽에서 건너뛴다
async function blockedNow(): Promise<boolean> {
  if (!(await hoursBlockOn())) return false;
  await serverTimeReady();
  return clientBlocked(serverNow(), HOLIDAYS);
}
function showBlocked(): void {
  closeOverlays();
  showMessageScreen(root, APP_NAME, BLOCK_MESSAGE, { label: '로그인 화면', onClick: () => showLogin() });
}

function showLogin(message = ''): void {
  showLoginScreen(root, {
    onLogin: async (id, pw) => { const uid = await login(id, pw); await enter(uid); },
    onSignup: async (id, pw, nick, avatar, extra) => {
      if (await blockedNow()) throw new Error(BLOCK_MESSAGE); // 차단 시간에는 가입 신청도 받지 않는다
      const uid = await signup(id, pw, nick, avatar, extra);
      await enter(uid);
    },
  }, message);
}

// 가입 신청 후 관리자 승인을 기다리는 화면. 게임에는 들어갈 수 없고, 신청을 취소(= 탈퇴)할 수 있다
function showPending(uid: string, profile: UserProfile): void {
  showMessageScreen(root, APP_NAME, '가입 승인 대기 중입니다.\n관리자가 승인하면 입장할 수 있어요.',
    { label: '로그아웃', onClick: async () => { await logout(); showLogin(); } },
    { label: '가입 신청 취소', onClick: async () => {
      if (!(await confirmModal('가입 신청을 취소할까요? 계정과 입력한 정보가 바로 삭제됩니다.', '신청 취소'))) return;
      const pw = await promptModal('가입 신청 취소', '비밀번호', '', 100, true);
      if (pw === null) return;
      try { await withdraw(uid, profile, pw); showLogin('가입 신청을 취소했습니다.'); } catch (e) { toast((e as Error).message || '취소하지 못했습니다.', true); }
    } });
}

async function enter(uid: string): Promise<void> {
  const admin = await isAdmin(uid);
  // 평일 근무시간: 관리자가 아니면 로그인해도 들어갈 수 없다
  if (!admin && (await blockedNow())) { await logout(); showBlocked(); return; }
  const profile = await loadProfile(uid).catch(() => null);
  if (!profile) {
    // 프로필이 없다: 가입이 거절됐거나 삭제된 계정. 남은 로그인 계정도 지워 같은 아이디로 다시 가입할 수 있게 한다
    await dropOrphanAccount();
    await logout().catch(() => {});
    showLogin('계정 정보를 찾을 수 없습니다. 다시 가입해 주세요.');
    return;
  }
  if (!admin && !(await isApproved(uid))) { showPending(uid, profile); return; }
  if (admin) {
    showAdminChoice(root, profile.nick, () => enterWorld(uid, true), () => { location.href = '/admin.html'; }, async () => { await logout(); showLogin(); });
  } else {
    await enterWorld(uid, false);
  }
}

async function enterWorld(uid: string, admin: boolean): Promise<void> {
  const profile = await loadProfile(uid);
  if (!profile) { await logout(); showLogin(); return; }
  if ((await get(ref(db, `bans/${uid}`)).catch(() => null))?.exists()) {
    showMessageScreen(root, '접속 차단', '이 계정은 접속이 차단되어 있습니다. 관리자에게 문의하세요.', { label: '로그아웃', onClick: async () => { await logout(); showLogin(); } });
    return;
  }
  const cfg = await readConfig();
  if (cfg.maintenance.on && !admin) {
    showMessageScreen(root, '점검 중', cfg.maintenance.message, { label: '로그아웃', onClick: async () => { await logout(); showLogin(); } });
    return;
  }
  const count = await Net.countPlayers();
  if (count >= cfg.maxPlayers && !admin) {
    showMessageScreen(root, '서버가 가득 찼습니다', `현재 ${count}명이 접속 중입니다. 잠시 후 다시 시도해 주세요.`, { label: '다시 시도', onClick: () => enterWorld(uid, admin) });
    return;
  }
  showMessageScreen(root, APP_NAME, '마을로 들어가는 중...');
  const world = new World(root, uid, profile, admin);
  if (import.meta.env.DEV) {
    // 개발 콘솔 디버깅용
    const dbg = window as unknown as { __mv: World; __mvToken: () => Promise<string | undefined> };
    dbg.__mv = world;
    dbg.__mvToken = () => (auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(undefined));
  }
  world.events.on('logout', (reason) => {
    if (reason === BLOCK_MESSAGE) showBlocked(); // 09:00 이 되어 내보낸 경우
    else if (reason) showLogin(reason);
    else if (auth.currentUser && admin) enter(uid);
    else showLogin();
  });
  try {
    await world.start();
  } catch (e) {
    console.error(e);
    toast('입장에 실패했습니다: ' + ((e as Error).message || e), true);
    showMessageScreen(root, '입장 실패', String((e as Error).message || e), { label: '다시 시도', onClick: () => enterWorld(uid, admin) });
  }
}

boot().catch((e) => {
  console.error(e);
  showMessageScreen(root, '오류', String((e as Error).message || e), { label: '새로고침', onClick: () => location.reload() });
});
