import { ref, onValue, runTransaction, onDisconnect } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import type { RoomState, RoomMember } from '../shared/types';
import type { Zone } from './map';
import { primaryOnlyRoom } from './portal';
import type { WorldCtx } from './state';

// 정원이 있는 방(지금은 카지노뿐)의 입장·퇴장 등록. 서버 코드가 없으므로 모든 클라이언트가 같은 규칙으로 동작한다.
// 커피 내기(준비 → 추첨 → 패배 집계)는 쓰는 사람이 없어 2026-11-12 에 없앴다. 되살리지 말 것
export class Rooms {
  private unsub: (() => void) | null = null;

  constructor(private w: WorldCtx) {}

  start(): void {
    this.unsub = onValue(ref(db, 'rooms'), (s) => {
      this.w.rooms = (s.val() as Record<string, RoomState>) || {};
      this.w.events.emit('rooms');
    });
  }
  stop(): void { this.unsub?.(); this.unsub = null; }

  zoneOf(id: string): Zone | undefined { return this.w.map.zones.find((z) => z.kind === 'casino' && z.id === id); }

  // 입장 시도: 정원/상태 확인 후 멤버 등록. 성공 시 true
  async tryEnter(z: Zone): Promise<boolean> {
    const w = this.w;
    if (primaryOnlyRoom(w.mapId, z)) return false; // 다른 맵의 같은 id 방이 기본 맵 방 상태를 같이 쓰지 않게
    const cap = z.cap || 2;
    const member: RoomMember = { n: w.profile.nick, ready: false, losses: 0, at: serverNow() }; // ready·losses: 규칙이 요구하는 옛 커피 내기 칸 (값은 안 쓴다)
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
        if (Object.keys(members).length === 0) return { cap: cur.cap, round: (cur.round || 1) + 1, state: 'open', members: null } as unknown as RoomState;
        return { ...cur, members };
      }, { applyLocally: false });
    } catch (e) { console.warn('room leave failed', e); }
  }
}
