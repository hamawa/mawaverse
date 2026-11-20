// 모두에게 보이는 눈사람 (2026-11-20, 사용자 요청: 전에는 만든 사람 화면에만 있었다).
// winter/sm/{x_y} = { u: 만든 사람, at: 만든 서버 시각 }. 겨울 맵에 있는 동안만 구독한다. 굴리는 눈덩이는 여전히 각자 화면에만 있다.
// - 한 사람 SNOWMAN_OWN_MAX 개: 더 만들면 내 가장 오래된 눈사람이 같은 쓰기에서 녹는다 (내 것은 벌칙 없이 지울 수 있다. 규칙은 개수를 세지 못한다: 화면이 지킨다)
// - SNOWMAN_MS 뒤에 녹는다 (시각으로 계산, 쓰기 없음. 녹은 기록은 다음에 만드는 사람이 몇 개씩 같이 지운다)
// - 누구나 F 두 번으로 부술 수 있고, 부수는 쓰기는 벌칙 쓰기(snowpenalty.ts)와 한 번에 간다 (규칙: 같은 쓰기에서 내 snowBrokenAt 이 지금이어야 남의 눈사람을 지울 수 있다)
import { ref, onValue, update, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import { WINTER_MAP_ID } from '../shared/maps';

export const SNOWMAN_OWN_MAX = 3;
export const SNOWMAN_MS = 60 * 60 * 1000;
interface Rec { u: string; at: number }
const keyOf = (x: number, y: number): string => `${x}_${y}`;

export class SnowmenMgr {
  private men = new Map<string, Rec>();
  private unsub: (() => void) | null = null;
  onChange: (() => void) | null = null;
  constructor(private uid: string) {}

  watch(mapId: string): void {
    this.unsub?.(); this.unsub = null;
    this.men.clear();
    if (mapId !== WINTER_MAP_ID) return;
    this.unsub = onValue(ref(db, 'winter/sm'), (s) => {
      this.men.clear();
      s.forEach((c) => { const v = c.val() as Rec | null; if (v && typeof v.at === 'number' && c.key) this.men.set(c.key, v); });
      this.onChange?.();
    }, () => {});
  }
  stop(): void { this.unsub?.(); this.unsub = null; this.men.clear(); }

  // 지금 서 있는 눈사람들
  list(now = serverNow()): { x: number; y: number; mine: boolean }[] {
    const out: { x: number; y: number; mine: boolean }[] = [];
    for (const [k, r] of this.men) {
      if (now - r.at >= SNOWMAN_MS) continue;
      const m = /^(\d{1,2})_(\d{1,2})$/.exec(k);
      if (m) out.push({ x: Number(m[1]), y: Number(m[2]), mine: r.u === this.uid });
    }
    return out;
  }
  // 눈사람을 만들었다: 적는다. 내 것이 한도를 넘으면 가장 오래된 것부터 녹인다
  async add(x: number, y: number): Promise<boolean> {
    const now = serverNow(), key = keyOf(x, y);
    const upd: Record<string, unknown> = { [`winter/sm/${key}`]: { u: this.uid, at: serverTimestamp() } };
    const mine = [...this.men].filter(([k, r]) => r.u === this.uid && now - r.at < SNOWMAN_MS && k !== key).sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i <= mine.length - SNOWMAN_OWN_MAX; i++) upd[`winter/sm/${mine[i][0]}`] = null;
    let n = 0;
    for (const [k, r] of this.men) { if (n >= 5) break; if (k !== key && now - r.at > SNOWMAN_MS + 60000 && !(`winter/sm/${k}` in upd)) { upd[`winter/sm/${k}`] = null; n++; } }
    try { await update(ref(db), upd); return true; } catch (e) { console.warn('snowman save failed', e); return false; }
  }
  // 부수는 쓰기에 같이 실을 조각 (벌칙 쓰기와 한 번에)
  removeUpdate(x: number, y: number): Record<string, unknown> { return this.men.has(keyOf(x, y)) ? { [`winter/sm/${keyOf(x, y)}`]: null } : {}; }
}
