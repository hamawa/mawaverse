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
import { O, objectAt, faceChairs, buildDefaultMap, buildPortalGarden, buildGoldMine, buildWinterMap, buildClubMap, CLUB_FLOOR, CLUB_DANCERS, buildHomeMap, HOME_EXIT_ZONE, portalNear, portalDests, sanitizeMap, isWalkable, isWater, roomAt, roomSeat, findFreeTile, nearZone, type MapData, type Zone, type PortalDest } from './map';
import { MAIN_MAP_ID, GOLD_MINE_MAP_ID, WINTER_MAP_ID, CLUB_MAP_ID, playerMapId, isHomeMapId, homeMapId, homeOwnerOf } from '../shared/maps';
import { mapSource, parseSavedMap, arrivalTile, savedMapId, portalBlock, portalYields, primaryOnlyRoom, destView, whereLabel, MAP_INFO, PRIMARY_ONLY_ROOM_MSG } from './portal';
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
import { SlotPanel } from './slotui';
import { DuelMgr } from './duel';
import { PokerMgr } from './poker';
import { PokerPanel } from './pokerui';
import { MafiaMgr } from './mafia';
import { MafiaHud, openMafiaLobby } from './mafiaui';
import { openBoard } from './boardui';
import { openFishBook, fishSummaryOf } from './fishui';
import { WalletMgr } from './wallet';
import { ContestMgr } from './contest';
import { BugHunt } from './bugs';
import { TossMgr } from './toss';
import { openMole } from './moleui';
import { gameLinkOf } from '../shared/links';
import { CampfireMgr } from './campfire';
import { CAMPFIRE_WOOD } from '../shared/campfire';
import { SnowmenMgr } from './snowmen';
import { DigMgr } from './dig';
import { MineMgr } from './mine';
import { HomeMgr, homeOpen } from './home';
import { openHome, openFurniturePicker, openFurnitureEdit, openGuestbook } from './homeui';
import { StockMgr } from './stock';
import { DjMgr } from './dj';
import { DjPanel, sameSong } from './djui';
import { openStock } from './stockui';
import { TreeMgr } from './trees';
import { type HomeData, homeTier, furnitureOf, canTurn, CHOP_SWINGS, SLEEP_MS } from '../shared/home';
import { fishById, fmtSize, bobberNear } from '../shared/fish';
import { winterFishById } from '../shared/winter';
import { fmtGold } from '../shared/mine';
import { openDigMap } from './digui';
import { fmtLeft } from '../shared/contest';
import { openShop } from './shopui';
import { batResultText, BAT_CHECK_MS, type BatKind, PET_NAME_FEE, PET_NAME_MAX, cleanPetName, rodTierOf, ROD_GOODS, fmtCoins, AVATAR_FEE, NICK_FEE, AVATAR_TICKET, NICK_TICKET, priceOf, PUSH_COOLDOWN_BY_TIER, pushTierOf, itemById, PET_IDS, petLevel, petRiding, petGuard, guardedOf, guardBrokenOf, assignBats, GUARD_BREAK_MS, SKI_GLOVES_ID, SKI_GLOVES_EQ } from '../shared/shop';
import { SnowfightState, snowGateAt, snowfightAction, SNOW_PACK_HINT, SNOW_THROW_HINT, type SnowGate } from './snowfight';
import { TASK_FOOTPRINT, FOG_RADIUS } from '../shared/mafia';
import { dirVec, frontTiles } from './area';
import { openRoulette, watchRouletteFeed } from './rouletteui';
import { WinterPlay } from './winterplay';
import { SnowPenaltyMgr } from './snowpenalty';
import { snowActive, SNOW_BREAK_NOTICE } from '../shared/snowpenalty';
import { Fishing } from './fishing';
import { sfx, setScene, setRain, stopSound, soundOn, setSoundOn, soundPrefs, setVolume, type Scene } from './audio';
import { rainLevel } from '../shared/weather';
import { snowSeason, treeLook, type TreeLook } from '../shared/season';
import { dayTint, isNight, kstMinuteOfDay, type DayTint } from '../shared/daylight';
import { HomePets, ownedPets, type RoamPet } from './homepets';
import { wakeLockSupported, wakeLockOn, setWakeLock, startWakeLock } from './wakelock';
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

const FX_PREVIEW_MS = 12000;  // 이펙트 미리보기 시간
const SIT_STEP_MS = 140;      // 앉으러 가구 칸에 오르고 내려서는 걸음의 길이
const CLUB_BPM = 126;        // 클럽의 바닥·춤추는 펫이 맞추는 박자 (곡은 124~128 이라 거의 맞는다)
const CLUB_DANCE_MS = 8000;  // 클럽에서 이모트 한 번에 춤추는 시간
const SMASH_CONFIRM_MS = 6000; // 눈사람 부수기: 첫 F 뒤 이 시간 안에 두 번째 F 를 눌러야 한다
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
  duel = new DuelMgr(this, (on) => this.net.setNoDuel(on)); // 1:1 내기 (주사위 대결)
  poker = new PokerMgr(this);                               // 인디언 포커 (포커 방)
  casinoPanel = new CasinoPanel(this); // config 가 바뀌어도 보도록 월드 자체를 넘긴다 (uid·wallet·config·casino·toast)
  slotPanel = new SlotPanel(this);     // 슬롯 방 판 (슬롯·홀짝)
  pokerPanel = new PokerPanel(this);   // 포커 방 판 (인디언 포커)
  mafia = new MafiaMgr(this);
  mafiaHud = new MafiaHud(this); // uid·nick(getter)·mafia·toast
  toss = new TossMgr(this, this.net, { cancelFishing: () => this.fishing.cancel() });
  dig = new DigMgr(this, this.net);
  stock = new StockMgr(this); // 거래소: 가격 굴리기·사고팔기 (shared/stock.ts)
  dj = new DjMgr(this);       // 클럽 DJ: 유튜브 링크로 노래 틀기 (game/dj.ts)
  private djPanel: DjPanel | null = null;
  mine = new MineMgr(this, this.net);
  private sentStars = 0; // presence 에 실은 낚싯대 성 (입장할 때 실은 값과 같으면 한 번 더 쓸 뿐이다)
  campfire!: CampfireMgr;      // 모닥불 (shared/campfire.ts)
  snowmen!: SnowmenMgr;        // 모두에게 보이는 눈사람 (game/snowmen.ts)
  private lastSnowSync = 0;
  trees = new TreeMgr(); // 벤 나무 (그루터기 → 덤불 → 5분 뒤 다시 나무. shared/home.ts)
  home = new HomeMgr(this, this.net, { leave: (why) => this.leaveHome(why), swing: () => this.doEmote(13), refresh: () => this.refreshHome(), trees: this.trees }); // 내 집: 나무·창고·겨울잠 (shared/home.ts)
  winter = new WinterPlay(this.map); // 겨울 맵의 빙판 관성·눈덩이 (눈덩이는 이 브라우저에만 있는 장난감. 맵에 들어올 때마다 새로: resetWinter)
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
  private linkZones: Zone[] = []; // 바깥 게임으로 가는 오락기 (shared/links.ts)

  constructor(private root: HTMLElement, public uid: string, public profile: UserProfile, public isAdmin: boolean) {
    this.me = { x: 0, y: 0, fromX: 0, fromY: 0, dispX: 0, dispY: 0, moveStart: 0, moveDur: STEP_MS, moving: false, dir: 0, pose: 'none', poseAt: 0, emoteId: 0, bubble: null, pushAt: -1, pushDir: 0, hitAt: -1e9, blockAt: -1e9, pushMore: null, stunUntil: 0, lastPushAt: -1e9, locked: false, roomId: null };
    this.catchLog = new CatchLog(uid);
    // 눈사람 부순 벌칙: 서버에 적힌 시각이 바뀔 때마다 (내 쓰기·다른 기기·복원) 값을 받아 presence 에 싣는다. 시작은 net.join 뒤 (start)
    this.snowPenalty = new SnowPenaltyMgr(uid, (brokenAt) => { this.snowBrokenAt = brokenAt; this.net.setSnowPenalty(brokenAt); }, () => this.toast(SNOW_BREAK_NOTICE)); // 알림은 모든 맵에 한 번씩 (부순 사람 자신 포함): breakSnowman 이 쓰는 이벤트에서만 나온다
  }
  snowPenalty: SnowPenaltyMgr;
  snowBrokenAt = 0; // 눈사람을 부순 서버 시각 (벌칙 SNOW_PENALTY_MS). 맵을 옮겨도 이어진다

  toast(msg: string, err = false): void { toast(msg, err); }
  catchLog: CatchLog;
  get nick(): string { return this.profile.nick; }
  catchNote(kind: 'fish' | 'bug' | 'etc', text: string): void { catchNote(text); this.catchLog.add(kind, text); }
  fishCaught(size: number): void { this.duel.onCatch(size); this.home.onCatch(); this.petCheerAt = performance.now(); }
  // 펫 꾸미기·고유 동작 (2026-11-20, cosmetics.ts PetLook). 고유 동작은 보는 재미뿐이고 서버로 가는 것이 없다: 남의 펫은 이 화면에서 알 수 있는 것(멈춰 있음·맞음)에만 반응하고,
  // 낚았을 때의 반응(강아지 멍!·햄스터 볼 빵빵)은 내 펫만 내 화면에서 한다 (남이 낚은 것은 전송되지 않는다)
  private petIdle = new Map<string, number>();
  private petCheerAt = -1e9;
  private petLook(e: Entity, now: number): import('./cosmetics').PetLook {
    const p = e.pet!, mine = e.uid === this.uid, st = mine ? null : this.players.get(e.uid)?.st;
    const eq = this.profile.eq, own = this.profile.own || {};
    const look: import('./cosmetics').PetLook = {
      hat: mine ? (eq?.ph && own[eq.ph] ? eq.ph : null) : st?.ph ?? null,
      glass: mine ? (eq?.pg && own[eq.pg] ? eq.pg : null) : st?.pg ?? null,
      name: (mine ? cleanPetName(eq?.pns?.[p.id]) : cleanPetName(st?.pn)) || null,
    };
    if (e.moving || !this.petIdle.has(e.uid)) this.petIdle.set(e.uid, now);
    const idle = now - (this.petIdle.get(e.uid) ?? now), cheer = mine ? now - this.petCheerAt : 1e9, hit = Math.min(now - e.hitAt, now - e.pushAt);
    if (p.id === 'petcat') look.sleep = idle > 6000;                        // 주인이 가만히 있으면 존다
    else if (p.id === 'petturtle') look.hide = hit >= 0 && hit < 2500;      // 주인이 맞으면 등껍질 속으로
    else if (p.id === 'pethamster') look.puff = cheer >= 0 && cheer < 3000; // 주인이 낚으면 볼 빵빵
    else if (p.id === 'petdog') { if (cheer >= 0 && cheer < 1200) { look.say = '멍!'; if (cheer < 350) p.hopAt = this.petCheerAt; } } // 주인이 낚으면 폴짝
    else if (p.id === 'petchick') { let hsh = 0; for (let i = 0; i < e.uid.length; i++) hsh = (hsh * 31 + e.uid.charCodeAt(i)) % 11000; if (!e.moving && (now + hsh) % 11000 < 1200) look.say = '삐약'; } // 가끔 삐약
    return look;
  }
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
    if (isHomeMapId(mapId) && homeOwnerOf(mapId) !== this.uid) mapId = MAIN_MAP_ID; // 남의 집에서 끊겼으면 광장에서 다시 시작한다 (내 집이면 집 안에서)
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
    this.resetWinter();

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
      onlineList: () => [{ uid: this.uid, nick: this.profile.nick, where: this.whereOf(this.uid, this.mapId) }, ...[...this.players.values()].map((p) => ({ uid: p.uid, nick: p.st.n, where: this.whereOf(p.uid, playerMapId(p.st)) }))],
      emote: (id) => this.doEmote(id),
      interact: () => this.input.trigger('interact'),
      openShop: () => this.openShop(),
      toss: () => this.throwToss(),
      sound: () => this.toggleSound(),
      soundOn: soundOn(),
      input: this.input,
      myUid: this.uid,
    });
    this.wireEvents(canvas);
    this.wallet.listen(() => this.hud.setCoins(this.coinText()));
    this.wallet.listen(() => this.petRide.sync());
    // 낚싯대 강화 성이 바뀌면 presence 에 싣는다 (남들이 프로필에서 본다. 2026-11-20)
    this.wallet.listen(() => { const s = this.wallet.shownStars; if (s !== this.sentStars) { this.sentStars = s; this.net.setStars(s); } });
    this.wallet.start();
    this.home.start(); this.home.entered(this.mapId); this.trees.watch(this.mapId);
    this.campfire = new CampfireMgr(this); this.campfire.watch(this.mapId);
    this.snowmen = new SnowmenMgr(this.uid); this.snowmen.onChange = () => this.syncSnowmen(); this.snowmen.watch(this.mapId);
    this.loadGuestPets();
    startWakeLock();
    // 화면 갱신이 멈춰 있는 동안(다른 창·탭) 하던 곡괭이질을 이어 간다 (2026-11-18. 나무 캐기는 HomeMgr.slowTick 이 같은 일을 한다)
    this.bgTimer = window.setInterval(() => { if (!this.stopped && this.framesStalled()) this.mine.tick(performance.now()); }, 1000);
    document.addEventListener('click', this.onUiClick, true);
    // 소리가 생겼다는 안내는 이 기기에서 한 번만 (처음에는 꺼져 있다)
    try { if (!soundOn() && !localStorage.getItem('mv-sound-seen')) { localStorage.setItem('mv-sound-seen', '1'); window.setTimeout(() => { if (!this.stopped) this.toast('🔊 소리가 생겼어요! 화면 위 🔇 버튼을 누르면 배경음악과 효과음이 켜집니다.'); }, 6000); } } catch { /* ignore */ }
    // 그날 첫 접속이면 2초 뒤 룰렛 창. 지갑이 한 번 읽힌 뒤에 판단한다
    const offW = this.wallet.listen(() => { if (!this.wallet.loaded) return; offW(); if (!this.wallet.rouletteDoneToday()) window.setTimeout(() => { if (!this.stopped) this.openRoulette(); }, 2000); });
    this.rouletteUnsub = watchRouletteFeed(this);
    this.contest.start();
    this.snowPenalty.start();
    this.bugs.start();
    this.dig.start();
    this.stock.start();
    const djPanel = this.djPanel = new DjPanel({ isAdmin: this.isAdmin, myUid: this.uid, onError: (msg, mine) => { if (mine) this.toast(`🎧 ${msg} 다른 영상을 골라 주세요.`, true); },
      // 영상이 끝났다 (2026-11-20): 끌 수 있는 사람(튼 사람·DJ 자리에 선 사람·관리자)의 화면이 club/dj 를 지운다. 그 사이 다른 노래로 바뀌었으면 건드리지 않는다
      onEnded: (song) => { if (sameSong(this.dj.state, song) && (song.u === this.uid || this.isAdmin || this.dj.atBooth())) void this.dj.off(); } });
    this.dj.listen(() => djPanel.set(this.dj.state));
    djPanel.set(this.dj.state); // 클럽에서 시작했으면 구독이 먼저 걸려 있다: 이미 받은 상태를 한 번 그린다
    this.casino.start();
    this.duel.start();
    void this.poker.recover(); // 지난번에 정산하지 못한 포커 판이 있으면 마무리한다
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
    // 마피아 알림 (2026-11-20 건의): 방이 열리면 화면 가운데에 2초, 사보타지가 걸리면 참가자에게
    this.events.on('mafiaLobby', (e) => banner('🕵 마피아 방이 열렸습니다', `${e.nick} 님이 모집 중 · 내 메뉴 → 🕵 마피아`, 2000));
    this.events.on('mafiaSab', (e) => {
      if (e.kind === 2) { banner('🔥 불이야!', '60초 안에 두 곳의 불을 꺼야 해요. 화살표를 따라가 불 옆에서 F 3초', 3500); sfx('alarm'); }
      else { banner('🌫 안개가 꼈습니다', e.mafia ? '시민은 30초 동안 자기 둘레만 봐요' : '30초 동안 내 둘레만 보여요', 2500); sfx('horn'); }
    });
    this.mafia.onInvite = (nick) => this.showMafiaInvite(nick);
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
      else this.photoClick(t.x, t.y); // 집 벽의 사진을 톡 치면 크게 본다
    });
    // 집 벽의 사진을 누르면 크게 본다 (2026-11-20 사용자 요청. 터치는 위의 톡 치기가 처리한다)
    canvas.addEventListener('click', (e) => { if ((e as PointerEvent).pointerType !== 'touch') this.photoClick(e.clientX, e.clientY); });
    canvas.addEventListener('pointercancel', () => { tap = null; });
    // 탭 종료 시에는 아무것도 하지 않는다: 서버에 예약된 onDisconnect 가 presence 를 지운다.
    // (여기서 leave() 를 부르면 취소 요청만 전달되고 삭제는 유실되어 유령 캐릭터가 남는다)
  }

  // ---------- 매 프레임 ----------
  private tick(_dt: number, now: number): void {
    if (this.stopped) return;
    // 뒤쪽 탭이었다가 돌아온 첫 프레임: 그동안 밀린 미끄러짐을 따라잡지 않는다
    if (this.framesStalled()) this.winter.resetSlide();
    this.checkSmash(now);
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
        if (!turnOnly && !(toWater && now < this.waterHoldUntil) && this.canStep(nx, ny)) {
          // 눈덩이 쪽으로 걸어 들어가는 걸음이면 눈덩이도 한 칸 밀린다. 걸음이 나간 뒤에 밀고, 서버가 그 걸음을 거부하면 되돌린다
          const push = this.winter.pushPlan(me.x, me.y, d, this.winterBlockedFn);
          let undo: (() => void) | null = null;
          void this.tryMove(nx, ny, turned, push ? (ok) => { if (!ok) undo?.(); } : undefined);
          // 방향키로 직접 시작한 걸음만 관성을 건다 (떼면 빙판에서 몇 칸 더). 걸음이 안 나갔으면 건 관성이 없다
          if (me.moving && me.x === nx && me.y === ny) { this.winter.armSlide(d); if (push) { undo = this.winter.applyPush(push, now, this.winterBlockedFn); if (push.kind === 'snowman') void this.snowmen.add(push.x, push.y); } } else this.winter.resetSlide();
        } else { this.winter.resetSlide(); if (turned) this.net.setDir(d); }
      } else if (this.winter.sliding) {
        if (this.input.enabled) this.slideOn(); else this.winter.resetSlide(); // 채팅창 등으로 입력이 막히면 멈춘다
      }
    } else if (!me.moving) this.winter.resetSlide(); // 스턴·잠금·마피아 정지·맵 이동 중에는 관성이 이어지지 않는다
    this.checkSeat();
    if (me.moving || (this.fishing.active && !this.input.enabled && !this.wallet.autoReelActive())) this.fishing.cancel(); // 밀려났거나 채팅창을 열면 취소 (자동 회수 중엔 채팅해도 유지)
    this.contest.tick(now);
    this.bugs.tick(now);
    this.dig.tick(now);
    this.mine.tick(now);
    this.home.tick(now);
    this.casino.tick();
    this.syncCasinoPanel();
    this.mafia.tick(now);
    if (this.winter.active && now - this.lastSnowSync > 5000) { this.lastSnowSync = now; this.syncSnowmen(); }
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
    this.snowfight.sync(this.snowGate()); // 장갑을 빼거나 겨울 맵을 벗어나면 뭉친 눈이 사라진다
    this.updateHint();
    render(this.engine, { map: this.map, entities: this.entities(now), rooms: this.rooms, now, serverNow: serverNow(), hint: this.shownHint(), bugs: this.bugs.views(), tosses: this.toss.views(now), bodies: this.bodyViews(), marks: this.taskMarks(), snow: this.winter.views(now), objAt: this.trees.shown, plaques: this.homePlaques(), roamers: this.roamers(), night: this.nightTint(), rain: this.rainView(), treeLook: this.treeTint, club: this.clubView(), fog: this.fogView(), fires: this.fireViews(), alerts: this.fireAlerts() });
    if (now - this.sceneAt > 1000) { this.sceneAt = now; setScene(this.sceneNow(), isNight(kstMinuteOfDay(serverNow()))); this.weatherTick(); } // 배경음악: 지금 상황에 맞는 곡 (1초에 한 번 본다)
  }

  // 마피아 미션 자리 표시 (2026-11-10): 시민·유령은 내 미완료 미션(금색 테두리 + 화면 밖 화살표), 마피아는 모든 자리(흐린 테두리)
  private taskMarks(): import('./render').RenderState['marks'] {
    const m = this.mafia.marks();
    if (!m) return null;
    return { mine: m.mine, spots: m.spots.map((s) => { const fp = TASK_FOOTPRINT[s.def.obj] || [1, 1]; return { x: s.x, y: s.y, w: fp[0], h: fp[1], label: s.def.verb }; }) };
  }
  // 마피아 사보타지 (2026-11-20): 안개는 살아 있는 시민의 화면만 가린다. 불은 기본 맵의 두 자리에 그리고, 참가자에게는 화면 밖이면 화살표로 가리킨다
  private fogView(): { x: number; y: number; r: number } | null { return this.mafia.fogged() ? { x: this.me.dispX, y: this.me.dispY, r: FOG_RADIUS } : null; }
  private fireViews(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = this.campfire.views();
    if (this.mapId === MAIN_MAP_ID) for (const f of this.mafia.fireSpots()) if (!f.out) out.push({ x: f.spot.x, y: f.spot.y });
    return out;
  }
  private fireAlerts(): { x: number; y: number; label: string }[] | undefined {
    if (this.mapId !== MAIN_MAP_ID || !this.mafia.isParticipant(this.uid)) return undefined;
    return this.mafia.fireSpots().filter((f) => !f.out).map((f) => ({ x: f.spot.x, y: f.spot.y, label: '🔥 불 끄기' }));
  }
  // 마피아 초대를 받았다: 화면 위에 작은 카드로 20초 (하던 일을 막지 않는다)
  private inviteEl: HTMLElement | null = null;
  private showMafiaInvite(nick: string): void {
    this.inviteEl?.remove();
    const join = el('button', { class: 'btn small primary', text: '참가' }), no = el('button', { class: 'btn small', text: '닫기' });
    const box = el('div', { id: 'mafia-invite' }, [el('span', { text: `🕵 ${nick} 님이 마피아에 초대했어요` }), join, no]);
    const close = () => { box.remove(); if (this.inviteEl === box) this.inviteEl = null; };
    join.onclick = async () => {
      close();
      if (this.mapId !== MAIN_MAP_ID) { this.toast('마피아는 광장이 있는 기본 맵에서만 참가할 수 있어요.', true); return; }
      const r = await this.mafia.join();
      this.toast(r === 'ok' ? '🕵 마피아에 참가했어요. 시작을 기다려 주세요.' : r === 'full' ? '꽉 찼어요.' : '참가하지 못했어요. (모집이 끝났을 수 있어요)', r !== 'ok');
    };
    no.onclick = close;
    (document.getElementById('app') || document.body).append(box);
    this.inviteEl = box; sfx('ui');
    window.setTimeout(close, 20000);
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
    const loose = isHomeMapId(this.mapId); // 집 안: 데리고 온 펫은 풀려나 돌아다닌다 (roamers). 따라다니지도 타지도 않는다
    const mySeat = this.sitAt;
    const myDance = this.danceOf(me.emoteId, me.poseAt, now);
    const list: Entity[] = [{
      uid: this.uid, nick: (iGhost ? '👻 ' : '') + (this.contest.isChampion(this.uid) ? '🏆 ' : '') + this.profile.nick + (this.home.sleeping ? ' 😴' : '') + (this.home.shield > 0 ? ` 🐟${this.home.shield}` : '') + (this.guardBroken() ? ' 💥' : ''), avatar: this.profile.avatar, x: me.dispX, y: me.dispY, dir: mySeat ? this.seatFace(mySeat) : me.dir, moving: me.moving, sit: !!mySeat && !me.moving,
      moveT: me.moving ? Math.min(1, (now - me.moveStart) / me.moveDur) : 0, pose: myDance ? 'dance' : me.pose, poseAt: myDance ? now : me.poseAt, emoteId: myDance ? 0 : me.emoteId, dance: myDance || undefined, bubble: me.bubble,
      isMe: true, pushAt: me.pushAt, pushDir: me.pushDir, hitAt: me.hitAt, blockAt: me.blockAt,
      fishing: this.fishing.view(), hat: this.profile.eq?.h || null, nameColor: this.profile.eq?.nc || null, fx: this.myFx(now), title: this.profile.eq?.tt && this.profile.own?.[this.profile.eq.tt] ? this.profile.eq.tt : null,
      pet: this.pets.view(this.uid, loose ? null : this.myPet(), { x: me.x, y: me.y, fromX: me.fromX, fromY: me.fromY, moveStart: me.moveStart, moveDur: me.moveDur, moving: me.moving, dir: me.dir }, now, this.petRide.xp(), !!this.profile.eq?.nr),
      ghost: iGhost, mining: this.mine.active, snowBrokenAt: this.snowBrokenAt, snowReady: this.snowfight.packed,
      progress: this.home.chopProgress(now) ?? this.mine.progress(now), // 나무·금을 캐는 중: 머리 위 진행 막대 (2026-11-18)
    }];
    const sNow = serverNow(); // 방어가 깨진 사람은 이름 옆에 💥 (빠따 gb 또는 눈사람 벌칙 sn. 내 이름은 guardBroken() 이 둘 다 본다)
    for (const rp of this.players.values()) {
      if (!this.onMyMap(rp.st)) continue; // 다른 맵에 있는 사람은 그리지 않는다
      // 마피아 유령은 유령에게만 보인다 (산 사람·비참가자 화면에는 아예 안 그린다)
      const ghost = this.mafia.isGhost(rp.uid);
      if (ghost && !iGhost) continue;
      const onSeat = !!rp.st.si && this.isSeat(rp.toX, rp.toY); // 새 방식: 가구 칸에 실제로 올라가 있다
      const seat = !rp.st.si ? null : onSeat ? { x: rp.toX, y: rp.toY } : this.seatOf(rp.toX, rp.toY, rp.st.d ?? 0); // 앉아 있는 사람: 바라보는 쪽 옆 칸의 가구 위에 그린다
      const dance = this.danceOf(rp.emoteId, rp.poseAt, now);
      list.push({
        uid: rp.uid, nick: (ghost ? '👻 ' : '') + (this.contest.isChampion(rp.uid) ? '🏆 ' : '') + rp.st.n + (this.mafia.isMate(rp.uid) ? ' 🔪' : '') + (rp.st.z ? ' 💤' : '') + (rp.st.hz ? ' 😴' : '') + (rp.st.sd ? ` 🐟${rp.st.sd}` : '') + (guardBrokenOf(rp.st, sNow) || snowActive(rp.st.sn, sNow) ? ' 💥' : ''), avatar: rp.st.a, x: seat && !onSeat ? seat.x : rp.x, y: seat && !onSeat ? seat.y : rp.y, dir: seat ? this.seatFace(seat) : rp.st.d ?? 0, sit: !!seat && !(onSeat && rp.moveStart > 0), moving: rp.moveStart > 0, moveT: rp.moveStart ? Math.min(1, (now - rp.moveStart) / rp.moveDur) : 0,
        pose: dance ? 'dance' : rp.pose, poseAt: dance ? now : rp.poseAt, emoteId: dance ? 0 : rp.emoteId, dance: dance || undefined, bubble: rp.bubble, isMe: false,
        pushAt: rp.pushAt, pushDir: rp.pushDir, hitAt: rp.hitAt, blockAt: rp.blockAt,
        fishing: rp.st.f && bobberNear(rp.toX, rp.toY, rp.st.f.x, rp.st.f.y) ? { x: rp.st.f.x, y: rp.st.f.y, bite: false, since: rp.fishAt, auto: !!rp.st.f.a, rod: rp.st.f.r || 0, stars: rp.st.f.s || 0 } : null,
        hat: rp.st.h || null, nameColor: rp.st.nc || null, fx: rp.st.fx || null, title: rp.st.tt || null,
        pet: this.pets.view(rp.uid, loose ? null : rp.st.pt, { x: rp.toX, y: rp.toY, fromX: rp.prevX, fromY: rp.prevY, moveStart: rp.moveStart, moveDur: rp.moveDur, moving: rp.moveStart > 0, dir: rp.st.d ?? 0 }, now, rp.st.pl || 0, !!rp.st.nr),
        ghost, mining: !!rp.st.mn, snowBrokenAt: rp.st.sn || 0,
      });
    }
    for (const e of list) {
      // 앉은 사람의 펫은 머리 위에 올라앉는다 (2026-11-20 사용자 요청). 집 안에서는 돌아다니던 펫이 올라온다 (roamers 에서 그동안 뺀다)
      if (loose && e.sit && !e.pet) { const id = e.uid === this.uid ? this.myPet() : this.players.get(e.uid)?.st.pt; if (id) e.pet = { id, x: e.x, y: e.y, moving: false, moveT: 0, hopAt: -1e9, dir: e.dir, scale: 1, ride: false }; }
      if (e.pet && !e.pet.ride) { e.pet.look = this.petLook(e, now); if (e.sit) e.pet.look.perch = true; }
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
    // 눈덩이·눈사람은 이 화면에서만 길을 막는다 (서버 점유와 무관). 밀 수 있는 눈덩이는 걸어 들어가 미는 것이라 막지 않는다 (밀려 나간 걸음은 눈덩이를 못 민다)
    if (!isWalkable(this.map, nx, ny) || this.occupied(nx, ny) || this.campfire.burningAt(nx, ny) || (pushed ? this.winter.toyAt(nx, ny) : this.winter.stepBlocked(this.me.x, this.me.y, nx, ny, this.winterBlockedFn))) return false;
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
  private async tryMove(nx: number, ny: number, turned = false, onDone?: (ok: boolean) => void): Promise<void> {
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
    this.startStep(nx, ny, undefined, onDone ? { onDone } : undefined);
  }
  startStep(nx: number, ny: number, pushedDir?: Dir, opts?: { dur?: number; onDone?: (ok: boolean) => void }): void {
    const me = this.me;
    const ox = me.x, oy = me.y;
    if (pushedDir !== undefined || opts) this.winter.resetSlide(); // 밀림·끌림·갈고리 같은 바깥 걸음은 관성을 끊는다 (방향키 걸음만 tick 이 다시 건다)
    me.fromX = me.x; me.fromY = me.y; me.x = nx; me.y = ny; me.moveStart = performance.now(); me.moving = true;
    // Shift 를 누른 채 이동하면 2배 속도. 펫 탑승 중 걷기는 25% 빠름 (2026-11-10). 밀려난 경우는 보통 속도. 갈고리처럼 여러 칸이면 dur 로 받는다
    me.moveDur = opts?.dur ?? (pushedDir === undefined ? (this.input.running ? STEP_MS / 2 : this.petRide.walkMs()) : STEP_MS); // 펫 레벨마다 걷기 2.5% 빠름 (Lv10 128ms)
    this.net.step(nx, ny, me.dir, ox, oy).then((ok) => {
      if (!ok && me.x === nx && me.y === ny) {
        // 점유 실패: 되돌리기
        me.x = ox; me.y = oy; me.fromX = ox; me.fromY = oy; me.dispX = ox; me.dispY = oy; me.moving = false;
        this.winter.resetSlide();
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
    this.winter.resetSlide();
    this.me.stunUntil = Math.max(this.me.stunUntil, now + moveMs + PUSH_STUN_MS);
    this.me.hitAt = now + moveMs;
  }
  // 펫 방어 (Lv8 이상): 밀치기·장풍·말랑이·끌기·갈고리를 갑옷처럼 막는다. 막은 보통 밀치기·말랑이는 80% 로 되받아친다 (net.ts, toss.ts)
  petGuard(): boolean { return !this.snowPenaltyActive() && this.petRide.guard(); }
  // ---- 빠따에 맞아 방어가 깨진 상태 (2026-11-11) ----
  // 풀리는 서버 시각. 새로고침으로 풀리지 않게 브라우저에도 적어 둔다 (start 에서 되살린다)
  // 눈사람 벌칙(snowBrokenAt)은 같은 효과(갑옷·펫 방어·되받아치기 없음)를 SNOW_PENALTY_MS 동안 주지만 guardUntil 은 건드리지 않는다: 60초 빠따가 30분 벌칙을 줄이거나 늘리지 못한다
  guardUntil = 0;
  snowPenaltyActive(): boolean { return snowActive(this.snowBrokenAt, serverNow()); }
  guardBroken(): boolean { return serverNow() < this.guardUntil || this.snowPenaltyActive(); }
  breakGuard(byNick: string, dark = false): void {
    if (this.home.useShield(byNick, dark)) return; // 겨울잠으로 쌓은 든든함: 빠따 한 번을 막는다 (방어가 안 깨지니 갑옷·펫이 그대로 막는다. 상대 빠따는 소모됐다)
    this.guardUntil = serverNow() + GUARD_BREAK_MS;
    try { localStorage.setItem(`mv-gb-${this.uid}`, String(this.guardUntil)); } catch { /* ignore */ }
    this.net.setGuardBroken(this.guardUntil);
    sfx('bat');
    // 어둠의 빠따(dark)는 byNick 이 "누군가"로 온다: 누가 쳤는지 알림에도 기록에도 남기지 않는다
    const bat = dark ? `🌑 ${byNick}의 어둠의 빠따` : `🏏 ${byNick} 의 빠따`;
    this.toast(`${bat}에 방어가 깨졌다! ${GUARD_BREAK_MS / 1000}초 동안 갑옷·펫이 막아 주지 않는다.`, true);
    this.events.emit('log', { channel: 'sys', from: '', text: `${bat}에 방어가 깨졌다 (${GUARD_BREAK_MS / 1000}초)`, ts: serverNow() });
  }
  petReflect(): boolean { return !this.snowPenaltyActive() && this.petRide.rollReflect(); }
  // 순간이동 전 정리: 낚시 중이면 취소, 방에 있으면 나간다 (리스폰·관리자 이동 공용)
  leaveForTeleport(): void {
    const me = this.me;
    this.fishing.cancel();
    this.mine.cancel();
    this.winter.resetSlide();
    if (me.roomId) { const left = me.roomId; me.roomId = null; this.seat = null; this.net.setRoom(null); this.roomMgr.leave(left); }
  }
  // 화면 갱신(rAF)이 멈춰 있나: 탭이 뒤에 있거나 창이 가려지거나 PC 가 잠겨 있으면 tick 이 돌지 않는다.
  // 그동안에도 밀치기는 통해야 하므로(자리 비운 자동 낚시꾼을 밀어낼 수 있게) 걸음을 애니메이션 없이 끝낸다 (2026-11-06)
  private framesStalled(): boolean { return document.visibilityState !== 'visible' || performance.now() - this.lastTickAt > 500; }
  private finishMove(): void {
    const me = this.me;
    me.moving = false; me.dispX = me.x; me.dispY = me.y;
    this.winter.resetSlide(); // 뒤쪽 탭에서 끝난 걸음: 관성은 이어 가지 않는다
    this.checkSeat();
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
    this.winter.resetSlide();
    const tried = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const t = findFreeTile(this.map, x, y, (a, b) => this.occupied(a, b) || this.campfire.burningAt(a, b) || tried.has(`${a},${b}`), true);
      tried.add(`${t.x},${t.y}`);
      const ox = me.x, oy = me.y;
      if (await this.net.step(t.x, t.y, me.dir, ox, oy)) {
        me.x = t.x; me.y = t.y; me.fromX = t.x; me.fromY = t.y; me.dispX = t.x; me.dispY = t.y; me.moving = false;
        return;
      }
    }
  }

  // ---------- 겨울 맵 놀이 (빙판 관성 · 눈덩이. winterplay.ts) ----------
  private resetWinter(): void { this.winter = new WinterPlay(this.map, this.winterBlockedFn); this.smash = null; this.snowfight.reset(); this.syncSnowmen(); }
  // 모두에게 보이는 눈사람을 겨울 놀이에 맞춘다 (목록이 바뀔 때, 그리고 녹는 시각을 넘기려고 5초에 한 번)
  private syncSnowmen(): void {
    if (!this.winter?.active || !this.snowmen) return;
    const list = this.snowmen.list();
    this.winter.setMen(list, list.filter((m) => m.mine).length);
  } // 뭉친 눈도 맵을 옮기면 사라진다
  // ---- 스키 장갑 눈싸움 (snowfight.ts): 눈 위에서 F 로 뭉치고 다음 F 로 던진다. 뭉친 눈은 이 브라우저에만 있다 ----
  private snowfight = new SnowfightState();
  private glovesOn(): boolean { return !!this.profile.eq?.[SKI_GLOVES_EQ] && !!this.profile.own?.[SKI_GLOVES_ID]; } // 가지고 있고 직접 낀 것만
  private snowGate(): SnowGate {
    const me = this.me;
    const busy = this.switching || !this.input.enabled || me.moving || me.locked || !!me.roomId || performance.now() < me.stunUntil || this.mafia.frozen();
    return snowGateAt(this.map, this.mapId, me.x, me.y, this.glovesOn(), busy);
  }
  private snowfightF(): void {
    const a = this.snowfight.press(this.snowGate(), this.input.interactRepeat); // 키를 누르고 있어 반복된 F 는 뭉치기·던지기 어느 쪽도 하지 않는다
    if (a === 'throw' && this.toss.throwSnow()) { this.snowfight.consume(); this.doEmote(12); }
  }
  // 사람이 서 있는(또는 걸어 들어오는) 칸: 눈덩이를 놓거나 굴려 넣지 않는다
  private winterBlocked(x: number, y: number): boolean {
    const me = this.me;
    return (me.x === x && me.y === y) || (me.moving && me.fromX === x && me.fromY === y) || this.occupied(x, y) || !!this.playerAt(x, y);
  }
  // 손을 뗀 뒤 빙판에서 이어 가는 한 칸 (칸마다 기존 걸음 하나 = Net.step 한 번)
  private slideOn(): void {
    const me = this.me;
    const s = this.winter.slideStep(me.x, me.y, (nx, ny) => this.canStep(nx, ny));
    if (!s) return;
    this.fishing.cancel();
    me.dir = s.dir;
    void this.tryMove(s.x, s.y);
  }
  private winterBlockedFn = (x: number, y: number): boolean => this.winterBlocked(x, y);
  // ---- 눈사람 부수기: F 두 번 (처음엔 확인만, 두 번째가 벌칙을 서버에 쓰고 부순다) ----
  // 서 있는 자리·방향·부술 눈사람이 그대로이고 SMASH_CONFIRM_MS 안일 때만 두 번째 F 가 이어진다. 움직이거나 돌아서거나 다른 F 를 쓰면 처음부터
  private smash: { mx: number; my: number; px: number; py: number; dir: number; until: number } | null = null;
  private smashing = false; // 벌칙을 쓰는 중 (끝날 때까지 F 무시)
  private checkSmash(now: number): void {
    const s = this.smash, me = this.me;
    if (!s || this.smashing) return;
    const man = me.moving ? null : this.winter.manAhead(me.x, me.y, me.dir);
    if (!man || man.x !== s.mx || man.y !== s.my || me.x !== s.px || me.y !== s.py || me.dir !== s.dir || now > s.until) this.smash = null;
  }
  private smashStep(man: { x: number; y: number }): void {
    if (this.input.interactRepeat || this.smashing) return; // 키를 누르고 있어 반복된 F 는 세지 않는다
    const me = this.me;
    if (!this.smash) {
      // 직전에 부순 지 얼마 안 됐으면 확인(첫 F)도 시작하지 않는다: 남은 시간을 알리고, 지난 뒤에 F 두 번을 처음부터 다시 누르게 한다 (규칙의 연타 간격과 같다)
      const wait = this.snowPenalty.waitMs();
      if (wait > 0) { this.toast(`눈사람은 ${Math.ceil(wait / 1000)}초 뒤에 다시 부술 수 있어요.`, true); return; }
      this.smash = { mx: man.x, my: man.y, px: me.x, py: me.y, dir: me.dir, until: performance.now() + SMASH_CONFIRM_MS }; return; }
    void this.smashSnowman(man);
  }
  // 벌칙(서버 쓰기)이 성공한 뒤에만 눈사람이 사라진다. 실패하면 눈사람은 그대로. 전체 알림은 breakSnowman 이 낸다
  private async smashSnowman(man: { x: number; y: number }): Promise<void> {
    this.smashing = true;
    const play = this.winter;
    let ok = false;
    try { ok = await this.snowPenalty.breakSnowman(this.snowmen.removeUpdate(man.x, man.y)); } catch (e) { console.warn('snowman penalty failed', e); }
    this.smashing = false; this.smash = null;
    if (ok) play.removeMan(man.x, man.y);
    else this.toast('눈사람을 부수지 못했어요. 잠시 후 다시 시도하세요.', true);
  }

  // ---------- 포탈 (맵 이동) ----------
  private setMap(map: MapData): void {
    this.dj.setActive(this.mapId === CLUB_MAP_ID); // 클럽에 있는 동안에만 DJ 상태를 구독한다
    this.map = map;
    if (!isHomeMapId(this.mapId)) faceChairs(map); // 탁자 옆 의자는 탁자를 본다 (집 안은 주인이 정한 방향 그대로)
    if (isHomeMapId(this.mapId)) this.homePets.setMap(map); else this.homePets.clear();
    this.boardZone = map.zones.find((z) => z.kind === 'board');
    this.fishZone = map.zones.find((z) => z.kind === 'fish');
    this.arcadeZone = map.zones.find((z) => z.kind === 'arcade');
    this.linkZones = map.zones.filter((z) => z.kind === 'link' && !!gameLinkOf(z.id));
  }
  private builtinMaps = new Map<string, MapData>(); // 코드에 든 맵은 한 번 만들어 두고 다시 쓴다
  // ---- 집 안을 돌아다니는 펫 (2026-11-18, homepets.ts): 집 주인이 가진 펫 전부 + 손님들이 데리고 온 펫. 집 안에서는 아무도 펫을 달고 다니지 않는다 (entities 가 따라다니는 펫을 그리지 않는다) ----
  private homePets = new HomePets();
  private guestPets: string[] = []; // 남의 집: 들어갈 때 한 번 읽어 온 그 집 주인의 펫
  private loadGuestPets(): void {
    this.guestPets = [];
    if (!isHomeMapId(this.mapId)) return;
    const owner = homeOwnerOf(this.mapId);
    if (owner === this.uid) return; // 내 집은 내 보관함을 그대로 본다
    const gen = this.mapGen;
    get(ref(db, `users/${owner}/own`)).then((s) => { if (gen === this.mapGen) this.guestPets = ownedPets(s.val() as Record<string, unknown> | null); }).catch(() => {});
  }
  private roamers(): import('./render').PetView[] | undefined {
    if (!isHomeMapId(this.mapId)) return undefined;
    const owner = homeOwnerOf(this.mapId), mine = owner === this.uid;
    const rp = mine ? null : this.players.get(owner);
    const here = rp && this.onMyMap(rp.st) ? rp : null;
    // 집 안에서는 레벨과 상관없이 전부 기본(작은) 크기로 돌아다닌다 (2026-11-18 사용자 요청: 데리고 온 펫만 큰 것이 어색했다)
    const led = mine ? this.myPet() : here?.st.pt ?? null;
    const ids = mine ? ownedPets(this.profile.own) : this.guestPets;
    const ownerSits = mine ? this.sitting() : !!here?.st.si; // 앉은 사람의 펫은 머리 위에 있다: 돌아다니는 쪽에서 뺀다
    const pets: RoamPet[] = ids.filter((id) => !(ownerSits && id === led)).map((id) => ({ key: `${owner}|${id}`, id }));
    if (led && !ids.includes(led) && !ownerSits) pets.push({ key: `${owner}|${led}`, id: led }); // 주인의 펫 목록을 아직 못 읽었어도 데리고 온 펫은 보인다
    // 손님이 데리고 온 펫 (나 포함). 손님마다 열쇠가 달라 같은 종류라도 따로 돌아다닌다
    const myPet = mine ? null : this.myPet();
    if (myPet && !this.sitting()) pets.push({ key: `${owner}|${this.uid}|${myPet}`, id: myPet });
    for (const g of this.players.values()) if (g.uid !== owner && g.st.pt && this.onMyMap(g.st) && !g.st.si) pets.push({ key: `${owner}|${g.uid}|${g.st.pt}`, id: g.st.pt });
    return pets.length ? this.homePets.views(pets, serverNow()) : undefined;
  }
  // ---- 낮과 밤 (2026-11-18, shared/daylight.ts): 바깥 맵만. 집 안과 금광은 실내라 그대로. 내 메뉴에서 끌 수 있다 (이 브라우저에만 적는다) ----
  private dayOff = ((): boolean => { try { return localStorage.getItem('mv-daylight-off') === '1'; } catch { return false; } })();
  private nightTint(): DayTint | null {
    if (this.dayOff || isHomeMapId(this.mapId) || this.mapId === GOLD_MINE_MAP_ID || this.mapId === CLUB_MAP_ID) return null;
    return dayTint(kstMinuteOfDay(serverNow()));
  }
  private bgTimer = 0;
  // 단추를 누를 때 딸깍 (소리 단추 자신은 켜짐 알림음이 난다)
  private onUiClick = (e: MouseEvent): void => { const b = (e.target as HTMLElement | null)?.closest?.('button'); if (b && !b.hasAttribute('data-quiet')) sfx('ui', { vol: 0.6 }); };
  // ---- 클럽 (2026-11-18, 사용자 제안): 춤추는 펫(선글라스), 색 조명, 이모트 1~9 가 전부 춤 ----
  private clubPets: import('./render').PetView[] = CLUB_DANCERS.map((p, i) => ({ id: PET_IDS[i % PET_IDS.length], x: p.x, y: p.y, moving: false, moveT: 0, hopAt: -1e9, dir: 0, scale: 1.3, ride: false }));
  private clubView(): { x: number; y: number; w: number; h: number; bpm: number; dancers: import('./render').PetView[] } | null {
    return this.mapId === CLUB_MAP_ID ? { ...CLUB_FLOOR, bpm: CLUB_BPM, dancers: this.clubPets } : null;
  }
  // 클럽에서 이모트 1~9 를 쓰면 CLUB_DANCE_MS 동안 그 번호의 춤을 춘다 (그 밖의 맵에서는 0 = 평소 이모트)
  private danceOf(emoteId: number, poseAt: number, now: number): number {
    return this.mapId === CLUB_MAP_ID && emoteId >= 1 && emoteId <= 9 && now - poseAt < CLUB_DANCE_MS ? emoteId : 0;
  }
  // ---- 앉기 (2026-11-18, 사용자 요청): 벤치·의자·소파를 보고 F. 보이는 모습만 그 가구 위로 옮긴다: 실제 자리는 그대로라 밀치기·끌기는 평소처럼 통하고, 움직이거나 돌아서면 일어난다 ----
  // ---- 이펙트 미리보기 (2026-11-19, 건의 반영): 사기 전에 내 캐릭터에 잠깐 입혀 본다. 이 화면에만 그린다 (서버로 가는 것은 없어 남에게는 안 보인다) ----
  private fxTry: { id: string; until: number } | null = null;
  previewFx(id: string): void {
    this.fxTry = { id, until: performance.now() + FX_PREVIEW_MS };
    this.note(`✨ ${itemById(id)?.name ?? '이펙트'} 미리보기: ${FX_PREVIEW_MS / 1000}초 동안 걸어 보세요 (내 화면에만 보여요)`);
  }
  private myFx(now: number): string | null {
    const t = this.fxTry;
    if (t && now < t.until) return t.id;
    if (t) { this.fxTry = null; this.note('✨ 미리보기가 끝났어요.'); }
    return this.profile.eq?.fx || null;
  }
  // 앉으면 그 가구 칸으로 실제로 옮겨 간다 (2026-11-19 수정, 사용자 제보). 전에는 모습만 가구 위로 옮기고 자리는 가구 앞에 그대로 둬서,
  // 앉은 사람이 서 있던 칸을 남들이 지나갈 수 없었다. sitAt: 내가 앉은 가구 칸, sitFrom: 앉기 전에 서 있던 칸 (일어날 때 먼저 그리로 돌아간다)
  private sitAt: { x: number; y: number } | null = null;
  private sitFrom: { x: number; y: number } | null = null;
  private isSeat(x: number, y: number): boolean { const o = objectAt(this.map, x, y); return o === O.BENCH || o === O.CHAIR || o === O.SOFA; }
  // 앉은 자리를 떠났거나(걸어 나감·밀려남·걸음 거부) 그 가구가 없어졌으면 앉은 상태를 푼다
  private checkSeat(): void { const s = this.sitAt; if (s && (this.me.x !== s.x || this.me.y !== s.y || !this.isSeat(s.x, s.y))) this.standUp(); }
  // 앉은 사람이 보는 쪽 = 그 가구가 보는 쪽 (집 안에서 돌려 놓은 의자·소파·벤치. 그 밖에는 앞)
  private seatFace(s: { x: number; y: number }): Dir { return (this.map.dirs?.[s.y * this.map.w + s.x] ?? 0) as Dir; }
  sitting(): boolean { return !!this.sitAt; }
  // (x, y)에서 dir 쪽 옆 칸이 앉을 수 있는 가구면 그 칸
  private seatOf(x: number, y: number, dir: number): { x: number; y: number } | null {
    const [dx, dy] = dirVec(dir as Dir), sx = x + dx, sy = y + dy;
    return this.isSeat(sx, sy) ? { x: sx, y: sy } : null;
  }
  private seatAhead(): { x: number; y: number } | null {
    const me = this.me;
    if (me.moving || me.locked || me.roomId || this.switching || this.sitAt) return null;
    const s = this.seatOf(me.x, me.y, me.dir);
    if (!s || this.occupied(s.x, s.y)) return null; // 누가 이미 앉아 있는 자리는 비켜 준다
    // 옛 화면(v39 이하)으로 앉은 사람: 가구 앞에 서서 표시만 켜 둔다
    for (const rp of this.players.values()) if (rp.st.si && this.onMyMap(rp.st) && !this.isSeat(rp.toX, rp.toY)) { const o = this.seatOf(rp.toX, rp.toY, rp.st.d ?? 0); if (o && o.x === s.x && o.y === s.y) return null; }
    return s;
  }
  private sit(): void {
    const s = this.seatAhead();
    if (!s) return;
    const me = this.me;
    this.fishing.cancel(); this.mine.cancel();
    this.sitAt = s; this.sitFrom = { x: me.x, y: me.y };
    me.dir = this.seatFace(s); // 가구가 보는 쪽을 본다 (걸음에 실려 간다)
    // 가구 칸은 걸어서는 못 들어가는 칸이라 canStep 을 거치지 않고 바로 옮긴다. 누가 먼저 앉았으면 걸음이 거부돼 제자리로 돌아온다 (checkSeat 이 푼다)
    this.startStep(s.x, s.y, undefined, { dur: SIT_STEP_MS, onDone: (ok) => { if (ok && this.sitAt === s) this.net.setSit(true); } });
    sfx('door', { vol: 0.5 });
  }
  // 앉은 상태를 푼다 (자리는 건드리지 않는다: 이미 자리를 떠났거나 가구가 없어진 뒤에 부른다)
  private standUp(): void { if (!this.sitAt) return; this.sitAt = null; this.sitFrom = null; this.net.setSit(false); }
  // F 로 일어나기: 가구 칸에서 옆 칸으로 내려선다. 앉기 전에 서 있던 칸 → 가구가 보는 쪽 → 그 밖의 옆 칸 순서로 빈 곳을 찾는다
  private leaveSeat(): void {
    const me = this.me, s = this.sitAt;
    if (!s || me.moving || me.locked) return;
    const [fx, fy] = dirVec(this.seatFace(s));
    const around = [this.sitFrom, { x: s.x + fx, y: s.y + fy }, { x: s.x, y: s.y + 1 }, { x: s.x - 1, y: s.y }, { x: s.x + 1, y: s.y }, { x: s.x, y: s.y - 1 }];
    const t = around.find((p) => !!p && Math.abs(p.x - s.x) + Math.abs(p.y - s.y) === 1 && this.canStep(p.x, p.y));
    if (!t) { this.toast('일어설 자리가 없어요. 둘레가 막혀 있어요.', true); return; }
    me.dir = t.x < s.x ? 1 : t.x > s.x ? 2 : t.y < s.y ? 3 : 0;
    this.startStep(t.x, t.y, undefined, { dur: SIT_STEP_MS }); // 자리를 떠나면 checkSeat 이 앉은 상태를 푼다
  }
  // ---- 날씨 (2026-11-18, shared/weather.ts): 바깥 맵에만 비가 온다. 집 안과 금광은 실내. 겨울 맵에서는 눈으로 보이고 비 한정 물고기는 없다 ----
  private outdoors(): boolean { return !isHomeMapId(this.mapId) && this.mapId !== GOLD_MINE_MAP_ID && this.mapId !== CLUB_MAP_ID; }
  private rainHere(): number { return this.outdoors() ? rainLevel(serverNow()) : 0; }
  raining(): boolean { return this.mapId !== WINTER_MAP_ID && this.rainHere() > 0; }
  // 눈이 오는 철(11/15~1/31)에는 어느 맵에서나 비를 눈으로 그린다 (겨울 낚시터는 언제나 눈)
  private snowy(): boolean { return this.mapId === WINTER_MAP_ID || snowSeason(serverNow()); }
  private rainView(): { level: number; snow: boolean } | null { const level = this.dayOff ? 0 : this.rainHere(); return level > 0 ? { level, snow: this.snowy() } : null; }
  private treeTint: TreeLook = null; // 지금 나무의 빛깔 (단풍·벚꽃. 1초에 한 번 본다)
  private wasRaining: boolean | null = null;
  // 1초에 한 번: 빗소리를 맞추고, 비가 시작하고 그칠 때 한 줄 알린다 (처음 들어왔을 때는 알리지 않는다)
  private weatherTick(): void {
    const level = this.rainHere(), winterMap = this.mapId === WINTER_MAP_ID, snow = this.snowy();
    setRain(snow ? 0 : level); // 눈은 소리 없이 내린다
    this.treeTint = this.outdoors() && !winterMap ? treeLook(serverNow()) : null;
    const now = rainLevel(serverNow()) > 0;
    if (this.wasRaining !== null && now !== this.wasRaining && this.outdoors() && !winterMap) {
      if (snow) this.toast(now ? '❄ 눈이 내리기 시작합니다. 눈 오는 동안에만 낚이는 물고기가 있어요.' : '🌤 눈이 그쳤습니다.');
      else this.toast(now ? '🌧 비가 내리기 시작합니다. 비 오는 동안에만 낚이는 물고기가 있어요.' : '🌤 비가 그쳤습니다.');
    }
    this.wasRaining = now;
  }
  // ---- 배경음악이 달라지는 상황 (audio.ts) ----
  private sceneAt = 0;
  private sceneNow(): Scene {
    const room = this.me.roomId;
    if (room === 'casino') return 'race';
    if (room === 'slots') return 'slots';
    if (room === 'poker') return 'poker';
    const g = this.mafia.game;
    if (g && g.st !== 'lobby' && g.players?.[this.uid]) return 'mafia';
    if (isHomeMapId(this.mapId)) return 'home';
    if (this.mapId === GOLD_MINE_MAP_ID) return 'mine';
    if (this.mapId === WINTER_MAP_ID) return 'winter';
    if (this.mapId === CLUB_MAP_ID) return 'club';
    return 'main';
  }
  // 화면 위 소리 버튼: 켜기·끄기 (누른 그 순간에 불러야 브라우저가 소리를 허락한다)
  toggleSound(): boolean {
    const on = !soundOn();
    setSoundOn(on);
    if (on) { this.sceneAt = 0; this.toast('🔊 소리를 켰습니다. 음량은 내 메뉴 → 소리 설정에서 조절해요.'); } else this.toast('🔇 소리를 껐습니다.');
    return on;
  }
  private openSoundSettings(): void {
    const p = soundPrefs();
    const body = el('div', { class: 'sound-set' });
    const row = (label: string, kind: 'music' | 'sfx', test?: () => void) => {
      const input = el('input', { type: 'range', min: '0', max: '100', value: String(Math.round(p[kind] * 100)) }) as HTMLInputElement;
      const val = el('span', { class: 'muted', text: `${input.value}` });
      input.oninput = () => { val.textContent = input.value; setVolume(kind, Number(input.value) / 100); };
      input.onchange = () => test?.();
      body.append(el('label', { style: 'display:flex;align-items:center;gap:10px;margin:10px 0' }, [el('span', { style: 'width:72px', text: label }), input, val]));
    };
    const onBtn = el('button', { class: 'btn', text: soundOn() ? '🔊 소리 켜짐 (누르면 끔)' : '🔇 소리 꺼짐 (누르면 켬)' });
    onBtn.onclick = () => { const on = this.toggleSound(); onBtn.textContent = on ? '🔊 소리 켜짐 (누르면 끔)' : '🔇 소리 꺼짐 (누르면 켬)'; this.hud.setSound(on); };
    body.append(onBtn);
    row('배경음악', 'music');
    row('효과음', 'sfx', () => sfx('catch', { k: 2 }));
    body.append(el('p', { class: 'muted', text: '소리는 파일 없이 브라우저가 그 자리에서 만들어 냅니다. 곡은 상황(광장·집·금광·겨울·경마장·슬롯·포커·마피아)과 낮밤에 따라 달라져요. 설정은 이 기기에만 저장됩니다.' }));
    modal('🔊 소리 설정', body, [{ label: '닫기', onClick: () => {} }]);
  }
  private async loadMap(id: string): Promise<MapData> {
    const src = mapSource(id);
    if (src === 'active') return this.mainMap;
    if (src === 'builtin') {
      let m = this.builtinMaps.get(id);
      if (!m) { m = id === GOLD_MINE_MAP_ID ? buildGoldMine() : id === WINTER_MAP_ID ? buildWinterMap() : id === CLUB_MAP_ID ? buildClubMap() : buildPortalGarden(); this.builtinMaps.set(id, m); }
      return m;
    }
    if (src === 'home') {
      // 누군가의 집 안: 그 집의 단계로 방을 만든다. 단계가 바뀔 수 있어 만들어 두지 않는다
      const owner = homeOwnerOf(id), mine = owner === this.uid;
      const h = mine && this.home.data ? this.home.data : ((await get(ref(db, `homes/${owner}`))).val() as HomeData | null);
      const t = homeTier(h?.t);
      if (!t) throw new Error('no home');
      return buildHomeMap(id, t.tier, `${mine ? this.profile.nick : this.nickOf(owner)}의 ${t.name}`, h);
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
    if (z.id === HOME_EXIT_ZONE && this.home.inHome()) { void this.leaveHome(); return; } // 집 문: 들어오기 전에 있던 자리로
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
  // ---------- 내 집 (2026-11-17) ----------
  // 집에 들어간다: 내 집이면 언제나, 남의 집은 초가집이거나 잠겨 있지 않을 때 (규칙도 같은 조건). 포탈과 같은 길로 옮긴다
  async goHome(owner: string): Promise<void> {
    const mine = owner === this.uid, nick = this.nickOf(owner);
    if (this.mapId === homeMapId(owner)) { this.toast('이미 그 집 안에 있어요.'); return; }
    let h: HomeData | null = null;
    if (mine) h = this.home.data; else { try { h = (await get(ref(db, `homes/${owner}`))).val() as HomeData | null; } catch { h = null; } }
    const open = homeOpen(h);
    if (open === 'none') { this.toast(mine ? '아직 집이 없어요. 내 메뉴의 🏠 내 집에서 지을 수 있어요.' : `${nick} 님은 아직 집이 없어요.`, true); return; }
    if (!mine && open === 'locked') { this.toast(`🔒 ${nick} 님의 집은 문이 잠겨 있어요.`, true); return; }
    const back = isHomeMapId(this.mapId) ? this.home.returnTo : { map: this.mapId, x: this.me.x, y: this.me.y };
    await this.usePortal({ map: homeMapId(owner), label: mine ? '내 집' : `${nick}의 ${homeTier(h?.t)?.name ?? '집'}` });
    if (this.mapId === homeMapId(owner)) this.home.returnTo = back; // enterMap 이 비운 뒤에 다시 적는다
    if (!mine && this.mapId === homeMapId(owner)) window.setTimeout(() => { if (!this.stopped && this.mapId === homeMapId(owner)) this.note('📖 방명록을 남길 수 있어요: 내 메뉴 → 이 집 방명록 쓰기'); }, 2500);
  }
  // 집에서 나간다: 들어오기 전에 있던 자리로, 모르면 광장으로
  async leaveHome(why?: string): Promise<void> {
    if (!isHomeMapId(this.mapId)) return;
    if (why) this.toast(why);
    const r = this.home.returnTo;
    await this.usePortal(r && !isHomeMapId(r.map) && mapSource(r.map) ? { map: r.map, spawn: { x: r.x, y: r.y }, label: '밖' } : { map: MAIN_MAP_ID });
  }
  // 집 안에 있는 동안 그 집의 가구·바닥·박제가 바뀌었다: 같은 크기의 방을 다시 만들어 바꿔 끼운다 (서 있는 자리는 그대로)
  private refreshHome(): void {
    if (!isHomeMapId(this.mapId) || this.switching) return;
    const h = this.home.here(), t = homeTier(h?.t);
    if (!t) return;
    const m = buildHomeMap(this.mapId, t.tier, this.map.name, h);
    if (m.w !== this.map.w || m.h !== this.map.h) return; // 단계가 바뀐 것은 밖으로 나가는 쪽이 처리한다
    this.setMap(m);
  }
  // 집 벽에 건 물고기 박제 (그리기용)
  private homePlaques(): import('./render').RenderState['plaques'] {
    if (!isHomeMapId(this.mapId)) return undefined;
    const h = this.home.here(), t = homeTier(h?.t);
    if (!t || (!h?.tr && !h?.ph)) return undefined;
    const out: NonNullable<import('./render').RenderState['plaques']> = [];
    const owner = homeOwnerOf(this.mapId);
    t.trophyX.forEach((x, i) => {
      const ph = h.ph?.[String(i)];
      if (ph) { out.push({ x, y: 0, icon: '🖼', text: '', img: this.home.photo(owner, i, ph.at), frame: ph.k }); return; } // 사진 액자 (2026-11-20)
      const tr = h.tr?.[String(i)], f = tr ? (fishById(tr.id) ?? winterFishById(tr.id)) : undefined;
      if (tr && f) out.push({ x, y: 0, icon: f.icon, text: f.name, sub: tr.s ? fmtSize(tr.s) : undefined }); // 이름과 크기는 두 줄로 (2026-11-20)
    });
    return out;
  }
  // 바로 앞 벽의 사진 액자 (위쪽 벽 바로 아래 칸에서 벽을 보고 섰을 때)
  private photoAhead(): { x: number; slot: number } | null {
    if (!isHomeMapId(this.mapId)) return null;
    const h = this.home.here(), t = homeTier(h?.t), me = this.me;
    if (!t || !h?.ph || me.moving || me.dir !== 3 || me.y !== 1) return null;
    const i = t.trophyX.indexOf(me.x);
    return i >= 0 && h.ph[String(i)] ? { x: me.x, slot: i } : null;
  }
  // 화면의 그 자리에 사진 액자가 있으면 크게 본다 (서 있는 자리와 무관)
  private photoClick(cx: number, cy: number): void {
    if (!isHomeMapId(this.mapId)) return;
    const rect = this.engine.canvas.getBoundingClientRect();
    const [tx, ty] = this.engine.screenToTile(cx - rect.left, cy - rect.top);
    const h = this.home.here(), t = homeTier(h?.t);
    if (!t || !h?.ph || ty !== 0) return;
    const i = t.trophyX.indexOf(tx);
    if (i >= 0 && h.ph[String(i)]) this.openPhotoSlot(i);
  }
  private openPhoto(): void { const pa = this.photoAhead(); if (pa) this.openPhotoSlot(pa.slot); }
  private openPhotoSlot(slot: number): void {
    const pa = { slot };
    const owner = homeOwnerOf(this.mapId), ph = this.home.here()?.ph?.[String(pa.slot)]; if (!ph) return;
    const img = this.home.photo(owner, pa.slot, ph.at);
    if (!img) { this.toast('사진을 불러오는 중이에요. 잠시 뒤에 다시 눌러 주세요.'); return; }
    this.input.releaseAll();
    const body = el('div', { style: 'text-align:center' }, [el('img', { src: img.src, alt: '벽에 건 사진', style: 'max-width:100%;max-height:76vh;border-radius:8px' })]);
    const acts: import('./ui').ModalAction[] = [{ label: '닫기', onClick: () => {} }];
    if (owner === this.uid || this.isAdmin) acts.unshift({ label: '사진 내리기', danger: true, onClick: async () => { this.toast((await this.home.removePhoto(owner, pa.slot)) ? '사진을 내렸어요.' : '내리지 못했습니다.'); } });
    modal('🖼 사진', body, acts, true);
  }
  // 벽돌집 안: 밀치기·끌기·말랑이가 안 통한다
  homeSafe(): boolean { return this.home.safeHere(); }
  homeMarks(): { sd?: number; hz?: boolean } { return this.home.marksNow(); }

  // 맵 이동이 서버에 반영됐다: 옛 맵에 묶인 화면 상태(벌레·말랑이·펫 자리·말풍선·장풍 예약)를 비우고 새 맵으로
  private enterMap(id: string, map: MapData, x: number, y: number): void {
    const me = this.me;
    sfx(isHomeMapId(id) || isHomeMapId(this.mapId) ? 'door' : 'portal');
    this.mapGen++;
    this.mapId = id;
    this.setMap(map);
    this.loadGuestPets();
    this.sitAt = null;
    if (id === CLUB_MAP_ID) window.setTimeout(() => { if (!this.stopped && this.mapId === CLUB_MAP_ID) this.note('💃 클럽에서는 이모트(1~9)가 전부 춤이 돼요!'); }, 1500);
    Object.assign(me, { x, y, fromX: x, fromY: y, dispX: x, dispY: y, moving: false, pushMore: null, bubble: null, pose: 'none', emoteId: 0 });
    this.waterHoldUntil = 0;
    this.resetWinter(); // 눈덩이·눈사람·관성은 맵을 나가면 사라지고 들어올 때 새로 놓인다
    this.fishing.cancel(); // 맵을 읽는 사이 자동 낚시가 옛 맵 물에 다시 던졌을 수 있다
    this.bugs.clear(); this.toss.clear(); this.pets.forget(this.uid); this.mine.left(); this.home.entered(id); this.trees.watch(id); this.campfire.watch(id); this.snowmen.watch(id);
    for (const rp of this.players.values()) rp.bubble = null;
    // lastHint 는 그대로 둔다: 여기서 비우면 화면의 '이동 중…' 안내와 어긋나, 도착한 칸에 안내가 없을 때 그 문구가 지워지지 않는다. 다음 프레임의 updateHint 가 새 맵 기준으로 맞춘다
    this.events.emit('players');
  }

  isTileVisible(x: number, y: number): boolean { return this.engine.isTileVisible(x, y, 0); }
  nickOf(uid: string): string {
    if (uid === this.uid) return this.profile.nick;
    return this.players.get(uid)?.st.n || '(오프라인)';
  }
  // 접속자 목록에 보이는 그 사람의 위치 (맵 이름. 2026-11-20 건의). 모든 맵의 접속 표시를 이미 받고 있어 서버에 따로 묻지 않는다
  private whereOf(uid: string, mapId: string): string {
    return whereLabel(mapId, uid, (owner) => (owner === this.uid ? this.profile.nick : this.players.get(owner)?.st.n || ''), mapId === this.mapId ? this.map.name : '');
  }
  setBubble(uid: string, bubble: Bubble): void {
    if (uid === this.uid) this.me.bubble = bubble;
    else { const rp = this.players.get(uid); if (rp) rp.bubble = bubble; }
  }

  // ---------- 상호작용 ----------
  // F 로 할 수 있는 것과 그 안내 위치. 우선순위: 게시판 → 낚시 중 → 물가(낚시 시작) → 낚시 표지판
  private canvasHint(): { x: number; y: number; text: string; kind: 'board' | 'fishing' | 'cast' | 'sign' | 'bug' | 'arcade' | 'dig' | 'digging' | 'mafia' | 'portal' | 'mine' | 'mining' | 'snowman' | 'snowfight' | 'chop' | 'chopping' | 'bed' | 'sleeping' | 'chest' | 'decoPlace' | 'decoRemove' | 'sit' | 'sitting' | 'dj' | 'link' | 'photo' | 'fire' } | null {
    const me = this.me;
    if (me.roomId) return null;
    if (this.switching) return { x: me.x, y: me.y - 1, text: '🌀 이동 중…', kind: 'portal' };
    if (this.sitAt) {
      // 물가 벤치에 앉아 있으면 앉은 채로 낚시한다 (2026-11-20 사용자 요청). 낚는 중이면 그 안내, 물을 보고 있으면 던지기. 이때 일어나려면 움직이면 된다 (걸어 나가면 풀린다)
      const sv = this.fishing.view();
      if (sv) return sv.auto ? null : { x: sv.x, y: sv.y, text: sv.bite ? 'F 당겨!' : '찌를 기다리는 중… (이동하면 취소)', kind: 'fishing' };
      const st = this.fishing.targetTile();
      if (st) return { x: st.x, y: st.y, text: 'F 낚시 (일어나려면 이동)', kind: 'cast' };
      return { x: this.sitAt.x, y: this.sitAt.y - 1, text: 'F 일어나기', kind: 'sitting' };
    }
    if (this.mapId === CLUB_MAP_ID && this.dj.atBooth()) return { x: me.x, y: me.y + 1, text: this.dj.state ? 'F 노래 바꾸기·끄기' : 'F 노래 틀기 (유튜브 링크)', kind: 'dj' };
    // 마피아 게임 중 참가자: 처치·미션·신고·소집이 F 를 우선 차지한다
    const ma = this.mafia.action();
    if (ma) {
      if (ma.kind === 'kill') return { x: me.x, y: me.y - 1, text: `F 처치: ${ma.nick}`, kind: 'mafia' };
      if (ma.kind === 'report') return { x: me.x, y: me.y - 1, text: `F 시체 신고 (${ma.nick})`, kind: 'mafia' };
      if (ma.kind === 'button') return { x: me.x, y: me.y - 1, text: 'F 긴급 소집 (1회)', kind: 'mafia' };
      if (ma.kind === 'fire') return { x: ma.spot.x, y: ma.spot.y - 1, text: this.mafia.holdingFire() ? '불 끄는 중… 움직이지 마세요' : 'F 불 끄기 (3초 버티기)', kind: 'mafia' };
      return { x: ma.spot.x, y: ma.spot.y - 1, text: this.mafia.holding() ? `${ma.spot.def.verb} 중… 움직이지 마세요` : `F ${ma.spot.def.verb} (5초 버티기)`, kind: 'mafia' };
    }
    if (this.boardZone && nearZone(this.boardZone, me.x, me.y, 1)) return { x: this.boardZone.x + 1, y: this.boardZone.y - 1, text: 'F 게시판 보기', kind: 'board' };
    // 금광: 금덩어리를 보고 서 있으면 채광. 캐는 자리는 포탈 범위와 겹치지 않게 놓여 있다 (tests/maps.test.mjs)
    if (this.mine.active) return { x: me.x, y: me.y - 1, text: '⛏ 금을 캐는 중… (움직이면 허탕)', kind: 'mining' };
    if (this.mine.target()) return { x: me.x, y: me.y - 1, text: 'F 금 캐기', kind: 'mine' };
    // 내 집 (2026-11-17): 하던 도끼질·겨울잠 안내가 먼저, 그다음 침대·창고 상자 (주인만). 나무 캐기 시작은 맨 아래 (다른 F 가 전부 먼저)
    const cv = this.home.chopView();
    if (cv) return { x: me.x, y: me.y - 1, text: '', kind: 'chopping' }; // 안내는 띄우지 않는다 (2026-11-18 사용자 요청. 몇 번째인지는 왼쪽 위 알림에 나온다). 치는 동안 다른 F 를 막는 것은 그대로
    if (this.home.sleeping) { const s = Math.ceil(this.home.sleepLeftMs() / 1000); return { x: me.x, y: me.y - 1, text: `😴 겨울잠 중… ${Math.floor(s / 60)}:${s % 60 < 10 ? '0' : ''}${s % 60} (움직이면 깨요)`, kind: 'sleeping' }; }
    const hf = this.home.facing();
    if (hf === 'bed') return { x: me.x, y: me.y - 1, text: `F 겨울잠 (${SLEEP_MS / 60000}분)`, kind: 'bed' };
    if (hf === 'chest') return { x: me.x, y: me.y - 1, text: 'F 창고 열기', kind: 'chest' };
    // 꾸미기 모드: 놓은 가구를 보면 치우기, 놓을 수 있는 빈 칸을 보면 놓기 (문 옆에서도 포탈보다 먼저)
    const fd = this.home.facingDeco();
    if (fd) return fd.kind === 'remove' ? { x: fd.x, y: fd.y, text: `F ${furnitureOf(fd.o)?.name ?? '가구'} ${canTurn(fd.o) ? '돌리기·치우기' : '치우기'}`, kind: 'decoRemove' } : { x: fd.x, y: fd.y, text: `F 가구 놓기 (${this.home.decoCount}/${this.home.decoLimit})`, kind: 'decoPlace' };
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
    // 겨울 맵: 바로 앞 눈덩이 굴리기. 포탈·하던 낚시·벌레 다음, 새로 던지는 낚시보다 먼저
    const man = me.moving ? null : this.winter.manAhead(me.x, me.y, me.dir);
    if (man) return { x: man.x, y: man.y, text: this.smashing ? '눈사람 부수는 중…' : this.smash ? 'F · 진짜 부술거야..?' : 'F · 눈사람 부수기..?', kind: 'snowman' };
    // 스키 장갑 눈싸움: 포탈·눈사람 확인·하던 낚시·벌레 다음. 뭉친 눈이 있으면 던지기가 새 낚시보다 먼저고, 뭉치기는 낚시를 던질 수 있는 자리면 양보한다 (얼음 구멍 낚시가 그대로 되게)
    const t = this.fishing.targetTile();
    const sf = snowfightAction(this.snowfight.packed, this.snowGate());
    if (sf === 'throw' || (sf === 'pack' && !t)) return { x: me.x, y: me.y - 1, text: sf === 'pack' ? SNOW_PACK_HINT : SNOW_THROW_HINT, kind: 'snowfight' };
    if (t) return { x: t.x, y: t.y, text: 'F 낚시', kind: 'cast' };
    if (this.fishZone && nearZone(this.fishZone, me.x, me.y, 1)) return { x: this.fishZone.x, y: this.fishZone.y - 1, text: 'F 낚시 기록 보기', kind: 'sign' };
    // 오락기 둘이 붙어 있다: 둘 다 닿는 자리에서는 더 가까운 쪽(바로 앞에 선 쪽)을 연다
    const az = this.arcadeZone && nearZone(this.arcadeZone, me.x, me.y, 1) ? this.arcadeZone : null, lz = this.nearLink();
    const zd = (z: Zone) => Math.abs(z.x - me.x) + Math.abs(z.y - me.y);
    if (lz && (!az || zd(lz) < zd(az))) return { x: lz.x, y: lz.y - 1, text: gameLinkOf(lz.id)!.hint, kind: 'link' };
    if (az) return { x: az.x, y: az.y - 1, text: 'F 두더지 잡기', kind: 'arcade' };
    if (this.dig.active) return { x: me.x, y: me.y, text: '삽질 중… (이동하면 취소)', kind: 'digging' };
    const spot = this.dig.spotHere();
    if (spot) return { x: spot.x, y: spot.y, text: 'F 땅 파기', kind: 'dig' };
    const pa = this.photoAhead();
    if (pa) return { x: pa.x, y: 0, text: 'F 사진 보기', kind: 'photo' };
    const tree = this.home.chopTarget();
    if (tree) return { x: tree.x, y: tree.y, text: `F 나무 캐기 (${CHOP_SWINGS}번)`, kind: 'chop' };
    const seat = this.seatAhead();
    if (seat) return { x: seat.x, y: seat.y, text: 'F 앉기', kind: 'sit' };
    return null;
  }
  // 화면에 그릴 안내: 글이 없는 것(나무 캐는 중)은 그리지 않는다
  private shownHint(): ReturnType<World['canvasHint']> { const ch = this.canvasHint(); return ch && ch.text ? ch : null; }
  private updateHint(): void {
    let hint: string | null = null;
    const me = this.me;
    if (me.roomId) {
      const rs = this.rooms[me.roomId];
      const z = this.roomMgr.zoneOf(me.roomId);
      const n = rs?.members ? Object.keys(rs.members).length : 1;
      hint = this.hud.mobile ? null : `${z?.label || '방'} ${n}/${z?.cap || '?'} · 오른쪽 판에서 배팅 · 나가려면 판의 나가기${me.roomId === 'poker' ? '' : ' (F 로 판 열기/닫기)'}`; // 모바일은 판이 화면을 덮는다
    } else { const ch = this.canvasHint(); if (ch && ch.text) hint = ch.text; }
    if (hint !== this.lastHint) { this.lastHint = hint; this.hud.setHint(hint); }
  }
  // 방 안에 있는 동안 그 방의 판을 띄운다 (나가면 닫힘). F 로 잠깐 닫을 수 있다. 방 id 마다 판이 정해져 있다: casino 경마장 · slots 슬롯 방 · poker 포커 방
  private casinoHidden = false;
  private syncCasinoPanel(): void {
    const room = this.me.roomId;
    // 포커 방은 F 로 접지 않는다: 판을 닫으면 진행 중인 판이 다이 처리되기 때문이다
    const want = !room ? null : room === 'poker' ? this.pokerPanel : this.casinoHidden ? null : room === 'slots' ? this.slotPanel : room === 'casino' ? this.casinoPanel : null;
    for (const p of [this.casinoPanel, this.slotPanel, this.pokerPanel]) if (p !== want && p.open) p.hide();
    if (want && !want.open) want.show();
    if (!room) this.casinoHidden = false;
  }
  interact(): void {
    if (this.switching) return; // 목적지를 읽는 동안 옛 맵에서 낚시·채집·삽질 등을 시작하지 않는다
    this.winter.resetSlide(); // F 는 빙판 관성을 먼저 멈춘다 (구멍가에서 미끄러지는 중에도 낚시를 던질 수 있게. 걸음이 끝난 뒤 F 가 먹는다)
    if (this.me.roomId) { this.casinoHidden = !this.casinoHidden; this.syncCasinoPanel(); return; }
    const ch = this.canvasHint();
    if (ch?.kind !== 'snowman') this.smash = null; // 눈사람 확인은 연달아 누른 F 두 번만 이어진다: 다른 F 가 끼면 처음부터
    if (!ch) return;
    if (ch.kind === 'mafia') { void this.mafiaInteract(); return; }
    if (ch.kind === 'portal') { const z = portalNear(this.map, this.me.x, this.me.y); if (z) this.openPortal(z); return; }
    if (ch.kind === 'board') { this.input.releaseAll(); openBoard({ uid: this.uid, nick: this.profile.nick, isAdmin: this.isAdmin }); }
    else if (ch.kind === 'fishing') this.fishing.reel();
    else if (ch.kind === 'cast') this.fishing.cast();
    else if (ch.kind === 'bug') { if (this.bugs.swing()) this.doEmote(11); } // 잠자리채 휘두르기 (남들에게도 보임)
    else if (ch.kind === 'dig') { if (this.dig.begin()) this.doEmote(13); }
    else if (ch.kind === 'mine') { if (!this.input.interactRepeat) this.mine.begin(); } // 키를 누르고 있어 반복된 F 로는 치지 않는다 (한 번 누르면 한 번)
    else if (ch.kind === 'chop') { if (!this.input.interactRepeat && this.home.beginChop()) this.doEmote(13); } // 도끼질은 삽질 동작으로 남에게도 보인다
    else if (ch.kind === 'bed') this.home.beginSleep();
    else if (ch.kind === 'dj') { this.input.releaseAll(); this.openDj(); }
    else if (ch.kind === 'sit') this.sit();
    else if (ch.kind === 'sitting') this.leaveSeat();
    else if (ch.kind === 'chest') { this.input.releaseAll(); openHome(this); }
    else if (ch.kind === 'decoPlace') { this.input.releaseAll(); openFurniturePicker(this); }
    else if (ch.kind === 'decoRemove') {
      // 돌릴 수 있는 가구는 방향 고르기·치우기 창을 띄우고, 방향이 없는 가구(화분 등)는 전처럼 바로 치운다
      const fd = this.home.facingDeco();
      if (fd && fd.kind === 'remove' && canTurn(fd.o)) { this.input.releaseAll(); openFurnitureEdit(this, fd.x, fd.y, fd.o); }
      else void this.home.removeFront().then((ok) => { if (!ok) this.toast('치우지 못했습니다.', true); });
    }
    else if (ch.kind === 'snowman') this.smashStep(ch);
    else if (ch.kind === 'snowfight') this.snowfightF();
    else if (ch.kind === 'arcade') { this.input.releaseAll(); openMole({ uid: this.uid, nick: this.profile.nick, wallet: this.wallet, input: this.input, toast: (m, e) => this.toast(m, e), stat: (k) => this.net.stat(k) }); }
    else if (ch.kind === 'sign') { this.input.releaseAll(); this.openFishBook(); }
    else if (ch.kind === 'link') this.openGameLink();
    else if (ch.kind === 'photo') this.openPhoto();
  }
  // 바깥 게임 오락기 가운데 가장 가까운 것 (옆 1칸, 대각선 포함)
  private nearLink(): Zone | null {
    const me = this.me;
    let best: Zone | null = null, bd = 9;
    for (const z of this.linkZones) { if (!nearZone(z, me.x, me.y, 1)) continue; const d = Math.abs(z.x - me.x) + Math.abs(z.y - me.y); if (d < bd) { bd = d; best = z; } }
    return best;
  }
  // 확인 창의 링크를 직접 눌러 새 탭으로 연다 (F 에서 바로 열면 폰 브라우저가 팝업으로 보고 막을 때가 있다). 이 탭의 게임은 그대로 켜져 있다
  private openGameLink(): void {
    const z = this.nearLink(), g = gameLinkOf(z?.id);
    if (!g) return;
    this.input.releaseAll();
    const a = el('a', { class: 'btn primary', href: g.url, target: '_blank', rel: 'noopener noreferrer', text: '새 탭에서 열기', style: 'display:inline-block;text-decoration:none;margin-top:6px' });
    const body = el('div', {}, [el('p', { text: g.desc }), el('p', { class: 'muted', style: 'font-size:12px', text: '다른 사이트라 새 탭에서 열려요. MawaVerse 는 이 탭에 그대로 켜져 있어요.' }), a]);
    const m = modal(`🎮 ${g.name}`, body, [{ label: '닫기', onClick: () => {} }]);
    a.addEventListener('click', () => m.close());
  }
  // 마피아 F: 처치 / 미션 시작(누르고 있는 동안 tick 이 진행) / 신고 / 긴급 소집
  private async mafiaInteract(): Promise<void> {
    const a = this.mafia.action(); if (!a) return;
    if (a.kind === 'kill') { if (await this.mafia.kill(a.uid)) { this.doEmote(10); this.toast(`🔪 ${a.nick} 처치`); } }
    else if (a.kind === 'task') this.mafia.beginTask(a.spot, a.fake);
    else if (a.kind === 'fire') this.mafia.beginFire(a.spot, a.i);
    else if (a.kind === 'report') { if (await this.mafia.report(a.uid)) this.toast('🩸 시체를 신고했습니다! 회의가 열립니다.'); }
    else if (a.kind === 'button') { if (await confirmModal('긴급 소집을 할까요? 한 게임에 한 번만 쓸 수 있어요.')) { if (await this.mafia.callMeeting()) this.toast('🚨 긴급 소집!'); } }
  }
  doEmote(id: number): void {
    if (this.switching) return; // 맵을 옮기는 중에는 밀치기·끌기·이모트를 보내지 않는다
    const me = this.me;
    const now = performance.now();
    if ((id === 10 || id === 14) && me.roomId) { this.toast('🎰 카지노 안에서는 밀치기·끌기를 쓸 수 없습니다.', true); return; }
    if ((id === 10 || id === 14) && this.home.safeHere()) { this.toast('🧱 벽돌집 안에서는 밀치기·끌기를 쓸 수 없습니다.', true); return; }
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
        const plan = assignBats(all.map((rp) => guardedOf(rp.st, 'push', serverNow())), this.wallet.batsReady(), this.wallet.darksReady());
        const targets = all.filter((rp, i) => { if (plan[i].blocked) { rp.blockAt = now; return false; } return true; }).map((rp) => ({ rp, bat: plan[all.indexOf(rp)].kind }));
        if (!targets.length) { this.toast('🛡 모두 방어 중이라 밀리지 않습니다. (상점의 빠따로 깰 수 있어요)', true); return; }
        me.lastPushAt = now;
        this.batReport(this.net.pushMany(targets.map((t) => ({ uid: t.rp.uid, bat: t.bat })), dx, dy), targets.map((t) => ({ rp: t.rp, kind: t.bat })));
        for (const t of targets) this.toss.wave(me.x, me.y, Math.round(t.rp.x), Math.round(t.rp.y));
      } else {
        const target = this.playerAt(me.x + dx, me.y + dy);
        if (!target) { this.toast('앞에 밀 사람이 없습니다. 상대를 바라보고 붙어서 사용하세요.', true); return; }
        if (target.st.r) { this.toast('🎰 카지노 안에 있는 사람은 건드릴 수 없습니다.', true); return; }
        // 철벽 갑옷을 입은 상대는 안 밀린다: 보내지 않고 🛡 만 (쿨타임도 안 씀)
        // 다만 빠따가 있으면 하나 써서 방어를 깨고 민다 (2026-11-11)
        const guarded = guardedOf(target.st, 'push', serverNow());
        const bat = guarded ? this.wallet.nextBat() : 0; // 어둠의 빠따가 있으면 그것부터 (2)
        if (guarded && !bat) { target.blockAt = now; this.toast(`🛡 ${target.st.n} 은(는) ${target.st.pa ? '철벽 갑옷을 입고 있어' : '펫이 지켜 줘서'} 밀리지 않습니다. (상점의 빠따로 깰 수 있어요)`, true); return; }
        me.lastPushAt = now;
        this.batReport(this.net.push(target.uid, dx, dy, bat), [{ rp: target, kind: bat }]);
      }
    }
    if (id === 14 && !this.pull(now)) return;
    me.pose = poseForEmote(id); me.poseAt = now; me.emoteId = id;
    this.net.emote(id);
    if (id === 10 && !this.profile.own?.wave) sfx('push'); else if (id === 14) sfx('pull'); // 장풍·갈고리·말랑이 소리는 날아가는 그림(toss.ts)이 낸다
  }
  // 빠따를 쓴 결과를 한 줄로 알린다 (2026-11-20 고침). 전에는 보내자마자 "방어를 깼다"고 알렸다: 쓰기가 거부됐거나 상대 화면이 멈춰 있어 아무 일이 없었어도 그렇게 떴다.
  // 지금은 BAT_CHECK_MS 뒤에 상대의 접속 표시를 보고 정한다: 방어 깨짐(gb)이 켜졌으면 깨짐, 든든함(sd)이 줄었으면 든든함에 막힘, 둘 다 아니면 통하지 않음.
  // ok: 그 쓰기가 받아들여졌나 (Net 의 보내기 함수가 돌려준다). hits: 겨냥한 사람과 쓴 빠따 종류 (0 은 빠따 없이 보낸 사람)
  // wait: 닿을 때까지 걸리는 시간 (말랑이가 날아가는 시간)
  batReport(ok: Promise<boolean>, hits: { rp: RemotePlayer; kind: BatKind }[], wait = 0): void {
    const used = hits.filter((h) => h.kind).map((h) => ({ uid: h.rp.uid, sd: h.rp.st.sd || 0 }));
    if (!used.length) return;
    const dark = hits.every((h) => !h.kind || h.kind === 2);
    void ok.then((sent) => {
      if (this.stopped) return;
      if (!sent) { this.note(batResultText({ dark, failed: true, n: used.length, left: 0 })); return; }
      window.setTimeout(() => {
        if (this.stopped) return;
        const now = serverNow();
        let broke = 0, shielded = 0;
        for (const u of used) { const st = this.players.get(u.uid)?.st; if (st && (st.sd || 0) < u.sd) shielded++; else if (st && guardBrokenOf(st, now)) broke++; }
        this.note(batResultText({ dark, n: used.length, broke, shielded, left: dark ? this.wallet.darks : this.wallet.bats }));
      }, BAT_CHECK_MS + wait);
    });
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
      const bat = guarded ? this.wallet.nextBat() : 0; // 빠따가 있으면 하나 써서 방어를 깨고 끈다 (어둠의 빠따가 먼저)
      if (guarded && !bat) { front.blockAt = now; this.toast(`🛡 ${front.st.n} 은(는) ${front.st.pa ? '철벽 갑옷을 입고 있어' : '펫이 지켜 줘서'} 끌리지 않습니다. (상점의 빠따로 깰 수 있어요)`, true); return false; }
      // 물러설 자리: 뒤 → 옆(두 방향). 방 안팎을 넘나들지는 않는다
      const back: [number, number][] = dx !== 0 ? [[me.x - dx, me.y], [me.x, me.y - 1], [me.x, me.y + 1]] : [[me.x, me.y - dy], [me.x - 1, me.y], [me.x + 1, me.y]];
      const spot = back.find(([x, y]) => this.canStep(x, y) && roomAt(this.map, x, y) === myRoom);
      if (!spot) { this.toast('물러설 자리가 없어 끌 수 없습니다.', true); return false; }
      me.lastPushAt = now;
      const ox = me.x, oy = me.y, uid = front.uid;
      // 내 걸음(점유 이동)이 서버에 반영된 뒤에 끌기를 보낸다: 상대가 내 옛 자리로 올 때 점유가 비어 있어야 한다
      this.startStep(spot[0], spot[1], undefined, { onDone: (ok) => { if (ok) this.batReport(this.net.pull(uid, ox, oy, false, bat), [{ rp: front, kind: bat }]); } });
      return true;
    }
    if (!this.profile.own?.hook) { this.toast('앞에 끌 사람이 없습니다. 상대를 바라보고 붙어서 사용하세요. (갈고리가 있으면 앞 4칸 안에서 끌어옵니다)', true); return false; }
    const fx = me.x + dx, fy = me.y + dy;
    if (!this.canStep(fx, fy) || roomAt(this.map, fx, fy) !== myRoom) { this.toast('앞 칸이 막혀 있어 끌어올 수 없습니다.', true); return false; }
    const all: RemotePlayer[] = [];
    for (const [x, y] of frontTiles(me.x, me.y, dx, dy)) { const rp = this.playerAt(x, y); if (rp && !rp.st.r && !all.includes(rp)) all.push(rp); }
    if (!all.length) { this.toast('앞 4칸 안에 끌어올 사람이 없습니다. 상대 쪽을 바라보고 쓰세요.', true); return false; }
    // 방어 중인 사람은 빠따가 있을 때만 후보에 든다 (걸리면 빠따 하나를 써서 깨고 끌어온다)
    const hasBat = this.wallet.nextBat() > 0;
    const targets = all.filter((rp) => hasBat || !guardedOf(rp.st, 'push', serverNow()));
    if (!targets.length) { for (const rp of all) rp.blockAt = now; this.toast('🛡 모두 방어 중이라 끌리지 않습니다. (상점의 빠따로 깰 수 있어요)', true); return false; }
    const target = targets[Math.floor(Math.random() * targets.length)];
    const hookBat = guardedOf(target.st, 'push', serverNow()) ? this.wallet.nextBat() : 0;
    me.lastPushAt = now;
    this.batReport(this.net.pull(target.uid, fx, fy, true, hookBat), [{ rp: target, kind: hookBat }]);
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
    items.push({ label: '🎲 주사위 대결 신청', onClick: () => this.duel.openChallenge(uid, 'dice') });
    items.push({ label: '🎣 낚시 내기 신청', onClick: () => this.duel.openChallenge(uid, 'fish') });
    items.push({ label: '🏡 집 구경 가기', onClick: () => void this.goHome(uid) });
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
      { label: `✏ 닉네임 변경${this.wallet.owns(NICK_TICKET.id) ? ' (🎟 교환권 있음)' : ''}`, onClick: () => this.changeNickFlow() },
      { label: `🎨 외모 변경${this.wallet.owns(AVATAR_TICKET.id) ? ' (🎟 교환권 있음)' : ''}`, onClick: () => this.changeAvatarFlow() },
      { label: '📖 도감 · 내 기록', onClick: () => this.openFishBook() },
      { label: '🛍 상점', onClick: () => this.openShop() },
      { label: '📈 거래소', onClick: () => this.openStock() },
      { label: this.home.tier ? `🏠 내 집 (${homeTier(this.home.tier)?.name})` : '🏠 내 집 짓기', onClick: () => openHome(this) },
      ...(isHomeMapId(this.mapId) ? [{ label: homeOwnerOf(this.mapId) === this.uid ? '📖 내 집 방명록' : '📖 이 집 방명록 쓰기', onClick: () => openGuestbook(this, homeOwnerOf(this.mapId)) }] : []),
      // 만렙 펫: 타고 다닐지 내려서 데리고 다닐지 (2026-11-12 건의 반영). 모습만 바뀌고 펫 효과는 같다
      ...(this.petRide.canRide() ? [{ label: this.wallet.rideOn() ? '🐾 펫에서 내리기 (데리고 다니기)' : '🏇 펫 타기', onClick: () => { const on = !this.wallet.rideOn(); void this.wallet.setRide(on); this.toast(on ? '🏇 펫을 탔습니다.' : '🐾 펫에서 내렸습니다. 뒤에서 따라옵니다.'); } }] : []),
      { label: this.wallet.rouletteDoneToday() ? '🎰 오늘의 룰렛 (돌렸음)' : '🎰 오늘의 룰렛', onClick: () => this.openRoulette() },
      { label: '🗺 오늘의 보물 지도', onClick: () => { if (this.mapId !== MAIN_MAP_ID) { this.toast('보물 지도는 광장 맵에서만 볼 수 있어요.', true); return; } openDigMap(this.mainMap, this.dig.spots, this.dig.dug, { x: this.me.x, y: this.me.y }); } },
      { label: '🏠 리스폰 (시작 지점으로)', onClick: () => this.respawnFlow() },
      { label: soundOn() ? '🔊 소리 설정' : '🔇 소리 설정 (꺼짐)', onClick: () => this.openSoundSettings() },
      { label: this.dayOff ? '🌙 낮밤 효과 켜기' : '🌙 낮밤 효과 끄기', onClick: () => { this.dayOff = !this.dayOff; try { localStorage.setItem('mv-daylight-off', this.dayOff ? '1' : '0'); } catch { /* ignore */ } this.toast(this.dayOff ? '🌙 낮밤 효과를 껐습니다. 언제나 낮처럼 보여요.' : '🌙 낮밤 효과를 켰습니다. 실제 시각에 따라 하늘빛이 바뀌어요.'); } },
      ...(wakeLockSupported() ? [{ label: wakeLockOn() ? '📱 화면 꺼짐 방지 끄기' : '📱 화면 꺼짐 방지 켜기', onClick: async () => { const on = !wakeLockOn(); const ok = await setWakeLock(on); this.toast(!on ? '📱 화면 꺼짐 방지를 껐습니다.' : ok ? '📱 화면 꺼짐 방지를 켰습니다. 게임을 띄워 둔 동안 화면이 꺼지지 않아요. (배터리를 더 씁니다)' : '화면 꺼짐 방지를 켜지 못했어요. 기기가 배터리 절약 중일 수 있어요.', on && !ok); } }] : []),
      { label: this.mafia.game ? (this.mafia.game.st === 'lobby' ? '🕵 마피아 (모집 중!)' : '🕵 마피아 (진행 중)') : '🕵 마피아 모집', onClick: () => openMafiaLobby(this) },
      ...(this.campfire.burningMine() ? [{ label: '🔥 내 모닥불 끄기', onClick: async () => { const ok = await this.campfire.putOut(); this.toast(ok ? '모닥불을 껐어요.' : '끄지 못했습니다.', !ok); } }]
        : this.campfire.owns() ? [{ label: `🔥 모닥불 피우기 (나무 ${CAMPFIRE_WOOD}개)`, onClick: () => { void this.lightCampfire(); } }] : []),
    ];
    items.push({ label: this.duel.optedOut() ? '🎲 내기 신청 받기 (지금: 안 받음)' : '🚫 내기 신청 받지 않기', onClick: () => { const on = !this.duel.optedOut(); this.duel.setOptOut(on); this.toast(on ? '🚫 내기 신청을 받지 않습니다.' : '🎲 내기 신청을 다시 받습니다.'); } });
    items.push({ label: '🔑 비밀번호 변경', onClick: () => this.changePasswordFlow() });
    items.push({ label: '🚪 회원 탈퇴', danger: true, onClick: () => this.withdrawFlow() });
    items.push({ label: '⏻ 로그아웃', danger: true, onClick: () => this.logoutFlow() });
    contextMenu(x, y, `${this.profile.nick} (나)`, items);
  }
  // 내 메뉴 → 모닥불 피우기 (2026-11-20): 키트를 가진 사람이 바깥에서 자기 앞 칸에. 나무가 든다
  private async lightCampfire(): Promise<void> {
    const wood = this.home.wood;
    const r = await this.campfire.light(wood, this.outdoors());
    const msg: Record<string, string> = { ok: '🔥 모닥불을 피웠어요. 10분 동안 타요.', noitem: '모닥불 키트가 있어야 해요. (상점 → 장비)', nowood: `나무가 ${CAMPFIRE_WOOD}개 있어야 해요. (지금 ${wood}개. 나무를 보고 F 로 캘 수 있어요)`, indoor: '모닥불은 바깥에서만 피울 수 있어요.', blocked: '바로 앞 칸이 비어 있어야 해요. (물·벽·사람·다른 불이 없는 칸)', have: '내 모닥불이 이미 타고 있어요.', fail: '피우지 못했습니다.' };
    this.toast(msg[r], r !== 'ok');
    if (r === 'ok') sfx('on');
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
    // 변경 요금 (2026-11-17): 바뀐 뒤에 낸다 (이미 있는 닉네임이라 실패했을 때 돈만 나가지 않게). 모자라면 시작하지 않는다
    // 선물받은 교환권이 있으면 요금 대신 그것을 쓴다 (2026-11-17)
    const ticket = this.wallet.owns(NICK_TICKET.id);
    const fee = ticket ? 0 : priceOf(NICK_FEE, this.config.prices);
    const n = await promptModal(ticket ? '닉네임 변경 (🎟 교환권 사용)' : fee > 0 ? `닉네임 변경 (${fmtCoins(fee)})` : '닉네임 변경', '새 닉네임 (2~12자, 공백 없이)', this.profile.nick, 12);
    if (n === null || n.trim() === this.profile.nick) return;
    if (this.wallet.balance < fee) { this.toast(`코인이 모자랍니다. 닉네임 변경은 ${fmtCoins(fee)} 입니다.`, true); return; }
    try {
      const nn = await changeNick(this.uid, this.profile.nick, n, true);
      this.profile.nick = nn;
      if (ticket) await this.wallet.useTicket(NICK_TICKET.id); else if (fee > 0) await this.wallet.payFee(NICK_FEE.id, fee);
      this.toast(`닉네임이 '${nn}'(으)로 바뀌었습니다.${ticket ? ' (🎟 교환권 사용)' : fee > 0 ? ` (-${fmtCoins(fee)})` : ''}`);
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
    const text = `🎁 ${g.fn || '누군가'} 님이 ${it ? `${it.icon} ${it.name}` : g.i}을(를) 선물했어요!${g.m ? ` “${g.m}”` : ''} ${it?.kind === 'ticket' ? '(내 메뉴의 외모·닉네임 변경에서 쓸 수 있어요)' : '(상점에서 착용)'}`;
    this.toast(text);
    this.events.emit('log', { channel: 'notice', from: '', text, ts: g.at });
  }
  openFishBook(): void { openFishBook({ uid: this.uid, nick: this.profile.nick, contest: this.contest, catchLog: this.catchLog }); }
  openRoulette(): void {
    this.input.releaseAll();
    openRoulette({ uid: this.uid, nick: this.profile.nick, wallet: this.wallet, toast: (m, e) => this.toast(m, e), log: (t) => this.chat.systemMessage(t), stat: (k) => this.net.stat(k) });
  }
  // 클럽 DJ (2026-11-19, 사용자 요청): DJ 자리에서 F → 유튜브 링크를 넣어 클럽에 있는 모두에게 튼다. 한 곡씩 덮어쓴다
  private openDj(): void {
    const cur = this.dj.state;
    const input = el('input', { type: 'text', maxlength: '200', placeholder: 'https://youtu.be/…' });
    const body = el('div', { class: 'field' }, [
      el('label', { text: '유튜브 링크를 붙여 넣으세요. 클럽에 있는 모두에게 같은 지점부터 나옵니다.' }), input,
      el('div', { class: 'muted', style: 'font-size:12px;line-height:1.5;margin-top:6px', text: `${cur ? `지금은 ${cur.n} 님이 튼 노래가 나오고 있어요. 새로 틀면 바뀝니다. ` : ''}공식 뮤직비디오 가운데에는 다른 사이트에서 재생이 막힌 것이 있어요. 누가 무엇을 틀었는지는 관리자가 볼 수 있습니다.` }),
    ]);
    const play = async (): Promise<void> => {
      const r = await this.dj.play(input.value);
      if (r === 'ok') { this.toast('🎧 노래를 틀었습니다.'); m.close(); }
      else this.toast(r === 'bad' ? '유튜브 링크가 아니에요. 영상 주소를 붙여 넣어 주세요.' : r === 'spot' ? 'DJ 자리에 서 있어야 틀 수 있어요.' : '틀지 못했습니다. 방금 바뀌었다면 5초 뒤에 다시 해 보세요.', true);
    };
    const m = modal('🎧 노래 틀기', body, [
      { label: '닫기', onClick: () => {} },
      ...(cur ? [{ label: '끄기', danger: true, onClick: async () => { if (await this.dj.off()) this.toast('🎧 노래를 껐습니다.'); else this.toast('끄지 못했습니다.', true); } }] : []),
      { label: '틀기', primary: true, keep: true, onClick: play },
    ]);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void play(); e.stopPropagation(); });
    window.setTimeout(() => input.focus(), 50);
  }
  // 거래소 (2026-11-19, 건의 반영): 내 메뉴에서 연다
  openStock(): void {
    this.input.releaseAll();
    openStock({ stock: this.stock, balance: () => this.wallet.balance, toast: (m, e) => this.toast(m, e), onWallet: (fn) => this.wallet.listen(fn) });
  }
  openShop(): void {
    this.input.releaseAll();
    openShop({
      uid: this.uid, profile: this.profile, wallet: this.wallet, config: this.config, toast: (m, e) => this.toast(m, e),
      onlineList: () => [...this.players.values()].map((p) => ({ uid: p.uid, nick: p.st.n })),
      previewFx: (id) => this.previewFx(id),
      namePet: (id) => { void this.petNameFlow(id); },
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
    const ticket = this.wallet.owns(AVATAR_TICKET.id); // 선물받은 교환권이 있으면 요금 대신 그것을 쓴다
    const fee = ticket ? 0 : priceOf(AVATAR_FEE, this.config.prices); // 변경 요금 (2026-11-17). 같은 외모를 그대로 두면 안 낸다
    const body = avatarPicker(sel, (id) => { sel = id; });
    modal(ticket ? '외모 변경 (🎟 교환권 사용)' : fee > 0 ? `외모 변경 (${fmtCoins(fee)})` : '외모 변경', body, [
      { label: '취소', onClick: () => {} },
      { label: ticket ? '적용 (🎟 교환권 사용)' : fee > 0 ? `적용 (${fmtCoins(fee)})` : '적용', primary: true, onClick: () => { // 누르는 단추에 값을 적는다 (2026-11-18: 값이 드는 줄 모르고 누른다는 말이 있었다)
        if (sel === this.profile.avatar) return;
        if (this.wallet.balance < fee) { this.toast(`코인이 모자랍니다. 외모 변경은 ${fmtCoins(fee)} 입니다.`, true); return; }
        this.profile.avatar = sel; this.net.setAvatar(sel);
        if (ticket) void this.wallet.useTicket(AVATAR_TICKET.id); else if (fee > 0) void this.wallet.payFee(AVATAR_FEE.id, fee);
        this.toast(`외모를 바꿨습니다.${ticket ? ' (🎟 교환권 사용)' : fee > 0 ? ` (-${fmtCoins(fee)})` : ''}`);
      } },
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
  // 펫 이름 짓기 (2026-11-20 건의): 상점의 펫 카드에서. 지을 때마다 요금, 이름을 없애는 것은 무료. 바뀐 뒤에 낸다 (실패했을 때 돈만 나가지 않게)
  private async petNameFlow(petId: string): Promise<void> {
    const it = itemById(petId);
    if (!it || !this.wallet.owns(petId)) return;
    const cur = this.wallet.petName(petId), fee = priceOf(PET_NAME_FEE, this.config.prices);
    const v = await promptModal(`✏ ${it.icon} ${it.name} 이름${fee > 0 ? ` (${fmtCoins(fee)})` : ''}`, `이름 (${PET_NAME_MAX}자까지. 비우면 이름을 없애요)`, cur, PET_NAME_MAX);
    if (v === null) return;
    const name = cleanPetName(v);
    if (name === cur) return;
    if (name && this.wallet.balance < fee) { this.toast(`코인이 모자랍니다. 펫 이름 짓기는 ${fmtCoins(fee)} 입니다.`, true); return; }
    if (!(await this.wallet.setPetName(petId, name || null))) { this.toast('이름을 바꾸지 못했습니다.', true); return; }
    if (name && fee > 0) await this.wallet.payFee(PET_NAME_FEE.id, fee);
    this.toast(name ? `${it.icon} 이제 이름은 “${name}”!${fee > 0 ? ` (-${fmtCoins(fee)})` : ''}` : `${it.icon} 이름을 없앴어요.`);
  }
  private async showProfile(uid: string): Promise<void> {
    const rp = this.players.get(uid);
    // 2026-11-20 건의: 낚싯대·강화 성·칭호·집·갑옷도 보여 준다. 낚싯대 종류는 보유 목록(누구나 읽을 수 있다), 성은 presence 의 rs, 집은 homes 의 단계
    const [fish, own, ht] = await Promise.all([
      fishSummaryOf(uid),
      get(ref(db, `users/${uid}/own`)).then((s) => (s.val() || {}) as Record<string, true>).catch(() => ({} as Record<string, true>)),
      get(ref(db, `homes/${uid}/t`)).then((s) => s.val() as unknown).catch(() => null),
    ]);
    const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const pet = rp?.st.pt ? itemById(rp.st.pt) : null;
    const pn = cleanPetName(rp?.st.pn);
    const petTxt = pet ? `펫: ${pet.icon} ${pet.name}${pn ? ` “${esc(pn)}”` : ''} Lv.${petLevel(rp?.st.pl || 0)}${petRiding(rp?.st.pl || 0, rp?.st.nr) ? ' (탑승 중)' : petGuard(rp?.st.pl || 0) ? ' (방어)' : ''}<br>` : '';
    const tier = rodTierOf(own), rod = tier > 0 ? ROD_GOODS[tier - 1] : null, rs = typeof rp?.st.rs === 'number' ? rp.st.rs : 0;
    const rodTxt = `낚싯대: ${rod ? `${rod.icon} ${rod.name}${rs > 0 ? ` ★${rs}` : ''}` : '기본 낚싯대'}${own.iceRod ? ' · 🧊 얼음 낚싯대' : ''}<br>`;
    const title = rp?.st.tt ? itemById(rp.st.tt) : null, home = homeTier(ht);
    const more = `${title ? `칭호: ${title.icon} ${esc(title.name)}<br>` : ''}${home ? `집: ${home.icon} ${home.name}<br>` : ''}${rp?.st.pa || rp?.st.ta ? `갑옷: ${[rp?.st.pa ? '🛡 철벽' : '', rp?.st.ta ? '🧥 푹신' : ''].filter(Boolean).join(' · ')}<br>` : ''}`;
    const body = el('div', { html: `<p><b>${esc(this.nickOf(uid))}</b></p><p class="muted">${rodTxt}${petTxt}${more}${fish}</p>` });
    modal('프로필', body, [{ label: '닫기', onClick: () => {} }]);
  }

  // ---------- 종료 ----------
  private async stop(replaced = false): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    stopSound();
    clearInterval(this.bgTimer); document.removeEventListener('click', this.onUiClick, true);
    this.snowfight.reset();
    clearInterval(this.hoursTimer); this.hoursUnsub?.(); this.hoursUnsub = null;
    this.engine.stop();
    this.chat.stop(); this.roomMgr.stop(); this.fishing.stop(); this.home.stop(); this.trees.stop(); this.campfire?.stop(); this.snowmen?.stop(); this.wallet.stop(); this.stock.stop(); this.dj.stop(); this.djPanel?.close(); this.contest.stop(); this.snowPenalty.stop(); this.bugs.stop(); this.dig.stop(); this.casino.stop(); this.duel.stop(); this.casinoPanel.hide(); this.slotPanel.hide(); this.pokerPanel.hide(); this.mafia.stop(); this.mafiaHud.clear(); this.rouletteUnsub?.();
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
