import type { TossMsg } from '../shared/types';
import type { UserProfile as _UP } from '../shared/types';
import {
  ref, set, update, get, remove, onValue, onChildAdded, onChildChanged, onChildRemoved, onDisconnect, push, serverTimestamp, increment,
} from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow, mergeConfig } from '../firebase/db';
import { STEP_MS, HEARTBEAT_MS, STALE_MS, AFK_AFTER_MS, CLIENT_VERSION, HOOK_SLIDE_MS } from '../shared/config';
import type { Dir, PlayerState, PushEvent, PullEvent, TpEvent } from '../shared/types';
import { dayKey } from '../shared/util';
import { poseForEmote } from './render';
import { inFront, dirVec } from './area';
import type { WorldCtx, RemotePlayer } from './state';
import { MAIN_MAP_ID, occupancyKey, playerMapId } from '../shared/maps';
import { lastPosOf, mapSwitchUpdate } from './portal';
import { snowActive } from '../shared/snowpenalty';
import { batGuardField } from '../shared/shop';

// 착용 중인 꾸미기를 presence 에 싣는다 (짧은 키). 규칙이 "가진 것만" 허용하므로 보유 목록에 없는 건 뺀다 (어긋난 데이터로 입장이 막히지 않게)
// pl: 데리고 있는 펫의 누적 먹이 (지갑 px 값. 규칙이 지갑과 대조). 펫이 없으면 싣지 않는다
function cosmetics(p: _UP, petXp: (id: string) => number): Pick<PlayerState, 'h' | 'nc' | 'fx' | 'pt' | 'pl' | 'pa' | 'ta' | 'nr'> {
  const own = p.own || {};
  const has = (id?: string | null) => (id && own[id] ? id : null);
  const pt = has(p.eq?.pt);
  return { h: has(p.eq?.h), nc: has(p.eq?.nc), fx: has(p.eq?.fx), pt, ...(pt && petXp(pt) > 0 ? { pl: petXp(pt) } : {}), pa: p.eq?.pa && own.pusharmor ? true : null, ta: p.eq?.ta && own.tossarmor ? true : null, nr: p.eq?.nr ? true : null };
}

export class Net {
  private unsubs: (() => void)[] = [];
  private leaveLogKey: string | null = null;
  private lastDirWrite = 0;
  private lastPosSave = 0;
  private joinTs = 0;
  private hbTimer = 0;
  private sweepTimer = 0;
  private reclaimTimer = 0;
  private leaving = false;
  private afk = false;      // 탭이 AFK_AFTER_MS 넘게 뒤에 있어 💤 를 켠 상태
  private afkTimer = 0;
  // 복귀 직후 재동기화 창(2026-11-09): 폰에서 다른 앱에 갔다 오면 연결이 끊겨 있던 동안의 변화가 한꺼번에 들어온다. 그 동안(그리고 뒤쪽에 있는 동안)은
  // 유령 정리와 입퇴장 알림을 멈춘다. 안 그러면 옛 하트비트를 보고 모두를 퇴장 처리했다가 서버가 거부해 다시 입장한 것처럼 보였다
  private quietUntil = 0;   // performance.now 기준. 0 이면 창이 아님
  // 하트비트가 이 시간 넘게 없으면 접속 끊긴 것으로 본다 (규칙의 120초와 같아야 함). 테스트에서 줄일 수 있게 필드로 둠
  staleMs = STALE_MS;

  constructor(private w: WorldCtx) {}

  private playerRef() { return ref(db, `players/${this.w.uid}`); }
  // 지금 맵에서의 내 자리 키
  private occKey(x: number, y: number) { return occupancyKey(this.w.mapId, x, y); }
  private mapField(): Pick<PlayerState, 'm'> { return this.w.mapId === MAIN_MAP_ID ? {} : { m: this.w.mapId }; }
  // 내기 신청을 받지 않는다는 표시 (DuelMgr 가 켜고 끈다. 재등록 때도 다시 싣는다)
  private noDuel = false;
  setNoDuel(on: boolean): void { this.noDuel = on; set(ref(db, `players/${this.w.uid}/nd`), on ? true : null).catch(() => {}); }
  private duelField(): Pick<PlayerState, 'nd'> { return this.noDuel ? { nd: true } : {}; }
  private guardField(): Pick<PlayerState, 'gb'> { return batGuardField(this.w.guardUntil, serverNow()); } // 빠따에 맞아 방어가 깨져 있는 동안 (눈사람 벌칙만으로는 싣지 않는다: sn 이 따로 간다)
  // 눈사람 부순 벌칙(users/{uid}/snowBrokenAt)을 presence sn 에 싣는다. 규칙이 벌칙 중에는 sn 을 저장된 시각과 같게 요구하고 빼는 것을 막는다.
  // snowAt: 알려진 저장 시각(입장 전에 알게 되면 여기 두었다가 join/reclaim 이 통째로 싣는다 — 노드가 없을 때 sn 만 따로 쓰면 유령 노드가 생긴다), snowSent: presence 에 실려 있는 값(0 = 없음)
  private snowAt = 0;
  private snowSent = 0;
  private joined = false;
  private snowField(): Pick<PlayerState, 'sn'> { return snowActive(this.snowAt, serverNow()) ? { sn: this.snowAt } : {}; }
  // 저장된 시각이 바뀌었다 (SnowPenaltyMgr 의 onChange). 입장 전이면 기억만 한다. 걸음마다 부르지 않는다
  setSnowPenalty(brokenAt: number): void {
    if (brokenAt === this.snowAt) return;
    this.snowAt = brokenAt;
    if (this.joined && !this.leaving) this.writeSnow();
  }
  // presence 의 sn 을 지금 상태에 맞춘다 (벌칙 중이면 저장 시각, 끝났으면 지움). 이미 맞으면 extra 만 쓴다. 하트비트가 extra 로 실리고, 끝난 sn 을 거두는 일도 여기서 한다 (별도 타이머 없음)
  private writeSnow(extra: Record<string, unknown> = {}): void {
    const want = snowActive(this.snowAt, serverNow()) ? this.snowAt : 0;
    const patch = want === this.snowSent ? extra : { ...extra, sn: want || null };
    if (!Object.keys(patch).length) return;
    update(this.playerRef(), patch).then(() => { if ('sn' in patch) this.snowSent = want; }).catch(() => {});
  }
  // 눈사람 벌칙 중이면 갑옷·펫 방어가 없다 (World.guardBroken 과 같은 뜻. 월드가 못 알려도 받는 쪽에서 한 번 더 막는다)
  private snowOpen(): boolean { return snowActive(this.w.snowBrokenAt, serverNow()); }
  private guardOpen(): boolean { return this.snowOpen() || this.w.guardBroken(); }
  private pendingSteps = 0;  // 서버 답을 기다리는 걸음 수
  private changing = false;  // 맵 이동 쓰기 중 (재등록이 옛 맵 상태로 덮어쓰지 않게)
  // 지금 칸의 occ 가 내 것인가. 입장·재등록 때 자리를 못 잡았으면(남이 먼저) false: 그 칸을 지우려 하면 규칙이 쓰기를 통째로 거부한다
  private ownsOcc = false;
  get stepping(): boolean { return this.pendingSteps > 0 || this.changing; }

  private currentState(): PlayerState {
    const w = this.w;
    return { n: w.profile.nick, a: w.profile.avatar, x: w.me.x, y: w.me.y, d: w.me.dir, s: w.sessionId, e: null, r: w.me.roomId, j: serverNow(), ...cosmetics(w.profile, (id) => w.wallet.petXp(id)), z: this.afk ? true : null, v: CLIENT_VERSION, ...this.mapField(), ...this.guardField(), ...this.snowField(), ...this.duelField() };
  }

  // 월드 입장: 현재 접속자 스냅샷을 읽고 빈 타일을 잡은 뒤 presence 등록
  async join(spawnX: number, spawnY: number, dir: Dir = 0): Promise<void> {
    const w = this.w;
    if (!this.snowAt) this.snowAt = w.profile.snowBrokenAt || 0; // 입장 직전에 읽은 프로필의 저장 시각 (구독이 아직 안 왔어도 규칙이 요구하는 sn 을 싣는다)
    const st: PlayerState = {
      n: w.profile.nick, a: w.profile.avatar, x: spawnX, y: spawnY, d: dir, s: w.sessionId, e: null, r: null, j: serverNow(), ...cosmetics(w.profile, (id) => w.wallet.petXp(id)), v: CLIENT_VERSION, ...this.mapField(), ...this.guardField(), ...this.snowField(), ...this.duelField(),
    };
    await onDisconnect(this.playerRef()).remove();
    // 자리(occ)와 presence 를 한 번에 올린다. 자리는 규칙이 지킨다(비었거나, 내 것이거나, 적힌 사람이 거기 없을 때만). 방금 누가 그 자리를 잡아 거부되면 자리 없이 들어가고 다음 걸음에서 잡는다
    const node = { ...st, hb: serverTimestamp() };
    try { await update(ref(db), { [`occ/${this.occKey(spawnX, spawnY)}`]: w.uid, [`players/${w.uid}`]: node }); this.ownsOcc = true; }
    catch { await set(this.playerRef(), node); this.ownsOcc = false; }
    this.snowSent = st.sn || 0;
    this.joined = true;
    this.writeSnow(); // 노드를 쓰는 동안 저장 시각이 바뀌었으면 맞춘다
    await set(ref(db, `sessions/${w.uid}`), w.sessionId);
    // 입퇴장 로그 (퇴장 로그는 onDisconnect 로 예약)
    const joinLog = push(ref(db, 'logs/conn'));
    await set(joinLog, { u: w.uid, n: w.profile.nick, type: 'join', ts: serverTimestamp() });
    const leaveLog = push(ref(db, 'logs/conn'));
    this.leaveLogKey = leaveLog.key;
    await onDisconnect(leaveLog).set({ u: w.uid, n: w.profile.nick, type: 'leave', ts: serverTimestamp() });
    await update(ref(db, `users/${w.uid}`), { lastLoginAt: serverTimestamp() });
    this.stat('joins');
    this.joinTs = serverNow();
    this.subscribe();
    // presence 하트비트 + 유령 정리. onDisconnect 는 브라우저 강제 종료/모바일 절전/네트워크 단절 때 늦거나 안 올 수 있다
    this.hbTimer = window.setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    this.sweepTimer = window.setInterval(() => this.sweepStale(), 30000);
    window.setTimeout(() => this.sweepStale(), 3000);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.onVisibility(); // 뒤쪽 탭에서 (자동 새로고침 등으로) 들어온 경우에도 자리 비움 타이머가 돌게
  }

  // 탭이 뒤로 가면 1분 뒤 자리 비움(💤)을 켜고, 돌아오면 끈다. 뒤쪽 탭도 접속은 유지된다(자동 낚시가 돌아야 하므로)
  private onVisibility = (): void => {
    if (this.leaving) return;
    const zRef = ref(db, `players/${this.w.uid}/z`);
    if (document.visibilityState === 'visible') {
      clearTimeout(this.afkTimer); this.afkTimer = 0;
      this.beginQuiet();
      if (this.afk) { this.afk = false; set(zRef, null).catch(() => {}); }
      this.heartbeat();
    } else {
      this.flushStats();
      if (this.afk || this.afkTimer) return;
      this.afkTimer = window.setTimeout(() => {
        this.afkTimer = 0;
        if (this.leaving || document.visibilityState === 'visible') return;
        this.afk = true; set(zRef, true).catch(() => {});
      }, AFK_AFTER_MS);
    }
  };

  private heartbeat(): void {
    if (this.leaving) return;
    this.writeSnow({ hb: serverTimestamp() });
  }

  // 복귀 직후: players 를 서버에서 한 번 읽어 재동기화가 끝난 뒤 1.5초까지(최대 15초) 조용히 한다
  private beginQuiet(): void {
    const start = performance.now();
    this.quietUntil = start + 15000;
    const done = () => { this.quietUntil = Math.min(this.quietUntil, performance.now() + 1500); };
    get(ref(db, 'players')).then(done, done);
  }
  // 뒤쪽 탭이거나 복귀 직후 재동기화 창이면 true: 유령 정리·입퇴장 알림을 보류
  private quiet(): boolean { return document.visibilityState !== 'visible' || performance.now() < this.quietUntil; }

  // 하트비트가 끊긴 캐릭터를 화면과 DB에서 제거. 누구나 시도할 수 있고, 규칙이 stale 여부를 서버 시각으로 다시 검증한다
  private sweepStale(): void {
    if (this.leaving || this.quiet()) return; // 뒤쪽 탭·복귀 직후에는 내 캐시가 옛것이라 판단하지 않는다
    const w = this.w;
    const now = serverNow();
    for (const rp of [...w.players.values()]) {
      // hb 가 없는 노드는 하트비트 도입 전 클라이언트가 쓴 것: 살아 있을 수 있으니 입장 후 12시간이 지난 경우에만 정리
      const last = rp.st.hb ?? rp.st.j ?? 0;
      const limit = rp.st.hb ? this.staleMs : 12 * 3600 * 1000;
      if (now - last <= limit) continue;
      w.players.delete(rp.uid);
      w.events.emit('players');
      this.notice(`${rp.st.n} 님이 퇴장했습니다.`);
      update(ref(db), { [`players/${rp.uid}`]: null }).catch(() => {});
      this.clearOccOf(rp);
    }
  }

  // 나간 사람의 점유 타일을 서버 값이 그 사람일 때만 비운다 (occ 에는 onDisconnect 가 없어 강제 종료 시 남는다).
  // 트랜잭션은 로컬 캐시가 비어 있으면 서버에 묻지 않고 중단되므로 get 후 remove 로 처리
  private clearOccOf(rp: RemotePlayer): void {
    const occRef = ref(db, `occ/${occupancyKey(playerMapId(rp.st), rp.toX, rp.toY)}`);
    get(occRef).then((s) => { if (s.val() === rp.uid) return remove(occRef); }).catch(() => {});
  }

  private notice(text: string): void {
    if (this.quiet()) return; // 뒤쪽에 있는 동안·복귀 직후의 입퇴장 알림은 버린다 (돌아왔을 때 쏟아지지 않게)
    this.w.events.emit('log', { channel: 'notice', from: '', text, ts: serverNow() });
  }

  // 내 presence 노드가 사라졌으면(다른 클라이언트의 유령 정리 등) 잠시 뒤 다시 등록
  private reclaim(): void {
    if (this.leaving || this.reclaimTimer) return;
    this.reclaimTimer = window.setTimeout(async () => {
      this.reclaimTimer = 0;
      if (this.leaving) return;
      if (this.changing) { this.reclaim(); return; } // 맵 이동 쓰기가 끝난 뒤에 새 맵 상태로
      const w = this.w;
      try {
        await onDisconnect(this.playerRef()).remove();
        if (this.changing) { this.reclaim(); return; }
        const cur = this.currentState();
        const node = { ...cur, hb: serverTimestamp() };
        try { await update(ref(db), { [`occ/${this.occKey(w.me.x, w.me.y)}`]: w.uid, [`players/${w.uid}`]: node }); this.ownsOcc = true; this.snowSent = cur.sn || 0; }
        catch { await set(this.playerRef(), node); this.ownsOcc = false; this.snowSent = cur.sn || 0; await w.teleportTo(w.me.x, w.me.y); } // 내 자리를 그새 다른 사람이 잡았다: 옆 빈 칸으로
      } catch { /* 다음 정리 주기에 다시 시도됨 */ }
    }, 1500);
  }

  private subscribe(): void {
    const w = this.w;
    const playersRef = ref(db, 'players');
    const apply = (uid: string, st: PlayerState) => {
      if (uid === w.uid) return;
      if (!st || typeof st.x !== 'number' || typeof st.n !== 'string') return; // 나간 사람에게 날아간 밀치기·말랑이가 만든 반쪽 노드는 무시 (정리는 sweepStale 이)
      let rp = w.players.get(uid);
      const now = performance.now();
      if (!rp) {
        rp = { uid, st, x: st.x, y: st.y, fromX: st.x, fromY: st.y, toX: st.x, toY: st.y, prevX: st.x, prevY: st.y, moveStart: 0, moveDur: STEP_MS, lastMoveAt: 0, fishAt: 0, pose: 'none', poseAt: 0, emoteId: 0, bubble: null, pushAt: -1, pushDir: 0, hitAt: -1e9, blockAt: -1e9 };
        w.players.set(uid, rp);
      } else {
        const prev = rp.st;
        if (playerMapId(prev) !== playerMapId(st)) {
          // 다른 맵으로 옮겼다: 보간·펫 자리·말풍선·동작을 옛 맵에서 끌고 오지 않는다
          Object.assign(rp, { x: st.x, y: st.y, fromX: st.x, fromY: st.y, toX: st.x, toY: st.y, prevX: st.x, prevY: st.y, moveStart: 0, lastMoveAt: 0, fishAt: 0, pose: 'none', poseAt: 0, emoteId: 0, bubble: null, pushAt: -1 });
        } else if (st.x !== rp.toX || st.y !== rp.toY) {
          const dist = Math.abs(st.x - rp.toX) + Math.abs(st.y - rp.toY);
          rp.prevX = rp.toX; rp.prevY = rp.toY; // 떠난 칸 (펫이 따라올 자리)
          if (dist > 1) { rp.x = st.x; rp.y = st.y; rp.fromX = st.x; rp.fromY = st.y; }
          else {
            rp.fromX = rp.x; rp.fromY = rp.y; rp.moveStart = now;
            // 상대가 달리면 위치 갱신 간격이 짧다: 그 간격으로 보간해 실제 속도를 따라간다
            const since = rp.lastMoveAt ? now - rp.lastMoveAt : STEP_MS;
            rp.moveDur = Math.max(STEP_MS / 2, Math.min(STEP_MS, since));
          }
          rp.lastMoveAt = now;
          rp.toX = st.x; rp.toY = st.y;
        }
        if (st.e && (!prev.e || st.e.at !== prev.e.at) && serverNow() - st.e.at < 4000) {
          rp.pose = poseForEmote(st.e.t); rp.poseAt = now; rp.emoteId = st.e.t;
        }
        if (st.f && (!prev.f || prev.f.x !== st.f.x || prev.f.y !== st.f.y)) rp.fishAt = now; // 찌 던지는 동작 재생용
        if (st.toss && (!prev.toss || st.toss.t !== prev.toss.t) && serverNow() - st.toss.t < 5000 && w.onMyMap(st)) w.events.emit('toss', uid, st.toss); // 말랑이가 날아간다 (내 맵에서만)
        rp.st = st;
      }
      w.events.emit('players');
    };
    this.unsubs.push(onChildAdded(playersRef, (s) => {
      const st = s.val() as PlayerState;
      apply(s.key!, st);
      // 내가 들어온 뒤에 입장한 사람만 알림 (초기 스냅샷 제외)
      if (s.key !== w.uid && st.j && st.j > this.joinTs - 1000) this.notice(`${st.n} 님이 입장했습니다.`);
    }));
    this.unsubs.push(onChildChanged(playersRef, (s) => apply(s.key!, s.val() as PlayerState)));
    this.unsubs.push(onChildRemoved(playersRef, (s) => {
      const uid = s.key!;
      if (uid === w.uid) { this.reclaim(); return; }
      const rp = w.players.get(uid);
      if (!rp) return;
      w.players.delete(uid);
      w.events.emit('players');
      this.notice(`${rp.st.n} 님이 퇴장했습니다.`);
      this.clearOccOf(rp);
    }));
    // 동일 계정 중복 로그인 감지
    this.unsubs.push(onValue(ref(db, `sessions/${w.uid}`), (s) => {
      const v = s.val();
      if (v && v !== w.sessionId) w.forceLogout('다른 곳에서 로그인되어 연결이 끊어졌습니다.', true);
    }));
    this.unsubs.push(onValue(ref(db, `kicks/${w.uid}`), (s) => {
      const v = s.val() as { ts: number; reason?: string } | null;
      if (v && v.ts > this.joinTs - 5000) w.forceLogout('관리자에 의해 강퇴되었습니다.' + (v.reason ? ` (${v.reason})` : ''));
    }));
    this.unsubs.push(onValue(ref(db, `bans/${w.uid}`), (s) => {
      if (s.exists()) w.forceLogout('접속이 차단된 계정입니다.');
    }));
    this.unsubs.push(onValue(ref(db, 'config'), (s) => {
      const c = mergeConfig(s.val());
      w.config = c;
      w.events.emit('config', c);
      if (c.maintenance.on && !w.isAdmin) w.forceLogout(c.maintenance.message || '서버 점검 중입니다.');
      else if ((c.minVersion || 0) > CLIENT_VERSION) w.reloadForUpdate(c.minVersion || 0); // 옛 클라이언트는 새 규칙·형식을 못 쓰므로 스스로 새로고침
    }));
    // 밀치기 당함
    // 나에게 날아온 말랑이: 보고 나서 지운다 (push 와 같은 방식)
    this.unsubs.push(onValue(ref(db, `players/${w.uid}/toss`), (s) => {
      if (!s.exists()) return;
      const m = s.val() as TossMsg;
      remove(ref(db, `players/${w.uid}/toss`)).catch(() => {});
      const thrower = w.players.get(m.f);
      if (serverNow() - m.t < 5000 && thrower && w.onMyMap(thrower.st)) w.events.emit('toss', w.uid, m); // 다른 맵에서 날아온 건 무시
    }));
    this.unsubs.push(onValue(ref(db, `players/${w.uid}/push`), (s) => {
      const p = s.val() as PushEvent | null;
      if (!p) return;
      remove(ref(db, `players/${w.uid}/push`)).catch(() => {});
      if (serverNow() - p.t > 4000) return;
      if (w.me.roomId) return; // 카지노 안에 앉아 있는 동안은 아무도 못 건드린다 (2026-11-12. 빠따도 안 통한다)
      const pusher = w.players.get(p.f);
      if (!pusher || !w.onMyMap(pusher.st)) return;
      const rx = Math.round(w.me.x - pusher.toX), ry = Math.round(w.me.y - pusher.toY);
      if (Math.abs(p.dx) + Math.abs(p.dy) !== 1) return;
      if (p.n === 2) {
        // 장풍: 미는 사람의 앞 4칸 × 옆 4칸 안에 내가 있어야 한다 (방향은 그 사람이 보는 쪽). 💨 효과는 막혀도 그린다
        if (!inFront(rx, ry, p.dx, p.dy)) return;
        w.events.emit('wave', pusher.toX, pusher.toY, w.me.x, w.me.y);
      } else if (Math.abs(rx) + Math.abs(ry) !== 1 || rx !== p.dx || ry !== p.dy) return; // 보통 밀치기: 바로 옆에서 나를 보고 있어야 함
      // 빠따(b=1): 방어를 깨고 그대로 민다. 이미 깨져 있는 동안에도 방어가 없다 (2026-11-11)
      if (p.b === 1 && !this.snowOpen() && (w.profile.eq?.pa || w.petGuard())) w.breakGuard(pusher.st.n); // 눈사람 벌칙 중이면 빠따가 와도 60초 방어 깨짐을 새로 걸지 않는다
      const open = this.guardOpen();
      // 철벽 갑옷: 안 밀린다 (🛡 표시만)
      if (!open && w.profile.eq?.pa) { w.me.blockAt = performance.now(); w.toast(`🛡 철벽 갑옷이 ${pusher.st.n} 의 밀치기를 막았다.`); return; }
      if (!open && w.petGuard()) {
        // 펫 방어 (Lv8): 안 밀리고, 보통 밀치기는 80% 로 되받아친다 — 민 사람에게 반대 방향 밀치기를 쓴다 (그쪽에서 보면 내가 바로 옆에서 보고 민 것과 같은 모양이라 그대로 검증을 통과). 되받은 것(r)은 다시 되받지 않는다
        w.me.blockAt = performance.now();
        if (p.n !== 2 && !p.r && w.petReflect()) { this.pushReflect(p.f, -p.dx, -p.dy); w.toast(`🛡 펫이 ${pusher.st.n} 의 밀치기를 되받아쳤다!`); }
        else w.toast(`🛡 펫이 ${pusher.st.n} 의 밀치기를 막았다.`);
        return;
      }
      w.settleIfStalled(); // 뒤쪽 탭이라 화면 갱신이 멈춰 있으면 이전 걸음부터 마무리 (안 그러면 moving 이 풀리지 않아 계속 못 민다)
      if (w.me.locked || w.me.moving) return;
      const nx = w.me.x + p.dx, ny = w.me.y + p.dy;
      if (!w.canStep(nx, ny, true)) return;
      const pdir: Dir = p.dx === 1 ? 2 : p.dx === -1 ? 1 : p.dy === 1 ? 0 : 3;
      w.me.pushAt = performance.now(); w.me.pushDir = pdir;
      w.me.pushMore = p.n === 2 ? { dx: p.dx, dy: p.dy, dir: pdir } : null; // 장풍: 도착하면 한 칸 더 (world.afterStep)
      w.startStep(nx, ny, pdir);
      w.stunAfter(STEP_MS * (p.n === 2 ? 2 : 1)); // 밀린 사람은 도착 뒤 잠깐 스턴
    }));
    // 끌기 당함: 끄는 사람이 비운 자리(보통 끌기) 또는 끄는 사람의 바로 앞 칸(갈고리)으로 당겨진다
    this.unsubs.push(onValue(ref(db, `players/${w.uid}/pull`), (s) => {
      const p = s.val() as PullEvent | null;
      if (!p) return;
      remove(ref(db, `players/${w.uid}/pull`)).catch(() => {});
      if (serverNow() - p.t > 4000 || typeof p.x !== 'number' || typeof p.y !== 'number') return;
      if (w.me.roomId) return; // 카지노 안: 끌기·갈고리도 안 통한다
      const puller = w.players.get(p.f);
      if (!puller || !w.onMyMap(puller.st)) return;
      const me = w.me;
      if (p.k === 'hook') {
        // 갈고리: 목적지는 끄는 사람의 바로 앞 칸이고, 나는 그 사람의 앞 4칸 × 옆 4칸 안에 있어야 한다
        const [dx, dy] = dirVec(puller.st.d ?? 0);
        if (p.x !== puller.toX + dx || p.y !== puller.toY + dy) return;
        if (!inFront(me.x - puller.toX, me.y - puller.toY, dx, dy)) return;
        w.events.emit('hook', puller.toX, puller.toY, me.x, me.y);
      } else {
        // 보통 끌기: 목적지는 내 옆 칸이고, 끄는 사람은 거기서 한 칸 물러난 자리에 있어야 한다
        if (Math.abs(me.x - p.x) + Math.abs(me.y - p.y) !== 1) return;
        if (Math.abs(puller.toX - p.x) + Math.abs(puller.toY - p.y) !== 1) return;
      }
      if (p.b === 1 && !this.snowOpen() && (w.profile.eq?.pa || w.petGuard())) w.breakGuard(puller.st.n); // 빠따: 방어를 깨고 그대로 끈다
      const open = this.guardOpen();
      if (!open && w.profile.eq?.pa) { me.blockAt = performance.now(); w.toast(`🛡 철벽 갑옷이 ${puller.st.n} 의 끌기를 막았다.`); return; }
      if (!open && w.petGuard()) { me.blockAt = performance.now(); w.toast(`🛡 펫이 ${puller.st.n} 의 끌기를 막았다.`); return; }
      w.settleIfStalled();
      if (me.locked || me.moving) return;
      if (!w.canStep(p.x, p.y, true)) return;
      const mx = p.x - me.x, my = p.y - me.y;
      const pdir: Dir = Math.abs(mx) >= Math.abs(my) ? (mx > 0 ? 2 : 1) : (my > 0 ? 0 : 3);
      const dist = Math.abs(mx) + Math.abs(my);
      const dur = dist > 1 ? HOOK_SLIDE_MS * dist : STEP_MS;
      me.pushAt = performance.now(); me.pushDir = pdir; me.pushMore = null;
      w.startStep(p.x, p.y, pdir, { dur });
      w.stunAfter(dur);
    }));
    // 관리자가 나를 광장으로 보냈다
    this.unsubs.push(onValue(ref(db, `players/${w.uid}/tp`), (s) => {
      const p = s.val() as TpEvent | null;
      if (!p) return;
      remove(ref(db, `players/${w.uid}/tp`)).catch(() => {});
      if (serverNow() - p.t > 10000 || typeof p.x !== 'number' || typeof p.y !== 'number' || w.me.locked) return;
      const admin = w.players.get(p.f);
      if (!admin || !w.onMyMap(admin.st)) return; // 지금은 같은 맵 안에서만 보낸다 (좌표가 그 맵 기준)
      w.leaveForTeleport();
      void w.teleportTo(p.x, p.y).then(() => w.toast('🏠 관리자가 광장으로 보냈습니다.'));
    }));
    // 프로필 변화 (닉네임/패배 횟수/보유 등)
    this.unsubs.push(onValue(ref(db, `users/${w.uid}`), (s) => {
      const v = s.val();
      if (!v) return;
      w.profile = { ...w.profile, ...v };
      w.events.emit('profile');
    }));
  }

  // 한 칸 이동: 새 자리 잡기 + 옛 자리 비우기 + 위치·방향을 쓰기 한 번에 보낸다. 그 자리에 다른 사람이 있으면 규칙(occ)이 통째로 거부하고 false.
  // 규칙이 허용하는 경우: 비었거나, 내 것이거나, 적힌 사람이 접속해 있지 않거나 실제로는 다른 칸에 있거나(남은 찌꺼기), 마피아에서 유령과 산 사람 사이.
  // 예전엔 자리 트랜잭션(리슨·쓰기·해제) 뒤에 위치를 따로 써서 한 걸음에 왕복이 5번이었다 (2026-11-10)
  async step(nx: number, ny: number, dir: Dir, ox: number, oy: number): Promise<boolean> {
    const w = this.w;
    const mapId = w.mapId;
    const upd: Record<string, unknown> = { [`occ/${this.occKey(nx, ny)}`]: w.uid, [`players/${w.uid}/x`]: nx, [`players/${w.uid}/y`]: ny, [`players/${w.uid}/d`]: dir };
    if ((ox !== nx || oy !== ny) && this.ownsOcc) upd[`occ/${this.occKey(ox, oy)}`] = null; // 남의 자리는 지우지 않는다 (규칙이 거부해 걸음이 통째로 막힌다)
    this.pendingSteps++;
    try { await update(ref(db), upd); } catch { return false; } finally { this.pendingSteps--; }
    this.ownsOcc = true;
    this.stat('moves');
    const now = Date.now();
    if (now - this.lastPosSave > 15000) { this.lastPosSave = now; update(ref(db, `users/${w.uid}`), { lastPos: lastPosOf(mapId, nx, ny, dir) }).catch(() => {}); }
    return true;
  }

  // 다른 맵으로 옮긴다: 새 자리 점유와 맵·위치를 쓰기 한 번에 (실패하면 원래 맵·자리 그대로, false).
  // 옛 자리는 내가 잡은 자리일 때만 같이 지운다 (ownsOcc. 서버에 다시 묻지 않는다)
  async changeMap(mapId: string, nx: number, ny: number, dir: Dir): Promise<boolean> {
    const w = this.w;
    if (this.stepping || this.leaving) return false;
    this.changing = true;
    try {
      try { await update(ref(db), mapSwitchUpdate(w.uid, { mapId: w.mapId, x: w.me.x, y: w.me.y, ownsOld: this.ownsOcc }, { mapId, x: nx, y: ny, d: dir })); } catch { return false; }
      this.ownsOcc = true;
      this.lastPosSave = Date.now();
      update(ref(db, `users/${w.uid}`), { lastPos: lastPosOf(mapId, nx, ny, dir) }).catch(() => {});
      return true;
    } finally { this.changing = false; }
  }

  // 지금 위치와 방향을 프로필에 저장 (자동 새로고침 직전: 같은 자리·방향으로 돌아오게)
  savePos(): Promise<void> {
    const w = this.w;
    return update(ref(db, `users/${w.uid}`), { lastPos: lastPosOf(w.mapId, w.me.x, w.me.y, w.me.dir) }).catch(() => {});
  }

  setDir(dir: Dir): void {
    const now = Date.now();
    if (now - this.lastDirWrite < 120) return;
    this.lastDirWrite = now;
    set(ref(db, `players/${this.w.uid}/d`), dir).catch(() => {});
  }

  emote(id: number): void {
    set(ref(db, `players/${this.w.uid}/e`), { t: id, at: serverTimestamp() }).catch(() => {});
    this.stat('emotes');
  }

  // 빠따(b=1)가 붙은 타격은 지갑의 빠따를 같은 쓰기에서 줄인다 (규칙이 줄었는지 본다). n: 이번 쓰기에서 쓴 빠따 수
  private batCost(n: number): Record<string, unknown> { return n > 0 ? { [`wallet/${this.w.uid}/bt`]: increment(-n) } : {}; }
  toss(targetUid: string, m: Omit<TossMsg, 't'>): void {
    update(ref(db), { [`players/${targetUid}/toss`]: { ...m, t: serverTimestamp() }, ...this.batCost(m.b ? 1 : 0) }).catch(() => {});
  }
  // 말랑이 보따리: 여러 명에게 한 번에 (multi-path 쓰기)
  tossMany(shots: { uid: string; m: Omit<TossMsg, 't'> }[]): void {
    update(ref(db), { ...Object.fromEntries(shots.map((s) => [`players/${s.uid}/toss`, { ...s.m, t: serverTimestamp() }])), ...this.batCost(shots.filter((s) => s.m.b).length) }).catch(() => {});
  }
  // 끌기: 상대를 (x,y)로 당긴다. hook 이면 갈고리 (규칙이 보유 확인)
  pull(targetUid: string, x: number, y: number, hook = false, bat = false): void {
    update(ref(db), { [`players/${targetUid}/pull`]: { f: this.w.uid, x, y, t: serverTimestamp(), ...(hook ? { k: 'hook' } : {}), ...(bat ? { b: 1 } : {}) }, ...this.batCost(bat ? 1 : 0) }).catch(() => {});
  }
  // 관리자: 상대를 (x,y)로 보낸다 (광장으로 보내기). 규칙이 관리자만 허용
  sendTo(targetUid: string, x: number, y: number): Promise<void> {
    return set(ref(db, `players/${targetUid}/tp`), { f: this.w.uid, x, y, t: serverTimestamp() });
  }
  push(targetUid: string, dx: number, dy: number, bat = false): void {
    update(ref(db), { [`players/${targetUid}/push`]: { f: this.w.uid, dx, dy, t: serverTimestamp(), ...(bat ? { b: 1 } : {}) }, ...this.batCost(bat ? 1 : 0) }).catch(() => {});
  }
  // 거북이 등껍질 되받아치기 (2026-11-10): r 표시가 있으면 받는 쪽이 다시 되받지 않는다
  pushReflect(targetUid: string, dx: number, dy: number): void {
    set(ref(db, `players/${targetUid}/push`), { f: this.w.uid, dx, dy, t: serverTimestamp(), r: true }).catch(() => {});
  }
  // 장풍: 범위 안의 여러 명에게 한 번에 (multi-path). n=2 는 규칙이 보유를 확인한다
  pushMany(targets: { uid: string; bat: boolean }[], dx: number, dy: number): void {
    update(ref(db), { ...Object.fromEntries(targets.map((x) => [`players/${x.uid}/push`, { f: this.w.uid, dx, dy, t: serverTimestamp(), n: 2, ...(x.bat ? { b: 1 } : {}) }])), ...this.batCost(targets.filter((x) => x.bat).length) }).catch(() => {});
  }
  // 빠따에 맞아 방어가 깨졌다: 풀리는 시각을 presence 에 올려 남들이 막힌다고 보고 건너뛰지 않게 한다
  setGuardBroken(until: number): void {
    set(ref(db, `players/${this.w.uid}/gb`), until).catch(() => {});
  }

  setRoom(roomId: string | null): void {
    set(ref(db, `players/${this.w.uid}/r`), roomId).catch(() => {});
  }
  // 낚시 중이면 찌가 있는 물 타일, 아니면 null. a=1 자동 낚시, r=낚싯대 등급(1~3, 남의 화면에서 색이 다르다. 3 = 킹 낚싯대), s=강화 성(★n 표시. 킹 낚싯대면 킹 성)
  setFishing(t: { x: number; y: number } | null, auto = false, rod = 0, stars = 0): void {
    set(ref(db, `players/${this.w.uid}/f`), t ? { ...t, ...(auto ? { a: 1 } : {}), ...(rod ? { r: rod } : {}), ...(stars ? { s: stars } : {}) } : null).catch(() => {});
  }
  // 채광 중 표시 (금광): 곡괭이질마다 쓰지 않고 처음 칠 때 켜고, 자리를 뜨거나 한동안 안 치면 끈다 (mine.ts). 맵을 옮길 때는 mapSwitchUpdate 가 같이 비운다
  setMining(on: boolean): void {
    set(ref(db, `players/${this.w.uid}/mn`), on ? true : null).catch(() => {});
  }
  // 펫의 누적 먹이(경험치)를 presence 에 싣는다 (먹이를 줬거나 펫을 바꿨을 때). 0 이면 지운다
  setPetXp(xp: number): void {
    set(ref(db, `players/${this.w.uid}/pl`), xp > 0 ? xp : null).catch(() => {});
  }
  setAvatar(avatar: string): void {
    update(ref(db), { [`users/${this.w.uid}/avatar`]: avatar, [`players/${this.w.uid}/a`]: avatar }).catch(() => {});
  }

  // 통계(추정치용)는 모았다가 1분에 한 번 보낸다. 걸음·낚시마다 따로 쓰면 그때마다 왕복이 하나씩 는다 (2026-11-10 점심: 분당 130번).
  // 탭이 뒤로 가거나 나갈 때도 보낸다. 탭을 그냥 닫으면 마지막 1분치는 빠질 수 있다 (추정치라 괜찮다)
  private statPending: Record<string, number> = {};
  private statTimer = 0;
  stat(key: string): void {
    this.statPending[key] = (this.statPending[key] || 0) + 1;
    if (!this.statTimer) this.statTimer = window.setTimeout(() => this.flushStats(), 60000);
  }
  private flushStats(): void {
    clearTimeout(this.statTimer); this.statTimer = 0;
    const upd: Record<string, unknown> = {};
    for (const [k, n] of Object.entries(this.statPending)) upd[k] = increment(n);
    this.statPending = {};
    if (Object.keys(upd).length) update(ref(db, `stats/${dayKey()}`), upd).catch(() => {});
  }
  // 최대 동시 접속 기록 (추정치용). 내가 오늘 써 본 값보다 많아졌을 때만, 5초 뒤에도 그만큼 있으면 한 번 쓴다.
  // "지금 값보다 클 때만"은 규칙(stats/$day/peak)이 본다: 이미 더 큰 값이 있으면 거부되고 그걸로 끝.
  // 예전엔 접속자 누가 움직일 때마다 트랜잭션을 걸었는데, stats 는 관리자만 읽을 수 있어 일반 유저는 매번 리슨·쓰기를 거부당했다(2026-11-10 점심 프로파일: 전체 연산의 58%).
  private peakSent = 0;
  private peakDay = '';
  private peakTimer = 0;
  recordPeak(count: number): void {
    const day = dayKey();
    if (day !== this.peakDay) { this.peakDay = day; this.peakSent = 0; }
    if (count <= this.peakSent || this.peakTimer) return;
    this.peakTimer = window.setTimeout(() => {
      this.peakTimer = 0;
      const n = this.w.players.size + 1; // 재접속 직후 잠깐 부풀어 보이는 수는 거른다
      if (n <= this.peakSent || this.leaving) return;
      this.peakSent = n;
      set(ref(db, `stats/${dayKey()}/peak`), n).catch(() => {});
    }, 5000);
  }

  // replaced = 같은 계정이 다른 곳에서 로그인해 이 세션이 밀려난 경우.
  // 이때 players 노드는 새 세션이 쓰고 있으므로 지우면 안 되고, 예약된 onDisconnect 만 취소한다.
  async leave(replaced = false): Promise<void> {
    const w = this.w;
    this.flushStats();
    this.leaving = true;
    this.joined = false;
    clearInterval(this.hbTimer); clearInterval(this.sweepTimer); clearTimeout(this.reclaimTimer); clearTimeout(this.afkTimer); clearTimeout(this.peakTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const u of this.unsubs) u();
    this.unsubs = [];
    try {
      if (replaced) {
        // 새 세션이 같은 노드를 쓰고 있으므로 삭제 예약만 취소하고 내 점유 타일만 비운다
        await onDisconnect(this.playerRef()).cancel();
        if (this.leaveLogKey) await onDisconnect(ref(db, `logs/conn/${this.leaveLogKey}`)).cancel();
        if (this.ownsOcc) await update(ref(db), { [`occ/${this.occKey(w.me.x, w.me.y)}`]: null }).catch(() => {});
        return;
      }
      // 실제 삭제를 먼저 보내고 그 다음 onDisconnect 예약을 취소한다. 반대 순서면 연결이 끊기는 중에
      // 취소만 전달되고 삭제가 유실될 수 있다. 취소가 유실되어도 이미 지운 노드 삭제/이미 쓴 로그 재기록은 무해하다.
      const upd: Record<string, unknown> = { [`players/${w.uid}`]: null, [`users/${w.uid}/lastPos`]: lastPosOf(w.mapId, w.me.x, w.me.y, w.me.dir) };
      if (this.ownsOcc) upd[`occ/${this.occKey(w.me.x, w.me.y)}`] = null; // 남의 자리를 지우려 하면 퇴장 쓰기 전체가 거부된다
      if (this.leaveLogKey) upd[`logs/conn/${this.leaveLogKey}`] = { u: w.uid, n: w.profile.nick, type: 'leave', ts: serverTimestamp() };
      await update(ref(db), upd);
      await onDisconnect(this.playerRef()).cancel();
      if (this.leaveLogKey) await onDisconnect(ref(db, `logs/conn/${this.leaveLogKey}`)).cancel();
    } catch { /* ignore */ }
  }

  static async countPlayers(): Promise<number> {
    const s = await get(ref(db, 'players'));
    return s.exists() ? Object.keys(s.val()).length : 0;
  }

  static interpT(moveStart: number, now: number): number {
    return Math.min(1, (now - moveStart) / STEP_MS);
  }
}

export type { RemotePlayer };
