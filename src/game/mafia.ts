// 마피아 (어몽어스식) 진행. 설계는 shared/mafia.ts 머리말 참고.
// 참가자 공통: 로비 참가/탈퇴, 미션(F 5초), 시체 신고·긴급 소집, 투표, 유령 처리. 마피아: F 로 옆 사람 처치.
// 방장(또는 방장이 끊겼을 때 이어받은 사람): 시작(역할 배정), 회의 집계, 승패 판정, 종료 뒤 정리.
import { ref, get, set, update, onValue, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import {
  MAFIA_MIN, MAFIA_MAX, TASKS_PER_PLAYER, TASK_HOLD_MS, KILL_CD_MS, MEET_DISCUSS_MS, MEET_VOTE_MS, MEET_RESULT_MS, GAME_MAX_MS, END_SHOW_MS, WIN_COINS,
  TASK_DEFS, mafiaCountFor, taskProgress, aliveCount, tallyVotes, type MafiaGame, type Role, type TaskDef,
} from '../shared/mafia';
import { nearZone, type Zone } from './map';
import type { WorldCtx } from './state';

export interface TaskSpot { def: TaskDef; x: number; y: number }
export type MafiaAction =
  | { kind: 'kill'; uid: string; nick: string }
  | { kind: 'task'; spot: TaskSpot; fake: boolean }
  | { kind: 'report'; uid: string; nick: string }
  | { kind: 'button' };

export class MafiaMgr {
  game: MafiaGame | null = null;
  role: Role | null = null;                 // 내 역할 (mafia/roles/{uid})
  private unsubs: (() => void)[] = [];
  spots: TaskSpot[] = [];
  private board: Zone | undefined;          // 긴급 소집 버튼 자리 (게시판)
  private lastKill = -1e9;
  private holdStart = 0;                    // 미션 F 누르기 시작 (performance.now)
  private holdSpot: TaskSpot | null = null;
  private holdFake = false;
  private tallying = false;
  private lastHostAct = -1e9;
  private endHandled = '';                  // 종료 처리한 게임 at
  private lobbyToastFor = '';
  private wasGhost = false;
  private listeners = new Set<() => void>();
  private cleanupTimer = 0;

  constructor(private w: WorldCtx) {}

  start(): void {
    const w = this.w;
    // 미션 자리: 지정 좌표에 그 오브젝트가 있으면 거기, 아니면 맵에서 처음 나오는 칸 (모두 같은 맵이라 같은 자리)
    const m = w.map;
    for (const def of TASK_DEFS) {
      const at = def.at;
      if (at && at[0] < m.w && at[1] < m.h && m.objects[at[1] * m.w + at[0]] === def.obj) { this.spots.push({ def, x: at[0], y: at[1] }); continue; }
      const i = m.objects.indexOf(def.obj);
      if (i >= 0) this.spots.push({ def, x: i % m.w, y: Math.floor(i / m.w) });
    }
    this.board = m.zones.find((z) => z.kind === 'board');
    this.unsubs.push(onValue(ref(db, 'mafia/game'), (s) => { this.game = (s.val() as MafiaGame | null) || null; this.onGame(); }));
    this.unsubs.push(onValue(ref(db, `mafia/roles/${w.uid}`), (s) => { const v = s.val(); this.role = v === 'm' || v === 'c' ? v : null; this.emit(); }));
  }
  stop(): void { this.unsubs.forEach((u) => u()); this.unsubs = []; this.listeners.clear(); clearTimeout(this.cleanupTimer); }
  listen(f: () => void): () => void { this.listeners.add(f); return () => this.listeners.delete(f); }
  private emit(): void { this.listeners.forEach((f) => f()); }

  // ---- 조회 ----
  get active(): boolean { return !!this.game && this.game.st !== 'lobby'; }
  get playing(): boolean { return !!this.game && this.game.st === 'play'; }
  isParticipant(uid: string): boolean { return !!this.game?.players?.[uid]; }
  isAlive(uid: string): boolean { return !!this.game?.players?.[uid]?.alive; }
  // 유령: 게임 중(play/end) 참가자인데 죽음
  isGhost(uid: string): boolean { return !!this.game && this.game.st !== 'lobby' && !!this.game.players?.[uid] && !this.game.players[uid].alive; }
  get me(): { in: boolean; alive: boolean; ghost: boolean; mafia: boolean } {
    const uid = this.w.uid;
    return { in: this.isParticipant(uid), alive: this.isAlive(uid), ghost: this.isGhost(uid), mafia: this.role === 'm' };
  }
  isHost(): boolean { return !!this.game && this.game.host === this.w.uid; }
  // 내가 진행을 맡아야 하나: 방장이거나, 방장이 접속에 없고 내가 참가자 중 uid 가 가장 앞선 사람
  private acting(): boolean {
    const g = this.game; if (!g) return false;
    if (g.host === this.w.uid) return true;
    if (this.w.players.has(g.host)) return false;
    const ids = Object.keys(g.players || {}).filter((u) => u === this.w.uid || this.w.players.has(u)).sort();
    return ids[0] === this.w.uid;
  }
  // 회의 중(토론·투표·결과 표시)이면 참가자는 제자리
  frozen(): boolean { const g = this.game; return !!g && g.st === 'play' && !!g.meet && this.isAlive(this.w.uid); }
  // 서로 지나칠 수 있나: 유령과 산 사람은 서로 안 보이므로 막지 않는다 (유령끼리·산 사람끼리는 막힘)
  passThrough(otherUid: string): boolean { return !!this.game && this.game.st !== 'lobby' && this.isGhost(otherUid) !== this.isGhost(this.w.uid); }
  // 회의 단계: 'discuss' | 'vote' | 'result' | null, 남은 ms
  meetPhase(): { phase: 'discuss' | 'vote' | 'result'; leftMs: number } | null {
    const mt = this.game?.meet; if (!mt) return null;
    const now = serverNow();
    if (mt.result) return { phase: 'result', leftMs: Math.max(0, mt.result.at + MEET_RESULT_MS - now) };
    const t = now - mt.at;
    if (t < MEET_DISCUSS_MS) return { phase: 'discuss', leftMs: MEET_DISCUSS_MS - t };
    return { phase: 'vote', leftMs: Math.max(0, MEET_DISCUSS_MS + MEET_VOTE_MS - t) };
  }
  myTasks(): { spot: TaskSpot; done: boolean }[] {
    const t = this.game?.tasks?.[this.w.uid]; if (!t) return [];
    return Object.entries(t).map(([id, done]) => ({ spot: this.spots.find((s) => s.def.id === id)!, done })).filter((x) => x.spot);
  }
  holdProgress(): number { return this.holdStart ? Math.min(1, (performance.now() - this.holdStart) / TASK_HOLD_MS) : 0; }
  holding(): TaskSpot | null { return this.holdStart ? this.holdSpot : null; }
  killCooldownLeft(): number { return Math.max(0, KILL_CD_MS - (performance.now() - this.lastKill)); }

  // 지금 F 로 할 수 있는 마피아 행동 (world.canvasHint 가 우선 사용)
  action(): MafiaAction | null {
    const g = this.game, w = this.w, me = w.me;
    if (!g || g.st !== 'play' || !this.isParticipant(w.uid) || g.meet) return null;
    const near = (x: number, y: number) => Math.max(Math.abs(x - me.x), Math.abs(y - me.y)) <= 1;
    if (this.isAlive(w.uid)) {
      // 시체 신고
      for (const [uid, b] of Object.entries(g.bodies || {})) if (near(b.x, b.y)) return { kind: 'report', uid, nick: b.n };
      // 긴급 소집 (게시판 옆, 1인 1회). 2026-11-10 분수 → 게시판 (분수는 미션 자리라 소집이 먼저 잡혀 미션을 못 했다)
      if (this.board && !g.used?.[w.uid] && nearZone(this.board, me.x, me.y, 1)) return { kind: 'button' };
      // 마피아: 옆의 산 참가자 처치
      if (this.role === 'm') {
        for (const rp of w.players.values()) {
          if (!this.isAlive(rp.uid) || Math.round(rp.x) === me.x && Math.round(rp.y) === me.y) continue;
          if (near(Math.round(rp.x), Math.round(rp.y))) return { kind: 'kill', uid: rp.uid, nick: rp.st.n };
        }
      }
    }
    // 미션 (유령도 가능). 마피아는 가짜 미션(동작만)
    const mine = g.tasks?.[w.uid] || {};
    for (const s of this.spots) {
      if (!near(s.x, s.y)) continue;
      if (this.role === 'm') return { kind: 'task', spot: s, fake: true };
      if (s.def.id in mine && !mine[s.def.id]) return { kind: 'task', spot: s, fake: false };
    }
    return null;
  }

  // ---- 로비 ----
  async createLobby(): Promise<boolean> {
    const w = this.w;
    if (this.game) return false;
    try {
      await set(ref(db, 'mafia/game'), { st: 'lobby', host: w.uid, at: serverTimestamp(), players: { [w.uid]: { n: w.profile.nick, a: w.profile.avatar, alive: true, j: serverTimestamp() } } });
      return true;
    } catch (e) { console.warn('lobby create failed', e); return false; }
  }
  async join(): Promise<'ok' | 'full' | 'fail'> {
    const g = this.game, w = this.w;
    if (!g || g.st !== 'lobby') return 'fail';
    if (Object.keys(g.players || {}).length >= MAFIA_MAX) return 'full';
    try { await set(ref(db, `mafia/game/players/${w.uid}`), { n: w.profile.nick, a: w.profile.avatar, alive: true, j: serverTimestamp() }); return 'ok'; } catch { return 'fail'; }
  }
  async leave(): Promise<void> {
    const g = this.game, w = this.w;
    if (!g) return;
    if (g.host === w.uid && g.st === 'lobby') { await this.clearGame(); return; }
    await set(ref(db, `mafia/game/players/${w.uid}`), null).catch(() => {});
  }
  // 방장: 시작. 역할 무작위 배정(6명까지 마피아 1, 7명부터 2), 각자 미션 TASKS_PER_PLAYER 개
  async startGame(): Promise<'ok' | 'few' | 'fail'> {
    const g = this.game, w = this.w;
    if (!g || g.host !== w.uid || g.st !== 'lobby') return 'fail';
    const ids = Object.keys(g.players || {});
    if (ids.length < MAFIA_MIN) return 'few';
    const shuffled = [...ids].sort(() => Math.random() - 0.5);
    const nM = mafiaCountFor(ids.length);
    const roles: Record<string, Role> = {};
    shuffled.forEach((u, i) => { roles[u] = i < nM ? 'm' : 'c'; });
    const tasks: Record<string, Record<string, boolean>> = {};
    for (const u of ids) {
      const pool = [...this.spots].sort(() => Math.random() - 0.5).slice(0, TASKS_PER_PLAYER);
      tasks[u] = Object.fromEntries(pool.map((s) => [s.def.id, false]));
    }
    const players = Object.fromEntries(ids.map((u) => [u, { ...g.players[u], alive: true }]));
    try {
      await update(ref(db), {
        'mafia/roles': roles,
        'mafia/chat': null,
        'mafia/game': { st: 'play', host: w.uid, at: serverTimestamp(), n: 0, players, tasks, bodies: null, meet: null, used: null, end: null },
      });
      return 'ok';
    } catch (e) { console.warn('start failed', e); return 'fail'; }
  }
  private async clearGame(): Promise<void> {
    await update(ref(db), { 'mafia/game': null, 'mafia/roles': null, 'mafia/chat': null }).catch(() => {});
  }

  // ---- 행동 ----
  async kill(targetUid: string): Promise<boolean> {
    const g = this.game, w = this.w;
    if (!g || g.st !== 'play' || this.role !== 'm' || !this.isAlive(w.uid) || !this.isAlive(targetUid) || g.meet) return false;
    if (this.killCooldownLeft() > 0) { w.toast(`처치는 ${Math.ceil(this.killCooldownLeft() / 1000)}초 뒤에`, true); return false; }
    const rp = w.players.get(targetUid); if (!rp) return false;
    const p = g.players[targetUid];
    try {
      await update(ref(db), {
        [`mafia/game/players/${targetUid}/alive`]: false,
        [`mafia/game/bodies/${targetUid}`]: { x: Math.round(rp.x), y: Math.round(rp.y), a: p.a, n: p.n, at: serverTimestamp() },
      });
      this.lastKill = performance.now();
      return true;
    } catch (e) { console.warn('kill failed', e); return false; }
  }
  // 미션: F 를 누르고 있는 동안 tick 이 진행도를 올린다. 움직이면 취소
  beginTask(spot: TaskSpot, fake: boolean): void {
    if (this.holdStart) return;
    this.holdStart = performance.now(); this.holdSpot = spot; this.holdFake = fake;
  }
  cancelTask(): void { if (this.holdStart) { this.holdStart = 0; this.holdSpot = null; } }
  // 시체 신고: 회의를 열면서 그 시체는 바로 치운다 (2026-11-10. 신고 안 된 다른 시체는 회의가 끝날 때 정리)
  async report(bodyUid: string): Promise<boolean> {
    const g = this.game, w = this.w;
    if (!g || g.st !== 'play' || g.meet || !this.isAlive(w.uid)) return false;
    try { await update(ref(db), { 'mafia/game/meet': { by: w.uid, kind: 'report', body: bodyUid, at: serverTimestamp() }, [`mafia/game/bodies/${bodyUid}`]: null }); return true; } catch { return false; }
  }
  // 미션 표시용 (2026-11-10): 시민·유령은 내 미완료 미션(화살표·금색 테두리), 마피아는 모든 미션 자리(흐린 테두리, 가짜 미션용)
  marks(): { spots: TaskSpot[]; mine: boolean } | null {
    const g = this.game, w = this.w;
    if (!g || g.st !== 'play' || !this.isParticipant(w.uid)) return null;
    if (this.role === 'm') return { spots: this.spots, mine: false };
    return { spots: this.myTasks().filter((t) => !t.done).map((t) => t.spot), mine: true };
  }
  async callMeeting(): Promise<boolean> {
    const g = this.game, w = this.w;
    if (!g || g.st !== 'play' || g.meet || !this.isAlive(w.uid) || g.used?.[w.uid]) return false;
    try { await update(ref(db), { 'mafia/game/meet': { by: w.uid, kind: 'button', at: serverTimestamp() }, [`mafia/game/used/${w.uid}`]: true }); return true; } catch { return false; }
  }
  async vote(target: string): Promise<boolean> {
    const g = this.game, w = this.w;
    if (!g?.meet || g.meet.result || !this.isAlive(w.uid)) return false;
    try { await set(ref(db, `mafia/game/meet/votes/${w.uid}`), target); return true; } catch { return false; }
  }

  // ---- 매 프레임 ----
  tick(now: number): void {
    const g = this.game, w = this.w;
    // 미션 버티기
    if (this.holdStart) {
      if (w.me.moving || !g || g.st !== 'play' || g.meet) this.cancelTask();
      else if (now - this.holdStart >= TASK_HOLD_MS) {
        const spot = this.holdSpot!; const fake = this.holdFake;
        this.holdStart = 0; this.holdSpot = null;
        if (!fake) {
          set(ref(db, `mafia/game/tasks/${w.uid}/${spot.def.id}`), true).catch(() => {});
          w.toast(`✅ ${spot.def.verb} 완료!`);
        } else w.toast('…그런 척했다.');
      }
    }
    if (!g) return;
    // 참가자가 아무도 접속에 없는 게임(모두 나감)은 2분 뒤 아무나 치운다
    if (!this.acting()) {
      if (!w.players.has(g.host) && g.host !== w.uid && !Object.keys(g.players || {}).some((u) => u === w.uid || w.players.has(u)) && serverNow() - g.at > 120000 && now - this.lastHostAct > 5000) { this.lastHostAct = now; void this.clearGame(); }
      return;
    }
    if (now - this.lastHostAct < 1000) return; // 방장 일은 1초에 한 번
    this.lastHostAct = now;
    // 방장(대행) 일: 방장이 끊겼으면 내가 이어받는다
    if (g.host !== w.uid && !this.w.players.has(g.host)) { update(ref(db), { 'mafia/game/host': w.uid }).catch(() => {}); return; }
    if (g.st === 'play') this.hostPlay(g);
    else if (g.st === 'end' && serverNow() - (g.end?.at || 0) > END_SHOW_MS) { if (!this.cleanupTimer) this.cleanupTimer = window.setTimeout(() => { this.cleanupTimer = 0; void this.clearGame(); }, 500); }
    else if (g.st === 'lobby') {
      // 로비에 방장 혼자 10분 넘게 있으면 접는다
      if (Object.keys(g.players || {}).length <= 1 && serverNow() - g.at > 600000) void this.clearGame();
    }
  }
  private hostPlay(g: MafiaGame): void {
    const now = serverNow();
    // 회의 집계
    if (g.meet && !g.meet.result && !this.tallying) {
      const alive = Object.entries(g.players).filter(([, p]) => p.alive).map(([u]) => u);
      const votes = g.meet.votes || {};
      const allVoted = alive.every((u) => votes[u] !== undefined);
      const timeUp = now - g.meet.at >= MEET_DISCUSS_MS + MEET_VOTE_MS;
      if (allVoted || timeUp) {
        this.tallying = true;
        const r = tallyVotes(votes, alive.length);
        const upd: Record<string, unknown> = { 'mafia/game/meet/result': { out: r.out, tie: r.tie, counts: r.counts, at: serverTimestamp() } };
        if (r.out) upd[`mafia/game/players/${r.out}/alive`] = false;
        update(ref(db), upd).catch(() => {}).finally(() => { this.tallying = false; });
      }
    } else if (g.meet?.result && now - g.meet.result.at >= MEET_RESULT_MS) {
      // 결과 표시 끝: 남은 시체 치우고 다시 진행 (신고된 시체는 신고 때 이미 지워졌다)
      update(ref(db), { 'mafia/game/meet': null, 'mafia/game/bodies': null, 'mafia/game/n': (g.n || 0) + 1 }).catch(() => {});
    }
    // 승패 (방장은 역할을 읽을 수 없으므로 마피아 수는 roles 를 읽어야 한다 → 방장만 읽을 수 있게 하지 않고, 시작 때 기억한 역할로 센다)
    void this.checkEnd(g);
  }
  private rolesCache: Record<string, Role> | null = null;
  private async checkEnd(g: MafiaGame): Promise<void> {
    if (g.meet && !g.meet.result) return; // 회의 중에는 결과 뒤에
    const now = serverNow();
    const { done, total } = taskProgress(g);
    let win: Role | null = null, reason = '';
    if (total > 0 && done >= total) { win = 'c'; reason = '미션을 모두 끝냈다!'; }
    else if (now - g.at > GAME_MAX_MS) { win = 'c'; reason = '15분을 버텨냈다!'; }
    else {
      if (!this.rolesCache) { try { this.rolesCache = (await get(ref(db, 'mafia/roles'))).val() as Record<string, Role> | null; } catch { this.rolesCache = null; } }
      if (this.rolesCache) {
        const c = aliveCount(g, this.rolesCache);
        if (c.mafia === 0) { win = 'c'; reason = '마피아를 모두 찾아냈다!'; }
        else if (c.mafia >= c.citizens) { win = 'm'; reason = '마피아가 마을을 장악했다…'; }
      }
    }
    if (win && this.game?.st === 'play') {
      this.game.st = 'end'; // 중복 쓰기 방지
      await update(ref(db), { 'mafia/game/st': 'end', 'mafia/game/end': { win, reason, at: serverTimestamp() }, 'mafia/game/meet': null }).catch(() => {});
    }
  }

  // ---- 게임 노드가 바뀔 때 ----
  private onGame(): void {
    const g = this.game, w = this.w;
    if (!g) { this.rolesCache = null; this.endHandled = ''; this.lobbyToastFor = ''; }
    // 모집 알림 (내가 연 게 아니면 한 번)
    if (g?.st === 'lobby' && g.host !== w.uid && this.lobbyToastFor !== g.host + g.at) {
      this.lobbyToastFor = g.host + g.at;
      if (!this.isParticipant(w.uid)) w.toast(`🕵 ${g.players?.[g.host]?.n || '누군가'} 님이 마피아 모집 중! 내 메뉴 → 🕵 마피아`);
    }
    // 유령 채팅 켜고 끄기
    const ghost = this.isGhost(w.uid);
    if (ghost !== this.wasGhost) { this.wasGhost = ghost; w.events.emit('ghost', ghost); }
    // 종료: 이긴 편이면 코인
    // 종료 처리는 게임마다 한 번: end.at 은 내가 쓴 serverTimestamp 가 로컬 추정값 → 서버값으로 바뀌며 두 번 올 수 있어 게임 시작 시각(g.at)으로 구분한다
    if (g?.st === 'end' && g.end && this.endHandled !== String(g.at) && this.isParticipant(w.uid)) {
      this.endHandled = String(g.at);
      const won = (this.role === 'm') === (g.end.win === 'm');
      if (won) void w.wallet.earn(WIN_COINS);
      w.events.emit('log', { channel: 'sys', from: '', text: `🕵 마피아 게임 종료: ${g.end.win === 'm' ? '마피아 승리' : '시민 승리'} (${g.end.reason})${won ? ` · 💰+${WIN_COINS}` : ''}`, ts: serverNow() });
    }
    if (g?.st !== 'play') this.cancelTask();
    this.emit();
  }
}
