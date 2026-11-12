import { ref, get, onValue, runTransaction, update, serverTimestamp, increment } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow } from '../firebase/db';
import { AUTO_MAX_MS, GIFT_MSG_MAX, ROD_MAX_STARS, KING_ROD_ID, KING_CRAFT_GOLD, KING_ENHANCE_GOLD, KING_NEED_STARS, KING_BASE_STARS, KING_MAX_STARS, autoItemMs, autoKindOf, enhanceChance, foodCost, EQUIP_KEY, isOwnItem, type Wallet, type Equip, type CosmeticKind, type ArmorKey, type GiftMark } from '../shared/shop';
import { dayKey, kstDayStart } from '../shared/util';
import { JACKPOT_SEED, jackpotAdd, slotResult, oddEvenPayout, type InstantKind } from '../shared/slots';
import type { WorldCtx } from './state';

// 코인 지갑. 모든 쓰기는 wallet/{uid} 노드 전체를 트랜잭션으로 바꾼다. 서버 코드가 없으므로 규칙(database.rules.json)이 노드 단위로 검사한다 (2026-11-06 치팅 방지):
//  - 잔액 증가 ≤ 획득 − 사용. (획득 속도 상한 — 한 번 200·10분 3000 — 은 2026-11-10 에 없앴다: 정상 플레이에서 지급이 막히는 일이 있어서. 치팅은 감수)
//  - 사용(sp 증가)은 b 에 산 품목 id 를 적고 금액이 가격표(config/prices)와 정확히 같아야 한다. 자동 버프·미끼·주문서·펫 먹이는 그 쓰기에서만 늘 수 있다
//  - 보유(users/{uid}/own/{id})는 지갑의 b 가 그 품목일 때만 쓸 수 있다 → 구매는 "지갑 차감(b 기록) → 보유 등록" 두 단계
// 무엇을 낚았는지·강화가 성공했는지 같은 "결과"는 규칙이 알 수 없다.
export class WalletMgr {
  wallet: Wallet = { c: 0, e: 0 };
  loaded = false;
  private unsub: (() => void) | null = null;
  private listeners = new Set<() => void>();

  constructor(private w: WorldCtx) {}

  start(): void {
    this.unsub = onValue(ref(db, `wallet/${this.w.uid}`), (s) => {
      this.wallet = (s.val() as Wallet | null) || { c: 0, e: 0 };
      const first = !this.loaded;
      this.loaded = true;
      if (first) { void this.deliverPending(); void this.healStars(); void this.settlePendingInstant(); }
      this.checkGift();
      this.listeners.forEach((f) => f());
    });
  }
  stop(): void { this.unsub?.(); this.unsub = null; this.listeners.clear(); }

  // 관리자가 코인을 지급·회수했으면(gf) 한 번 알린다. 본 것은 브라우저에 기억해 두어, 접속해 있지 않을 때 받은 것도 다음에 들어오면 뜬다
  private giftSeen = -1;
  private checkGift(): void {
    const g = this.wallet.gf;
    if (!g || typeof g.at !== 'number' || typeof g.n !== 'number') return;
    const key = `mv-gift-${this.w.uid}`;
    if (this.giftSeen < 0) { this.giftSeen = 0; try { this.giftSeen = Number(localStorage.getItem(key)) || 0; } catch { /* ignore */ } }
    if (g.at <= this.giftSeen) return;
    this.giftSeen = g.at;
    try { localStorage.setItem(key, String(g.at)); } catch { /* ignore */ }
    const amount = Math.abs(g.n).toLocaleString('ko-KR');
    const text = g.n >= 0 ? `🎁 관리자가 ${amount}코인을 지급했습니다.` : `관리자가 ${amount}코인을 회수했습니다.`;
    this.w.toast(text);
    this.w.events.emit('log', { channel: 'notice', from: '', text, ts: g.at });
  }
  listen(f: () => void): () => void { this.listeners.add(f); return () => this.listeners.delete(f); }

  get balance(): number { return this.wallet.c || 0; }
  get bait(): number { return this.wallet.bait || 0; }
  get baitOn(): boolean { return this.wallet.bu !== false; }
  // 자동 회수 버프 만료 시각 (서버 시각). 없거나 지났으면 0
  autoReelUntil(): number { const ar = this.wallet.ar || 0; return ar > serverNow() ? ar : 0; }
  autoReelActive(): boolean { return this.autoReelUntil() > 0; }
  // 자동 채집 버프
  autoBugUntil(): number { const ab = this.wallet.ab || 0; return ab > serverNow() ? ab : 0; }
  autoBugActive(): boolean { return this.autoBugUntil() > 0; }
  autoBugLeftText(): string {
    const left = Math.max(0, this.autoBugUntil() - serverNow());
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }
  autoReelLeftText(): string {
    const left = Math.max(0, this.autoReelUntil() - serverNow());
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // fn 이 null 을 돌려주면 중단. (로컬 캐시가 비어 있을 때도 값을 돌려주므로 서버에 묻는다) 규칙에 걸려도 false
  private tx(fn: (cur: Wallet) => Wallet | null): Promise<boolean> {
    return runTransaction(ref(db, `wallet/${this.w.uid}`), (cur: Wallet | null) => {
      const next = fn({ ...(cur || { c: 0, e: 0 }) });
      return next === null ? undefined : next;
    }, { applyLocally: false }).then((r) => r.committed).catch(() => false);
  }

  // 획득: 잔액과 누적 획득이 같이 오른다. (예전 10분 창 wt/we 는 더 쓰지 않고 지운다)
  earn(pts: number): Promise<boolean> {
    if (pts <= 0) return Promise.resolve(false);
    return this.tx((c) => { const n: Wallet = { ...c, c: (c.c || 0) + pts, e: (c.e || 0) + pts }; delete n.wt; delete n.we; delete n.md; return n; });
  }
  // 사용: 잔액이 모자라면 false. item 은 가격표의 품목 id (규칙이 금액 = 그 품목 가격인지 본다). mut 으로 같은 트랜잭션 안에서 다른 칸도 바꾼다
  // price 가 함수면 트랜잭션 안의 현재 지갑으로 가격을 정한다 (펫 먹이: 먹은 수에 따라 오르므로)
  private spend(item: string, price: number | ((c: Wallet) => number), mut?: (c: Wallet) => Wallet): Promise<boolean> {
    return this.tx((c) => {
      const p = typeof price === 'function' ? price(c) : price;
      if ((c.c || 0) < p) return null;
      const n: Wallet = { ...c, c: (c.c || 0) - p, sp: (c.sp || 0) + p, b: item };
      delete n.gt; // 선물이 아닌 구매: 선물 대상 표시를 지운다 (있으면 규칙이 내 보유 등록을 막는다)
      return mut ? mut(n) : n;
    });
  }
  // 자동 버프 구매(10분·30분·1시간). 개수 제한 없음 (하루 10개 한도는 2026-11-05 에 없앴다: 제한하니 접속 자체가 줄어서). 옛 한도 카운트 ad/an/bn 은 지운다.
  // 켜져 있으면 남은 시간 뒤에 이어 붙이되, 남은 시간 + 새 시간이 AUTO_MAX_MS 를 넘으면 'full' (규칙 상한 now + 61분)
  buyAuto(itemId: string, price: number): Promise<'ok' | 'coins' | 'full'> {
    const ms = autoItemMs(itemId), kind = autoKindOf(itemId);
    if (!ms || !kind) return Promise.resolve('coins');
    const key = kind === 'fish' ? 'ar' : 'ab';
    const now = serverNow();
    const left = Math.max(0, (this.wallet[key] || 0) - now);
    if (left + ms > AUTO_MAX_MS + 1000) return Promise.resolve('full');
    return this.spend(itemId, price, (n) => {
      delete n.ad; delete n.an; delete n.bn;
      n[key] = Math.max(serverNow(), n[key] || 0) + ms;
      return n;
    }).then((ok) => (ok ? 'ok' : 'coins'));
  }
  // 경마 배팅 결제 (2026-11-09): 지갑에서 금액을 빼며 b='race', cb=라운드, ch=말, ca=금액을 적는다. 이어서 casino/r/{rid}/bets/{uid} 를 써야 배팅 성립 (규칙이 지갑의 cb/ch/ca 와 대조)
  // 결제(지갑)와 배팅 기록(casino/r/{rid}/bets/{uid})을 쓰기 한 번에 한다 (2026-11-12): 따로 쓰던 때에는 결제한 뒤 기록하기 전에 라운드가 마감되면 코인만 나가고 배팅은 남지 않았다.
  // 지금은 그새 마감됐으면 통째로 거부되어 아무 일도 없다 (잔액이 모자라도 규칙이 c >= 0 으로 거부)
  async betRace(rid: string, horse: number, amount: number, nick: string): Promise<boolean> {
    if (this.balance < amount) return false;
    const uid = this.w.uid, W = `wallet/${uid}`;
    try {
      await update(ref(db), { [`${W}/c`]: increment(-amount), [`${W}/sp`]: increment(amount), [`${W}/b`]: 'race', [`${W}/cb`]: rid, [`${W}/ch`]: horse, [`${W}/ca`]: amount, [`${W}/gt`]: null, [`casino/r/${rid}/bets/${uid}`]: { h: horse, a: amount, n: nick } });
      return true;
    } catch (e) { console.warn('경마 배팅이 거부됨 (마감됐거나 잔액 부족)', e); return false; }
  }
  // 경마 배당 수령: 맞힌 라운드(rid)의 배당(win)을 받으며 cr=rid 를 적는다 (규칙: cr 은 커지기만, 배당은 bets.a × 4.5 와 정확히 같아야)
  claimRace(rid: string, win: number): Promise<boolean> {
    return this.tx((c) => {
      if (c.cr && c.cr >= rid) return null;
      return { ...c, c: (c.c || 0) + win, e: (c.e || 0) + win, cr: rid };
    });
  }
  // ---- 슬롯 방의 즉석 게임: 슬롯·홀짝 (2026-11-12. 설계는 shared/slots.ts 머리말) ----
  // 정산 안 한 판이 남아 있나 (it != ic)
  instantPending(): boolean { const w = this.wallet; return typeof w.it === 'number' && w.ic !== w.it; }
  // 베팅: 지갑에서 값을 빼며 it = 서버 시각을 남긴다 (슬롯이면 같은 쓰기에서 잭팟에 3% 를 쌓는다). 돌려주는 값은 서버가 적은 그 판의 시각. 실패하면 null
  async instantBet(kind: InstantKind, bet: number, pick?: number): Promise<number | null> {
    if (this.balance < bet) return null;
    const uid = this.w.uid, W = `wallet/${uid}`;
    const upd: Record<string, unknown> = {
      [`${W}/c`]: increment(-bet), [`${W}/sp`]: increment(bet), [`${W}/b`]: kind === 's' ? 'slot' : 'oddeven', [`${W}/gt`]: null,
      [`${W}/ik`]: kind, [`${W}/ib`]: bet, [`${W}/ip`]: kind === 'o' ? pick : null, [`${W}/it`]: serverTimestamp(),
    };
    if (kind === 's') upd['slot/jp'] = increment(jackpotAdd(bet));
    try {
      await update(ref(db), upd);
      const it = (await get(ref(db, `${W}/it`))).val(); // 서버가 적은 시각 (쓰기 직후 내 화면에 먼저 오는 추정값이 아니라)
      return typeof it === 'number' ? it : null;
    } catch (e) { console.warn('즉석 게임 베팅이 거부됨', e); return null; }
  }
  // 정산: 그 판(it)의 결과대로 받는다. 꽝이면 0 을 받는 정산(ic 만 바뀐다). 잭팟이면 쌓인 금액을 받고 같은 쓰기에서 시작 금액으로 되돌린다.
  // 돌려주는 값은 받은 돈 (정산할 판이 없거나 실패하면 null)
  async instantSettle(): Promise<{ kind: InstantKind; at: number; bet: number; win: number; jackpot: boolean } | null> {
    const uid = this.w.uid, W = `wallet/${uid}`;
    for (let tries = 0; tries < 3; tries++) {
      const cur = (await get(ref(db, W))).val() as Wallet | null;
      if (!cur || typeof cur.it !== 'number' || cur.ic === cur.it || !cur.ik || !cur.ib) return null;
      const at = cur.it, bet = cur.ib, kind = cur.ik;
      const upd: Record<string, unknown> = { [`${W}/ic`]: at };
      let win = 0, jackpot = false;
      if (kind === 's') {
        const r = slotResult(at, bet);
        jackpot = r.jackpot;
        if (jackpot) { win = Number((await get(ref(db, 'slot/jp'))).val()) || 0; upd['slot/jp'] = JACKPOT_SEED; }
        else win = bet * r.mult;
      } else win = oddEvenPayout(at, bet, cur.ip ?? -1);
      if (win > 0) { upd[`${W}/c`] = increment(win); upd[`${W}/e`] = increment(win); }
      try { await update(ref(db), upd); return { kind, at, bet, win, jackpot }; }
      catch (e) { console.warn('즉석 게임 정산이 거부됨 (잭팟 금액이 그새 바뀌었으면 다시 읽어 시도)', e); if (!jackpot) return null; }
    }
    return null;
  }
  // 접속할 때: 지난번에 정산하지 못한 판(돌리는 중에 나갔거나 끊김)이 있으면 받는다
  private async settlePendingInstant(): Promise<void> {
    if (!this.instantPending()) return;
    const r = await this.instantSettle();
    if (r && r.win > 0) this.w.toast(`${r.kind === 's' ? '🎰 지난 슬롯' : '🎲 지난 홀짝'} 판의 💰 ${r.win.toLocaleString('ko-KR')} 을 받았습니다.`);
  }
  // 자동 버프를 더 살 수 있는 최대 시간(ms): 남은 시간을 뺀 것
  autoRoom(kind: 'fish' | 'bug'): number { return Math.max(0, AUTO_MAX_MS - Math.max(0, (this.wallet[kind === 'fish' ? 'ar' : 'ab'] || 0) - serverNow())); }
  buyBait(price: number, n = 1): Promise<boolean> {
    return this.spend('bait', price * n, (c) => ({ ...c, bait: (c.bait || 0) + n }));
  }
  // 미끼 하나 소모. 없으면 false
  takeBait(): Promise<boolean> {
    return this.tx((c) => ((c.bait || 0) > 0 ? { ...c, bait: (c.bait || 0) - 1 } : null));
  }
  // 오늘 룰렛을 돌렸나. rd 는 KST 오늘 0시(ms). 예전 값은 'YYYYMMDD' 문자열이라 그것도 같이 본다
  rouletteDoneToday(): boolean { const rd = this.wallet.rd; return rd === kstDayStart(serverNow()) || rd === dayKey(); }
  // 룰렛 당첨금: 날짜를 오늘로 바꾸면서 한 번만 (규칙: rd 가 오늘 0시로 바뀌는 쓰기 한 번만 1000까지 증가 허용)
  claimRoulette(prize: number): Promise<boolean> {
    return this.tx((c) => {
      const today = kstDayStart(serverNow());
      return c.rd === today || c.rd === dayKey() ? null : { ...c, c: (c.c || 0) + prize, e: (c.e || 0) + prize, rd: today };
    });
  }
  setBaitUse(on: boolean): Promise<boolean> {
    return this.tx((c) => ({ ...c, bu: on }));
  }

  // ---- 펫 먹이·레벨 (2026-11-10) ----
  petXp(petId: string): number { return this.wallet.px?.[petId] || 0; }
  // 먹이 n 개를 petId 에게: 구매와 먹이기가 한 쓰기 (b='petfood', pp=펫, px/펫 += n, 사용액 = foodCost(기본가, 지금 먹은 수, n)). 규칙이 같은 식으로 금액을 대조하고 pp 에 적은 펫만 오르는지 본다
  feedPet(petId: string, base: number, n: number): Promise<boolean> {
    if (n <= 0) return Promise.resolve(false);
    return this.spend('petfood', (c) => foodCost(base, c.px?.[petId] || 0, n), (c) => ({ ...c, pp: petId, px: { ...(c.px || {}), [petId]: (c.px?.[petId] || 0) + n } }));
  }

  // ---- 빠따 (2026-11-11) ----
  get bats(): number { return this.wallet.bt || 0; }
  get batOn(): boolean { return this.wallet.bo !== false; }
  // 지금 쓸 수 있는 빠따 수 (자동 사용을 꺼 두었으면 0). 쓰는 것은 Net 의 밀치기·말랑이·끌기 쓰기가 같은 쓰기에서 bt 를 줄인다
  batsReady(): number { return this.batOn ? this.bats : 0; }
  buyBats(price: number, n = 1): Promise<boolean> {
    return this.spend('bat', price * n, (c) => ({ ...c, bt: (c.bt || 0) + n }));
  }
  setBatUse(on: boolean): Promise<boolean> {
    return this.tx((c) => ({ ...c, bo: on }));
  }

  // ---- 금광 채광 (2026-11-11) ----
  get gold(): number { return this.wallet.gn || 0; }
  // 곡괭이질 한 번의 보상: 금덩이 n 개(1~3)와 채광 시각. 규칙이 지난 채광(ga)에서 MINE_GAP_MS 이상 지났는지 본다. 코인·구매 기록은 건드리지 않는다
  mine(n: number): Promise<boolean> {
    if (n <= 0) return Promise.resolve(false);
    return this.tx((c) => ({ ...c, gn: (c.gn || 0) + n, ga: serverTimestamp() as unknown as number }));
  }

  // ---- 낚싯대 강화 (2026-11-10) ----
  get scrolls(): number { return this.wallet.es || 0; }
  get stars(): number { return this.w.profile.own?.rod2 ? this.wallet.rs || 0 : 0; } // rod2 가 없으면 성도 없다 (부서진 뒤 남은 값은 다음 강화 쓰기에서 0 으로)
  buyScrolls(price: number, n = 1): Promise<boolean> {
    return this.spend('scroll', price * n, (c) => ({ ...c, es: (c.es || 0) + n }));
  }
  // 강화 1회: 주문서 1장을 쓰며 성공이면 rs+1, 실패면 명품 낚싯대가 부서진다. 결과는 여기서 굴린다 (낚시처럼 클라이언트 신뢰)
  // 'none': 주문서 없음/최대, 'ok': 성공, 'broke': 실패(부서짐. 보관함에서도 이미 지웠다. 좋은 낚싯대 rod1 은 남는다)
  private enhancing = false; // 강화 쓰기가 진행 중 (그 사이에 또 누른 것은 무시)
  async enhanceRod(): Promise<'none' | 'ok' | 'broke'> {
    const stars = this.stars;
    if (this.enhancing || this.scrolls <= 0 || stars >= ROD_MAX_STARS || !this.w.profile.own?.rod2) return 'none';
    const ok = Math.random() < enhanceChance(stars);
    this.enhancing = true;
    try {
      if (ok) {
        const done = await this.tx((c) => {
          if ((c.es || 0) <= 0) return null;
          const cur = c.rs || 0;
          if (cur !== stars) return null; // 다른 탭에서 바뀜
          return { ...c, es: (c.es || 0) - 1, rs: cur + 1 };
        });
        return done ? 'ok' : 'none';
      }
      return (await this.breakWrite('rod2', { es: increment(-1), rs: 0 })) ? 'broke' : 'none';
    } finally { this.enhancing = false; }
  }
  // 부서지는 쓰기: 지갑(주문서 −1, 성 0, 구매 표시 삭제)과 보관함의 낚싯대 삭제를 쓰기 한 번에 한다 (2026-11-11).
  //  - 따로 쓰던 때에는 그 사이에 상점이 다시 그려지며 생긴 "강화 100%" 버튼이 눌려, 곧 지워질 낚싯대가 ★1 이 되고 낚싯대만 사라진 지갑이 생겼다.
  //    그러면 "성이 있으면 낚싯대 보유" 규칙에 걸려 그 지갑의 모든 쓰기가 거부됐다 (실제 발생, 계정 하나)
  //  - 구매 표시 b 를 지우는 이유: 남겨 두면 그게 이 낚싯대일 때 다음 접속의 deliverPending 이 공짜로 다시 등록해 준다
  private async breakWrite(item: string, walletPatch: Record<string, unknown>): Promise<boolean> {
    const uid = this.w.uid;
    const upd: Record<string, unknown> = { [`wallet/${uid}/b`]: null, [`users/${uid}/own/${item}`]: null };
    for (const [k, v] of Object.entries(walletPatch)) upd[`wallet/${uid}/${k}`] = v;
    try { await update(ref(db), upd); } catch (e) { console.warn('강화 실패 쓰기가 거부됨', e); return false; }
    const p = this.w.profile;
    if (p.own) { const own = { ...p.own }; delete own[item]; p.own = own; }
    this.listeners.forEach((f) => f());
    return true;
  }
  // 낚싯대가 없는데 성이 남은 지갑을 0 으로 바로잡는다 (접속할 때 한 번). 규칙은 그 낚싯대가 보관함에 없을 때만 주문서 없이 0 으로 되돌리기를 받는다
  private async healStars(): Promise<void> {
    const own = this.w.profile.own || {};
    const badRs = (this.wallet.rs || 0) > 0 && !own.rod2, badKs = (this.wallet.ks || 0) > 0 && !own[KING_ROD_ID];
    if (!badRs && !badKs) return;
    const ok = await this.tx((c) => ({ ...c, ...(badRs ? { rs: 0 } : {}), ...(badKs ? { ks: 0 } : {}) }));
    if (ok) console.info('낚싯대 없이 남아 있던 강화 성을 0 으로 바로잡음');
  }

  // ---- 킹 낚싯대 (2026-11-11) ----
  get kingStars(): number { return this.w.profile.own?.rod3 ? this.wallet.ks || 0 : 0; } // rod3 가 없으면 성도 없다
  // 낚시 확률에 쓰는 성: 킹 낚싯대는 킹 성과 상관없이 명품 35성으로 고정
  get fishStars(): number { return this.w.profile.own?.rod3 ? KING_BASE_STARS : this.stars; }
  // 남에게 보이는 성 (찌 옆 ★n): 킹 낚싯대면 킹 성
  get shownStars(): number { return this.w.profile.own?.rod3 ? this.kingStars : this.stars; }
  // 제작: 명품 낚싯대 30성이 있어야 하고, 코인(가격표)과 금덩이 KING_CRAFT_GOLD 개가 한 쓰기에서 같이 준다 (b='rod3'). 명품 낚싯대와 그 30성은 그대로.
  // 'need': 자격 미달, 'gold'/'coins': 모자람, 'fail': 그새 바뀌었거나 규칙이 거부
  async craftKing(price: number): Promise<'ok' | 'need' | 'gold' | 'coins' | 'fail'> {
    if (this.owns(KING_ROD_ID)) return 'fail';
    if (!this.owns('rod2') || (this.wallet.rs || 0) < KING_NEED_STARS) return 'need';
    if (this.gold < KING_CRAFT_GOLD) return 'gold';
    if (this.balance < price) return 'coins';
    const ok = await this.tx((c) => {
      if ((c.c || 0) < price || (c.gn || 0) < KING_CRAFT_GOLD || (c.rs || 0) !== KING_NEED_STARS) return null;
      const n: Wallet = { ...c, c: (c.c || 0) - price, sp: (c.sp || 0) + price, b: KING_ROD_ID, gn: (c.gn || 0) - KING_CRAFT_GOLD, ks: 0 };
      delete n.gt; // 선물할 수 없는 품목: 규칙도 gt 가 없을 때만 받는다
      return n;
    });
    if (!ok) return 'fail';
    await this.deliver(KING_ROD_ID);
    this.listeners.forEach((f) => f());
    return 'ok';
  }
  // 킹 낚싯대 강화 1회: 주문서 1장 + 금덩이 1개. 성공이면 ks+1, 실패면 킹 낚싯대가 부서진다 (보관함에서도 같은 쓰기로 지운다. 명품 낚싯대 rod2 와 그 30성은 남는다)
  async enhanceKing(): Promise<'none' | 'ok' | 'broke'> {
    const stars = this.kingStars;
    if (this.enhancing || !this.owns(KING_ROD_ID) || this.scrolls <= 0 || this.gold < KING_ENHANCE_GOLD || stars >= KING_MAX_STARS) return 'none';
    const ok = Math.random() < enhanceChance(stars);
    this.enhancing = true;
    try {
      if (ok) {
        const done = await this.tx((c) => {
          if ((c.es || 0) <= 0 || (c.gn || 0) < KING_ENHANCE_GOLD) return null;
          const cur = c.ks || 0;
          if (cur !== stars) return null; // 다른 탭에서 바뀜
          return { ...c, es: (c.es || 0) - 1, gn: (c.gn || 0) - KING_ENHANCE_GOLD, ks: cur + 1 };
        });
        return done ? 'ok' : 'none';
      }
      return (await this.breakWrite(KING_ROD_ID, { es: increment(-1), gn: increment(-KING_ENHANCE_GOLD), ks: 0 })) ? 'broke' : 'none';
    } finally { this.enhancing = false; }
  }

  // 꾸미기·장비 구매: 지갑에서 값을 빼며 무엇을 샀는지(b) 적고, 이어서 보관함에 넣는다 (규칙이 b 를 보고 보유 등록을 허용)
  async buyCosmetic(itemId: string, price: number): Promise<boolean> {
    if (!(await this.spend(itemId, price))) return false;
    await this.deliver(itemId);
    return true;
  }
  private async deliver(itemId: string): Promise<boolean> {
    try { await update(ref(db), { [`users/${this.w.uid}/own/${itemId}`]: true }); } catch (e) { console.warn('보유 등록 실패', e); return false; }
    const p = this.w.profile;
    p.own = { ...(p.own || {}), [itemId]: true };
    return true;
  }
  // 선물 (2026-11-09): 내 지갑에서 값을 빼며 b=품목, gt=받는 사람을 적고, 받는 사람의 보유(own)·선물 표시(gifts, gift)를 한 번에 쓴다.
  // 규칙: gt 가 있으면 그 품목의 보유 등록은 받는 사람에게만 된다 (한 번 결제 = 한 번 등록). 'owned' 는 상대가 이미 가진 경우
  async giftItem(itemId: string, price: number, to: { uid: string; nick: string }, msg: string): Promise<'ok' | 'coins' | 'owned' | 'fail'> {
    try { if ((await get(ref(db, `users/${to.uid}/own/${itemId}`))).val() === true) return 'owned'; } catch { /* 읽기 실패면 그냥 진행 */ }
    const ok = await this.spend(itemId, price, (n) => ({ ...n, gt: to.uid }));
    if (!ok) return 'coins';
    return (await this.deliverGift(itemId, to.uid, msg)) ? 'ok' : 'fail';
  }
  private async deliverGift(itemId: string, toUid: string, msg: string): Promise<boolean> {
    const mark: GiftMark = { f: this.w.uid, fn: this.w.profile.nick, i: itemId, at: serverTimestamp() as unknown as number, ...(msg ? { m: msg.slice(0, GIFT_MSG_MAX) } : {}) };
    try {
      await update(ref(db), { [`users/${toUid}/own/${itemId}`]: true, [`users/${toUid}/gifts/${itemId}`]: true, [`users/${toUid}/gift`]: mark });
      return true;
    } catch (e) { console.warn('선물 전달 실패', e); return false; }
  }
  // 값은 냈는데 보유 등록이 안 된 구매(도중에 끊김)가 있으면 접속할 때 마저 등록한다. 선물(gt)이면 받는 사람에게
  private async deliverPending(): Promise<void> {
    const b = this.wallet.b, gt = this.wallet.gt;
    if (!b || !isOwnItem(b)) return;
    if (gt) {
      try { if ((await get(ref(db, `users/${gt}/own/${b}`))).val() === true) return; } catch { return; }
      await this.deliverGift(b, gt, '');
    } else if (!this.owns(b) && (await this.deliver(b))) this.listeners.forEach((f) => f());
  }
  owns(itemId: string): boolean { return !!this.w.profile.own?.[itemId]; }
  equipped(kind: CosmeticKind): string | null { const v = this.w.profile.eq?.[EQUIP_KEY[kind]]; return typeof v === 'string' ? v : null; }
  // 착용/해제: 프로필과 presence 에 같이 쓴다 (규칙: 가진 것만)
  async equip(kind: CosmeticKind, itemId: string | null): Promise<void> {
    const key = EQUIP_KEY[kind];
    const p = this.w.profile;
    const eq: Equip = { ...(p.eq || {}), [key]: itemId };
    p.eq = eq;
    await update(ref(db), { [`users/${this.w.uid}/eq/${key}`]: itemId, [`players/${this.w.uid}/${key}`]: itemId }).catch(() => {});
    this.listeners.forEach((f) => f());
  }
  // 갑옷 입기/벗기 (철벽 pa, 푹신 ta): 프로필과 presence 에 같이. 벗으면 키를 지운다
  // 만렙 펫을 탈지(기본) 내려서 데리고 다닐지. 프로필과 presence 에 같이 쓴다 (타는 쪽이 기본이라 그때는 칸을 지운다)
  rideOn(): boolean { return !this.w.profile.eq?.nr; }
  async setRide(on: boolean): Promise<void> {
    const p = this.w.profile;
    p.eq = { ...(p.eq || {}), nr: on ? null : true };
    await update(ref(db), { [`users/${this.w.uid}/eq/nr`]: on ? null : true, [`players/${this.w.uid}/nr`]: on ? null : true }).catch(() => {});
    this.listeners.forEach((f) => f());
  }
  armorOn(key: ArmorKey): boolean { return !!this.w.profile.eq?.[key]; }
  async setArmor(key: ArmorKey, on: boolean): Promise<void> {
    const p = this.w.profile;
    p.eq = { ...(p.eq || {}), [key]: on ? true : null };
    await update(ref(db), { [`users/${this.w.uid}/eq/${key}`]: on ? true : null, [`players/${this.w.uid}/${key}`]: on ? true : null }).catch(() => {});
    this.listeners.forEach((f) => f());
  }
}
