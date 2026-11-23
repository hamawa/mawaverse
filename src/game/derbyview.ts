// 경마공원 보기 전용 연결 (2026-11-23): shared/derby 의 결정적 출마표·고정 배당·NPC 매출을 쇼(derbyshow)와 마권 판(derbyui)에 잇는 어댑터+컨트롤러.
// 발매·규칙·운영 승인·결과 게시는 이 파일에 없다 (운영 방식 확정 전). 그래서 판은 늘 발매 중이 아니고(sellable=false, 구매 단추 잠김),
// 쇼에는 결과를 넣지 않는다(result=null). 쓰는 것은 읽기뿐이다: DB 쓰기·지갑 변경 0.
// 나중에 승인된 발매 컨트롤러는 attachLive 로 DerbyLiveSeam 을 꽂으면 된다 (이 뷰는 그대로). 결과를 쇼에 넘기는 것은 world.setDerbySnapshot 으로 한다.
import {
  derbyCard, raceNo, cycleStart, saleProgress, nextScheduledRace, raceScheduled, derbyStatusText, raceOdds, derbyPools, comboKey,
  ticketPayout, validTicketAmount, DERBY_SALE_MS, DERBY_MAX_PARK, DERBY_TICKETS_PER_RACE, DERBY_BET_TYPES, DERBY_CYCLE_MS,
  type DerbyCard, type DerbyBetType, type RaceHours, type RaceHoursEnv,
} from '../shared/derby';
import { kstParts } from '../shared/hours';
import {
  COMBO_KEY, DerbyPanel,
  type DerbyHost, type DerbySnapshot, type DerbyCardHorse, type DerbyOddsCell, type DerbyBetKind, type DerbyQuoteLine,
  type DerbyScheduleItem, type DerbyRaceHead, type DerbyRaceStatus, type DerbyTicketView, type DerbySubmitReq, type DerbySubmitLine,
} from './derbyui';
import type { DerbyFieldSnapshot, DerbyRunner as ShowRunner } from './derbyshow';

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
    show: null, showCaption: '', closed: !hallOpen,
  };
}

// config/raceMax/park (읽은 값 그대로): 100 단위 양수만, 아니면 코어 기본값 (관리자 화면과 같은 검사)
export function derbyParkCap(raw: unknown): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 100 && raw % 100 === 0 ? raw : DERBY_MAX_PARK;
}

// ---- 컨트롤러 ----
export interface DerbyViewDeps {
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
      where: 'park',
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
  private viewMemo: { key: string; n: number } | null = null;
  private viewN(): number {
    const now = this.d.now(), cur = raceNo(now), env = this.d.env();
    const key = `${cur}|${now - cycleStart(cur) >= DERBY_SALE_MS ? 1 : 0}|${this.rev}|${env.hoursBlock ? 1 : 0}|${this.selected}`;
    if (this.viewMemo?.key !== key) this.viewMemo = { key, n: derbyViewRace(now, this.d.hours(), env, this.selected) };
    return this.viewMemo.n;
  }

  private signature(): string {
    const now = this.d.now(), n = this.viewN();
    return `${n}|${raceNo(now)}|${now - cycleStart(raceNo(now)) >= DERBY_SALE_MS ? 1 : 0}|${saleBucket(now, n)}|${this.rev}|${this.d.env().hoursBlock ? 1 : 0}|${this.d.balance()}|${this.d.raceCap()}`;
  }

  snapshot(): DerbySnapshot {
    const sig = this.signature();
    if (!this.cache || sig !== this.sig) {
      this.sig = sig;
      this.cache = derbyPanelSnapshot({
        nowMs: this.d.now(), viewN: this.viewN(), hours: this.d.hours(), env: this.d.env(),
        balance: this.d.balance(), raceCap: this.d.raceCap(), v: ++this.v, live: this.live,
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
    const n = raceNo(this.d.now());
    for (const m of [n, n + 1]) if (!this.d.hasField(m)) this.d.setField(derbyFieldSnapshot(m));
    if (this.listeners.size && this.signature() !== this.sig) this.notify();
  }

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
    this.live = live;
    this.liveOff = live ? live.listen(() => this.changed()) : null;
    this.changed();
  }

  // 공원을 떠날 때 (판·구독·연결을 모두 거둔다)
  dispose(): void {
    this.closed = true;
    this.runnerCard?.close(); this.runnerCard = null;
    this.liveOff?.(); this.liveOff = null; this.live = null;
    this.panel?.hide(); this.panel = null;
    this.listeners.clear();
  }
}
