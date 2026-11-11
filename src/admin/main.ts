import '../styles.css';
import { ref, get, set, update, remove, onValue, push, query, orderByKey, orderByChild, limitToLast, serverTimestamp, runTransaction } from 'firebase/database';
import { isConfigured, db, app } from '../firebase/app';
import { waitForAuth, login, logout } from '../firebase/auth';
import { isAdmin, mergeConfig, serverNow } from '../firebase/db';
import { showLoginScreen, showMessageScreen, toast, modal, promptModal, confirmModal } from '../game/ui';
import { el, escapeHtml, fmtDateTime, fmtBytes, dayKey, nickKey, safeKey, idKey, validateNick } from '../shared/util';
import { APP_NAME, CLIENT_VERSION } from '../shared/config';
import type { PlayerState, UserProfile, ServerConfig, RoomState, ConnLog, ChatLog, Post } from '../shared/types';
import { buildDefaultMap, buildPortalGarden, sanitizeMap, labelAt, G, O, GROUND_NAMES, OBJECT_NAMES, type MapData, type Zone, type PortalDest, emptyMap, validateZone, isReservedMapId, portalDests, PORTAL_MAX_DESTS } from '../game/map';
import { isMapId, MAIN_MAP_ID, GARDEN_MAP_ID, GOLD_MINE_MAP_ID } from '../shared/maps';
import { groundTile, objectSprite } from '../game/tiles';
import { catLabel } from '../game/board';
import { ALL_ITEMS, priceOf, itemById, petLevel, type Wallet } from '../shared/shop';
import { BET_MAX_DEFAULT } from '../shared/casino';
import { DEFAULT_CONTEST, WEEKDAY_NAME } from '../shared/contest';
import { TILE } from '../shared/config';
import { fishColl, weekKey, fmtSize } from '../shared/fish';
import { bugColl, fmtBugSize } from '../shared/bugs';
import { RARITY_NAME, RARITY_POINTS, TIME_LABEL, type Collection, type CollDef, type CollDefRecord, type DefTime, type Rarity, type WeekEntry, type BestEntry } from '../shared/collection';

const root = document.getElementById('app')!;
let myUid = '';
let unsubs: (() => void)[] = [];
const projectId = (app.options as { projectId?: string }).projectId || '';
const consoleUrl = `https://console.firebase.google.com/project/${projectId}/usage`;

async function boot(): Promise<void> {
  if (!isConfigured) { showMessageScreen(root, '설정 필요', 'Firebase 설정이 없습니다. README.md 를 참고하세요.'); return; }
  const user = await waitForAuth();
  if (!user) { showLogin(); return; }
  await enter(user.uid);
}
function showLogin(msg = ''): void {
  showLoginScreen(root, {
    onLogin: async (id, pw) => { const uid = await login(id, pw); await enter(uid); },
    onSignup: async () => { throw new Error('관리자 페이지에서는 가입할 수 없습니다.'); },
  }, msg || '관리자 계정으로 로그인하세요.');
}
async function enter(uid: string): Promise<void> {
  if (!(await isAdmin(uid))) {
    showMessageScreen(root, '권한 없음', '이 계정은 관리자가 아닙니다.\n관리자 지정은 README 의 CLI 안내를 참고하세요.', { label: '로그아웃', onClick: async () => { await logout(); showLogin(); } });
    return;
  }
  myUid = uid;
  renderDashboard();
}

function adminLog(action: string, target?: string, detail?: string): void {
  push(ref(db, 'logs/admin'), { action, target: target || null, detail: detail || null, ts: serverTimestamp(), by: myUid }).catch(() => {});
}

// ---------- 공용 데이터 헬퍼 ----------
async function trimByKey(path: string, keep: number): Promise<number> {
  const s = await get(query(ref(db, path), orderByKey()));
  if (!s.exists()) return 0;
  const keys: string[] = [];
  s.forEach((c) => { keys.push(c.key!); });
  if (keys.length <= keep) return 0;
  const del = keys.slice(0, keys.length - keep);
  for (let i = 0; i < del.length; i += 200) {
    const upd: Record<string, null> = {};
    for (const k of del.slice(i, i + 200)) upd[`${path}/${k}`] = null;
    await update(ref(db), upd);
  }
  return del.length;
}
async function countChildren(path: string): Promise<number> {
  const s = await get(ref(db, path));
  return s.exists() ? Object.keys(s.val()).length : 0;
}
async function kickUser(uid: string, reason = ''): Promise<void> {
  await set(ref(db, `kicks/${uid}`), { ts: serverTimestamp(), reason });
  adminLog('kick', uid, reason);
}
// 코인 지급·회수: 지갑 규칙이 관리자 쓰기는 획득 상한·구매 검사에서 빼 준다. gf(금액, 시각)를 같이 적어 받는 사람 화면에 알림이 뜨게 한다
async function grantCoins(uid: string, nick: string): Promise<void> {
  const v = await promptModal(`코인 지급: ${nick}`, '지급할 코인 (음수를 넣으면 회수)', '100', 8);
  if (v === null) return;
  const s = v.trim(), n = Math.trunc(Number(s));
  if (!/^-?\d+$/.test(s) || !n || Math.abs(n) > 1000000) { toast('1 ~ 1,000,000 사이의 숫자를 넣으세요. 회수는 음수로.', true); return; }
  const amount = Math.abs(n).toLocaleString('ko-KR');
  if (!(await confirmModal(n > 0 ? `${nick} 에게 ${amount}코인을 지급할까요?` : `${nick} 에게서 ${amount}코인을 회수할까요? 잔액이 모자라면 있는 만큼만 가져옵니다.`, n > 0 ? '지급' : '회수'))) return;
  try {
    let moved = 0;
    const res = await runTransaction(ref(db, `wallet/${uid}`), (cur: Wallet | null) => {
      const c: Wallet = { ...(cur || { c: 0, e: 0 }) };
      moved = n > 0 ? n : -Math.min(c.c || 0, -n);
      const gf = { n: moved, at: serverTimestamp() as unknown as number };
      return n > 0 ? { ...c, c: (c.c || 0) + n, e: (c.e || 0) + n, gf } : { ...c, c: (c.c || 0) + moved, gf };
    }, { applyLocally: false });
    if (!res.committed) throw new Error('지갑을 바꾸지 못했습니다.');
    adminLog('grant-coins', uid, String(moved));
    toast(n > 0 ? `${nick} 에게 ${amount}코인을 지급했습니다.` : `${nick} 에게서 ${Math.abs(moved).toLocaleString('ko-KR')}코인을 회수했습니다.`);
  } catch (e) { toast('실패: ' + ((e as Error).message || String(e)), true); }
}
async function banUser(uid: string, reason = ''): Promise<void> {
  await set(ref(db, `bans/${uid}`), { at: serverTimestamp(), reason });
  await kickUser(uid, reason || '차단');
  adminLog('ban', uid, reason);
}
async function unbanUser(uid: string): Promise<void> { await remove(ref(db, `bans/${uid}`)); adminLog('unban', uid); }
async function forceNick(uid: string, oldNick: string, newNick: string): Promise<void> {
  const err = validateNick(newNick);
  if (err) throw new Error(err);
  const nk = nickKey(newNick);
  const res = await runTransaction(ref(db, `nicknames/${nk}`), (cur) => (cur === null || cur === uid ? uid : undefined));
  if (!res.committed) throw new Error('이미 사용 중인 닉네임입니다.');
  const upd: Record<string, unknown> = { [`users/${uid}/nick`]: newNick };
  if ((await get(ref(db, `players/${uid}`))).exists()) upd[`players/${uid}/n`] = newNick;
  if (nickKey(oldNick) !== nk) upd[`nicknames/${nickKey(oldNick)}`] = null;
  await update(ref(db), upd);
  adminLog('rename', uid, `${oldNick} -> ${newNick}`);
}
// 가입 거절(action 'reject')도 이 함수로 지운다: 실명·가입 사유(signups)와 승인 표시(approved)까지 함께. 거절 기록에는 아이디를 남기지 않는다
async function deleteUserData(uid: string, u: UserProfile, action = 'delete-user-data'): Promise<void> {
  const upd: Record<string, null> = {
    [`signups/${uid}`]: null, [`approved/${uid}`]: null,
    [`users/${uid}`]: null, [`ids/${safeKey(idKey(u.id))}`]: null, [`nicknames/${nickKey(u.nick)}`]: null,
    [`players/${uid}`]: null, [`sessions/${uid}`]: null, [`chat/whisper/${uid}`]: null, [`fish/book/${uid}`]: null, [`bug/book/${uid}`]: null, [`wallet/${uid}`]: null,
  };
  await update(ref(db), upd);
  adminLog(action, uid, action === 'reject' ? undefined : u.id);
}
async function cleanupStale(): Promise<string> {
  const players = (await get(ref(db, 'players'))).val() as Record<string, PlayerState> | null;
  const online = new Set(Object.keys(players || {}));
  const occ = (await get(ref(db, 'occ'))).val() as Record<string, string> | null;
  const upd: Record<string, unknown> = {};
  let n = 0;
  for (const [k, uid] of Object.entries(occ || {})) if (!online.has(uid)) { upd[`occ/${k}`] = null; n++; }
  const rooms = (await get(ref(db, 'rooms'))).val() as Record<string, RoomState> | null;
  let r = 0;
  for (const [id, rs] of Object.entries(rooms || {})) {
    for (const uid of Object.keys(rs.members || {})) if (!online.has(uid)) { upd[`rooms/${id}/members/${uid}`] = null; r++; }
    if (rs.state === 'result' && rs.result && serverNow() - rs.result.at > 30000) { upd[`rooms/${id}`] = { cap: rs.cap, round: (rs.round || 1) + 1, state: 'open' }; }
  }
  if (Object.keys(upd).length) await update(ref(db), upd);
  return `점유 잔여 ${n}개, 방 잔여 멤버 ${r}명 정리`;
}

// ---------- 대시보드 ----------
type Tab = 'dash' | 'conn' | 'chat' | 'users' | 'signup' | 'audit' | 'rooms' | 'board' | 'fish' | 'bugs' | 'config' | 'editor';
const TABS: { id: Tab; label: string }[] = [
  { id: 'dash', label: '📊 현황' }, { id: 'conn', label: '🚪 입퇴장 로그' }, { id: 'chat', label: '💬 채팅 로그' }, { id: 'users', label: '👤 사용자' }, { id: 'signup', label: '📝 가입 승인' }, { id: 'audit', label: '🚩 의심 지표' },
  { id: 'rooms', label: '☕ 커피 방' }, { id: 'board', label: '📌 게시판' }, { id: 'fish', label: '🎣 낚시' }, { id: 'bugs', label: '🐛 곤충' }, { id: 'config', label: '⚙ 설정' }, { id: 'editor', label: '🗺 맵 편집기' },
];

function renderDashboard(): void {
  root.innerHTML = '';
  const layout = el('div', { class: 'admin' });
  const nav = el('nav');
  nav.append(el('h2', { text: `${APP_NAME} 관리자` }));
  const main = el('main');
  const buttons = new Map<Tab, HTMLButtonElement>();
  const show = (t: Tab) => {
    for (const u of unsubs) u();
    unsubs = [];
    buttons.forEach((b, k) => b.classList.toggle('active', k === t));
    main.innerHTML = '';
    ({ dash: tabDash, conn: tabConn, chat: tabChat, users: tabUsers, signup: tabSignup, audit: tabAudit, rooms: tabRooms, board: tabBoard, fish: tabFish, bugs: tabBugs, config: tabConfig, editor: tabEditor })[t](main);
  };
  for (const t of TABS) { const b = el('button', { text: t.label }); b.onclick = () => show(t.id); buttons.set(t.id, b); nav.append(b); }
  const back = el('button', { text: '🏘 서버 입장' }); back.onclick = () => { location.href = '/'; };
  const lo = el('button', { text: '⏻ 로그아웃' }); lo.onclick = async () => { await logout(); location.reload(); };
  nav.append(el('div', { style: 'flex:1' }), back, lo);
  layout.append(nav, main);
  root.append(layout);
  show('dash');
}

function statCard(label: string, value: string): HTMLElement {
  return el('div', { class: 'stat' }, [el('div', { class: 'v', text: value }), el('div', { class: 'l', text: label })]);
}

function tabDash(main: HTMLElement): void {
  main.append(el('h3', { text: '현황' }));
  const cards = el('div', { class: 'cards' });
  const playersBox = el('div');
  const mini = document.createElement('canvas');
  mini.width = 480; mini.height = 320; mini.style.border = '1px solid var(--border)'; mini.style.borderRadius = '8px'; mini.style.marginBottom = '12px';
  main.append(cards, el('div', { class: 'toolbar' }, [
    el('a', { href: consoleUrl, target: '_blank', class: 'btn small', text: 'Firebase 콘솔 사용량 열기 ↗' }),
    (() => { const b = el('button', { class: 'btn small', text: '잔여 데이터 정리' }); b.onclick = async () => toast(await cleanupStale()); return b; })(),
    el('span', { class: 'muted', text: '사용량 수치는 클라이언트 집계 기반 추정치입니다. 정확한 값은 Firebase 콘솔에서 확인하세요.' }),
  ]), mini, playersBox);
  let map: MapData = buildDefaultMap();
  get(ref(db, 'config/activeMap')).then(async (s) => {
    const id = s.val() || 'default';
    const m = await get(ref(db, `maps/${id}`));
    if (m.exists()) map = sanitizeMap(m.val(), map);
  });
  const stats: Record<string, number> = {};
  let players: Record<string, PlayerState> = {};
  const draw = () => {
    const ctx = mini.getContext('2d')!;
    const sx = mini.width / map.w, sy = mini.height / map.h;
    ctx.fillStyle = '#1b2a1b'; ctx.fillRect(0, 0, mini.width, mini.height);
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const g = map.ground[y * map.w + x], o = map.objects[y * map.w + x];
      ctx.fillStyle = g === G.WATER ? '#4aa3df' : g === G.PATH || g === G.PATH2 ? '#d9c38f' : g === G.PLAZA ? '#cfc9bd' : g === G.WOOD || g === G.TILE_FLOOR || g === G.CARPET ? '#c99a5b' : '#7ec850';
      if (o === O.WALL || o === O.WALL_SIDE || o === O.WALL_WINDOW) ctx.fillStyle = '#b7523f';
      else if (o === O.TREE || o === O.PINE || o === O.BUSH || o === O.HEDGE) ctx.fillStyle = '#2f7a2f';
      ctx.fillRect(x * sx, y * sy, Math.ceil(sx), Math.ceil(sy));
    }
    ctx.font = '11px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (const z of map.zones) if (z.kind === 'label') ctx.fillText(z.label || '', z.x * sx + 2, z.y * sy + 11);
    for (const [, p] of Object.entries(players)) {
      ctx.fillStyle = '#ffd84d'; ctx.beginPath(); ctx.arc(p.x * sx + sx / 2, p.y * sy + sy / 2, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillText(p.n, p.x * sx + 6, p.y * sy - 2);
    }
  };
  // 로그·게시글 개수는 노드 전체를 내려받아야 셀 수 있다(한 번에 약 360KB). 탭을 열 때 한 번만 센다.
  // 예전엔 renderStats 안에서 셌는데, 접속자 누가 움직일 때마다 불려서 현황 탭을 켜 두면 분당 수십 MB 가 나갔다(2026-11-09 점심 10분에 776MB).
  let countCards: HTMLElement[] = [];
  const renderStats = () => {
    const peak = stats.peak || Object.keys(players).length;
    const est = (stats.moves || 0) * 70 * Math.max(0, peak - 1) + (stats.msgs || 0) * 160 * peak + (stats.joins || 0) * 600 * peak + (stats.emotes || 0) * 60 * peak;
    cards.innerHTML = '';
    cards.append(
      statCard('현재 접속자', String(Object.keys(players).length)),
      statCard('오늘 최대 동시접속', String(stats.peak || 0)),
      statCard('오늘 입장 횟수', String(stats.joins || 0)),
      statCard('오늘 메시지', String(stats.msgs || 0)),
      statCard('오늘 이동 횟수', String(stats.moves || 0)),
      statCard('오늘 낚은 물고기', String(stats.fish || 0)),
      statCard('오늘 잡은 곤충', String(stats.bugs || 0)),
      statCard('오늘 던진 말랑이', String(stats.toss || 0)),
      statCard('오늘 두더지 판수', String(stats.mole || 0)),
      statCard('오늘 보물 발굴', String(stats.dig || 0)),
      statCard('오늘 룰렛', String(stats.roulette || 0)),
      statCard('오늘 다운로드 추정', fmtBytes(est)),
      statCard('월 무료 한도', '10 GB'),
      ...countCards,
    );
  };
  Promise.all([countChildren('logs/conn'), countChildren('logs/chat'), countChildren('board/posts'), countChildren('chat/public')]).then(([conn, chat, posts, pub]) => {
    countCards = [statCard('입퇴장 로그 수', String(conn)), statCard('채팅 로그 수', String(chat)), statCard('게시글 수', String(posts)), statCard('공개 채팅 보관', String(pub))];
    renderStats();
  }).catch(() => {});
  const renderPlayers = () => {
    playersBox.innerHTML = '';
    const t = el('table');
    t.innerHTML = '<thead><tr><th>닉네임</th><th>위치</th><th>펫</th><th>방</th><th>접속 시각</th><th>조치</th></tr></thead>';
    const tb = el('tbody');
    for (const [uid, p] of Object.entries(players).sort((a, b) => (a[1].j || 0) - (b[1].j || 0))) {
      const tr = el('tr');
      tr.append(el('td', { text: p.n + (uid === myUid ? ' (나)' : '') }), el('td', { text: `${labelAt(map, p.x, p.y) || '-'} (${p.x}, ${p.y})` }), el('td', { text: p.pt ? `${itemById(p.pt)?.icon || p.pt} Lv.${petLevel(p.pl || 0)}` : '-' }), el('td', { text: p.r || '-' }), el('td', { text: p.j ? fmtDateTime(p.j) : '-' }));
      const td = el('td');
      const k = el('button', { class: 'btn small', text: '강퇴' }); k.onclick = async () => { if (await confirmModal(`${p.n} 님을 강퇴할까요?`)) { await kickUser(uid); toast('강퇴했습니다.'); } };
      const b = el('button', { class: 'btn small danger', text: '차단' }); b.onclick = async () => { if (await confirmModal(`${p.n} 님을 차단할까요? 다시 접속할 수 없게 됩니다.`)) { await banUser(uid); toast('차단했습니다.'); } };
      const w = el('button', { class: 'btn small', text: '닉변경' }); w.onclick = async () => { const n = await promptModal('닉네임 강제 변경', '새 닉네임', p.n, 12); if (n) { try { await forceNick(uid, p.n, n); toast('변경했습니다.'); } catch (e) { toast((e as Error).message, true); } } };
      td.append(k, ' ', b, ' ', w);
      tr.append(td);
      tb.append(tr);
    }
    t.append(tb);
    playersBox.append(el('h3', { text: `접속자 ${Object.keys(players).length}명` }), t);
    draw();
  };
  unsubs.push(onValue(ref(db, 'players'), (s) => { players = (s.val() as Record<string, PlayerState>) || {}; renderPlayers(); renderStats(); }));
  unsubs.push(onValue(ref(db, `stats/${dayKey()}`), (s) => { Object.assign(stats, s.val() || {}); renderStats(); }));
}

function tabConn(main: HTMLElement): void {
  main.append(el('h3', { text: '입퇴장 로그 (최근 400건)' }));
  const filter = el('input', { placeholder: '닉네임 필터' });
  const trim = el('button', { class: 'btn small', text: '보존 개수만 남기고 정리' });
  const clear = el('button', { class: 'btn small danger', text: '전체 삭제' });
  const box = el('div', { class: 'log' });
  main.append(el('div', { class: 'toolbar' }, [filter, trim, clear]), box);
  let rows: (ConnLog & { key: string })[] = [];
  const render = () => {
    const f = filter.value.trim();
    box.innerHTML = rows.filter((r) => !f || r.n.includes(f)).slice().reverse().map((r) => `<div><span class="ts">${fmtDateTime(r.ts)}</span> ${r.type === 'join' ? '🟢 입장' : '⚪ 퇴장'} <b>${escapeHtml(r.n)}</b> <span class="ts">${r.u}</span></div>`).join('') || '<span class="muted">로그 없음</span>';
  };
  filter.oninput = render;
  trim.onclick = async () => { const c = mergeConfig((await get(ref(db, 'config'))).val()); const n = await trimByKey('logs/conn', c.logRetention.conn); toast(`${n}건 정리`); adminLog('trim-conn', undefined, String(n)); };
  clear.onclick = async () => { if (await confirmModal('입퇴장 로그를 모두 삭제할까요?')) { await remove(ref(db, 'logs/conn')); toast('삭제했습니다.'); adminLog('clear-conn'); } };
  unsubs.push(onValue(query(ref(db, 'logs/conn'), orderByChild('ts'), limitToLast(400)), (s) => {
    rows = [];
    s.forEach((c) => { rows.push({ key: c.key!, ...(c.val() as ConnLog) }); });
    render();
  }));
}

function tabChat(main: HTMLElement): void {
  main.append(el('h3', { text: '채팅 로그 (최근 500건, 귓속말 포함)' }));
  const filter = el('input', { placeholder: '닉네임/내용 필터' });
  const ch = el('select');
  ch.innerHTML = '<option value="">모든 채널</option><option value="near">주변</option><option value="all">전체</option><option value="w">귓속말</option><option value="p">파티 (옛 기록)</option>';
  const trim = el('button', { class: 'btn small', text: '보존 개수만 남기고 정리' });
  const clearPub = el('button', { class: 'btn small', text: '공개 채팅창 비우기' });
  const clear = el('button', { class: 'btn small danger', text: '로그 전체 삭제' });
  const box = el('div', { class: 'log' });
  main.append(el('div', { class: 'toolbar' }, [filter, ch, trim, clearPub, clear]), box);
  let rows: (ChatLog & { key: string })[] = [];
  const chName: Record<string, string> = { near: '주변', all: '전체', w: '귓속말', p: '파티(옛)', g: '유령' };
  const render = () => {
    const f = filter.value.trim(), c = ch.value;
    box.innerHTML = rows.filter((r) => (!c || r.c === c) && (!f || r.n.includes(f) || r.t.includes(f) || (r.toNick || '').includes(f))).slice().reverse()
      .map((r) => `<div><span class="ts">${fmtDateTime(r.ts)}</span> [${chName[r.c] || r.c}] <b>${escapeHtml(r.n)}</b>${r.toNick ? ` → <b>${escapeHtml(r.toNick)}</b>` : ''}: ${escapeHtml(r.t)}</div>`).join('') || '<span class="muted">로그 없음</span>';
  };
  filter.oninput = render; ch.onchange = render;
  trim.onclick = async () => { const c = mergeConfig((await get(ref(db, 'config'))).val()); const n = await trimByKey('logs/chat', c.logRetention.chat); toast(`${n}건 정리`); adminLog('trim-chat', undefined, String(n)); };
  clearPub.onclick = async () => { if (await confirmModal('모든 사용자의 공개 채팅창 기록(chat/public)을 비울까요? 로그는 유지됩니다.')) { await remove(ref(db, 'chat/public')); toast('비웠습니다.'); adminLog('clear-public-chat'); } };
  clear.onclick = async () => { if (await confirmModal('채팅 로그를 모두 삭제할까요?')) { await remove(ref(db, 'logs/chat')); toast('삭제했습니다.'); adminLog('clear-chatlog'); } };
  unsubs.push(onValue(query(ref(db, 'logs/chat'), orderByChild('ts'), limitToLast(500)), (s) => {
    rows = [];
    s.forEach((c) => { rows.push({ key: c.key!, ...(c.val() as ChatLog) }); });
    render();
  }));
}

function tabUsers(main: HTMLElement): void {
  main.append(el('h3', { text: '사용자' }));
  const filter = el('input', { placeholder: '아이디/닉네임 필터' });
  const box = el('div');
  main.append(el('div', { class: 'toolbar' }, [filter, el('span', { class: 'muted', text: '계정(로그인) 자체 삭제와 비밀번호 재설정은 로컬 CLI(npm run admin)로 합니다.' })]), box);
  let users: Record<string, UserProfile> = {};
  let bans: Record<string, unknown> = {};
  let online = new Set<string>();
  let wallets: Record<string, Wallet> = {};
  const render = () => {
    const f = filter.value.trim().toLowerCase();
    box.innerHTML = '';
    const t = el('table');
    t.innerHTML = '<thead><tr><th>아이디</th><th>닉네임</th><th>패배</th><th>코인</th><th>가입</th><th>최근 로그인</th><th>상태</th><th>조치</th></tr></thead>';
    const tb = el('tbody');
    for (const [uid, u] of Object.entries(users).sort((a, b) => (b[1].lastLoginAt || 0) - (a[1].lastLoginAt || 0))) {
      if (f && !u.id.toLowerCase().includes(f) && !u.nick.toLowerCase().includes(f)) continue;
      const tr = el('tr');
      const banned = !!bans[uid];
      tr.append(el('td', { text: u.id }), el('td', { text: u.nick }), el('td', { text: String(u.losses || 0) }), el('td', { text: (wallets[uid]?.c || 0).toLocaleString('ko-KR') }), el('td', { text: u.createdAt ? fmtDateTime(u.createdAt).slice(0, 10) : '-' }), el('td', { text: u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : '-' }), el('td', { text: banned ? '🚫 차단' : online.has(uid) ? '🟢 접속' : '-' }));
      const td = el('td');
      const nk = el('button', { class: 'btn small', text: '닉변경' }); nk.onclick = async () => { const n = await promptModal('닉네임 강제 변경', '새 닉네임', u.nick, 12); if (n) { try { await forceNick(uid, u.nick, n); toast('변경했습니다.'); } catch (e) { toast((e as Error).message, true); } } };
      const ls = el('button', { class: 'btn small', text: '패배 수정' }); ls.onclick = async () => { const n = await promptModal('패배 횟수 수정', '새 값', String(u.losses || 0), 5); if (n !== null && /^\d+$/.test(n)) { await update(ref(db, `users/${uid}`), { losses: Number(n) }); adminLog('set-losses', uid, n); toast('수정했습니다.'); } };
      const gv = el('button', { class: 'btn small primary', text: '코인 지급' }); gv.onclick = () => { void grantCoins(uid, u.nick); };
      const kb = el('button', { class: 'btn small', text: '강퇴' }); kb.onclick = async () => { await kickUser(uid); toast('강퇴 신호를 보냈습니다.'); };
      const bb = el('button', { class: 'btn small ' + (banned ? '' : 'danger'), text: banned ? '차단 해제' : '차단' }); bb.onclick = async () => { if (banned) { await unbanUser(uid); toast('해제했습니다.'); } else if (await confirmModal(`${u.nick} 을(를) 차단할까요?`)) { await banUser(uid); toast('차단했습니다.'); } };
      const del = el('button', { class: 'btn small danger', text: '데이터 삭제' }); del.onclick = async () => { if (await confirmModal(`${u.id} 의 프로필/닉네임/아이디 데이터를 삭제할까요? (로그인 계정은 CLI로 삭제)`)) { await deleteUserData(uid, u); toast('삭제했습니다.'); } };
      td.append(gv, ' ', nk, ' ', ls, ' ', kb, ' ', bb, ' ', del);
      tr.append(td);
      tb.append(tr);
    }
    t.append(tb);
    box.append(el('div', { class: 'muted', text: `총 ${Object.keys(users).length}명` }), t);
  };
  filter.oninput = render;
  unsubs.push(onValue(ref(db, 'users'), (s) => { users = (s.val() as Record<string, UserProfile>) || {}; render(); }));
  unsubs.push(onValue(ref(db, 'bans'), (s) => { bans = (s.val() as Record<string, unknown>) || {}; render(); }));
  unsubs.push(onValue(ref(db, 'wallet'), (s) => { wallets = (s.val() as Record<string, Wallet>) || {}; render(); }));
  unsubs.push(onValue(ref(db, 'players'), (s) => { online = new Set(Object.keys((s.val() as Record<string, unknown>) || {})); render(); }));
}

// 의심 지표: 서버 코드가 없어 "무엇을 잡았는지"는 검증할 수 없으므로, 수치가 튀는 사람을 눈으로 찾는다 (2026-11-06)
// 가입 승인: 대기 중인 신청(아이디·실명·닉네임·가입 사유·신청 시각)을 보고 승인하거나 거절한다. 실명과 가입 사유는 이 화면에만 나온다(signups 는 관리자만 읽는다).
// 거절하면 신청 정보와 프로필을 바로 지운다. 로그인 계정 껍데기는 그 사람이 다음에 로그인할 때 스스로 지워진다(main.ts enter)
interface SignupRec { name: string; reason: string; at: number }
function tabSignup(main: HTMLElement): void {
  main.append(el('h3', { text: '가입 승인' }));
  const box = el('div');
  main.append(el('div', { class: 'toolbar' }, [el('span', { class: 'muted', text: '실명과 가입 사유는 관리자만 볼 수 있습니다. 거절하면 신청 정보와 프로필이 바로 삭제됩니다.' })]), box);
  let signups: Record<string, SignupRec> = {};
  let users: Record<string, UserProfile> = {};
  let approved: Record<string, boolean> = {};
  const table = (rows: [string, SignupRec][], pending: boolean): HTMLElement => {
    const t = el('table');
    t.innerHTML = `<thead><tr><th>아이디</th><th>실명</th><th>닉네임</th><th>가입 사유</th><th>신청 시각</th>${pending ? '<th>조치</th>' : ''}</tr></thead>`;
    const tb = el('tbody');
    for (const [uid, r] of rows) {
      const u = users[uid];
      const tr = el('tr');
      tr.append(el('td', { text: u?.id || '(프로필 없음)' }), el('td', { text: r.name || '' }), el('td', { text: u?.nick || '-' }), el('td', { text: r.reason || '' }), el('td', { text: r.at ? fmtDateTime(r.at) : '-' }));
      if (pending) {
        const td = el('td');
        const ok = el('button', { class: 'btn small primary', text: '승인' });
        ok.onclick = async () => { try { await set(ref(db, `approved/${uid}`), true); adminLog('approve', uid); toast('승인했습니다.'); } catch (e) { toast((e as Error).message, true); } };
        const no = el('button', { class: 'btn small danger', text: '거절' });
        no.onclick = async () => {
          if (!(await confirmModal(`${u?.id || '이 신청'} 의 가입을 거절할까요? 신청 정보와 프로필이 바로 삭제됩니다.`, '거절'))) return;
          try {
            if (u) await deleteUserData(uid, u, 'reject');
            else { await remove(ref(db, `signups/${uid}`)); adminLog('reject', uid); }
            toast('거절했습니다.');
          } catch (e) { toast((e as Error).message, true); }
        };
        td.append(ok, ' ', no);
        tr.append(td);
      }
      tb.append(tr);
    }
    t.append(tb);
    return t;
  };
  const render = () => {
    box.innerHTML = '';
    const all = Object.entries(signups).sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
    const wait = all.filter(([uid]) => approved[uid] !== true), done = all.filter(([uid]) => approved[uid] === true);
    box.append(el('div', { class: 'muted', text: `승인 대기 ${wait.length}명` }), table(wait, true), el('h3', { text: `승인됨 ${done.length}명`, style: 'margin-top:18px' }), table(done, false));
  };
  unsubs.push(onValue(ref(db, 'signups'), (s) => { signups = (s.val() as Record<string, SignupRec>) || {}; render(); }));
  unsubs.push(onValue(ref(db, 'users'), (s) => { users = (s.val() as Record<string, UserProfile>) || {}; render(); }));
  unsubs.push(onValue(ref(db, 'approved'), (s) => { approved = (s.val() as Record<string, boolean>) || {}; render(); }));
}

function tabAudit(main: HTMLElement): void {
  main.append(el('h3', { text: '의심 지표' }));
  main.append(el('p', { class: 'muted', text: '규칙이 막는 것: 결제 없는 아이템, 가지지 않은 갑옷·꾸미기 표시, 주문서 없는 강화·먹이 없는 펫 레벨. 규칙이 알 수 없는 것: 무엇을 잡았는지(등급·크기), 강화 성공 여부, 입력 매크로, 밀려도 안 움직이기. (코인 획득 속도 상한은 2026-11-10 에 없앴다: 정상 플레이에서 지급이 막히는 일이 있어서) 아래에서 🚩 가 붙은 칸을 확인하세요.' }));
  const reload = el('button', { class: 'btn small', text: '새로 읽기' });
  const box = el('div');
  main.append(el('div', { class: 'toolbar' }, [reload]), box);
  const load = async () => {
    box.textContent = '읽는 중...';
    const wk = weekKey();
    const [us, ws, fw, bw, cf, ps] = await Promise.all(['users', 'wallet', `fish/week/${wk}`, `bug/week/${wk}`, 'config', 'players'].map((p) => get(ref(db, p))));
    const users = (us.val() as Record<string, UserProfile>) || {}, wallets = (ws.val() as Record<string, Wallet>) || {};
    const fish = (fw.val() as Record<string, WeekEntry>) || {}, bugs = (bw.val() as Record<string, WeekEntry>) || {};
    const cfg = mergeConfig(cf.val()), online = (ps.val() as Record<string, PlayerState>) || {};
    const t = el('table');
    t.innerHTML = `<thead><tr><th>닉네임</th><th>보유</th><th>누적 획득</th><th>누적 사용</th><th>낚싯대 · 펫</th><th>이번 주 낚시</th><th>이번 주 곤충</th><th>가진 아이템 값 − 쓴 코인</th><th>상태</th></tr></thead>`;
    const tb = el('tbody');
    const avgCell = (e?: WeekEntry) => {
      if (!e || !e.c) return el('td', { text: '-' });
      const avg = e.p / e.c;
      return el('td', { text: `${e.c}마리 · ${e.p}점 · 평균 ${avg.toFixed(1)}${e.c >= 30 && avg > 20 ? ' 🚩' : ''}` });
    };
    for (const [uid, u] of Object.entries(users).sort((a, b) => (wallets[b[0]]?.e || 0) - (wallets[a[0]]?.e || 0))) {
      const w = wallets[uid] || { c: 0, e: 0 };
      const gear = (u.own?.rod3 ? `👑 킹 ★${w.ks || 0} · ` : '') + (u.own?.rod2 ? `🌟 명품 ★${w.rs || 0}` : u.own?.rod1 ? '🎣 좋은' : '-') + (w.gn ? ` · 🟡 ${w.gn}` : '') + (w.px ? ' · 펫 ' + Object.entries(w.px).map(([id, xp]) => `${itemById(id)?.icon || id} Lv.${petLevel(xp)}`).join(' ') : '');
      // 선물로 받은 것(gifts)은 본인이 쓴 코인이 아니므로 뺀다 (2026-11-09)
      const ownVal = Object.keys(u.own || {}).filter((id) => !u.gifts?.[id]).reduce((s, id) => { const it = itemById(id); return s + (it ? priceOf(it, cfg.prices) : 0); }, 0);
      const gap = ownVal - (w.sp || 0);
      const st = online[uid];
      const tr = el('tr');
      tr.append(el('td', { text: u.nick }), el('td', { text: String(w.c || 0) }), el('td', { text: String(w.e || 0) }), el('td', { text: String(w.sp || 0) }),
        el('td', { text: gear }), avgCell(fish[uid]), avgCell(bugs[uid]),
        el('td', { text: ownVal ? `${ownVal} − ${w.sp || 0} = ${gap}${gap > 0 ? ' 🚩' : ''}` : '-' }), el('td', { text: st ? (st.z ? '💤 자리 비움' : '🟢 접속') + ((st.v || 0) < CLIENT_VERSION ? ' · 옛 버전 (새로고침 필요)' : '') : '-' }));
      tb.append(tr);
    }
    t.append(tb);
    box.textContent = '';
    box.append(t, el('p', { class: 'muted', text: '평균 점수는 보통 3~8점입니다(미끼·대회 중에는 더 높음). 30마리 이상인데 평균이 20점을 넘으면 🚩 (명품 낚싯대 20성 이상이면 정상). 아이템 값이 쓴 코인보다 크면 🚩 이지만, 가격을 바꾼 적이 있으면 정상일 수 있습니다.' }));
  };
  const run = () => { load().catch((e) => { box.textContent = '읽지 못했습니다: ' + ((e as Error).message || String(e)); }); };
  reload.onclick = run;
  run();
}

function tabRooms(main: HTMLElement): void {
  main.append(el('h3', { text: '커피 내기 방' }));
  const box = el('div');
  const resetAll = el('button', { class: 'btn small danger', text: '모든 방 초기화' });
  resetAll.onclick = async () => { if (await confirmModal('모든 방을 초기화할까요? 방 안의 사람들은 밖으로 나가야 다시 입장됩니다.')) { await remove(ref(db, 'rooms')); adminLog('reset-rooms'); toast('초기화했습니다.'); } };
  main.append(el('div', { class: 'toolbar' }, [resetAll]), box);
  unsubs.push(onValue(ref(db, 'rooms'), (s) => {
    const rooms = (s.val() as Record<string, RoomState>) || {};
    box.innerHTML = '';
    const t = el('table');
    t.innerHTML = '<thead><tr><th>방</th><th>상태</th><th>라운드</th><th>멤버</th><th>결과</th><th></th></tr></thead>';
    const tb = el('tbody');
    for (const [id, rs] of Object.entries(rooms).sort()) {
      const tr = el('tr');
      const members = Object.values(rs.members || {}).map((m) => `${m.ready ? '✓' : '·'} ${m.n}(${m.losses})`).join(', ');
      tr.append(el('td', { text: `${id} (${rs.cap}명)` }), el('td', { text: rs.state }), el('td', { text: String(rs.round) }), el('td', { text: members || '-' }), el('td', { text: rs.result ? `${rs.result.loserNick} 당첨 ${fmtDateTime(rs.result.at).slice(11)}` : '-' }));
      const td = el('td');
      const b = el('button', { class: 'btn small', text: '초기화' }); b.onclick = async () => { await set(ref(db, `rooms/${id}`), { cap: rs.cap, round: (rs.round || 1) + 1, state: 'open' }); adminLog('reset-room', id); };
      td.append(b); tr.append(td); tb.append(tr);
    }
    t.append(tb);
    box.append(Object.keys(rooms).length ? t : el('p', { class: 'muted', text: '아직 사용된 방이 없습니다.' }));
  }));
}

// 수집 종류 관리 (물고기·곤충 공용): DB {base}/defs 에 전체 목록. 비어 있으면 코드 기본 목록이 쓰이는 상태.
// 기본 종은 삭제 대신 비활성화만, 관리자가 추가한 종은 삭제 가능 (잡은 사람 도감에는 '사라진 …'으로 남는다)
interface CollSpec { base: 'fish' | 'bug'; coll: Collection; label: string; title: string; unit: (n: number) => string; unitName: string; contestTime: boolean }
const FISH_SPEC: CollSpec = { base: 'fish', coll: fishColl, label: '물고기', title: '낚시', unit: fmtSize, unitName: 'cm', contestTime: true };
const BUG_SPEC: CollSpec = { base: 'bug', coll: bugColl, label: '곤충', title: '곤충 채집', unit: fmtBugSize, unitName: 'mm', contestTime: false };

function collDefsSection(main: HTMLElement, spec: CollSpec): void {
  const { base, coll, label } = spec;
  main.append(el('h4', { text: `${label} 종류` }));
  const note = el('p', { class: 'muted' });
  const bar = el('div', { class: 'toolbar' });
  const box = el('div');
  main.append(note, bar, box);
  let dbDefs: Record<string, CollDefRecord> | null = null;

  const ensureSeeded = async (): Promise<void> => {
    if (dbDefs) return;
    await set(ref(db, `${base}/defs`), coll.defaultRecord());
    adminLog(`${base}-defs-seed`);
  };
  const nextOrd = () => Math.max(-1, ...Object.values(dbDefs || {}).map((r) => Number(r.ord) || 0)) + 1;

  const editModal = (f: CollDef | null) => {
    const form = el('div', { class: 'form' });
    const fld = (lb: string, input: HTMLElement) => el('div', { class: 'field' }, [el('label', { text: lb }), input]);
    const name = el('input', { type: 'text', maxlength: '20', value: f?.name || '' });
    const icon = el('input', { type: 'text', maxlength: '8', value: f?.icon || (base === 'fish' ? '🐟' : '🐛') });
    const rarity = el('select');
    RARITY_NAME.forEach((n, i) => rarity.append(el('option', { value: String(i), text: `${n} (${RARITY_POINTS[i]}점)` })));
    rarity.value = String(f?.rarity ?? 0);
    const junk = el('input', { type: 'checkbox' }); junk.checked = !!f?.junk;
    const min = el('input', { type: 'number', min: '0', step: '0.1', value: String(f?.min ?? 5) });
    const max = el('input', { type: 'number', min: '0', step: '0.1', value: String(f?.max ?? 20) });
    const w = el('input', { type: 'number', min: '0', step: 'any', value: String(f?.w ?? 5) }); // 신화는 0.001 같은 작은 값을 쓴다
    const time = el('select');
    const times: [string, string][] = [['', '상시'], ['lunch', TIME_LABEL.lunch], ['night', TIME_LABEL.night]];
    if (spec.contestTime) times.push(['contest', TIME_LABEL.contest]);
    for (const [v, t] of times) time.append(el('option', { value: v, text: t }));
    time.value = f?.time || '';
    const desc = el('textarea', { rows: '2', maxlength: '80' }); desc.value = f?.desc || '';
    form.append(
      fld('이름', name),
      el('div', { class: 'row' }, [fld('아이콘 (이모지)', icon), fld('등급', rarity)]),
      el('div', { class: 'row' }, [fld(`최소 크기 (${spec.unitName})`, min), fld(`최대 크기 (${spec.unitName})`, max), fld('가중치', w)]),
      el('div', { class: 'row' }, [fld('시간대', time), fld('꽝 아이템 (점수 0, 크기 없음)', junk)]),
      fld('설명', desc),
    );
    const m = modal(f ? `수정: ${f.name}` : '종 추가', form, [
      { label: '취소', onClick: () => {} },
      { label: '저장', primary: true, keep: true, onClick: async () => {
        const nm = name.value.trim(), ic = icon.value.trim();
        if (!nm || !ic) { toast('이름과 아이콘을 입력하세요.', true); return; }
        const mn = Math.max(0, Number(min.value) || 0), mx = Math.max(0, Number(max.value) || 0);
        if (!junk.checked && mx < mn) { toast('최대 크기가 최소보다 작습니다.', true); return; }
        await ensureSeeded();
        const id = f ? f.id : 'c' + Date.now().toString(36);
        const def: CollDef = { id, name: nm, icon: ic, rarity: Number(rarity.value) as Rarity, min: junk.checked ? 0 : mn, max: junk.checked ? 0 : mx, w: Math.max(0, Number(w.value) || 0), desc: desc.value.trim() };
        if (junk.checked) def.junk = true;
        if (time.value) def.time = time.value as DefTime;
        if (f?.on === false) def.on = false;
        const ord = f && dbDefs?.[f.id] ? Number(dbDefs[f.id].ord) || 0 : nextOrd();
        await set(ref(db, `${base}/defs/${id}`), coll.toRecord(def, ord));
        adminLog(`${base}-def-save`, id, nm); toast('저장했습니다.'); m.close();
      } },
    ]);
  };

  const render = () => {
    const list = coll.list();
    note.textContent = dbDefs
      ? `${list.length}종 (DB 목록). 확률 = 가중치 ÷ 그 시간대에 나올 수 있는 종의 가중치 합. 신화 등급은 낚싯대·잠자리채·미끼와 무관하게 이 확률 그대로입니다. 기본 종은 삭제 대신 비활성화만 됩니다.`
      : '아직 DB 에 목록이 없어 코드의 기본 목록을 쓰는 중입니다. 무엇이든 수정하면 기본 목록이 DB 에 복사된 뒤 적용됩니다.';
    bar.innerHTML = '';
    const add = el('button', { class: 'btn small primary', text: '＋ 종 추가' });
    add.onclick = () => editModal(null);
    const reset = el('button', { class: 'btn small' + (dbDefs ? ' danger' : ''), text: dbDefs ? '기본 목록으로 전체 초기화' : '기본 목록을 DB 에 복사' });
    reset.onclick = async () => {
      if (dbDefs && !(await confirmModal(`기본 목록(${coll.defaults.length}종)으로 되돌릴까요? 추가한 종은 지워지고 가중치·활성 상태도 기본값이 됩니다. (도감·기록은 남습니다)`))) return;
      await set(ref(db, `${base}/defs`), coll.defaultRecord());
      adminLog(`${base}-defs-reset`); toast('기본 목록을 적용했습니다.');
    };
    bar.append(add, reset);
    box.innerHTML = '';
    const at = (h: number) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d; };
    const pools = { base: coll.pool(at(10)), lunch: coll.pool(at(12)), night: coll.pool(at(20)), contest: coll.pool(at(10), undefined, true) };
    // 신화처럼 아주 작은 확률은 "1/N" 로 (2026-11-09). 신화는 장비·미끼 배수를 안 타므로 이 값이 그대로 실제 확률이다
    const pct = (f: CollDef, pool: CollDef[]) => { const c = coll.chance(f.id, pool); return c > 0 && c < 0.0005 ? `1/${Math.round(1 / c).toLocaleString('ko-KR')}` : (c * 100).toFixed(1) + '%'; };
    const t = el('table');
    t.innerHTML = '<thead><tr><th>활성</th><th></th><th>이름</th><th>등급</th><th>크기</th><th>시간대</th><th>가중치</th><th>확률</th><th></th></tr></thead>';
    const tb = el('tbody');
    for (const f of list) {
      const tr = el('tr', { class: f.on === false ? 'off' : '' });
      const on = el('input', { type: 'checkbox', title: '활성' }); on.checked = f.on !== false;
      on.onchange = async () => { await ensureSeeded(); await set(ref(db, `${base}/defs/${f.id}/on`), on.checked ? null : false); adminLog(`${base}-def-toggle`, f.id, on.checked ? 'on' : 'off'); };
      const w = el('input', { type: 'number', min: '0', step: 'any', value: String(f.w), style: 'width:72px' });
      w.onchange = async () => { const v = Math.max(0, Number(w.value) || 0); await ensureSeeded(); await set(ref(db, `${base}/defs/${f.id}/w`), v); adminLog(`${base}-def-weight`, f.id, String(v)); };
      const chance = f.on === false ? '-'
        : f.time === 'lunch' ? `점심 ${pct(f, pools.lunch)}`
        : f.time === 'night' ? `야근 ${pct(f, pools.night)}`
        : f.time === 'contest' ? `대회 ${pct(f, pools.contest)}`
        : `${pct(f, pools.base)} (점심 ${pct(f, pools.lunch)} · 야근 ${pct(f, pools.night)})`;
      tr.append(
        el('td', {}, [on]), el('td', { text: f.icon }), el('td', { text: f.name + (f.junk ? ' (꽝)' : '') + (coll.isDefault(f.id) ? '' : ' ·추가') }),
        el('td', { text: f.junk ? '-' : RARITY_NAME[f.rarity] }), el('td', { text: f.junk ? '-' : `${f.min}~${f.max}${spec.unitName}` }),
        el('td', { text: f.time ? (f.time === 'lunch' ? '점심' : f.time === 'night' ? '야근' : '대회') : '상시' }), el('td', {}, [w]), el('td', { text: chance }),
      );
      const td = el('td');
      const ed = el('button', { class: 'btn small', text: '수정' }); ed.onclick = () => editModal(f); td.append(ed, ' ');
      const dflt = coll.defaultById(f.id);
      if (dflt) {
        if (dbDefs && JSON.stringify(coll.toRecord(f, 0)) !== JSON.stringify(coll.toRecord(dflt, 0))) {
          const rs = el('button', { class: 'btn small', text: '기본값으로' });
          rs.onclick = async () => { await set(ref(db, `${base}/defs/${f.id}`), coll.toRecord(dflt, Number(dbDefs?.[f.id]?.ord) || 0)); adminLog(`${base}-def-restore`, f.id); };
          td.append(rs);
        }
      } else {
        const del = el('button', { class: 'btn small danger', text: '삭제' });
        del.onclick = async () => {
          const books = (await get(ref(db, `${base}/book`))).val() as Record<string, Record<string, unknown>> | null;
          const n = Object.values(books || {}).filter((b) => b && b[f.id]).length;
          const q = n ? `${n}명이 ${f.name}을(를) 잡은 기록이 있습니다. 삭제하면 그 사람 도감에는 '사라진 ${label}'로 남습니다. 삭제할까요?` : `${f.name}을(를) 삭제할까요?`;
          if (!(await confirmModal(q))) return;
          await update(ref(db), { [`${base}/defs/${f.id}`]: null, [`${base}/best/${f.id}`]: null });
          adminLog(`${base}-def-delete`, f.id, f.name); toast('삭제했습니다.');
        };
        td.append(del);
      }
      tr.append(td); tb.append(tr);
    }
    t.append(tb); box.append(t);
  };
  unsubs.push(onValue(ref(db, `${base}/defs`), (s) => { dbDefs = s.val(); coll.set(coll.fromDb(dbDefs)); render(); }));
}

function collectionTab(main: HTMLElement, spec: CollSpec): void {
  const { base, coll, label } = spec;
  main.append(el('h3', { text: spec.title }));
  collDefsSection(main, spec);
  main.append(el('h4', { text: '기록 관리' }));
  const wk = weekKey();
  const resetWeek = el('button', { class: 'btn small danger', text: '이번 주 랭킹 초기화' });
  resetWeek.onclick = async () => { if (await confirmModal(`이번 주(${wk}) ${label} 랭킹을 지울까요? 도감(개인 기록)은 남습니다.`)) { await remove(ref(db, `${base}/week/${wk}`)); adminLog(`reset-${base}-week`, wk); toast('초기화했습니다.'); } };
  const resetAllWeeks = el('button', { class: 'btn small danger', text: '모든 주간 랭킹 삭제' });
  resetAllWeeks.onclick = async () => { if (await confirmModal('지난 주까지 모든 주간 랭킹을 지울까요?')) { await remove(ref(db, `${base}/week`)); adminLog(`reset-${base}-weeks`); toast('삭제했습니다.'); } };
  const resetBest = el('button', { class: 'btn small danger', text: '최고 기록 전체 삭제' });
  resetBest.onclick = async () => { if (await confirmModal('종류별 서버 최고 기록을 모두 지울까요?')) { await remove(ref(db, `${base}/best`)); adminLog(`reset-${base}-best`); toast('삭제했습니다.'); } };
  const clearFeed = el('button', { class: 'btn small', text: '공지 피드 비우기' });
  clearFeed.onclick = async () => { await remove(ref(db, `${base}/feed`)); adminLog(`clear-${base}-feed`); toast('비웠습니다.'); };
  const rankBox = el('div'), bestBox = el('div');
  main.append(el('div', { class: 'toolbar' }, [resetWeek, resetAllWeeks, resetBest, clearFeed]), el('h4', { text: `이번 주 랭킹 (${wk} 주, 월요일 시작)` }), rankBox, el('h4', { text: '종류별 최고 기록' }), bestBox);
  unsubs.push(onValue(ref(db, `${base}/week/${wk}`), (s) => {
    const rows = Object.entries((s.val() as Record<string, WeekEntry>) || {}).sort((a, b) => (b[1].p - a[1].p) || (b[1].c - a[1].c));
    rankBox.innerHTML = '';
    if (!rows.length) { rankBox.append(el('p', { class: 'muted', text: '아직 기록이 없습니다.' })); return; }
    const t = el('table');
    t.innerHTML = '<thead><tr><th>#</th><th>닉네임</th><th>점수</th><th>마릿수</th><th>마지막</th><th></th></tr></thead>';
    const tb = el('tbody');
    rows.forEach(([uid, r], i) => {
      const tr = el('tr');
      tr.append(el('td', { text: String(i + 1) }), el('td', { text: r.n }), el('td', { text: String(r.p) }), el('td', { text: String(r.c) }), el('td', { text: r.at ? fmtDateTime(r.at) : '-' }));
      const td = el('td');
      const b = el('button', { class: 'btn small', text: '삭제' });
      b.onclick = async () => { if (await confirmModal(`${r.n} 의 이번 주 기록을 지울까요?`)) { await remove(ref(db, `${base}/week/${wk}/${uid}`)); adminLog(`reset-${base}-user-week`, uid); } };
      td.append(b); tr.append(td); tb.append(tr);
    });
    t.append(tb); rankBox.append(t);
  }));
  unsubs.push(onValue(ref(db, `${base}/best`), (s) => {
    const best = (s.val() as Record<string, BestEntry>) || {};
    bestBox.innerHTML = '';
    const t = el('table');
    t.innerHTML = `<thead><tr><th>${label}</th><th>등급</th><th>기록</th><th>보유자</th><th>시각</th><th></th></tr></thead>`;
    const tb = el('tbody');
    for (const f of coll.list().filter((x) => !x.junk)) {
      const b = best[f.id];
      const tr = el('tr');
      tr.append(el('td', { text: `${f.icon} ${f.name}` }), el('td', { text: RARITY_NAME[f.rarity] }), el('td', { text: b ? spec.unit(b.s) : '-' }), el('td', { text: b ? b.n : '-' }), el('td', { text: b ? fmtDateTime(b.at) : '-' }));
      const td = el('td');
      if (b) { const d = el('button', { class: 'btn small', text: '삭제' }); d.onclick = async () => { await remove(ref(db, `${base}/best/${f.id}`)); adminLog(`reset-${base}-best`, f.id); }; td.append(d); }
      tr.append(td); tb.append(tr);
    }
    t.append(tb); bestBox.append(t);
  }));
}
function tabFish(main: HTMLElement): void { collectionTab(main, FISH_SPEC); }
function tabBugs(main: HTMLElement): void { collectionTab(main, BUG_SPEC); }

function tabBoard(main: HTMLElement): void {
  main.append(el('h3', { text: '게시판 관리' }));
  const box = el('div');
  const trim = el('button', { class: 'btn small', text: '보존 개수만 남기고 정리' });
  trim.onclick = async () => {
    const c = mergeConfig((await get(ref(db, 'config'))).val());
    const s = await get(query(ref(db, 'board/posts'), orderByKey()));
    const keys: string[] = []; s.forEach((x) => { keys.push(x.key!); });
    const del = keys.slice(0, Math.max(0, keys.length - c.boardRetention));
    const upd: Record<string, null> = {};
    for (const k of del) { upd[`board/posts/${k}`] = null; upd[`board/comments/${k}`] = null; }
    if (del.length) await update(ref(db), upd);
    toast(`${del.length}개 정리`);
  };
  main.append(el('div', { class: 'toolbar' }, [trim]), box);
  unsubs.push(onValue(query(ref(db, 'board/posts'), orderByKey(), limitToLast(200)), (s) => {
    const rows: { id: string; p: Post }[] = [];
    s.forEach((c) => { rows.push({ id: c.key!, p: c.val() as Post }); });
    box.innerHTML = '';
    const t = el('table');
    t.innerHTML = '<thead><tr><th>제목</th><th>작성자</th><th>작성일</th><th>댓글</th><th></th></tr></thead>';
    const tb = el('tbody');
    for (const r of rows.reverse()) {
      const tr = el('tr');
      tr.append(el('td', { text: (r.p.cat ? `[${catLabel(r.p.cat)}] ` : '') + r.p.title }), el('td', { text: r.p.n }), el('td', { text: fmtDateTime(r.p.ts) }), el('td', { text: String(r.p.cc || 0) }));
      const td = el('td');
      const v = el('button', { class: 'btn small', text: '보기' }); v.onclick = () => modal(r.p.title, el('div', { class: 'post-body', html: escapeHtml(r.p.body) }), [{ label: '닫기', onClick: () => {} }]);
      const d = el('button', { class: 'btn small danger', text: '삭제' }); d.onclick = async () => { if (await confirmModal('삭제할까요?')) { await update(ref(db), { [`board/posts/${r.id}`]: null, [`board/comments/${r.id}`]: null }); adminLog('delete-post', r.id, r.p.title); } };
      td.append(v, ' ', d); tr.append(td); tb.append(tr);
    }
    t.append(tb);
    box.append(t);
  }));
}

function tabConfig(main: HTMLElement): void {
  main.append(el('h3', { text: '서버 설정' }));
  const form = el('div', { class: 'form' });
  const f = (label: string, input: HTMLElement) => el('div', { class: 'field' }, [el('label', { text: label }), input]);
  const maxPlayers = el('input', { type: 'number', min: '1', max: '95' });
  const maint = el('select'); maint.innerHTML = '<option value="0">정상 운영</option><option value="1">점검 모드 (관리자만 입장)</option>';
  const maintMsg = el('input', { type: 'text' });
  const hoursSel = el('select'); hoursSel.innerHTML = '<option value="0">끔 (언제나 이용 가능)</option><option value="1">켬 (평일 09:00~18:00 차단)</option>';
  const ann = el('input', { type: 'text', placeholder: '공지 내용 (비우면 공지 없음)' });
  const strength = el('input', { type: 'number', min: '0', max: '5', step: '0.5' });
  const retChat = el('input', { type: 'number', min: '100' });
  const retConn = el('input', { type: 'number', min: '100' });
  const boardRet = el('input', { type: 'number', min: '10' });
  const casinoMax = el('input', { type: 'number', min: '100', step: '100' });
  const minVer = el('input', { type: 'number', min: '0' });
  const activeMap = el('select');
  const conOn = el('select'); conOn.innerHTML = '<option value="1">매주 진행</option><option value="0">끄기</option>';
  const conDay = el('select'); WEEKDAY_NAME.forEach((n, i) => conDay.append(el('option', { value: String(i), text: n + '요일' })));
  const conHour = el('input', { type: 'number', min: '0', max: '23' });
  const conMin = el('input', { type: 'number', min: '5', max: '720' });
  const priceInputs = new Map<string, HTMLInputElement>();
  const priceBox = el('div', { class: 'price-grid' });
  for (const it of ALL_ITEMS) { const inp = el('input', { type: 'number', min: '0' }); priceInputs.set(it.id, inp); priceBox.append(el('label', { text: `${it.icon} ${it.name}` }), inp); }
  form.append(f('최대 동시 접속자 (무료 플랜 연결 한도 100)', maxPlayers), f('운영 상태', maint), f('점검 안내 문구', maintMsg), f('평일 근무시간 이용 차단 (관리자 제외. 주말·공휴일은 종일 허용)', hoursSel), f('공지 (상단 배너)', ann),
    f('커피 내기 가중치 강도 (0=균등, 1=선형, 2=강하게)', strength), f('채팅 로그 보존 개수', retChat), f('입퇴장 로그 보존 개수', retConn), f('게시글 보존 개수', boardRet), f(`최소 클라이언트 버전 (지금 배포본은 ${CLIENT_VERSION}. 이보다 낮은 접속자는 자동으로 새로고침)`, minVer), f(`경마 한 번 최대 배팅 (100 단위, 기본 ${BET_MAX_DEFAULT}. 규칙이 서버에서 강제)`, casinoMax), f('활성 맵', activeMap), f('낚시 대회 (점수·코인 2배, 대회 한정 어종)', conOn), el('div', { class: 'row' }, [f('대회 요일', conDay), f('시작 시각 (시)', conHour), f('길이 (분)', conMin)]), f('상점 가격 (코인)', priceBox));
  const save = el('button', { class: 'btn primary', text: '저장' });
  const reduce = el('button', { class: 'btn', text: '🔻 사용량 절감 모드 적용' });
  const info = el('p', { class: 'muted', text: '사용량 절감 모드: 최대 접속 30명, 로그 보존 500개로 낮추고 로그/오래된 채팅을 즉시 정리합니다.' });
  main.append(form, el('div', { class: 'toolbar', style: 'margin-top:12px' }, [save, reduce]), info);
  let cfg: ServerConfig;
  const load = async () => {
    cfg = mergeConfig((await get(ref(db, 'config'))).val());
    maxPlayers.value = String(cfg.maxPlayers); maint.value = cfg.maintenance.on ? '1' : '0'; hoursSel.value = cfg.hoursBlock ? '1' : '0'; maintMsg.value = cfg.maintenance.message; ann.value = cfg.announcement?.text || '';
    strength.value = String(cfg.lossStrength); retChat.value = String(cfg.logRetention.chat); retConn.value = String(cfg.logRetention.conn); boardRet.value = String(cfg.boardRetention); casinoMax.value = String(cfg.casinoMax ?? BET_MAX_DEFAULT); minVer.value = String(cfg.minVersion ?? 0);
    const maps = (await get(ref(db, 'maps'))).val() as Record<string, { name?: string }> | null;
    activeMap.innerHTML = '<option value="default">기본 맵 (내장)</option>' + Object.entries(maps || {}).map(([id, m]) => `<option value="${id}">${escapeHtml(m.name || id)} (${id})</option>`).join('');
    activeMap.value = cfg.activeMap;
    for (const it of ALL_ITEMS) priceInputs.get(it.id)!.value = String(priceOf(it, cfg.prices));
    const cc = cfg.contest || DEFAULT_CONTEST; conOn.value = cc.on ? '1' : '0'; conDay.value = String(cc.weekday); conHour.value = String(cc.hour); conMin.value = String(cc.minutes);
  };
  save.onclick = async () => {
    const annText = ann.value.trim();
    const next: ServerConfig = {
      maxPlayers: Number(maxPlayers.value) || 60,
      maintenance: { on: maint.value === '1', message: maintMsg.value },
      hoursBlock: hoursSel.value === '1',
      announcement: annText ? { text: annText, ts: annText === cfg.announcement?.text ? cfg.announcement!.ts : Date.now() } : null,
      activeMap: activeMap.value,
      lossStrength: Number(strength.value),
      logRetention: { chat: Number(retChat.value) || 2000, conn: Number(retConn.value) || 2000 },
      allCooldownSec: cfg.allCooldownSec, // 전체 채팅 채널이 없어져 더 쓰지 않음 (값만 유지)
      boardRetention: Number(boardRet.value) || 300,
      casinoMax: Math.max(100, Math.floor((Number(casinoMax.value) || BET_MAX_DEFAULT) / 100) * 100),
      minVersion: Math.max(0, Math.floor(Number(minVer.value) || 0)),
      prices: Object.fromEntries(ALL_ITEMS.map((it) => [it.id, Math.max(0, Math.floor(Number(priceInputs.get(it.id)!.value) || it.price))])),
      contest: { on: conOn.value === '1', weekday: Number(conDay.value) || 0, hour: Math.min(23, Math.max(0, Number(conHour.value) || 0)), minutes: Math.max(5, Number(conMin.value) || 60) },
    };
    await set(ref(db, 'config'), next);
    adminLog('config', undefined, JSON.stringify(next));
    toast('저장했습니다. 활성 맵 변경은 사용자가 다시 접속할 때 적용됩니다.');
    load();
  };
  reduce.onclick = async () => {
    if (!(await confirmModal('사용량 절감 모드를 적용할까요?'))) return;
    await update(ref(db, 'config'), { maxPlayers: 30, logRetention: { chat: 500, conn: 500 } });
    const a = await trimByKey('logs/chat', 500), b = await trimByKey('logs/conn', 500), c = await trimByKey('chat/public', 50);
    adminLog('reduce-usage', undefined, `${a}/${b}/${c}`);
    toast(`적용: 채팅로그 ${a}, 입퇴장 ${b}, 공개채팅 ${c}건 정리`);
    load();
  };
  load();
}

// ---------- 맵 편집기 ----------
function tabEditor(main: HTMLElement): void {
  main.append(el('h3', { text: '맵 편집기' }));
  const wrap = el('div', { id: 'editor' });
  const cwrap = el('div', { id: 'editor-canvas-wrap' });
  const canvas = document.createElement('canvas');
  cwrap.append(canvas);
  const tools = el('div', { id: 'editor-tools' });
  wrap.append(cwrap, tools);
  main.append(wrap);

  let map: MapData = buildDefaultMap();
  let layer: 'ground' | 'object' | 'spawn' | 'portal' = 'ground';
  let brush = 0;
  let zoom = 0.5;
  const ctx = canvas.getContext('2d')!;

  const drawAll = () => {
    canvas.width = Math.floor(map.w * TILE * zoom); canvas.height = Math.floor(map.h * TILE * zoom);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(zoom, 0, 0, zoom, 0, 0);
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) ctx.drawImage(groundTile(map.ground[y * map.w + x], (x * 7 + y * 13) % 3), x * TILE, y * TILE);
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const o = map.objects[y * map.w + x];
      if (!o) continue;
      const s = objectSprite(o);
      if (s) ctx.drawImage(s.cv, x * TILE, y * TILE - (s.h > TILE ? TILE : 0));
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let x = 0; x <= map.w; x++) { ctx.beginPath(); ctx.moveTo(x * TILE, 0); ctx.lineTo(x * TILE, map.h * TILE); ctx.stroke(); }
    for (let y = 0; y <= map.h; y++) { ctx.beginPath(); ctx.moveTo(0, y * TILE); ctx.lineTo(map.w * TILE, y * TILE); ctx.stroke(); }
    for (const z of map.zones) {
      if (z.kind === 'portal') {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2 / zoom; ctx.strokeRect(z.x * TILE, z.y * TILE, z.w * TILE, z.h * TILE);
        ctx.fillStyle = '#7dd3fc'; ctx.font = `bold ${12 / zoom}px sans-serif`;
        const dest = portalDests(z).map((d) => `${d.map}${d.spawn ? ` (${d.spawn.x},${d.spawn.y})` : ''}`).join(', ') || '?';
        ctx.fillText(`🌀 ${z.label || z.id} → ${dest}`, z.x * TILE + 2, z.y * TILE + 12 / zoom);
      } else {
        ctx.strokeStyle = z.kind === 'room' ? '#ffd84d' : z.kind === 'casino' ? '#ff8ad8' : z.kind === 'board' ? '#5fd3a0' : 'rgba(155,231,255,0.5)';
        ctx.lineWidth = 2 / zoom; ctx.strokeRect(z.x * TILE, z.y * TILE, z.w * TILE, z.h * TILE);
        ctx.fillStyle = '#fff'; ctx.font = `${14 / zoom}px sans-serif`; ctx.fillText(z.label || z.id, z.x * TILE + 2, z.y * TILE + 14 / zoom);
      }
    }
    ctx.fillStyle = '#ff6b6b'; ctx.beginPath(); ctx.arc(map.spawn.x * TILE + 16, map.spawn.y * TILE + 16, 8, 0, Math.PI * 2); ctx.fill();
  };

  const paint = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / (TILE * zoom)), y = Math.floor((e.clientY - r.top) / (TILE * zoom));
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) return;
    if (layer === 'spawn') { map.spawn = { x, y }; drawAll(); return; }
    if (layer === 'portal') {
      portalXIn.value = String(x); portalYIn.value = String(y);
      toast(`포탈 위치를 (${x}, ${y})로 지정했습니다.`);
      return;
    }
    const i = y * map.w + x;
    if (layer === 'ground') map.ground[i] = brush; else map.objects[i] = brush;
    drawAll();
  };
  let down = false;
  canvas.addEventListener('mousedown', (e) => { down = true; paint(e); });
  canvas.addEventListener('mousemove', (e) => { if (down) paint(e); });
  window.addEventListener('mouseup', () => { down = false; });

  // 도구 패널
  const layerSel = el('select'); layerSel.innerHTML = '<option value="ground">바닥 레이어</option><option value="object">오브젝트 레이어</option><option value="spawn">스폰 위치 지정</option><option value="portal">포탈 위치 지정 (클릭하여 좌표 입력)</option>';
  const palette = el('div', { class: 'palette' });
  const renderPalette = () => {
    palette.innerHTML = '';
    const ids = layer === 'ground' ? Object.values(G) : Object.values(O);
    for (const id of ids) {
      const b = el('button', { class: id === brush ? 'active' : '' });
      const cv = document.createElement('canvas'); cv.width = TILE; cv.height = TILE;
      if (layer === 'ground') cv.getContext('2d')!.drawImage(groundTile(id, 0), 0, 0);
      else { const s = objectSprite(id); if (s) cv.getContext('2d')!.drawImage(s.cv, 0, s.h > TILE ? -TILE : 0); }
      b.append(cv, el('span', { text: layer === 'ground' ? GROUND_NAMES[id] : OBJECT_NAMES[id] }));
      b.onclick = () => { brush = id; renderPalette(); };
      palette.append(b);
    }
  };
  layerSel.onchange = () => { layer = layerSel.value as typeof layer; brush = 0; renderPalette(); };
  const zoomSel = el('select'); zoomSel.innerHTML = '<option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option>';
  zoomSel.onchange = () => { zoom = Number(zoomSel.value); drawAll(); };
  const nameIn = el('input', { type: 'text', placeholder: '맵 이름' , value: map.name });
  const idIn = el('input', { type: 'text', placeholder: '저장 id (영문/숫자)', value: 'custom1' });
  const loadSel = el('select');
  const refreshLoad = async () => {
    const maps = (await get(ref(db, 'maps'))).val() as Record<string, { name?: string }> | null;
    loadSel.innerHTML = '<option value="default">기본 맵 (내장)</option><option value="portal-garden">포탈 정원 (내장)</option>' + Object.entries(maps || {}).map(([id, m]) => `<option value="${id}">${escapeHtml(m.name || id)} (${id})</option>`).join('');
  };
  const loadBtn = el('button', { class: 'btn small', text: '불러오기' });
  loadBtn.onclick = async () => {
    if (loadSel.value === 'default') { map = buildDefaultMap(); idIn.value = ''; }
    else if (loadSel.value === 'portal-garden') { map = buildPortalGarden(); idIn.value = ''; }
    else { const s = await get(ref(db, `maps/${loadSel.value}`)); map = sanitizeMap(s.val(), buildDefaultMap()); idIn.value = loadSel.value; }
    nameIn.value = map.name; zonesTa.value = JSON.stringify(map.zones, null, 1); updatePortalList(); drawAll();
  };
  const newBtn = el('button', { class: 'btn small', text: '빈 맵 (60x40)' });
  newBtn.onclick = () => { map = emptyMap('custom', '새 맵', 60, 40); idIn.value = ''; nameIn.value = map.name; zonesTa.value = JSON.stringify(map.zones, null, 1); updatePortalList(); drawAll(); };
  const zonesTa = el('textarea', { rows: '8', style: 'width:100%;font-family:Consolas,monospace;font-size:11px' });
  zonesTa.value = JSON.stringify(map.zones, null, 1);
  const applyZones = el('button', { class: 'btn small', text: '구역 JSON 적용' });
  applyZones.onclick = () => {
    try {
      const parsed = JSON.parse(zonesTa.value);
      if (!Array.isArray(parsed)) { toast('구역은 배열이어야 합니다.', true); return; }
      for (const z of parsed) {
        if (!validateZone(z)) {
          toast(`구역 '${z?.id || '?'}' (${z?.kind}) 형식이 올바르지 않습니다.`, true);
          return;
        }
      }
      map.zones = parsed;
      updatePortalList();
      drawAll();
      toast('적용했습니다.');
    } catch {
      toast('JSON 형식이 올바르지 않습니다.', true);
    }
  };

  // 포탈 저작 도구
  const portalIdIn = el('input', { type: 'text', placeholder: '포탈 ID', value: 'portal-1', style: 'width:110px' });
  const portalTargetMapIn = el('input', { type: 'text', placeholder: '목적지 맵 ID', value: MAIN_MAP_ID, style: 'width:120px' });
  const portalXIn = el('input', { type: 'number', placeholder: 'X', value: '10', style: 'width:50px' });
  const portalYIn = el('input', { type: 'number', placeholder: 'Y', value: '10', style: 'width:50px' });
  const portalWIn = el('input', { type: 'number', placeholder: 'W', value: '1', style: 'width:45px' });
  const portalHIn = el('input', { type: 'number', placeholder: 'H', value: '1', style: 'width:45px' });
  const portalTargetXIn = el('input', { type: 'number', placeholder: '도착X (선택)', style: 'width:80px' });
  const portalTargetYIn = el('input', { type: 'number', placeholder: '도착Y (선택)', style: 'width:80px' });
  const portalLabelIn = el('input', { type: 'text', placeholder: '표시 이름 (예: 신비한 정원)', value: '', style: 'width:140px' });

  const quickMainBtn = el('button', { class: 'btn small', text: '목적지: main', type: 'button' });
  quickMainBtn.onclick = () => { portalTargetMapIn.value = MAIN_MAP_ID; portalTargetXIn.value = ''; portalTargetYIn.value = ''; };
  const quickGardenBtn = el('button', { class: 'btn small', text: '목적지: portal-garden', type: 'button' });
  quickGardenBtn.onclick = () => { portalTargetMapIn.value = GARDEN_MAP_ID; };
  const quickMineBtn = el('button', { class: 'btn small', text: '목적지: gold-mine', type: 'button' });
  quickMineBtn.onclick = () => { portalTargetMapIn.value = GOLD_MINE_MAP_ID; portalTargetXIn.value = ''; portalTargetYIn.value = ''; };

  // 행선지 목록 (2026-11-11): 여러 곳을 넣으면 게임에서 F 를 눌렀을 때 고르는 창이 뜬다. 비워 두면 위 입력칸의 목적지 하나만 쓴다
  const portalDestNameIn = el('input', { type: 'text', placeholder: '행선지 이름 (선택)', style: 'width:120px' });
  const portalDestDescIn = el('input', { type: 'text', placeholder: '한 줄 설명 (선택)', style: 'width:170px' });
  let destDraft: PortalDest[] = [];
  const destBox = el('div', { style: 'margin-bottom:6px' });
  // 입력칸의 목적지 하나를 읽는다. 잘못됐으면 안내하고 null
  const readDest = (): PortalDest | null => {
    const mapId = portalTargetMapIn.value.trim();
    if (!isMapId(mapId)) { toast('목적지 맵 ID는 영문/숫자/기호(-_) 1~20자여야 합니다.', true); return null; }
    const txStr = portalTargetXIn.value.trim(), tyStr = portalTargetYIn.value.trim();
    const d: PortalDest = { map: mapId };
    if (txStr !== '' || tyStr !== '') {
      const tx = Number(txStr), ty = Number(tyStr);
      if (txStr === '' || tyStr === '' || !Number.isInteger(tx) || !Number.isInteger(ty)) { toast('도착 좌표는 유효한 정수여야 합니다.', true); return null; }
      d.spawn = { x: tx, y: ty };
    }
    if (portalDestNameIn.value.trim()) d.label = portalDestNameIn.value.trim();
    if (portalDestDescIn.value.trim()) d.desc = portalDestDescIn.value.trim();
    return d;
  };
  const renderDests = () => {
    destBox.innerHTML = '';
    if (!destDraft.length) { destBox.append(el('div', { class: 'muted', text: '행선지 목록이 비어 있음: 위 목적지 하나로 저장됩니다.' })); return; }
    destDraft.forEach((d, i) => {
      const rm = el('button', { class: 'btn small', text: '빼기', type: 'button' });
      rm.onclick = () => { destDraft.splice(i, 1); renderDests(); };
      destBox.append(el('div', { class: 'row', style: 'gap:6px;margin-bottom:2px' }, [
        el('span', { text: `${i + 1}. ${d.label ? d.label + ' · ' : ''}${d.map}${d.spawn ? ` (${d.spawn.x},${d.spawn.y})` : ''}${d.desc ? ' · ' + d.desc : ''}`, style: 'flex:1 1 auto;font-size:12px' }),
        rm,
      ]));
    });
  };
  const addDestBtn = el('button', { class: 'btn small', text: '행선지 목록에 추가', type: 'button' });
  addDestBtn.onclick = () => {
    const d = readDest();
    if (!d) return;
    if (destDraft.length >= PORTAL_MAX_DESTS) { toast(`행선지는 ${PORTAL_MAX_DESTS}개까지 넣을 수 있습니다.`, true); return; }
    if (destDraft.some((x) => x.map === d.map)) { toast('이미 목록에 있는 맵입니다.', true); return; }
    destDraft.push(d); renderDests();
  };

  const portalSel = el('select', { style: 'width:100%;margin-bottom:6px' });
  const updatePortalList = () => {
    portalSel.innerHTML = '<option value="">-- 포탈 선택 / 편집 --</option>' + map.zones.filter((z) => z.kind === 'portal').map((z) => `<option value="${escapeHtml(z.id)}">${escapeHtml(z.label || z.id)} → ${escapeHtml(portalDests(z).map((d) => d.map).join(', '))} (${z.x},${z.y})</option>`).join('');
  };
  portalSel.onchange = () => {
    const found = map.zones.find((z) => z.kind === 'portal' && z.id === portalSel.value);
    if (found) {
      const ds = portalDests(found);
      destDraft = ds.length > 1 || ds[0]?.label || ds[0]?.desc ? ds.map((d) => ({ ...d })) : [];
      renderDests();
      portalIdIn.value = found.id;
      portalTargetMapIn.value = ds[0]?.map || '';
      portalTargetXIn.value = ds[0]?.spawn ? String(ds[0].spawn.x) : '';
      portalTargetYIn.value = ds[0]?.spawn ? String(ds[0].spawn.y) : '';
      portalDestNameIn.value = ''; portalDestDescIn.value = '';
      portalXIn.value = String(found.x);
      portalYIn.value = String(found.y);
      portalWIn.value = String(found.w);
      portalHIn.value = String(found.h);
      portalLabelIn.value = found.label || '';
    }
  };

  const savePortalBtn = el('button', { class: 'btn primary small', text: '포탈 추가/수정' });
  savePortalBtn.onclick = () => {
    const pId = portalIdIn.value.trim();
    if (!pId) { toast('포탈 ID를 입력하세요.', true); return; }
    // 행선지: 목록이 있으면 그것을, 비어 있으면 입력칸의 목적지 하나를 쓴다
    let dests = destDraft;
    if (!dests.length) { const d = readDest(); if (!d) return; dests = [d]; }
    const x = Number(portalXIn.value), y = Number(portalYIn.value);
    const w = Number(portalWIn.value) || 1, h = Number(portalHIn.value) || 1;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= map.w || y >= map.h) {
      toast('포탈 좌표(X, Y)는 맵 범위 내의 정수여야 합니다.', true); return;
    }
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
      toast('포탈 크기(W, H)는 1 이상의 정수여야 합니다.', true); return;
    }
    // 행선지가 하나이고 이름·설명이 없으면 옛 형식(targetMap)으로, 그 밖에는 목록(targets)으로 저장한다
    const single = dests.length === 1 && !dests[0].label && !dests[0].desc ? dests[0] : null;
    const newZone: Zone = {
      id: pId,
      kind: 'portal',
      x, y, w, h,
      ...(portalLabelIn.value.trim() ? { label: portalLabelIn.value.trim() } : {}),
      ...(single ? { targetMap: single.map, ...(single.spawn ? { targetSpawn: single.spawn } : {}) } : { targets: dests.map((d) => ({ ...d })) }),
    };
    if (!validateZone(newZone)) {
      toast('포탈 데이터 검증에 실패했습니다.', true); return;
    }
    const idx = map.zones.findIndex((z) => z.id === pId);
    if (idx >= 0 && map.zones[idx].kind !== 'portal') {
      toast('다른 구역에서 사용 중인 ID입니다. 새 포탈 ID를 지정하세요.', true);
      return;
    }
    if (idx >= 0) map.zones[idx] = newZone;
    else map.zones.push(newZone);
    zonesTa.value = JSON.stringify(map.zones, null, 1);
    updatePortalList();
    drawAll();
    toast(`포탈 '${pId}'을(를) 적용했습니다.`);
  };

  const deletePortalBtn = el('button', { class: 'btn danger small', text: '선택 포탈 삭제' });
  deletePortalBtn.onclick = () => {
    const pId = portalIdIn.value.trim();
    const idx = map.zones.findIndex((z) => z.kind === 'portal' && z.id === pId);
    if (idx < 0) { toast('삭제할 포탈을 찾을 수 없습니다.', true); return; }
    map.zones.splice(idx, 1);
    zonesTa.value = JSON.stringify(map.zones, null, 1);
    updatePortalList();
    drawAll();
    toast(`포탈 '${pId}'을(를) 삭제했습니다.`);
  };

  const doSave = async (): Promise<boolean> => {
    const id = idIn.value.trim();
    if (!isMapId(id) || isReservedMapId(id)) { toast('저장 id 는 영문/숫자 1~20자이며 예약어(main, default, portal-garden, gold-mine)는 사용할 수 없습니다.', true); return false; }
    const data: MapData = { ...map, id, name: nameIn.value.trim() || id, version: (map.version || 0) + 1, updatedAt: Date.now() };
    await set(ref(db, `maps/${id}`), data);
    adminLog('save-map', id);
    toast(`'${id}' 로 저장했습니다. 설정 탭에서 활성 맵으로 지정하면 다음 접속부터 적용됩니다.`);
    refreshLoad();
    return true;
  };
  const saveBtn = el('button', { class: 'btn primary small', text: '저장' });
  saveBtn.onclick = () => { doSave(); };
  const activateBtn = el('button', { class: 'btn small', text: '저장 후 활성화' });
  activateBtn.onclick = async () => { if (await doSave()) { await update(ref(db, 'config'), { activeMap: idIn.value.trim() }); toast('활성 맵으로 지정했습니다.'); } };
  const exportBtn = el('button', { class: 'btn small', text: 'JSON 복사' });
  exportBtn.onclick = () => { navigator.clipboard.writeText(JSON.stringify(map)); toast('클립보드에 복사했습니다.'); };
  const importBtn = el('button', { class: 'btn small', text: 'JSON 붙여넣기' });
  importBtn.onclick = async () => {
    const j = await promptModal('맵 JSON 가져오기', 'JSON', '', 100000);
    if (!j) return;
    try {
      const raw = JSON.parse(j);
      if (Array.isArray(raw?.zones) && raw.zones.some((z: unknown) => !validateZone(z))) {
        toast('형식이 올바르지 않은 구역이 있습니다. 기존 맵은 변경하지 않았습니다.', true);
        return;
      }
      map = sanitizeMap(raw, buildDefaultMap());
      idIn.value = '';
      nameIn.value = map.name;
      zonesTa.value = JSON.stringify(map.zones, null, 1);
      updatePortalList(); drawAll();
      toast('맵 데이터를 가져왔습니다. 새 저장 ID를 지정하세요.');
    } catch { toast('JSON 오류', true); }
  };
  tools.append(
    el('div', { class: 'field' }, [el('label', { text: '레이어' }), layerSel]),
    el('div', { class: 'field' }, [el('label', { text: '확대' }), zoomSel]),
    el('div', { class: 'muted', text: '클릭/드래그로 칠하기. 오브젝트 "지우기"로 삭제.' }),
    palette,
    el('div', { class: 'field', style: 'background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);border-radius:6px;padding:8px;margin-bottom:8px' }, [
      el('label', { text: '🌀 포탈 설정 도구', style: 'font-weight:bold;color:#38bdf8' }),
      portalSel,
      el('div', { class: 'row', style: 'gap:4px;margin-bottom:4px' }, [
        el('span', { text: 'ID: ', class: 'muted', style: 'line-height:26px' }), portalIdIn,
        el('span', { text: '표시명: ', class: 'muted', style: 'line-height:26px' }), portalLabelIn,
      ]),
      el('div', { class: 'row', style: 'gap:4px;margin-bottom:4px' }, [
        el('span', { text: '위치: ', class: 'muted', style: 'line-height:26px' }), portalXIn, portalYIn,
        el('span', { text: '크기: ', class: 'muted', style: 'line-height:26px' }), portalWIn, portalHIn,
      ]),
      el('div', { class: 'row', style: 'gap:4px;margin-bottom:4px' }, [
        el('span', { text: '목적지: ', class: 'muted', style: 'line-height:26px' }), portalTargetMapIn, quickMainBtn, quickGardenBtn, quickMineBtn,
      ]),
      el('div', { class: 'row', style: 'gap:4px;margin-bottom:6px' }, [
        el('span', { text: '도착스폰: ', class: 'muted', style: 'line-height:26px' }), portalTargetXIn, portalTargetYIn,
        el('span', { text: '(비우면 대상 기본 스폰)', class: 'muted', style: 'font-size:11px;line-height:26px' }),
      ]),
      el('div', { class: 'row', style: 'gap:4px;margin-bottom:4px' }, [
        el('span', { text: '여러 곳: ', class: 'muted', style: 'line-height:26px' }), portalDestNameIn, portalDestDescIn, addDestBtn,
      ]),
      destBox,
      el('div', { class: 'row', style: 'gap:6px' }, [savePortalBtn, deletePortalBtn]),
    ]),
    el('div', { class: 'field' }, [el('label', { text: '구역 (방: kind=room, cap, door, exit / 게시판: kind=board / 라벨: kind=label / 포탈: kind=portal)' }), zonesTa, applyZones]),
    el('div', { class: 'field' }, [el('label', { text: '불러오기' }), loadSel, el('div', { class: 'row' }, [loadBtn, newBtn])]),
    el('div', { class: 'field' }, [el('label', { text: '맵 이름' }), nameIn]),
    el('div', { class: 'field' }, [el('label', { text: '저장 id' }), idIn]),
    el('div', { class: 'row' }, [saveBtn, activateBtn]),
    el('div', { class: 'row', style: 'margin-top:6px' }, [exportBtn, importBtn]),
    el('p', { class: 'muted', text: '주의: 커피 방 구역은 내부 바닥 타일이 벽으로 막히지 않도록 하고, door/exit 타일이 걸을 수 있는지 확인하세요.' }),
  );
  renderPalette();
  refreshLoad();
  updatePortalList();
  renderDests();
  drawAll();
}

boot().catch((e) => { console.error(e); showMessageScreen(root, '오류', String(e)); });
