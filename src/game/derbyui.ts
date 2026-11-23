// 경마공원 마권 패널 (2026-11-23): 공원(`race-park`)과 분점(`casino` 방) 공용 구매 UI.
// SPEC "경마공원 > 마권 구매"가 상품 계약이다. 이 파일은 순수 뷰+선택 상태만 들고,
// 숫자·판정·지갑·Firebase는 전부 호스트(컨트롤러)가 준다. 계산을 복제하지 않는다.
//
// ---- 호스트 어댑터 최소 배선 (컨트롤러가 이 모양으로 감싼다) ----
//   import { DerbyPanel, type DerbyHost, type DerbySnapshot } from './game/derbyui';
//   const panel = new DerbyPanel(host);
//   panel.show({ prefillGate: 3 }); // 예시장 말 카드의 "이 말로 마권 담기"에서 옴. 없으면 전체 열기
//   // host.snapshot()/listen(cb): 승인·결과·내 마권·잔액이 바뀌면 새 DerbySnapshot을 준다.
//   //   패널은 update(snap)으로 다시 그린다. 렌더 상태(n/ms/distance/runners/result)는
//   //   스냅샷 안 show에 그대로 싣는다. 분점 미니 중계는 drawDerbyMini로 그린다.
//   //   card 8두에는 성별(sex)·나이(age)를 반드시 싣는다 (SPEC 출마표).
//   //   schedule에는 KST 표시 문자열(timeLabel, 예: "19:00")·상태를 싣는다. 휴장 중에도
//   //   예정·다음 경주를 보여주므로 비워 두지 않는다. 시간대 계산은 패널이 하지 않는다.
//   // host.selectRace(n): 예정표에서 경주를 고르면 그 경주의 스냅샷을 민다.
//   //   보는 경주가 바뀌어도 바구니의 구매 신원(raceN)은 바뀌지 않는다.
//   // host.quote(kind, combos, stakePerCombo): 줄별 고정 배당·예상액. 키는 COMBO_KEY 정규형.
//   // host.submit(req): tickets[]를 줄 단위로 판정한다. 결과는 lineId로만 맞춘다.
//   //   req = { confirmId, draftId, where, seenN, seenAuth, tickets[] }.
//   //   tickets[] = [{ lineId, key, kind, legs, stake }]. 배치 단위 kind·금액은 보내지
//   //   않는다 (바구니에 여러 승식·금액이 섞일 수 있어 배치 값이 거짓이 된다).
//   //   res[] = [{ lineId, key, ok, ticketKey, error }]. 보낸 줄이 아닌 lineId·빠진 줄은
//   //   수락이 아니다. 거절 판단은 호스트·규칙이 한다.
//   // 분점 호스트만 leaveBranch()를 준다. 공원은 맵이 보이는 옆 판 + 접기 버튼이다.
//
// ---- 구매 확정 규칙 (리뷰 확정안) ----
//   선택(승식·방식·마번·금액)은 미리보기(견적)만 만든다. 바구니 줄(DerbyBasketLine)은
//   [구매 목록에 담기]로만 들어간다. 같은 조합을 다시 담는 것은 일부러 또 사는
//   것이고 새 행 식별자를 받는다: 수락·삭제된 줄이 선택 편집으로 부활하지 않고,
//   실패 줄의 사유도 건드리지 않는다. 줄마다 담은 때의 승식·금액·견적을 가진다.
//   확인창을 띄우기 직전에 확정안(DerbyConfirmDraft)을 얼리고(Object.freeze),
//   호출 전(확인 전·확인 후)과 호출 후의 검증을 이 복사본으로만 한다. 확인은 같은 열림
//   세대(openGen)에서만 호출로 이어진다: 그 사이 닫혔다 다시 열리면 버린다.
//   남은 시간 0·알 수 없는 마감·견적 없음·숫자 아님·오래된 승인·바뀐 경주·견적·
//   잔액·한도·장수 중 하나라도 어긋나면 보내지 않고, 현재 상태에서 구매안을
//   재구성하지 않는다. 보내는 동안 같은 줄의 다른 구매는 막는다(pending-lines).
//   호출이 끝나면 같은 바구니 식별자에 아직 남은 줄 중 호출 때 보낸 줄에만
//   명시적 수락·실패를 반영한다: 닫혔다 다시 열려도 수락은 버리지 않고, 실패 사유는
//   새 명시 결과로만 덮으며 응답에 없는 줄의 이전 사유는 지우지 않는다. 응답이
//   없거나(예외·빈 배열) 바구니가 바뀌었으면 손대지 않는다 (빠짐 ≠ 수락).
//   수락된 줄은 사실이므로 반영한다 (빼지 않으면 중복 구매 위험). 바구니 취소는
//   명시 버튼으로만 한다.
//
// 위치·레이아웃 참고는 casinoui.ts(#casino 옆 판, 모바일 덮개)지만, 코드는 공유하지 않고
// 이 판 전용 id·클래스(#derby .d-*)와 src/game/derbyui.css만 쓴다. derbyshow.ts는
// 분점 미니 중계(drawDerbyMini)와 타입만 쓰고, 그리기 상태는 호스트가 쥔다.
// world.ts·admin·렌더러·shared 계산·규칙·지갑은 이 파일 밖이다.
import './derbyui.css';
import { el } from '../shared/util';
import { confirmModal } from './ui';
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
export type DerbyTicketStatus = 'pending' | 'sold' | 'won' | 'lost' | 'void';
export interface DerbyTicketView {
  key: string; // "{n}_{00~99}" 마권 키
  kind: DerbyBetKind;
  legs: number[]; // 마번들
  stake: number; // 조합당 금액
  status: DerbyTicketStatus; // sold: 발매됨 / won: 적중·정산됨 / lost: 낙첨 / pending: 대기 / void: 무효·환불
  payout: number; // 적중 정산액 (won일 때만 >0. 호스트 숫자)
  note: string; // 실패·상태 안내 (외부 텍스트)
}
export interface DerbyRaceHead {
  n: number; // 경주 번호 (바구니·제출의 기준. 바뀌면 바구니 무효)
  distance: DerbyDistance;
  status: DerbyRaceStatus;
  statusLabel: string; // 전광판 문구 ("결과 집계 중" 등. 호스트 문구 그대로)
  sellable: boolean; // 지금 사도 되는가 (승인·하트비트·시간 판정은 호스트·규칙 몫)
  authEpoch: number; // 발매 승인 epoch. 제출 때 seenAuth로 같이 보내고, 바뀌면 버튼이 잠긴다
  closesInMs: number; // 마감까지 남은 시간 (표시용. 0 이하면 발매 불가)
  label: string; // "제7경주 1800m" 같은 머리말 (호스트 문구)
}
// 예정표 한 줄. timeLabel은 KST 표시 문자열(예: "19:00")을 호스트가 그대로 준다.
// 패널은 시간대 계산을 하지 않는다. 휴장 중에도 예정·다음 경주는 보여준다.
export interface DerbyScheduleItem { n: number; label: string; status: DerbyRaceStatus; timeLabel: string }
export interface DerbySnapshot {
  v: number; // 스냅샷 버전 (바뀔 때마다 다시 그림. 선택·바구니 상태는 유지)
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

// ---- 바구니·확정 (패널↔호스트 경계. DOM 없음. tests/derby-ui.test.mjs가 직접 본다) ----
// 바구니 줄 = 담은 한 장. lineId는 바구니 안에서 유일한 행 식별자
// (`${draftId}#${일련번호}`). 같은 조합을 일부러 여러 묶음으로 담아도 행이 다르다.
// key는 COMBO_KEY 정규 조합 식별, lineId는 행 식별이다.
// 줄마다 담은 때의 승식·금액을 함께 가진다 (바구니에 여러 승식·금액이 섞일 수 있다).
// error는 마지막 실패 사유 (''이면 없음. 응답이 없으면 지우지 않는다).
export interface DerbyBasketLine {
  lineId: string;
  key: string;
  kind: DerbyBetKind;
  legs: number[];
  stake: number;
  odds: number | null;
  est: number | null;
  error: string;
}
export interface DerbyBasketDraft {
  draftId: string; // 바구니 식별자 (패널이 `d1, d2, …`로 매긴다)
  rev: number; // 바구니 개정 번호 (줄이 바뀌면 +1. 늦은 응답 가드에 쓴다)
  raceN: number; // 담은 경주 번호 (이 바구니의 구매 신원. 바뀌면 새로 담는다)
  lines: DerbyBasketLine[];
}
// 확정 스냅샷: 확인창을 띄우기 직전에 얼린 구매안. Object.freeze되며,
// 호출 전·중·후 검증은 이 복사본으로만 하고 현재 상태에서 재구성하지 않는다.
export interface DerbyConfirmLine {
  lineId: string;
  key: string;
  kind: DerbyBetKind;
  legs: number[];
  stake: number;
  odds: number | null;
  est: number | null;
}
export interface DerbyConfirmDraft {
  confirmId: string; // 확정 식별자 (패널이 `c1, c2, …`로 매긴다)
  draftId: string;
  draftRev: number;
  openGen: number; // 확인을 뜬 열림 세대. 다른 세대에서는 호출하지 않는다
  where: DerbyWhere; // 구매한 장소 (공원/분점)
  raceN: number;
  authEpoch: number;
  lines: DerbyConfirmLine[];
  totalStake: number; // 줄별 금액 합 (얼린 값)
  capturedAtMs: number; // 얼린 시각 (호출 쪽이 Date.now()를 넣는다. 테스트는 고정값)
}
export type DerbyAbortReason =
  | 'empty' // 담긴 조합이 없다
  | 'race-changed' // 그 사이 경주가 바뀌었다
  | 'auth-changed' // 발매 승인이 바뀌었다
  | 'not-selling' // 발매 중이 아니다
  | 'not-sellable' // 승인·시간 판정에서 살 수 없다
  | 'no-time' // 남은 발매 시간이 0 이하이거나 알 수 없다
  | 'quote-changed' // 배당·예상액이 달라졌다
  | 'quote-unavailable' // 견적을 확인할 수 없다
  | 'quote-invalid' // 견적이 없거나 숫자가 아니다 (서명 불가)
  | 'insufficient-balance' // 잔액이 모자란다
  | 'over-allowance' // 경주 한도를 넘는다
  | 'no-slots' // 남은 장수가 모자란다
  | 'pending-lines' // 같은 줄의 다른 구매가 진행 중이다
  | 'lifetime-ended' // 확인을 뜬 열림 세대가 끝났다
  | 'superseded'; // 바구니가 바뀌어서 늦은 응답을 버린다

// ---- 액션: 패널 → 호스트 ----
// tickets가 정산 단위이다. 줄마다 승식·마번·금액을 싣는다. 배치 단위 kind·금액은
// 보내지 않는다 (바구니에 여러 승식·금액이 섞일 수 있어 배치 값은 거짓이 된다).
// confirmId·draftId는 호스트의 중복 판정·디버깅용이다.
export interface DerbySubmitTicket { lineId: string; key: string; kind: DerbyBetKind; legs: number[]; stake: number }
export interface DerbySubmitReq {
  confirmId: string;
  draftId: string;
  where: DerbyWhere;
  seenN: number; // 바구니를 담은 경주 번호
  seenAuth: number; // 그때 본 승인 epoch
  tickets: DerbySubmitTicket[]; // 살 줄들 (lineId+정규 키+승식+마번+금액)
}
// 결과는 lineId로만 바구니 줄과 맞춘다. lineId가 없거나 모르는 줄은 맞지 않은
// 것으로 둔다 (맞지 않음 ≠ 수락). key는 디버깅·표시용이다.
export interface DerbySubmitLine { lineId: string; key: string; ok: boolean; ticketKey: string; error: string }
export interface DerbyHost {
  where: DerbyWhere;
  snapshot(): DerbySnapshot;
  listen(cb: () => void): () => void; // 스냅샷이 바뀌면 cb. 반환값으로 해제
  quote(kind: DerbyBetKind, combos: number[][], stakePerCombo: number): DerbyQuoteLine[];
  submit(req: DerbySubmitReq): Promise<DerbySubmitLine[]>;
  selectRace(n: number): void; // 예정표에서 경주를 고른다. 호스트가 그 경주의 스냅샷을 민다
  toast(msg: string, err?: boolean): void;
  leaveBranch?(): Promise<void>; // 분점 전용 나가기. 공원은 없음
}

export type DerbySelMethod = 'single' | 'box' | 'anchor' | 'formation';
export const DERBY_METHOD_LABEL: Record<DerbySelMethod, string> = {
  single: '일반',
  box: '박스',
  anchor: '축',
  formation: '포메이션',
};

// 조합 정규 키. 승식·순서를 포함한 유일 식별이다 (단승 3번 "W:3", 쌍승 1→2 "E:1>2").
// 복승·복연승은 마번 오름차순으로 접는다 ("Q:3-5"와 "Q:5-3"은 같은 키).
// 호스트의 odds 표·quote·submit 응답도 이 키를 쓴다.
export const COMBO_KEY = (kind: DerbyBetKind, legs: number[]): string =>
  kind === 'E' ? `E:${legs.join('>')}` : `${kind}:${[...legs].sort((a, b) => a - b).join('-')}`;

// 선택 → 조합 전개. 같은 말 빼기, 복승·복연승 무순서 중복 제거는 여기서만 한다.
// 배당·적중 판정은 하지 않는다 (호스트·규칙 몫).
export function expandDerbySelection(
  kind: DerbyBetKind,
  method: DerbySelMethod,
  picked: ReadonlySet<number | string>,
  anchor: number | null,
  rowA: ReadonlySet<number>,
  rowB: ReadonlySet<number>,
  dirAB: boolean,
): number[][] {
  const gates = [...picked].filter((g): g is number => typeof g === 'number' && g >= 1 && g <= 8);
  if (method === 'single') {
    if (kind === 'W' || kind === 'P') return gates.map((g) => [g]);
    const out: number[][] = [];
    const seen = new Set<string>();
    for (const k of picked) {
      const legs = String(k).split('-').map(Number).filter((g) => g >= 1 && g <= 8);
      if (legs.length !== 2 || legs[0] === legs[1]) continue;
      const ck = COMBO_KEY(kind, legs);
      if (seen.has(ck)) continue;
      seen.add(ck);
      out.push(kind === 'E' ? legs : [...legs].sort((a, b) => a - b));
    }
    return out;
  }
  if (method === 'box') {
    if (kind === 'W' || kind === 'P') return gates.map((g) => [g]);
    const out: number[][] = [];
    if (kind === 'E') {
      for (const a of gates) for (const b of gates) if (a !== b) out.push([a, b]);
    } else {
      const s = [...gates].sort((x, y) => x - y);
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) out.push([s[i], s[j]]);
    }
    return out;
  }
  if (method === 'anchor') {
    if (anchor === null) return [];
    const ps = [...rowB].filter((g) => g !== anchor && g >= 1 && g <= 8);
    if (kind === 'W' || kind === 'P') return ps.length ? [[anchor]] : [];
    if (kind === 'E') {
      // 쌍승 축: dirAB면 축=1착(축>상대), 아니면 축=2착(상대>축)
      return ps.map((p) => (dirAB ? [anchor, p] : [p, anchor]));
    }
    return ps.map((p) => (anchor < p ? [anchor, p] : [p, anchor]));
  }
  // formation: 두 줄. 쌍승만 순서·방향이 있고(dirAB), 복승·복연승은 무순서로 접는다.
  const a = [...rowA].filter((g) => g >= 1 && g <= 8);
  const b = [...rowB].filter((g) => g >= 1 && g <= 8);
  const out: number[][] = [];
  const seen = new Set<string>();
  const push = (legs: number[]) => {
    const ck = COMBO_KEY(kind, legs);
    if (seen.has(ck)) return;
    seen.add(ck);
    out.push(legs);
  };
  if (kind === 'W' || kind === 'P') {
    for (const g of new Set([...a, ...b])) push([g]);
    return out;
  }
  if (kind === 'E') {
    const first = dirAB ? a : b;
    const second = dirAB ? b : a;
    for (const x of first) for (const y of second) if (x !== y) push([x, y]);
    return out;
  }
  for (const x of a) for (const y of b) {
    if (x === y) continue;
    push(x < y ? [x, y] : [y, x]);
  }
  return out;
}

export interface DerbyAppliedSubmit {
  draft: DerbyBasketDraft; // 수락된 줄만 빠진 새 바구니 (입력은 바꾸지 않는다)
  accepted: string[]; // 바구니에 있던 lineId 중 수락된 것
  failed: { lineId: string; key: string; error: string }[]; // 남은 줄 중 명시적 실패 (응답 없는 줄은 error ''로 남는다)
}

// 미리보기에서 고른 조합을 바구니에 덧붙인다. 항상 새 행 식별자를 매긴다:
// 같은 조합을 다시 담는 것은 일부러 또 사는 것이고, 수락·삭제된 줄이
// 선택 편집으로 부활하지 않으며 실패 줄도 건드리지 않는다. 입력 배열은 바꾸지 않는다.
export function appendBasketLines(
  prev: readonly DerbyBasketLine[],
  draftId: string,
  seqStart: number,
  additions: { key: string; kind: DerbyBetKind; legs: number[]; stake: number; odds: number | null; est: number | null }[],
): { lines: DerbyBasketLine[]; nextSeq: number } {
  let seq = seqStart;
  const lines = [...prev];
  for (const a of additions) {
    seq += 1;
    lines.push({
      lineId: `${draftId}#${seq}`,
      key: a.key,
      kind: a.kind,
      legs: [...a.legs],
      stake: a.stake,
      odds: a.odds,
      est: a.est,
      error: '',
    });
  }
  return { lines, nextSeq: seq };
}

// 확인창용 확정 스냅샷을 얼린다. 호출 전·중·후 검증은 이 복사본으로만 한다.
export function captureConfirmDraft(args: {
  confirmId: string;
  draft: DerbyBasketDraft;
  openGen: number;
  where: DerbyWhere;
  authEpoch: number;
  nowMs: number;
}): DerbyConfirmDraft {
  const lines = args.draft.lines.map((l) =>
    Object.freeze({
      lineId: l.lineId,
      key: l.key,
      kind: l.kind,
      legs: Object.freeze([...l.legs]) as number[],
      stake: l.stake,
      odds: l.odds,
      est: l.est,
    }),
  );
  const totalStake = args.draft.lines.reduce((sum, l) => sum + l.stake, 0);
  return Object.freeze({
    confirmId: args.confirmId,
    draftId: args.draft.draftId,
    draftRev: args.draft.rev,
    openGen: args.openGen,
    where: args.where,
    raceN: args.draft.raceN,
    authEpoch: args.authEpoch,
    lines: Object.freeze(lines) as unknown as DerbyConfirmLine[],
    totalStake,
    capturedAtMs: args.nowMs,
  }) as DerbyConfirmDraft;
}

// 확정안을 최신 스냅샷·견적과 대조한다. 하나라도 어긋나면 중단 사유를 돌려준다.
// 견적은 줄 식별자(lineId) 단위로 대조한다: 승식·금액이 다른 줄의 견적이 섞이지 않는다.
// 남은 시간 0·알 수 없는 마감·견적 없음·숫자 아님·오래된 스냅샷·잔액·한도·장수 중
// 하나라도 어긋나면 보내지 않고, 현재 상태에서 구매안을 재구성하지 않는다
// (호출 쪽이 이 복사본을 그대로 쓰거나 버린다).
export function verifyDraftForSubmit(
  confirm: DerbyConfirmDraft,
  snap: DerbySnapshot,
  fresh: ReadonlyMap<string, { odds: number | null; est: number | null }>,
): { ok: true } | { ok: false; reason: DerbyAbortReason } {
  if (!confirm.lines.length) return { ok: false, reason: 'empty' };
  if (snap.head.n !== confirm.raceN) return { ok: false, reason: 'race-changed' };
  if (snap.head.authEpoch !== confirm.authEpoch) return { ok: false, reason: 'auth-changed' };
  if (snap.head.status !== 'selling') return { ok: false, reason: 'not-selling' };
  if (!snap.head.sellable) return { ok: false, reason: 'not-sellable' };
  if (!Number.isFinite(snap.head.closesInMs) || snap.head.closesInMs <= 0) return { ok: false, reason: 'no-time' };
  for (const l of confirm.lines) {
    const q = fresh.get(l.lineId);
    if (!q || q.odds === null || q.est === null || !Number.isFinite(q.odds) || !Number.isFinite(q.est)) {
      return { ok: false, reason: 'quote-invalid' };
    }
    if (q.odds !== l.odds || q.est !== l.est) return { ok: false, reason: 'quote-changed' };
  }
  if (!Number.isFinite(snap.balance) || snap.balance < confirm.totalStake) {
    return { ok: false, reason: 'insufficient-balance' };
  }
  if (!Number.isFinite(snap.raceRemain) || confirm.totalStake > snap.raceRemain) {
    return { ok: false, reason: 'over-allowance' };
  }
  if (!Number.isFinite(snap.ticketMax) || !Number.isFinite(snap.ticketUsed)) {
    return { ok: false, reason: 'no-slots' };
  }
  if (confirm.lines.length > snap.ticketMax - snap.ticketUsed) return { ok: false, reason: 'no-slots' };
  return { ok: true };
}

// 확인창의 "예"를 호출로 이어도 되는지 본다. 같은 열림 세대·같은 장소의 같은 바구니이고,
// 확인창을 띄운 뒤 바구니 줄이 바뀌지 않았을 때(개정 번호 같음)만 true이다.
// 확인창을 보는 사이 줄을 넣거나 빼면 사용자가 본 금액과 보낼 줄이 달라지므로 버리고 다시 확인받는다.
// (호출 뒤 늦은 응답 반영은 이 검사를 쓰지 않는다: 바구니 식별자+줄 식별자로만 맞춘다.)
export function isConfirmCurrent(
  confirm: DerbyConfirmDraft,
  live: { open: boolean; openGen: number; where: DerbyWhere; draftId: string | null; draftRev: number | null },
): boolean {
  return (
    live.open &&
    live.openGen === confirm.openGen &&
    live.where === confirm.where &&
    live.draftId === confirm.draftId &&
    live.draftRev === confirm.draftRev
  );
}

// 제출 응답을 바구니에 반영한다. 호출 때 보낸 줄(submittedIds) 중 바구니에
// 아직 남은 줄만 본다. 명시적 수락(ok) 줄만 뺀다. 모르는 lineId·빠진 줄은
// 두지 않는다 (빠짐 ≠ 수락). 명시적 실패는 사유를 적는다 (없으면 이전 사유 유지,
// 그것도 없으면 '실패'). 응답에 없는 줄은 이전 사유를 지우지 않는다 (재시도 때
// 이유 없이 사라지지 않는다). 입력 바구니는 바꾸지 않는다.
export function applySubmitResult(
  draft: DerbyBasketDraft,
  res: readonly DerbySubmitLine[],
  submittedIds?: ReadonlySet<string>,
): DerbyAppliedSubmit {
  const submitted = submittedIds ?? new Set(draft.lines.map((l) => l.lineId));
  const inDraft = new Map(draft.lines.map((l) => [l.lineId, l]));
  const okIds = new Set<string>();
  const failById = new Map<string, string>();
  for (const r of res) {
    if (!r || typeof r.lineId !== 'string') continue;
    if (!submitted.has(r.lineId) || !inDraft.has(r.lineId)) continue;
    if (r.ok) {
      okIds.add(r.lineId);
      failById.delete(r.lineId);
    } else if (!failById.has(r.lineId)) {
      failById.set(r.lineId, r.error || inDraft.get(r.lineId)?.error || '실패');
    }
  }
  const lines = draft.lines
    .filter((l) => !okIds.has(l.lineId))
    .map((l) => (failById.has(l.lineId) ? { ...l, error: failById.get(l.lineId) ?? '' } : l));
  const failed = lines
    .filter((l) => l.error !== '')
    .map((l) => ({ lineId: l.lineId, key: l.key, error: l.error }));
  return {
    draft: { ...draft, rev: draft.rev + 1, lines },
    accepted: [...okIds],
    failed,
  };
}

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
  // 선택 상태: 미리보기(견적) 전용이다. 바구니는 [담기]로만 바뀐다.
  private kind: DerbyBetKind = 'W';
  private method: DerbySelMethod = 'single';
  private single = new Set<number | string>(); // W/P: 마번, Q/E/R: "a-b" 조합 문자열
  private anchor: number | null = null;
  private partners = new Set<number>();
  private rowA = new Set<number>();
  private rowB = new Set<number>();
  private dirAB = true; // 쌍승 포메이션·축 방향: true면 A줄=1착
  private stake = 100;
  private detailGate = 0; // 말 정보 펼침 (0이면 닫힘)
  private collapsed = false;
  private opened = false; // show()~hide() 사이 true. 확인·호출의 생애 단위이다
  private openGen = 0; // 열림 세대 (show() 때마다 +1. 확인은 같은 세대에서만 호출한다)
  // 바구니: [담기]로만 들어오는 영속 줄 목록. 선택 편집으로 바뀌지 않는다.
  // submit은 이 바구니를 얼린 확정안으로만 보낸다.
  private draft: DerbyBasketDraft | null = null;
  private draftSeq = 0; // 바구니 식별자 일련번호
  private lineSeq = 0; // 행 식별자 일련번호 (바구니 안에서 단조 증가. 재사용 안 함)
  private confirmSeq = 0; // 확정 식별자 일련번호
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
    this.opened = true;
    this.openGen += 1;
    const root = el('div', { id: 'derby', class: this.h.where === 'branch' ? 'branch' : 'park' });
    (document.getElementById('app') || document.body).append(root);
    if (this.h.where === 'branch') document.body.classList.add('in-derby');
    // 모바일 공원 판은 접힌 시트로 시작한다 (맵이 먼저 보여야 한다).
    if (this.h.where === 'park' && document.body.classList.contains('mobile')) this.collapsed = true;
    this.root = root;
    if (opts?.prefillGate) this.prefill(opts.prefillGate);
    this.snap = this.h.snapshot();
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
    if (!this.root) {
      this.opened = false;
      return;
    }
    cancelAnimationFrame(this.raf);
    this.off?.();
    this.off = null;
    this.root.remove();
    this.root = null;
    this.mini = null;
    this.opened = false; // 닫힌 뒤의 늦은 확인·호출은 버린다. 날아간 요청의 수락 반영은 별도
    document.body.classList.remove('in-derby');
  }

  /** 호스트가 스냅샷을 직접 밀어줄 때 쓴다 (listen과 같은 효과). */
  update(snap: DerbySnapshot): void {
    this.snap = snap;
    this.render(true);
  }

  /** "이 말로 마권 담기" (예시장 말 카드에서 옴): 그 말을 고른 채로 연다.
   *  선택과 미리보기 견적만 보여주고, 바구니에는 넣지 않는다 ([담기]는 손으로). */
  prefill(gate: number): void {
    if (gate < 1 || gate > 8) return;
    this.method = 'single';
    this.single.clear();
    if (this.kind === 'W' || this.kind === 'P') this.single.add(gate);
    else {
      // 조합 승식은 축으로: 그 말 + 바구니에 있던 상대가 없으면 빈 파트너로 둔다.
      this.method = 'anchor';
      this.anchor = gate;
    }
    this.render(true);
  }

  private combos(): number[][] {
    if (this.method === 'anchor') {
      return expandDerbySelection(this.kind, 'anchor', this.single, this.anchor, this.rowA, this.partners, this.dirAB);
    }
    if (this.method === 'formation') {
      return expandDerbySelection(this.kind, 'formation', this.single, this.anchor, this.rowA, this.rowB, this.dirAB);
    }
    return expandDerbySelection(this.kind, this.method, this.single, this.anchor, this.rowA, this.rowB, this.dirAB);
  }

  // 확인창을 띄운다. 테스트·호스트가 끼울 수 있는 이음매이다 (기본은 ui 확인창).
  protected confirmPurchase(label: string): Promise<boolean> {
    return confirmModal(label);
  }

  private liveState(): { open: boolean; openGen: number; where: DerbyWhere; draftId: string | null; draftRev: number | null } {
    return {
      // open 플래그가 생애 단위이다. show()가 root와 함께 세우고 hide()가 함께 내린다.
      // (headless 시험에서는 플래그만으로 같은 경계를 본다. render는 root 없으면 쉰다.)
      open: this.opened,
      openGen: this.openGen,
      where: this.h.where,
      draftId: this.draft ? this.draft.draftId : null,
      draftRev: this.draft ? this.draft.rev : null,
    };
  }

  private quoteMap(
    kind: DerbyBetKind,
    combos: number[][],
    stake: number,
  ): Map<string, { odds: number | null; est: number | null }> {
    const out = new Map<string, { odds: number | null; est: number | null }>();
    for (const q of this.h.quote(kind, combos, stake)) {
      out.set(q.key, { odds: q.odds, est: q.est });
    }
    return out;
  }

  // 바구니 줄들의 견적을 줄 식별자 단위로 묶는다. 승식·금액이 다른 줄은
  // 따로 묶어 호스트에 묻는다 (같은 조합이라도 조건이 다르면 견적이 다르다).
  private quoteForLines(
    lines: readonly { lineId: string; key: string; kind: DerbyBetKind; legs: number[]; stake: number }[],
  ): Map<string, { odds: number | null; est: number | null }> {
    const groups = new Map<string, { kind: DerbyBetKind; stake: number; legs: number[][]; ids: string[] }>();
    for (const l of lines) {
      const gk = `${l.kind}|${l.stake}`;
      let g = groups.get(gk);
      if (!g) {
        g = { kind: l.kind, stake: l.stake, legs: [], ids: [] };
        groups.set(gk, g);
      }
      g.legs.push([...l.legs]);
      g.ids.push(l.lineId);
    }
    const out = new Map<string, { odds: number | null; est: number | null }>();
    for (const g of groups.values()) {
      let quotes: DerbyQuoteLine[];
      try {
        quotes = this.h.quote(g.kind, g.legs, g.stake);
      } catch {
        throw new Error('quote-unavailable');
      }
      const byKey = new Map(quotes.map((q) => [q.key, q]));
      for (let i = 0; i < g.legs.length; i++) {
        const key = COMBO_KEY(g.kind, g.legs[i]);
        const q = byKey.get(key);
        out.set(g.ids[i], q ? { odds: q.odds, est: q.est } : { odds: null, est: null });
      }
    }
    return out;
  }

  // 미리보기 조합을 바구니에 담는다. SPEC "구매 목록에 담아"에 해당하는 명시 동작이다.
  // 선택 편집·금액 변경은 미리보기만 바꾸고 이 바구니를 건드리지 않는다.
  // 같은 조합을 다시 담으면 일부러 또 사는 것으로 보고 새 행 식별자를 매긴다
  // (수락·삭제된 줄이 부활하지 않는다). 다른 경주 바구니가 있으면 막는다
  // (먼저 취소해야 한다). 받은 additions의 견적이 없거나 숫자가 아니면 담지 않는다.
  private addPreviewToBasket(
    additions: { key: string; kind: DerbyBetKind; legs: number[]; stake: number; odds: number | null; est: number | null }[],
  ): boolean {
    const snap = this.snap;
    if (!snap || !additions.length) return false;
    for (const a of additions) {
      if (a.odds === null || a.est === null || !Number.isFinite(a.odds) || !Number.isFinite(a.est)) {
        this.h.toast('견적이 없는 조합은 담을 수 없어요.', true);
        return false;
      }
    }
    if (this.draft && this.draft.raceN !== snap.head.n) {
      this.h.toast('다른 경주 바구니가 있어요. 먼저 취소하고 담아 주세요.', true);
      return false;
    }
    const draftId = this.draft ? this.draft.draftId : `d${(this.draftSeq += 1)}`;
    const prev = this.draft ? this.draft.lines : [];
    const { lines, nextSeq } = appendBasketLines(prev, draftId, this.lineSeq, additions);
    this.lineSeq = nextSeq;
    this.draft = {
      draftId,
      rev: (this.draft ? this.draft.rev : 0) + 1,
      raceN: snap.head.n,
      lines,
    };
    return true;
  }

  private abortToast(reason: DerbyAbortReason): void {
    const msg =
      reason === 'empty'
        ? '담긴 조합이 없어요.'
        : reason === 'race-changed'
          ? '경주가 바뀌어서 사지 않았어요. 바구니를 확인해 주세요.'
          : reason === 'auth-changed'
            ? '발매 승인이 바뀌어서 사지 않았어요. 다시 담아 주세요.'
            : reason === 'not-selling' || reason === 'not-sellable'
              ? '지금은 살 수 없는 경주예요. 확정 판정은 컨트롤러·규칙이 해요.'
              : reason === 'no-time'
                ? '마감 시간이 지나서 사지 않았어요.'
                : reason === 'quote-changed' || reason === 'quote-unavailable'
                  ? '배당이 바뀌었거나 확인할 수 없어서 사지 않았어요.'
                  : reason === 'quote-invalid'
                    ? '배당·예상액이 없거나 숫자가 아니라서 사지 않았어요. 견적을 확인해 주세요.'
                    : reason === 'lifetime-ended'
                      ? '판이 닫혔다 다시 열렸어요. 확인은 버리고, 바구니에서 다시 시도해 주세요.'
                      : reason === 'pending-lines'
                        ? '사는 중이에요. 끝난 뒤에 다시 시도해 주세요.'
                  : reason === 'insufficient-balance'
                    ? '잔액이 모자라요.'
                    : reason === 'over-allowance'
                      ? '경주 한도(금액)를 넘었어요. 조합·금액을 줄여 주세요.'
                      : reason === 'no-slots'
                        ? '살 수 있는 장수를 넘었어요.'
                        : '바구니가 바뀌어서 사지 않았어요. 다시 시도해 주세요.';
    this.h.toast(msg, true);
  }

  private tick(): void {
    const snap = this.snap;
    if (!snap || !this.root) return;
    const c = this.root.querySelector('[data-d="count"]');
    if (c) {
      c.textContent =
        snap.head.status === 'selling'
          ? `마감까지 ${mmss(snap.head.closesInMs)}`
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
    // 같은 경주에서는 스크롤·포커스를 살린다. 바구니는 경주가 바뀌어도 둔다 (이어보기).
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
      this.buildCard(root, snap);
      this.buildKindTabs(root, snap);
      this.buildMethod(root, snap);
      this.buildStake(root, snap);
      this.buildQuote(root, snap);
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
    // 공원 판은 접었다 폈다 (모바일은 접힘 시작). 분점은 나가기로 닫는다.
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
      head.append(f);
    } else {
      const out = el('button', { class: 'btn small out', text: '🚪 나가기', title: '분점에서 나가기' });
      out.setAttribute('data-dk', 'leave');
      out.onclick = () => {
        out.disabled = true;
        void this.h.leaveBranch?.().finally(() => {
          out.disabled = false;
        });
      };
      head.append(out);
    }
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
    // 예정표: 경주 선택은 호스트 액션(selectRace)이다. 호스트가 그 경주의
    // 스냅샷을 밀어준다. 보는 경주가 바뀌어도 바구니의 구매 신원(raceN)은 바뀌지
    // 않는다 (이어진 바구니는 별도 안내와 함께 둔다).
    const bar = el('div', { class: 'd-sched', title: '예정 경주 (눌러서 보기)' });
    for (const s of snap.schedule) {
      const cur = s.n === snap.head.n;
      const time = s.timeLabel ? `${s.timeLabel} ` : '';
      const b = el('button', {
        class: 'btn small' + (cur ? ' on' : ''),
        text: `${time}${s.n}R·${statusText(s.status)}`,
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
      const time = next.timeLabel ? `${next.timeLabel} ` : '';
      bar.append(el('span', { class: 'd-next', text: `다음 ${time}${next.n}R` }));
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
      pick.disabled = this.submitting; // 보내는 동안에는 바구니를 얼린다
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
    if (this.method === 'single') {
      if (this.kind === 'W' || this.kind === 'P') return this.single.has(gate);
      for (const k of this.single) {
        const legs = String(k).split('-').map(Number);
        if (legs.includes(gate)) return true;
      }
      return false;
    }
    if (this.method === 'box') return (this.single as Set<number>).has(gate);
    if (this.method === 'anchor') return this.anchor === gate || this.partners.has(gate);
    return this.rowA.has(gate) || this.rowB.has(gate);
  }

  private toggleGate(gate: number): void {
    if (this.method === 'single') {
      if (this.kind === 'W' || this.kind === 'P') {
        if (this.single.has(gate)) this.single.delete(gate);
        else this.single.add(gate);
      } else {
        // 일반 조합식은 두 마리씩 눌러 담는다. 같은 말·이미 담은 조합은 건너뛴다.
        const rest = [...this.single].find((k) => String(k).split('-').length === 1) as string | undefined;
        if (rest !== undefined) {
          const a = Number(rest);
          this.single.delete(rest);
          if (a === gate) {
            this.render(true);
            return;
          }
          const legs = this.kind === 'E' ? [a, gate] : a < gate ? [a, gate] : [gate, a];
          this.single.add(legs.join('-'));
        } else {
          this.single.add(String(gate));
        }
      }
    } else if (this.method === 'box') {
      if (this.single.has(gate)) this.single.delete(gate);
      else this.single.add(gate);
    } else if (this.method === 'anchor') {
      if (this.anchor === gate) this.anchor = null;
      else if (this.partners.has(gate)) this.partners.delete(gate);
      else if (this.anchor === null) this.anchor = gate;
      else this.partners.add(gate);
    } else {
      // 포메이션 두 줄: 카드 버튼은 없음 → 한 줄 → 양쪽 → 없음 순으로 돈다.
      // 줄별 고르기는 아래 첫 줄·둘째 줄에서 따로 한다 (같은 말을 두 줄에 둬도 되고,
      // 자기 자신끼리 한 장은 전개 때 빠진다).
      const inA = this.rowA.has(gate);
      const inB = this.rowB.has(gate);
      if (!inA && !inB) {
        (this.rowA.size <= this.rowB.size ? this.rowA : this.rowB).add(gate);
      } else if (!inA || !inB) {
        this.rowA.add(gate);
        this.rowB.add(gate);
      } else {
        this.rowA.delete(gate);
        this.rowB.delete(gate);
      }
    }
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
        this.single.clear();
        this.anchor = null;
        this.partners.clear();
        this.rowA.clear();
        this.rowB.clear();
        this.render(true);
      };
      tabs.append(b);
    }
    body.append(tabs);
    const methods = el('div', { class: 'd-tabs sub', title: '구매 방식' });
    const order: DerbySelMethod[] = ['single', 'box', 'anchor', 'formation'];
    for (const m of order) {
      const b = el('button', {
        class: 'btn small' + (this.method === m ? ' on' : ''),
        text: DERBY_METHOD_LABEL[m] + (m === 'anchor' && (this.kind === 'Q' || this.kind === 'R' || this.kind === 'E') ? '(축=첫 줄 한 마리)' : ''),
      });
      b.setAttribute('data-dk', `method-${m}`);
      b.setAttribute('aria-pressed', this.method === m ? 'true' : 'false');
      b.disabled = this.submitting;
      b.onclick = () => {
        if (this.method === m) return;
        this.method = m;
        this.single.clear();
        this.anchor = null;
        this.partners.clear();
        this.rowA.clear();
        this.rowB.clear();
        this.render(true);
      };
      methods.append(b);
    }
    body.append(methods);
  }

  private gateRow(
    title: string,
    isOn: (g: number) => boolean,
    onTap: (g: number) => void,
    keyPrefix: string,
  ): HTMLElement {
    const row = el('div', { class: 'd-pick', title });
    row.append(el('span', { class: 'd-picklab', text: title }));
    for (let g = 1; g <= 8; g++) {
      const b = el('button', { class: 'd-num' + (isOn(g) ? ' on' : ''), text: String(g) });
      b.setAttribute('data-dk', `${keyPrefix}-${g}`);
      paintGate(b, g);
      b.setAttribute('aria-pressed', isOn(g) ? 'true' : 'false');
      b.disabled = this.submitting; // 보내는 동안에는 바구니를 얼린다
      const gg = g;
      b.onclick = () => onTap(gg);
      row.append(b);
    }
    return row;
  }

  private buildMethod(root: HTMLElement, snap: DerbySnapshot): void {
    void root;
    const body = this.body();
    const pair = KIND_NEEDS_PAIR[this.kind];
    if (this.method === 'single') {
      if (!pair) {
        body.append(
          this.gateRow(
            '마번 선택',
            (g) => this.single.has(g),
            (g) => this.toggleGate(g),
            'pick',
          ),
        );
      } else {
        const half = [...this.single].find((k) => String(k).split('-').length === 1);
        body.append(
          el('div', {
            class: 'd-hint',
            text:
              half === undefined
                ? '두 마리를 순서대로 누르면 한 조합이 담긴다 (복승·복연승은 순서 무관, 쌍승은 누른 순서대로 1착→2착).'
                : `${String(half)}번을 골랐다. 짝을 누르면 조합 완성, 다시 누르면 취소.`,
          }),
        );
        body.append(
          this.gateRow(
            '마번 선택',
            (g) => this.isGateOn(g),
            (g) => this.toggleGate(g),
            'pick',
          ),
        );
        const mine = [...this.single].filter((k) => String(k).split('-').length === 2);
        if (mine.length) {
          const box = el('div', { class: 'd-picked' });
          for (const k of mine) {
            const legs = String(k).split('-').map(Number);
            const chip = el('span', {
              class: 'd-chip',
              text: this.kind === 'E' ? `${legs[0]}→${legs[1]}` : legs.join('-'),
            });
            const x = el('button', { class: 'd-x', text: '×', title: '이 조합 빼기' });
            x.setAttribute('data-dk', `rm-${k}`);
            x.disabled = this.submitting;
            const kk = k;
            x.onclick = () => {
              this.single.delete(kk);
              this.render(true);
            };
            chip.append(x);
            box.append(chip);
          }
          body.append(box);
        }
      }
    } else if (this.method === 'box') {
      body.append(
        el('div', {
          class: 'd-hint',
          text: pair ? '박스: 고른 말들의 모든 조합이 담긴다.' : '박스: 고른 말이 한 장씩 담긴다.',
        }),
      );
      body.append(
        this.gateRow(
          '박스 말',
          (g) => this.single.has(g),
          (g) => this.toggleGate(g),
          'box',
        ),
      );
    } else if (this.method === 'anchor') {
      body.append(
        el('div', {
          class: 'd-hint',
          text:
            this.kind === 'E'
              ? `축: 첫 마리가 축. 방향 ${this.dirAB ? '축=1착' : '축=2착'} (아래 버튼으로 바꾼다).`
              : '축: 첫 마리가 축(첫 줄 한 마리 포메이션). 나머지는 상대.',
        }),
      );
      body.append(
        this.gateRow(
          '축·상대',
          (g) => this.anchor === g || this.partners.has(g),
          (g) => this.toggleGate(g),
          'anchor',
        ),
      );
      if (this.kind === 'E') {
        const d = el('button', {
          class: 'btn small',
          text: this.dirAB ? '방향: 축=1착' : '방향: 축=2착',
          title: '쌍승 축 방향 바꾸기',
        });
        d.setAttribute('data-dk', 'anchdir');
        d.setAttribute('aria-pressed', this.dirAB ? 'true' : 'false');
        d.disabled = this.submitting;
        d.onclick = () => {
          this.dirAB = !this.dirAB;
          this.render(true);
        };
        body.append(d);
      }
      void snap;
    } else {
      body.append(
        el('div', {
          class: 'd-hint',
          text:
            this.kind === 'E'
              ? `포메이션 두 줄${this.dirAB ? '(첫 줄=1착, 둘째 줄=2착)' : '(첫 줄=2착, 둘째 줄=1착)'}. 같은 말을 두 줄에 골라도 되고, 자기 자신끼리는 빠진다.`
              : '포메이션 두 줄. 같은 말을 두 줄에 골라도 되고, 자기 자신끼리·순서 뒤집힌 중복은 한 장으로 접힌다.',
        }),
      );
      body.append(
        this.gateRow(
          '첫 줄',
          (g) => this.rowA.has(g),
          (g) => {
            if (this.rowA.has(g)) this.rowA.delete(g);
            else this.rowA.add(g);
            this.render(true);
          },
          'rowA',
        ),
      );
      body.append(
        this.gateRow(
          '둘째 줄',
          (g) => this.rowB.has(g),
          (g) => {
            if (this.rowB.has(g)) this.rowB.delete(g);
            else this.rowB.add(g);
            this.render(true);
          },
          'rowB',
        ),
      );
      if (this.kind === 'E') {
        const d = el('button', {
          class: 'btn small',
          text: this.dirAB ? '방향: 첫 줄=1착' : '방향: 첫 줄=2착',
          title: '쌍승 포메이션 방향 바꾸기',
        });
        d.setAttribute('data-dk', 'formdir');
        d.setAttribute('aria-pressed', this.dirAB ? 'true' : 'false');
        d.disabled = this.submitting;
        d.onclick = () => {
          this.dirAB = !this.dirAB;
          this.render(true);
        };
        body.append(d);
      }
    }
  }

  private buildStake(root: HTMLElement, snap: DerbySnapshot): void {
    void root;
    void snap;
    const body = this.body();
    const row = el('div', { class: 'd-stake' });
    row.append(el('span', { class: 'd-picklab', text: '조합당' }));
    const minus = el('button', { class: 'btn small', text: '−100', title: '100 줄이기' });
    minus.setAttribute('data-dk', 'stake-down');
    minus.disabled = this.submitting;
    minus.onclick = () => {
      this.stake = Math.max(STAKE_MIN, this.stake - STAKE_STEP);
      this.syncStakeInput();
      this.render(true);
    };
    const input = el('input', {
      class: 'd-stakein',
      type: 'number',
      min: String(STAKE_MIN),
      step: String(STAKE_STEP),
      value: String(this.stake),
      title: '조합당 금액 (100 단위)',
    }) as HTMLInputElement;
    input.setAttribute('data-dk', 'stake');
    input.disabled = this.submitting;
    input.onchange = () => {
      const v = Math.round((Number(input.value) || 0) / STAKE_STEP) * STAKE_STEP;
      this.stake = Math.max(STAKE_MIN, v);
      this.render(true);
    };
    const plus = el('button', { class: 'btn small', text: '+100', title: '100 더하기' });
    plus.setAttribute('data-dk', 'stake-up');
    plus.disabled = this.submitting;
    plus.onclick = () => {
      this.stake = this.stake + STAKE_STEP;
      this.syncStakeInput();
      this.render(true);
    };
    row.append(minus, input, plus);
    row.append(el('span', { class: 'd-coin', text: '코인' }));
    body.append(row);
  }

  private syncStakeInput(): void {
    const i = this.root?.querySelector('[data-dk="stake"]');
    if (i instanceof HTMLInputElement) i.value = String(this.stake);
  }

  // 견적(미리보기)과 구매 목록(바구니)을 그린다. 선택 편집은 미리보기만 바꾸고,
  // 바구니는 [담기]·[빼기]·[취소]·구매 결과로만 바뀐다.
  private buildQuote(root: HTMLElement, snap: DerbySnapshot): void {
    void root;
    const body = this.body();
    const box = el('div', { class: 'd-quote' });
    this.buildPreview(box, snap);
    this.buildBasket(box, snap);
    body.append(box);
  }

  // 미리보기: 지금 고른 조합의 견적(횟수·합계·배당·예상액). 바구니가 아니다.
  // [담기]를 눌러야 바구니에 들어간다. 견적이 없으면 담을 수 없다.
  private buildPreview(box: HTMLElement, snap: DerbySnapshot): void {
    const combos = this.combos();
    if (!combos.length) {
      box.append(el('div', { class: 'd-hint', text: '말·조합을 고르면 장수·합계·배당·예상 적중금이 여기에 나온다. [담기]를 눌러야 구매 목록에 들어간다.' }));
      return;
    }
    box.append(el('div', { class: 'd-sec', text: `미리보기 · ${DERBY_KIND_LABEL[this.kind]} · 조합당 ${ko(this.stake)}` }));
    let quotes: Map<string, { odds: number | null; est: number | null }> | null = null;
    try {
      quotes = this.quoteMap(this.kind, combos, this.stake);
    } catch {
      quotes = null;
    }
    const list = el('div', { class: 'd-combos' });
    let priced = quotes !== null;
    const additions: { key: string; kind: DerbyBetKind; legs: number[]; stake: number; odds: number | null; est: number | null }[] = [];
    for (const legs of combos) {
      const key = COMBO_KEY(this.kind, legs);
      const q = quotes?.get(key);
      const ok = !!q && q.odds !== null && q.est !== null && Number.isFinite(q.odds) && Number.isFinite(q.est);
      if (!ok) priced = false;
      const label = this.kind === 'E' ? legs.join('→') : [...legs].sort((a, b) => a - b).join('-');
      const line = el('div', { class: 'd-combo' });
      line.append(el('span', { class: 'd-cb', text: `${DERBY_KIND_LABEL[this.kind]} ${label}` }));
      line.append(el('span', { class: 'd-odd', text: ok && q ? `${q.odds}배` : '견적 없음' }));
      line.append(el('span', { class: 'd-est', text: ok && q && q.est !== null ? `예상 ${ko(q.est)}` : '' }));
      list.append(line);
      additions.push({
        key,
        kind: this.kind,
        legs: [...legs],
        stake: this.stake,
        odds: q ? q.odds : null,
        est: q ? q.est : null,
      });
    }
    box.append(list);
    const total = this.stake * combos.length;
    box.append(el('div', { class: 'd-total', text: `${combos.length}장 · 합계 ${ko(total)}` }));
    const mismatch = !!this.draft && this.draft.raceN !== snap.head.n;
    if (!priced) {
      box.append(el('div', { class: 'd-warn', text: '견적이 없는 조합이 있어요. 호스트 견적을 확인한 뒤에 담아 주세요.' }));
    } else if (mismatch && this.draft) {
      box.append(el('div', { class: 'd-warn', text: `다른 경주(${this.draft.raceN}R) 바구니가 있어요. 먼저 아래에서 취소해야 담을 수 있다.` }));
    }
    const add = el('button', { class: 'btn primary d-go', text: `구매 목록에 담기 (${combos.length}장)` });
    add.setAttribute('data-dk', 'basket-add');
    add.disabled = !priced || mismatch || this.submitting;
    if (!priced) add.title = '견적이 없어서 담을 수 없다';
    else if (mismatch) add.title = '다른 경주 바구니를 먼저 취소해야 한다';
    add.onclick = () => {
      if (this.addPreviewToBasket(additions)) this.render(true);
    };
    box.append(add);
  }

  // 구매 목록(바구니): 담은 줄들의 확정 목록. 줄마다 담은 때의 승식·금액·견적을
  // 보여주고, 실패 사유는 줄에 남긴다. 선택을 바꿔도 이 목록은 바뀌지 않는다.
  private buildBasket(box: HTMLElement, snap: DerbySnapshot): void {
    const draft = this.draft;
    if (!draft || !draft.lines.length) return;
    box.append(el('div', { class: 'd-sec', text: `구매 목록 (${draft.lines.length}장)` }));
    // 이어진 바구니: 보는 경주가 바뀌어도 구매 신원(draft.raceN)은 바뀌지 않는다.
    // 이 바구니는 사지 않고, 버리거나(아래 취소) 그 경주로 돌아가서 산다.
    if (draft.raceN !== snap.head.n) {
      box.append(
        el('div', {
          class: 'd-warn',
          text: `지금 보는 ${snap.head.n}R이 아니라 ${draft.raceN}R 바구니(${draft.lines.length}장)가 있다. 이 바구니는 내보내지 않는다.`,
        }),
      );
      const cancel = el('button', { class: 'btn small', text: '바구니 취소(버리기)' });
      cancel.setAttribute('data-dk', 'basket-cancel');
      cancel.disabled = this.submitting;
      cancel.onclick = () => {
        this.clearDraft();
        this.render(true);
      };
      box.append(cancel);
      return;
    }
    const list = el('div', { class: 'd-combos' });
    for (const l of draft.lines) {
      const label = l.kind === 'E' ? l.legs.join('→') : [...l.legs].sort((a, b) => a - b).join('-');
      const line = el('div', { class: 'd-combo' + (l.error ? ' err' : '') });
      line.append(el('span', { class: 'd-cb', text: `${DERBY_KIND_LABEL[l.kind]} ${label} · ${ko(l.stake)}` }));
      line.append(el('span', { class: 'd-odd', text: l.odds === null ? '—' : `${l.odds}배` }));
      line.append(el('span', { class: 'd-est', text: l.est === null ? '' : `예상 ${ko(l.est)}` }));
      // 실패한 줄은 그 줄만 빼고, 수락된 줄은 다시 담지 않는다.
      const x = el('button', { class: 'd-x', text: '×', title: '이 줄 빼기' });
      x.setAttribute('data-dk', `line-${l.lineId}`);
      x.disabled = this.submitting;
      const lineId = l.lineId;
      x.onclick = () => {
        if (!this.draft) return;
        this.draft = {
          ...this.draft,
          rev: this.draft.rev + 1,
          lines: this.draft.lines.filter((x) => x.lineId !== lineId),
        };
        if (!this.draft.lines.length) this.draft = null;
        this.render(true);
      };
      line.append(x);
      if (l.error) line.append(el('span', { class: 'd-err', text: l.error }));
      list.append(line);
    }
    box.append(list);
    const total = draft.lines.reduce((sum, l) => sum + l.stake, 0);
    box.append(
      el('div', {
        class: 'd-total',
        text: `${draft.raceN}R · ${draft.lines.length}장 · 합계 ${ko(total)} · 잔액 ${ko(snap.balance)} · 남은 한도 ${ko(snap.raceRemain)} (${ko(snap.spent)}/${ko(snap.raceCap)}) · 장수 ${snap.ticketUsed}/${snap.ticketMax}`,
      }),
    );
    // 서명 가능 여부는 호스트 숫자·승인으로만 가린다. 오래된 승인·없는 견적은 버튼을 잠근다.
    // 보이는 버튼 상태와 실제 호출 검증(verifyDraftForSubmit)은 같은 조건이다.
    const fresh = snap.head.sellable && snap.head.n === draft.raceN && snap.head.status === 'selling';
    const afford =
      total <= snap.raceRemain &&
      draft.lines.length <= snap.ticketMax - snap.ticketUsed &&
      snap.balance >= total;
    const priced = draft.lines.every(
      (l) => l.odds !== null && l.est !== null && Number.isFinite(l.odds) && Number.isFinite(l.est),
    );
    const go = el('button', {
      class: 'btn primary d-go',
      text: this.submitting ? '사는 중…' : `일괄 구매 (${draft.lines.length}장)`,
    });
    go.setAttribute('data-dk', 'submit');
    go.disabled = !fresh || !afford || !priced || this.submitting;
    if (!fresh) {
      go.title = '발매 중이 아니거나 승인이 바뀌어서 살 수 없다';
      box.append(el('div', { class: 'd-warn', text: '지금은 살 수 없는 경주다. 확정 판정은 컨트롤러·규칙이 한다.' }));
    } else if (!priced) {
      go.title = '견적이 없는 줄이 있어서 살 수 없다';
      box.append(el('div', { class: 'd-warn', text: '견적이 없는 줄이 있어요. 그 줄을 빼거나 견적을 확인해 주세요.' }));
    } else if (!afford) {
      go.title = '한도·잔액을 넘었다';
      box.append(el('div', { class: 'd-warn', text: '한도(금액·장수)·잔액을 넘었다. 줄·금액을 줄여 주세요.' }));
    }
    go.onclick = () => void this.submit();
    box.append(go);
    // 바구니 취소: 담기를 그만둔다 (선택도 함께 비운다).
    const cancel = el('button', { class: 'btn small', text: '바구니 취소(버리기)' });
    cancel.setAttribute('data-dk', 'basket-cancel');
    cancel.disabled = this.submitting;
    cancel.onclick = () => {
      this.clearDraft();
      this.render(true);
    };
    box.append(cancel);
  }

  // 바구니·선택을 함께 비운다. 이어진 바구니도 여기서 버린다.
  private clearDraft(): void {
    this.draft = null;
    this.single.clear();
    this.anchor = null;
    this.partners.clear();
    this.rowA.clear();
    this.rowB.clear();
  }

  // 구매: 확정안을 얼리고 → 확인창 → 호출 전 재검증 → 호출 → 호출 후 검증·반영.
  // 검증은 얼린 확정안으로만 하고, 현재 상태에서 구매안을 재구성하지 않는다.
  // 확인은 같은 열림 세대(openGen)에서만 호출로 이어진다. 호출이 끝나면 같은
  // 바구니 식별자의 아직 남은 줄에만 명시적 수락·실패를 반영한다 (닫혔다 다시
  // 열려도 수락은 버리지 않고, 실패 사유도 새 결과로만 덮는다).
  private async submit(): Promise<void> {
    if (this.submitting) {
      // 같은 줄의 다른 구매가 진행 중이다. 겹쳐서 청구하지 않는다.
      this.abortToast('pending-lines');
      return;
    }
    const draft = this.draft;
    if (!draft || !draft.lines.length) return;
    const submittedIds = new Set(draft.lines.map((l) => l.lineId));
    const s1 = this.h.snapshot();
    this.snap = s1;
    let quotes: Map<string, { odds: number | null; est: number | null }>;
    try {
      quotes = this.quoteForLines(draft.lines);
    } catch {
      this.abortToast('quote-unavailable');
      this.render(true);
      return;
    }
    const confirm = captureConfirmDraft({
      confirmId: `c${(this.confirmSeq += 1)}`,
      draft,
      openGen: this.openGen,
      where: this.h.where,
      authEpoch: s1.head.authEpoch,
      nowMs: Date.now(),
    });
    // 호출 전 검증 1 (확인창 전).
    const v1 = verifyDraftForSubmit(confirm, s1, quotes);
    if (!v1.ok) {
      this.abortToast(v1.reason);
      this.render(true);
      return;
    }
    const label = `${confirm.lines.length}장 · 합계 ${ko(confirm.totalStake)}`;
    const dialogGen = this.openGen;
    let accepted: boolean;
    try {
      accepted = await this.confirmPurchase(`${label}을 살까요?`);
    } catch {
      accepted = false;
    }
    if (!accepted) {
      this.render(true); // 취소: 바구니는 그대로 둔다
      return;
    }
    // 확인은 같은 열림 세대에서만 호출로 이어진다. 그 사이 닫혔다 다시 열리면 버린다.
    if (!this.opened || this.openGen !== dialogGen) {
      this.abortToast('lifetime-ended');
      this.render(true);
      return;
    }
    // 호출 전 검증 2 (확인창을 보는 사이 세상이 바뀌었는지, 새 스냅샷으로).
    const s2 = this.h.snapshot();
    this.snap = s2;
    let quotes2: Map<string, { odds: number | null; est: number | null }>;
    try {
      quotes2 = this.quoteForLines(draft.lines);
    } catch {
      this.abortToast('quote-unavailable');
      this.render(true);
      return;
    }
    const v2 = verifyDraftForSubmit(confirm, s2, quotes2);
    if (!v2.ok) {
      this.abortToast(v2.reason);
      this.render(true);
      return;
    }
    if (!isConfirmCurrent(confirm, this.liveState())) {
      this.abortToast('superseded');
      this.render(true);
      return;
    }
    this.submitting = true;
    this.render(true);
    let res: DerbySubmitLine[] | null = null;
    let threw: unknown = null;
    try {
      const out = await this.h.submit({
        confirmId: confirm.confirmId,
        draftId: confirm.draftId,
        where: confirm.where,
        seenN: confirm.raceN,
        seenAuth: confirm.authEpoch,
        tickets: confirm.lines.map((l) => ({ lineId: l.lineId, key: l.key, kind: l.kind, legs: [...l.legs], stake: l.stake })),
      });
      if (Array.isArray(out)) res = out;
    } catch (e) {
      threw = e;
    }
    this.submitting = false;
    if (threw !== null) {
      // 요청 자체가 실패: 수락 아님. 바구니는 그대로 두고 유용한 오류 하나만 보여준다.
      const msg = threw instanceof Error && threw.message ? threw.message : '요청 실패';
      this.h.toast(`구매하지 못했어요: ${msg}. 바구니는 그대로 둔다.`, true);
      this.snap = this.h.snapshot();
      this.render(true);
      return;
    }
    const basketNow = this.draft;
    if (!basketNow || basketNow.draftId !== confirm.draftId) {
      // 바구니가 바뀌었으면 늦은 응답을 버린다. 어느 줄도 건드리지 않는다.
      this.h.toast('그 사이 바구니가 바뀌어서 늦은 응답은 버렸다. 최신 상태에서 다시 시도해 주세요.', true);
      this.snap = this.h.snapshot();
      this.render(true);
      return;
    }
    if (!res) {
      // 응답이 비어도 수락으로 치지 않는다. 바구니는 그대로 둔다.
      this.h.toast('응답이 비어서 바구니는 그대로 둔다.', true);
      this.snap = this.h.snapshot();
      this.render(true);
      return;
    }
    // 호출 후: 같은 바구니 식별자에 아직 남은 줄 중, 호출 때 보낸 줄만 반영한다.
    // 명시적 수락 줄만 뺀다 (수락은 사실이므로 반영한다. 빼지 않으면 중복 구매 위험).
    // 명시적 실패는 사유를 적고, 응답에 없는 줄은 이전 사유를 지우지 않는다.
    const applied = applySubmitResult(basketNow, res, submittedIds);
    this.draft = applied.draft.lines.length ? applied.draft : null;
    if (applied.accepted.length > 0 && applied.failed.length === 0) {
      this.h.toast(`🎫 ${applied.accepted.length}장을 샀어요.`);
    } else if (applied.accepted.length > 0) {
      this.h.toast(`🎫 ${applied.accepted.length}장 성공, ${applied.failed.length}장 실패. 실패 줄은 남아 있으니 다시 확인해 주세요.`, true);
    } else {
      this.h.toast('사지 못했어요. 줄별 안내를 확인해 주세요.', true);
    }
    const s3 = this.h.snapshot();
    this.snap = s3;
    if (this.draft && this.draft.lines.length) {
      // 남은 줄이 있는데 세상이 바뀌었으면 그 사실만 알린다 (바구니는 손대지 않는다).
      let changed = false;
      try {
        const q3 = this.quoteForLines(this.draft.lines);
        const v3 = verifyDraftForSubmit(
          { ...confirm, lines: this.draft.lines.map((l) => ({ ...l, legs: [...l.legs] })) },
          s3,
          q3,
        );
        changed = !v3.ok;
      } catch {
        changed = true;
      }
      if (changed) {
        this.h.toast('그 사이 경주 상태가 바뀌었어요. 남은 줄은 새 상태에서 다시 확인해 주세요.', true);
      }
    }
    this.render(true);
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
            : t.status === 'void'
              ? '무효·환불'
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
