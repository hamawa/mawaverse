// 경마공원 연결 (2026-11-23): shared/derby 의 결정적 출마표·고정 배당·NPC 매출을 쇼(derbyshow)와 마권 판(derbyui)에 잇는 어댑터+컨트롤러.
// 발매 연결(DerbyLiveSeam)이 없으면 판은 늘 발매 중이 아니고(sellable=false, 구매 단추 잠김) 쇼에는 결과가 없다(result=null).
// world 는 공원에 들어오면 attachLive(new DerbyLive(...)) 로 발매 연결을 꽂는다 (아래 DerbyLive: 발매 여부·결과·내 마권 읽기와 추첨·공개 순서, 쓰기는 WalletMgr).
import {
  derbyCard, raceNo, cycleStart, saleProgress, nextScheduledRace, raceScheduled, derbyStatusText, raceOdds, derbyPools, comboKey,
  ticketPayout, ticketWins, ticketKey, validTicketAmount, derbyResolve, parseDerbyDraw, DERBY_SALE_MS, DERBY_FINISH_MS, DERBY_MAX_PARK, DERBY_MAX_BRANCH, DERBY_TICKETS_PER_RACE,
  DERBY_BET_TYPES, DERBY_CYCLE_MS,
  type DerbyCard, type DerbyBetType, type DerbyDraw, type RaceHours, type RaceHoursEnv,
} from '../shared/derby';
import { kstParts } from '../shared/hours';
import {
  COMBO_KEY, DerbyPanel,
  type DerbyHost, type DerbySnapshot, type DerbyCardHorse, type DerbyOddsCell, type DerbyBetKind, type DerbyQuoteLine,
  type DerbyScheduleItem, type DerbyRaceHead, type DerbyRaceStatus, type DerbyTicketView, type DerbySubmitReq, type DerbySubmitLine,
  type DerbyWhere,
} from './derbyui';
import type { DerbyFieldSnapshot, DerbyShowInput, DerbyResult as ShowResult, DerbyEventKind as ShowEventKind, DerbyRunner as ShowRunner } from './derbyshow';
import type { DerbyBuyResult, DerbyLine, DerbySettle } from './wallet';

const SALE_STEP_MS = 30000;               // NPC 매출은 30초 단계로만 바꾼다 (판을 다시 그리는 횟수를 줄인다. 발매 4분 = 8단계)
const SELECT_SPAN = 8 * (86400000 / DERBY_CYCLE_MS); // 예정표에서 고를 수 있는 먼 경주 (nextScheduledRace 의 탐색 범위와 같다)
const SCHEDULE_ITEMS = 5;
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
const COAT_CSS: Record<string, string> = { 갈색: '#7a4a2b', 밤색: '#9c6b3c', 흑갈색: '#4a3220', 회색: '#8a8d92', 흑색: '#2e2e2e' };
export const DERBY_VIEW_ONLY_LABEL = '보기 전용';

const betKind = (t: DerbyBetType): DerbyBetKind => t;

// ---- 순수 어댑터 (시험 대상) ----

// 쇼용 출전표: 진짜 말·기수·마번·거리·각질·몸짓. 결과는 없다(null). 단승 배당은 고정 배당표 값
export function derbyShowRunners(card: DerbyCard): ShowRunner[] {
  return card.runners.map((r) => ({
    gate: r.gate, name: r.horse.name, coat: COAT_CSS[r.horse.coat] ?? COAT_CSS['갈색'], jockey: r.jockey.name,
    silk: [r.jockey.silk.body, r.jockey.silk.sleeve], style: r.horse.style, behavior: r.behavior,
  }));
}
export function derbyFieldSnapshot(n: number): DerbyFieldSnapshot {
  const card = derbyCard(n);
  const winOdds: { [gate: number]: number | null } = {};
  for (const r of card.runners) winOdds[r.gate] = raceOdds(n, 'W', r.rank) / 10;
  return { n, distance: card.distance, runners: derbyShowRunners(card), result: null, winOdds };
}

// 마번 → 인기 순위
function rankMap(card: DerbyCard): Map<number, number> { return new Map(card.runners.map((r) => [r.gate, r.rank])); }
const legsNeeded = (kind: DerbyBetKind): number => (kind === 'W' || kind === 'P' ? 1 : 2);

// 고정 배당 견적 (판이 마번으로 물으면 순위로 바꿔 코어 배당표에서 읽는다). 모르는 마번·잘못된 길이·같은 말 겹침·금액 형식 위반은 null
export function derbyQuote(n: number, kind: DerbyBetKind, combos: number[][], stake: number): DerbyQuoteLine[] {
  const rank = rankMap(derbyCard(n));
  const need = legsNeeded(kind);
  return combos.map((legs) => {
    const key = COMBO_KEY(kind, legs);
    if (legs.length !== need || !legs.every((g) => rank.has(g)) || new Set(legs).size !== need) return { key, legs, odds: null, est: null };
    const x10 = raceOdds(n, kind, rank.get(legs[0])!, need === 2 ? rank.get(legs[1])! : -1);
    return { key, legs, odds: x10 / 10, est: validTicketAmount(stake) ? ticketPayout(stake, x10) : null };
  });
}

// 발매 진행 단계 (30초). 발매 시작 전 0, 마감 뒤 8 (= 100%)
export function saleBucket(nowMs: number, n: number): number {
  return Math.floor(Math.min(DERBY_SALE_MS, Math.max(0, nowMs - cycleStart(n))) / SALE_STEP_MS);
}
const poolCache = new Map<string, ReturnType<typeof derbyPools>>();
function poolsAt(n: number, bucket: number): ReturnType<typeof derbyPools> {
  const k = `${n}|${bucket}`;
  let p = poolCache.get(k);
  if (!p) {
    if (poolCache.size > 24) poolCache.clear();
    p = derbyPools(n, saleProgress(cycleStart(n) + bucket * SALE_STEP_MS));
    poolCache.set(k, p);
  }
  return p;
}

const gateLegs = (card: DerbyCard, t: DerbyBetType): number[][] => {
  const gates = card.runners.map((r) => r.gate);
  const out: number[][] = [];
  if (t === 'W' || t === 'P') return gates.map((g) => [g]);
  for (const a of gates) for (const b of gates) if (a !== b && (t === 'E' || a < b)) out.push([a, b]);
  return out;
};

// 한 말의 카드 줄 (매출 = 그 말의 단승 칸 매출)
export function derbyCardHorse(n: number, gate: number, nowMs: number): DerbyCardHorse | null {
  const card = derbyCard(n);
  const r = card.runners.find((x) => x.gate === gate);
  if (!r) return null;
  const pools = poolsAt(n, saleBucket(nowMs, n));
  return {
    gate, name: r.horse.name, sex: r.horse.sex === '거' ? '거세' : r.horse.sex, age: r.horse.age, jockey: r.jockey.name,
    last5: '준비 중', // 전적은 결과 확정 뒤에 기록된다 (결과 게시 연결 전이라 아직 없음)
    rating: r.rating, winOdds: raceOdds(n, 'W', r.rank) / 10, placeOdds: raceOdds(n, 'P', r.rank) / 10,
    sales: pools.W.cells[comboKey('W', r.rank)] ?? 0,
  };
}

export function raceTimeLabel(n: number, nowMs: number): string {
  const p = kstParts(cycleStart(n));
  const hm = `${String(Math.floor(p.min / 60)).padStart(2, '0')}:${String(p.min % 60).padStart(2, '0')}`;
  return p.day === kstParts(nowMs).day ? hm : `${DOW_KO[p.dow]} ${hm}`;
}

// 판이 처음 보여 줄 경주: 고른 경주(지나지 않은 것) > 열린 시간이면 발매가 안 끝난 다음 예정 경주 > 지금 달력의 경주
export function derbyViewRace(nowMs: number, hours: RaceHours | null, env: RaceHoursEnv, selected: number | null): number {
  const cur = raceNo(nowMs);
  if (selected !== null && Number.isInteger(selected) && selected >= cur && selected <= cur + SELECT_SPAN) return selected;
  return raceScheduled(cur, hours, env) ? nextScheduledRace(nowMs, hours, env) ?? cur : cur;
}

// 주로 값 파라미터 묶음 (발매 연결을 꽂으면 live 가 채운다)
export interface DerbyLiveSale { status: DerbyRaceStatus; statusLabel: string; sellable: boolean; authEpoch: number; closesInMs: number }
export interface DerbyLiveAccount { spent: number; ticketUsed: number; tickets: DerbyTicketView[]; standings: number[] | null }
export interface DerbyLiveSeam {
  sale(n: number): DerbyLiveSale | null;
  account(n: number): DerbyLiveAccount | null;
  submit(req: DerbySubmitReq): Promise<DerbySubmitLine[]>;
  listen(cb: () => void): () => void;
  tick?(nowMs: number): void;              // 매 프레임 (구독할 경주를 옮긴다. 가벼워야 한다)
  result?(n: number): ShowResult | null;   // 쇼에 넘길 확정 착순 (없으면 null)
  holds?(n: number): boolean;              // 그 경주에 아직 결과·환급을 기다리는 내 마권이 있나 (판이 마감 뒤에도 그 경주를 보여 준다)
  close?(): void;                          // 구독을 모두 거둔다
}

// ---- 발매 연결 (2026-11-24, SPEC "경마공원 · 마권 구매 · 결과 추첨과 공개 · 데이터와 규칙") ----
// 읽기와 추첨·공개 순서만 여기서 정하고, 쓰기는 WalletMgr 가 한다 (구매 buyDerby · 추첨 drawDerby · 공개 revealDerby · 환급 settleDerby. 규칙은 tools/gen-rules.cjs derbyBlocks).
// 발매 여부는 서버 시각의 경주표(config/raceHours · 공휴일 · 차단 설정)와 숨은 결과표가 덮은 범위(race/cover)로 정한다. 승인·하트비트는 없다.
// 구독 (공원에 있는 동안만): race/cover (결과표를 올릴 때만 바뀜) · race/x/{지금 경주} (경주마다 추첨 한 번 + 공개 한 번). 경주가 바뀌면 옮겨 건다.
//  이번 방문에 마권을 산 지난 경주는 환급을 받을 때까지 race/x/{n} 만 남긴다.
// 추첨·공개: 마감 뒤(경주마다 다른 0~1.5초 늦게) 결과가 없으면 추첨을 쓰고, 내 추첨이 받아들여졌으면 바로 공개한다.
//  다른 사람이 추첨했으면 그 사람이 공개할 시간(REVEAL_WAIT_MS)을 기다렸다가, 그때도 없으면 내가 공개한다.
// 내 마권·장부(race/t/{n}/{uid} · race/u/{uid}/{n})는 살 때 · 결과가 났을 때 · 다른 탭이 샀을 때(지갑 kd·kb 가 바뀜)만 한 번씩 읽는다.
export interface DerbyLiveWallet {
  derbySpent(n: number): number;
  derbyNextIndex(n: number): number;
  listen(cb: () => void): () => void;
  buyDerby(n: number, lines: readonly DerbyLine[], cap: number): Promise<DerbyBuyResult[]>;
  drawDerby(n: number): Promise<boolean>;
  revealDerby(n: number): Promise<DerbyDraw | null>;
  settleDerby(n?: number): Promise<DerbySettle>;
}
export interface DerbyLiveDeps {
  where: DerbyWhere;
  uid: string;
  now(): number;                                           // serverNow()
  hours(): RaceHours | null;
  env(): RaceHoursEnv;
  cap(): number;                                           // 이 장소의 한 경주 한도 (공원 config/raceMax/park)
  watch(path: string, cb: (v: unknown) => void): () => void; // onValue (읽기 실패는 조용히)
  read(path: string): Promise<unknown>;                    // get 한 번
  wallet: DerbyLiveWallet;
  toast(msg: string, err?: boolean): void;
}
export const REVEAL_WAIT_MS = 15000;   // 다른 사람이 추첨했으면 이만큼 그 사람의 공개를 기다린다
const REVEAL_RETRY_MS = 5000;          // 추첨·공개가 안 됐으면 다시 해 보는 첫 간격 (실패할 때마다 두 배, REVEAL_RETRY_MAX_MS 까지)
const REVEAL_RETRY_MAX_MS = 120000;
export const REVEAL_MAX_TRIES = 5;     // 이 화면에서 한 경주를 추첨·공개해 보는 최대 횟수 (그 뒤에는 멈추고 판에 알린다. 다음 접속 때 환급이 다시 해 본다)
const DRAW_JITTER_MS = 1500;           // 마감 뒤 추첨을 늦추는 폭 (여러 화면이 한꺼번에 쓰지 않게)
type LiveTicket = { t: DerbyBetType; s1: string; s2?: string; a: number; od: number };
interface LiveMine { tk: Record<string, LiveTicket>; paid: Record<string, true>; s: number; c: number }
type Cover = { s: number; e: number };
const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const rankCh = (v: unknown): v is string => typeof v === 'string' && /^[0-7]$/.test(v);
export function parseCover(v: unknown): Cover | null {
  return isRec(v) && Number.isInteger(v.s) && Number.isInteger(v.e) ? { s: v.s as number, e: v.e as number } : null;
}
function parseTickets(v: unknown): Record<string, LiveTicket> {
  const out: Record<string, LiveTicket> = {};
  if (!isRec(v)) return out;
  for (const [nn, t] of Object.entries(v)) {
    if (!/^[0-9][0-9]$/.test(nn) || !isRec(t) || !DERBY_BET_TYPES.includes(t.t as DerbyBetType) || !rankCh(t.s1) || typeof t.a !== 'number' || typeof t.od !== 'number') continue;
    out[nn] = { t: t.t as DerbyBetType, s1: t.s1, ...(rankCh(t.s2) ? { s2: t.s2 } : {}), a: t.a, od: t.od };
  }
  return out;
}
// 공개된 결과 → 쇼 결과 (착순 8두를 마번으로, 일어난 일은 그 말의 마번으로).
//  1·2·3착과 일어난 일은 공개값(숨은 칸에 적힌 그대로)을 따르고, 4착 아래 순서와 낙마 꾸밈만 공개된 7자리 숫자로 다시 계산한다
//  (결과표를 만든 뒤 계산 코드가 바뀌었어도 쇼가 정산과 같은 결과를 보인다)
export function derbyShowResult(n: number, x: DerbyDraw, spliceMs: number): ShowResult | null {
  if (!x.digits || !x.res) return null;
  const card = derbyCard(n), gateOf = (r: number) => card.runners.find((q) => q.rank === r)?.gate ?? 0;
  const out = derbyResolve(n, x.digits), res = x.res;
  const top = [res.a, res.b, res.c].map(Number);
  const order = [...top, ...out.order.filter((r) => !top.includes(r))];
  const ek = res.e === 'n' ? null : res.e[0];
  const kind: ShowEventKind | null = !ek ? null : ek === 'b' ? 'boost' : ek === 'l' ? 'place' : out.fall && out.res.e === res.e ? 'fall' : 'drop';
  return { order: order.map(gateOf), event: kind ? { gate: gateOf(Number(res.e.slice(1))), kind } : null, spliceMs };
}
const BUY_ERR: Record<Extract<DerbyBuyResult, { ok: false }>['why'], string> = {
  line: '마권 형식이 맞지 않아요.',
  coins: '코인이 모자라요.',
  cap: '이 경주 구매 한도를 넘어요.',
  full: `이 경주에는 더 살 수 없어요 (최대 ${DERBY_TICKETS_PER_RACE}장).`,
  closed: '발매가 마감됐어요.',
  denied: '발매가 잠시 멈췄거나 지금 자리에서는 살 수 없어요.',
};
const koCoins = (v: number) => v.toLocaleString('ko-KR');

export class DerbyLive implements DerbyLiveSeam {
  private cur: number | null = null;
  private cover: Cover | null | undefined = undefined;   // 없음 = 아직 모름, null = 결과표 없음
  private results = new Map<number, DerbyDraw | null>(); // 없음 = 아직 모름, null = 추첨 전
  private seenAt = new Map<number, number>();              // 결과를 처음 본 주기 안 시각 (쇼가 대열 → 결과 경로를 이어 붙이는 기준)
  private shows = new Map<number, ShowResult | null>();
  private mine = new Map<number, LiveMine>();
  private loads = new Map<number, number>();               // 경주 → 마지막으로 시작한 읽기 번호 (늦게 온 옛 읽기는 버린다)
  private loadSeq = 0;
  private offs = new Map<string, () => void>();            // 경로 → 구독 해제
  private listeners = new Set<() => void>();
  private walletOff: (() => void) | null = null;
  private buying = 0;
  private settling = new Set<number>();
  private drawing = new Set<number>();                     // 추첨·공개 중인 경주
  private retryAt = new Map<number, number>();
  private fails = new Map<number, number>();               // 경주 → 공개하지 못한 횟수
  private readonly jitter = Math.floor(Math.random() * DRAW_JITTER_MS);
  private closed = false;

  constructor(private d: DerbyLiveDeps) {}

  listen(cb: () => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  private emit(): void { for (const cb of [...this.listeners]) cb(); }

  tick(nowMs: number): void {
    if (this.closed) return;
    const cur = raceNo(nowMs);
    if (cur !== this.cur) {
      const prev = this.cur;
      this.cur = cur;
      this.walletOff ??= this.d.wallet.listen(() => this.walletChanged());
      this.watch('race/cover', (v) => { this.cover = parseCover(v); this.emit(); });
      if (prev !== null && !this.unsettled(prev)) this.forget(prev);
      this.watch(`race/x/${cur}`, (v) => this.onResult(cur, v));
      for (const n of new Set([...this.results.keys(), ...this.mine.keys()])) if (n < cur && !this.unsettled(n)) this.forget(n);
      this.walletChanged();
      this.emit();
    }
    this.drive(cur, nowMs);
  }

  close(): void {
    this.closed = true;
    for (const off of this.offs.values()) off();
    this.offs.clear();
    this.walletOff?.(); this.walletOff = null;
    this.listeners.clear();
  }

  private watch(path: string, cb: (v: unknown) => void): void {
    if (this.offs.has(path)) return;
    this.offs.set(path, this.d.watch(path, (v) => { if (!this.closed) cb(v); }));
  }
  private unwatch(path: string): void { this.offs.get(path)?.(); this.offs.delete(path); }
  private forget(n: number): void {
    this.unwatch(`race/x/${n}`);
    this.results.delete(n); this.seenAt.delete(n); this.shows.delete(n); this.mine.delete(n); this.retryAt.delete(n); this.fails.delete(n);
  }
  private stuck(n: number): boolean { return (this.fails.get(n) ?? 0) >= REVEAL_MAX_TRIES; }
  private covered(n: number): boolean { return !!this.cover && this.cover.s <= n && n < this.cover.e; }

  private onResult(n: number, v: unknown): void {
    const x = parseDerbyDraw(v);
    this.results.set(n, x);
    if (x?.res && !this.seenAt.has(n)) this.seenAt.set(n, Math.min(DERBY_CYCLE_MS, Math.max(DERBY_SALE_MS, this.d.now() - cycleStart(n))));
    this.emit();
    if (x?.res) void this.settle(n);
  }

  // 매 프레임: 구독 중인 경주 가운데 마감했는데 공개되지 않은 경주를 추첨·공개한다 (지금 경주는 발매한 경주일 때, 지난 경주는 내 마권이 남아 있을 때)
  private drive(cur: number, now: number): void {
    for (const [n, x] of this.results) {
      if (x?.res || this.drawing.has(n) || this.stuck(n) || now < (this.retryAt.get(n) ?? 0) || now < cycleStart(n) + DERBY_SALE_MS + this.jitter) continue;
      if (!this.covered(n) || (n === cur ? !raceScheduled(n, this.d.hours(), this.d.env()) && !this.holds(n) : !this.unsettled(n))) continue;
      if (x && now - x.at < REVEAL_WAIT_MS) continue; // 추첨한 사람이 공개하는 중
      this.drawing.add(n);
      const run = async () => (x || await this.d.wallet.drawDerby(n) ? this.d.wallet.revealDerby(n) : null);
      // 추첨을 놓친 것(다른 사람이 추첨함)도 한 번으로 센다: 그때는 다음 차례에 그 사람의 공개를 기다린다
      run().then((r) => !r?.res, (e) => { console.warn('경주 결과를 공개하지 못했습니다', e); return true; }).then((bad) => {
        this.drawing.delete(n);
        const k = bad ? (this.fails.get(n) ?? 0) + 1 : 0;
        if (k) this.fails.set(n, k); else this.fails.delete(n);
        this.retryAt.set(n, this.d.now() + (k ? Math.min(REVEAL_RETRY_MS * 2 ** (k - 1), REVEAL_RETRY_MAX_MS) : REVEAL_RETRY_MS));
        if (this.stuck(n)) { console.warn(`제${n}경주 결과를 ${k}번 공개하지 못해 멈춥니다`); this.emit(); }
      });
    }
  }

  // 다른 탭·분점에서 이 경주 마권을 샀으면 (지갑 kb 가 내가 아는 장수보다 앞섰다) 내 마권을 다시 읽는다
  private walletChanged(): void {
    const n = this.cur;
    if (n === null || this.buying) return;
    const used = this.d.wallet.derbyNextIndex(n);
    if (used > (this.mine.get(n)?.c ?? 0) && !this.loads.has(n)) void this.load(n);
  }

  private async load(n: number): Promise<void> {
    const seq = ++this.loadSeq;
    this.loads.set(n, seq);
    try {
      const [tk, u] = await Promise.all([this.d.read(`race/t/${n}/${this.d.uid}`), this.d.read(`race/u/${this.d.uid}/${n}`)]);
      if (this.closed || this.loads.get(n) !== seq) return;
      const paid: Record<string, true> = {};
      const led = isRec(u) ? u : {};
      for (const [k, val] of Object.entries(led)) if (/^[0-9][0-9]$/.test(k) && val === true) paid[k] = true;
      this.mine.set(n, { tk: parseTickets(tk), paid, s: typeof led.s === 'number' ? led.s : 0, c: typeof led.c === 'number' ? led.c : 0 });
      if (n !== this.cur && !this.offs.has(`race/x/${n}`) && this.unsettled(n)) this.watch(`race/x/${n}`, (v) => this.onResult(n, v));
    } catch (e) {
      console.warn('내 마권을 읽지 못했습니다', e);
    } finally {
      if (this.loads.get(n) === seq) this.loads.delete(n);
    }
    this.emit();
  }

  // 결과가 공개됐다: 이 경주에 산 마권이 있으면 환급 (지갑의 영수증이 두 번 받지 못하게 막는다)
  private async settle(n: number): Promise<void> {
    if (this.settling.has(n) || !this.unsettled(n)) return;
    this.settling.add(n);
    try {
      const r = await this.d.wallet.settleDerby(n);
      if (r.paid > 0) this.d.toast(`🏇 제${n}경주 적중! 💰 ${koCoins(r.paid)} 을 받았어요.`);
      else if (r.tickets > 0) this.d.toast(`🏇 제${n}경주 결과: 이번에는 적중한 마권이 없어요.`);
    } catch (e) {
      console.warn('마권 환급을 마치지 못했습니다. 미정산 기록은 유지됩니다.', e);
      this.d.toast('마권 환급을 마치지 못했어요. 다음 접속 때 다시 받아요.', true);
    } finally {
      this.settling.delete(n);
    }
    if (this.closed) return;
    await this.load(n);
    if (this.cur !== null && n < this.cur && !this.unsettled(n)) this.forget(n);
  }

  // 그 경주에 내 마권이 있나 (판이 마감 뒤에도 그 경주의 결과·내 마권을 보여 준다)
  holds(n: number): boolean {
    const m = this.mine.get(n);
    return (!!m && Object.keys(m.tk).length > 0) || (this.cur === n && this.d.wallet.derbyNextIndex(n) > 0);
  }
  // 결과나 환급을 아직 기다리는 마권이 있나 (지난 경주의 결과 구독을 남길지)
  private unsettled(n: number): boolean {
    if (!this.holds(n)) return false;
    const m = this.mine.get(n);
    if (!this.results.get(n)?.res || !m) return true;
    return Object.keys(m.tk).some((nn) => !m.paid[nn]);
  }

  result(n: number): ShowResult | null {
    const x = this.results.get(n);
    if (!x?.res) return null;
    if (!this.shows.has(n)) this.shows.set(n, derbyShowResult(n, x, this.seenAt.get(n) ?? DERBY_SALE_MS));
    return this.shows.get(n) ?? null;
  }

  // 발매 상태: 경주표(운영 시간)와 결과표 범위로 발매 여부를, 마감 뒤에는 추첨·공개 칸으로 결과 여부를 정한다. authEpoch = 그 경주의 시작 시각
  sale(n: number): DerbyLiveSale | null {
    const now = this.d.now(), cur = raceNo(now), hours = this.d.hours(), env = this.d.env();
    const close = cycleStart(n) + DERBY_SALE_MS, epoch = cycleStart(n);
    const off = (status: DerbyRaceStatus, statusLabel: string): DerbyLiveSale => ({ status, statusLabel, sellable: false, authEpoch: epoch, closesInMs: 0 });
    const scheduled = raceScheduled(n, hours, env);
    if (n > cur) return off('nosale', scheduled ? `발매 전 · ${raceTimeLabel(n, now)} 발매 시작` : derbyStatusText(now, hours, env));
    if (this.cover === undefined) return off('nosale', '발매 정보를 확인하는 중');
    const sold = scheduled && this.covered(n);
    if (now < close) {
      if (!scheduled) return off('nosale', derbyStatusText(now, hours, env));
      if (!sold) return off('nosale', '발매하지 않는 경주');
      return { status: 'selling', statusLabel: '발매 중', sellable: true, authEpoch: epoch, closesInMs: close - now };
    }
    if (this.results.get(n)?.res) return off('done', '결과 확정');
    if (!sold && !this.holds(n)) return off('nosale', '발매하지 않은 경주');
    if (now < cycleStart(n) + DERBY_FINISH_MS) return off('closed', '발매 마감 · 경주 중');
    if (this.stuck(n)) return off('settling', '결과를 공개하지 못했어요 · 다시 접속하면 다시 시도해요');
    return off('settling', '결과 집계 중');
  }

  account(n: number): DerbyLiveAccount | null {
    const m = this.mine.get(n), res = this.results.get(n)?.res ?? null;
    const card = derbyCard(n), gateOf = (r: string | undefined) => card.runners.find((q) => String(q.rank) === r)?.gate ?? 0;
    const tickets: DerbyTicketView[] = Object.keys(m?.tk ?? {}).sort().map((nn) => {
      const t = m!.tk[nn], paid = !!m!.paid[nn];
      const wins = !!res && ticketWins(t, res);
      const status: DerbyTicketView['status'] = !res ? 'sold' : wins ? (paid ? 'won' : 'pending') : 'lost';
      let payout = 0;
      try { payout = wins ? ticketPayout(t.a, t.od) : 0; } catch { payout = 0; }
      return { key: ticketKey(n, Number(nn)), kind: t.t, legs: t.s2 === undefined ? [gateOf(t.s1)] : [gateOf(t.s1), gateOf(t.s2)], stake: t.a, status, payout, note: status === 'pending' ? '적중금 받는 중' : '' };
    });
    return {
      spent: Math.max(this.d.wallet.derbySpent(n), m?.s ?? 0),
      ticketUsed: Math.max(this.d.wallet.derbyNextIndex(n), m?.c ?? 0),
      tickets,
      standings: res ? [res.a, res.b, res.c].map(gateOf) : null,
    };
  }

  async submit(req: DerbySubmitReq): Promise<DerbySubmitLine[]> {
    const list = Array.isArray(req?.tickets) ? req.tickets : [];
    const fail = (error: string): DerbySubmitLine[] => list.map((t) => ({ lineId: t.lineId, key: t.key, ok: false, ticketKey: '', error }));
    if (this.closed) return fail('발매 창이 닫혔어요.');
    const n = raceNo(this.d.now());
    if (req.where !== this.d.where) return fail('이 창구에서는 살 수 없어요.');
    if (req.seenN !== n) return fail('경주가 바뀌었어요.');
    const s = this.sale(n);
    if (!s || s.status !== 'selling' || !s.sellable) return fail('지금은 발매 중이 아니에요.');
    const rank = new Map(derbyCard(n).runners.map((r) => [r.gate, r.rank]));
    const out: DerbySubmitLine[] = list.map((t) => ({ lineId: t.lineId, key: t.key, ok: false, ticketKey: '', error: BUY_ERR.line }));
    const idx: number[] = [], lines: DerbyLine[] = [];
    list.forEach((t, i) => {
      const need = t.kind === 'W' || t.kind === 'P' ? 1 : 2;
      if (!DERBY_BET_TYPES.includes(t.kind) || !Array.isArray(t.legs) || t.legs.length !== need || !t.legs.every((g) => rank.has(g))) return;
      idx.push(i);
      lines.push({ t: t.kind, s1: rank.get(t.legs[0])!, s2: need === 2 ? rank.get(t.legs[1])! : -1, a: t.stake });
    });
    if (lines.length) {
      this.buying++;
      let res: DerbyBuyResult[] = [];
      try { res = await this.d.wallet.buyDerby(n, lines, this.d.cap()); } finally { this.buying--; }
      res.forEach((r, j) => {
        const o = out[idx[j]];
        if (r.ok) Object.assign(o, { ok: true, ticketKey: ticketKey(n, Number(r.nn)), error: '' });
        else o.error = BUY_ERR[r.why];
      });
      if (res.some((r) => r.ok)) await this.load(n);
    }
    return out;
  }
}

export interface DerbySnapshotArgs {
  nowMs: number;
  viewN: number;
  hours: RaceHours | null;          // config/raceHours (없으면 null = 휴장)
  env: RaceHoursEnv;
  balance: number;
  raceCap: number;
  v: number;
  live?: DerbyLiveSeam | null;
  show?: DerbyShowInput | null;     // 분점 미니 중계 (지금 경주의 쇼 입력. 공원은 맵에 그리므로 null)
}
export function derbyPanelSnapshot(a: DerbySnapshotArgs): DerbySnapshot {
  const { nowMs, viewN: n, hours, env } = a;
  const cur = raceNo(nowMs);
  const card = derbyCard(n);
  const bucket = saleBucket(nowMs, n);
  const pools = poolsAt(n, bucket);
  const rank = rankMap(card);
  const hallOpen = raceScheduled(cur, hours, env);
  const live = a.live ?? null;
  const sale = live?.sale(n) ?? null;
  const acct = live?.account(n) ?? null;

  const odds: DerbySnapshot['odds'] = {};
  for (const t of DERBY_BET_TYPES) {
    const cells: Record<string, DerbyOddsCell> = {};
    for (const legs of gateLegs(card, t)) {
      const r1 = rank.get(legs[0])!, r2 = legs.length > 1 ? rank.get(legs[1])! : -1;
      cells[COMBO_KEY(betKind(t), legs)] = { odds: raceOdds(n, t, r1, r2) / 10, pool: pools[t].cells[comboKey(t, r1, r2)] ?? 0 };
    }
    odds[betKind(t)] = cells;
  }

  const nums = new Set<number>();
  let ms = nowMs;
  for (let i = 0; i < SCHEDULE_ITEMS; i++) {
    const s = nextScheduledRace(ms, hours, env);
    if (s === null) break;
    nums.add(s);
    ms = cycleStart(s + 1);
  }
  nums.add(n);
  const schedule: DerbyScheduleItem[] = [...nums].sort((x, y) => x - y).map((m) => ({
    n: m, label: `제${m}경주 ${derbyCard(m).distance}m`, status: live?.sale(m)?.status ?? 'nosale', timeLabel: raceTimeLabel(m, nowMs),
  }));

  // 발매 연결(live)이 없으면 늘 발매 중이 아니다: 운영 시간 안이어도 "발매 연결 전"이라고 밝히고, 휴장이면 휴장 문구
  const head: DerbyRaceHead = {
    n, distance: card.distance,
    status: sale?.status ?? 'nosale',
    statusLabel: sale?.statusLabel ?? (hallOpen ? `운영 시간 · 발매 연결 전 (${DERBY_VIEW_ONLY_LABEL})` : derbyStatusText(nowMs, hours, env)),
    sellable: sale?.sellable === true,
    authEpoch: sale?.authEpoch ?? 0,
    closesInMs: sale?.closesInMs ?? 0,
    label: `제${n}경주 ${card.distance}m${sale ? '' : ` · ${DERBY_VIEW_ONLY_LABEL}`}`,
  };
  const spent = acct?.spent ?? 0, used = acct?.ticketUsed ?? 0;
  return {
    v: a.v, head, schedule, nextN: nextScheduledRace(nowMs, hours, env),
    card: card.runners.map((r) => derbyCardHorse(n, r.gate, nowMs)!),
    odds, standings: acct?.standings ?? null,
    balance: a.balance, spent, raceCap: a.raceCap, raceRemain: Math.max(0, a.raceCap - spent),
    ticketUsed: used, ticketMax: DERBY_TICKETS_PER_RACE, tickets: acct?.tickets ?? [],
    show: a.show ?? null, showCaption: '', closed: !hallOpen,
  };
}

// config/raceMax/{park|branch} (읽은 값 그대로): 100 단위 양수만, 아니면 코어 기본값 (관리자 화면과 같은 검사)
export function derbyRaceCap(raw: unknown, where: DerbyWhere): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 100 && raw % 100 === 0 ? raw : where === 'branch' ? DERBY_MAX_BRANCH : DERBY_MAX_PARK;
}

// ---- 컨트롤러 ----
export interface DerbyViewDeps {
  where: DerbyWhere;                           // park = 공원 창구 옆 판, branch = 광장 경마분점(카지노 방)에 앉아 보는 판
  showInput?(): DerbyShowInput | null;         // 분점 미니 중계: 지금 경주의 쇼 입력 (world 의 출전표에서)
  leaveBranch?(): Promise<void>;               // 분점 판의 나가기 (world.leaveCasino)
  now(): number;                               // serverNow()
  hours(): RaceHours | null;                   // 지금의 config/raceHours (없으면 null = 휴장)
  env(): RaceHoursEnv;                         // 공휴일·쉬는 시간·hoursBlock (이미 있는 world 배선 그대로)
  balance(): number;
  raceCap(): number;
  hasField(n: number): boolean;                // world 에 그 경주 출전표가 이미 있나 (나중 컨트롤러가 결과 넣은 것을 덮지 않는다)
  setField(snap: DerbyFieldSnapshot): void;    // world.setDerbySnapshot
  toast(msg: string, err?: boolean): void;
}

export class DerbyView {
  private selected: number | null = null;
  private rev = 0;                  // 설정·연결이 바뀔 때 올린다
  private v = 0;
  private sig = '';
  private cache: DerbySnapshot | null = null;
  private listeners = new Set<() => void>();
  private panel: DerbyPanel | null = null;
  private runnerCard: { close: () => void } | null = null;
  private live: DerbyLiveSeam | null = null;
  private liveOff: (() => void) | null = null;
  private told = false;
  private closed = false;
  readonly host: DerbyHost;

  constructor(private d: DerbyViewDeps) {
    this.host = {
      where: d.where,
      leaveBranch: d.leaveBranch,
      snapshot: () => this.snapshot(),
      listen: (cb) => { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; },
      quote: (kind, combos, stake) => derbyQuote(this.viewN(), kind, combos, stake),
      // 발매는 연결되지 않았다: 아무것도 수락하지 않고 쓰지 않는다 (빈 응답 = 수락 없음)
      submit: async (req) => {
        if (this.live) return this.live.submit(req);
        this.d.toast('발매 시스템이 아직 연결되지 않아 마권을 살 수 없어요.', true);
        return [];
      },
      selectRace: (n) => this.selectRace(n),
      toast: (m, e) => this.d.toast(m, e),
    };
  }

  // 예정 탐색(nextScheduledRace)은 비싸서, 경주·발매 끝남·설정이 그대로면 지난 답을 쓴다 (매 프레임 불러도 가볍게)
  // 이번 경주에 내 마권이 있으면 마감 뒤에도(결과·환급을 볼 수 있게) 고른 경주가 없을 때 이번 경주를 보여 준다
  private viewMemo: { key: string; n: number } | null = null;
  private viewN(): number {
    const now = this.d.now(), cur = raceNo(now), env = this.d.env();
    const key = `${cur}|${now - cycleStart(cur) >= DERBY_SALE_MS ? 1 : 0}|${this.rev}|${env.hoursBlock ? 1 : 0}|${this.selected}`;
    if (this.viewMemo?.key !== key) {
      const keep = (this.selected === null || this.selected < cur) && this.live?.holds?.(cur) === true;
      this.viewMemo = { key, n: keep ? cur : derbyViewRace(now, this.d.hours(), env, this.selected) };
    }
    return this.viewMemo.n;
  }

  private signature(): string {
    const now = this.d.now(), n = this.viewN(), t = now - cycleStart(raceNo(now));
    // fed: 확정 착순이 쇼 출전표에 들어가면 분점 미니 중계도 결과가 든 입력으로 바꾼다
    return `${n}|${raceNo(now)}|${t >= DERBY_SALE_MS ? 1 : 0}${t >= DERBY_FINISH_MS ? 1 : 0}|${saleBucket(now, n)}|${this.rev}|${this.d.env().hoursBlock ? 1 : 0}|${this.d.balance()}|${this.d.raceCap()}|${this.fed}`;
  }

  snapshot(): DerbySnapshot {
    const sig = this.signature();
    if (!this.cache || sig !== this.sig) {
      this.sig = sig;
      this.cache = derbyPanelSnapshot({
        nowMs: this.d.now(), viewN: this.viewN(), hours: this.d.hours(), env: this.d.env(),
        balance: this.d.balance(), raceCap: this.d.raceCap(), v: ++this.v, live: this.live, show: this.d.showInput?.() ?? null,
      });
    }
    return this.cache;
  }

  // 설정(운영 시간·hoursBlock)이나 연결이 바뀌었다
  changed(): void { this.rev++; this.notify(); }
  private notify(): void { for (const cb of [...this.listeners]) cb(); }

  // 매 프레임: 쇼가 쓸 출전표(이번·다음 경주)를 world 에 채우고, 판이 열려 있으면 보이는 값이 바뀌었을 때만 판을 갱신한다
  sync(): void {
    if (this.closed) return;
    const now = this.d.now(), n = raceNo(now);
    this.live?.tick?.(now);
    for (const m of [n, n + 1]) if (!this.d.hasField(m)) this.d.setField(derbyFieldSnapshot(m));
    // 확정 착순이 오면 그 경주 출전표를 결과가 든 것으로 한 번 바꾼다 (쇼가 결과 경로로 이어 달린다)
    const res = this.fed !== n ? this.live?.result?.(n) ?? null : null;
    if (res) { this.fed = n; this.d.setField({ ...derbyFieldSnapshot(n), result: res }); }
    if (this.listeners.size && this.signature() !== this.sig) this.notify();
  }
  private fed: number | null = null; // 결과를 쇼에 넣은 경주

  selectRace(n: number): void {
    const cur = raceNo(this.d.now());
    if (!Number.isInteger(n) || n < cur || n > cur + SELECT_SPAN) { this.d.toast('이 경주는 볼 수 없어요.', true); return; }
    this.selected = n;
    this.notify();
  }

  horse(n: number, gate: number): DerbyCardHorse | null { return derbyCardHorse(n, gate, this.d.now()); }

  private show(prefillGate?: number): void {
    if (this.closed) return;
    this.panel ??= new DerbyPanel(this.host);
    this.panel.show(prefillGate ? { prefillGate } : undefined);
    if (!this.live && !this.told) { this.told = true; this.d.toast('🏇 마권 발매는 아직 열리지 않았어요. 출마표와 배당만 볼 수 있어요.'); }
  }
  openTeller(): void { this.show(); }
  closePanel(): void { this.panel?.hide(); } // 분점: F 로 판을 잠깐 닫는다 (연결·구독은 방에 있는 동안 그대로)
  showRunnerCard(n: number, gate: number, mount: (pick: () => void, closed: () => void) => { close: () => void }): void {
    if (this.closed) return;
    this.runnerCard?.close();
    const card = mount(
      () => { if (!this.closed && this.runnerCard === card && n >= raceNo(this.d.now())) this.openRunner(n, gate); },
      () => { if (this.runnerCard === card) this.runnerCard = null; },
    );
    this.runnerCard = card;
  }
  // 예시장에서 본 그 경주(n)의 말로 판을 연다 (판이 다른 경주를 보고 있어도 그 경주로 맞춘다)
  openRunner(n: number, gate: number): void {
    if (n >= raceNo(this.d.now())) this.selected = n;
    this.notify();
    this.show(gate);
  }
  get open(): boolean { return !!this.panel?.open; }

  // 발매 연결을 꽂는다 (승인된 컨트롤러만). null 이면 다시 보기 전용
  attachLive(live: DerbyLiveSeam | null): void {
    this.liveOff?.();
    if (this.live !== live) this.live?.close?.();
    this.live = live;
    this.liveOff = live ? live.listen(() => this.changed()) : null;
    this.changed();
  }

  // 공원을 떠날 때 (판·구독·연결을 모두 거둔다)
  dispose(): void {
    this.closed = true;
    this.runnerCard?.close(); this.runnerCard = null;
    this.liveOff?.(); this.liveOff = null; this.live?.close?.(); this.live = null;
    this.panel?.hide(); this.panel = null;
    this.listeners.clear();
  }
}
