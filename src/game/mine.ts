import { G_GOLD, groundAt } from './map';
import { dirVec } from './area';
import { GOLD_MINE_MAP_ID } from '../shared/maps';
import { MINE_MS, MINE_IDLE_OFF_MS, rollGold, fmtGold, pickAttempts } from '../shared/mine';
import type { Net } from './net';
import type { WorldCtx } from './state';

// 금광 채광 (2026-11-11): 거대한 금덩어리 옆 칸에서 금덩어리를 보고 F → 곡괭이질 한 번(3초) → 금덩이 1~3개가 지갑에 들어온다.
// F 한 번(반복 입력은 world.interact 가 거른다)에 곡괭이 단계+1 번(0단계 1번 … 10단계 11번)을 차례로 치고 멈춘다: 자동으로 이어 치지 않는다. 치는 중·저장 중에 누른 F 는 무시한다.
// 곡괭이질마다 3초(MINE_MS) 뒤에 보상을 굴려 그 한 번씩 저장한다(쓰기 간격은 그대로). 움직이거나 돌아서거나 밀려나거나 맵을 옮기거나 곡괭이 단계가 바뀌면(업그레이드) 남은 횟수는 취소되고,
// 이미 끝나 저장된 곡괭이질의 금덩이는 그대로다. 끝나지 않은 곡괭이질은 보상을 굴리지 않는다.
// 채광 시각과 개수 범위(곡괭이 단계 보너스 포함)는 지갑 규칙이 본다 (shared/mine.ts, tools/gen-rules.cjs)
interface Batch {
  x: number; y: number; mapId: string;
  level: number;      // 시작할 때의 곡괭이 단계 (바뀌면 취소)
  total: number;      // 이번 F 로 칠 총 횟수
  done: number;       // 저장까지 끝난 횟수
  gained: number;     // 이번에 캔 금덩이 합계
  start: number; until: number;  // 지금 치는 곡괭이질
  saving: boolean;    // 곡괭이질이 끝나 보상을 저장하는 중
}
export class MineMgr {
  private batch: Batch | null = null;
  private shown = false;     // 남에게 보이는 "채광 중" 표시(players/{uid}/mn)를 켜 두었나
  private lastSwingAt = 0;

  constructor(private w: WorldCtx, private net: Net) {}

  get active(): boolean { return !!this.batch; }
  // 곡괭이질(현재 한 번)을 시작한 시각 (그리기용). 안 치는 중이면 0
  get since(): number { return this.batch?.start ?? 0; }
  // 화면 안내용: 이번 F 로 남은 곡괭이질 수(지금 치는 것·저장 중인 것 포함. 안 치면 0), 총 횟수, 저장까지 끝난 횟수
  get remaining(): number { return this.batch ? this.batch.total - this.batch.done : 0; }
  get attempts(): number { return this.batch?.total ?? 0; }
  get completed(): number { return this.batch?.done ?? 0; }
  get saving(): boolean { return !!this.batch?.saving; }
  // 지금 곡괭이 단계로 F 한 번에 치게 될 횟수
  get nextAttempts(): number { return pickAttempts(this.w.wallet.pickLevel); }

  // 지금 캘 수 있는 금덩어리 칸: 금광 맵에서, 멈춰 서서 바라보는 칸이 금덩어리일 때 (낚시의 물가와 같은 방식)
  target(): { x: number; y: number } | null {
    const w = this.w, me = w.me;
    if (w.mapId !== GOLD_MINE_MAP_ID || w.switching || me.moving || me.locked || me.roomId) return null;
    const [dx, dy] = dirVec(me.dir);
    const tx = me.x + dx, ty = me.y + dy;
    return groundAt(w.map, tx, ty) === G_GOLD ? { x: tx, y: ty } : null;
  }

  // F: 곡괭이 단계+1 번 치기 시작. 이미 치는 중(저장 중 포함)이면 무시
  begin(): boolean {
    if (this.batch || !this.target()) return false;
    const w = this.w, me = w.me, now = performance.now(), level = w.wallet.pickLevel;
    this.batch = { x: me.x, y: me.y, mapId: w.mapId, level, total: pickAttempts(level), done: 0, gained: 0, start: now, until: now + MINE_MS, saving: false };
    this.lastSwingAt = now;
    this.show(true);
    return true;
  }
  // 남은 곡괭이질을 조용히 취소한다 (밀림·순간이동 등. 저장된 보상은 그대로)
  cancel(): void { this.batch = null; }
  // 안내와 함께 취소
  private stop(why: string): void {
    const b = this.batch;
    this.batch = null;
    if (b && b.total - b.done > 0) this.w.note(`⛏ ${why} 남은 곡괭이질 ${b.total - b.done}번은 취소! (이미 캔 금덩이는 그대로)`);
  }

  tick(now: number): void {
    const w = this.w, me = w.me, b = this.batch;
    if (b) {
      // 취소 조건: 맵 이동 → 자리 이탈 → 곡괭이 단계 변경 → 금덩어리를 안 봄(돌아서기·밀림 등). 맵 이동은 left()/cancel() 이 먼저 지우지만 한 프레임 사이도 막는다
      if (w.mapId !== b.mapId || w.switching) this.batch = null;
      else if (me.moving || me.x !== b.x || me.y !== b.y) this.stop('자리를 떠서');
      else if (w.wallet.pickLevel !== b.level) this.stop('곡괭이가 바뀌어서');
      else if (!this.target()) this.stop('금덩어리를 보고 있지 않아서');
      else if (!b.saving && now >= b.until) { b.saving = true; this.lastSwingAt = now; void this.finish(b); }
    }
    // 자리를 떴거나 한동안 안 쳤으면 채광 중 표시를 끈다
    if (this.shown && !this.batch && (!this.target() || now - this.lastSwingAt > MINE_IDLE_OFF_MS)) this.show(false);
  }

  // 맵을 옮겼다: 표시는 맵 이동 쓰기가 같이 비웠으니 내 쪽 상태만 맞춘다
  left(): void { this.batch = null; this.shown = false; }

  private show(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    this.net.setMining(on);
  }

  // 끝난 곡괭이질 하나의 보상을 저장하고, 아직 취소되지 않았고 남았으면 다음 곡괭이질을 시작한다. 저장을 기다리는 사이 취소·맵 이동·새 F 로 batch 가 바뀌었으면
  // (this.batch !== b) 이 비동기 완료는 아무것도 다시 시작하지 않는다. 다음 곡괭이질은 저장이 끝난 뒤에 시작하므로 쓰기 간격은 늘 곡괭이질 시간(3초) 이상이다
  private async finish(b: Batch): Promise<void> {
    const w = this.w;
    const n = rollGold(Math.random, b.level);
    let ok = await w.wallet.mine(n);
    // 통신이 밀려 앞 쓰기와 간격이 좁게 도착하면 규칙이 거부한다: 한 번만 조금 뒤에 다시 (그 사이 취소됐으면 하지 않는다)
    if (!ok && this.batch === b) { await new Promise((r) => setTimeout(r, 700)); if (this.batch === b) ok = await w.wallet.mine(n); }
    if (ok) {
      b.done++; b.gained += n;
      w.catchNote('etc', `⛏ 금덩이 +${n} (${b.done}/${b.total}번째 · 보유 ${fmtGold(w.wallet.gold)})`); this.net.stat('mine');
    } else w.toast('금덩이를 받지 못했습니다. 잠시 후 다시 캐 보세요.', true);
    if (this.batch !== b) return;
    if (!ok || b.done >= b.total) {
      this.batch = null;
      if (ok && b.total > 1) w.note(`⛏ 곡괭이질 ${b.total}번 끝! 금덩이 +${b.gained}. 더 캐려면 다시 F`);
      return;
    }
    const now = performance.now();
    b.start = now; b.until = now + MINE_MS; b.saving = false;
  }
}
