import { ref, onValue, update, serverTimestamp, query, orderByChild, startAt, limitToLast, onChildAdded, onChildChanged } from 'firebase/database';
import type { DataSnapshot } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import { snowBreakWaitMs } from '../shared/snowpenalty';

const EVENT_WINDOW = 20; // 입장 이후 갱신된 기록을 한 번에 받는 창 (기록은 계정 하나에 하나뿐이라 총량은 계정 수로 묶인다)

// 눈사람 부순 벌칙의 저장·구독 (2026-11 겨울 놀이). 벌칙 시각은 서버 시각 하나(users/{uid}/snowBrokenAt)이고 끝나는 때는 shared/snowpenalty.ts 가 계산한다.
// 접속할 때(새로고침 포함) 구독을 시작하면 저장된 시각이 바로 들어온다. 맵을 옮겨도 이 값은 그대로다.
//  - onChange(brokenAt): 저장된 시각이 바뀔 때만 (0 = 없음). 같은 값은 다시 부르지 않는다. 벌칙 중인지는 호출한 쪽이 snowActive(brokenAt, serverNow()) 로 본다.
//    내가 부순 직후에는 쓰기 전의 임시 추정 시각이 먼저 들어오므로, 쓰기가 끝날 때까지는 받은 값을 모아 두었다가 끝난 뒤 마지막 값 하나만 알린다
//    (서버 값이 추정과 다르면 한 번 더 바로잡는다. 그래서 onChange 는 "상태 맞추기"만 해야 하고 알림·효과는 breakSnowman 의 true 로 처리한다)
//  - onAnnouncement(): 누군가 눈사람을 부술 때마다 모든 맵의 접속자에게 한 번. 알림 기록은 계정당 하나(winter/events/{uid} = { ts }, 부술 때마다 덮어쓴다)라 쌓이지 않는다.
//    * 남의 기록: 입장 이후(since) 새로 생기거나 ts 가 바뀐 것만 받고, (uid, 서버가 확정한 ts) 쌍으로 중복을 거른다 (재연결로 같은 기록이 다시 와도 한 번).
//    * 내 기록: 구독에서는 언제나 무시한다 (내 쓰기가 만드는 임시 추정 ts 와 거부된 쓰기 때문에). 내 알림은 breakSnowman 의 쓰기가 서버에 받아들여진 뒤 한 번만 호출한다.
//    기록에는 서버 시각만 있다 (누가 했는지·문구는 저장하지 않는다)
export class SnowPenaltyMgr {
  private unsubs: (() => void)[] = [];
  private last = 0;               // 마지막으로 onChange 에 알린 값
  private pending = false;        // 내 breakSnowman 쓰기가 진행 중
  private seen: number[] = [];    // 쓰기 중에 들어온 값 (임시 추정값 포함)
  private announced = new Map<string, number>(); // 남의 uid → 이미 알린 확정 ts

  constructor(private uid: string, private onChange: (brokenAt: number) => void, private onAnnouncement?: () => void) {}

  start(): void {
    if (this.unsubs.length) return;
    this.unsubs.push(onValue(ref(db, `users/${this.uid}/snowBrokenAt`), (s) => {
      const v = s.val();
      const at = typeof v === 'number' ? v : 0;
      if (this.pending) { this.seen.push(at); return; }
      this.apply(at);
    }, () => {}));
    if (this.onAnnouncement) {
      const since = serverNow();
      const q = query(ref(db, 'winter/events'), orderByChild('ts'), startAt(since), limitToLast(EVENT_WINDOW));
      const on = (s: DataSnapshot) => this.remoteEvent(s.key, (s.val() as { ts?: unknown } | null)?.ts, since);
      this.unsubs.push(onChildAdded(q, on), onChildChanged(q, on));
    }
  }

  // 남의 기록 하나: 내 것·입장 전 것·이미 알린 (uid, ts) 는 건너뛴다
  private remoteEvent(key: string | null, ts: unknown, since: number): void {
    if (!key || key === this.uid || typeof ts !== 'number' || ts < since || this.announced.get(key) === ts) return;
    this.announced.set(key, ts);
    this.onAnnouncement?.();
  }

  // 다시 부술 수 있기까지 남은 ms (0 이면 지금 부술 수 있다). 화면이 첫 F 를 받기 전에 물어 안내한다
  waitMs(): number { return snowBreakWaitMs(this.last, serverNow()); }

  stop(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  private apply(at: number): void {
    if (at === this.last) return;
    this.last = at;
    this.onChange(at);
  }

  // 눈사람을 부쉈다: 벌칙 시각(서버 시각)과 내 알림 기록(winter/events/{uid})을 쓰기 한 번에. 쓰기가 서버에 받아들여졌을 때만 true (규칙이 거부하거나 연결이 없으면 false → 눈사람을 지우지 않고 알림도 없다).
  // 직전에 부순 지 SNOW_BREAK_GAP_MS 가 안 지났으면 쓰지도 않고 false (규칙도 같은 간격을 요구한다). 다시 부수면 시각이 새로 써져 30분이 처음부터 다시 시작된다. 빠따의 방어 깨짐(gb, 60초)과는 별개다.
  // 내 전체 알림은 여기서 쓰기가 받아들여진 뒤 정확히 한 번 낸다 (구독은 내 기록을 무시한다)
  async breakSnowman(): Promise<boolean> {
    if (this.pending || this.waitMs() > 0) return false;
    this.pending = true; this.seen = [];
    try {
      // players/{uid}/sn 도 같은 쓰기에 실린다: 규칙은 벌칙 중인 사람의 presence 쓰기마다 sn 이 저장된 시각과 같기를 요구하므로, 따로 쓰면 그 사이(그리고 sn 쓰기가 실패하면 다음 하트비트까지)
      // 걸음·하트비트가 거부된다. presence 노드가 없으면(접속이 끊긴 순간) players/{uid} 부모 검증이 sn 만 있는 노드를 거부하므로 이 쓰기는 통째로 실패한다(반쪽 노드도, 벌칙 시각도, 알림 기록도 남지 않는다) → false
      await update(ref(db), { [`users/${this.uid}/snowBrokenAt`]: serverTimestamp(), [`players/${this.uid}/sn`]: serverTimestamp(), [`winter/events/${this.uid}`]: { ts: serverTimestamp() } });
    } catch {
      this.pending = false; this.seen = [];
      return false;
    }
    this.pending = false;
    const seen = this.seen; this.seen = [];
    if (seen.length) this.apply(seen[seen.length - 1]);
    this.onAnnouncement?.();
    return true;
  }
}
