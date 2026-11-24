// 경마공원 마권 패널 (2026-11-23): 공원(`race-park`)과 분점(`casino` 방) 공용 구매 UI.
// SPEC "경마공원 > 마권 구매"가 상품 계약이다. 이 파일은 순수 뷰+선택 상태만 들고,
// 숫자·판정·지갑·Firebase는 전부 호스트(컨트롤러)가 준다. 계산을 복제하지 않는다.
//
// ---- 호스트 어댑터 최소 배선 (컨트롤러가 이 모양으로 감싼다) ----
//   import { DerbyPanel, type DerbyHost, type DerbySnapshot } from './game/derbyui';
//   const panel = new DerbyPanel(host);
//   panel.show({ prefillGate: 3 }); // 예시장 말 카드에서 마번을 골라 연다
//
// 위치·레이아웃 참고는 옛 5마리 경마 판(casinoui.ts. 2026-11-24 에 지웠다: #casino 옆 판, 모바일 덮개)이지만, 코드는 공유하지 않고
// 이 판 전용 id·클래스(#derby .d-*)와 src/game/derbyui.css만 쓴다. derbyshow.ts는
// 분점 미니 중계(drawDerbyMini)와 타입만 쓰고, 그리기 상태는 호스트가 쥔다.
// world.ts·admin·렌더러·shared 계산·규칙·지갑은 이 파일 밖이다.
import './derbyui.css';
import { el } from '../shared/util';
import {
  drawDerbyMini,
  derbyCaption,
  derbyGateColor,
  DERBY_CYCLE_MS,
  type DerbyShowInput,
  type DerbyDistance,
  type DerbyRunner,
  type DerbyResult,
} from './derbyshow';

// 마번 버튼을 마번 고유 색(공원 이름표·미니 중계와 같은 색)으로 칠한다. 고른 상태는 노란 테두리(CSS)로 보인다
function paintGate(b: HTMLElement, gate: number): void {
  const c = derbyGateColor(gate);
  b.style.background = c.bg;
  b.style.color = c.fg;
}

// ---- 승식 (SPEC 고정 5종. t 글자와 같다) ----
export type DerbyBetKind = 'W' | 'P' | 'Q' | 'E' | 'R';
export const DERBY_KINDS: readonly DerbyBetKind[] = ['W', 'P', 'Q', 'E', 'R'];
export const DERBY_KIND_LABEL: Record<DerbyBetKind, string> = {
  W: '단승',
  P: '연승',
  Q: '복승',
  E: '쌍승',
  R: '복연승',
};

export type DerbyWhere = 'park' | 'branch';
// selling: 발매 중 / closed: 마감(출발 대기·경주 중) / settling: 결과 집계 중 /
// done: 확정 / nosale: 휴장·미발매(다음 예정만 안내)
export type DerbyRaceStatus = 'selling' | 'closed' | 'settling' | 'done' | 'nosale';

// ---- 스냅샷: 화면 숫자는 전부 여기서 온다. 패널은 계산하지 않는다 ----
export interface DerbyCardHorse {
  gate: number; // 1~8
  name: string; // 마명 (외부 텍스트: textContent로만 그린다)
  sex: string; // 성별 (예: "수", "암", "거세". 호스트 문자열 그대로 보여준다)
  age: number; // 나이 (세. 호스트 숫자 그대로 보여준다)
  jockey: string; // 기수 (외부 텍스트)
  last5: string; // 최근 5전 (예: "1-3-2-입-4". 호스트가 만든 문자열 그대로)
  rating: number; // 레이팅 (호스트 숫자 그대로)
  winOdds: number; // 단승 배당 (고정)
  placeOdds: number; // 연승 배당 (고정)
  sales: number; // NPC 매출 (코인 단위)
}
export interface DerbyOddsCell { odds: number; pool: number } // 고정 배당 + NPC 풀
// 견적 한 줄. key는 반드시 COMBO_KEY(kind, legs)와 같은 정규형이어야 한다
// (호스트가 키를 맞추고, 패널은 키·배당·예상액을 그대로만 보여준다).
export interface DerbyQuoteLine { key: string; legs: number[]; odds: number | null; est: number | null }
export type DerbyTicketStatus = 'pending' | 'sold' | 'won' | 'lost';
export interface DerbyTicketView {
  key: string; // "{n}_{00~99}" 마권 키
  kind: DerbyBetKind;
  legs: number[]; // 마번들
  stake: number; // 조합당 금액
  status: DerbyTicketStatus; // sold: 발매됨 / won: 적중·정산됨 / lost: 낙첨 / pending: 대기
  payout: number; // 적중 정산액 (won일 때만 >0. 호스트 숫자)
  note: string; // 실패·상태 안내 (외부 텍스트)
}
export interface DerbyRaceHead {
  n: number; // 경주 번호 (바뀌면 마번 선택을 비운다)
  distance: DerbyDistance;
  status: DerbyRaceStatus;
  statusLabel: string; // 전광판 문구 ("결과 집계 중" 등. 호스트 문구 그대로)
  sellable: boolean; // 지금 사도 되는가 (경주표·결과표 범위·시간 판정은 호스트·규칙 몫)
  authEpoch: number; // 발매 epoch (공원 연결은 그 경주의 시작 시각). 제출 때 seenAuth로 같이 보내고, 바뀌면 버튼이 잠긴다
  closesInMs: number; // 마감까지 남은 시간 (표시용. 0 이하면 발매 불가)
  closesAt?: number; // 마감 서버 시각 (ms. 발매 중이 아니면 0). 있으면 창이 host.now() 와의 차이로 남은 시간을 매 프레임 계산한다 (스냅샷은 30초 단계로만 새로 만들어져서 closesInMs 만 쓰면 시계가 30초씩 멈춘다)
  label: string; // "제7경주 1800m" 같은 머리말 (호스트 문구)
}
// 예정표 한 줄. timeLabel은 KST 표시 문자열(예: "19:00")을 호스트가 그대로 준다.
// 패널은 시간대 계산을 하지 않는다. 휴장 중에도 예정·다음 경주는 보여준다.
export interface DerbyScheduleItem { n: number; label: string; status: DerbyRaceStatus; timeLabel: string }
export interface DerbySnapshot {
  v: number; // 스냅샷 버전 (바뀔 때마다 다시 그린다)
  head: DerbyRaceHead;
  schedule: DerbyScheduleItem[]; // 예정 경주들
  nextN: number | null; // 다음 예정 경주 번호
  card: DerbyCardHorse[]; // 8두. 빈 배열 = 로딩·없음
  odds: Partial<Record<DerbyBetKind, Record<string, DerbyOddsCell>>>; // 조합별 고정 배당·NPC 풀 (키는 COMBO_KEY 정규형)
  standings: number[] | null; // 확정 착순 (마번 순서). 없으면 null
  balance: number; // 내 코인 잔액
  spent: number; // 이 경주에 산 합계 (공원+분점 합산. 호스트 숫자)
  raceCap: number; // 이 경주 합산 한도
  raceRemain: number; // 남은 한도 (호스트 숫자. 패널이 계산하지 않는다)
  ticketUsed: number; // 이 경주 장수
  ticketMax: number; // 이 경주 최대 장수
  tickets: DerbyTicketView[]; // 내 마권 (비동기로 상태가 온다)
  show: DerbyShowInput | null; // 분점 미니 중계용 렌더 상태. 호스트가 쥔다
  showCaption: string; // 중계 자막 (호스트가 derbyCaption으로 만든 문구)
  closed: boolean; // 휴장: 공원 맵에는 있고 판만 닫힘
}

// ---- 액션: 패널 → 호스트 ----
// 판에서는 한 장씩 보낸다. 컨트롤러의 기존 마권별 요청/응답 형식은 유지한다.
export interface DerbySubmitTicket { lineId: string; key: string; kind: DerbyBetKind; legs: number[]; stake: number }
export interface DerbySubmitReq {
  confirmId: string;
  draftId: string;
  where: DerbyWhere;
  seenN: number; // 화면에 견적을 표시한 경주 번호
  seenAuth: number; // 그때 본 발매 epoch
  tickets: DerbySubmitTicket[]; // 살 줄들 (lineId+정규 키+승식+마번+금액)
}
// 결과는 보낸 마권과 일치할 때만 반영한다.
export interface DerbySubmitLine { lineId: string; key: string; ok: boolean; ticketKey: string; error: string }
export interface DerbyHost {
  where: DerbyWhere;
  snapshot(): DerbySnapshot;
  listen(cb: () => void): () => void; // 스냅샷이 바뀌면 cb. 반환값으로 해제
  quote(kind: DerbyBetKind, combos: number[][], stakePerCombo: number): DerbyQuoteLine[];
  submit(req: DerbySubmitReq): Promise<DerbySubmitLine[]>;
  selectRace(n: number): void; // 예정표에서 경주를 고른다. 호스트가 그 경주의 스냅샷을 민다
  toast(msg: string, err?: boolean): void;
  now?(): number; // 서버 시각 (ms). 마감 시계를 매 프레임 그리는 데 쓴다 (없으면 스냅샷의 closesInMs 그대로)
  leaveBranch?(): Promise<void>; // 분점 전용 나가기. 공원은 없음
}

// 조합 정규 키. 승식·순서를 포함한 유일 식별이다 (단승 3번 "W:3", 쌍승 1→2 "E:1>2").
// 복승·복연승은 마번 오름차순으로 접는다 ("Q:3-5"와 "Q:5-3"은 같은 키).
// 호스트의 odds 표·quote·submit 응답도 이 키를 쓴다.
export const COMBO_KEY = (kind: DerbyBetKind, legs: number[]): string =>
  kind === 'E' ? `E:${legs.join('>')}` : `${kind}:${[...legs].sort((a, b) => a - b).join('-')}`;

// 말 카드 한 줄·상세 문구 (순수 함수. 성별·나이를 빠뜨리지 않는다).
export function horseTag(h: DerbyCardHorse): string {
  return `${h.sex}·${h.age}세`;
}
export function describeHorse(h: DerbyCardHorse): string {
  return `기수 ${h.jockey} · ${horseTag(h)} · 최근 ${h.last5} · 레이팅 ${ko(h.rating)} · 단승 ${h.winOdds}배 · 연승 ${h.placeOdds}배 · 매출 ${ko(h.sales)}`;
}

const KIND_NEEDS_PAIR: Record<DerbyBetKind, boolean> = { W: false, P: false, Q: true, E: true, R: true };
const STAKE_MIN = 100;
const STAKE_STEP = 100;

interface DerbyPurchase {
  kind: DerbyBetKind;
  legs: number[];
  stake: number;
  odds: number;
  est: number;
  n: number;
  auth: number;
}

function validStake(stake: number): boolean {
  return Number.isSafeInteger(stake) && stake >= STAKE_MIN && stake % STAKE_STEP === 0;
}

function purchaseBlock(snap: DerbySnapshot, stake: number, left: number = snap.head.closesInMs): string {
  const head = snap.head;
  if (head.status !== 'selling' || !head.sellable || !Number.isFinite(left) || left <= 0) return '지금은 발매 중이 아니에요.';
  if (!validStake(stake)) return '100코인 이상, 100코인 단위로 입력해 주세요.';
  if (!Number.isFinite(snap.balance) || snap.balance < stake) return '코인이 모자라요.';
  if (!Number.isFinite(snap.raceRemain) || snap.raceRemain < stake) return '남은 경주 한도를 넘어요.';
  if (!Number.isFinite(snap.ticketMax - snap.ticketUsed) || snap.ticketUsed >= snap.ticketMax) return '이 경주의 마권을 더 살 수 없어요.';
  return '';
}

function ko(n: number): string {
  return Math.floor(n).toLocaleString('ko-KR');
}
function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function statusText(s: DerbyRaceStatus): string {
  if (s === 'selling') return '발매 중';
  if (s === 'closed') return '마감';
  if (s === 'settling') return '결과 집계 중';
  if (s === 'done') return '확정';
  return '미발매';
}

export class DerbyPanel {
  private root: HTMLElement | null = null;
  private off: (() => void) | null = null;
  private raf = 0;
  private snap: DerbySnapshot | null = null;
  private lastV = -1;
  private mini: HTMLCanvasElement | null = null;
  private miniBase = 0; // show.ms 기준점
  private miniAt = 0; // 기준점을 잡은 시각
  private kind: DerbyBetKind = 'W';
  private legs: number[] = [];
  private selectionRace: number | null = null;
  private stakeText = String(STAKE_MIN);
  private detailGate = 0; // 말 정보 펼침 (0이면 닫힘)
  private collapsed = false;
  private purchaseSeq = 0;
  private submitting = false;

  constructor(private h: DerbyHost) {}

  get open(): boolean {
    return !!this.root;
  }

  show(opts?: { prefillGate?: number }): void {
    if (this.root) {
      if (opts?.prefillGate) this.prefill(opts.prefillGate);
      return;
    }
    const root = el('div', { id: 'derby', class: this.h.where === 'branch' ? 'branch' : 'park' });
    (document.getElementById('app') || document.body).append(root);
    if (this.h.where === 'branch') document.body.classList.add('in-derby');
    // 모바일 공원 판은 접힌 시트로 시작한다 (맵이 먼저 보여야 한다).
    if (this.h.where === 'park' && document.body.classList.contains('mobile')) this.collapsed = true;
    this.root = root;
    this.snap = this.h.snapshot();
    if (opts?.prefillGate) this.prefill(opts.prefillGate);
    this.lastV = -1;
    this.off = this.h.listen(() => {
      this.snap = this.h.snapshot();
      this.render(true);
    });
    this.render(true);
    const loop = () => {
      if (!this.root) return;
      this.tick();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  hide(): void {
    if (!this.root) return;
    cancelAnimationFrame(this.raf);
    this.off?.();
    this.off = null;
    this.root.remove();
    this.root = null;
    this.mini = null;
    document.body.classList.remove('in-derby');
  }

  /** 호스트가 스냅샷을 직접 밀어줄 때 쓴다 (listen과 같은 효과). */
  update(snap: DerbySnapshot): void {
    this.snap = snap;
    this.render(true);
  }

  /** 예시장 말 카드에서 선택한 마번으로 연다. 구매는 버튼을 눌러야 한다. */
  prefill(gate: number): void {
    if (this.submitting || !this.snap || !Number.isInteger(gate) || gate < 1 || gate > 8) return;
    this.selectionRace = this.snap.head.n;
    this.legs = [gate];
    this.render(true);
  }

  private quote(kind: DerbyBetKind, legs: number[], stake: number) {
    try {
      const q = this.h.quote(kind, [[...legs]], stake).find((q) => q.key === COMBO_KEY(kind, legs));
      if (q && q.odds !== null && q.est !== null && Number.isFinite(q.odds) && Number.isFinite(q.est)) {
        return { odds: q.odds, est: q.est };
      }
    } catch { /* 견적이 없으면 발매 버튼을 잠근다. */ }
    return null;
  }

  // 마감까지 남은 ms: 마감 시각과 지금 서버 시각의 차이 (호스트가 둘을 주지 않으면 스냅샷에 든 값)
  private left(snap: DerbySnapshot): number {
    const h = snap.head;
    return h.closesAt && this.h.now ? h.closesAt - this.h.now() : h.closesInMs;
  }

  private tick(): void {
    const snap = this.snap;
    if (!snap || !this.root) return;
    const c = this.root.querySelector('[data-d="count"]');
    if (c) {
      c.textContent =
        snap.head.status === 'selling'
          ? `마감까지 ${mmss(this.left(snap))}`
          : snap.head.status === 'settling'
            ? snap.head.statusLabel || '결과 집계 중'
            : statusText(snap.head.status);
    }
    // 분점 미니 중계: 호스트가 준 show를 주기 안에서 앞으로 돌리며 그린다.
    if (this.mini && snap.show) {
      const now = performance.now();
      if (!this.miniBase) {
        this.miniBase = snap.show.ms;
        this.miniAt = now;
      }
      const ms = (this.miniBase + (now - this.miniAt)) % DERBY_CYCLE_MS;
      if (snap.show.ms !== this.miniBase && Math.abs(snap.show.ms - this.miniBase) > 2000) {
        this.miniBase = snap.show.ms;
        this.miniAt = now;
      }
      drawDerbyMini(this.mini, { ...snap.show, ms });
      const cap = this.root.querySelector('[data-d="minicap"]');
      if (cap) cap.textContent = derbyCaption(ms, { n: snap.show.n, runners: snap.show.runners, result: snap.show.result });
    }
  }

  private render(force: boolean): void {
    const root = this.root;
    const snap = this.snap;
    if (!root || !snap) return;
    if (!force && snap.v === this.lastV) return;
    if (this.selectionRace !== snap.head.n) {
      this.selectionRace = snap.head.n;
      this.legs = [];
      this.detailGate = 0;
    }
    const scroller = root.querySelector('[data-d="body"]');
    const st = scroller ? scroller.scrollTop : 0;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement.getAttribute('data-dk') : null;
    this.lastV = snap.v;
    root.replaceChildren(); // 비우기만 한다. 외부 텍스트는 el(text)→textContent로만 넣는다
    root.classList.toggle('fold', this.collapsed);
    this.buildHead(root, snap);
    if (!this.collapsed) {
      this.buildSchedule(root, snap);
      this.buildMini(root, snap);
      this.buildKindTabs(root, snap);
      this.buildPurchase(snap);
      this.buildCard(root, snap);
      this.buildTickets(root, snap);
      this.buildBoard(root, snap);
    }
    if (st && scroller) {
      const now = root.querySelector('[data-d="body"]');
      if (now) now.scrollTop = st;
    }
    if (active) {
      const f = root.querySelector(`[data-dk="${active}"]`);
      if (f instanceof HTMLElement) f.focus({ preventScroll: true });
    }
    this.tick();
  }

  private buildHead(root: HTMLElement, snap: DerbySnapshot): void {
    const head = el('div', { class: 'd-head' });
    const title = el('b', { class: 'd-title', text: this.h.where === 'branch' ? '🏇 경마 분점' : '🏇 경마공원 마권' });
    head.append(title);
    head.append(el('span', { class: 'd-race', text: snap.head.label || `제${snap.head.n}경주` }));
    head.append(el('span', { class: 'd-count', text: '' }));
    const c = head.lastChild as HTMLElement;
    c.setAttribute('data-d', 'count');
    // 단추는 한 상자에 모아 제목 줄의 오른쪽 위에 둔다 (derbyui.css: 제목 줄은 두 줄이다. 한 줄에 다 넣으면 넘쳐서 단추가 창 밖으로 밀려났다)
    const btns = el('span', { class: 'd-btns' });
    // 공원 판은 접었다 폈다 (모바일은 접힘 시작) 하고 ✕ 로 닫는다. 분점은 나가기로 닫는다.
    if (this.h.where === 'park') {
      const f = el('button', {
        class: 'btn small',
        text: this.collapsed ? '펼치기' : '접기',
        title: '마권 판 접기/펼치기',
      });
      f.setAttribute('data-dk', 'fold');
      f.onclick = () => {
        this.collapsed = !this.collapsed;
        this.render(true);
      };
      btns.append(f);
      const x = el('button', { class: 'btn small', text: '✕', title: '마권 판 닫기 (창구 옆에서 F 로 다시 연다)' });
      x.setAttribute('data-dk', 'close');
      x.onclick = () => this.hide();
      btns.append(x);
    } else {
      const out = el('button', { class: 'btn small out', text: '🚪 나가기', title: '분점에서 나가기' });
      out.setAttribute('data-dk', 'leave');
      out.onclick = () => {
        out.disabled = true;
        void this.h.leaveBranch?.().finally(() => {
          out.disabled = false;
        });
      };
      btns.append(out);
    }
    head.append(btns);
    root.append(head);
    const body = el('div', { class: 'd-body' });
    body.setAttribute('data-d', 'body');
    root.append(body);
    this.bodyEl = body;
  }

  private bodyEl: HTMLElement | null = null;
  private body(): HTMLElement {
    return this.bodyEl ?? this.root!;
  }

  private buildSchedule(root: HTMLElement, snap: DerbySnapshot): void {
    void root;
    const body = this.body();
    if (snap.closed) {
      body.append(el('div', { class: 'd-banner', text: '휴장 중입니다. 공원 산책은 그대로 할 수 있어요.' }));
      // 휴장 중에도 예정·다음 경주는 보여준다 (밑에서 이어 그린다).
    }
    if (!snap.schedule.length) {
      body.append(el('div', { class: 'd-banner', text: snap.card.length ? '' : '출마표를 불러오는 중…' }));
      const b = body.lastChild as HTMLElement;
      if (!b.textContent) b.remove();
      return;
    }
    const bar = el('div', { class: 'd-sched', title: '예정 경주 (눌러서 보기)' });
    for (const s of snap.schedule) {
      const cur = s.n === snap.head.n;
      const time = s.timeLabel ? `${s.timeLabel} ` : '';
      const b = el('button', {
        class: 'btn small' + (cur ? ' on' : ''),
        text: s.timeLabel ? `${s.timeLabel} · ${statusText(s.status)}` : `${time}${s.n}R·${statusText(s.status)}`,
        title: s.label || `제${s.n}경주 보기`,
      });
      b.setAttribute('data-dk', `sched-${s.n}`);
      b.disabled = cur || this.submitting;
      if (!cur) {
        const n = s.n;
        b.onclick = () => {
          try {
            this.h.selectRace(n);
          } catch (e) {
            this.h.toast((e as Error).message || '경주를 고르지 못했어요.', true);
          }
        };
      }
      bar.append(b);
    }
    const next = snap.schedule.find((s) => s.n === snap.nextN);
    if (next && next.n !== snap.head.n) {
      bar.append(el('span', { class: 'd-next', text: `다음 ${next.timeLabel || `${next.n}R`}` }));
    }
    body.append(bar);
  }

  private buildMini(root: HTMLElement, snap: DerbySnapshot): void {
    void root;
    if (this.h.where !== 'branch') return;
    const body = this.body();
    const box = el('div', { class: 'd-mini' });
    const cv = document.createElement('canvas');
    cv.width = 296;
    cv.height = 110;
    cv.className = 'd-minicv';
    cv.setAttribute('aria-label', '분점 중계 화면');
    box.append(cv);
    this.mini = cv;
    this.miniBase = snap.show ? snap.show.ms : 0;
    this.miniAt = performance.now();
    const cap = el('div', { class: 'd-minicap', text: snap.showCaption || snap.head.statusLabel || '' });
    cap.setAttribute('data-d', 'minicap');
    box.append(cap);
    body.append(box);
  }

  private buildCard(root: HTMLElement, snap: DerbySnapshot): void {
    void root;
    const body = this.body();
    body.append(el('div', { class: 'd-sec', text: `출마표 · ${snap.head.distance ?? ''}m` }));
    if (!snap.card.length) {
      body.append(el('div', { class: 'd-banner', text: '출마표가 아직 없어요. 잠시 뒤에 다시 열어 주세요.' }));
      return;
    }
    const list = el('div', { class: 'd-card' });
    for (const h of [...snap.card].sort((a, b) => a.gate - b.gate)) {
      const row = el('div', { class: 'd-horse' + (this.detailGate === h.gate ? ' open' : '') });
      const pick = el('button', { class: 'd-gate', text: String(h.gate), title: `${h.gate}번 선택` });
      pick.setAttribute('data-dk', `gate-${h.gate}`);
      paintGate(pick, h.gate);
      pick.setAttribute('aria-pressed', this.isGateOn(h.gate) ? 'true' : 'false');
      pick.disabled = this.submitting;
      pick.onclick = () => this.toggleGate(h.gate);
      row.append(pick);
      // 마명·성별·나이·기수는 외부 텍스트이므로 textContent로만 넣는다 (el text가 그렇게 한다).
      row.append(el('span', { class: 'd-nm', text: `${h.name}` }));
      row.append(el('span', { class: 'd-sx', text: horseTag(h) }));
      row.append(el('span', { class: 'd-jk', text: h.jockey }));
      row.append(el('span', { class: 'd-odds', text: `단 ${h.winOdds} · 연 ${h.placeOdds}` }));
      const info = el('button', { class: 'btn small', text: '정보', title: `${h.gate}번 정보` });
      info.setAttribute('data-dk', `info-${h.gate}`);
      info.setAttribute('aria-expanded', this.detailGate === h.gate ? 'true' : 'false');
      info.onclick = () => {
        this.detailGate = this.detailGate === h.gate ? 0 : h.gate;
        this.render(true);
      };
      row.append(info);
      if (this.detailGate === h.gate) {
        row.append(
          el('div', {
            class: 'd-detail',
            text: describeHorse(h),
          }),
        );
      }
      list.append(row);
    }
    body.append(list);
  }

  private isGateOn(gate: number): boolean {
    return this.legs.includes(gate);
  }

  private toggleGate(gate: number): void {
    if (this.submitting) return;
    if (this.isGateOn(gate)) this.legs = this.legs.filter((g) => g !== gate);
    else if (KIND_NEEDS_PAIR[this.kind] && this.legs.length === 1) this.legs = [...this.legs, gate];
    else this.legs = [gate];
    this.render(true);
  }

  private buildKindTabs(root: HTMLElement, snap: DerbySnapshot): void {
    void root;
    void snap;
    const body = this.body();
    const tabs = el('div', { class: 'd-tabs', title: '승식' });
    for (const k of DERBY_KINDS) {
      const b = el('button', { class: 'btn small' + (this.kind === k ? ' on' : ''), text: DERBY_KIND_LABEL[k] });
      b.setAttribute('data-dk', `kind-${k}`);
      b.setAttribute('aria-pressed', this.kind === k ? 'true' : 'false');
      b.disabled = this.submitting;
      b.onclick = () => {
        if (this.kind === k) return;
        this.kind = k;
        this.legs = [];
        this.render(true);
      };
      tabs.append(b);
    }
    body.append(tabs);
  }

  private buildPurchase(snap: DerbySnapshot): void {
    const body = this.body();
    const pair = KIND_NEEDS_PAIR[this.kind];
    const hint = this.kind === 'E' ? '1착, 2착 순서로 고르세요.' : pair ? '말 두 마리를 고르세요. 순서는 상관없어요.' : '말 한 마리를 고르세요.';
    body.append(el('div', { class: 'd-hint', text: hint }));
    const row = el('div', { class: 'd-pick' });
    for (const { gate } of [...snap.card].sort((a, b) => a.gate - b.gate)) {
      const selected = this.isGateOn(gate);
      const b = el('button', { class: 'd-num' + (selected ? ' on' : ''), text: String(gate) });
      b.setAttribute('data-dk', `pick-${gate}`);
      b.setAttribute('aria-label', `${gate}번 말`);
      b.setAttribute('aria-pressed', String(selected));
      paintGate(b, gate);
      b.disabled = this.submitting;
      b.onclick = () => this.toggleGate(gate);
      row.append(b);
    }
    body.append(row);
    this.buildStake();
    body.append(this.buildQuote(snap));
  }

  private buildStake(): void {
    const body = this.body();
    const row = el('div', { class: 'd-stake' });
    row.append(el('span', { class: 'd-picklab', text: '구매 금액' }));
    const minus = el('button', { class: 'btn small', text: '−100', title: '100 줄이기' });
    minus.setAttribute('data-dk', 'stake-down');
    minus.disabled = this.submitting;
    minus.onclick = () => {
      const stake = Number(this.stakeText);
      this.stakeText = String(validStake(stake) ? Math.max(STAKE_MIN, stake - STAKE_STEP) : STAKE_MIN);
      this.render(true);
    };
    const input = el('input', {
      class: 'd-stakein',
      type: 'number',
      min: String(STAKE_MIN),
      step: String(STAKE_STEP),
      value: this.stakeText,
      title: '구매 금액 (100 단위)',
    }) as HTMLInputElement;
    input.setAttribute('data-dk', 'stake');
    input.disabled = this.submitting;
    input.oninput = () => {
      this.stakeText = input.value;
      if (this.snap) this.root?.querySelector('.d-quote')?.replaceWith(this.buildQuote(this.snap));
    };
    const plus = el('button', { class: 'btn small', text: '+100', title: '100 더하기' });
    plus.setAttribute('data-dk', 'stake-up');
    plus.disabled = this.submitting;
    plus.onclick = () => {
      const stake = Number(this.stakeText);
      this.stakeText = String(validStake(stake) && Number.isSafeInteger(stake + STAKE_STEP) ? stake + STAKE_STEP : STAKE_MIN);
      this.render(true);
    };
    row.append(minus, input, plus);
    row.append(el('span', { class: 'd-coin', text: '코인' }));
    body.append(row);
  }

  private buildQuote(snap: DerbySnapshot): HTMLElement {
    const box = el('div', { class: 'd-quote' });
    const kind = this.kind, stake = Number(this.stakeText);
    const { n, authEpoch: auth } = snap.head;
    const legs = kind === 'E' ? [...this.legs] : [...this.legs].sort((a, b) => a - b);
    const ready = legs.length === (KIND_NEEDS_PAIR[kind] ? 2 : 1);
    const quote = ready ? this.quote(kind, legs, validStake(stake) ? stake : STAKE_MIN) : null;
    const summary = el('div', { class: 'd-combo' });
    summary.setAttribute('aria-live', 'polite');
    const label = `${DERBY_KIND_LABEL[kind]} ${legs.map((g) => `${g}번`).join(kind === 'E' ? ' → ' : ' · ')}`;
    summary.append(el('strong', { class: 'd-cb', text: legs.length ? label : '선택한 말 없음' }));
    summary.append(el('span', { class: 'd-odd', text: quote ? `${quote.odds}배` : ready ? '배율 확인 불가' : '—' }));
    if (quote && validStake(stake)) summary.append(el('span', { class: 'd-est', text: `예상 적중금 ${ko(quote.est)}코인` }));
    box.append(summary);
    box.append(el('div', { class: 'd-total', text: `잔액 ${ko(snap.balance)} · 남은 한도 ${ko(snap.raceRemain)} · ${snap.ticketUsed}/${snap.ticketMax}장` }));
    const blocked = purchaseBlock(snap, stake, this.left(snap));
    if (ready && blocked) box.append(el('div', { class: 'd-warn', text: blocked }));
    const go = el('button', { class: 'btn primary d-go', text: this.submitting ? '사는 중…' : validStake(stake) ? `즉시 구매 · ${ko(stake)}코인` : '즉시 구매' });
    go.setAttribute('data-dk', 'submit');
    go.disabled = !quote || !!blocked || this.submitting;
    if (quote) go.onclick = () => {
      if (go.isConnected && !go.disabled) void this.submit({ kind, legs, stake, ...quote, n, auth });
    };
    box.append(go);
    return box;
  }

  private async submit(pick: DerbyPurchase): Promise<void> {
    if (!this.root || this.submitting) return;
    const snap = this.h.snapshot();
    this.snap = snap;
    const fresh = this.quote(pick.kind, pick.legs, pick.stake);
    const blocked = snap.head.n !== pick.n || snap.head.authEpoch !== pick.auth
      ? '경주나 발매 상태가 바뀌었어요. 다시 확인해 주세요.'
      : purchaseBlock(snap, pick.stake, this.left(snap)) || (
        fresh?.odds !== pick.odds || fresh?.est !== pick.est ? '배율이나 예상 적중금이 바뀌었어요. 다시 확인해 주세요.' : ''
      );
    if (blocked) {
      this.h.toast(blocked, true);
      this.render(true);
      return;
    }
    this.submitting = true;
    const id = `p${++this.purchaseSeq}`;
    const key = COMBO_KEY(pick.kind, pick.legs);
    this.render(true);
    try {
      const res = await this.h.submit({
        confirmId: id, draftId: id, where: this.h.where, seenN: pick.n, seenAuth: pick.auth,
        tickets: [{ lineId: id, key, kind: pick.kind, legs: [...pick.legs], stake: pick.stake }],
      });
      const line = Array.isArray(res) ? res.find((r) => r?.lineId === id && r.key === key) : undefined;
      if (line?.ok === true) {
        if (this.selectionRace === pick.n) this.legs = [];
        this.h.toast('마권 1장을 샀어요.');
      } else {
        this.h.toast(line?.error || '구매 결과를 확인하지 못했어요. 내 마권을 확인해 주세요.', true);
      }
    } catch (e) {
      this.h.toast(e instanceof Error && e.message ? e.message : '구매하지 못했어요. 내 마권을 확인해 주세요.', true);
    } finally {
      this.submitting = false;
      this.update(this.h.snapshot());
    }
  }

  private ticketLabel(t: DerbyTicketView): string {
    const legs = t.kind === 'E' ? t.legs.join('→') : [...t.legs].sort((a, b) => a - b).join('-');
    return `${DERBY_KIND_LABEL[t.kind]} ${legs} · ${ko(t.stake)}`;
  }

  private buildTickets(root: HTMLElement, snap: DerbySnapshot): void {
    void root;
    const body = this.body();
    body.append(el('div', { class: 'd-sec', text: '내 마권' }));
    if (!snap.tickets.length) {
      body.append(el('div', { class: 'd-hint', text: '산 마권이 아직 없어요. 적중금은 자동으로 들어온다.' }));
      return;
    }
    const list = el('div', { class: 'd-tickets' });
    for (const t of snap.tickets) {
      const row = el('div', { class: 'd-ticket ' + t.status });
      row.append(el('span', { class: 'd-tk', text: this.ticketLabel(t) }));
      const st =
        t.status === 'won'
          ? `적중 +${ko(t.payout)}`
          : t.status === 'lost'
            ? '낙첨'
            : t.status === 'pending'
              ? '대기'
              : '발매됨';
      row.append(el('span', { class: 'd-tst', text: st }));
      if (t.note) row.append(el('span', { class: 'd-err', text: t.note }));
      list.append(row);
    }
    body.append(list);
  }

  private buildBoard(root: HTMLElement, snap: DerbySnapshot): void {
    void root;
    const body = this.body();
    if (snap.standings && snap.standings.length) {
      body.append(el('div', { class: 'd-sec', text: '확정 착순' }));
      body.append(el('div', { class: 'd-stand', text: snap.standings.map((g, i) => `${i + 1}착 ${g}번`).join(' · ') }));
    } else if (snap.head.status === 'settling') {
      body.append(el('div', { class: 'd-banner', text: snap.head.statusLabel || '결과 집계 중…' }));
    }
    // 배당판: 복승·쌍승·복연승 마번×마번 표 (호스트 숫자 그대로).
    const gridKinds: DerbyBetKind[] = ['Q', 'E', 'R'];
    const hasGrid = gridKinds.some((k) => snap.odds[k] && Object.keys(snap.odds[k]!).length > 0);
    if (!hasGrid) return;
    body.append(el('div', { class: 'd-sec', text: '배당판' }));
    for (const k of gridKinds) {
      const grid = snap.odds[k];
      if (!grid || !Object.keys(grid).length) continue;
      const wrap = el('div', { class: 'd-gridwrap' });
      wrap.append(el('div', { class: 'd-gridlab', text: DERBY_KIND_LABEL[k] }));
      const tab = el('table', { class: 'd-grid' });
      const head = el('tr', {});
      head.append(el('th', { text: '' }));
      for (let c = 1; c <= 8; c++) head.append(el('th', { text: String(c) }));
      tab.append(head);
      for (let r = 1; r <= 8; r++) {
        const tr = el('tr', {});
        tr.append(el('th', { text: String(r) }));
        for (let c = 1; c <= 8; c++) {
          const td = el('td', {});
          if (r === c) {
            td.textContent = '–';
          } else {
            // 키는 COMBO_KEY 정규형. 옛 `r>c`식(접두사 없음)도 읽는다.
            const key = COMBO_KEY(k, [r, c]);
            const cell = grid[key] ?? grid[key.replace(/^[QER]:/, '')];
            td.textContent = cell ? String(cell.odds) : '–';
            td.title = cell ? `풀 ${ko(cell.pool)}` : '';
          }
          tr.append(td);
        }
        tab.append(tr);
      }
      wrap.append(tab);
      body.append(wrap);
    }
  }
}

// ---- 타입 재노출: 호스트가 derbyshow를 직접 들여오지 않아도 렌더 상태를 싣게 ----
export type { DerbyShowInput, DerbyDistance, DerbyRunner, DerbyResult };
export { derbyCaption };
