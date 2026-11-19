// 클럽 DJ (2026-11-19, 사용자 요청): DJ 자리에 서서 유튜브 링크를 넣으면 클럽에 있는 모두가 같은 노래를 같은 지점부터 듣는다.
// 서버에는 "어떤 영상을 언제부터 틀었나" 한 줄만 둔다 (club/dj = { v: 영상 id, at: 튼 서버 시각, u, n }). 영상과 소리는 각자의 브라우저가 유튜브에서 직접 받는다:
// Firebase 전송량은 늘지 않는다. 클럽에 있는 동안에만 구독한다.
// 유튜브 약관: 공식 플레이어를 화면에 보이는 채로(200×200 이상) 써야 하고 소리만 따로 틀면 안 된다. 그래서 패널을 접으면 내 화면에서는 재생을 멈춘다 (djui.ts)
// 규칙(club/dj, 손으로 넣은 줄): 트는 사람은 클럽의 DJ 자리(CLUB_DJ_SPOTS)에 서 있어야 하고, 5초 안에 또 바꿀 수 없다. 끄기는 튼 사람·DJ 자리에 선 사람·관리자.
import { ref, onValue, update, remove, push, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/app';
import { CLUB_DJ_SPOTS } from './map';
import { youtubeId } from '../shared/youtube';
import type { WorldCtx } from './state';

export interface DjState { v: string; at: number; u: string; n: string }
export type DjResult = 'ok' | 'bad' | 'spot' | 'fail';

export class DjMgr {
  state: DjState | null = null;
  private unsub: (() => void) | null = null;
  private listeners = new Set<() => void>();
  constructor(private w: WorldCtx) {}

  // 클럽에 들어오면 구독하고 나가면 끊는다
  setActive(on: boolean): void {
    if (on === !!this.unsub) return;
    if (on) {
      this.unsub = onValue(ref(db, 'club/dj'), (s) => {
        const v = s.val() as DjState | null;
        this.state = v && typeof v.v === 'string' && typeof v.at === 'number' ? v : null;
        this.emit();
      }, () => {});
    } else { this.unsub?.(); this.unsub = null; this.state = null; this.emit(); }
  }
  stop(): void { this.setActive(false); this.listeners.clear(); }
  listen(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(): void { for (const fn of this.listeners) fn(); }

  // 내가 DJ 자리에 서 있나 (걷는 중이 아닐 때)
  atBooth(): boolean { const me = this.w.me; return !me.moving && CLUB_DJ_SPOTS.some((p) => p.x === me.x && p.y === me.y); }

  // 노래 틀기. text: 유튜브 링크 또는 영상 id. 관리자가 볼 수 있게 누가 무엇을 틀었는지 기록을 같은 쓰기에 싣는다 (요청이 늘지 않는다)
  async play(text: string): Promise<DjResult> {
    const id = youtubeId(text);
    if (!id) return 'bad';
    if (!this.atBooth()) return 'spot';
    const w = this.w, key = push(ref(db, 'logs/chat')).key!;
    try {
      await update(ref(db), {
        'club/dj': { v: id, at: serverTimestamp(), u: w.uid, n: w.profile.nick },
        [`logs/chat/${key}`]: { u: w.uid, n: w.profile.nick, c: 'dj', t: `🎧 유튜브 ${id}`, ts: serverTimestamp() },
      });
      return 'ok';
    } catch (e) { console.warn('노래 틀기 실패', e); return 'fail'; }
  }
  // 끄기: 내가 튼 노래이거나, 내가 DJ 자리에 서 있거나, 관리자일 때
  async off(): Promise<boolean> {
    try { await remove(ref(db, 'club/dj')); return true; } catch { return false; }
  }
}
