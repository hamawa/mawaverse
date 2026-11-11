import { ref, onValue, runTransaction, onDisconnect, update } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import { unitRandomFromSeed } from '../shared/hash';
import { ROOM_RESULT_MS } from '../shared/config';
import type { RoomState, RoomMember, UserProfile } from '../shared/types';
import { findFreeTile, type Zone } from './map';
import type { WorldCtx } from './state';

// 커피 내기 방 로직. 서버 코드가 없으므로 모든 클라이언트가 같은 규칙으로 동작한다.
export class Rooms {
  private unsub: (() => void) | null = null;
  private exitTimer = 0;
  private exiting = false;
  private countingKey = '';

  constructor(private w: WorldCtx) {}

  start(): void {
    this.unsub = onValue(ref(db, 'rooms'), (s) => {
      this.w.rooms = (s.val() as Record<string, RoomState>) || {};
      this.w.events.emit('rooms');
      this.onRoomsChanged();
    });
  }
  stop(): void { this.unsub?.(); this.unsub = null; clearTimeout(this.exitTimer); }

  zoneOf(id: string): Zone | undefined { return this.w.map.zones.find((z) => (z.kind === 'room' || z.kind === 'casino') && z.id === id); }

  // 입장 시도: 정원/상태 확인 후 멤버 등록. 성공 시 true
  async tryEnter(z: Zone): Promise<boolean> {
    const w = this.w;
    const cap = z.cap || 2;
    const member: RoomMember = { n: w.profile.nick, ready: false, losses: w.profile.losses || 0, at: serverNow() };
    try {
      const res = await runTransaction(ref(db, `rooms/${z.id}`), (cur: RoomState | null) => {
        if (!cur) return { cap, round: 1, state: 'open', members: { [w.uid]: member } } as RoomState;
        if (cur.state !== 'open') return;
        const members = cur.members || {};
        if (members[w.uid]) return cur;
        if (Object.keys(members).length >= cap) return;
        return { ...cur, cap, members: { ...members, [w.uid]: member } };
      }, { applyLocally: false });
      if (!res.committed) return false;
      await onDisconnect(ref(db, `rooms/${z.id}/members/${w.uid}`)).remove();
      return true;
    } catch (e) {
      console.warn('room enter failed', e);
      return false;
    }
  }

  async leave(roomId: string): Promise<void> {
    const w = this.w;
    try {
      await onDisconnect(ref(db, `rooms/${roomId}/members/${w.uid}`)).cancel();
      await runTransaction(ref(db, `rooms/${roomId}`), (cur: RoomState | null) => {
        if (!cur) return cur;
        const members = { ...(cur.members || {}) };
        delete members[w.uid];
        if (Object.keys(members).length === 0) return { cap: cur.cap, round: (cur.round || 1) + 1, state: 'open', members: null, result: null } as unknown as RoomState;
        return { ...cur, members };
      }, { applyLocally: false });
    } catch (e) { console.warn('room leave failed', e); }
  }

  async toggleReady(roomId: string): Promise<void> {
    const w = this.w;
    const rs = w.rooms[roomId];
    if (!rs || rs.state !== 'open' || !rs.members?.[w.uid]) return;
    const ready = !rs.members[w.uid].ready;
    await update(ref(db, `rooms/${roomId}/members/${w.uid}`), { ready, readyAt: ready ? serverNow() : null, losses: w.profile.losses || 0, n: w.profile.nick });
    w.toast(ready ? '준비 완료! 모두 준비되면 추첨합니다.' : '준비를 취소했습니다.');
  }

  // 가중치: (방 안 최대 패배 - 내 패배 + 1) ^ strength
  static pickLoser(members: Record<string, RoomMember>, seed: string, strength: number): string {
    const entries = Object.entries(members).sort((a, b) => a[0].localeCompare(b[0]));
    const maxL = Math.max(...entries.map(([, m]) => m.losses || 0));
    const weights = entries.map(([, m]) => Math.pow(maxL - (m.losses || 0) + 1, strength || 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = unitRandomFromSeed(seed) * total;
    for (let i = 0; i < entries.length; i++) { r -= weights[i]; if (r <= 0) return entries[i][0]; }
    return entries[entries.length - 1][0];
  }

  static allReady(rs: RoomState): boolean {
    const members = Object.values(rs.members || {});
    return members.length >= 2 && members.every((m) => m.ready);
  }

  private async onRoomsChanged(): Promise<void> {
    const w = this.w;
    const myRoom = w.me.roomId;
    // 결과 상태인데 오래 방치된 방은 아무나 초기화 (멤버가 끊긴 경우 대비)
    for (const [id, rs] of Object.entries(w.rooms)) {
      if (rs.state === 'result' && rs.result && serverNow() - rs.result.at > ROOM_RESULT_MS + 8000) {
        runTransaction(ref(db, `rooms/${id}`), (cur: RoomState | null) => {
          if (!cur || cur.state !== 'result' || !cur.result || serverNow() - cur.result.at <= ROOM_RESULT_MS + 8000) return;
          return { cap: cur.cap, round: (cur.round || 1) + 1, state: 'open', members: null, result: null } as unknown as RoomState;
        }, { applyLocally: false }).catch(() => {});
      }
    }
    if (!myRoom) return;
    const rs = w.rooms[myRoom];
    if (!rs) return;
    if (rs.state === 'open' && rs.members?.[w.uid] && Rooms.allReady(rs)) {
      await this.tryDraw(myRoom, rs);
    } else if (rs.state === 'result' && rs.result) {
      w.me.locked = true;
      if (!rs.result.counted) this.tryCountLoss(myRoom, rs);
      if (!this.exiting) {
        this.exiting = true;
        const wait = Math.max(0, rs.result.at + ROOM_RESULT_MS - serverNow());
        clearTimeout(this.exitTimer);
        this.exitTimer = window.setTimeout(() => this.exitRoom(myRoom), wait);
      }
    }
  }

  // 모두 준비 → 서버 시각 기반 시드로 결정적 추첨, 먼저 커밋한 사람이 결과를 기록
  private async tryDraw(roomId: string, rs: RoomState): Promise<void> {
    const w = this.w;
    if (!rs.members?.[w.uid]) return;
    try {
      await runTransaction(ref(db, `rooms/${roomId}`), (cur: RoomState | null) => {
        if (!cur || cur.state !== 'open' || !Rooms.allReady(cur)) return;
        const curSeed = `${roomId}:${cur.round}:` + Object.entries(cur.members || {}).sort((a, b) => a[0].localeCompare(b[0])).map(([u, m]) => `${u}=${m.readyAt || 0}`).join(',');
        const l = Rooms.pickLoser(cur.members || {}, curSeed, w.config.lossStrength || 1);
        return { ...cur, state: 'result', result: { loser: l, loserNick: cur.members![l].n, at: serverNow(), seed: curSeed, counted: false } };
      }, { applyLocally: false });
    } catch (e) { console.warn('draw failed', e); }
  }

  // 패배 횟수 +1 (보안 규칙이 방 결과와 대조해 검증)
  private async tryCountLoss(roomId: string, rs: RoomState): Promise<void> {
    const w = this.w;
    const key = `${roomId}:${rs.round}`;
    if (this.countingKey === key) return;
    this.countingKey = key;
    const loser = rs.result!.loser;
    // 당첨자 본인 클라이언트가 먼저 시도, 다른 멤버는 1.5초 뒤 보조 시도
    if (loser !== w.uid) await new Promise((r) => setTimeout(r, 1500));
    const cur = w.rooms[roomId];
    if (!cur || cur.state !== 'result' || !cur.result || cur.result.counted) return;
    try {
      await runTransaction(ref(db, `users/${loser}`), (u: UserProfile | null) => {
        if (!u) return;
        if (u.lastLoss && u.lastLoss.room === roomId && u.lastLoss.round === rs.round) return;
        return { ...u, losses: (u.losses || 0) + 1, lastLoss: { room: roomId, round: rs.round } };
      }, { applyLocally: false });
      // 이미 반영되어 트랜잭션이 중단된 경우도 '집계 완료'로 표시
      await update(ref(db, `rooms/${roomId}/result`), { counted: true });
    } catch (e) { console.warn('count loss failed', e); }
  }

  // 결과 표시 후 자동 퇴장: 문 밖 빈 타일로 순간이동
  private async exitRoom(roomId: string): Promise<void> {
    const w = this.w;
    const z = this.zoneOf(roomId);
    this.exiting = false;
    if (!z) return;
    const exit = z.exit || { x: z.x, y: z.y + z.h };
    const t = findFreeTile(w.map, exit.x, exit.y, (x, y) => w.occupied(x, y), true);
    await w.teleportTo(t.x, t.y);
    w.me.locked = false;
    w.me.roomId = null;
    w.events.emit('roomHint', null);
    await this.leave(roomId);
    this.countingKey = '';
  }
}
