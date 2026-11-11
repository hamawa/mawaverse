import { el, escapeHtml, fmtTime, isMobile } from '../shared/util';
import { APP_NAME, EMOTES } from '../shared/config';
import type { Dir } from '../shared/types';
import { PRESETS, getThumb, GROUP_NAMES, type Preset } from './sprites';
import type { LogEntry } from './state';
import type { Input } from './input';

// ---------- 토스트 ----------
// 폰에서 다른 앱에 갔다 오면 타이머가 멈춰 있던 토스트가 한꺼번에 쏟아지던 문제(2026-11-09): 각 토스트에 만료 시각을 적어 두고,
// 화면에 돌아올 때 만료된 것은 바로 지운다. 동시에 TOAST_MAX 개까지만 두고 넘치면 오래된 것부터 지운다
const TOAST_MAX = 3;
let toastRoot: HTMLElement | null = null;
export function toast(msg: string, err = false): void {
  if (!toastRoot) {
    toastRoot = el('div', { id: 'toasts' }); document.body.append(toastRoot);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pruneToasts(true); });
  }
  const t = el('div', { class: 'toast' + (err ? ' err' : ''), text: msg });
  const life = err ? 3500 : 2500;
  t.dataset.until = String(Date.now() + life);
  toastRoot.append(t);
  pruneToasts(false);
  setTimeout(() => fadeToast(t), life);
}
function fadeToast(t: HTMLElement): void { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }
function pruneToasts(expired: boolean): void {
  if (!toastRoot) return;
  const list = [...toastRoot.children] as HTMLElement[];
  const now = Date.now();
  for (const t of list) if (expired && Number(t.dataset.until) <= now) t.remove();
  const left = [...toastRoot.children] as HTMLElement[];
  for (let i = 0; i < left.length - TOAST_MAX; i++) left[i].remove();
}

// ---------- 큰 배너 (신화 등급 공지 등) ----------
// 화면 가운데 몇 초 크게 떴다가 사라진다. 모두에게 같은 순간 보이는 서버 소식용
let bannerEl: HTMLElement | null = null;
let bannerTimer = 0;
export function banner(title: string, sub = '', ms = 4500): void {
  if (!bannerEl) { bannerEl = el('div', { id: 'big-banner' }); document.body.append(bannerEl); }
  bannerEl.replaceChildren(el('div', { class: 'bb-title', text: title }), ...(sub ? [el('div', { class: 'bb-sub', text: sub })] : []));
  bannerEl.classList.remove('on');
  void bannerEl.offsetWidth;
  bannerEl.classList.add('on');
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => bannerEl?.classList.remove('on'), ms);
}

// ---------- 낚시·채집 한 줄 알림 ----------
// 잡음·놓침·꽝·미끼 같은 내 낚시·채집 소식은 채팅 대신 화면 아래 가운데 한 자리에만 뜬다 (새 것이 오면 교체, 겹치지 않음). 기록은 도감의 "내 기록" 탭
let noteEl: HTMLElement | null = null;
let noteTimer = 0;
export function catchNote(text: string): void {
  if (!noteEl) { noteEl = el('div', { id: 'catch-note' }); document.body.append(noteEl); }
  noteEl.textContent = text;
  noteEl.classList.remove('on');
  void noteEl.offsetWidth; // 애니메이션 재시작
  noteEl.classList.add('on');
  document.body.classList.add('note-on'); // 같은 자리의 상호작용 안내(#hint)는 그동안 숨긴다
  clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => { noteEl?.classList.remove('on'); document.body.classList.remove('note-on'); }, 2500);
}

// ---------- 모달 ----------
export interface ModalAction { label: string; onClick: () => void | Promise<void>; primary?: boolean; danger?: boolean; keep?: boolean }
const modalStack: HTMLElement[] = []; // Esc 는 가장 위의 모달만 닫는다
export function modal(title: string, body: HTMLElement, actions: ModalAction[] = [], wide = false, onClose?: () => void): { close: () => void; root: HTMLElement } {
  const bg = el('div', { class: 'modal-bg' });
  const box = el('div', { class: 'modal' + (wide ? ' wide' : '') });
  box.append(el('h3', { text: title }), body);
  const row = el('div', { class: 'actions' });
  let onKey: (e: KeyboardEvent) => void = () => {};
  const close = () => {
    const i = modalStack.indexOf(bg); if (i < 0) return; // 이미 닫힘
    modalStack.splice(i, 1);
    bg.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  onKey = (e) => { if (e.key === 'Escape' && modalStack[modalStack.length - 1] === bg) { e.stopPropagation(); close(); } };
  for (const a of actions) {
    const b = el('button', { class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''), text: a.label });
    b.onclick = async () => { try { await a.onClick(); if (!a.keep) close(); } catch (e) { toast((e as Error).message || '오류', true); } };
    row.append(b);
  }
  if (actions.length) box.append(row);
  bg.append(box);
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  document.body.append(bg);
  modalStack.push(bg);
  document.addEventListener('keydown', onKey, true);
  return { close, root: box };
}

// 모달 우측 상단에 작은 X 닫기 버튼을 단다
export function withCloseX(m: { close: () => void; root: HTMLElement }): void {
  const x = el('button', { class: 'modal-x', title: '닫기 (Esc)', text: '✕' });
  x.onclick = () => m.close();
  m.root.append(x);
}

// 키 가이드 모달: 상단 바의 도움말 버튼, 모바일은 채팅창의 ? 버튼, 키보드는 Space 로 열고 닫기(toggleKeyGuide).
// 하나만 열린다. (예전엔 버튼에 포커스가 남아 Space 가 버튼을 다시 눌러 가이드가 겹겹이 열렸다. 2026-11-03)
let keyGuide: { close: () => void } | null = null;
export function toggleKeyGuide(): void {
  if (keyGuide) { keyGuide.close(); return; }
  if (modalStack.length) return; // 다른 모달이 떠 있으면 그 위에 열지 않는다
  openKeyGuide();
}
export function openKeyGuide(): void {
  if (keyGuide) return;
  const body = el('div', { class: 'keyguide' });
  body.innerHTML = `<div class="grid">
        <b>방향키 · WASD</b><span>이동</span>
        <b>Shift + 이동</b><span>달리기 (2배 속도)</span>
        <b>Enter · Esc</b><span>채팅 열기 · 닫기 (접속자 모두에게 보임)</span>
        <b>Space</b><span>이 키 가이드 열기 · 닫기</span>
        <b>F</b><span>게시판 · 커피 내기 준비 · 물가에서 낚시 · 벌레 옆에서 채집 · 광장 오락기 · 보물 자리에서 땅 파기</span>
        <b>낚시</b><span>찌가 흔들리면(!) 바로 F. 이동하면 취소</span>
        <b>채집</b><span>풀밭·꽃밭의 벌레가 옆 8칸(대각선 포함)에 있으면 F. 지나가면서도 되고 연타 가능. 달려가면 날아감</span>
        <b>G</b><span>말랑이 던지기: 앞 3칸 안의 사람에게(말랑이 보따리가 있으면 앞 4×4칸 모두). 맞으면 1초 비틀, 0.4초 안에 옆으로 피하면 빗나감. 푹신 갑옷은 안 맞음</span>
        <b>우클릭</b><span>메뉴 (모바일은 캐릭터를 톡 치기)</span>
        <b>💤</b><span>이름 옆에 뜨면 창을 다른 데 두고 자리를 비운 사람. 밀치기·말랑이는 그대로 통한다</span>
        <b>Alt+2</b><span>귓속말 열기</span>
        <b>/w 닉네임 메시지</b><span>귓속말</span>
        <b>/r 메시지</b><span>마지막 귓속말에 답장</span>
        <b>🐾</b><span>펫은 레벨마다 걷기가 2.5% 빨라지고, Lv5 부터 달려도 벌레가 안 도망가며, Lv8 부터 밀치기·말랑이·끌기를 막고 80% 로 되받아친다. Lv10 이면 타고 다닌다</span>
        <b>1 ~ 0</b><span>이모트</span>
      </div>
      <h4>이모트</h4>
      <div class="emotes">${EMOTES.map((e) => `<span><b>${e.key}</b> ${e.icon} ${e.name} <small>${e.desc}</small></span>`).join('')}</div>
      <h4>모바일</h4>
      <p class="mob">왼쪽 아래 조이스틱을 기울이면 그쪽으로 이동(상·하·좌·우). 오른쪽 버튼은 위부터 이모트(짧게: 최근 이모트, 길게: 고르기) · F · 🧸 말랑이 · 달리기(누르는 동안). 채팅창은 ▾ 로 숨기고 좌측 하단 💬 로 다시 연다. 캐릭터를 톡 치면 그 사람 메뉴.</p>`;
  keyGuide = modal('키 가이드', body, [], true, () => { keyGuide = null; });
  withCloseX(keyGuide as { close: () => void; root: HTMLElement });
}

export function promptModal(title: string, label: string, initial = '', maxLength = 20, password = false): Promise<string | null> {
  return new Promise((res) => {
    const input = el('input', { type: password ? 'password' : 'text', value: initial, maxlength: String(maxLength) });
    const body = el('div', { class: 'field' }, [el('label', { text: label }), input]);
    const m = modal(title, body, [
      { label: '취소', onClick: () => res(null) },
      { label: '확인', primary: true, onClick: () => res(input.value) },
    ]);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { res(input.value); m.close(); } e.stopPropagation(); });
    setTimeout(() => input.focus(), 50);
  });
}

export function confirmModal(msg: string, okLabel = '확인'): Promise<boolean> {
  return new Promise((res) => {
    modal('확인', el('p', { text: msg }), [
      { label: '취소', onClick: () => res(false) },
      { label: okLabel, primary: true, onClick: () => res(true) },
    ]);
  });
}

// ---------- 컨텍스트 메뉴 ----------
export interface MenuItem { label: string; onClick: () => void; danger?: boolean }
let openMenu: HTMLElement | null = null;
export function closeMenu(): void { openMenu?.remove(); openMenu = null; }
// 열려 있는 모달·메뉴·배너를 모두 내린다. 이용 시간이 끝나 게임 화면을 닫을 때 쓴다 (열어 둔 창이 차단 안내 위에 남지 않게)
export function closeOverlays(): void {
  closeMenu();
  for (const bg of modalStack.splice(0)) bg.remove();
  bannerEl?.classList.remove('on');
}
export function contextMenu(x: number, y: number, title: string, items: MenuItem[]): void {
  closeMenu();
  const m = el('div', { class: 'ctx-menu' });
  m.append(el('div', { class: 'title', text: title }));
  for (const it of items) {
    const b = el('button', { text: it.label, class: it.danger ? 'danger' : '' });
    b.onclick = () => { closeMenu(); it.onClick(); };
    m.append(b);
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
  openMenu = m;
  setTimeout(() => {
    const off = (e: Event) => { if (!m.contains(e.target as Node)) { closeMenu(); document.removeEventListener('mousedown', off); document.removeEventListener('touchstart', off); } };
    document.addEventListener('mousedown', off);
    document.addEventListener('touchstart', off);
  }, 0);
}

// ---------- 아바타 선택 ----------
export function avatarPicker(selected: string, onSelect: (id: string) => void): HTMLElement {
  const root = el('div', { class: 'avatar-picker' });
  const groups = el('div', { class: 'avatar-groups' });
  const grid = el('div', { class: 'avatar-grid' });
  let cur = selected;
  let group: Preset['group'] = (PRESETS.find((p) => p.id === selected)?.group) || 'm';
  const renderGrid = () => {
    grid.innerHTML = '';
    for (const p of PRESETS.filter((x) => x.group === group)) {
      const box = el('div', { class: 'av' + (p.id === cur ? ' selected' : ''), title: p.name });
      const th = getThumb(p.id);
      const cv = document.createElement('canvas'); cv.width = th.width; cv.height = th.height; cv.getContext('2d')!.drawImage(th, 0, 0);
      box.append(cv, el('span', { text: p.name }));
      box.onclick = () => { cur = p.id; onSelect(p.id); grid.querySelectorAll('.av').forEach((e) => e.classList.remove('selected')); box.classList.add('selected'); };
      grid.append(box);
    }
  };
  for (const g of ['m', 'f', 'x'] as const) {
    const b = el('button', { class: 'btn small' + (g === group ? ' primary' : ''), text: GROUP_NAMES[g] });
    b.onclick = () => { group = g; groups.querySelectorAll('button').forEach((x) => x.classList.remove('primary')); b.classList.add('primary'); renderGrid(); };
    groups.append(b);
  }
  renderGrid();
  root.append(groups, grid);
  return root;
}

// ---------- 로그인 / 회원가입 ----------
export interface LoginHandlers {
  onLogin: (id: string, pw: string) => Promise<void>;
  onSignup: (id: string, pw: string, nick: string, avatar: string, extra: { realName: string; reason: string; agreed: boolean }) => Promise<void>;
}
export function showLoginScreen(root: HTMLElement, h: LoginHandlers, message = ''): void {
  root.innerHTML = '';
  const screen = el('div', { class: 'screen' });
  const card = el('div', { class: 'card' });
  card.append(el('h1', { text: APP_NAME }), el('div', { class: 'sub', text: '우리끼리 모이는 작은 마을' }));
  const tabs = el('div', { class: 'tabs' });
  const tabLogin = el('button', { class: 'active', text: '로그인' });
  const tabSignup = el('button', { text: '회원가입' });
  tabs.append(tabLogin, tabSignup);
  const err = el('div', { class: 'error', text: message });
  const idIn = el('input', { type: 'text', autocomplete: 'username', placeholder: '아이디' });
  const pwIn = el('input', { type: 'password', autocomplete: 'current-password', placeholder: '비밀번호' });
  const nickIn = el('input', { type: 'text', placeholder: '닉네임 (2~12자, 공백 없이)', maxlength: '12' });
  // 가입 신청에만 받는 것: 실명·가입 사유(관리자만 본다)와 개인정보 수집 동의
  const nameIn = el('input', { type: 'text', autocomplete: 'name', placeholder: '실명', maxlength: '20' });
  const reasonIn = el('input', { type: 'text', placeholder: '가입 사유 한 줄', maxlength: '100' });
  const agreeIn = el('input', { type: 'checkbox' });
  let avatar = PRESETS[Math.floor(Math.random() * PRESETS.length)].id;
  const picker = avatarPicker(avatar, (id) => { avatar = id; });
  const signupOnly = el('div', { style: 'display:none' }, [
    el('div', { class: 'field' }, [el('label', { text: '실명 (관리자만 볼 수 있어요)' }), nameIn]),
    el('div', { class: 'field' }, [el('label', { text: '닉네임' }), nickIn]),
    el('div', { class: 'field' }, [el('label', { text: '가입 사유' }), reasonIn]),
    el('div', { class: 'field' }, [el('label', { text: '캐릭터 외형 (나중에 바꿀 수 있어요)' }), picker]),
    el('label', { class: 'muted', style: 'display:flex;gap:8px;align-items:flex-start;margin-bottom:10px;cursor:pointer' }, [agreeIn, el('span', { text: '[필수] 개인정보 수집에 동의합니다. 수집 항목: 실명, 가입 사유 · 목적: 가입 승인 확인 · 보관: 탈퇴 또는 거절 시까지(이후 즉시 삭제). 동의하지 않으면 가입할 수 없습니다.' })]),
  ]);
  const submit = el('button', { class: 'btn primary', text: '입장', style: 'width:100%;padding:12px' });
  let mode: 'login' | 'signup' = 'login';
  const setMode = (m: 'login' | 'signup') => {
    mode = m;
    tabLogin.classList.toggle('active', m === 'login');
    tabSignup.classList.toggle('active', m === 'signup');
    signupOnly.style.display = m === 'signup' ? 'block' : 'none';
    submit.textContent = m === 'login' ? '입장' : '가입 신청';
    pwIn.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    err.textContent = '';
  };
  tabLogin.onclick = () => setMode('login');
  tabSignup.onclick = () => setMode('signup');
  const go = async () => {
    err.textContent = '';
    submit.disabled = true;
    try {
      if (mode === 'login') await h.onLogin(idIn.value, pwIn.value);
      else await h.onSignup(idIn.value, pwIn.value, nickIn.value, avatar, { realName: nameIn.value, reason: reasonIn.value, agreed: agreeIn.checked });
    } catch (e) {
      err.textContent = (e as Error).message || '오류가 발생했습니다.';
    } finally { submit.disabled = false; }
  };
  submit.onclick = go;
  [idIn, pwIn, nickIn, nameIn, reasonIn].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }));
  card.append(tabs,
    el('div', { class: 'field' }, [el('label', { text: '아이디' }), idIn]),
    el('div', { class: 'field' }, [el('label', { text: '비밀번호' }), pwIn]),
    signupOnly, err, submit,
    el('p', { class: 'muted', style: 'margin:12px 0 0', text: '어떤 브라우저에서든 같은 아이디/비밀번호로 로그인하면 같은 캐릭터로 접속됩니다. 비밀번호를 잊으면 관리자에게 문의하세요.' }));
  screen.append(card);
  root.append(screen);
  setTimeout(() => idIn.focus(), 50);
}

export function showAdminChoice(root: HTMLElement, nick: string, onEnter: () => void, onAdmin: () => void, onLogout: () => void): void {
  root.innerHTML = '';
  const screen = el('div', { class: 'screen' });
  const card = el('div', { class: 'card' });
  card.append(el('h1', { text: APP_NAME }), el('div', { class: 'sub', text: `${nick} 님, 어디로 갈까요?` }));
  const enter = el('button', { class: 'btn primary', text: '🏘 서버 입장' });
  const admin = el('button', { class: 'btn', text: '🛠 관리자 모드' });
  enter.onclick = onEnter; admin.onclick = onAdmin;
  const lo = el('button', { class: 'btn small', text: '로그아웃', style: 'margin-top:14px' });
  lo.onclick = onLogout;
  card.append(el('div', { class: 'choice' }, [enter, admin]), lo);
  screen.append(card); root.append(screen);
}

export function showMessageScreen(root: HTMLElement, title: string, msg: string, button?: { label: string; onClick: () => void }, button2?: { label: string; onClick: () => void }): void {
  root.innerHTML = '';
  const screen = el('div', { class: 'screen' });
  const card = el('div', { class: 'card' });
  card.append(el('h1', { text: title }), el('p', { html: escapeHtml(msg).replace(/\n/g, '<br>') }));
  if (button) { const b = el('button', { class: 'btn primary', text: button.label }); b.onclick = button.onClick; card.append(b); }
  if (button2) { const b = el('button', { class: 'btn', text: button2.label, style: 'margin-left:8px' }); b.onclick = button2.onClick; card.append(b); }
  screen.append(card); root.append(screen);
}

// ---------- 게임 HUD ----------
export interface HudHandlers {
  sendChat: (text: string) => void;
  openMyMenu: (x: number, y: number) => void;
  openPlayerMenu: (uid: string, x: number, y: number) => void;
  onlineList: () => { uid: string; nick: string }[];
  emote: (id: number) => void;
  interact: () => void;
  openShop: () => void;
  toss: () => void;
  input: Input;
  myUid: string;
}

export class Hud {
  root: HTMLElement;
  chatBox: HTMLElement;
  chatLog: HTMLElement;
  chatNew: HTMLElement;        // 로그를 위로 올려 둔 동안 온 새 글 알림 (로그 바닥, 누르면 맨 아래로)
  private chatNewCount = 0;
  chatInput: HTMLInputElement;
  chatShow: HTMLElement;       // 채팅을 숨겼을 때 좌측 하단에 남는 💬 (모바일)
  private unread = 0;
  onlinePill: HTMLElement;
  coinPill: HTMLElement;
  announce: HTMLElement;
  hintPill: HTMLElement;
  private mobile = isMobile();

  constructor(parent: HTMLElement, private h: HudHandlers) {
    this.root = el('div', { id: 'hud' });
    this.root.addEventListener('click', (e) => { const b = (e.target as HTMLElement | null)?.closest?.('button'); if (b) b.blur(); });
    parent.append(this.root);
    if (this.mobile) document.body.classList.add('mobile');

    // 상단 바
    const top = el('div', { id: 'topbar' });
    this.onlinePill = el('div', { class: 'pill', html: `<span class="app">${APP_NAME} · </span>접속 <b>0</b>명` });
    this.onlinePill.onclick = () => this.showOnlineList();
    this.coinPill = el('div', { class: 'pill coin', text: '💰 0', title: '상점 열기' });
    this.coinPill.onclick = () => h.openShop();
    const left = el('div', { class: 'top-left' }, [this.onlinePill, this.coinPill]);
    const helpBtn = el('button', { class: 'btn small', text: this.mobile ? '❔' : '❔ 도움말' });
    helpBtn.onclick = () => openKeyGuide();
    const menuBtn = el('button', { class: 'btn small', text: this.mobile ? '☰' : '☰ 내 메뉴' });
    menuBtn.onclick = (e) => h.openMyMenu(e.clientX || window.innerWidth - 160, 40);
    const right = el('div', { class: 'top-right' }, [helpBtn, menuBtn]);
    top.append(left, right);
    this.root.append(top);
    this.announce = el('div', { id: 'announce', style: 'display:none' });
    this.root.append(this.announce);
    this.hintPill = el('div', { id: 'hint', style: 'display:none' }); // 바닥 가운데 상호작용 안내 (F 게시판 …). 투명 배경 + 글자 그림자
    this.root.append(this.hintPill);

    // 채팅
    this.chatBox = el('div', { id: 'chat' });
    this.chatLog = el('div', { id: 'chat-log' });
    this.chatNew = el('button', { id: 'chat-new', type: 'button', title: '맨 아래로' });
    this.chatNew.onclick = () => this.scrollChatBottom();
    this.chatLog.addEventListener('scroll', () => { if (this.chatAtBottom()) this.hideChatNew(); }); // 직접 끝까지 내리면 알림을 치운다
    const logWrap = el('div', { id: 'chat-log-wrap' }, [this.chatLog, this.chatNew]);
    this.chatInput = el('input', { id: 'chat-input', type: 'text', placeholder: 'Enter 를 눌러 채팅 입력', maxlength: '120', autocomplete: 'off' });
    const row = el('div', { id: 'chat-input-row' });
    const toggle = el('button', { id: 'chat-toggle', class: 'btn small', text: '?' });
    toggle.onclick = () => openKeyGuide();
    const hide = el('button', { id: 'chat-hide', class: 'btn small', text: '▾', title: '채팅창 숨기기' });
    hide.onclick = () => this.setChatHidden(true);
    row.append(this.chatInput, hide, toggle);
    this.chatBox.append(logWrap, row);
    this.chatShow = el('button', { id: 'chat-show', class: 'btn small', title: '채팅창 보기' });
    this.chatShow.append(document.createTextNode('💬'), el('span', { class: 'badge' }));
    this.chatShow.onclick = () => this.setChatHidden(false);
    this.root.append(this.chatShow);
    let hidden = false;
    try { hidden = localStorage.getItem('mv-chat-hidden') === '1'; } catch { /* ignore */ }
    if (this.mobile && hidden) this.setChatHidden(true);
    this.root.append(this.chatBox);
    this.chatInput.addEventListener('focus', () => { h.input.enabled = false; h.input.releaseAll(); });
    this.chatInput.addEventListener('blur', () => { h.input.enabled = true; });
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const v = this.chatInput.value;
        this.chatInput.value = '';
        if (v.trim()) h.sendChat(v);
        if (!this.mobile) this.chatInput.blur();
      } else if (e.key === 'Escape') { this.chatInput.blur(); }
    });

    // 모바일 컨트롤
    if (this.mobile) this.buildMobile();
  }

  private buildMobile(): void {
    const h = this.h;
    // 조이스틱: 왼쪽 아래 채팅창 위. 기울인 방향(상하좌우 중 큰 축)으로 누르고 있는 동안 이동. 가운데는 데드존
    const joy = el('div', { id: 'joy' });
    const knob = el('div', { class: 'knob' });
    joy.append(knob);
    const KNOB_MAX = 34, DEAD = 14;
    let joyId: number | null = null, joyDir: Dir | null = null;
    const setJoy = (d: Dir | null) => {
      if (d === joyDir) return;
      if (joyDir !== null) h.input.release(joyDir);
      joyDir = d;
      if (d !== null) h.input.press(d);
      joy.classList.toggle('active', d !== null);
    };
    const onJoy = (e: PointerEvent) => {
      const r = joy.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy) || 1, k = Math.min(len, KNOB_MAX) / len;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      if (len < DEAD) { setJoy(null); return; }
      setJoy(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : (dy < 0 ? 3 : 0));
    };
    joy.addEventListener('pointerdown', (e) => {
      if (joyId !== null) return;
      e.preventDefault(); joyId = e.pointerId;
      try { joy.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 등 */ }
      onJoy(e);
    });
    joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) onJoy(e); });
    const joyEnd = (e: PointerEvent) => { if (e.pointerId !== joyId) return; joyId = null; setJoy(null); knob.style.transform = ''; };
    joy.addEventListener('pointerup', joyEnd);
    joy.addEventListener('pointercancel', joyEnd);

    // 오른쪽 버튼 열: 위부터 이모트 · F · 달리기
    const m = el('div', { id: 'mobile' });
    m.addEventListener('contextmenu', (e) => e.preventDefault());
    const btns = el('div', { id: 'mbtns' });
    let lastEmote = 0;
    try { lastEmote = Number(localStorage.getItem('mv-last-emote')) || 0; } catch { /* ignore */ }
    const iconOf = (id: number) => EMOTES.find((e) => e.id === id)?.icon || '😀';
    const eB = el('button', { class: 'emote', text: iconOf(lastEmote), title: '이모트 (짧게: 최근 이모트, 길게: 고르기)' });
    const drawer = el('div', { id: 'emote-drawer' });
    const outside = (e: Event) => { if (!drawer.contains(e.target as Node) && e.target !== eB) closeDrawer(); };
    const closeDrawer = () => { drawer.classList.remove('open'); document.removeEventListener('pointerdown', outside, true); };
    const openDrawer = () => { drawer.classList.add('open'); setTimeout(() => document.addEventListener('pointerdown', outside, true), 0); };
    const useEmote = (id: number) => {
      lastEmote = id; eB.textContent = iconOf(id);
      try { localStorage.setItem('mv-last-emote', String(id)); } catch { /* ignore */ }
      h.emote(id);
    };
    for (const e of EMOTES) { const b = el('button', { text: e.icon, title: e.name }); b.onclick = (ev) => { if (!ev.isTrusted) return; useEmote(e.id); closeDrawer(); }; drawer.append(b); } // isTrusted: 스크립트가 만든 가짜 클릭은 무시
    let eTimer = 0, eDone = false; // 길게 눌러 격자를 연 뒤의 pointerup 은 무시
    eB.addEventListener('pointerdown', (e) => { if (!e.isTrusted) return; e.preventDefault(); eDone = false; eTimer = window.setTimeout(() => { eDone = true; openDrawer(); }, 400); });
    eB.addEventListener('pointerup', (e) => {
      if (!e.isTrusted) return;
      e.preventDefault(); clearTimeout(eTimer);
      if (eDone) return;
      eDone = true;
      if (drawer.classList.contains('open')) closeDrawer();
      else if (lastEmote) useEmote(lastEmote);
      else openDrawer();
    });
    const eCancel = () => { clearTimeout(eTimer); eDone = true; };
    eB.addEventListener('pointercancel', eCancel); eB.addEventListener('pointerleave', eCancel);
    const fB = el('button', { text: 'F', title: '상호작용' }); fB.onclick = (e) => { if (e.isTrusted) h.interact(); };
    const tB = el('button', { text: '🧸', title: '말랑이 던지기 (앞 3칸)' }); tB.onclick = (e) => { if (e.isTrusted) h.toss(); };
    const rB = el('button', { class: 'run', text: '🏃', title: '달리기 (누르는 동안)' });
    const runOn = (e: Event) => { e.preventDefault(); h.input.setRun(true); rB.classList.add('on'); };
    const runOff = (e: Event) => { e.preventDefault(); h.input.setRun(false); rB.classList.remove('on'); };
    rB.addEventListener('pointerdown', runOn);
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) rB.addEventListener(t, runOff);
    btns.append(eB, fB, tB, rB);
    m.append(joy, btns, drawer);
    this.root.append(m);
  }

  focusChat(prefill?: string): void {
    if (prefill !== undefined) this.chatInput.value = prefill;
    this.chatInput.focus();
    const len = this.chatInput.value.length;
    this.chatInput.setSelectionRange(len, len);
  }
  blurChat(): void {
    // 단축키로 넣은 프리픽스만 남아 있으면 비운다 (다음 메시지가 엉뚱한 채널로 가지 않도록)
    if (/^\/(all|w|r)\s*$/.test(this.chatInput.value)) this.chatInput.value = '';
    this.chatInput.blur();
  }
  isChatFocused(): boolean { return document.activeElement === this.chatInput; }

  // 모바일: 채팅창 숨기기/보이기. 숨긴 동안 온 메시지 수는 💬 버튼의 배지로
  setChatHidden(on: boolean): void {
    this.chatBox.classList.toggle('hidden', on);
    this.chatShow.classList.toggle('on', on);
    if (!on) { this.unread = 0; this.updateBadge(); this.scrollChatBottom(); } // 숨긴 동안은 스크롤 위치가 날아가므로 다시 열 때 맨 아래로
    try { localStorage.setItem('mv-chat-hidden', on ? '1' : '0'); } catch { /* ignore */ }
  }
  // 바닥까지 내려와 있나 (소수점 스크롤 오차 허용). 숨겨져 있으면(clientHeight 0) 바닥으로 친다
  private chatAtBottom(): boolean { const l = this.chatLog; return l.scrollHeight - l.scrollTop - l.clientHeight < 10; }
  scrollChatBottom(): void { this.chatLog.scrollTop = this.chatLog.scrollHeight; this.hideChatNew(); }
  private hideChatNew(): void { this.chatNewCount = 0; this.chatNew.classList.remove('on'); }
  private showChatNew(preview: string): void {
    this.chatNewCount++;
    this.chatNew.textContent = `▾ ${this.chatNewCount > 1 ? `새 글 ${this.chatNewCount}개 · ` : ''}${preview}`;
    this.chatNew.classList.add('on');
  }
  private updateBadge(): void {
    const b = this.chatShow.querySelector('.badge') as HTMLElement | null;
    if (!b) return;
    b.textContent = this.unread > 99 ? '99+' : String(this.unread);
    b.classList.toggle('on', this.unread > 0);
  }
  // 새 글. 로그를 위로 올려 보고 있으면 자동으로 내리지 않고 바닥에 최근 글 한 줄을 띄운다. 바닥에 있거나 내가 보낸 글이면 맨 아래로
  appendLog(e: LogEntry): void {
    if (this.chatBox.classList.contains('hidden')) { this.unread++; this.updateBadge(); }
    const stay = this.chatLog.clientHeight > 0 && !e.self && !this.chatAtBottom();
    const d = el('div', { class: `msg ${e.channel}` });
    const t = el('span', { class: 't', text: fmtTime(e.ts) });
    d.append(t);
    let preview = e.text;
    if (e.channel === 'sys' || e.channel === 'notice') d.append(document.createTextNode(e.text));
    else {
      let prefix = '';
      if (e.channel === 'all') prefix = '[전체] ';
      else if (e.channel === 'g') prefix = '[👻 유령] ';
      else if (e.channel === 'w') prefix = e.self ? `[→ ${e.to}] ` : '[귓속말] ';
      d.append(document.createTextNode(prefix));
      const n = el('span', { class: 'n', text: e.from });
      if (!e.self) n.onclick = () => this.focusChat(`/w ${e.from} `);
      d.append(n, document.createTextNode(': ' + e.text));
      preview = `${prefix}${e.from}: ${e.text}`;
    }
    this.chatLog.append(d);
    while (this.chatLog.children.length > 200) this.chatLog.firstElementChild?.remove();
    if (stay) this.showChatNew(preview); else this.scrollChatBottom();
  }

  // 상단 코인 알약: 잔액 (+ 자동 회수 남은 시간)
  setCoins(text: string): void { this.coinPill.textContent = text; }

  setOnline(n: number): void { this.onlinePill.innerHTML = `<span class="app">${APP_NAME} · </span>접속 <b>${n}</b>명`; }

  setHint(text: string | null): void {
    this.hintPill.style.display = text ? 'inline-flex' : 'none';
    if (text) this.hintPill.textContent = text;
  }

  setAnnouncement(text: string | null, ts: number): void {
    const dismissed = localStorage.getItem('mv-ann-dismissed');
    if (!text || dismissed === String(ts)) { this.announce.style.display = 'none'; return; }
    this.announce.innerHTML = `📢 ${escapeHtml(text)} <button class="btn small" style="margin-left:8px">닫기</button>`;
    this.announce.querySelector('button')!.onclick = () => { localStorage.setItem('mv-ann-dismissed', String(ts)); this.announce.style.display = 'none'; };
    this.announce.style.display = 'block';
  }

  showOnlineList(): void {
    const list = this.h.onlineList();
    const body = el('div', { class: 'board-list' });
    for (const p of list) {
      const row = el('div', { class: 'board-item' }, [el('span', { class: 'title', text: p.nick + (p.uid === this.h.myUid ? ' (나)' : '') })]);
      if (p.uid !== this.h.myUid) row.onclick = (e) => { m.close(); this.h.openPlayerMenu(p.uid, e.clientX, e.clientY); };
      body.append(row);
    }
    const m = modal(`접속 중 (${list.length}명)`, body, [{ label: '닫기', onClick: () => {} }]);
  }
}
