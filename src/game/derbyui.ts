// 경마공원 마권 패널 (2026-11-23): 공원(`race-park`)과 분점(`casino` 방) 공용 구매 UI.
// 2026-11-25: 한 화면에 전부 늘어놓던 것을 탭 넷(구매 · 출마표 · 배당 · 내 마권)으로 나누고, PC 에서는 제목 줄을 끌어 옮긴다 (저장소 주인 요청. 아래 "탭" 머리말)
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

// ---- 탭 (2026-11-25, 저장소 주인 요청: 한 화면에 전부 담겨 조잡했고 폰에서는 길게 스크롤해야 했다) ----
// 구매: 승식·마번·금액·즉시 구매 / 출마표: 말 여덟 마리의 정보 / 배당: 두 마리 승식의 배당표 / 내 마권: 산 마권과 결과.
// 탭 하나의 내용은 폰(402×714)에서도 스크롤 없이 한 화면에 든다 (derbyui.css 머리말의 높이 계산)
export type DerbyTab = 'buy' | 'card' | 'odds' | 'mine';
export const DERBY_TABS: readonly DerbyTab[] = ['buy', 'card', 'odds', 'mine'];
const TAB_LABEL: Record<DerbyTab, string> = { buy: '구매', card: '출마표', odds: '배당', mine: '내 마권' };
const GRID_KINDS: readonly DerbyBetKind[] = ['Q', 'E', 'R']; // 배당 탭의 표: 두 마리 승식 (단승·연승 배당은 출마표와 마번 단추에 있다)
// 승식 한 줄 설명 (구매 탭. 적중 판정은 shared/derby/tickets.ts ticketWins)
export const DERBY_KIND_HELP: Record<DerbyBetKind, string> = {
  W: '1등 할 말 한 마리를 맞혀요.',
  P: '3등 안에 들 말 한 마리를 맞혀요.',
  Q: '1·2등 두 마리를 맞혀요. 순서는 상관없어요.',
  E: '1등과 2등을 순서대로 맞혀요.',
  R: '3등 안에 들 두 마리를 맞혀요. 순서는 상관없어요.',
};
const NOT_SELLING = '지금은 발매 중이 아니에요.';
const STAKE_CHIPS: ReadonlyArray<readonly [number, string]> = [[100, '100'], [500, '500'], [1000, '1천'], [5000, '5천'], [10000, '1만']];

// ---- PC: 제목 줄을 끌어 옮기기 ----
const PHONE_QUERY = '(max-width: 760px)'; // derbyui.css 의 폰 배치와 같은 기준. 이 너비에서는 자리를 CSS 가 정한다 (끌지 않는다)
export const DERBY_DRAG_TOP = 48;  // 위쪽 한계: 위쪽 버튼 줄 아래 (CSS 의 처음 자리 top 과 같다. 창이 버튼 줄보다 앞에 그려져서 그 위로 가면 버튼을 가린다)
export const DERBY_DRAG_KEEP = 56; // 아래쪽 한계: 제목 줄(두 줄)은 화면 안에 남는다 (다시 잡아 옮길 수 있게)
// 끌어 옮긴 자리를 화면 안에 가둔다. x·y = 창의 왼쪽 위 (부모 안의 px), w = 창 너비, pw·ph = 부모(게임 화면) 크기
export function derbyClampPos(x: number, y: number, w: number, pw: number, ph: number): { x: number; y: number } {
  return {
    x: Math.round(Math.max(0, Math.min(x, pw - w))),
    y: Math.round(Math.max(DERBY_DRAG_TOP, Math.min(y, ph - DERBY_DRAG_KEEP))),
  };
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
  private tab: DerbyTab = 'buy';
  private kind: DerbyBetKind = 'W';
  private gridKind: DerbyBetKind = 'Q'; // 배당 탭에서 보는 승식
  private legs: number[] = [];
  private selectionRace: number | null = null;
  private stakeText = String(STAKE_MIN);
  private detailGate = 0; // 출마표에서 누른 말 (0이면 없음)
  private collapsed = false;
  private purchaseSeq = 0;
  private submitting = false;
  // PC 에서 끌어 옮긴 자리 (게임 화면 안의 px). 창을 닫았다 열어도 이번 접속 동안은 그 자리이고, 새로고침하면 처음 자리다 (유튜브 창처럼 저장하지 않는다)
  private pos: { x: number; y: number } | null = null;
  private drag: { id: number; dx: number; dy: number } | null = null;
  private seenW = 0;
  private seenH = 0;

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
    this.bindDrag(root);
    this.snap = this.h.snapshot();
    if (opts?.prefillGate) this.prefill(opts.prefillGate);
    this.lastV = -1;
    this.off = this.h.listen(() => {
      this.snap = this.h.snapshot();
      this.render(true);
    });
    this.render(true);
    this.place();
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
    this.bodyEl = null;
    this.drag = null;
    document.body.classList.remove('in-derby');
  }

  /** 호스트가 스냅샷을 직접 밀어줄 때 쓴다 (listen과 같은 효과). */
  update(snap: DerbySnapshot): void {
    this.snap = snap;
    this.render(true);
  }

  /** 말 하나를 골라 둔 채로 연다 (구매 탭). 구매는 버튼을 눌러야 한다. */
  prefill(gate: number): void {
    if (this.submitting || !this.snap || !Number.isInteger(gate) || gate < 1 || gate > 8) return;
    this.selectionRace = this.snap.head.n;
    this.legs = [gate];
    this.tab = 'buy';
    this.render(true);
  }

  // ---- PC: 제목 줄을 끌어 창을 옮긴다 (2026-11-25, 저장소 주인 요청) ----
  // 듣는 곳은 창 자신이다: 제목 줄은 다시 그릴 때마다 새로 만들어져서, 거기에 걸면 끄는 중에 스냅샷이 바뀌는 순간 끊긴다.
  // 창·문서(window·document)에는 걸지 않는다 (포인터를 창이 붙잡아 둔다. 창이 사라지면 리스너도 같이 사라진다)
  private movable(): boolean {
    return typeof matchMedia === 'function' && !matchMedia(PHONE_QUERY).matches;
  }
  private parentBox(): { left: number; top: number; width: number; height: number } {
    const p = this.root?.parentElement;
    return p ? p.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }
  private bindDrag(root: HTMLElement): void {
    root.addEventListener('pointerdown', (e) => {
      if (!this.movable() || e.button !== 0) return;
      const t = e.target instanceof Element ? e.target : null;
      if (!t || !t.closest('.d-head') || t.closest('button, input, a')) return; // 제목 줄의 빈 곳만 (단추는 단추대로)
      const box = root.getBoundingClientRect(), par = this.parentBox();
      this.drag = { id: e.pointerId, dx: e.clientX - box.left, dy: e.clientY - box.top };
      this.pos = { x: box.left - par.left, y: box.top - par.top };
      try { root.setPointerCapture(e.pointerId); } catch { /* 붙잡지 못해도 창 위에서는 끌린다 */ }
      root.classList.add('dragging');
      e.preventDefault(); // 끄는 동안 글자가 선택되지 않게
    });
    root.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      const par = this.parentBox();
      this.pos = { x: e.clientX - d.dx - par.left, y: e.clientY - d.dy - par.top };
      this.place();
    });
    const end = (e: PointerEvent): void => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.drag = null;
      root.classList.remove('dragging');
      try { root.releasePointerCapture(e.pointerId); } catch { /* 이미 풀렸다 */ }
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
  }
  // 끌어 옮긴 자리를 창에 입힌다. 폰 너비에서는 자리를 CSS 가 정하므로 입힌 것을 걷는다 (창 크기가 바뀌면 tick 이 다시 부른다)
  private place(): void {
    const root = this.root;
    if (!root) return;
    this.seenW = window.innerWidth;
    this.seenH = window.innerHeight;
    const movable = this.movable();
    root.classList.toggle('movable', movable);
    if (!movable || !this.pos) {
      root.style.left = root.style.top = root.style.right = root.style.maxHeight = '';
      return;
    }
    const par = this.parentBox();
    this.pos = derbyClampPos(this.pos.x, this.pos.y, root.offsetWidth, par.width, par.height);
    root.style.left = `${this.pos.x}px`;
    root.style.top = `${this.pos.y}px`;
    root.style.right = 'auto';
    root.style.maxHeight = `${Math.max(160, Math.round(par.height - this.pos.y - 8))}px`; // 아래로 내려도 창의 아래쪽이 화면 밖으로 나가지 않게 (넘치면 안에서 스크롤)
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
    if (window.innerWidth !== this.seenW || window.innerHeight !== this.seenH) this.place(); // 창 크기가 바뀌었다: 자리를 다시 가둔다
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
    this.mini = null;
    this.buildHead(root, snap);
    if (!this.collapsed) {
      // 제목 줄 · (휴장 안내) · (분점 중계) · 탭 줄은 늘 보이고, 그 아래 한 칸에 고른 탭의 내용만 그린다
      this.buildNotice(root, snap);
      this.buildMini(root, snap);
      this.buildTabBar(root, snap);
      const body = el('div', { class: `d-body t-${this.tab}` });
      body.setAttribute('data-d', 'body');
      root.append(body);
      this.bodyEl = body;
      if (this.tab === 'card') this.buildCard(snap);
      else if (this.tab === 'odds') this.buildOdds(snap);
      else if (this.tab === 'mine') this.buildMine(snap);
      else this.buildBuy(snap);
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
    // 경주 고르기: 예정표의 앞뒤 경주로 넘긴다 (전에는 시각 단추를 늘어놓아 두 줄을 차지했다)
    const race = el('span', { class: 'd-race' });
    const list = [...snap.schedule].sort((a, b) => a.n - b.n);
    const at = list.findIndex((s) => s.n === snap.head.n);
    const step = (dir: -1 | 1): HTMLElement => {
      const to = at < 0 ? undefined : list[at + dir];
      const b = el('button', { class: 'd-step', text: dir < 0 ? '‹' : '›', title: to ? `${to.timeLabel || `${to.n}R`} 경주 보기` : dir < 0 ? '앞 경주가 없어요' : '다음 경주가 없어요' });
      b.setAttribute('data-dk', dir < 0 ? 'race-prev' : 'race-next');
      b.setAttribute('aria-label', dir < 0 ? '앞 경주' : '다음 경주');
      b.disabled = !to || this.submitting;
      if (to) {
        const n = to.n;
        b.onclick = () => {
          try {
            this.h.selectRace(n);
          } catch (e) {
            this.h.toast((e as Error).message || '경주를 고르지 못했어요.', true);
          }
        };
      }
      return b;
    };
    const label = el('span', { class: 'd-rlab', text: snap.head.label || `제${snap.head.n}경주` });
    if (list.length > 1) race.append(step(-1), label, step(1));
    else race.append(label);
    head.append(race);
    const c = el('span', { class: 'd-count', text: '' });
    c.setAttribute('data-d', 'count');
    head.append(c);
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
    this.bodyEl = null;
  }

  private bodyEl: HTMLElement | null = null;
  private body(): HTMLElement {
    return this.bodyEl ?? this.root!;
  }

  // 휴장·불러오는 중 한 줄 (있을 때만)
  private buildNotice(root: HTMLElement, snap: DerbySnapshot): void {
    if (snap.closed) root.append(el('div', { class: 'd-banner', text: '휴장 중입니다. 공원 산책은 그대로 할 수 있어요.' }));
    else if (!snap.schedule.length && !snap.card.length) root.append(el('div', { class: 'd-banner', text: '출마표를 불러오는 중…' }));
  }

  private buildMini(root: HTMLElement, snap: DerbySnapshot): void {
    if (this.h.where !== 'branch') return;
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
    root.append(box);
  }

  private buildTabBar(root: HTMLElement, snap: DerbySnapshot): void {
    const bar = el('div', { class: 'd-tabbar' });
    const won = snap.tickets.some((t) => t.status === 'won');
    for (const t of DERBY_TABS) {
      const on = this.tab === t;
      const b = el('button', { class: 'd-tab' + (on ? ' on' : '') + (t === 'mine' && won ? ' won' : ''), text: TAB_LABEL[t] });
      b.setAttribute('data-dk', `tab-${t}`);
      b.setAttribute('aria-pressed', String(on));
      if (t === 'mine' && snap.tickets.length) b.append(el('span', { class: 'd-badge', text: String(snap.tickets.length) }));
      b.onclick = () => {
        if (this.tab === t) return;
        this.tab = t;
        this.render(true);
      };
      bar.append(b);
    }
    root.append(bar);
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

  // 출마표·배당 탭에서 골라 구매 탭으로 넘어간다
  private pickGate(gate: number): void {
    if (this.submitting) return;
    this.tab = 'buy';
    if (this.isGateOn(gate)) this.render(true);
    else this.toggleGate(gate);
  }
  private pickCombo(kind: DerbyBetKind, legs: number[]): void {
    if (this.submitting || !this.snap) return;
    this.kind = kind;
    this.legs = [...legs];
    this.selectionRace = this.snap.head.n;
    this.tab = 'buy';
    this.render(true);
  }

  // 마번 단추 아래의 작은 배당: 단승·연승은 그 말의 배당, 두 마리 승식은 먼저 고른 말과 짝지었을 때의 배당 (아직 안 골랐으면 비운다)
  private chipOdds(snap: DerbySnapshot, h: DerbyCardHorse): string {
    if (this.kind === 'W') return String(h.winOdds);
    if (this.kind === 'P') return String(h.placeOdds);
    const first = this.legs[0];
    if (!first) return '';
    if (first === h.gate) return this.kind === 'E' ? '1착' : '';
    const cell = snap.odds[this.kind]?.[COMBO_KEY(this.kind, [first, h.gate])];
    return cell ? String(cell.odds) : '';
  }

  // ---- 탭: 구매 ----
  private buildBuy(snap: DerbySnapshot): void {
    const body = this.body();
    const kinds = el('div', { class: 'd-kinds', title: '승식' });
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
      kinds.append(b);
    }
    body.append(kinds);
    body.append(el('div', { class: 'd-hint', text: DERBY_KIND_HELP[this.kind] }));
    if (!snap.card.length) body.append(el('div', { class: 'd-banner', text: '출마표가 아직 없어요. 잠시 뒤에 다시 열어 주세요.' }));
    const row = el('div', { class: 'd-pick' });
    for (const h of [...snap.card].sort((a, b) => a.gate - b.gate)) {
      const selected = this.isGateOn(h.gate);
      const b = el('button', { class: 'd-num' + (selected ? ' on' : ''), title: `${h.gate}번 ${h.name}` });
      b.append(el('b', { text: String(h.gate) }), el('span', { class: 'd-no', text: this.chipOdds(snap, h) }));
      b.setAttribute('data-dk', `pick-${h.gate}`);
      b.setAttribute('aria-label', `${h.gate}번 말`);
      b.setAttribute('aria-pressed', String(selected));
      paintGate(b, h.gate);
      b.disabled = this.submitting;
      b.onclick = () => this.toggleGate(h.gate);
      row.append(b);
    }
    body.append(row);
    this.buildStake();
    body.append(this.buildQuote(snap));
  }

  private buildStake(): void {
    const body = this.body();
    const row = el('div', { class: 'd-stake' });
    row.append(el('span', { class: 'd-picklab', text: '금액' }));
    const input = el('input', {
      class: 'd-stakein',
      type: 'number',
      inputmode: 'numeric',
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
    row.append(input);
    // 자주 쓰는 금액: 누르면 그 금액이 된다 (다른 금액은 칸에 적는다)
    for (const [amount, label] of STAKE_CHIPS) {
      const b = el('button', { class: 'btn small' + (Number(this.stakeText) === amount ? ' on' : ''), text: label, title: `${ko(amount)}코인` });
      b.setAttribute('data-dk', `stake-${amount}`);
      b.disabled = this.submitting;
      b.onclick = () => {
        this.stakeText = String(amount);
        this.render(true);
      };
      row.append(b);
    }
    body.append(row);
  }

  private buildQuote(snap: DerbySnapshot): HTMLElement {
    const box = el('div', { class: 'd-quote' });
    const kind = this.kind, stake = Number(this.stakeText);
    const { n, authEpoch: auth } = snap.head;
    const legs = kind === 'E' ? [...this.legs] : [...this.legs].sort((a, b) => a - b);
    const pair = KIND_NEEDS_PAIR[kind];
    const ready = legs.length === (pair ? 2 : 1);
    const quote = ready ? this.quote(kind, legs, validStake(stake) ? stake : STAKE_MIN) : null;
    const summary = el('div', { class: 'd-combo' });
    summary.setAttribute('aria-live', 'polite');
    const label = `${DERBY_KIND_LABEL[kind]} ${legs.map((g) => `${g}번`).join(kind === 'E' ? ' → ' : ' · ')}`;
    summary.append(el('strong', { class: 'd-cb', text: legs.length ? label : '선택한 말 없음' }));
    summary.append(el('span', { class: 'd-odd', text: quote ? `${quote.odds}배` : ready ? '배율 확인 불가' : '—' }));
    if (quote && validStake(stake)) summary.append(el('span', { class: 'd-est', text: `예상 적중금 ${ko(quote.est)}코인` }));
    box.append(summary);
    box.append(el('div', { class: 'd-total', text: `잔액 ${ko(snap.balance)} · 남은 한도 ${ko(snap.raceRemain)} · ${snap.ticketUsed}/${snap.ticketMax}장` }));
    // 단추가 지금 할 일을 말한다: 발매 중이 아니면 그 말, 아직 덜 골랐으면 고르는 법, 살 수 없으면 까닭, 살 수 있으면 금액
    const blocked = purchaseBlock(snap, stake, this.left(snap));
    const hint = pair
      ? legs.length === 1
        ? kind === 'E' ? '2착 말을 고르세요.' : '한 마리 더 고르세요.'
        : kind === 'E' ? '1착, 2착 순서로 고르세요.' : '말 두 마리를 고르세요.'
      : '말 한 마리를 고르세요.';
    const text = this.submitting ? '사는 중…'
      : blocked === NOT_SELLING ? NOT_SELLING
        : !ready ? hint
          : !quote ? '배율을 확인하지 못했어요.'
            : blocked || `즉시 구매 · ${ko(stake)}코인`;
    const go = el('button', { class: 'btn primary d-go', text });
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

  // ---- 탭: 출마표 ----
  private buildCard(snap: DerbySnapshot): void {
    const body = this.body();
    if (!snap.card.length) {
      body.append(el('div', { class: 'd-banner', text: '출마표가 아직 없어요. 잠시 뒤에 다시 열어 주세요.' }));
      return;
    }
    const list = el('div', { class: 'd-card' });
    for (const h of [...snap.card].sort((a, b) => a.gate - b.gate)) {
      const open = this.detailGate === h.gate;
      // 한 줄 전체가 단추다 (누르면 아래에 나머지 정보). 마명·기수는 외부 텍스트이므로 textContent 로만 넣는다 (el text 가 그렇게 한다)
      const row = el('button', { class: 'd-horse' + (open ? ' open' : '') + (this.isGateOn(h.gate) ? ' picked' : ''), title: describeHorse(h) });
      row.setAttribute('data-dk', `info-${h.gate}`);
      row.setAttribute('aria-pressed', String(open));
      const chip = el('span', { class: 'd-gate', text: String(h.gate) });
      paintGate(chip, h.gate);
      row.append(chip);
      row.append(el('span', { class: 'd-nm', text: `${h.name}` }));
      row.append(el('span', { class: 'd-sx', text: horseTag(h) }));
      row.append(el('span', { class: 'd-jk', text: h.jockey }));
      row.append(el('span', { class: 'd-odds', text: `단 ${h.winOdds} · 연 ${h.placeOdds}` }));
      row.onclick = () => {
        this.detailGate = open ? 0 : h.gate;
        this.render(true);
      };
      list.append(row);
    }
    body.append(list);
    // 누른 말의 나머지 정보와 고르기 단추 (자리는 늘 잡아 둔다: 누를 때마다 창 높이가 바뀌지 않게)
    const more = el('div', { class: 'd-detail' });
    const h = snap.card.find((x) => x.gate === this.detailGate);
    if (h) {
      more.append(el('span', { class: 'd-dt', text: `${h.gate}번 · 레이팅 ${ko(h.rating)} · 매출 ${ko(h.sales)} · 최근 ${h.last5}` }));
      const pick = el('button', { class: 'btn small', text: '고르기', title: `${h.gate}번을 골라 구매 탭으로` }); // 짧게: 매출이 여섯 자리면 "이 말 고르기"로는 옆의 글이 두 줄로 넘어갔다
      pick.setAttribute('data-dk', 'card-pick');
      pick.disabled = this.submitting;
      pick.onclick = () => this.pickGate(h.gate);
      more.append(pick);
    } else {
      more.append(el('span', { class: 'd-dt', text: '말을 누르면 레이팅과 매출이 보여요.' }));
    }
    body.append(more);
  }

  // ---- 탭: 배당 (복승·쌍승·복연승 마번×마번 표. 호스트 숫자 그대로) ----
  private buildOdds(snap: DerbySnapshot): void {
    const body = this.body();
    const k = GRID_KINDS.includes(this.gridKind) ? this.gridKind : 'Q';
    const sub = el('div', { class: 'd-kinds', title: '승식' });
    for (const g of GRID_KINDS) {
      const b = el('button', { class: 'btn small' + (k === g ? ' on' : ''), text: DERBY_KIND_LABEL[g] });
      b.setAttribute('data-dk', `grid-${g}`);
      b.setAttribute('aria-pressed', String(k === g));
      b.onclick = () => {
        if (this.gridKind === g) return;
        this.gridKind = g;
        this.render(true);
      };
      sub.append(b);
    }
    body.append(sub);
    body.append(el('div', { class: 'd-hint', text: k === 'E' ? '세로가 1착, 가로가 2착이에요. 칸을 누르면 그 조합을 골라요.' : '칸을 누르면 그 두 마리를 골라요. 순서는 상관없어요.' }));
    const grid = snap.odds[k];
    if (!grid || !Object.keys(grid).length) {
      body.append(el('div', { class: 'd-banner', text: '배당이 아직 없어요.' }));
      return;
    }
    const sel = this.kind === k && this.legs.length === 2 ? COMBO_KEY(k, this.legs) : '';
    const tab = el('table', { class: 'd-grid' });
    const head = el('tr', {});
    head.append(el('th', { class: 'd-corner', text: k === 'E' ? '1＼2' : '', title: k === 'E' ? '세로 1착 · 가로 2착' : '' })); // 짧게: "1착＼2착"은 PC 의 칸 너비(35px)에서 잘렸다
    const gateHead = (g: number): HTMLElement => {
      const th = el('th', { text: String(g) });
      paintGate(th, g);
      return th;
    };
    for (let c = 1; c <= 8; c++) head.append(gateHead(c));
    tab.append(head);
    for (let r = 1; r <= 8; r++) {
      const tr = el('tr', {});
      tr.append(gateHead(r));
      for (let c = 1; c <= 8; c++) {
        const td = el('td', {});
        // 순서가 없는 승식은 같은 조합이 두 번 나오므로 오른쪽 위 절반만 적는다
        if (r === c || (k !== 'E' && r > c)) {
          td.className = 'none';
        } else {
          // 키는 COMBO_KEY 정규형. 옛 `r>c`식(접두사 없음)도 읽는다.
          const key = COMBO_KEY(k, [r, c]);
          const cell = grid[key] ?? grid[key.replace(/^[QER]:/, '')];
          td.textContent = cell ? String(cell.odds) : '–';
          if (cell) {
            td.className = 'pick' + (key === sel ? ' sel' : '');
            td.title = `${r}번${k === 'E' ? ' → ' : ' · '}${c}번 · 풀 ${ko(cell.pool)}`;
            td.onclick = () => this.pickCombo(k, [r, c]);
          } else {
            td.className = 'none';
          }
        }
        tr.append(td);
      }
      tab.append(tr);
    }
    body.append(tab);
  }

  // ---- 탭: 내 마권 (결과 + 산 마권) ----
  private ticketLabel(t: DerbyTicketView): string {
    const legs = t.kind === 'E' ? t.legs.join('→') : [...t.legs].sort((a, b) => a - b).join('-');
    return `${DERBY_KIND_LABEL[t.kind]} ${legs} · ${ko(t.stake)}`;
  }

  private buildMine(snap: DerbySnapshot): void {
    const body = this.body();
    const res = el('div', { class: 'd-result' });
    if (snap.standings && snap.standings.length) {
      res.append(el('span', { class: 'd-rl', text: '결과' }));
      snap.standings.forEach((g, i) => {
        const place = el('span', { class: 'd-place', text: `${i + 1}착` });
        const chip = el('span', { class: 'd-chip', text: String(g) });
        paintGate(chip, g);
        place.append(chip);
        res.append(place);
      });
    } else {
      const s = snap.head.status;
      res.append(el('span', { class: 'd-dt', text: s === 'settling' ? snap.head.statusLabel || '결과 집계 중…' : s === 'selling' || s === 'closed' ? '결과는 경주가 끝나면 여기에 나와요.' : '결과가 아직 없어요.' }));
    }
    body.append(res);
    if (!snap.tickets.length) {
      body.append(el('div', { class: 'd-hint', text: '이 경주에 산 마권이 없어요. 적중금은 경주가 끝나면 자동으로 들어와요.' }));
      return;
    }
    const list = el('div', { class: 'd-tickets' });
    let won = 0;
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
      if (t.status === 'won') won += t.payout;
      row.append(el('span', { class: 'd-tst', text: st }));
      if (t.note) row.append(el('span', { class: 'd-err', text: t.note }));
      list.append(row);
    }
    body.append(list);
    body.append(el('div', { class: 'd-total', text: `산 금액 ${ko(snap.spent)} · ${snap.ticketUsed}/${snap.ticketMax}장${won > 0 ? ` · 적중금 +${ko(won)}` : ''}` }));
  }
}

// ---- 타입 재노출: 호스트가 derbyshow를 직접 들여오지 않아도 렌더 상태를 싣게 ----
export type { DerbyShowInput, DerbyDistance, DerbyRunner, DerbyResult };
export { derbyCaption };
