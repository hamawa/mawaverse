import { ref, update, push, set, runTransaction, serverTimestamp, increment, onValue } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow, onNewChild, readOwn, rememberOwn, forgetOwn } from '../firebase/db';
import { isWater } from './map';
import { AUTO_REST_MS, ROD_BOOST, ROD_JUNK, rodTierOf, starFactor } from '../shared/shop';
import type { Net } from './net';
import type { WorldCtx } from './state';
import {
  pickFish, rollSize, fmtSize, reactWindowMs, fishPoints, weekKey, fishById, setFishDefs, defsFromDb, RARITY_NAME, ANNOUNCE_RARITY,
  BITE_WAIT_MIN_MS, BITE_WAIT_MAX_MS, type FishDef, type FishBookEntry, type FishBest, type FishFeed,
} from '../shared/fish';
import { MYTHIC } from '../shared/collection';

// 뒤쪽 탭에서도 멈추지 않는 주기 타이머 (워커). 워커를 못 만들면 setInterval 로 대신한다
function makeTicker(ms: number, fn: () => void): () => void {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: 'text/javascript' }));
    const wk = new Worker(url);
    wk.onmessage = () => fn();
    return () => { wk.terminate(); URL.revokeObjectURL(url); };
  } catch {
    const id = window.setInterval(fn, ms);
    return () => clearInterval(id);
  }
}

// 렌더러에 넘기는 낚시 상태 (내 캐릭터와 다른 사람 모두 같은 형태)
export interface FishingView { x: number; y: number; bite: boolean; since: number; auto?: boolean; rod?: number; stars?: number } // rod: 낚싯대 등급 0~2 (색이 다르다), stars: 명품 낚싯대 강화 성 (찌 옆에 ★n)

// 낚시: 물가에 서서 물을 바라보고 F → 찌를 던지고 3~10초 기다림 → "!" 가 뜨면 제한시간 안에 F.
// 서버 코드가 없으므로 어떤 물고기가 걸렸는지는 클라이언트가 정한다 (작은 모임용이라 이 정도로).
export class Fishing {
  private state: 'idle' | 'cast' | 'bite' = 'idle';
  private target = { x: 0, y: 0 };
  private fish: FishDef | null = null;
  private castAt = 0;
  private timer = 0;
  private feedUnsub: (() => void) | null = null;
  private defsUnsub: (() => void) | null = null;
  private saving = false;
  // 자동 낚시(버프): 워커 타이머가 0.5초마다 autoTick 을 불러 던지기·입질·회수를 시각으로 판단한다.
  // rAF 나 setTimeout 은 뒤쪽 탭에서 멈추거나 늦어지지만 워커 타이머는 그대로 돈다.
  private autoNextCast = 0;
  private biteAt = 0;
  private catchAt = 0;
  private stopTicker: (() => void) | null = null;
  // 지금 presence(players/{uid}/f)에 올라가 있는 찌. 자동 낚시 중에는 잡을 때마다 거두고 다시 던지는 걸 알리지 않고 그대로 둔다:
  // 낚시의 90% 가 자동이라, 매번 알리면 그것만으로 전체 전송의 5분의 1 이었다 (2026-11-10). 남의 화면에서는 찌가 계속 떠 있다
  private shown: string | null = null;
  // 종류별 서버 최고 기록 중 내가 마지막으로 본 값: 이보다 클 때만 트랜잭션을 건다 (안 그러면 잡을 때마다 왕복 3번을 쓰고 취소된다)
  private bestSeen = new Map<string, number>();

  constructor(private w: WorldCtx, private net: Net) {}

  start(): void {
    this.stopTicker = makeTicker(500, () => this.autoTick());
    // 물고기 목록: DB 에 있으면 그걸 쓰고(관리자가 수정), 없으면 코드 기본값. 바뀌면 바로 반영
    this.defsUnsub = onValue(ref(db, 'fish/defs'), (s) => setFishDefs(defsFromDb(s.val())), () => {});
    // 영웅 이상 낚은 공지. 들어온 뒤의 것만
    this.feedUnsub = onNewChild('fish/feed', serverNow(), 5, (s) => {
      const e = s.val() as FishFeed;
      const f = fishById(e.f);
      if (!f) return;
      // 남의 대어 소식은 채팅에 안 남기고 전설만 모두에게 토스트 한 줄 (2026-11-09). 신화는 모두에게 큰 배너
      if (f.rarity >= MYTHIC) this.w.banner(`${f.icon} ${e.n} 님이 신화 등급 ${f.name}을(를) 낚았습니다!`, `${fmtSize(e.s)} · 서버 전체에 단 하나의 순간`);
      else if (f.rarity >= 3) this.w.toast(`🎣 ${e.n} 님이 ${RARITY_NAME[f.rarity]} 등급 ${f.name}(${fmtSize(e.s)})를 낚았습니다!`);
    });
  }
  stop(): void {
    this.stopTicker?.(); this.stopTicker = null;
    this.feedUnsub?.(); this.feedUnsub = null;
    this.defsUnsub?.(); this.defsUnsub = null;
    this.cancel();
  }

  get active(): boolean { return this.state !== 'idle'; }
  view(): FishingView | null {
    return this.state === 'idle' ? null : { x: this.target.x, y: this.target.y, bite: this.state === 'bite', since: this.castAt, auto: this.w.wallet.autoReelActive(), rod: rodTierOf(this.w.profile.own), stars: this.w.wallet.stars };
  }

  // 지금 던질 수 있는 물 타일: 땅(물이 아닌 타일)에 서서 바라보는 칸이 물일 때
  targetTile(): { x: number; y: number } | null {
    const me = this.w.me;
    if (me.moving || me.locked || me.roomId) return null;
    if (isWater(this.w.map, me.x, me.y)) return null;
    const dx = me.dir === 2 ? 1 : me.dir === 1 ? -1 : 0, dy = me.dir === 0 ? 1 : me.dir === 3 ? -1 : 0;
    const fx = me.x + dx, fy = me.y + dy;
    return isWater(this.w.map, fx, fy) ? { x: fx, y: fy } : null;
  }

  cast(): boolean {
    if (this.active || this.saving || this.w.switching) return false; // 맵을 옮기는 중: 옛 맵 물에 던지지 않는다
    const t = this.targetTile();
    if (!t) return false;
    this.target = t;
    const wallet = this.w.wallet;
    // 미끼: 가지고 있고 자동 사용이 켜져 있으면 하나 쓴다
    const baited = wallet.bait > 0 && wallet.baitOn;
    // 낚싯대 등급(상점): 희귀 이상 가중치 ×ROD_BOOST, 꽝 ×ROD_JUNK. 명품 낚싯대 강화 성(2026-11-10): 등급 r 가중치에 starFactor^r 을 더 곱한다 (높은 등급일수록 크게)
    const rod = rodTierOf(this.w.profile.own);
    const stars = wallet.stars;
    // 미끼: 꽝·일반 제외(희귀 이상 확정)만. 영웅·전설 배수는 없다 (2026-11-09 두 번째 조정). 신화는 장비·미끼·강화와 무관 (collection.ts)
    this.fish = pickFish(undefined, undefined, { contest: !!this.w.contest.active(), boost: ROD_BOOST[rod], junkMul: ROD_JUNK[rod], tierMul: starFactor(stars), ...(baited ? { noJunk: true, minRarity: 1 } : {}) });
    this.state = 'cast';
    this.castAt = performance.now();
    this.show(t, wallet.autoReelActive(), rod, stars);
    if (baited) {
      const left = wallet.bait - 1;
      void wallet.takeBait();
      this.w.catchNote('fish', `🐛 미끼를 달았다 (남은 ${left}개)`);
    }
    const wait = BITE_WAIT_MIN_MS + Math.random() * (BITE_WAIT_MAX_MS - BITE_WAIT_MIN_MS);
    this.biteAt = this.castAt + wait;
    this.timer = window.setTimeout(() => this.bite(), wait);
    return true;
  }

  // 자동 낚시 버프 중: 물가에 서 있으면 알아서 던지고, 입질·회수 시각이 지났으면 처리한다 (타이머가 늦어도 여기서 잡힌다)
  private autoTick(): void {
    if (this.w.switching) return; // 포탈로 맵을 옮기는 중 (목적지를 읽는 동안 옛 맵에 다시 던지지 않게). 끝나면 다음 주기에 새 맵 기준으로
    const auto = this.w.wallet.autoReelActive();
    // 띄워 둔 찌 정리: 자동 버프가 끝났거나, 자리를 뜨거나 돌아서서 다음에 던질 곳이 달라졌으면 거둔다
    if (this.state === 'idle' && this.shown && !this.saving) { const t = auto ? this.targetTile() : null; if (!t || t.x !== this.target.x || t.y !== this.target.y) this.show(null); }
    if (!auto) return;
    const now = performance.now();
    if (this.state === 'cast' && this.biteAt && now >= this.biteAt) this.bite();
    else if (this.state === 'bite' && this.catchAt && now >= this.catchAt) void this.catchFish();
    else if (this.state === 'idle' && !this.saving && now >= this.autoNextCast && this.targetTile()) this.cast();
  }

  private bite(): void {
    if (this.state !== 'cast' || !this.fish) return;
    this.state = 'bite';
    // 자동 회수 버프: 입질 직후 알아서 당긴다
    if (this.w.wallet.autoReelActive()) { this.catchAt = performance.now() + 250; this.timer = window.setTimeout(() => { void this.catchFish(); }, 250); return; }
    this.timer = window.setTimeout(() => this.miss(), reactWindowMs(this.fish));
  }

  // F: 입질 중이면 잡고, 기다리는 중이면 너무 일찍 당긴 것
  reel(): void {
    if (this.state === 'bite') { void this.catchFish(); return; }
    if (this.state === 'cast') {
      if (performance.now() - this.castAt < 400) return; // 연타 방지
      this.cancel();
      this.w.toast('너무 일찍 당겼어요. 찌가 흔들릴 때(!) F 를 누르세요.', true);
    }
  }

  // 낚시를 그만둔다 (이동·밀림·너무 일찍 당김 등). 던져 둔 게 없어도 띄워 둔 찌(자동 낚시 사이)가 있으면 거둔다
  cancel(): void {
    if (!this.active) { this.show(null); return; }
    clearTimeout(this.timer); this.timer = 0;
    this.state = 'idle'; this.fish = null;
    this.biteAt = 0; this.catchAt = 0; this.autoNextCast = performance.now() + AUTO_REST_MS;
    this.show(null);
  }

  // 찌 표시를 presence 에 맞춘다: 이미 같은 내용이 올라가 있으면 쓰지 않는다
  private show(t: { x: number; y: number } | null, auto = false, rod = 0, stars = 0): void {
    const key = t ? `${t.x},${t.y},${auto ? 1 : 0},${rod},${stars}` : null;
    if (key === this.shown) return;
    this.shown = key;
    this.net.setFishing(t, auto, rod, stars);
  }

  private miss(): void {
    const f = this.fish;
    this.cancel();
    if (!f) return;
    const big = !f.junk && f.rarity >= 1;
    this.w.catchNote('fish', big ? '🎣 큰 녀석이었는데… 놓쳤다!' : '🎣 놓쳤다…');
  }

  private async catchFish(): Promise<void> {
    const f = this.fish;
    if (!f) return;
    clearTimeout(this.timer); this.timer = 0;
    this.state = 'idle'; this.fish = null;
    this.biteAt = 0; this.catchAt = 0; this.autoNextCast = performance.now() + AUTO_REST_MS;
    if (!this.w.wallet.autoReelActive()) this.show(null); // 자동 낚시 중에는 곧 같은 자리에 다시 던지므로 찌를 그대로 둔다 (자리를 뜨면 cancel·autoTick 이 거둔다)
    const w = this.w;
    const size = rollSize(f);
    const contest = this.w.contest.active();
    const mult = this.w.contest.multiplier();
    const pts = fishPoints(f) * mult;
    const sizeTxt = size ? ` ${fmtSize(size)}` : '';
    // 채팅·말풍선 대신 화면 아래 한 줄 알림 + 내 기록 (2026-11-09)
    w.catchNote('fish', f.junk ? `🎣 ${f.icon} ${f.name}… 꽝!` : `🎣 ${f.icon} ${RARITY_NAME[f.rarity]} 등급 ${f.name}${sizeTxt}를 낚았다! (+${pts}점 · 💰+${pts}${mult > 1 ? ' · 대회 ' + mult + '배' : ''})`);
    this.saving = true;
    try {
      const wk = weekKey();
      const bookPath = `fish/book/${w.uid}/${f.id}`, weekPath = `fish/week/${wk}/${w.uid}`;
      const contestPath = contest ? `fish/contest/${contest.key}/${w.uid}` : null;
      // 잡을 때마다 내 기록을 다시 읽지 않는다 (2026-11-10): 도감 칸은 세션 동안 기억해 두고(첫 등록 여부·최대 크기에 필요), 주간·대회 점수는 서버에서 더하게 한다(increment)
      const b = await readOwn<FishBookEntry>(bookPath);
      const book = { c: (b?.c || 0) + 1, m: Math.max(b?.m || 0, size), f: b?.f || serverTimestamp() };
      const tally = (path: string) => ({ [`${path}/n`]: w.profile.nick, [`${path}/p`]: increment(pts), [`${path}/c`]: increment(1), [`${path}/at`]: serverTimestamp() });
      const upd: Record<string, unknown> = { [bookPath]: book, ...tally(weekPath) };
      if (contestPath) Object.assign(upd, tally(contestPath)); // 대회 중 잡은 것만 집계
      try { await update(ref(db), upd); } catch (e) { forgetOwn(bookPath); throw e; } // 기억해 둔 값이 서버와 어긋났을 수 있다: 다음엔 다시 읽는다
      rememberOwn(bookPath, { ...book, f: b?.f || serverNow() });
      if (pts > 0) void w.wallet.earn(pts); // 점수만큼 코인
      if (!b) { const t = f.junk ? `${f.icon} 꽝 컬렉션에 추가: ${f.name}` : `${f.icon} 도감에 새로 등록: ${f.name}`; w.toast(t); w.catchLog.add('fish', t); }
      // 종류별 서버 최고 기록 (더 클 때만)
      if (size > 0 && size > (this.bestSeen.get(f.id) ?? -1)) {
        runTransaction(ref(db, `fish/best/${f.id}`), (cur: FishBest | null) => (!cur || size > cur.s ? { u: w.uid, n: w.profile.nick, s: size, at: serverNow() } : undefined), { applyLocally: false })
          .then((res) => { this.bestSeen.set(f.id, (res.snapshot.val() as FishBest | null)?.s ?? size); if (res.committed) { const t = `🏆 ${f.name} 최고 기록 갱신! ${fmtSize(size)}`; w.toast(t); w.catchLog.add('fish', t); } })
          .catch(() => {});
      }
      if (!f.junk && f.rarity >= ANNOUNCE_RARITY) {
        const feed: FishFeed = { u: w.uid, n: w.profile.nick, f: f.id, s: size, ts: serverTimestamp() as unknown as number };
        await set(push(ref(db, 'fish/feed')), feed);
      }
      this.net.stat('fish');
    } catch (e) {
      console.warn('fish save failed', e);
      w.toast('기록 저장에 실패했습니다.', true);
    } finally { this.saving = false; }
  }
}
