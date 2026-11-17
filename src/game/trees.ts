import { ref, onValue, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import { O } from './map';
import { isHomeMapId } from '../shared/maps';
import { TREE_REGROW_MS, treeStage, treeCut, posKey } from '../shared/home';

// 벤 나무 (2026-11-17 저녁, shared/home.ts): trees/{맵 id}/{x_y} = 벤 서버 시각. 지금 있는 맵의 것만 구독한다.
// 맵 데이터의 오브젝트는 그대로 두고(길은 계속 막힌다) 그릴 때만 그루터기·덤불로 바꿔 보여 준다. 다시 자라는 것은 시각으로 계산한다: 쓰기가 없다
export class TreeMgr {
  private cut = new Map<string, number>();
  private unsub: (() => void) | null = null;
  private mapId = '';

  // 맵을 옮겼다: 그 맵의 벤 나무를 본다 (집 안에는 나무가 없다)
  watch(mapId: string): void {
    this.unsub?.(); this.unsub = null;
    this.cut.clear();
    this.mapId = mapId;
    if (isHomeMapId(mapId)) return;
    this.unsub = onValue(ref(db, `trees/${mapId}`), (s) => {
      this.cut.clear();
      s.forEach((c) => { const v = c.val(); if (typeof v === 'number' && c.key) this.cut.set(c.key, v); });
    }, () => {});
  }
  stop(): void { this.unsub?.(); this.unsub = null; this.cut.clear(); }

  // 지금 벨 수 없는 나무인가 (누가 벴고 아직 다 자라지 않았다)
  isCut(x: number, y: number): boolean { return treeCut(this.cut.get(posKey(x, y)), serverNow()); }
  // 그 칸에 그릴 오브젝트: 벤 나무는 그루터기, 자라는 중이면 덤불 (render 의 objAt)
  shown = (x: number, y: number, id: number): number => {
    if (id !== O.TREE && id !== O.PINE) return id;
    const s = treeStage(this.cut.get(posKey(x, y)), serverNow());
    return s === 'stump' ? O.STUMP : s === 'bush' ? O.BUSH : id;
  };
  // 이 나무를 벤 것으로 적는 쓰기 조각. 나무를 받는 쓰기와 한 번에 보낸다 (규칙: 내 homes 의 wa 가 같은 쓰기에서 지금이어야 한다).
  // 다 자란 지 오래된 기록도 몇 개 같이 치운다 (맵에 들어올 때 받는 양이 늘지 않게)
  markUpdate(x: number, y: number): Record<string, unknown> {
    const upd: Record<string, unknown> = { [`trees/${this.mapId}/${posKey(x, y)}`]: serverTimestamp() };
    const now = serverNow();
    let n = 0;
    for (const [k, t] of this.cut) {
      if (n >= 5) break;
      if (k !== posKey(x, y) && now - t > TREE_REGROW_MS + 60000) { upd[`trees/${this.mapId}/${k}`] = null; n++; }
    }
    this.cut.set(posKey(x, y), now); // 서버 값이 돌아오기 전에도 벤 것으로 본다
    return upd;
  }
  // 못 적었다 (누가 먼저 벴거나 통신 문제): 방금 넣어 둔 표시를 되돌린다. 실제로 베여 있으면 구독이 다시 채운다
  unmark(x: number, y: number, before: number | undefined): void {
    if (before === undefined) this.cut.delete(posKey(x, y)); else this.cut.set(posKey(x, y), before);
  }
  cutAt(x: number, y: number): number | undefined { return this.cut.get(posKey(x, y)); }
}
