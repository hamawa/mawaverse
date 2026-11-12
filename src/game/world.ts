import { ref, get, onValue } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import { changeNick, changePassword, logout, idPathKey, withdraw } from '../firebase/auth';
import { hoursState, clientBlocked, WARN_MESSAGE } from '../shared/hours';
import { HOLIDAYS, BREAKS, BLOCK_MESSAGE } from '../shared/schedule';
import { TILE, STEP_MS, PUSH_COOLDOWN_MS, PUSH_STUN_MS, WATER_TURN_HOLD_MS, DEFAULT_CONFIG } from '../shared/config';
import type { Dir, UserProfile, ServerConfig, RoomState } from '../shared/types';
import { randomId, el, lerp } from '../shared/util';
import { Engine } from './engine';
import { Input } from './input';
import { Emitter } from './emitter';
import { render, poseForEmote, type Entity, type Bubble } from './render';
import { buildDefaultMap, buildPortalGarden, buildGoldMine, portalNear, portalDests, sanitizeMap, isWalkable, isWater, roomAt, roomSeat, findFreeTile, nearZone, type MapData, type Zone, type PortalDest } from './map';
import { MAIN_MAP_ID, GOLD_MINE_MAP_ID, playerMapId } from '../shared/maps';
import { mapSource, parseSavedMap, arrivalTile, savedMapId, portalBlock, portalYields, primaryOnlyRoom, destView, MAP_INFO, PRIMARY_ONLY_ROOM_MSG } from './portal';
import { openPortalPicker } from './portalui';
import { Net } from './net';
import { Chat } from './chat';
import { Rooms } from './rooms';
import { Hud, toast, catchNote, banner, contextMenu, modal, promptModal, confirmModal, avatarPicker, closeMenu, toggleKeyGuide, type MenuItem } from './ui';
import { CatchLog } from './catchlog';
import { Pets } from './pets';
import { PetRide } from './petride';
import { CasinoMgr } from './casino';
import { CasinoPanel } from './casinoui';
import { MafiaMgr } from './mafia';
import { MafiaHud, openMafiaLobby } from './mafiaui';
import { openBoard } from './boardui';
import { openFishBook, fishSummaryOf } from './fishui';
import { WalletMgr } from './wallet';
import { ContestMgr } from './contest';
import { BugHunt } from './bugs';
import { TossMgr } from './toss';
import { openMole } from './moleui';
import { DigMgr } from './dig';
import { MineMgr } from './mine';
import { fmtGold } from '../shared/mine';
import { openDigMap } from './digui';
import { fmtLeft } from '../shared/contest';
import { openShop } from './shopui';
import { fmtCoins, PUSH_COOLDOWN_BY_TIER, pushTierOf, itemById, petLevel, petRiding, petGuard, guardedOf, guardBrokenOf, assignBats, GUARD_BREAK_MS } from '../shared/shop';
import { TASK_FOOTPRINT } from '../shared/mafia';
import { dirVec, frontTiles } from './area';
import { openRoulette, watchRouletteFeed } from './rouletteui';
import { Fishing } from './fishing';
import type { WorldCtx, WorldEvents, RemotePlayer, LocalPlayer } from './state';

export async function loadActiveMap(): Promise<MapData> {
  const fallback = buildDefaultMap();
  try {
    const cfg = (await get(ref(db, 'config/activeMap'))).val() as string | null;
    const id = cfg || 'default';
    // 맵은 42KB 라 접속할 때마다 받으면 아깝다: 수정 시각(updatedAt)만 먼저 읽고, 브라우저에 둔 사본과 같으면 그걸 쓴다 (2026-11-10).
    // 관리자 맵 편집기는 저장할 때 updatedAt 을 올린다. admin SDK 로 맵을 고칠 때도 꼭 같이 올릴 것 (안 올리면 사본을 가진 사람에게 반영되지 않는다)
    const cacheKey = `mv-map-${id}`;
    const stamp = (await get(ref(db, `maps/${id}/updatedAt`))).val() as number | null;
    if (typeof stamp === 'number') {
      try {
        const c = JSON.parse(localStorage.getItem(cacheKey) || 'null') as { at?: number; v?: unknown } | null;
        if (c && c.at === stamp && c.v) { const m = sanitizeMap(c.v as Parameters<typeof sanitizeMap>[0], fallback); if (m !== fallback) return m; }
      } catch { /* 사본이 깨졌으면 새로 받는다 */ }
    }
    const s = await get(ref(db, `maps/${id}`));
    if (s.exists()) {
      const raw = s.val();
      if (typeof raw?.updatedAt === 'number') { try { localStorage.setItem(cacheKey, JSON.stringify({ at: raw.updatedAt, v: raw })); } catch { /* 저장 공간이 없으면 캐시 없이 */ } }
      return sanitizeMap(raw, fallback);
    }
  } catch (e) { console.warn('map load failed, using default', e); }
  return fallback;
}

// 포탈 목적지 맵: main 은 위의 활성 맵, 포탈 정원은 코드에 든 맵, 그 밖의 id 는 저장된 maps/{id} 를 엄격하게 (없거나 깨졌으면 오류. 기본 맵으로 바꿔치지 않는다).
// 저장된 맵도 활성 맵과 같은 updatedAt 사본(localStorage)을 쓴다
async function loadSavedMap(id: string): Promise<MapData> {
  const cacheKey = `mv-map-${id}`;
  const stamp = (await get(ref(db, `maps/${id}/updatedAt`))).val() as number | null;
  if (typeof stamp === 'number') {
    try {
      const c = JSON.parse(localStorage.getItem(cacheKey) || 'null') as { at?: number; v?: unknown } | null;
      if (c && c.at === stamp && c.v) return parseSavedMap(c.v, id);
    } catch { /* 사본이 깨졌으면 새로 받는다 */ }
  }
  const raw = (await get(ref(db, `maps/${id}`))).val();
  const m = parseSavedMap(raw, id);
  if (typeof raw?.updatedAt === 'number') { try { localStorage.setItem(cacheKey, JSON.stringify({ at: raw.updatedAt, v: raw })); } catch { /* 저장 공간이 없으면 캐시 없이 */ } }
  return m;
}

export class World implements WorldCtx {
  sessionId = randomId(16);
  map: MapData = buildDefaultMap();
  mapId = MAIN_MAP_ID;
  mainMap: MapData = this.map;
  switching = false; // 포탈로 맵을 옮기는 중 (이동·밀림·순간이동·낚시·행동·채팅을 막는다)
  onMyMap(st: { m?: string | null }): boolean { return playerMapId(st) === this.mapId; }
  config: ServerConfig = DEFAULT_CONFIG;
  players = new Map<string, RemotePlayer>();
  me: LocalPlayer;
  rooms: Record<string, RoomState> = {};
  engine!: Engine;
  input = new Input();
  events = new Emitter<WorldEvents>();
  joinedAt = 0;
  online = false;
  net = new Net(this);
  chat = new Chat(this);
  roomMgr = new Rooms(this);
  fishing = new Fishing(this, this.net);
  wallet = new WalletMgr(this);
  contest = new ContestMgr(this);
  bugs = new BugHunt(this, this.net, { swing: () => this.doEmote(11), petHop: () => this.pets.hop(this.uid, performance.now()), calm: () => this.petRide.calm(), petXp: () => this.petRide.xp() });
  pets = new Pets();
  petRide = new PetRide(this, this.net);
  casino = new CasinoMgr(this);
  casinoPanel = new CasinoPanel(this); // config 가 바뀌어도 보도록 월드 자체를 넘긴다 (uid·wallet·config·casino·toast)
  mafia = new MafiaMgr(this);
  mafiaHud = new MafiaHud(this); // uid·nick(getter)·mafia·toast
  toss = new TossMgr(this, this.net, { cancelFishing: () => this.fishing.cancel() });
  dig = new DigMgr(this, this.net);
  mine = new MineMgr(this, this.net);
  private lastCoinTick = 0;
  private lastMafiaHud = 0;
  private rouletteUnsub: (() => void) | null = null;
  private lastCoinText = '';
  hud!: Hud;
  private stopped = false;
  private lastTickAt = 0;   // 마지막으로 화면을 갱신한 시각 (뒤쪽 탭에서는 멈춘다)
  private waterHoldUntil = 0; // 물가에서 물 쪽으로 돌아선 직후에는 이 시각(performance.now)까지 물로 안 들어간다 (바라보기만)
  private reloading = false;
  private lastHint: string | null = null;
  private boardZone: Zone | undefined;
  private fishZone: Zone | undefined;
  private arcadeZone: Zone | undefined;

  constructor(private root: HTMLElement, public uid: string, public profile: UserProfile, public isAdmin: boolean) {
    this.me = { x: 0, y: 0, fromX: 0, fromY: 0, dispX: 0, dispY: 0, moveStart: 0, moveDur: STEP_MS, moving: false, dir: 0, pose: 'none', poseAt: 0, emoteId: 0, bubble: null, pushAt: -1, pushDir: 0, hitAt: -1e9, blockAt: -1e9, pushMore: null, stunUntil: 0, lastPushAt: -1e9, locked: false, roomId: null };
    this.catchLog = new CatchLog(uid);
  }

  toast(msg: string, err = false): void { toast(msg, err); }
  catchLog: CatchLog;
  get nick(): string { return this.profile.nick; }
  catchNote(kind: 'fish' | 'bug' | 'etc', text: string): void { catchNote(text); this.catchLog.add(kind, text); }
  note(text: string): void { catchNote(text); } // 한 줄 알림만 (기록 없음): 말랑이 결과 등
  banner(title: string, sub = ''): void { banner(title, sub); }

  async start(): Promise<void> {
    this.root.innerHTML = '';
    const gameDiv = el('div', { id: 'game' });
    const canvas = document.createElement('canvas');
    gameDiv.append(canvas);
    this.root.append(gameDiv);
    this.engine = new Engine(canvas);
    this.mainMap = await loadActiveMap();
    // 빠따에 맞아 방어가 깨진 채로 새로고침했으면 남은 시간만큼 이어진다
    try { const gb = Number(localStorage.getItem(`mv-gb-${this.uid}`)) || 0; if (gb > serverNow()) this.guardUntil = gb; } catch { /* ignore */ }
    // 마지막에 있던 맵으로 돌아간다. 그 맵을 못 읽으면 기본 맵의 시작 지점
    const lp0 = this.profile.lastPos;
    let mapId = savedMapId(lp0), map = this.mainMap;
    if (mapId !== MAIN_MAP_ID) { try { map = await this.loadMap(mapId); } catch (e) { console.warn('last map load failed', e); mapId = MAIN_MAP_ID; } }
    this.mapId = mapId;
    this.setMap(map);
    const lastHere = lp0 && savedMapId(lp0) === mapId ? lp0 : null;

    // 스폰 위치: 마지막 위치 → 기본 스폰. 같은 맵의 다른 사람과 겹치지 않게
    const snap = await get(ref(db, 'players'));
    const occupied = new Set<string>();
    if (snap.exists()) for (const [uid, st] of Object.entries(snap.val() as Record<string, { x: number; y: number; m?: string }>)) if (uid !== this.uid && st && this.onMyMap(st)) occupied.add(`${st.x},${st.y}`);
    const want = lastHere && isWalkable(this.map, lastHere.x, lastHere.y) && !roomAt(this.map, lastHere.x, lastHere.y) ? lastHere : this.map.spawn;
    const spawn = findFreeTile(this.map, want.x, want.y, (x, y) => occupied.has(`${x},${y}`), true);
    // 마지막 자리로 돌아왔으면 바라보던 방향도 되살린다 (자동 새로고침 뒤에도 자동 낚시가 이어지게)
    const lp = lastHere;
    const dir: Dir = lp && lp.x === spawn.x && lp.y === spawn.y && (lp.d === 1 || lp.d === 2 || lp.d === 3) ? lp.d : 0;
    Object.assign(this.me, { x: spawn.x, y: spawn.y, fromX: spawn.x, fromY: spawn.y, dispX: spawn.x, dispY: spawn.y, dir });

    await this.net.join(spawn.x, spawn.y, dir);
    this.joinedAt = serverNow();
    this.online = true;
    this.chat.start();
    this.roomMgr.start();
    this.fishing.start();

    this.hud = new Hud(this.root, {
      sendChat: (t) => this.chat.send(t),
      chatPrefill: () => this.chat.stickyPrefix(),
      openMyMenu: (x, y) => this.openMyMenu(x, y),
      openPlayerMenu: (uid, x, y) => this.openPlayerMenu(uid, x, y),
      onlineList: () => [{ uid: this.uid, nick: this.profile.nick }, ...[...this.players.values()].map((p) => ({ uid: p.uid, nick: p.st.n }))],
      emote: (id) => this.doEmote(id),
      interact: () => this.interact(),
      openShop: () => this.openShop(),
      toss: () => this.throwToss(),
      input: this.input,
      myUid: this.uid,
    });
    this.wireEvents(canvas);
    this.wallet.listen(() => this.hud.setCoins(this.coinText()));
    this.wallet.listen(() => this.petRide.sync());
    this.wallet.start();
    // 그날 첫 접속이면 2초 뒤 룰렛 창. 지갑이 한 번 읽힌 뒤에 판단한다
    const offW = this.wallet.listen(() => { if (!this.wallet.loaded) return; offW(); if (!this.wallet.rouletteDoneToday()) window.setTimeout(() => { if (!this.stopped) this.openRoulette(); }, 2000); });
    this.rouletteUnsub = watchRouletteFeed(this);
    this.contest.start();
    this.bugs.start();
    this.dig.start();
    this.casino.start();
    this.mafia.start();
    this.chat.isGhost = () => this.mafia.isGhost(this.uid);
    // 리스너 등록 전에 들어온 초기 상태 반영
    this.hud.setOnline(this.players.size + 1);
    this.hud.setAnnouncement(this.config.announcement?.text || null, this.config.announcement?.ts || 0);
    this.chat.systemMessage(`${this.profile.nick} 님, MawaVerse에 오신 것을 환영합니다! Enter 로 채팅, F 로 상호작용, 물가에서 F 로 낚시, 풀밭 벌레 옆에서 F 로 채집, E 로 밀치기, R 로 끌기, T 로 앞사람에게 말랑이 던지기, 우클릭(모바일은 캐릭터 터치)으로 메뉴, 도움말 버튼이나 Space 로 키 가이드.`);
    this.checkPatchNote(false);
    this.engine.start((dt, now) => this.tick(dt, now));
    // 평일 근무시간 차단(관리자 설정으로 켰을 때): 차단이 시작되기 5분 전(08:55, 쉬는 시간이 끝나기 5분 전)에 안내하고 그 시각에 내보낸다 (관리자 제외). 그 5분 사이에 들어온 사람도 바로 안내를 본다
    // 차단 설정은 따로 구독한다: 이 칸은 누구나 읽을 수 있어서, 관리자가 차단을 켜는 순간에도 값이 확실히 온다 (config 전체는 차단되면 읽을 수 없다)
    if (!this.isAdmin) {
      this.hoursUnsub = onValue(ref(db, 'config/hoursBlock'), (s) => { this.hoursBlock = s.val() === true; this.checkHours(); }, () => {});
      this.hoursTimer = window.setInterval(() => this.checkHours(), 1000);
    }
  }

  // 새 패치 노트 알림 (2026-11-12): 게시판에 패치 노트가 올라오면 config/patchNote 에 그 글의 id·제목이 적힌다. 이 브라우저에서 아직 알리지 않은 글이면 채팅창에 한 줄.
  // live: 접속해 있는 동안 올라왔다 (새 버전이 막 배포됐을 테니 새로고침도 안내한다). 글 id(push 키)는 시간순이라 크기 비교로 새 글을 가린다
  private patchSeen: string | null = null;
  private checkPatchNote(live: boolean): void {
    const pn = this.config.patchNote;
    if (!pn || typeof pn.id !== 'string' || typeof pn.t !== 'string') return;
    const key = `mv-patch-seen-${this.uid}`;
    if (this.patchSeen === null) { this.patchSeen = ''; try { this.patchSeen = localStorage.getItem(key) || ''; } catch { /* ignore */ } }
    if (pn.id <= this.patchSeen) return;
    this.patchSeen = pn.id;
    try { localStorage.setItem(key, pn.id); } catch { /* ignore */ }
    this.chat.systemMessage(`📢 새 패치 노트: ${pn.t} · 광장 게시판(F)의 '패치 노트' 탭에서 볼 수 있어요.${live ? ' 새로고침하면 새 버전이 적용됩니다.' : ''}`);
    if (live) this.toast('📢 새 패치 노트가 올라왔습니다. 새로고침하면 적용돼요.');
  }

  // 이용 시간 확인 (1초마다, 서버 시각 기준). 실제 차단은 보안 규칙이 하고, 여기는 안내와 퇴장 처리
  private hoursTimer = 0;
  private hoursWarned = false;
  private hoursBlock = false;                    // 관리자 설정 config/hoursBlock
  private hoursUnsub: (() => void) | null = null;
  private checkHours(): void {
    if (this.stopped) return;
    if (!this.hoursBlock) { this.hoursWarned = false; return; } // 관리자 설정에서 차단을 켰을 때만
    const now = serverNow();
    if (clientBlocked(now, HOLIDAYS, BREAKS)) { void this.forceLogout(BLOCK_MESSAGE); return; }
    if (hoursState(now, HOLIDAYS, BREAKS) !== 'warn') { this.hoursWarned = false; return; }
    if (this.hoursWarned) return;
    this.hoursWarned = true;
    this.banner(`⏰ ${WARN_MESSAGE}`, '평일 오전 9시~오후 6시에는 이용할 수 없어요.');
    this.chat.systemMessage(`⏰ ${WARN_MESSAGE}.`);
  }

  private wireEvents(canvas: HTMLCanvasElement): void {
    this.events.on('log', (e) => this.hud.appendLog(e));
    // 탭이 뒤로 가는 순간 걷던 중이었으면 화면 갱신이 멈춰 걸음이 안 끝난다: 잠시 뒤 마무리
    document.addEventListener('visibilitychange', () => { if (!this.stopped && document.visibilityState !== 'visible') window.setTimeout(() => this.settleIfStalled(), 400); });
    this.events.on('players', () => { const n = this.players.size + 1; this.hud.setOnline(n); this.net.recordPeak(n); });
    this.events.on('config', (c) => this.hud.setAnnouncement(c.announcement?.text || null, c.announcement?.ts || 0));
    this.events.on('config', () => this.checkPatchNote(true));
    this.events.on('profile', () => { this.checkGiftMark(); this.petRide.sync(); });
    this.events.on('rooms', () => this.updateHint());
    this.events.on('toss', (target, m) => { if (target === this.uid) this.toss.onHitMe(m); else this.toss.onRemote(target, m); });
    this.events.on('wave', (fx, fy, tx, ty) => this.toss.wave(fx, fy, tx, ty)); // 장풍이 나에게 날아오면 💨
    this.events.on('hook', (fx, fy, tx, ty) => this.toss.hook(fx, fy, tx, ty)); // 갈고리가 나에게 날아오면 ⚓
    this.events.on('ghost', (on) => { this.chat.watchGhostChat(on); if (on) this.toast('👻 유령이 되었습니다. 유령끼리만 보이고, 채팅도 유령끼리만 들립니다. 미션은 계속 할 수 있어요.'); });
    // 마피아 회의 중 채팅은 회의 판의 얼굴 옆 말풍선으로도 (2026-11-10)
    this.events.on('log', (e) => { if ((e.channel === 'near' || e.channel === 'g') && e.uid) this.mafiaHud.chat(e.uid, e.text); });
    this.input.onAction = (a) => {
      if (a === 'chat') { this.hud.focusChat(); return; }
      if (a === 'escape') { closeMenu(); this.hud.blurChat(); return; }
      if (a === 'interact') { this.interact(); return; }
      if (a === 'toss') { this.throwToss(); return; }
      if (a === 'help') { toggleKeyGuide(); return; }
      if (typeof a === 'object' && 'chatPrefix' in a) { this.hud.focusChat(a.chatPrefix); return; }
      if (typeof a === 'object' && 'emote' in a) this.doEmote(a.emote);
    };
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.onContext(e.clientX, e.clientY); });
    // 모바일: 다른 캐릭터를 짧게 톡 치면 그 사람 메뉴 (길게 누르면 브라우저가 contextmenu 를 보내 위와 같이 처리)
    let tap: { id: number; x: number; y: number; t: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      e.preventDefault(); // 호환용 mousedown 을 막아 방금 연 메뉴가 바로 닫히지 않게
      tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    });
    canvas.addEventListener('pointermove', (e) => { if (tap && tap.id === e.pointerId && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 12) tap = null; });
    canvas.addEventListener('pointerup', (e) => {
      if (!tap || tap.id !== e.pointerId) return;
      const t = tap; tap = null;
      if (performance.now() - t.t > 300) return;
      const uid = this.playerAtScreen(t.x, t.y);
      if (uid) this.openPlayerMenu(uid, t.x, t.y);
    });
    canvas.addEventListener('pointercancel', () => { tap = null; });
    // 탭 종료 시에는 아무것도 하지 않는다: 서버에 예약된 onDisconnect 가 presence 를 지운다.
    // (여기서 leave() 를 부르면 취소 요청만 전달되고 삭제는 유실되어 유령 캐릭터가 남는다)
  }

  // ---------- 매 프레임 ----------
  private tick(_dt: number, now: number): void {
    if (this.stopped) return;
    this.lastTickAt = performance.now();
    // 행선지 창이 떠 있는데 밀려나거나 끌려갔으면 닫는다
    if (this.portalPick && (this.me.moving || this.me.x !== this.portalPick.x || this.me.y !== this.portalPick.y)) this.portalPick.close();
    const me = this.me;
    if (me.moving) {
      const t = Math.min(1, (now - me.moveStart) / me.moveDur);
      me.dispX = lerp(me.fromX, me.x, t); me.dispY = lerp(me.fromY, me.y, t);
      if (t >= 1) { me.moving = false; me.dispX = me.x; me.dispY = me.y; this.afterStep(); }
    }
    if (!me.moving && !me.locked && !this.switching && now >= me.stunUntil && !this.mafia.frozen()) {
      const d = this.input.heldDir();
      if (d !== null) {
        this.fishing.cancel(); // 이동하면 낚시 취소 (자동 낚시 사이에 띄워 둔 찌도 거둔다)
        const nx = me.x + (d === 2 ? 1 : d === 1 ? -1 : 0), ny = me.y + (d === 0 ? 1 : d === 3 ? -1 : 0);
        // 물가에서 물 쪽으로 방향을 바꾸는 순간은 돌아서기만 한다 (2026-11-09: 옆을 보다가 물을 보려다 바로 빠지던 문제).
        // 같은 방향을 WATER_TURN_HOLD_MS 이상 계속 누르고 있어야 들어간다. 이미 물을 보고 있으면 지금처럼 바로 들어간다
        const toWater = !isWater(this.map, me.x, me.y) && isWater(this.map, nx, ny);
        let turnOnly = false, turned = false;
        if (me.dir !== d) {
          me.dir = d; turned = true;
          if (toWater) { this.waterHoldUntil = now + WATER_TURN_HOLD_MS; turnOnly = true; }
        }
        // 방향은 걸음에 같이 실려 간다. 걸음이 나가지 않을 때(돌아서기만 했거나 막혔을 때)만 방향을 따로 알린다.
        // 예전엔 방향을 먼저 쓰고 바로 걸음을 또 써서, 방향 쓰기의 98% 가 겹쳤다 (2026-11-10)
        if (!turnOnly && !(toWater && now < this.waterHoldUntil) && this.canStep(nx, ny)) void this.tryMove(nx, ny, turned);
        else if (turned) this.net.setDir(d);
      }
    }
    if (me.moving || (this.fishing.active && !this.input.enabled && !this.wallet.autoReelActive())) this.fishing.cancel(); // 밀려났거나 채팅창을 열면 취소 (자동 회수 중엔 채팅해도 유지)
    this.contest.tick(now);
    this.bugs.tick(now);
    this.dig.tick(now);
    this.mine.tick(now);
    this.casino.tick();
    this.syncCasinoPanel();
    this.mafia.tick(now);
    if (now - this.lastMafiaHud > 250) { this.lastMafiaHud = now; this.mafiaHud.update(); }
    if (now - this.lastCoinTick > 1000) { this.lastCoinTick = now; const t = this.coinText(); if (t !== this.lastCoinText) { this.lastCoinText = t; this.hud.setCoins(t); } }
    for (const rp of this.players.values()) {
      if (rp.moveStart) {
        const t = Math.min(1, (now - rp.moveStart) / rp.moveDur);
        rp.x = lerp(rp.fromX, rp.toX, t); rp.y = lerp(rp.fromY, rp.toY, t);
        if (t >= 1) { rp.moveStart = 0; rp.x = rp.toX; rp.y = rp.toY; }
      }
    }
    this.engine.follow(me.dispX * TILE + TILE / 2, me.dispY * TILE + TILE / 2, this.map.w, this.map.h);
    this.updateHint();
    render(this.engine, { map: this.map, entities: this.entities(now), rooms: this.rooms, now, serverNow: serverNow(), hint: this.canvasHint(), bugs: this.bugs.views(), tosses: this.toss.views(now), bodies: this.bodyViews(), marks: this.taskMarks() });
  }

  // 마피아 미션 자리 표시 (2026-11-10): 시민·유령은 내 미완료 미션(금색 테두리 + 화면 밖 화살표), 마피아는 모든 자리(흐린 테두리)
  private taskMarks(): import('./render').RenderState['marks'] {
    const m = this.mafia.marks();
    if (!m) return null;
    return { mine: m.mine, spots: m.spots.map((s) => { const fp = TASK_FOOTPRINT[s.def.obj] || [1, 1]; return { x: s.x, y: s.y, w: fp[0], h: fp[1], label: s.def.verb }; }) };
  }
  // 마피아 시체 (모두에게 보임)
  private bodyViews(): import('./render').BodyView[] {
    const g = this.mafia.game;
    if (!g || g.st === 'lobby' || !g.bodies || this.mapId !== MAIN_MAP_ID) return []; // 마피아는 기본 맵에서만
    return Object.entries(g.bodies).map(([uid, b]) => ({ uid, avatar: b.a, nick: b.n, x: b.x, y: b.y }));
  }
  private entities(now: number): Entity[] {
    const me = this.me;
    const iGhost = this.mafia.isGhost(this.uid);
    const list: Entity[] = [{
      uid: this.uid, nick: (iGhost ? '👻 ' : '') + (this.contest.isChampion(this.uid) ? '🏆 ' : '') + this.profile.nick + (this.guardBroken() ? ' 💥' : ''), avatar: this.profile.avatar, x: me.dispX, y: me.dispY, dir: me.dir, moving: me.moving,
      moveT: me.moving ? Math.min(1, (now - me.moveStart) / me.moveDur) : 0, pose: me.pose, poseAt: me.poseAt, emoteId: me.emoteId, bubble: me.bubble,
      isMe: true, pushAt: me.pushAt, pushDir: me.pushDir, hitAt: me.hitAt, blockAt: me.blockAt,
      fishing: this.fishing.view(), hat: this.profile.eq?.h || null, nameColor: this.profile.eq?.nc || null, fx: this.profile.eq?.fx || null,
      pet: this.pets.view(this.uid, this.myPet(), { x: me.x, y: me.y, fromX: me.fromX, fromY: me.fromY, moveStart: me.moveStart, moveDur: me.moveDur, moving: me.moving, dir: me.dir }, now, this.petRide.xp(), !!this.profile.eq?.nr),
      ghost: iGhost, mining: this.mine.active,
    }];
    const sNow = serverNow(); // 방어가 깨진 사람은 이름 옆에 💥
    for (const rp of this.players.values()) {
      if (!this.onMyMap(rp.st)) continue; // 다른 맵에 있는 사람은 그리지 않는다
      // 마피아 유령은 유령에게만 보인다 (산 사람·비참가자 화면에는 아예 안 그린다)
      const ghost = this.mafia.isGhost(rp.uid);
      if (ghost && !iGhost) continue;
      list.push({
        uid: rp.uid, nick: (ghost ? '👻 ' : '') + (this.contest.isChampion(rp.uid) ? '🏆 ' : '') + rp.st.n + (rp.st.z ? ' 💤' : '') + (guardBrokenOf(rp.st, sNow) ? ' 💥' : ''), avatar: rp.st.a, x: rp.x, y: rp.y, dir: rp.st.d ?? 0, moving: rp.moveStart > 0, moveT: rp.moveStart ? Math.min(1, (now - rp.moveStart) / rp.moveDur) : 0,
        pose: rp.pose, poseAt: rp.poseAt, emoteId: rp.emoteId, bubble: rp.bubble, isMe: false,
        pushAt: rp.pushAt, pushDir: rp.pushDir, hitAt: rp.hitAt, blockAt: rp.blockAt,
        fishing: rp.st.f ? { x: rp.st.f.x, y: rp.st.f.y, bite: false, since: rp.fishAt, auto: !!rp.st.f.a, rod: rp.st.f.r || 0, stars: rp.st.f.s || 0 } : null,
        hat: rp.st.h || null, nameColor: rp.st.nc || null, fx: rp.st.fx || null,
        pet: this.pets.view(rp.uid, rp.st.pt, { x: rp.toX, y: rp.toY, fromX: rp.prevX, fromY: rp.prevY, moveStart: rp.moveStart, moveDur: rp.moveDur, moving: rp.moveStart > 0, dir: rp.st.d ?? 0 }, now, rp.st.pl || 0, !!rp.st.nr),
        ghost, mining: !!rp.st.mn,
      });
    }
    return list;
  }
  // 내가 데리고 다니는 펫 (가진 것일 때만)
  private myPet(): string | null { const pt = this.profile.eq?.pt; return pt && this.profile.own?.[pt] ? pt : null; }

  // ---------- 이동 ----------
  occupied(x: number, y: number): boolean {
    for (const rp of this.players.values()) if (rp.toX === x && rp.toY === y && this.onMyMap(rp.st) && !this.mafia.passThrough(rp.uid)) return true;
    return false;
  }
  playerAt(x: number, y: number): RemotePlayer | null {
    for (const rp of this.players.values()) if (Math.round(rp.x) === x && Math.round(rp.y) === y && this.onMyMap(rp.st) && !this.mafia.passThrough(rp.uid)) return rp;
    return null;
  }
  passThrough(uid: string): boolean { return this.mafia.passThrough(uid); }
  // pushed: 밀치기·끌기로 움직이는 걸음. 밀려서는 방(카지노)에 들어가지 않는다: 들어가면 자리에 고정되고 모바일은 화면이 덮여, 문 앞에서 밀어 넣는 장난이 된다
  canStep(nx: number, ny: number, pushed = false): boolean {
    if (this.me.locked || this.switching) return false;
    // 카지노 안: 자리에 고정. 판의 나가기 버튼으로만 나간다 (2026-11-12).
    // 실제로 그 방 안에 서 있을 때만 막는다: 재접속 때 자리를 뺏겨 방 밖으로 옮겨진 경우(net.ts reclaim)에는 걸어서 빠져나올 수 있어야 한다 (첫 걸음의 afterStep 이 퇴장 처리)
    if (this.me.roomId && roomAt(this.map, this.me.x, this.me.y)?.id === this.me.roomId) return false;
    if (!isWalkable(this.map, nx, ny) || this.occupied(nx, ny)) return false;
    const cur = roomAt(this.map, this.me.x, this.me.y);
    const target = roomAt(this.map, nx, ny);
    if (target && target !== cur) {
      if (pushed) return false;
      if (primaryOnlyRoom(this.mapId, target)) return false; // 다른 맵의 카지노에는 못 들어간다
      const rs = this.rooms[target.id];
      if (rs && rs.state !== 'open') return false;
      if (rs && rs.members && Object.keys(rs.members).length >= (target.cap || 2)) return false;
    }
    return true;
  }
  private entering = false;
  private mapGen = 0; // 맵을 옮길 때마다 +1. 비동기 응답이 옮기기 전 맵 좌표로 이어 가지 않게 대조한다
  // turned: 이번에 방향도 바뀌었다. 걸음이 나가면 방향이 같이 가고, 못 나가면 방향만 따로 알린다
  private async tryMove(nx: number, ny: number, turned = false): Promise<void> {
    const faceOnly = () => { if (turned) this.net.setDir(this.me.dir); };
    if (this.entering) { faceOnly(); return; }
    const cur = roomAt(this.map, this.me.x, this.me.y);
    const target = roomAt(this.map, nx, ny);
    if (target && target !== cur) {
      this.entering = true;
      const gen = this.mapGen;
      const ok = await this.roomMgr.tryEnter(target).finally(() => { this.entering = false; });
      if (gen !== this.mapGen || this.switching) { if (ok) this.roomMgr.leave(target.id); return; } // 그 사이 맵이 바뀌었다
      if (!ok) { this.toast('방이 가득 찼거나 추첨 중입니다.', true); faceOnly(); return; }
      if (this.me.moving || this.me.locked) { this.roomMgr.leave(target.id); faceOnly(); return; }
      this.me.roomId = target.id;
      this.net.setRoom(target.id);
    }
    this.startStep(nx, ny);
  }
  startStep(nx: number, ny: number, pushedDir?: Dir, opts?: { dur?: number; onDone?: (ok: boolean) => void }): void {
    const me = this.me;
    const ox = me.x, oy = me.y;
    me.fromX = me.x; me.fromY = me.y; me.x = nx; me.y = ny; me.moveStart = performance.now(); me.moving = true;
    // Shift 를 누른 채 이동하면 2배 속도. 펫 탑승 중 걷기는 25% 빠름 (2026-11-10). 밀려난 경우는 보통 속도. 갈고리처럼 여러 칸이면 dur 로 받는다
    me.moveDur = opts?.dur ?? (pushedDir === undefined ? (this.input.running ? STEP_MS / 2 : this.petRide.walkMs()) : STEP_MS); // 펫 레벨마다 걷기 2.5% 빠름 (Lv10 128ms)
    this.net.step(nx, ny, me.dir, ox, oy).then((ok) => {
      if (!ok && me.x === nx && me.y === ny) {
        // 점유 실패: 되돌리기
        me.x = ox; me.y = oy; me.fromX = ox; me.fromY = oy; me.dispX = ox; me.dispY = oy; me.moving = false;
        const z = roomAt(this.map, ox, oy);
        if (me.roomId && (!z || z.id !== me.roomId)) { this.roomMgr.leave(me.roomId); me.roomId = null; this.net.setRoom(null); }
        this.net.setDir(me.dir); // 걸음에 실어 보낸 방향도 같이 거부됐으니 따로 알린다
      } else if (ok && me.moving && me.x === nx && me.y === ny && this.framesStalled()) this.finishMove(); // 뒤쪽 탭: 애니메이션 없이 바로 도착 처리
      opts?.onDone?.(ok);
    });
  }
  // 밀치기·끌기를 당했다: 도착(moveMs 뒤)하고 PUSH_STUN_MS 동안 못 움직인다. 😵 는 도착 시점부터 1초 (render 가 hitAt 이 미래여도 그때부터 그린다)
  stunAfter(moveMs: number): void {
    const now = performance.now();
    this.me.stunUntil = Math.max(this.me.stunUntil, now + moveMs + PUSH_STUN_MS);
    this.me.hitAt = now + moveMs;
  }
  // 펫 방어 (Lv8 이상): 밀치기·장풍·말랑이·끌기·갈고리를 갑옷처럼 막는다. 막은 보통 밀치기·말랑이는 80% 로 되받아친다 (net.ts, toss.ts)
  petGuard(): boolean { return this.petRide.guard(); }
  // ---- 빠따에 맞아 방어가 깨진 상태 (2026-11-11) ----
  // 풀리는 서버 시각. 새로고침으로 풀리지 않게 브라우저에도 적어 둔다 (start 에서 되살린다)
  guardUntil = 0;
  guardBroken(): boolean { return serverNow() < this.guardUntil; }
  breakGuard(byNick: string): void {
    this.guardUntil = serverNow() + GUARD_BREAK_MS;
    try { localStorage.setItem(`mv-gb-${this.uid}`, String(this.guardUntil)); } catch { /* ignore */ }
    this.net.setGuardBroken(this.guardUntil);
    this.toast(`🏏 ${byNick} 의 빠따에 방어가 깨졌다! ${GUARD_BREAK_MS / 1000}초 동안 갑옷·펫이 막아 주지 않는다.`, true);
    this.events.emit('log', { channel: 'sys', from: '', text: `🏏 ${byNick} 의 빠따에 방어가 깨졌다 (${GUARD_BREAK_MS / 1000}초)`, ts: serverNow() });
  }
  petReflect(): boolean { return this.petRide.rollReflect(); }
  // 순간이동 전 정리: 낚시 중이면 취소, 방에 있으면 나간다 (리스폰·관리자 이동 공용)
  leaveForTeleport(): void {
    const me = this.me;
    this.fishing.cancel();
    this.mine.cancel();
    if (me.roomId) { const left = me.roomId; me.roomId = null; this.seat = null; this.net.setRoom(null); this.roomMgr.leave(left); }
  }
  // 화면 갱신(rAF)이 멈춰 있나: 탭이 뒤에 있거나 창이 가려지거나 PC 가 잠겨 있으면 tick 이 돌지 않는다.
  // 그동안에도 밀치기는 통해야 하므로(자리 비운 자동 낚시꾼을 밀어낼 수 있게) 걸음을 애니메이션 없이 끝낸다 (2026-11-06)
  private framesStalled(): boolean { return document.visibilityState !== 'visible' || performance.now() - this.lastTickAt > 500; }
  private finishMove(): void {
    const me = this.me;
    me.moving = false; me.dispX = me.x; me.dispY = me.y;
    this.fishing.cancel(); // 밀려났으니 던져 둔 찌는 거둔다 (tick 이 돌 때와 같은 동작)
    this.afterStep();
  }
  settleIfStalled(): void {
    const me = this.me;
    if (me.moving && this.framesStalled() && performance.now() - me.moveStart >= me.moveDur) this.finishMove();
  }
  // 관리자가 config/minVersion 을 올렸다: 이 클라이언트는 옛 버전이므로 위치를 저장하고 새로고침한다 (로그인은 유지되어 같은 자리로 돌아온다)
  reloadForUpdate(min: number): void {
    if (this.reloading || this.stopped) return;
    let tried = 0;
    try { tried = Number(sessionStorage.getItem('mv-reload-for')) || 0; } catch { /* ignore */ }
    // 새로고침했는데도 옛 버전(캐시)이면 반복하지 않고 안내만 한다
    if (tried >= min) { this.toast('새 버전이 나왔습니다. Ctrl+F5 로 새로고침해 주세요.', true); return; }
    this.reloading = true;
    try { sessionStorage.setItem('mv-reload-for', String(min)); } catch { /* ignore */ }
    this.toast('새 버전이 나와 곧 새로고침합니다.');
    void this.net.savePos().then(() => window.setTimeout(() => location.reload(), 1500));
  }
  private afterStep(): void {
    const me = this.me;
    const z = roomAt(this.map, me.x, me.y);
    if (me.roomId && (!z || z.id !== me.roomId)) {
      const left = me.roomId;
      me.roomId = null; this.seat = null;
      this.net.setRoom(null);
      this.roomMgr.leave(left);
    } else if (z && !me.roomId) {
      // 등록 없이 방 안에 서 있게 된 경우(순간이동 등): 등록 시도, 실패하면 밖으로
      me.roomId = z.id;
      this.net.setRoom(z.id);
      const gen = this.mapGen;
      this.roomMgr.tryEnter(z).then((ok) => { if (gen !== this.mapGen) { if (ok) this.roomMgr.leave(z.id); return; } if (!ok) { const exit = z.exit || { x: z.x, y: z.y + z.h }; this.teleportTo(exit.x, exit.y); me.roomId = null; this.net.setRoom(null); } else void this.seatInRoom(z); });
    } else if (z && me.roomId === z.id) void this.seatInRoom(z); // 걸어서 들어왔다: 빈 자리에 앉힌다
    // 장풍에 밀렸으면 한 칸 더 (벽·사람·방 정원이면 거기서 멈춤)
    if (me.pushMore && !me.moving) {
      const pm = me.pushMore; me.pushMore = null;
      const nx = me.x + pm.dx, ny = me.y + pm.dy;
      if (this.canStep(nx, ny, true)) { me.pushAt = performance.now(); me.pushDir = pm.dir; this.startStep(nx, ny, pm.dir); }
    }
  }
  // ---- 카지노: 들어오면 빈 자리에 앉혀 고정한다 (2026-11-12, 사용자 요청) ----
  // 안에서는 걸어 다닐 수 없고(canStep), 밀치기·끌기·말랑이도 주고받지 않는다: 받는 쪽(net.ts·toss.ts)이 무시하고, 보내는 쪽은 상대의 st.r 을 보고 미리 건너뛴다.
  // 나갈 때는 경마 판의 나가기 버튼(leaveCasino). 리스폰·관리자 이동은 그대로 통한다(leaveForTeleport)
  private seat: { x: number; y: number } | null = null;
  private seating = false;
  private async seatInRoom(z: Zone): Promise<void> {
    const me = this.me;
    if (this.seat || this.seating) return;
    this.seating = true;
    try {
      const tried = new Set<string>();
      for (let i = 0; i < 6; i++) {
        if (me.roomId !== z.id || this.switching) return; // 그새 나갔다
        const t = roomSeat(this.map, z, (x, y) => this.occupied(x, y) || tried.has(`${x},${y}`));
        if (!t) break;
        tried.add(`${t.x},${t.y}`);
        const ox = me.x, oy = me.y;
        if (await this.net.step(t.x, t.y, 0, ox, oy)) {
          if (me.roomId !== z.id) return;
          me.dir = 0; me.x = t.x; me.y = t.y; me.fromX = t.x; me.fromY = t.y; me.dispX = t.x; me.dispY = t.y; me.moving = false;
          this.seat = t;
          return;
        }
      }
      // 앉을 자리를 못 잡았다(자리 정보가 어긋난 드문 경우): 문을 막고 서 있지 않게 내보낸다
      this.toast('카지노에 앉을 자리가 없어 밖으로 나왔습니다.', true);
      await this.leaveCasino();
    } finally { this.seating = false; }
  }
  private leavingRoom = false;
  // 경마 판의 나가기 버튼: 문 앞(차 있으면 가장 가까운 빈 칸)으로 나온다
  async leaveCasino(): Promise<void> {
    const me = this.me;
    const id = me.roomId;
    if (!id || this.leavingRoom || this.switching) return;
    this.leavingRoom = true;
    try {
      const z = this.roomMgr.zoneOf(id);
      const exit = z ? (z.exit || { x: z.x, y: z.y + z.h }) : this.map.spawn;
      const ox = me.x, oy = me.y;
      await this.teleportTo(exit.x, exit.y); // 방 안의 칸은 고르지 않는다 (findFreeTile avoidRooms)
      if (me.x === ox && me.y === oy) { this.toast('나갈 자리를 잡지 못했습니다. 잠시 후 다시 눌러 주세요.', true); return; }
      me.roomId = null; this.seat = null;
      this.net.setRoom(null);
      void this.roomMgr.leave(id);
    } finally { this.leavingRoom = false; }
  }
  // 순간이동: 점유 선점에 실패하면(동시 퇴장 등) 다른 빈 타일로 재시도
  async teleportTo(x: number, y: number): Promise<void> {
    const me = this.me;
    if (this.switching) return; // 맵을 옮기는 중: 옛 맵 좌표로 걸음을 보내지 않는다
    const tried = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const t = findFreeTile(this.map, x, y, (a, b) => this.occupied(a, b) || tried.has(`${a},${b}`), true);
      tried.add(`${t.x},${t.y}`);
      const ox = me.x, oy = me.y;
      if (await this.net.step(t.x, t.y, me.dir, ox, oy)) {
        me.x = t.x; me.y = t.y; me.fromX = t.x; me.fromY = t.y; me.dispX = t.x; me.dispY = t.y; me.moving = false;
        return;
      }
    }
  }

  // ---------- 포탈 (맵 이동) ----------
  private setMap(map: MapData): void {
    this.map = map;
    this.boardZone = map.zones.find((z) => z.kind === 'board');
    this.fishZone = map.zones.find((z) => z.kind === 'fish');
    this.arcadeZone = map.zones.find((z) => z.kind === 'arcade');
  }
  private builtinMaps = new Map<string, MapData>(); // 코드에 든 맵은 한 번 만들어 두고 다시 쓴다
  private async loadMap(id: string): Promise<MapData> {
    const src = mapSource(id);
    if (src === 'active') return this.mainMap;
    if (src === 'builtin') {
      let m = this.builtinMaps.get(id);
      if (!m) { m = id === GOLD_MINE_MAP_ID ? buildGoldMine() : buildPortalGarden(); this.builtinMaps.set(id, m); }
      return m;
    }
    if (src === 'saved') return loadSavedMap(id);
    throw new Error(`invalid map id ${String(id)}`);
  }
  // 지금 포탈을 못 타는 이유 (탈 수 있으면 null)
  private portalWhy(target: unknown): string | null {
    const me = this.me;
    return portalBlock({ from: this.mapId, target, switching: this.switching, entering: this.entering, locked: me.locked, moving: me.moving || this.net.stepping, mafia: !!this.mafia.game && this.mafia.isParticipant(this.uid) });
  }
  // F 로 포탈: 행선지가 하나면 바로 이동, 둘 이상이면 고르는 창. 못 타는 상태면 창을 열지 않고 안내만
  private portalPick: { close: () => void; x: number; y: number } | null = null;
  private openPortal(z: Zone): void {
    const dests = portalDests(z);
    if (dests.length <= 1) { void this.usePortal(dests[0] ?? { map: '' }); return; }
    if (this.portalPick) return;
    const me = this.me;
    const why = this.portalWhy(dests.find((d) => mapSource(d.map) && d.map !== this.mapId)?.map);
    if (why) { this.toast(why, true); return; }
    const count = (id: string) => { let n = 0; for (const rp of this.players.values()) if (playerMapId(rp.st) === id) n++; return n; };
    this.input.releaseAll(); this.input.enabled = false; // 창이 떠 있는 동안 방향키는 고르는 데 쓴다
    const pick = openPortalPicker(dests.map((d) => destView(d, this.mapId, count(d.map))), (i) => {
      // 고른 뒤에 한 번 더: 아직 그 포탈 옆에 서 있어야 한다 (이동 가능 여부는 usePortal 이 다시 본다)
      if (portalNear(this.map, me.x, me.y) !== z) { this.toast('포탈에서 멀어져 이동하지 않았습니다.', true); return; }
      void this.usePortal(dests[i]);
    }, () => { this.portalPick = null; this.input.enabled = true; });
    this.portalPick = { close: pick.close, x: me.x, y: me.y };
  }
  // 목적지 맵을 읽고, 빈 땅을 골라 자리·맵·위치를 쓰기 한 번에 옮긴다. 어느 단계든 실패하면 원래 맵·자리 그대로
  private async usePortal(dest: PortalDest): Promise<void> {
    const me = this.me;
    const why = this.portalWhy(dest.map);
    if (why) { this.toast(why, true); return; }
    const target = dest.map;
    this.switching = true;
    try {
      this.leaveForTeleport(); // 낚시는 active 와 상관없이 거두고(띄워 둔 자동 찌), 방·카지노는 나간다
      this.dig.cancel(); this.mafia.cancelTask();
      let map: MapData;
      try { map = await this.loadMap(target); } catch (e) { console.warn('portal map load failed', e); this.toast('갈 곳을 불러오지 못했습니다. 잠시 후 다시 시도하세요.', true); return; }
      const tried = new Set<string>();
      const taken = (x: number, y: number) => tried.has(`${x},${y}`) || [...this.players.values()].some((rp) => playerMapId(rp.st) === target && rp.toX === x && rp.toY === y);
      const want = dest.spawn ?? map.spawn;
      for (let i = 0; i < 4; i++) {
        if (this.stopped) return;
        const t = arrivalTile(map, want, taken);
        if (!t) { this.toast('도착할 빈 자리가 없습니다.', true); return; }
        tried.add(`${t.x},${t.y}`);
        if (me.moving || me.locked) { this.toast('멈춘 뒤에 다시 시도하세요.', true); return; }
        if (await this.net.changeMap(target, t.x, t.y, me.dir)) {
          if (this.stopped) return;
          this.enterMap(target, map, t.x, t.y);
          this.toast(`🌀 ${dest.label || MAP_INFO[target]?.name || map.name || '다른 곳'}(으)로 이동했습니다.`);
          return;
        }
      }
      this.toast('포탈로 이동하지 못했습니다. 잠시 후 다시 시도하세요.', true);
    } finally { this.switching = false; }
  }
  // 맵 이동이 서버에 반영됐다: 옛 맵에 묶인 화면 상태(벌레·말랑이·펫 자리·말풍선·장풍 예약)를 비우고 새 맵으로
  private enterMap(id: string, map: MapData, x: number, y: number): void {
    const me = this.me;
    this.mapGen++;
    this.mapId = id;
    this.setMap(map);
    Object.assign(me, { x, y, fromX: x, fromY: y, dispX: x, dispY: y, moving: false, pushMore: null, bubble: null, pose: 'none', emoteId: 0 });
    this.waterHoldUntil = 0;
    this.fishing.cancel(); // 맵을 읽는 사이 자동 낚시가 옛 맵 물에 다시 던졌을 수 있다
    this.bugs.clear(); this.toss.clear(); this.pets.forget(this.uid); this.mine.left();
    for (const rp of this.players.values()) rp.bubble = null;
    // lastHint 는 그대로 둔다: 여기서 비우면 화면의 '이동 중…' 안내와 어긋나, 도착한 칸에 안내가 없을 때 그 문구가 지워지지 않는다. 다음 프레임의 updateHint 가 새 맵 기준으로 맞춘다
    this.events.emit('players');
  }

  isTileVisible(x: number, y: number): boolean { return this.engine.isTileVisible(x, y, 0); }
  nickOf(uid: string): string {
    if (uid === this.uid) return this.profile.nick;
    return this.players.get(uid)?.st.n || '(오프라인)';
  }
  setBubble(uid: string, bubble: Bubble): void {
    if (uid === this.uid) this.me.bubble = bubble;
    else { const rp = this.players.get(uid); if (rp) rp.bubble = bubble; }
  }

  // ---------- 상호작용 ----------
  // F 로 할 수 있는 것과 그 안내 위치. 우선순위: 게시판 → 낚시 중 → 물가(낚시 시작) → 낚시 표지판
  private canvasHint(): { x: number; y: number; text: string; kind: 'board' | 'fishing' | 'cast' | 'sign' | 'bug' | 'arcade' | 'dig' | 'digging' | 'mafia' | 'portal' | 'mine' | 'mining' } | null {
    const me = this.me;
    if (me.roomId) return null;
    if (this.switching) return { x: me.x, y: me.y - 1, text: '🌀 이동 중…', kind: 'portal' };
    // 마피아 게임 중 참가자: 처치·미션·신고·소집이 F 를 우선 차지한다
    const ma = this.mafia.action();
    if (ma) {
      if (ma.kind === 'kill') return { x: me.x, y: me.y - 1, text: `F 처치: ${ma.nick}`, kind: 'mafia' };
      if (ma.kind === 'report') return { x: me.x, y: me.y - 1, text: `F 시체 신고 (${ma.nick})`, kind: 'mafia' };
      if (ma.kind === 'button') return { x: me.x, y: me.y - 1, text: 'F 긴급 소집 (1회)', kind: 'mafia' };
      return { x: ma.spot.x, y: ma.spot.y - 1, text: this.mafia.holding() ? `${ma.spot.def.verb} 중… 움직이지 마세요` : `F ${ma.spot.def.verb} (5초 버티기)`, kind: 'mafia' };
    }
    if (this.boardZone && nearZone(this.boardZone, me.x, me.y, 1)) return { x: this.boardZone.x + 1, y: this.boardZone.y - 1, text: 'F 게시판 보기', kind: 'board' };
    // 금광: 금덩어리를 보고 서 있으면 채광. 캐는 자리는 포탈 범위와 겹치지 않게 놓여 있다 (tests/maps.test.mjs)
    if (this.mine.active) return { x: me.x, y: me.y - 1, text: '⛏ 금을 캐는 중… (움직이면 허탕)', kind: 'mining' };
    if (this.mine.target()) return { x: me.x, y: me.y - 1, text: 'F 금 캐기', kind: 'mine' };
    const fv = this.fishing.view();
    const bug = this.bugs.targetView();
    // 포탈 옆이라도 하던 낚시·바로 옆 벌레·삽질·발밑 보물 자리가 먼저다 (2026-11-11: 포탈 옆에 잡힌 보물 자리를 팔 수 없던 문제). 그 일이 끝나면 다시 포탈 안내가 뜬다
    const yields = portalYields({ fishing: !!fv, autoFishing: !!fv?.auto, bug: !!bug, digging: this.dig.active, digSpot: !!this.dig.spotHere() });
    const portal = yields ? undefined : portalNear(this.map, me.x, me.y);
    if (portal) return { x: portal.x, y: portal.y - 1, text: `F 포탈 이동${portal.label ? `: ${portal.label}` : ''}`, kind: 'portal' };
    const room = this.map.zones.find((z) => primaryOnlyRoom(this.mapId, z) && nearZone(z, me.x, me.y, 1));
    if (room) return { x: room.x, y: room.y - 1, text: PRIMARY_ONLY_ROOM_MSG, kind: 'sign' };
    if (fv) { if (fv.auto) return null; return { x: fv.x, y: fv.y, text: fv.bite ? 'F 당겨!' : '찌를 기다리는 중… (이동하면 취소)', kind: 'fishing' }; } // 자동 낚시 중에는 안내를 띄우지 않는다 (2026-11-09, 사용자: 두 군데 뜨는 게 거슬림)
    if (bug) return { x: bug.x, y: bug.y, text: 'F 채집', kind: 'bug' };
    const t = this.fishing.targetTile();
    if (t) return { x: t.x, y: t.y, text: 'F 낚시', kind: 'cast' };
    if (this.fishZone && nearZone(this.fishZone, me.x, me.y, 1)) return { x: this.fishZone.x, y: this.fishZone.y - 1, text: 'F 낚시 기록 보기', kind: 'sign' };
    if (this.arcadeZone && nearZone(this.arcadeZone, me.x, me.y, 1)) return { x: this.arcadeZone.x, y: this.arcadeZone.y - 1, text: 'F 두더지 잡기', kind: 'arcade' };
    if (this.dig.active) return { x: me.x, y: me.y, text: '삽질 중… (이동하면 취소)', kind: 'digging' };
    const spot = this.dig.spotHere();
    if (spot) return { x: spot.x, y: spot.y, text: 'F 땅 파기', kind: 'dig' };
    return null;
  }
  private updateHint(): void {
    let hint: string | null = null;
    const me = this.me;
    if (me.roomId) {
      const rs = this.rooms[me.roomId];
      const z = this.roomMgr.zoneOf(me.roomId);
      const n = rs?.members ? Object.keys(rs.members).length : 1;
      hint = this.hud.mobile ? null : `🎰 카지노 ${n}/${z?.cap || '?'} · 오른쪽 판에서 배팅 · 나가려면 판의 나가기 (F 로 판 열기/닫기)`; // 모바일은 경마 판이 화면을 덮는다
    } else { const ch = this.canvasHint(); if (ch) hint = ch.text; }
    if (hint !== this.lastHint) { this.lastHint = hint; this.hud.setHint(hint); }
  }
  // 카지노 방 안에 있는 동안 경마 판을 띄운다 (나가면 닫힘). F 로 잠깐 닫을 수 있다
  private casinoHidden = false;
  private syncCasinoPanel(): void {
    const inCasino = !!this.me.roomId; // 방은 카지노뿐이다
    if (inCasino && !this.casinoHidden && !this.casinoPanel.open) this.casinoPanel.show();
    else if ((!inCasino || this.casinoHidden) && this.casinoPanel.open) this.casinoPanel.hide();
    if (!inCasino) this.casinoHidden = false;
  }
  interact(): void {
    if (this.switching) return; // 목적지를 읽는 동안 옛 맵에서 낚시·채집·삽질 등을 시작하지 않는다
    if (this.me.roomId) { this.casinoHidden = !this.casinoHidden; this.syncCasinoPanel(); return; }
    const ch = this.canvasHint();
    if (!ch) return;
    if (ch.kind === 'mafia') { void this.mafiaInteract(); return; }
    if (ch.kind === 'portal') { const z = portalNear(this.map, this.me.x, this.me.y); if (z) this.openPortal(z); return; }
    if (ch.kind === 'board') { this.input.releaseAll(); openBoard({ uid: this.uid, nick: this.profile.nick, isAdmin: this.isAdmin }); }
    else if (ch.kind === 'fishing') this.fishing.reel();
    else if (ch.kind === 'cast') this.fishing.cast();
    else if (ch.kind === 'bug') { if (this.bugs.swing()) this.doEmote(11); } // 잠자리채 휘두르기 (남들에게도 보임)
    else if (ch.kind === 'dig') { if (this.dig.begin()) this.doEmote(13); }
    else if (ch.kind === 'mine') { if (!this.input.interactRepeat) this.mine.begin(); } // 키를 누르고 있어 반복된 F 로는 치지 않는다 (한 번 누르면 한 번)
    else if (ch.kind === 'arcade') { this.input.releaseAll(); openMole({ uid: this.uid, nick: this.profile.nick, wallet: this.wallet, input: this.input, toast: (m, e) => this.toast(m, e), stat: (k) => this.net.stat(k) }); }
    else if (ch.kind === 'sign') { this.input.releaseAll(); this.openFishBook(); }
  }
  // 마피아 F: 처치 / 미션 시작(누르고 있는 동안 tick 이 진행) / 신고 / 긴급 소집
  private async mafiaInteract(): Promise<void> {
    const a = this.mafia.action(); if (!a) return;
    if (a.kind === 'kill') { if (await this.mafia.kill(a.uid)) { this.doEmote(10); this.toast(`🔪 ${a.nick} 처치`); } }
    else if (a.kind === 'task') this.mafia.beginTask(a.spot, a.fake);
    else if (a.kind === 'report') { if (await this.mafia.report(a.uid)) this.toast('🩸 시체를 신고했습니다! 회의가 열립니다.'); }
    else if (a.kind === 'button') { if (await confirmModal('긴급 소집을 할까요? 한 게임에 한 번만 쓸 수 있어요.')) { if (await this.mafia.callMeeting()) this.toast('🚨 긴급 소집!'); } }
  }
  doEmote(id: number): void {
    if (this.switching) return; // 맵을 옮기는 중에는 밀치기·끌기·이모트를 보내지 않는다
    const me = this.me;
    const now = performance.now();
    if ((id === 10 || id === 14) && me.roomId) { this.toast('🎰 카지노 안에서는 밀치기·끌기를 쓸 수 없습니다.', true); return; }
    if (id === 10) {
      const cd = PUSH_COOLDOWN_BY_TIER[pushTierOf(this.profile.own)] ?? PUSH_COOLDOWN_MS; // 상점 업그레이드로 단축
      if (now - me.lastPushAt < cd) { this.toast(`밀치기는 ${Math.ceil((cd - (now - me.lastPushAt)) / 1000)}초 후에 가능합니다.`, true); return; }
      const [dx, dy] = dirVec(me.dir);
      if (this.profile.own?.wave) {
        // 장풍(상점 장비): 앞 4칸 × 옆 4칸 안의 모두를 두 칸. 철벽 갑옷은 건너뛴다 (🛡 만)
        const all: RemotePlayer[] = [];
        for (const [x, y] of frontTiles(me.x, me.y, dx, dy)) { const rp = this.playerAt(x, y); if (rp && !rp.st.r && !all.includes(rp)) all.push(rp); } // st.r: 카지노 안에 앉아 있는 사람은 건드릴 수 없다
        if (!all.length) { this.toast('앞 4칸 안에 아무도 없습니다. 상대 쪽을 바라보고 쓰세요.', true); return; }
        // 방어 중인 사람에게는 빠따가 있으면 한 개씩 써서 깨고 민다. 빠따가 모자라면 그 사람은 막힌다 (🛡 만)
        const plan = assignBats(all.map((rp) => guardedOf(rp.st, 'push', serverNow())), this.wallet.batsReady());
        const targets = all.filter((rp, i) => { if (plan[i].blocked) { rp.blockAt = now; return false; } return true; }).map((rp) => ({ rp, bat: plan[all.indexOf(rp)].bat }));
        if (!targets.length) { this.toast('🛡 모두 방어 중이라 밀리지 않습니다. (상점의 빠따로 깰 수 있어요)', true); return; }
        me.lastPushAt = now;
        this.net.pushMany(targets.map((t) => ({ uid: t.rp.uid, bat: t.bat })), dx, dy);
        this.batNote(targets.filter((t) => t.bat).length);
        for (const t of targets) this.toss.wave(me.x, me.y, Math.round(t.rp.x), Math.round(t.rp.y));
      } else {
        const target = this.playerAt(me.x + dx, me.y + dy);
        if (!target) { this.toast('앞에 밀 사람이 없습니다. 상대를 바라보고 붙어서 사용하세요.', true); return; }
        if (target.st.r) { this.toast('🎰 카지노 안에 있는 사람은 건드릴 수 없습니다.', true); return; }
        // 철벽 갑옷을 입은 상대는 안 밀린다: 보내지 않고 🛡 만 (쿨타임도 안 씀)
        // 다만 빠따가 있으면 하나 써서 방어를 깨고 민다 (2026-11-11)
        const guarded = guardedOf(target.st, 'push', serverNow());
        const bat = guarded && this.wallet.batsReady() > 0;
        if (guarded && !bat) { target.blockAt = now; this.toast(`🛡 ${target.st.n} 은(는) ${target.st.pa ? '철벽 갑옷을 입고 있어' : '펫이 지켜 줘서'} 밀리지 않습니다. (상점의 빠따로 깰 수 있어요)`, true); return; }
        me.lastPushAt = now;
        this.net.push(target.uid, dx, dy, bat);
        this.batNote(bat ? 1 : 0);
      }
    }
    if (id === 14 && !this.pull(now)) return;
    me.pose = poseForEmote(id); me.poseAt = now; me.emoteId = id;
    this.net.emote(id);
  }
  // 빠따를 썼으면 한 줄 알림. 남은 개수는 지갑에 반영된 뒤에 읽는다
  batNote(used: number): void {
    if (used > 0) window.setTimeout(() => this.note(`🏏 빠따${used > 1 ? ` ${used}개` : ''}로 방어를 깼다! (남은 ${this.wallet.bats}개)`), 250);
  }
  // 끌기(R): 바로 앞사람을 내가 서 있던 칸으로 당기고 나는 한 칸 물러난다(뒤가 막혔으면 옆으로). 구석에 박힌 사람을 꺼내는 용도.
  // 앞에 아무도 없고 갈고리(상점 장비)가 있으면 앞 4칸 × 옆 4칸 안의 한 명을 무작위로 내 앞 칸까지 끌어온다.
  // 밀치기와 쿨타임을 같이 쓰고, 철벽 갑옷을 입은 사람은 못 끈다. 끌려온 사람은 잠깐 스턴 (받는 쪽 net.ts 가 처리)
  private pull(now: number): boolean {
    const me = this.me;
    if (me.locked || me.moving) return false;
    const cd = PUSH_COOLDOWN_BY_TIER[pushTierOf(this.profile.own)] ?? PUSH_COOLDOWN_MS;
    if (now - me.lastPushAt < cd) { this.toast(`끌기는 ${Math.ceil((cd - (now - me.lastPushAt)) / 1000)}초 후에 가능합니다.`, true); return false; }
    const [dx, dy] = dirVec(me.dir);
    const myRoom = roomAt(this.map, me.x, me.y);
    const front = this.playerAt(me.x + dx, me.y + dy);
    if (front) {
      if (front.st.r) { this.toast('🎰 카지노 안에 있는 사람은 건드릴 수 없습니다.', true); return false; }
      const guarded = guardedOf(front.st, 'push', serverNow());
      const bat = guarded && this.wallet.batsReady() > 0; // 빠따가 있으면 하나 써서 방어를 깨고 끈다
      if (guarded && !bat) { front.blockAt = now; this.toast(`🛡 ${front.st.n} 은(는) ${front.st.pa ? '철벽 갑옷을 입고 있어' : '펫이 지켜 줘서'} 끌리지 않습니다. (상점의 빠따로 깰 수 있어요)`, true); return false; }
      // 물러설 자리: 뒤 → 옆(두 방향). 방 안팎을 넘나들지는 않는다
      const back: [number, number][] = dx !== 0 ? [[me.x - dx, me.y], [me.x, me.y - 1], [me.x, me.y + 1]] : [[me.x, me.y - dy], [me.x - 1, me.y], [me.x + 1, me.y]];
      const spot = back.find(([x, y]) => this.canStep(x, y) && roomAt(this.map, x, y) === myRoom);
      if (!spot) { this.toast('물러설 자리가 없어 끌 수 없습니다.', true); return false; }
      me.lastPushAt = now;
      const ox = me.x, oy = me.y, uid = front.uid;
      // 내 걸음(점유 이동)이 서버에 반영된 뒤에 끌기를 보낸다: 상대가 내 옛 자리로 올 때 점유가 비어 있어야 한다
      this.startStep(spot[0], spot[1], undefined, { onDone: (ok) => { if (ok) { this.net.pull(uid, ox, oy, false, bat); this.batNote(bat ? 1 : 0); } } });
      return true;
    }
    if (!this.profile.own?.hook) { this.toast('앞에 끌 사람이 없습니다. 상대를 바라보고 붙어서 사용하세요. (갈고리가 있으면 앞 4칸 안에서 끌어옵니다)', true); return false; }
    const fx = me.x + dx, fy = me.y + dy;
    if (!this.canStep(fx, fy) || roomAt(this.map, fx, fy) !== myRoom) { this.toast('앞 칸이 막혀 있어 끌어올 수 없습니다.', true); return false; }
    const all: RemotePlayer[] = [];
    for (const [x, y] of frontTiles(me.x, me.y, dx, dy)) { const rp = this.playerAt(x, y); if (rp && !rp.st.r && !all.includes(rp)) all.push(rp); }
    if (!all.length) { this.toast('앞 4칸 안에 끌어올 사람이 없습니다. 상대 쪽을 바라보고 쓰세요.', true); return false; }
    // 방어 중인 사람은 빠따가 있을 때만 후보에 든다 (걸리면 빠따 하나를 써서 깨고 끌어온다)
    const hasBat = this.wallet.batsReady() > 0;
    const targets = all.filter((rp) => hasBat || !guardedOf(rp.st, 'push', serverNow()));
    if (!targets.length) { for (const rp of all) rp.blockAt = now; this.toast('🛡 모두 방어 중이라 끌리지 않습니다. (상점의 빠따로 깰 수 있어요)', true); return false; }
    const target = targets[Math.floor(Math.random() * targets.length)];
    const hookBat = guardedOf(target.st, 'push', serverNow());
    me.lastPushAt = now;
    this.net.pull(target.uid, fx, fy, true, hookBat);
    this.batNote(hookBat ? 1 : 0);
    this.toss.hook(me.x, me.y, Math.round(target.x), Math.round(target.y));
    return true;
  }

  // ---------- 메뉴 ----------
  private onContext(cx: number, cy: number): void {
    const rect = this.engine.canvas.getBoundingClientRect();
    const [tx, ty] = this.engine.screenToTile(cx - rect.left, cy - rect.top);
    const rp = this.playerAt(tx, ty);
    if (rp) this.openPlayerMenu(rp.uid, cx, cy);
    else if (tx === Math.round(this.me.dispX) && ty === Math.round(this.me.dispY)) this.openMyMenu(cx, cy);
  }
  // 화면 좌표 아래에 있는 다른 캐릭터 (모바일 톡 치기 메뉴)
  private playerAtScreen(cx: number, cy: number): string | null {
    const rect = this.engine.canvas.getBoundingClientRect();
    const [tx, ty] = this.engine.screenToTile(cx - rect.left, cy - rect.top);
    return this.playerAt(tx, ty)?.uid ?? null;
  }
  openPlayerMenu(uid: string, x: number, y: number): void {
    const nick = this.nickOf(uid);
    const items: MenuItem[] = [{ label: '💬 귓속말', onClick: () => this.hud.focusChat(`/w ${nick} `) }];
    items.push({ label: 'ℹ 프로필 보기', onClick: () => this.showProfile(uid) });
    // 관리자: 구석에 숨어 자리 비운 사람을 광장(시작 지점)으로 보낸다. 상대 클라이언트가 players/{uid}/tp 를 보고 순간이동한다
    // 지금은 같은 맵에 있는 사람만 (좌표가 내 맵 기준이고, 규칙도 같은 맵만 허용)
    const rp = this.players.get(uid);
    if (this.isAdmin && rp && this.onMyMap(rp.st)) items.push({ label: '🏠 광장으로 보내기 (관리자)', danger: true, onClick: async () => {
      if (!(await confirmModal(`${nick} 을(를) 광장으로 보낼까요?`))) return;
      try { await this.net.sendTo(uid, this.map.spawn.x, this.map.spawn.y); this.toast(`🏠 ${nick} 을(를) 광장으로 보냈습니다.`); } catch { this.toast('보내지 못했습니다.', true); }
    } });
    contextMenu(x, y, nick, items);
  }
  openMyMenu(x: number, y: number): void {
    const items: MenuItem[] = [
      { label: '✏ 닉네임 변경', onClick: () => this.changeNickFlow() },
      { label: '🎨 외모 변경', onClick: () => this.changeAvatarFlow() },
      { label: '📖 도감 · 내 기록', onClick: () => this.openFishBook() },
      { label: '🛍 상점', onClick: () => this.openShop() },
      // 만렙 펫: 타고 다닐지 내려서 데리고 다닐지 (2026-11-12 건의 반영). 모습만 바뀌고 펫 효과는 같다
      ...(this.petRide.canRide() ? [{ label: this.wallet.rideOn() ? '🐾 펫에서 내리기 (데리고 다니기)' : '🏇 펫 타기', onClick: () => { const on = !this.wallet.rideOn(); void this.wallet.setRide(on); this.toast(on ? '🏇 펫을 탔습니다.' : '🐾 펫에서 내렸습니다. 뒤에서 따라옵니다.'); } }] : []),
      { label: this.wallet.rouletteDoneToday() ? '🎰 오늘의 룰렛 (돌렸음)' : '🎰 오늘의 룰렛', onClick: () => this.openRoulette() },
      { label: '🗺 오늘의 보물 지도', onClick: () => { if (this.mapId !== MAIN_MAP_ID) { this.toast('보물 지도는 광장 맵에서만 볼 수 있어요.', true); return; } openDigMap(this.mainMap, this.dig.spots, this.dig.dug, { x: this.me.x, y: this.me.y }); } },
      { label: '🏠 리스폰 (시작 지점으로)', onClick: () => this.respawnFlow() },
      { label: this.mafia.game ? (this.mafia.game.st === 'lobby' ? '🕵 마피아 (모집 중!)' : '🕵 마피아 (진행 중)') : '🕵 마피아 모집', onClick: () => openMafiaLobby(this) },
    ];
    items.push({ label: '🔑 비밀번호 변경', onClick: () => this.changePasswordFlow() });
    items.push({ label: '🚪 회원 탈퇴', danger: true, onClick: () => this.withdrawFlow() });
    items.push({ label: '⏻ 로그아웃', danger: true, onClick: () => this.logoutFlow() });
    contextMenu(x, y, `${this.profile.nick} (나)`, items);
  }
  // 내 메뉴 → 리스폰: 구석에서 다른 사람이 길을 막아 갇혔을 때 시작 지점으로 순간이동. 낚시 중이면 취소, 방에 있으면 나간다
  private async respawnFlow(): Promise<void> {
    if (!(await confirmModal('시작 지점으로 돌아갈까요?'))) return;
    const me = this.me;
    if (me.locked) { this.toast('지금은 이동할 수 없습니다.', true); return; }
    this.leaveForTeleport();
    await this.teleportTo(this.map.spawn.x, this.map.spawn.y);
    this.toast('🏠 시작 지점으로 돌아왔습니다.');
  }
  private async changeNickFlow(): Promise<void> {
    const n = await promptModal('닉네임 변경', '새 닉네임 (2~12자, 공백 없이)', this.profile.nick, 12);
    if (n === null || n.trim() === this.profile.nick) return;
    try {
      const nn = await changeNick(this.uid, this.profile.nick, n, true);
      this.profile.nick = nn;
      this.toast(`닉네임이 '${nn}'(으)로 바뀌었습니다.`);
    } catch (e) { this.toast((e as Error).message, true); }
  }
  // T / 모바일 🧸: 말랑이 던지기 (던지는 동작은 이모트 12 로 남들에게도 보인다)
  throwToss(): void { if (!this.switching && this.toss.throwAt()) this.doEmote(12); }
  // 선물을 받았으면(users/{uid}/gift 가 새로 바뀜) 한 번 알린다. 본 것은 브라우저에 기억해, 접속해 있지 않을 때 받은 것도 다음에 들어오면 뜬다
  private giftSeen = -1;
  private checkGiftMark(): void {
    const g = this.profile.gift;
    if (!g || typeof g.at !== 'number' || typeof g.i !== 'string') return;
    const key = `mv-gift-item-${this.uid}`;
    if (this.giftSeen < 0) { this.giftSeen = 0; try { this.giftSeen = Number(localStorage.getItem(key)) || 0; } catch { /* ignore */ } }
    if (g.at <= this.giftSeen) return;
    this.giftSeen = g.at;
    try { localStorage.setItem(key, String(g.at)); } catch { /* ignore */ }
    const it = itemById(g.i);
    const text = `🎁 ${g.fn || '누군가'} 님이 ${it ? `${it.icon} ${it.name}` : g.i}을(를) 선물했어요!${g.m ? ` “${g.m}”` : ''} (상점에서 착용)`;
    this.toast(text);
    this.events.emit('log', { channel: 'notice', from: '', text, ts: g.at });
  }
  openFishBook(): void { openFishBook({ uid: this.uid, nick: this.profile.nick, contest: this.contest, catchLog: this.catchLog }); }
  openRoulette(): void {
    this.input.releaseAll();
    openRoulette({ uid: this.uid, nick: this.profile.nick, wallet: this.wallet, toast: (m, e) => this.toast(m, e), log: (t) => this.chat.systemMessage(t), stat: (k) => this.net.stat(k) });
  }
  openShop(): void {
    this.input.releaseAll();
    openShop({
      uid: this.uid, profile: this.profile, wallet: this.wallet, config: this.config, toast: (m, e) => this.toast(m, e),
      onlineList: () => [...this.players.values()].map((p) => ({ uid: p.uid, nick: p.st.n })),
      // 선물 받을 사람을 아이디로 찾기: ids/{키} → uid → 닉네임
      lookupId: async (id) => {
        const uid = (await get(ref(db, `ids/${idPathKey(id)}`))).val();
        if (typeof uid !== 'string') return null;
        const nick = (await get(ref(db, `users/${uid}/nick`))).val();
        return typeof nick === 'string' ? { uid, nick } : null;
      },
    });
  }
  private coinText(): string {
    const a = this.contest.active();
    // 금광에 있는 동안은 금덩이 개수도 같이 보인다
    return fmtCoins(this.wallet.balance) + (this.mapId === GOLD_MINE_MAP_ID ? ` · ${fmtGold(this.wallet.gold)}` : '') + (this.wallet.autoReelActive() ? ` · 🤖 ${this.wallet.autoReelLeftText()}` : '') + (this.wallet.autoBugActive() ? ` · 🥅 ${this.wallet.autoBugLeftText()}` : '') + (a ? ` · 🏁 ${fmtLeft(a.end - serverNow())}` : '');
  }
  private changeAvatarFlow(): void {
    let sel = this.profile.avatar;
    const body = avatarPicker(sel, (id) => { sel = id; });
    modal('외모 변경', body, [
      { label: '취소', onClick: () => {} },
      { label: '적용', primary: true, onClick: () => { this.profile.avatar = sel; this.net.setAvatar(sel); this.toast('외모를 바꿨습니다.'); } },
    ]);
  }
  private async changePasswordFlow(): Promise<void> {
    const cur = await promptModal('비밀번호 변경', '현재 비밀번호', '', 100, true);
    if (cur === null) return;
    const nw = await promptModal('비밀번호 변경', '새 비밀번호', '', 100, true);
    if (nw === null) return;
    try { await changePassword(this.profile.id, cur, nw); this.toast('비밀번호를 변경했습니다.'); } catch (e) { this.toast((e as Error).message, true); }
  }
  // 내 메뉴 → 회원 탈퇴: 비밀번호를 다시 확인한 뒤 내 정보와 로그인 계정을 바로 지운다 (되돌릴 수 없다)
  private async withdrawFlow(): Promise<void> {
    if (!(await confirmModal('정말 탈퇴할까요? 계정과 개인정보, 코인·도감이 바로 삭제되고 되돌릴 수 없습니다.', '탈퇴'))) return;
    const pw = await promptModal('회원 탈퇴', '비밀번호', '', 100, true);
    if (pw === null) return;
    let msg = '탈퇴가 완료되었습니다. 이용해 주셔서 감사합니다.';
    try {
      // 비밀번호가 맞으면 먼저 게임에서 나가고(접속 표시·자리 정리) 그다음 내 정보와 계정을 지운다
      await withdraw(this.uid, this.profile, pw, () => this.stop());
    } catch (e) {
      if (!this.stopped) { this.toast((e as Error).message || '탈퇴하지 못했습니다.', true); return; } // 비밀번호가 틀렸다: 게임은 그대로
      msg = (e as Error).message || '탈퇴하지 못했습니다.';
    }
    await logout().catch(() => {});
    this.events.emit('logout', msg);
  }
  private async showProfile(uid: string): Promise<void> {
    const rp = this.players.get(uid);
    const fish = await fishSummaryOf(uid);
    const pet = rp?.st.pt ? itemById(rp.st.pt) : null;
    const petTxt = pet ? `펫: ${pet.icon} ${pet.name} Lv.${petLevel(rp?.st.pl || 0)}${petRiding(rp?.st.pl || 0, rp?.st.nr) ? ' (탑승 중)' : petGuard(rp?.st.pl || 0) ? ' (방어)' : ''}<br>` : '';
    const body = el('div', { html: `<p><b>${this.nickOf(uid)}</b></p><p class="muted">${petTxt}${fish}</p>` });
    modal('프로필', body, [{ label: '닫기', onClick: () => {} }]);
  }

  // ---------- 종료 ----------
  private async stop(replaced = false): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.hoursTimer); this.hoursUnsub?.(); this.hoursUnsub = null;
    this.engine.stop();
    this.chat.stop(); this.roomMgr.stop(); this.fishing.stop(); this.wallet.stop(); this.contest.stop(); this.bugs.stop(); this.dig.stop(); this.casino.stop(); this.casinoPanel.hide(); this.mafia.stop(); this.mafiaHud.clear(); this.rouletteUnsub?.();
    if (this.me.roomId && !replaced) await this.roomMgr.leave(this.me.roomId).catch(() => {});
    await this.net.leave(replaced);
    document.body.classList.remove('mobile');
  }
  async forceLogout(reason: string, replaced = false): Promise<void> {
    if (this.stopped) return;
    await this.stop(replaced);
    // 세션 교체는 같은 계정이 계속 쓰는 중이므로 Auth 로그아웃은 하지 않음 (같은 브라우저의 새 탭을 끊지 않기 위해)
    if (!replaced) await logout().catch(() => {});
    this.events.emit('logout', reason);
  }
  async logoutFlow(): Promise<void> {
    if (!(await confirmModal('로그아웃 할까요?'))) return;
    await this.forceLogout('');
  }
  async exitToMenu(): Promise<void> {
    await this.stop();
    this.events.emit('logout', '');
  }
}
