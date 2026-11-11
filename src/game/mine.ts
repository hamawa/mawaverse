import { G_GOLD, groundAt } from './map';
import { dirVec } from './area';
import { GOLD_MINE_MAP_ID } from '../shared/maps';
import { MINE_MS, MINE_IDLE_OFF_MS, rollGold, fmtGold } from '../shared/mine';
import type { Net } from './net';
import type { WorldCtx } from './state';

// 금광 채광 (2026-11-11): 거대한 금덩어리 옆 칸에서 금덩어리를 보고 F → 곡괭이질 한 번(3초) → 금덩이 1~3개가 지갑에 들어온다.
// 한 번 누르면 한 번만 친다(자동 채광 없음. 키를 누르고 있는 반복 입력은 world.interact 가 거른다). 곡괭이질 중에 움직이거나 밀려나면 그 한 번은 보상 없이 끝난다.
// 채광 시각과 개수 범위는 지갑 규칙이 본다 (shared/mine.ts, tools/gen-rules.cjs)
export class MineMgr {
  private swing: { x: number; y: number; start: number; until: number } | null = null;
  private shown = false;     // 남에게 보이는 "채광 중" 표시(players/{uid}/mn)를 켜 두었나
  private lastSwingAt = 0;

  constructor(private w: WorldCtx, private net: Net) {}

  get active(): boolean { return !!this.swing; }
  // 곡괭이질을 시작한 시각 (그리기용). 안 치는 중이면 0
  get since(): number { return this.swing?.start ?? 0; }

  // 지금 캘 수 있는 금덩어리 칸: 금광 맵에서, 멈춰 서서 바라보는 칸이 금덩어리일 때 (낚시의 물가와 같은 방식)
  target(): { x: number; y: number } | null {
    const w = this.w, me = w.me;
    if (w.mapId !== GOLD_MINE_MAP_ID || w.switching || me.moving || me.locked || me.roomId) return null;
    const [dx, dy] = dirVec(me.dir);
    const tx = me.x + dx, ty = me.y + dy;
    return groundAt(w.map, tx, ty) === G_GOLD ? { x: tx, y: ty } : null;
  }

  // F: 곡괭이질 한 번 시작. 이미 치는 중이면 무시
  begin(): boolean {
    if (this.swing || !this.target()) return false;
    const me = this.w.me, now = performance.now();
    this.swing = { x: me.x, y: me.y, start: now, until: now + MINE_MS };
    this.lastSwingAt = now;
    this.show(true);
    return true;
  }
  // 보상 없이 그만둔다 (맵 이동·순간이동 등)
  cancel(): void { this.swing = null; }

  tick(now: number): void {
    const me = this.w.me;
    if (this.swing) {
      if (me.moving || me.x !== this.swing.x || me.y !== this.swing.y) { this.swing = null; this.w.note('⛏ 자리를 떠서 이번 곡괭이질은 허탕!'); }
      else if (now >= this.swing.until) { this.swing = null; this.lastSwingAt = now; void this.finish(); }
    }
    // 자리를 떴거나 한동안 안 쳤으면 채광 중 표시를 끈다
    if (this.shown && !this.swing && (!this.target() || now - this.lastSwingAt > MINE_IDLE_OFF_MS)) this.show(false);
  }

  // 맵을 옮겼다: 표시는 맵 이동 쓰기가 같이 비웠으니 내 쪽 상태만 맞춘다
  left(): void { this.swing = null; this.shown = false; }

  private show(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    this.net.setMining(on);
  }

  private async finish(): Promise<void> {
    const w = this.w;
    const n = rollGold();
    let ok = await w.wallet.mine(n);
    // 통신이 밀려 앞 쓰기와 간격이 좁게 도착하면 규칙이 거부한다: 한 번만 조금 뒤에 다시
    if (!ok) { await new Promise((r) => setTimeout(r, 700)); ok = await w.wallet.mine(n); }
    if (ok) { w.catchNote('etc', `⛏ 금덩이 +${n} (보유 ${fmtGold(w.wallet.gold)})`); this.net.stat('mine'); }
    else w.toast('금덩이를 받지 못했습니다. 잠시 후 다시 캐 보세요.', true);
  }
}
