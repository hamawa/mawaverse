import { ref, onValue, update, increment, serverTimestamp, set, remove } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import { O, O_BED, O_CHEST, objectAt, homeCanPlace } from './map';
import { dirVec } from './area';
import { homeMapId, homeOwnerOf, isHomeMapId } from '../shared/maps';
import {
  type HomeData, type Bundle, HOME_MAX_TIER, homeTier, tierOf, nextTier, woodOf, fishOf, slotsOf, capacityOf, extraSlotsOf, shieldOf,
  CHOP_MS, CHOP_SWINGS, WOOD_MAX, rollWood, slotItem, STORE_FLUSH_MS, STORE_MAX, SLEEP_MS, SHIELD_FISH, SHIELD_MAX, fmtWood,
  furnitureOf, FLOORS, FLOOR_WOOD, decoList, posKey,
} from '../shared/home';
import { itemById, priceOf } from '../shared/shop';
import type { Net } from './net';
import type { TreeMgr } from './trees';
import type { WorldCtx } from './state';
import { sfx } from './audio';
import { GOLD_COST } from '../shared/shop';
import { WALLS, GUEST_MAX, canTurn, turnOf } from '../shared/home';

// 내 집 (2026-11-17, shared/home.ts 머리말에 설계). 이 클래스는 내 homes/{uid} 를 구독하고, 나무 캐기·짓기·창고·겨울잠과 "지금 들어와 있는 집"의 상태를 맡는다.
// 맵 이동(들어가기·나가기)은 world.ts 가 포탈과 같은 길(usePortal)로 한다.
interface Chop { x: number; y: number; tx: number; ty: number; mapId: string; left: number; done: number; gained: number; start: number; until: number; saving: boolean }
export type BuildResult = 'ok' | 'wood' | 'coins' | 'max' | 'fail';

export class HomeMgr {
  data: HomeData | null = null;                 // 내 집 (없으면 null)
  returnTo: { map: string; x: number; y: number } | null = null; // 집에 들어오기 전에 있던 자리 (나갈 때 돌아간다)
  private hereData: HomeData | null = null;     // 남의 집에 들어와 있을 때 그 집
  private hereTier = 0;                         // 들어올 때의 단계 (바뀌면 방 모양이 달라져서 나가야 한다)
  private unsub: (() => void) | null = null;
  private hereUnsub: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private timer = 0;
  private chop: Chop | null = null;
  private sleepAt = 0;                          // 겨울잠을 시작한 시각 (Date.now. 0 = 안 잠). 뒤쪽 탭에서도 흐르게 벽시계로 잰다
  private sleepSpot: { x: number; y: number } | null = null;
  private eating = false;
  private pending = 0;                          // 아직 창고에 안 넣은 물고기
  private lastFlush = 0;
  private flushing = false;
  private fullNoted = false;
  private shieldLocal: number | null = null;    // 방금 쓴 든든함 (서버 값이 돌아오기 전에 또 맞아도 두 번 쓰지 않게)
  private marks = '0|0';                        // 마지막으로 presence 에 실은 표시 (든든함|겨울잠)
  private mustLeave: string | null = null;      // 남의 집에서 나가야 하는 이유 (잠김·철거·다시 지음). 나갈 때까지 되풀이해 시도한다
  private busy = false;                         // 짓기·칸 늘리기·팔기 쓰기가 진행 중 (또 누른 것을 무시)
  private decoSig = '';                         // 지금 그려 둔 집의 꾸미기 값 (바뀌면 방을 다시 만든다)
  decorating = false;                           // 꾸미기 모드: 내 집 안에서 빈 칸을 보고 F 로 가구를 놓고, 놓은 가구를 보고 F 로 치운다

  constructor(private w: WorldCtx, private net: Net, private h: { leave: (why?: string) => Promise<void>; swing: () => void; refresh: () => void; trees: TreeMgr }) {}

  start(): void {
    this.unsub = onValue(ref(db, `homes/${this.w.uid}`), (s) => {
      this.data = (s.val() as HomeData | null) || null;
      this.shieldLocal = null;
      if (capacityOf(this.data) - fishOf(this.data) > 0) this.fullNoted = false;
      this.syncMarks();
      if (this.inMine()) this.redraw(this.data);
      this.listeners.forEach((f) => f());
    }, () => {});
    this.timer = window.setInterval(() => this.slowTick(), 1000);
  }
  stop(): void {
    this.unsub?.(); this.unsub = null;
    this.hereUnsub?.(); this.hereUnsub = null;
    clearInterval(this.timer);
    this.listeners.clear();
    if (this.pending > 0) void this.flush(); // 나가기 전에 한 번 더 (간격이 짧으면 규칙이 거부한다: 그 몇 마리는 버린다)
  }
  listen(f: () => void): () => void { this.listeners.add(f); return () => this.listeners.delete(f); }

  get tier(): number { return tierOf(this.data); }
  get wood(): number { return woodOf(this.data); }
  get fish(): number { return fishOf(this.data); }
  get slots(): number { return slotsOf(this.data); }
  get capacity(): number { return capacityOf(this.data); }
  get shield(): number { return this.shieldLocal ?? shieldOf(this.data); }
  get locked(): boolean { return this.tier >= 2 && this.data?.lk === true; }
  get working(): boolean { return this.busy; }

  // ---- 지금 있는 집 ----
  inHome(): boolean { return isHomeMapId(this.w.mapId); }
  inMine(): boolean { return this.w.mapId === homeMapId(this.w.uid); }
  // 벽돌집 안: 밀치기·끌기·말랑이가 안 통한다 (보내는 쪽·받는 쪽 둘 다 이걸 본다)
  safeHere(): boolean { return this.inHome() && (this.inMine() ? this.tier : tierOf(this.hereData)) >= HOME_MAX_TIER; }
  // 맵을 옮겼다 (world.enterMap). 집 안이면 그 집을 지켜본다: 남의 집이 잠기거나 다시 지어지면 밖으로 나온다
  entered(mapId: string): void {
    this.chop = null; this.wake(); this.decorating = false;
    this.decoSig = mapId === homeMapId(this.w.uid) ? sigOf(this.data) : '';
    this.hereUnsub?.(); this.hereUnsub = null; this.hereData = null; this.hereTier = 0; this.mustLeave = null;
    if (!isHomeMapId(mapId)) { this.returnTo = null; return; }
    const owner = homeOwnerOf(mapId);
    if (owner === this.w.uid) return;
    this.hereUnsub = onValue(ref(db, `homes/${owner}`), (s) => {
      const hd = (s.val() as HomeData | null) || null, t = tierOf(hd);
      this.hereData = hd;
      if (!this.hereTier) this.hereTier = t;
      if (!t) this.mustLeave = '집이 없어져서 밖으로 나왔습니다.';
      else if (t !== this.hereTier) this.mustLeave = '집을 새로 짓는 중이라 밖으로 나왔습니다.';
      else if (t >= 2 && hd?.lk === true) this.mustLeave = '🔒 집주인이 문을 잠가서 밖으로 나왔습니다.';
      else this.redraw(hd); // 주인이 가구·바닥·박제를 바꿨으면 내 화면의 방도 다시 만든다
    }, () => { this.mustLeave = '집에 더 있을 수 없어 밖으로 나왔습니다.'; });
  }

  // 지금 들어와 있는 집의 값 (내 집이면 내 것). 방을 만들고 박제를 그리는 데 쓴다
  here(): HomeData | null { return this.inMine() ? this.data : this.inHome() ? this.hereData : null; }
  private redraw(hd: HomeData | null): void {
    const sig = sigOf(hd);
    if (!this.decoSig) { this.decoSig = sig; return; } // 들어올 때 이미 이 값으로 만들었다
    if (sig === this.decoSig) return;
    this.decoSig = sig;
    this.h.refresh();
  }

  // ---- 남에게 보이는 표시 (presence sd·hz) ----
  marksNow(): { sd?: number; hz?: boolean } { const sd = this.shield; return { ...(sd > 0 ? { sd } : {}), ...(this.sleeping ? { hz: true } : {}) }; }
  private syncMarks(): void {
    const key = `${this.shield}|${this.sleeping ? 1 : 0}`;
    if (key === this.marks) return;
    this.marks = key;
    if (this.w.online) this.net.setHomeMarks(this.shield, this.sleeping);
  }

  // ---- 나무 캐기 ----
  // 나무는 집을 다 지은 뒤에도 가구·바닥에 쓴다: 들 수 있는 만큼(WOOD_MAX)까지 캘 수 있다
  private woodGoal(): number { return WOOD_MAX; }
  get chopping(): boolean { return !!this.chop; }
  chopView(): { done: number; total: number } | null { return this.chop ? { done: this.chop.done, total: CHOP_SWINGS } : null; }
  // 지금 하는 도끼질 묶음(F 한 번 = CHOP_SWINGS 번)이 얼마나 됐나 (0~1). 머리 위 진행 막대용. 안 캐는 중이면 undefined
  chopProgress(now: number): { p: number; parts: number } | undefined {
    const c = this.chop;
    if (!c) return undefined;
    const cur = c.saving ? 1 : Math.max(0, Math.min(1, (now - c.start) / CHOP_MS)); // 저장을 기다리는 동안은 그 한 번이 다 찬 것으로
    return { p: Math.min(1, (c.done + cur) / CHOP_SWINGS), parts: CHOP_SWINGS };
  }
  chopTarget(): { x: number; y: number } | null {
    const w = this.w, me = w.me;
    if (this.wood >= this.woodGoal() || w.switching || me.moving || me.locked || me.roomId) return null;
    const [dx, dy] = dirVec(me.dir);
    const tx = me.x + dx, ty = me.y + dy, o = objectAt(w.map, tx, ty);
    // 누가 베어 그루터기·덤불이 된 나무는 다 자랄 때까지 못 캔다 (2026-11-17 저녁)
    return (o === O.TREE || o === O.PINE) && !this.h.trees.isCut(tx, ty) ? { x: tx, y: ty } : null;
  }
  // 지금 베고 있는 그 나무를 여전히 보고 있나 (내가 벤 것으로 적힌 뒤에도 남은 도끼질은 이어진다)
  private facingChopTree(c: Chop): boolean { const [dx, dy] = dirVec(this.w.me.dir); return this.w.me.x + dx === c.tx && this.w.me.y + dy === c.ty; }
  // F: 나무를 CHOP_SWINGS 번 이어서 친다. 치는 중이면 무시
  beginChop(): boolean {
    const t = this.chop ? null : this.chopTarget();
    if (!t) return false;
    const me = this.w.me, now = performance.now();
    this.chop = { x: me.x, y: me.y, tx: t.x, ty: t.y, mapId: this.w.mapId, left: CHOP_SWINGS, done: 0, gained: 0, start: now, until: now + CHOP_MS, saving: false };
    sfx('chop');
    return true;
  }
  private stopChop(why: string): void {
    const c = this.chop; this.chop = null;
    if (c && c.left > 0) this.w.note(`🌳 ${why} 남은 도끼질 ${c.left}번은 취소! (이미 캔 나무는 그대로)`);
  }
  // 화면 갱신마다 (world 의 프레임 루프)
  tick(now: number): void {
    const w = this.w, me = w.me, c = this.chop;
    if (!c) return;
    if (w.mapId !== c.mapId || w.switching) this.chop = null;
    else if (me.moving || me.x !== c.x || me.y !== c.y) this.stopChop('자리를 떠서');
    else if (!c.saving && this.wood >= this.woodGoal()) this.stopChop('나무를 더 들 수 없어서');
    else if (!c.saving && !this.facingChopTree(c)) this.stopChop('나무를 보고 있지 않아서');
    else if (!c.saving && now >= c.until) { c.saving = true; void this.finishChop(c); }
  }
  // mark: 이 나무의 첫 도끼질. 나무를 받으면서 그 나무를 벤 것으로 적는다 (한 번의 쓰기. 누가 먼저 벴으면 통째로 거부된다)
  private async writeWood(n: number, mark?: { x: number; y: number }): Promise<boolean> {
    const p = `homes/${this.w.uid}`;
    if (!mark) { try { await update(ref(db, p), { w: increment(n), wa: serverTimestamp() }); return true; } catch { return false; } }
    const before = this.h.trees.cutAt(mark.x, mark.y);
    try { await update(ref(db), { [`${p}/w`]: increment(n), [`${p}/wa`]: serverTimestamp(), ...this.h.trees.markUpdate(mark.x, mark.y) }); return true; }
    catch { this.h.trees.unmark(mark.x, mark.y, before); return false; }
  }
  private async finishChop(c: Chop): Promise<void> {
    const w = this.w;
    const n = Math.min(rollWood(), Math.max(1, this.woodGoal() - this.wood));
    const mark = c.done === 0 ? { x: c.tx, y: c.ty } : undefined;
    let ok = await this.writeWood(n, mark);
    // 통신이 밀려 앞 쓰기와 간격이 좁게 도착하면 규칙이 거부한다: 한 번만 조금 뒤에 다시
    if (!ok && this.chop === c) { await new Promise((r) => setTimeout(r, 700)); if (this.chop === c) ok = await this.writeWood(n, mark); }
    if (ok) { sfx('wood'); c.done++; c.left--; c.gained += n; w.catchNote('etc', `🌳 나무 +${n} (${c.done}/${CHOP_SWINGS}번째 · 보유 ${fmtWood(this.wood)})`); }
    else w.toast(mark ? '나무를 받지 못했습니다. 다른 사람이 먼저 벤 나무일 수 있어요.' : '나무를 받지 못했습니다. 잠시 후 다시 캐 보세요.', true);
    if (this.chop !== c) return;
    if (!ok || c.left <= 0) {
      this.chop = null;
      if (ok) w.note(`🌳 도끼질 ${CHOP_SWINGS}번 끝! 나무 +${c.gained}. 더 캐려면 다시 F`);
      return;
    }
    const now = performance.now();
    c.start = now; c.until = now + CHOP_MS; c.saving = false;
    this.h.swing(); sfx('chop');
  }

  // ---- 집 짓기·올리기 ----
  // 코인이 드는 단계는 먼저 그 값(보관함 품목)을 사고, 이어서 나무를 내며 단계를 올린다. 값만 내고 끊겼으면 다음에 누를 때 나무만 내면 된다
  private async pay(itemId: string): Promise<boolean> {
    const w = this.w;
    if (w.wallet.owns(itemId)) return true;
    const it = itemById(itemId);
    if (!it) return false;
    const price = priceOf(it, w.config.prices);
    if (w.wallet.balance < price) return false;
    const gold = GOLD_COST[itemId] || 0; // 금덩이가 함께 드는 품목 (황금 가구)
    return gold ? w.wallet.buyGold(itemId, price, gold) : w.wallet.buyCosmetic(itemId, price);
  }
  async build(): Promise<BuildResult> {
    const w = this.w, next = nextTier(this.data);
    if (!next) return 'max';
    if (this.wood < next.wood) return 'wood';
    if (this.busy) return 'fail';
    this.busy = true;
    try {
      if (this.inMine()) { await this.h.leave(); if (this.inMine()) return 'fail'; } // 방 모양이 바뀌므로 밖에서 짓는다 (못 나갔으면 짓지 않는다)
      if (next.item && !(await this.pay(next.item))) return 'coins';
      try { await update(ref(db, `homes/${w.uid}`), { t: next.tier, w: increment(-next.wood) }); } catch (e) { console.warn('집 짓기 실패', e); return 'fail'; }
      return 'ok';
    } finally { this.busy = false; }
  }
  // 창고 칸 늘리기 (코인). 집 단계가 정한 상한까지
  async addSlot(): Promise<'ok' | 'coins' | 'cap' | 'fail'> {
    const t = homeTier(this.data?.t), cur = extraSlotsOf(this.data);
    if (!t || cur >= t.extraSlots) return 'cap';
    if (this.busy) return 'fail';
    this.busy = true;
    try {
      if (!(await this.pay(slotItem(cur + 1)))) return 'coins';
      try { await update(ref(db, `homes/${this.w.uid}`), { s: cur + 1 }); } catch (e) { console.warn('칸 늘리기 실패', e); return 'fail'; }
      return 'ok';
    } finally { this.busy = false; }
  }
  async setLock(on: boolean): Promise<boolean> {
    if (this.tier < 2) return false;
    try { await update(ref(db, `homes/${this.w.uid}`), { lk: on ? true : null }); return true; } catch { return false; }
  }

  // ---- 꾸미기: 가구·바닥·박제 (2026-11-17 저녁) ----
  made(o: number): boolean { return this.data?.fu?.[String(o)] === true; }
  get decoCount(): number { return decoList(this.data).length; }
  get decoLimit(): number { return homeTier(this.data?.t)?.deco ?? 0; }
  // 가구 만들기: 그 종류를 나무로 한 번 만들면 몇 개든 놓을 수 있다.
  // 고급 가구(item 이 있는 것, 2026-11-18)는 나무 대신 그 품목을 산다: 코인(fn), 또는 코인 + 금덩이(gg). 값만 내고 끊겼어도 다음에 누르면 이어서 등록된다
  async craft(o: number): Promise<'ok' | 'wood' | 'coins' | 'fail'> {
    const f = furnitureOf(o);
    if (!f || !this.tier || this.made(o) || this.busy) return 'fail';
    if (f.item) {
      this.busy = true;
      try {
        if (!(await this.pay(f.item))) return 'coins';
        await update(ref(db, `homes/${this.w.uid}`), { [`fu/${o}`]: true });
        return 'ok';
      } catch (e) { console.warn('가구 만들기 실패', e); return 'fail'; } finally { this.busy = false; }
    }
    if (this.wood < f.wood) return 'wood';
    this.busy = true;
    try { await update(ref(db, `homes/${this.w.uid}`), { [`fu/${o}`]: true, w: increment(-f.wood) }); return 'ok'; }
    catch (e) { console.warn('가구 만들기 실패', e); return 'fail'; }
    finally { this.busy = false; }
  }
  // 꾸미기 모드에서 내 앞 칸: 내가 놓은 가구면 치우기, 놓을 수 있는 빈 칸이면 놓기
  facingDeco(): { kind: 'place' | 'remove'; x: number; y: number; o: number } | null {
    const w = this.w, me = w.me;
    if (!this.decorating || !this.inMine() || w.switching || me.moving || me.locked) return null;
    const [dx, dy] = dirVec(me.dir);
    const x = me.x + dx, y = me.y + dy;
    const mine = this.data?.d?.[posKey(x, y)];
    if (typeof mine === 'number' && objectAt(w.map, x, y) === mine) return { kind: 'remove', x, y, o: mine };
    if (homeCanPlace(this.tier, x, y) && objectAt(w.map, x, y) === O.NONE && !w.occupied(x, y)) return { kind: 'place', x, y, o: 0 };
    return null;
  }
  async place(o: number): Promise<'ok' | 'limit' | 'spot' | 'fail'> {
    const f = this.facingDeco();
    if (!f || f.kind !== 'place' || !this.made(o)) return 'spot';
    if (this.decoCount >= this.decoLimit) return 'limit';
    // 전에 그 칸에 있던 가구의 방향이 남아 있으면 같이 지운다 (새 가구는 앞을 보고 놓인다)
    try { await update(ref(db, `homes/${this.w.uid}`), { [`d/${posKey(f.x, f.y)}`]: o, [`dr/${posKey(f.x, f.y)}`]: null }); return 'ok'; } catch (e) { console.warn('가구 놓기 실패', e); return 'fail'; }
  }
  async removeFront(): Promise<boolean> {
    const f = this.facingDeco();
    return !!f && f.kind === 'remove' && this.removeAt(f.x, f.y, f.o);
  }
  // 그 칸에 내가 놓은 가구 (없으면 null)
  decoAt(x: number, y: number): number | null { const o = this.data?.d?.[posKey(x, y)]; return typeof o === 'number' ? o : null; }
  // 놓은 가구 하나를 치운다 (방향도 같이 지운다). o: 그 칸에 있다고 본 가구 (그새 바뀌었으면 건드리지 않는다)
  async removeAt(x: number, y: number, o: number): Promise<boolean> {
    if (!this.inMine() || this.decoAt(x, y) !== o) return false;
    try { await update(ref(db, `homes/${this.w.uid}`), { [`d/${posKey(x, y)}`]: null, [`dr/${posKey(x, y)}`]: null }); return true; } catch { return false; }
  }
  // 가구 방향 (2026-11-19, 사용자 요청): 0 앞 · 1 왼쪽 · 2 오른쪽 · 3 뒤. 앞이면 칸을 지운다 (shared/home.ts TURNABLE 만 돌릴 수 있다)
  turnAt(x: number, y: number): number { return turnOf(this.data, x, y); }
  async setTurn(x: number, y: number, o: number, dir: number): Promise<boolean> {
    if (!this.inMine() || !canTurn(o) || this.decoAt(x, y) !== o || ![0, 1, 2, 3].includes(dir)) return false;
    try { await update(ref(db, `homes/${this.w.uid}/dr`), { [posKey(x, y)]: dir || null }); return true; } catch (e) { console.warn('가구 돌리기 실패', e); return false; }
  }
  // 방명록: 지금 있는 집(또는 내 집)에 한 줄 남긴다. 한 사람이 한 집에 한 줄이라 다시 쓰면 바뀐다
  async signGuestbook(owner: string, text: string): Promise<boolean> {
    const t = text.trim().slice(0, GUEST_MAX);
    if (!t) return false;
    try { await set(ref(db, `homes/${owner}/gb/${this.w.uid}`), { n: this.w.profile.nick, t, at: serverTimestamp() }); return true; }
    catch (e) { console.warn('방명록 쓰기 실패', e); return false; }
  }
  // 방명록의 한 줄을 지운다 (내가 쓴 것, 또는 내 집에 남이 쓴 것)
  async eraseGuestNote(owner: string, writer: string): Promise<boolean> {
    try { await remove(ref(db, `homes/${owner}/gb/${writer}`)); return true; } catch { return false; }
  }
  // 벽지: 그 품목을 사 두었으면 값 없이 몇 번이든 바꿀 수 있다 (n = 0 이면 기본 벽으로)
  async setWall(n: number): Promise<'ok' | 'coins' | 'fail'> {
    const wl = WALLS.find((x) => x.n === n);
    if (!this.tier || this.busy || (n !== 0 && !wl) || (this.data?.wl || 0) === n) return 'fail';
    this.busy = true;
    try {
      if (wl && !(await this.pay(wl.item))) return 'coins';
      await update(ref(db, `homes/${this.w.uid}`), { wl: n || null });
      return 'ok';
    } catch (e) { console.warn('벽지 바꾸기 실패', e); return 'fail'; } finally { this.busy = false; }
  }
  async setFloor(g: number): Promise<'ok' | 'wood' | 'fail'> {
    if (!this.tier || !FLOORS.some((f) => f.g === g) || this.data?.fl === g || this.busy) return 'fail';
    if (this.wood < FLOOR_WOOD) return 'wood';
    this.busy = true;
    try { await update(ref(db, `homes/${this.w.uid}`), { fl: g, w: increment(-FLOOR_WOOD) }); return 'ok'; } catch { return 'fail'; } finally { this.busy = false; }
  }
  // 박제: slot 번째 자리에 물고기를 건다 (id 가 없으면 내린다). 규칙이 내 도감에 그 물고기가 있는지 본다
  async setTrophy(slot: number, id: string | null, size = 0): Promise<boolean> {
    const n = homeTier(this.data?.t)?.trophyX.length ?? 0;
    if (slot < 0 || slot >= n) return false;
    try { await update(ref(db, `homes/${this.w.uid}/tr`), { [String(slot)]: id ? { id, s: size } : null }); return true; } catch (e) { console.warn('박제 실패', e); return false; }
  }

  // ---- 창고 ----
  // 물고기를 잡았다 (꽝 제외): 창고에 한 마리. 잡을 때마다 쓰지 않고 모아 두었다가 slowTick 이 넣는다
  onCatch(): void {
    if (!this.tier) return;
    if (this.capacity - this.fish - this.pending <= 0) {
      if (!this.fullNoted) { this.fullNoted = true; this.w.note('📦 집 창고가 가득 찼어요. 집에서 묶음으로 팔거나 겨울잠으로 먹을 수 있어요.'); }
      return;
    }
    this.pending++;
  }
  private async flush(): Promise<void> {
    const n = Math.min(this.pending, STORE_MAX, this.capacity - this.fish);
    if (n <= 0) { this.pending = 0; return; }
    if (this.flushing) return;
    this.flushing = true; this.lastFlush = Date.now(); this.pending -= n;
    try { await update(ref(db, `homes/${this.w.uid}`), { f: increment(n), fa: serverTimestamp() }); }
    catch { this.pending += n; } // 간격 규칙에 걸렸으면 다음에 다시
    finally { this.flushing = false; }
  }
  // 묶음 판매: 창고에서 먼저 빼고 코인을 받는다 (순서가 반대면 실패했을 때 공짜 코인이 된다)
  canSell(b: Bundle): boolean { return this.fish >= b.n && this.slots >= b.slots; }
  async sell(b: Bundle): Promise<boolean> {
    if (!this.canSell(b) || this.busy) return false;
    this.busy = true;
    try {
      try { await update(ref(db, `homes/${this.w.uid}`), { f: increment(-b.n) }); } catch { return false; }
      for (let i = 0; i < 3; i++) if (await this.w.wallet.earn(b.price)) return true;
      this.w.toast('코인을 받지 못했습니다. 관리자에게 알려 주세요.', true);
      return false;
    } finally { this.busy = false; }
  }

  // ---- 겨울잠 ----
  get sleeping(): boolean { return this.sleepAt > 0; }
  sleepLeftMs(): number { return this.sleepAt ? Math.max(0, SLEEP_MS - (Date.now() - this.sleepAt)) : 0; }
  // 내 집에서 침대·창고 상자를 보고 서 있나 (주인만 쓴다)
  facing(): 'bed' | 'chest' | null {
    const w = this.w, me = w.me;
    if (!this.inMine() || w.switching || me.moving || me.locked) return null;
    const [dx, dy] = dirVec(me.dir);
    const o = objectAt(w.map, me.x + dx, me.y + dy);
    return o === O_BED ? 'bed' : o === O_CHEST ? 'chest' : null;
  }
  beginSleep(): boolean {
    const w = this.w;
    if (this.sleeping || this.facing() !== 'bed') return false;
    if (this.shield >= SHIELD_MAX) { w.toast(`이미 든든해요 (🐟 ${SHIELD_MAX}/${SHIELD_MAX}). 빠따를 맞아 줄어들면 다시 잘 수 있어요.`); return false; }
    if (this.fish < SHIELD_FISH) { w.toast(`창고에 물고기가 ${SHIELD_FISH}마리 있어야 겨울잠을 잘 수 있어요 (지금 ${this.fish}마리).`, true); return false; }
    this.sleepAt = Date.now(); this.sleepSpot = { x: w.me.x, y: w.me.y };
    w.note(`😴 겨울잠… ${SLEEP_MS / 60000}분 뒤에 물고기 ${SHIELD_FISH}마리를 먹고 든든해져요. 움직이면 깨요.`);
    this.syncMarks();
    return true;
  }
  wake(): void {
    if (!this.sleepAt) return;
    this.sleepAt = 0; this.sleepSpot = null;
    this.syncMarks();
  }
  private async eat(): Promise<void> {
    const w = this.w, n = this.shield;
    this.eating = true;
    let ok = false;
    try { await update(ref(db, `homes/${w.uid}`), { f: increment(-SHIELD_FISH), sh: n + 1 }); ok = true; } catch (e) { console.warn('겨울잠 저장 실패', e); }
    this.eating = false;
    if (!this.sleeping) return;
    if (!ok) { this.wake(); w.toast('겨울잠을 제대로 못 잤어요. 다시 자 보세요.', true); return; }
    w.note(`🐟 물고기 ${SHIELD_FISH}마리를 먹고 든든해졌다! 빠따를 ${n + 1}번 막아 준다.`);
    // 물고기가 남았고 더 쌓을 수 있으면 이어서 잔다
    if (n + 1 < SHIELD_MAX && this.fish - SHIELD_FISH >= SHIELD_FISH) this.sleepAt = Date.now();
    else { this.wake(); w.note('😴 잘 잤다! 겨울잠에서 깼어요.'); }
  }
  // 빠따에 맞았다: 든든함이 있으면 하나 써서 막는다 (world.breakGuard 가 먼저 부른다)
  useShield(byNick: string, dark = false): boolean {
    const n = this.shield;
    if (n <= 0) return false;
    this.shieldLocal = n - 1;
    update(ref(db, `homes/${this.w.uid}`), { sh: n - 1 }).catch(() => {});
    this.syncMarks();
    const bat = dark ? `${byNick}의 어둠의 빠따` : `${byNick} 의 빠따`;
    this.w.toast(`🐟 든든하게 먹어 둔 덕에 ${bat}를 버텼다! (남은 ${n - 1}번)`);
    this.w.events.emit('log', { channel: 'sys', from: '', text: `🐟 ${bat}를 든든함으로 버텼다 (남은 ${n - 1}번)`, ts: serverNow() });
    return true;
  }

  // 1초마다 (화면 갱신과 무관: 뒤쪽 탭에서 자는 동안에도 돈다)
  private slowTick(): void {
    const w = this.w;
    if (this.mustLeave && this.inHome() && !this.inMine() && !w.switching) { const why = this.mustLeave; this.mustLeave = null; void this.h.leave(why).then(() => { if (this.inHome() && !this.inMine()) this.mustLeave = why; }); }
    if (this.sleeping) {
      const s = this.sleepSpot;
      if (!this.inMine() || !s || w.me.x !== s.x || w.me.y !== s.y) { this.wake(); w.note('😴 겨울잠에서 깼어요. (먹기 전에 깨면 물고기는 그대로)'); }
      else if (!this.eating && Date.now() - this.sleepAt >= SLEEP_MS) void this.eat();
    }
    if (this.pending > 0 && Date.now() - this.lastFlush >= STORE_FLUSH_MS) void this.flush();
    // 하던 도끼질은 화면이 뒤에 있어도(다른 창·탭을 보는 중) 이어진다 (2026-11-18 사용자 요청. 화면 갱신이 도는 동안에는 world 의 tick 이 먼저 처리해 여기서는 할 일이 없다)
    if (this.chop) this.tick(performance.now());
  }
}

// 남의 집에 들어갈 수 있나 (규칙도 같은 조건을 본다): 초가집은 누구나, 통나무집부터는 잠겨 있지 않을 때
export function homeOpen(h: HomeData | null | undefined): 'ok' | 'none' | 'locked' {
  const t = tierOf(h);
  return !t ? 'none' : t >= 2 && h?.lk === true ? 'locked' : 'ok';
}

// 방 모양에 영향을 주는 값만 뽑은 글자 (나무·물고기 수가 바뀔 때마다 방을 다시 만들지 않으려고)
function sigOf(h: HomeData | null): string { return JSON.stringify([h?.t ?? 0, h?.d ?? null, h?.fl ?? null, h?.tr ?? null, h?.wl ?? null, h?.dr ?? null]); }
