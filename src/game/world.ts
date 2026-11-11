import { ref, get } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import { changeNick, changePassword, logout, idPathKey, withdraw } from '../firebase/auth';
import { hoursState, clientBlocked, BLOCK_MESSAGE, WARN_MESSAGE } from '../shared/hours';
import HOLIDAYS from '../../holidays.json';
import { TILE, STEP_MS, PUSH_COOLDOWN_MS, PUSH_STUN_MS, WATER_TURN_HOLD_MS, DEFAULT_CONFIG } from '../shared/config';
import type { Dir, UserProfile, ServerConfig, RoomState } from '../shared/types';
import { randomId, el, lerp } from '../shared/util';
import { Engine } from './engine';
import { Input } from './input';
import { Emitter } from './emitter';
import { render, poseForEmote, type Entity, type Bubble } from './render';
import { buildDefaultMap, sanitizeMap, isWalkable, isWater, roomAt, findFreeTile, nearZone, type MapData, type Zone } from './map';
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
import { openDigMap } from './digui';
import { fmtLeft } from '../shared/contest';
import { openShop } from './shopui';
import { fmtCoins, PUSH_COOLDOWN_BY_TIER, pushTierOf, itemById, petLevel, petCanRide, petGuard, petGuardOf } from '../shared/shop';
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

export class World implements WorldCtx {
  sessionId = randomId(16);
  map: MapData = buildDefaultMap();
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
    this.map = await loadActiveMap();
    this.boardZone = this.map.zones.find((z) => z.kind === 'board');
    this.fishZone = this.map.zones.find((z) => z.kind === 'fish');
    this.arcadeZone = this.map.zones.find((z) => z.kind === 'arcade');

    // 스폰 위치: 마지막 위치 → 기본 스폰. 다른 사람과 겹치지 않게
    const snap = await get(ref(db, 'players'));
    const occupied = new Set<string>();
    if (snap.exists()) for (const [uid, st] of Object.entries(snap.val() as Record<string, { x: number; y: number }>)) if (uid !== this.uid) occupied.add(`${st.x},${st.y}`);
    const want = this.profile.lastPos && isWalkable(this.map, this.profile.lastPos.x, this.profile.lastPos.y) && !roomAt(this.map, this.profile.lastPos.x, this.profile.lastPos.y) ? this.profile.lastPos : this.map.spawn;
    const spawn = findFreeTile(this.map, want.x, want.y, (x, y) => occupied.has(`${x},${y}`), true);
    // 마지막 자리로 돌아왔으면 바라보던 방향도 되살린다 (자동 새로고침 뒤에도 자동 낚시가 이어지게)
    const lp = this.profile.lastPos;
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
    this.chat.systemMessage(`${this.profile.nick} 님, MawaVerse에 오신 것을 환영합니다! Enter 로 채팅, F 로 상호작용, 물가에서 F 로 낚시, 풀밭 벌레 옆에서 F 로 채집, G 로 앞사람에게 말랑이 던지기, 0 으로 밀치기, R 로 끌기, 우클릭(모바일은 캐릭터 터치)으로 메뉴, 도움말 버튼이나 Space 로 키 가이드.`);
    this.engine.start((dt, now) => this.tick(dt, now));
    // 평일 근무시간 차단: 08:55 에 안내하고 09:00 에 내보낸다 (관리자 제외). 08:55~09:00 에 들어온 사람도 바로 안내를 본다
    if (!this.isAdmin) { this.hoursTimer = window.setInterval(() => this.checkHours(), 1000); this.checkHours(); }
  }

  // 이용 시간 확인 (1초마다, 서버 시각 기준). 실제 차단은 보안 규칙이 하고, 여기는 안내와 퇴장 처리
  private hoursTimer = 0;
  private hoursWarned = false;
  private checkHours(): void {
    if (this.stopped) return;
    const now = serverNow();
    if (clientBlocked(now, HOLIDAYS)) { void this.forceLogout(BLOCK_MESSAGE); return; }
    if (hoursState(now, HOLIDAYS) !== 'warn') { this.hoursWarned = false; return; }
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
    this.events.on('profile', () => { this.checkGiftMark(); this.petRide.sync(); });
    this.events.on('roomHint', (t) => this.hud.setHint(t));
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
    const me = this.me;
    if (me.moving) {
      const t = Math.min(1, (now - me.moveStart) / me.moveDur);
      me.dispX = lerp(me.fromX, me.x, t); me.dispY = lerp(me.fromY, me.y, t);
      if (t >= 1) { me.moving = false; me.dispX = me.x; me.dispY = me.y; this.afterStep(); }
    }
    if (!me.moving && !me.locked && now >= me.stunUntil && !this.mafia.frozen()) {
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
    if (!g || g.st === 'lobby' || !g.bodies) return [];
    return Object.entries(g.bodies).map(([uid, b]) => ({ uid, avatar: b.a, nick: b.n, x: b.x, y: b.y }));
  }
  private entities(now: number): Entity[] {
    const me = this.me;
    const iGhost = this.mafia.isGhost(this.uid);
    const list: Entity[] = [{
      uid: this.uid, nick: (iGhost ? '👻 ' : '') + (this.contest.isChampion(this.uid) ? '🏆 ' : '') + this.profile.nick, avatar: this.profile.avatar, x: me.dispX, y: me.dispY, dir: me.dir, moving: me.moving,
      moveT: me.moving ? Math.min(1, (now - me.moveStart) / me.moveDur) : 0, pose: me.pose, poseAt: me.poseAt, emoteId: me.emoteId, bubble: me.bubble,
      isMe: true, ready: !!(me.roomId && this.rooms[me.roomId]?.members?.[this.uid]?.ready), pushAt: me.pushAt, pushDir: me.pushDir, hitAt: me.hitAt, blockAt: me.blockAt,
      fishing: this.fishing.view(), hat: this.profile.eq?.h || null, nameColor: this.profile.eq?.nc || null, fx: this.profile.eq?.fx || null,
      pet: this.pets.view(this.uid, this.myPet(), { x: me.x, y: me.y, fromX: me.fromX, fromY: me.fromY, moveStart: me.moveStart, moveDur: me.moveDur, moving: me.moving, dir: me.dir }, now, this.petRide.xp()),
      ghost: iGhost,
    }];
    for (const rp of this.players.values()) {
      // 마피아 유령은 유령에게만 보인다 (산 사람·비참가자 화면에는 아예 안 그린다)
      const ghost = this.mafia.isGhost(rp.uid);
      if (ghost && !iGhost) continue;
      list.push({
        uid: rp.uid, nick: (ghost ? '👻 ' : '') + (this.contest.isChampion(rp.uid) ? '🏆 ' : '') + rp.st.n + (rp.st.z ? ' 💤' : ''), avatar: rp.st.a, x: rp.x, y: rp.y, dir: rp.st.d ?? 0, moving: rp.moveStart > 0, moveT: rp.moveStart ? Math.min(1, (now - rp.moveStart) / rp.moveDur) : 0,
        pose: rp.pose, poseAt: rp.poseAt, emoteId: rp.emoteId, bubble: rp.bubble, isMe: false,
        ready: !!(rp.st.r && this.rooms[rp.st.r]?.members?.[rp.uid]?.ready), pushAt: rp.pushAt, pushDir: rp.pushDir, hitAt: rp.hitAt, blockAt: rp.blockAt,
        fishing: rp.st.f ? { x: rp.st.f.x, y: rp.st.f.y, bite: false, since: rp.fishAt, auto: !!rp.st.f.a, rod: rp.st.f.r || 0, stars: rp.st.f.s || 0 } : null,
        hat: rp.st.h || null, nameColor: rp.st.nc || null, fx: rp.st.fx || null,
        pet: this.pets.view(rp.uid, rp.st.pt, { x: rp.toX, y: rp.toY, fromX: rp.prevX, fromY: rp.prevY, moveStart: rp.moveStart, moveDur: rp.moveDur, moving: rp.moveStart > 0, dir: rp.st.d ?? 0 }, now, rp.st.pl || 0),
        ghost,
      });
    }
    return list;
  }
  // 내가 데리고 다니는 펫 (가진 것일 때만)
  private myPet(): string | null { const pt = this.profile.eq?.pt; return pt && this.profile.own?.[pt] ? pt : null; }

  // ---------- 이동 ----------
  occupied(x: number, y: number): boolean {
    for (const rp of this.players.values()) if (rp.toX === x && rp.toY === y && !this.mafia.passThrough(rp.uid)) return true;
    return false;
  }
  playerAt(x: number, y: number): RemotePlayer | null {
    for (const rp of this.players.values()) if (Math.round(rp.x) === x && Math.round(rp.y) === y && !this.mafia.passThrough(rp.uid)) return rp;
    return null;
  }
  passThrough(uid: string): boolean { return this.mafia.passThrough(uid); }
  canStep(nx: number, ny: number): boolean {
    if (this.me.locked) return false;
    if (!isWalkable(this.map, nx, ny) || this.occupied(nx, ny)) return false;
    const cur = roomAt(this.map, this.me.x, this.me.y);
    const target = roomAt(this.map, nx, ny);
    if (target && target !== cur) {
      const rs = this.rooms[target.id];
      if (rs && rs.state !== 'open') return false;
      if (rs && rs.members && Object.keys(rs.members).length >= (target.cap || 2)) return false;
    }
    return true;
  }
  private entering = false;
  // turned: 이번에 방향도 바뀌었다. 걸음이 나가면 방향이 같이 가고, 못 나가면 방향만 따로 알린다
  private async tryMove(nx: number, ny: number, turned = false): Promise<void> {
    const faceOnly = () => { if (turned) this.net.setDir(this.me.dir); };
    if (this.entering) { faceOnly(); return; }
    const cur = roomAt(this.map, this.me.x, this.me.y);
    const target = roomAt(this.map, nx, ny);
    if (target && target !== cur) {
      this.entering = true;
      const ok = await this.roomMgr.tryEnter(target).finally(() => { this.entering = false; });
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
  petReflect(): boolean { return this.petRide.rollReflect(); }
  // 순간이동 전 정리: 낚시 중이면 취소, 방에 있으면 나간다 (리스폰·관리자 이동 공용)
  leaveForTeleport(): void {
    const me = this.me;
    this.fishing.cancel();
    if (me.roomId) { const left = me.roomId; me.roomId = null; this.net.setRoom(null); this.roomMgr.leave(left); }
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
      me.roomId = null;
      this.net.setRoom(null);
      this.roomMgr.leave(left);
    } else if (z && !me.roomId) {
      // 밀려서 들어온 경우 등: 등록 시도, 실패하면 밖으로
      me.roomId = z.id;
      this.net.setRoom(z.id);
      this.roomMgr.tryEnter(z).then((ok) => { if (!ok) { const exit = z.exit || { x: z.x, y: z.y + z.h }; this.teleportTo(exit.x, exit.y); me.roomId = null; this.net.setRoom(null); } });
    }
    // 장풍에 밀렸으면 한 칸 더 (벽·사람·방 정원이면 거기서 멈춤)
    if (me.pushMore && !me.moving) {
      const pm = me.pushMore; me.pushMore = null;
      const nx = me.x + pm.dx, ny = me.y + pm.dy;
      if (this.canStep(nx, ny)) { me.pushAt = performance.now(); me.pushDir = pm.dir; this.startStep(nx, ny, pm.dir); }
    }
  }
  // 순간이동: 점유 선점에 실패하면(동시 퇴장 등) 다른 빈 타일로 재시도
  async teleportTo(x: number, y: number): Promise<void> {
    const me = this.me;
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
  private canvasHint(): { x: number; y: number; text: string; kind: 'board' | 'fishing' | 'cast' | 'sign' | 'bug' | 'arcade' | 'dig' | 'digging' | 'mafia' } | null {
    const me = this.me;
    if (me.roomId) return null;
    // 마피아 게임 중 참가자: 처치·미션·신고·소집이 F 를 우선 차지한다
    const ma = this.mafia.action();
    if (ma) {
      if (ma.kind === 'kill') return { x: me.x, y: me.y - 1, text: `F 처치: ${ma.nick}`, kind: 'mafia' };
      if (ma.kind === 'report') return { x: me.x, y: me.y - 1, text: `F 시체 신고 (${ma.nick})`, kind: 'mafia' };
      if (ma.kind === 'button') return { x: me.x, y: me.y - 1, text: 'F 긴급 소집 (1회)', kind: 'mafia' };
      return { x: ma.spot.x, y: ma.spot.y - 1, text: this.mafia.holding() ? `${ma.spot.def.verb} 중… 움직이지 마세요` : `F ${ma.spot.def.verb} (5초 버티기)`, kind: 'mafia' };
    }
    if (this.boardZone && nearZone(this.boardZone, me.x, me.y, 1)) return { x: this.boardZone.x + 1, y: this.boardZone.y - 1, text: 'F 게시판 보기', kind: 'board' };
    const fv = this.fishing.view();
    if (fv) { if (fv.auto) return null; return { x: fv.x, y: fv.y, text: fv.bite ? 'F 당겨!' : '찌를 기다리는 중… (이동하면 취소)', kind: 'fishing' }; } // 자동 낚시 중에는 안내를 띄우지 않는다 (2026-11-09, 사용자: 두 군데 뜨는 게 거슬림)
    const bug = this.bugs.targetView();
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
      if (z?.kind === 'casino') hint = `🎰 카지노 ${n}/${z.cap || '?'} · 오른쪽 판에서 배팅 (F 로 판 열기/닫기)`;
      else if (rs?.state === 'result') hint = `☕ ${rs.result?.loserNick} 당첨! 잠시 후 자동 퇴장`;
      else {
        const ready = rs?.members?.[this.uid]?.ready;
        hint = `${z?.label || '방'} ${n}/${z?.cap || '?'} · F ${ready ? '준비 취소' : '준비'}${n < 2 ? ' (2명 이상 필요)' : ''}`;
      }
    } else { const ch = this.canvasHint(); if (ch) hint = ch.text; }
    if (hint !== this.lastHint) { this.lastHint = hint; this.hud.setHint(hint); }
  }
  // 카지노 방 안에 있는 동안 경마 판을 띄운다 (나가면 닫힘). F 로 잠깐 닫을 수 있다
  private casinoHidden = false;
  private syncCasinoPanel(): void {
    const inCasino = this.me.roomId === 'casino';
    if (inCasino && !this.casinoHidden && !this.casinoPanel.open) this.casinoPanel.show();
    else if ((!inCasino || this.casinoHidden) && this.casinoPanel.open) this.casinoPanel.hide();
    if (!inCasino) this.casinoHidden = false;
  }
  interact(): void {
    if (this.me.roomId === 'casino') { this.casinoHidden = !this.casinoHidden; this.syncCasinoPanel(); return; }
    if (this.me.roomId) { this.roomMgr.toggleReady(this.me.roomId); return; }
    const ch = this.canvasHint();
    if (!ch) return;
    if (ch.kind === 'mafia') { void this.mafiaInteract(); return; }
    if (ch.kind === 'board') { this.input.releaseAll(); openBoard({ uid: this.uid, nick: this.profile.nick, isAdmin: this.isAdmin }); }
    else if (ch.kind === 'fishing') this.fishing.reel();
    else if (ch.kind === 'cast') this.fishing.cast();
    else if (ch.kind === 'bug') { if (this.bugs.swing()) this.doEmote(11); } // 잠자리채 휘두르기 (남들에게도 보임)
    else if (ch.kind === 'dig') { if (this.dig.begin()) this.doEmote(13); }
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
    const me = this.me;
    const now = performance.now();
    if (id === 10) {
      const cd = PUSH_COOLDOWN_BY_TIER[pushTierOf(this.profile.own)] ?? PUSH_COOLDOWN_MS; // 상점 업그레이드로 단축
      if (now - me.lastPushAt < cd) { this.toast(`밀치기는 ${Math.ceil((cd - (now - me.lastPushAt)) / 1000)}초 후에 가능합니다.`, true); return; }
      const [dx, dy] = dirVec(me.dir);
      if (this.profile.own?.wave) {
        // 장풍(상점 장비): 앞 4칸 × 옆 4칸 안의 모두를 두 칸. 철벽 갑옷은 건너뛴다 (🛡 만)
        const all: RemotePlayer[] = [];
        for (const [x, y] of frontTiles(me.x, me.y, dx, dy)) { const rp = this.playerAt(x, y); if (rp && !all.includes(rp)) all.push(rp); }
        if (!all.length) { this.toast('앞 4칸 안에 아무도 없습니다. 상대 쪽을 바라보고 쓰세요.', true); return; }
        const targets = all.filter((rp) => { if (rp.st.pa || petGuardOf(rp.st)) { rp.blockAt = now; return false; } return true; });
        if (!targets.length) { this.toast('🛡 모두 철벽 갑옷·등껍질이라 밀리지 않습니다.', true); return; }
        me.lastPushAt = now;
        this.net.pushMany(targets.map((t) => t.uid), dx, dy);
        for (const t of targets) this.toss.wave(me.x, me.y, Math.round(t.x), Math.round(t.y));
      } else {
        const target = this.playerAt(me.x + dx, me.y + dy);
        if (!target) { this.toast('앞에 밀 사람이 없습니다. 상대를 바라보고 붙어서 사용하세요.', true); return; }
        // 철벽 갑옷을 입은 상대는 안 밀린다: 보내지 않고 🛡 만 (쿨타임도 안 씀)
        if (target.st.pa || petGuardOf(target.st)) { target.blockAt = now; this.toast(`🛡 ${target.st.n} 은(는) ${target.st.pa ? '철벽 갑옷을 입고 있어' : '펫이 지켜 줘서'} 밀리지 않습니다.`, true); return; }
        me.lastPushAt = now;
        this.net.push(target.uid, dx, dy);
      }
    }
    if (id === 14 && !this.pull(now)) return;
    me.pose = poseForEmote(id); me.poseAt = now; me.emoteId = id;
    this.net.emote(id);
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
      if (front.st.pa || petGuardOf(front.st)) { front.blockAt = now; this.toast(`🛡 ${front.st.n} 은(는) ${front.st.pa ? '철벽 갑옷을 입고 있어' : '펫이 지켜 줘서'} 끌리지 않습니다.`, true); return false; }
      // 물러설 자리: 뒤 → 옆(두 방향). 방 안팎을 넘나들지는 않는다
      const back: [number, number][] = dx !== 0 ? [[me.x - dx, me.y], [me.x, me.y - 1], [me.x, me.y + 1]] : [[me.x, me.y - dy], [me.x - 1, me.y], [me.x + 1, me.y]];
      const spot = back.find(([x, y]) => this.canStep(x, y) && roomAt(this.map, x, y) === myRoom);
      if (!spot) { this.toast('물러설 자리가 없어 끌 수 없습니다.', true); return false; }
      me.lastPushAt = now;
      const ox = me.x, oy = me.y, uid = front.uid;
      // 내 걸음(점유 이동)이 서버에 반영된 뒤에 끌기를 보낸다: 상대가 내 옛 자리로 올 때 점유가 비어 있어야 한다
      this.startStep(spot[0], spot[1], undefined, { onDone: (ok) => { if (ok) this.net.pull(uid, ox, oy); } });
      return true;
    }
    if (!this.profile.own?.hook) { this.toast('앞에 끌 사람이 없습니다. 상대를 바라보고 붙어서 사용하세요. (갈고리가 있으면 앞 4칸 안에서 끌어옵니다)', true); return false; }
    const fx = me.x + dx, fy = me.y + dy;
    if (!this.canStep(fx, fy) || roomAt(this.map, fx, fy) !== myRoom) { this.toast('앞 칸이 막혀 있어 끌어올 수 없습니다.', true); return false; }
    const all: RemotePlayer[] = [];
    for (const [x, y] of frontTiles(me.x, me.y, dx, dy)) { const rp = this.playerAt(x, y); if (rp && !all.includes(rp)) all.push(rp); }
    if (!all.length) { this.toast('앞 4칸 안에 끌어올 사람이 없습니다. 상대 쪽을 바라보고 쓰세요.', true); return false; }
    const targets = all.filter((rp) => !rp.st.pa && !petGuardOf(rp.st));
    if (!targets.length) { for (const rp of all) rp.blockAt = now; this.toast('🛡 모두 철벽 갑옷·등껍질이라 끌리지 않습니다.', true); return false; }
    const target = targets[Math.floor(Math.random() * targets.length)];
    me.lastPushAt = now;
    this.net.pull(target.uid, fx, fy, true);
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
    if (this.isAdmin) items.push({ label: '🏠 광장으로 보내기 (관리자)', danger: true, onClick: async () => {
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
      { label: this.wallet.rouletteDoneToday() ? '🎰 오늘의 룰렛 (돌렸음)' : '🎰 오늘의 룰렛', onClick: () => this.openRoulette() },
      { label: '🗺 오늘의 보물 지도', onClick: () => openDigMap(this.map, this.dig.spots, this.dig.dug, { x: this.me.x, y: this.me.y }) },
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
  // G / 모바일 🧸: 말랑이 던지기 (던지는 동작은 이모트 12 로 남들에게도 보인다)
  throwToss(): void { if (this.toss.throwAt()) this.doEmote(12); }
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
    return fmtCoins(this.wallet.balance) + (this.wallet.autoReelActive() ? ` · 🤖 ${this.wallet.autoReelLeftText()}` : '') + (this.wallet.autoBugActive() ? ` · 🥅 ${this.wallet.autoBugLeftText()}` : '') + (a ? ` · 🏁 ${fmtLeft(a.end - serverNow())}` : '');
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
    const losses = (await get(ref(db, `users/${uid}/losses`)).catch(() => null))?.val() ?? '?';
    const rp = this.players.get(uid);
    const fish = await fishSummaryOf(uid);
    const pet = rp?.st.pt ? itemById(rp.st.pt) : null;
    const petTxt = pet ? `펫: ${pet.icon} ${pet.name} Lv.${petLevel(rp?.st.pl || 0)}${petCanRide(rp?.st.pl || 0) ? ' (탑승 중)' : petGuard(rp?.st.pl || 0) ? ' (방어)' : ''}<br>` : '';
    const body = el('div', { html: `<p><b>${this.nickOf(uid)}</b></p><p class="muted">커피 내기 패배: ${losses}회<br>${petTxt}${fish}</p>` });
    modal('프로필', body, [{ label: '닫기', onClick: () => {} }]);
  }

  // ---------- 종료 ----------
  private async stop(replaced = false): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.hoursTimer);
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
