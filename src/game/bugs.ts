import { ref, update, push, set, runTransaction, serverTimestamp, increment, onValue } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow, onNewChild, readOwn, rememberOwn, forgetOwn } from '../firebase/db';
import { G, groundAt, isWalkable } from './map';
import type { Net } from './net';
import type { WorldCtx } from './state';
import { RARITY_NAME, MYTHIC, type CollDef, type BookEntry, type BestEntry, type FeedEntry } from '../shared/collection';
import { bugColl, bugCatchChance, bugPoints, fmtBugSize, BUG_MAX_ALIVE, BUG_SPAWN_MS, BUG_LIFE_MIN_MS, BUG_LIFE_MAX_MS, BUG_SCARE_DIST, BUG_ANNOUNCE_RARITY, BUG_SAVE_GAP_MS, BUG_AUTO_GAP_MS } from '../shared/bugs';
import { netChance, netTierOf, PET_SWING_MS, petBugRange } from '../shared/shop';
import { weekKey } from '../shared/fish';

// 렌더러에 넘기는 벌레 (내 화면에만 있다: 스폰은 클라이언트 로컬)
export interface BugView { x: number; y: number; icon: string; state: 'idle' | 'flee' | 'caught'; since: number; seed: number }
interface Alive { def: CollDef; view: BugView; born: number; life: number }

// 곤충 채집: 풀밭·꽃밭에 벌레가 나타난다. 옆 8칸(대각선 포함)에 있으면 바라보지 않아도, 지나가면서도 F 로 잡는다. 쿨타임 없음.
// 달려서 다가가면(3칸 안) 날아간다. 잡힐 확률은 등급별(일반 100% … 전설 35%), 실패하면 날아간다.
// 기록은 낚시와 같은 구조 (bug/book, bug/week, bug/best, bug/feed). 연타해도 기록은 큐에서 0.35초 간격으로 차례로 쓴다 (주간 기록 규칙의 간격).
// 자동 채집 버프(wallet.ab): 옆에 벌레가 오면 알아서 휘두른다.
export class BugHunt {
  private alive: Alive[] = [];
  private lastSpawn = 0;
  private nextAuto = 0;
  private chain: Promise<void> = Promise.resolve();
  private lastSaveAt = 0;
  private feedUnsub: (() => void) | null = null;
  private defsUnsub: (() => void) | null = null;
  private bestSeen = new Map<string, number>(); // 종류별 서버 최고 기록 중 내가 마지막으로 본 값 (fishing.ts 와 같은 이유)

  // calm: 달려도 벌레가 안 도망감(펫 Lv5), petXp: 데리고 있는 펫의 누적 먹이(채집 범위) (2026-11-10)
  constructor(private w: WorldCtx, private net: Net, private hooks: { swing: () => void; petHop: () => void; calm?: () => boolean; petXp?: () => number }) {}

  start(): void {
    this.defsUnsub = onValue(ref(db, 'bug/defs'), (s) => bugColl.set(bugColl.fromDb(s.val())), () => {});
    this.feedUnsub = onNewChild('bug/feed', serverNow(), 5, (s) => {
      const e = s.val() as FeedEntry;
      const f = bugColl.byId(e.f);
      if (!f) return;
      if (f.rarity >= MYTHIC) this.w.banner(`${f.icon} ${e.n} 님이 신화 등급 ${f.name}을(를) 잡았습니다!`, `${fmtBugSize(e.s)} · 서버 전체에 단 하나의 순간`); // 신화는 모두에게 큰 배너
      else if (f.rarity >= 3) this.w.toast(`🐛 ${e.n} 님이 ${RARITY_NAME[f.rarity]} 등급 ${f.name}(${fmtBugSize(e.s)})를 잡았습니다!`); // 전설만 토스트, 채팅에는 안 남김 (2026-11-09)
    });
    this.lastSpawn = performance.now() - BUG_SPAWN_MS + 1500; // 입장 1.5초 뒤 첫 벌레
  }
  stop(): void {
    this.feedUnsub?.(); this.feedUnsub = null;
    this.defsUnsub?.(); this.defsUnsub = null;
    this.alive = [];
  }

  views(): BugView[] { return this.alive.map((a) => a.view); }

  // 매 프레임: 사라짐 정리, 달리기에 놀라 도망, 새로 나타남, 자동 채집
  tick(now: number): void {
    const me = this.w.me;
    this.alive = this.alive.filter((a) => !((a.view.state !== 'idle') && now - a.view.since > 700));
    for (const a of this.alive) {
      if (a.view.state !== 'idle') continue;
      if (now - a.born > a.life) { this.flee(a, now); continue; }
      // 달려서 다가오면 날아간다 (펫 Lv5 부터는 안 도망감)
      if (me.moving && this.w.input.running && !this.hooks.calm?.() && Math.max(Math.abs(a.view.x - me.x), Math.abs(a.view.y - me.y)) <= BUG_SCARE_DIST) this.flee(a, now);
    }
    if (now - this.lastSpawn > BUG_SPAWN_MS && this.alive.filter((a) => a.view.state === 'idle').length < BUG_MAX_ALIVE) {
      this.lastSpawn = now;
      this.trySpawn(now);
    }
    // 자동 채집 버프: 옆에 벌레가 있으면 알아서 휘두른다
    if (now >= this.nextAuto && this.w.wallet.autoBugActive() && this.target()) {
      this.nextAuto = now + BUG_AUTO_GAP_MS;
      if (this.swing()) this.hooks.swing();
    }
    // 펫 (2026-11-09): 데리고 있으면 PET_SWING_MS 마다 옆 벌레를 대신 잡는다 (주인의 잠자리채 등급 적용, 펫이 폴짝 뛴다). Lv5 부터 2칸 (2026-11-10)
    const pt = this.w.profile.eq?.pt;
    if (pt && this.w.profile.own?.[pt] && now >= this.nextPet) {
      const range = petBugRange(this.hooks.petXp?.() ?? 0);
      const a = this.target(range);
      if (a) { this.nextPet = now + PET_SWING_MS; if (this.swing(a)) this.hooks.petHop(); }
    }
  }
  private nextPet = 0;

  private flee(a: Alive, now: number): void { a.view.state = 'flee'; a.view.since = now; }

  // 내 주변 풀밭·꽃밭의 빈 칸에 하나
  private trySpawn(now: number): void {
    const m = this.w.map, me = this.w.me;
    if (me.roomId) return;
    for (let tries = 0; tries < 40; tries++) {
      const x = me.x + Math.floor(Math.random() * 17) - 8, y = me.y + Math.floor(Math.random() * 13) - 6;
      const g = groundAt(m, x, y);
      if (g !== G.GRASS && g !== G.GRASS2 && g !== G.FLOWER) continue;
      if (!isWalkable(m, x, y) || this.w.occupied(x, y) || (x === me.x && y === me.y)) continue;
      if (Math.abs(x - me.x) + Math.abs(y - me.y) < 2) continue;
      if (this.alive.some((a) => a.view.x === x && a.view.y === y)) continue;
      const def = bugColl.pick();
      this.alive.push({ def, born: now, life: BUG_LIFE_MIN_MS + Math.random() * (BUG_LIFE_MAX_MS - BUG_LIFE_MIN_MS), view: { x, y, icon: def.icon, state: 'idle', since: now, seed: Math.random() * 1000 } });
      return;
    }
  }

  // 옆 8칸(대각선 포함, range 칸까지)에 있는 벌레. 이동 중이면 가고 있는 칸 기준. 가까운 것부터
  target(range = 1): Alive | null {
    const me = this.w.me;
    if (me.locked || me.roomId) return null;
    let best: Alive | null = null, bestD = 99;
    for (const a of this.alive) {
      if (a.view.state !== 'idle') continue;
      const d = Math.max(Math.abs(a.view.x - me.x), Math.abs(a.view.y - me.y));
      if (d <= range && d < bestD) { best = a; bestD = d; }
    }
    return best;
  }
  targetView(): BugView | null { return this.target()?.view || null; }

  // F: 잠자리채 휘두르기. true 면 휘둘렀다 (성공/실패 모두). 쿨타임 없음. pick 을 주면 그 벌레 (펫이 2칸 거리에서 잡을 때)
  swing(pick?: Alive | null): boolean {
    const now = performance.now();
    const a = pick ?? this.target();
    if (!a) return false;
    if (Math.random() < netChance(bugCatchChance(a.def), netTierOf(this.w.profile.own))) { // 잠자리채 등급(상점): 1단계 실패 절반, 2단계 무조건
      a.view.state = 'caught'; a.view.since = now;
      this.queueCatch(a.def);
    } else {
      this.flee(a, now);
      this.w.catchNote('bug', a.def.rarity >= 1 && !a.def.junk ? `🐛 ${a.def.name}… 아깝다, 날아갔다!` : '🐛 놓쳤다… 날아갔다.');
    }
    return true;
  }

  // 기록 쓰기는 한 줄로 세워 BUG_SAVE_GAP_MS 간격으로 (연타해도 규칙에 안 걸리게)
  private queueCatch(def: CollDef): void {
    this.chain = this.chain.then(async () => {
      const wait = this.lastSaveAt + BUG_SAVE_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastSaveAt = Date.now();
      await this.catchBug(def);
    }).catch(() => {});
  }

  private async catchBug(f: CollDef): Promise<void> {
    const w = this.w;
    const size = bugColl.rollSize(f);
    const pts = bugPoints(f);
    const sizeTxt = size ? ` ${fmtBugSize(size)}` : '';
    w.catchNote('bug', f.junk ? `🐛 ${f.icon} ${f.name}… 꽝!` : `🐛 ${f.icon} ${RARITY_NAME[f.rarity]} 등급 ${f.name}${sizeTxt} 채집! (+${pts}점 · 💰+${pts})`); // 채팅·말풍선 대신 (2026-11-09)
    try {
      const wk = weekKey();
      const bookPath = `bug/book/${w.uid}/${f.id}`, weekPath = `bug/week/${wk}/${w.uid}`;
      // 낚시와 같다 (2026-11-10): 도감 칸은 세션 동안 기억해 두고, 주간 점수는 서버에서 더하게 한다. 잡을 때마다 다시 읽지 않는다
      const b = await readOwn<BookEntry>(bookPath);
      const book = { c: (b?.c || 0) + 1, m: Math.max(b?.m || 0, size), f: b?.f || serverTimestamp() };
      try {
        await update(ref(db), { [bookPath]: book, [`${weekPath}/n`]: w.profile.nick, [`${weekPath}/p`]: increment(pts), [`${weekPath}/c`]: increment(1), [`${weekPath}/at`]: serverTimestamp() });
      } catch (e) { forgetOwn(bookPath); throw e; }
      rememberOwn(bookPath, { ...book, f: b?.f || serverNow() });
      if (pts > 0) void w.wallet.earn(pts);
      if (!b) { const t = f.junk ? `${f.icon} 꽝 컬렉션에 추가: ${f.name}` : `${f.icon} 곤충 도감에 새로 등록: ${f.name}`; w.toast(t); w.catchLog.add('bug', t); }
      if (size > 0 && size > (this.bestSeen.get(f.id) ?? -1)) {
        runTransaction(ref(db, `bug/best/${f.id}`), (cur: BestEntry | null) => (!cur || size > cur.s ? { u: w.uid, n: w.profile.nick, s: size, at: serverNow() } : undefined), { applyLocally: false })
          .then((res) => { this.bestSeen.set(f.id, (res.snapshot.val() as BestEntry | null)?.s ?? size); if (res.committed) { const t = `🏆 ${f.name} 최고 기록 갱신! ${fmtBugSize(size)}`; w.toast(t); w.catchLog.add('bug', t); } })
          .catch(() => {});
      }
      if (!f.junk && f.rarity >= BUG_ANNOUNCE_RARITY) {
        const feed: FeedEntry = { u: w.uid, n: w.profile.nick, f: f.id, s: size, ts: serverTimestamp() as unknown as number };
        await set(push(ref(db, 'bug/feed')), feed);
      }
      this.net.stat('bugs');
    } catch (e) {
      console.warn('bug save failed', e);
      w.toast('기록 저장에 실패했습니다.', true);
    }
  }
}
