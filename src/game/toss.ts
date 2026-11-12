import { ref, get, update, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/app';
import { weekKey } from '../shared/fish';
import { dirVec, frontTiles } from './area';
import { guardedOf, assignBats } from '../shared/shop';
import { serverNow } from '../firebase/db';
import { snowActive } from '../shared/snowpenalty';
import { playerMapId } from '../shared/maps';
import { planSnowThrow, snowStillThere, snowMsgValid } from './snowfight';
import type { Net } from './net';
import type { WorldCtx, RemotePlayer } from './state';
import type { TossMsg } from '../shared/types';

export const TOSS_COOLDOWN_MS = 3000;
export const TOSS_RANGE = 3;      // 앞으로 몇 칸까지 (보따리 없을 때)
export const TOSS_FLY_MS = 400;   // 날아가는 시간. 이 안에 옆으로 피하면 빗나간다
export const TOSS_STUN_MS = 1000; // 맞으면 이만큼 못 움직인다

// 렌더용 (타일 좌표, performance.now). icon 이 있으면 그 글자를 직선으로(장풍 💨), 없으면 🧸 포물선
export interface TossView { fx: number; fy: number; tx: number; ty: number; start: number; icon?: string; snow?: true } // snow: 스키 장갑 눈덩이 (🧸 대신 눈덩이를 같은 포물선으로 그린다)
export interface TossWeekEntry { n: string; h: number; t: number; at: number }             // toss/week/{wk}/{uid}: 닉, 명중, 던짐, 마지막
type Shot = { uid: string; m: Omit<TossMsg, 't'> };

// 말랑이 던지기: 바라보는 방향 3칸 안의 첫 사람에게 G. 0.4초 날아가 맞으면 😵 1초 스턴(낚시 중이면 취소).
// 맞았는지는 날아간 뒤 그 사람이 아직 그 칸에 있는지로 각 클라이언트가 판단한다 (서버 코드 없음).
// 말랑이 보따리(상점 장비)가 있으면 앞 4칸 × 옆 4칸(area.ts) 안의 모두에게 한꺼번에. 푹신 갑옷(presence ta)을 입은 사람은 맞아도 🛡 만 뜨고 스턴이 없다.
export class TossMgr {
  private flying: TossView[] = [];
  private lastThrow = -1e9;

  constructor(private w: WorldCtx, private net: Net, private hooks: { cancelFishing: () => void }) {}

  views(now: number): TossView[] {
    this.flying = this.flying.filter((t) => now - t.start < TOSS_FLY_MS + 80);
    return this.flying;
  }
  // 다른 맵으로 옮겼다: 날아가던 효과를 지우고, 착지 판정(명중·스턴·낚시 취소·기록)도 버린다
  private gen = 0;
  clear(): void { this.flying = []; this.gen++; }
  private land(fn: () => void): void { const g = this.gen; window.setTimeout(() => { if (g === this.gen) fn(); }, TOSS_FLY_MS); }
  cooldownLeft(): number { return Math.max(0, TOSS_COOLDOWN_MS - (performance.now() - this.lastThrow)); }
  // 장풍 💨 효과 (미는 쪽과 밀리는 쪽이 각자 그린다)
  wave(fx: number, fy: number, tx: number, ty: number): void { this.flying.push({ fx, fy, tx, ty, start: performance.now(), icon: '💨' }); }
  // 갈고리 ⚓ 효과: 끄는 사람에게서 끌려올 사람 쪽으로 줄이 날아간다 (끄는 쪽과 끌리는 쪽이 각자 그린다)
  hook(fx: number, fy: number, tx: number, ty: number): void { this.flying.push({ fx, fy, tx, ty, start: performance.now(), icon: '⚓' }); }

  // 겨냥 범위 안의 사람들. 보따리가 없으면 앞 3칸 안의 첫 사람 하나
  private targets(): RemotePlayer[] {
    const w = this.w, me = w.me;
    const [dx, dy] = dirVec(me.dir);
    if (!w.profile.own?.tossbag) {
      for (let i = 1; i <= TOSS_RANGE; i++) { const rp = w.playerAt(me.x + dx * i, me.y + dy * i); if (rp && !rp.st.r) return [rp]; } // st.r: 카지노 안에 앉아 있는 사람은 건드릴 수 없다 (2026-11-12)
      return [];
    }
    const out: RemotePlayer[] = [];
    for (const [x, y] of frontTiles(me.x, me.y, dx, dy)) { const rp = w.playerAt(x, y); if (rp && !rp.st.r && !out.includes(rp)) out.push(rp); }
    return out;
  }

  // G: true 면 던졌다
  throwAt(): boolean {
    const w = this.w, me = w.me, now = performance.now();
    if (me.roomId) return false;
    const left = this.cooldownLeft();
    if (left > 0) { w.toast(`말랑이는 ${Math.ceil(left / 1000)}초 후에 다시 던질 수 있어요.`, true); return false; }
    const bag = !!w.profile.own?.tossbag;
    const targets = this.targets();
    if (!targets.length) { w.toast(bag ? '앞 4칸 안에 아무도 없어요. 상대 쪽을 바라보고 던지세요.' : '앞 3칸 안에 아무도 없어요. 상대를 바라보고 던지세요.', true); return false; }
    this.lastThrow = now;
    // 방어 중인 사람에게는 빠따가 있으면 한 개씩 써서 깨고 맞힌다 (b=1). 모자라면 그 사람은 막는다
    const plan = assignBats(targets.map((t) => guardedOf(t.st, 'toss', serverNow())), w.wallet.batsReady());
    const shots: Shot[] = targets.map((t, i) => ({ uid: t.uid, m: { f: w.uid, fx: me.x, fy: me.y, tx: Math.round(t.x), ty: Math.round(t.y), ...(plan[i].bat ? { b: 1 } : {}) } }));
    w.batNote(shots.filter((s) => s.m.b).length);
    for (const s of shots) this.flying.push({ fx: s.m.fx, fy: s.m.fy, tx: s.m.tx, ty: s.m.ty, start: now });
    if (shots.length === 1) this.net.toss(shots[0].uid, shots[0].m); else this.net.tossMany(shots);
    this.land(() => {
      let hits = 0, blocked = 0;
      for (const s of shots) {
        const rp = w.players.get(s.uid);
        if (!rp || Math.round(rp.x) !== s.m.tx || Math.round(rp.y) !== s.m.ty) continue;
        if (!s.m.b && guardedOf(rp.st, 'toss', serverNow())) { rp.blockAt = performance.now(); blocked++; } else { rp.hitAt = performance.now(); hits++; }
      }
      const one = w.nickOf(shots[0].uid);
      const text = shots.length === 1
        ? (hits ? `🧸 ${one} 명중!` : blocked ? `🛡 ${one} 이(가) 막았다!` : `🧸 ${one} 이(가) 피했다!`)
        : `🎁 말랑이 보따리! ${shots.length}명 중 ${hits}명 명중` + (blocked ? `, ${blocked}명은 막음` : '');
      w.note(text); // 채팅에는 안 남긴다 (2026-11-09)
      void this.record(hits > 0);
    });
    return true;
  }

  // 스키 장갑 눈덩이 (겨울 눈싸움, snowfight.ts). F 로 던진다. true 면 던졌다: 쿨타임(말랑이와 같은 TOSS_COOLDOWN_MS, 실제로 던질 때만 시작)이면 false 라 뭉친 눈이 남는다.
  // 앞 4칸(frontTiles) 안 가장 가까운 사람에게 말랑이 경로로 보낸다(s=1: 방어 무시 표시, b 빠따와 무관). 대상이 없으면 눈덩이만 날아가고 알림은 없다. 추적 없음: 날아간 뒤 그 칸에 있어야 맞는다.
  // 방어 깨짐(gb)·갑옷 해제는 하지 않고 말랑이 주간 기록(toss/week)에도 넣지 않는다
  throwSnow(): boolean {
    const w = this.w, me = w.me, now = performance.now();
    const left = this.cooldownLeft();
    if (left > 0) { w.toast(`눈덩이는 ${Math.ceil(left / 1000)}초 후에 다시 던질 수 있어요.`, true); return false; }
    this.lastThrow = now;
    const plan = planSnowThrow(me, (x, y) => w.playerAt(x, y));
    const m: Omit<TossMsg, 't'> = { f: w.uid, fx: me.x, fy: me.y, tx: plan.tx, ty: plan.ty, s: 1 };
    this.flying.push({ fx: m.fx, fy: m.fy, tx: m.tx, ty: m.ty, start: now, snow: true });
    const target = plan.target;
    if (!target) return true;
    this.net.toss(target.uid, m);
    this.land(() => {
      const rp = w.players.get(target.uid);
      if (!rp || !snowStillThere(rp, m.tx, m.ty)) { w.note(`❄ ${w.nickOf(target.uid)} 이(가) 피했다!`); return; }
      rp.hitAt = performance.now();
      w.note(`❄ ${w.nickOf(target.uid)} 명중!`);
    });
    return true;
  }

  // 눈덩이를 받는 쪽의 공통 검사: 나도 던진 사람도 같은 겨울 맵, 범위 안
  private snowOk(m: TossMsg): boolean {
    const thrower = this.w.players.get(m.f);
    return snowMsgValid(this.w.mapId, thrower ? playerMapId(thrower.st) : undefined, m);
  }

  // 다른 사람이 던진 것 (상대의 presence 로 전파). 내가 던진 건 이미 그렸으므로 제외
  onRemote(targetUid: string, m: TossMsg): void {
    if (m.f === this.w.uid) return;
    if (m.s) { // 눈덩이: 방어를 보지 않는다 (🛡 없음)
      if (!this.snowOk(m)) return;
      this.flying.push({ fx: m.fx, fy: m.fy, tx: m.tx, ty: m.ty, start: performance.now(), snow: true });
      this.land(() => { const rp = this.w.players.get(targetUid); if (rp && snowStillThere(rp, m.tx, m.ty)) rp.hitAt = performance.now(); });
      return;
    }
    this.flying.push({ fx: m.fx, fy: m.fy, tx: m.tx, ty: m.ty, start: performance.now() });
    this.land(() => {
      const rp = this.w.players.get(targetUid);
      if (!rp || Math.round(rp.x) !== m.tx || Math.round(rp.y) !== m.ty) return;
      if (!m.b && guardedOf(rp.st, 'toss', serverNow())) rp.blockAt = performance.now(); else rp.hitAt = performance.now();
    });
  }

  // 나한테 날아온 것
  onHitMe(m: TossMsg): void {
    const w = this.w;
    if (w.me.roomId) return; // 카지노 안에 앉아 있는 동안은 말랑이도 안 맞는다
    if (m.s) { this.onSnowHitMe(m); return; }
    this.flying.push({ fx: m.fx, fy: m.fy, tx: m.tx, ty: m.ty, start: performance.now() });
    this.land(() => {
      const me = w.me, now = performance.now();
      if (me.x !== m.tx || me.y !== m.ty) { w.toast('🧸 휙! 피했다.'); return; }
      // 빠따(b=1): 방어를 깨고 그대로 맞는다. 이미 깨져 있는 동안에도 방어가 없다 (2026-11-11)
      if (m.b === 1 && !snowActive(w.snowBrokenAt, serverNow()) && (w.profile.eq?.ta || w.petGuard())) w.breakGuard(w.nickOf(m.f));
      const open = w.guardBroken();
      if (!open && w.profile.eq?.ta) { me.blockAt = now; w.toast(`🧥 푹신 갑옷이 ${w.nickOf(m.f)} 의 말랑이를 튕겨냈다.`); return; }
      if (!open && w.petGuard()) {
        // 펫 방어 (Lv8, 2026-11-10): 튕겨내고, 80% 확률로 던진 사람에게 되던진다 (r 표시: 되돌아온 건 다시 안 튕긴다)
        me.blockAt = now;
        const thrower = w.players.get(m.f);
        if (!m.r && thrower && w.petReflect()) {
          const back: Omit<TossMsg, 't'> = { f: w.uid, fx: me.x, fy: me.y, tx: Math.round(thrower.x), ty: Math.round(thrower.y), r: true };
          this.flying.push({ ...back, start: now });
          this.net.toss(m.f, back);
          this.land(() => { const rp = w.players.get(m.f); if (rp && Math.round(rp.x) === back.tx && Math.round(rp.y) === back.ty) { if (guardedOf(rp.st, 'toss', serverNow())) rp.blockAt = performance.now(); else rp.hitAt = performance.now(); } });
          w.toast(`🛡 펫이 ${w.nickOf(m.f)} 의 말랑이를 되던졌다!`);
        } else w.toast(`🛡 펫이 ${w.nickOf(m.f)} 의 말랑이를 튕겨냈다.`);
        return;
      }
      me.hitAt = now; me.stunUntil = now + TOSS_STUN_MS;
      this.hooks.cancelFishing();
      w.toast(m.r ? `😵 ${w.nickOf(m.f)} 의 펫이 되던진 말랑이에 맞았다!` : `😵 ${w.nickOf(m.f)} 의 말랑이에 맞았다!`);
    });
  }

  // 나한테 날아온 눈덩이: 갑옷·펫 방어·되받아치기·빠따 방어 깨짐을 모두 건너뛰고, 그 칸에 아직 있으면 말랑이와 같은 TOSS_STUN_MS 스턴 (방어 깨짐 gb·갑옷 해제 없음)
  private onSnowHitMe(m: TossMsg): void {
    const w = this.w;
    if (!this.snowOk(m)) return;
    this.flying.push({ fx: m.fx, fy: m.fy, tx: m.tx, ty: m.ty, start: performance.now(), snow: true });
    this.land(() => {
      const me = w.me, now = performance.now();
      if (!snowStillThere(me, m.tx, m.ty)) { w.toast('❄ 휙! 피했다.'); return; }
      me.hitAt = now; me.stunUntil = now + TOSS_STUN_MS;
      this.hooks.cancelFishing();
      w.toast(`😵 ${w.nickOf(m.f)} 의 눈덩이에 맞았다!`);
    });
  }

  private async record(hit: boolean): Promise<void> {
    const w = this.w;
    try {
      const path = `toss/week/${weekKey()}/${w.uid}`;
      const cur = (await get(ref(db, path))).val() as TossWeekEntry | null;
      await update(ref(db), { [path]: { n: w.profile.nick, h: (cur?.h || 0) + (hit ? 1 : 0), t: (cur?.t || 0) + 1, at: serverTimestamp() } });
      this.net.stat('toss');
    } catch (e) { console.warn('toss record failed', e); }
  }
}
