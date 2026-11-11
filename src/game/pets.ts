// 펫 따라다니기 (2026-11-09). 서버에는 "누가 어떤 펫을 데리고 있나"(presence pt)만 있고, 펫의 위치는 각 클라이언트가 주인의 걸음에서 계산한다:
// 주인이 한 걸음 떼면 펫은 주인이 방금 떠난 칸으로 같은 시간 동안 움직인다 → 항상 한 칸 뒤를 따라온다. 멀어지면(순간이동) 바로 뒤에 붙는다
import type { Dir } from '../shared/types';
import type { PetView } from './render';
import { dirVec } from './area';
import { petScale, petCanRide } from '../shared/shop';

interface PetState { x: number; y: number; fromX: number; fromY: number; moveStart: number; moveDur: number; lastOwnerMove: number; hopAt: number; dir: Dir }
export interface OwnerMotion { x: number; y: number; fromX: number; fromY: number; moveStart: number; moveDur: number; moving: boolean; dir: Dir }

export class Pets {
  private st = new Map<string, PetState>();

  // 주인의 지금 상태로 펫을 갱신하고 그릴 정보를 돌려준다. petId 가 없으면(안 데리고 다님) 상태를 지운다.
  // xp: 그 펫의 누적 먹이 (크기·탑승 여부). 탑승 중(Lv10)이면 따라오는 대신 주인 자리에 그려진다 (2026-11-10)
  view(uid: string, petId: string | null | undefined, o: OwnerMotion, now: number, xp = 0): PetView | null {
    if (!petId) { this.st.delete(uid); return null; }
    if (petCanRide(xp)) {
      const s0 = this.st.get(uid);
      return { id: petId, x: o.x, y: o.y, moving: o.moving, moveT: 0, hopAt: s0?.hopAt ?? -1e9, dir: o.dir, scale: petScale(xp), ride: true };
    }
    let s = this.st.get(uid);
    if (!s) {
      const [dx, dy] = dirVec(o.dir);
      s = { x: o.x - dx, y: o.y - dy, fromX: o.x - dx, fromY: o.y - dy, moveStart: 0, moveDur: 160, lastOwnerMove: o.moving ? o.moveStart : -1, hopAt: -1e9, dir: o.dir };
      this.st.set(uid, s);
    }
    if (o.moving && o.moveStart !== s.lastOwnerMove) {
      // 주인이 새 걸음을 시작했다: 펫은 주인이 떠난 칸으로
      s.lastOwnerMove = o.moveStart;
      const cur = this.pos(s, now);
      const tx = o.fromX, ty = o.fromY;
      if (Math.abs(tx - cur.x) + Math.abs(ty - cur.y) > 3) { s.x = tx; s.y = ty; s.fromX = tx; s.fromY = ty; s.moveStart = 0; }
      else if (tx !== s.x || ty !== s.y) {
        s.fromX = cur.x; s.fromY = cur.y; s.x = tx; s.y = ty; s.moveStart = now; s.moveDur = Math.max(80, o.moveDur);
        if (tx > cur.x + 0.01) s.dir = 2; else if (tx < cur.x - 0.01) s.dir = 1; else s.dir = ty > cur.y ? 0 : 3;
      }
    } else if (!o.moving && Math.abs(o.x - s.x) + Math.abs(o.y - s.y) > 3) {
      // 주인이 멀리 있다(순간이동·리스폰): 바로 뒤에 붙는다
      const [dx, dy] = dirVec(o.dir);
      s.x = o.x - dx; s.y = o.y - dy; s.fromX = s.x; s.fromY = s.y; s.moveStart = 0; s.dir = o.dir;
    }
    const p = this.pos(s, now);
    const moving = s.moveStart > 0;
    return { id: petId, x: p.x, y: p.y, moving, moveT: moving ? Math.min(1, (now - s.moveStart) / s.moveDur) : 0, hopAt: s.hopAt, dir: s.dir, scale: petScale(xp), ride: false };
  }
  private pos(s: PetState, now: number): { x: number; y: number } {
    if (!s.moveStart) return { x: s.x, y: s.y };
    const t = Math.min(1, (now - s.moveStart) / s.moveDur);
    if (t >= 1) { s.moveStart = 0; return { x: s.x, y: s.y }; }
    return { x: s.fromX + (s.x - s.fromX) * t, y: s.fromY + (s.y - s.fromY) * t };
  }
  // 벌레를 잡았다: 폴짝 (탑승 중이라 상태가 없으면 만들어 둔다)
  hop(uid: string, now: number): void {
    let s = this.st.get(uid);
    if (!s) { s = { x: 0, y: 0, fromX: 0, fromY: 0, moveStart: 0, moveDur: 160, lastOwnerMove: -1, hopAt: now, dir: 0 }; this.st.set(uid, s); }
    s.hopAt = now;
  }
}
