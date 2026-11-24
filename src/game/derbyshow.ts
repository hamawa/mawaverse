// 경마공원 쇼 (2026-11-23, 사용자 기획): 6분 주기 경마 퍼포먼스. 서버·DB·네트워크 없이 돌아가는 순수 모듈.
// 입력(경주 번호 n · 주기 안 시각 ms · 거리 · 출전마 8마리 · 늦게 올 수 있는 결과)만으로 모든 말의 위치가 정해지므로,
// 언제 들어와도 모든 화면에 같은 장면이 보인다. 말·기수·마필관리사는 그림일 뿐 유저 칸(occ)을 차지하지 않는다.
// 결과(res)가 마감(4:00) 몇 초 뒤에 오면 그때까지 출발 대열 구간을 늘렸다가 이어 붙인다(각질 반영: 선행은 앞에서 버티고 추입은 막판에).
import { TILE } from '../shared/config';
import { mulberry32 } from '../shared/hash';
import { raceClock } from '../shared/derby/time';
import { horseSprite, fallenJockeySprite, groomSprite, HORSE_W, HORSE_FOOT, HORSE_SCALE, FALLEN_W, FALLEN_H } from './sprites/horse';
import { FRAME_W, FRAME_H } from './sprites/types';
import {
  RACE_LOOP, RACE_START_INDEX, RACE_PADDOCK, RACE_PADDOCK_RING, RACE_PADDOCK_SLOTS, RACE_PARADE_PATH,
} from './map';

const LANE_W = 1.0; // 차선 한 칸의 폭 (타일). 말 그림(약 2타일)에 맞춘 값
const PARADE_GAP = 3; // 퍼레이드 일렬의 앞뒤 간격 (타일)

export const DERBY_CYCLE_MS = 360000; // 6분 주기
export const DERBY_RACE_START_MS = 240000; // 4:00 발주
export const DERBY_RACE_END_MS = 280000; // 4:40 결승 (우승마가 결승선을 밟는 시각 근처)
export const DERBY_HOOF_INTERVAL_MS = 300; // 경주 중 말발굽 소리 간격. world.ts 가 derbyHoofActive(ms) 일 때 이 간격으로 'hoof' 를 낸다
export const DERBY_DISTANCES = [1000, 1200, 1400, 1800] as const;
export type DerbyDistance = (typeof DERBY_DISTANCES)[number];
export function derbyDistanceFor(n: number): DerbyDistance { return DERBY_DISTANCES[((n % 4) + 4) % 4]; }

// ---- 진행 단계 (SPEC 시간표) ----
export type DerbyPhase = 'paddock' | 'mount' | 'parade' | 'warmup' | 'gate' | 'race' | 'ceremony' | 'payout';
export interface DerbyPhaseInfo { phase: DerbyPhase; startMs: number; endMs: number }
const PHASES: DerbyPhaseInfo[] = [
  { phase: 'paddock', startMs: 0, endMs: 100000 }, // 0:00~1:40 예시장 주회 (몸짓이 여기서 보인다)
  { phase: 'mount', startMs: 100000, endMs: 130000 }, // 1:40 종소리 → 기수 기승, 한 바퀴
  { phase: 'parade', startMs: 130000, endMs: 160000 }, // 2:10~2:40 지하마도 → 본마장, 관람대 앞 마번 순 퍼레이드
  { phase: 'warmup', startMs: 160000, endMs: 200000 }, // 2:40~3:20 반대 방향 준비운동 → 출발대 쪽으로 (거리마다 출발대 다름)
  { phase: 'gate', startMs: 200000, endMs: 240000 }, // 3:20~3:55 출발대 뒤 원형돌기, 깃발, 차례로 게이트
  { phase: 'race', startMs: 240000, endMs: 280000 }, // 4:00 마감·게이트 열림·팡파르 → 4:40 경주
  { phase: 'ceremony', startMs: 280000, endMs: 320000 }, // 4:40~5:20 주로에서 감속·세리머니
  { phase: 'payout', startMs: 320000, endMs: 360000 }, // 5:20~6:00 확정 배당, 퇴장, 다음 경주 출전마가 예시장에
];
export function derbyPhaseAt(ms: number): DerbyPhaseInfo {
  const t = ((ms % DERBY_CYCLE_MS) + DERBY_CYCLE_MS) % DERBY_CYCLE_MS;
  return PHASES.find((p) => t < p.endMs) ?? PHASES[PHASES.length - 1];
}

// ---- 출전마·결과 ----
export type DerbyBehavior = 'dash' | 'wild' | 'gallopIn' | 'side' | 'lazy' | 'unseat' | 'calm';
// dash: 점프하며 등장·힘찬 걸음 / wild: 사나움(날뛰고 앞발 들기) / gallopIn: 뛰어서 입장 / side: 옆으로 걸으며 등장 /
// lazy: 설렁설렁 등장 / unseat: 기수를 떨어뜨렸다 다시 태움 / calm: 차분하게 걷기
export type RunStyle = '선행' | '선입' | '추입';
export interface DerbyRunner {
  gate: number; // 1~8 (마번)
  name: string; // 마명
  coat: string; // 털빛 (css 색)
  jockey: string; // 기수 이름
  silk: [string, string]; // 복색 두 빛깔
  style: RunStyle; // 각질
  behavior: DerbyBehavior | null; // 몸짓 (결과에 작게 영향. null 이면 고개 끄덕임·꼬리 흔들기뿐)
}
export type DerbyEventKind = 'boost' | 'drop' | 'place' | 'fall'; // 기세·부진·안정·낙마
export interface DerbyEvent { gate: number; kind: DerbyEventKind }
export interface DerbyResult {
  order: number[]; // 착순 (마번 8개)
  event: DerbyEvent | null; // 그 경주의 일 (많아야 한 마리)
  spliceMs: number; // 결과를 처음 본 주기 안 시각. 모르면 발주 시각. 출발 대열 → 결과 경로로 이어 붙이는 기준
}
export interface DerbyShowInput {
  n: number; // 경주 번호
  ms: number; // 주기 안 시각 (호출 쪽이 serverNow()로 계산)
  distance: DerbyDistance; // 1000/1200/1400/1800 (출발대 위치가 다르다. 스냅샷의 실제 값)
  runners: DerbyRunner[]; // 출전마 (8마리. 비어 있거나 일부만 있어도 그림·자막이 버틴다)
  result: DerbyResult | null; // 마감 뒤에 옴. 늦으면 대열 구간을 늘린다
  winOdds?: { [gate: number]: number | null } | null; // 실제 단승 배당 (없으면 자막에 배당을 쓰지 않는다)
}
// 라운드 범위 출전표 스냅샷 (world.ts 가 n 으로 보관한다. 티켓 판이 읽는 공개 계약)
// result 가 null 이면 "아직 결과 없음" (목 결과를 지어내지 않는다)
// winOdds: 마번 → 단승 배당 (실제 값. 없으면 자막에 배당을 쓰지 않는다. 코어 모듈이 채운다)
export interface DerbyFieldSnapshot {
  n: number;
  distance: DerbyDistance;
  runners: DerbyRunner[];
  result: DerbyResult | null;
  winOdds?: { [gate: number]: number | null } | null;
}
export function snapshotInput(snap: DerbyFieldSnapshot, ms: number): DerbyShowInput {
  return { n: snap.n, ms, distance: snap.distance, runners: snap.runners, result: snap.result, winOdds: snap.winOdds ?? null };
}
// 분점 미니가 그릴 순수 자료 (캔버스 없이도 경계를 시험할 수 있게 분리)
export interface DerbyMiniView {
  x0: number; y0: number; x1: number; y1: number; // 타일 경계 (주로 + 단계별 관심지)
  horses: { x: number; y: number; color: string; leader: boolean }[];
  paddock: { x: number; y: number; w: number; h: number } | null; // 예시장 링 (예시·기승 단계에만)
  finish: { x: number; y: number };
}
export interface DerbyHorseView {
  gate: number;
  x: number; y: number; // 타일 좌표 (소수)
  dir: 0 | 1 | 2 | 3;
  gait: 'stand' | 'walk' | 'trot' | 'gallop'; // 걸음걸이 (그림용)
  progress: number; // 경주 중 달린 거리 (주로 루프 단위. 선두·카메라 판정은 이것으로만 한다. 경주 밖에서는 -1)
  rear: number; // 0~1 앞발 들기 (사나움·세리머니)
  jump: number; // 0~1 점프 (힘찬 등장)
  side: number; // 0~1 옆걸음 (옆으로 등장)
  headLow: boolean; // 고개 숙임 (설렁설렁·부진)
  headHigh: boolean; // 고개 듦 (기세·안정 입상)
  rider: boolean; // 기수가 말 위에
  riderDown: boolean; // 기수가 떨어져 있음 (다시 태우기 전·낙마)
  groom: boolean; // 마필관리사가 앞에서 끎 (예시장·기승·퍼레이드)
  hidden: boolean; // 마방에 들어감 (그리지 않는다)
}
export interface DerbyFrame {
  input: DerbyShowInput;
  phase: DerbyPhase;
  horses: DerbyHorseView[];
  leaderGate: number; // 경주 중 선두 마번 (그 전에는 0)
}

// ---- 작은 수학 ----
function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function easeInOut(t: number): number { const c = clamp01(t); return c * c * (3 - 2 * c); }
function shuffle<T>(rnd: () => number, arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---- 주로 위 위치 (루프 인덱스 단위 거리 s: 0 = 결승선, 진행 방향으로 증가) ----
const LOOP_LEN = RACE_LOOP.length;
function loopSegDir(s: number): 0 | 1 | 2 | 3 {
  const i = ((Math.floor(s) % LOOP_LEN) + LOOP_LEN) % LOOP_LEN;
  const [x0, y0] = RACE_LOOP[i], [x1, y1] = RACE_LOOP[(i + 1) % LOOP_LEN];
  return Math.abs(x1 - x0) >= Math.abs(y1 - y0) ? (x1 > x0 ? 2 : 1) : (y1 > y0 ? 0 : 3);
}
// 꼭짓점마다 앞뒤 구간 법선의 평균 (구간 안에서는 두 꼭짓점 법선을 섞어 차선이 모서리에서 끊기지 않는다)
function segNormal(i: number): [number, number] {
  const [x0, y0] = RACE_LOOP[i], [x1, y1] = RACE_LOOP[(i + 1) % LOOP_LEN];
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  return [-(y1 - y0) / len, (x1 - x0) / len];
}
const VERTEX_NORMALS: ReadonlyArray<readonly [number, number]> = RACE_LOOP.map((_, i) => {
  const a = segNormal((i - 1 + LOOP_LEN) % LOOP_LEN), b = segNormal(i);
  const x = a[0] + b[0], y = a[1] + b[1], len = Math.hypot(x, y) || 1;
  return [x / len, y / len] as const;
});
function loopPoint(s: number, lane: number): { x: number; y: number; dir: 0 | 1 | 2 | 3 } {
  const wrapped = ((s % LOOP_LEN) + LOOP_LEN) % LOOP_LEN;
  const i = Math.floor(wrapped), f = wrapped - i;
  const [x0, y0] = RACE_LOOP[i], [x1, y1] = RACE_LOOP[(i + 1) % LOOP_LEN];
  // 바깥쪽 차선 (boost 는 바깥으로 돌고, fall 은 안으로 밀린다)
  const n0 = VERTEX_NORMALS[i], n1 = VERTEX_NORMALS[(i + 1) % LOOP_LEN];
  const mx = lerp(n0[0], n1[0], f), my = lerp(n0[1], n1[1], f), ml = Math.hypot(mx, my) || 1;
  const nx = mx / ml, ny = my / ml;
  return { x: lerp(x0, x1, f) + nx * lane * LANE_W, y: lerp(y0, y1, f) + ny * lane * LANE_W, dir: loopSegDir(s) };
}
// 점에서 가장 가까운 주로 위 거리 s (구간에 수직으로 내린 발)
function nearestLoopS(x: number, y: number): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < LOOP_LEN; i++) {
    const [x0, y0] = RACE_LOOP[i], [x1, y1] = RACE_LOOP[(i + 1) % LOOP_LEN];
    const dx = x1 - x0, dy = y1 - y0, t = clamp01(((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1));
    const d = Math.hypot(x0 + dx * t - x, y0 + dy * t - y);
    if (d < bd) { bd = d; best = i + t; }
  }
  return best;
}
function dirOf(dx: number, dy: number): 0 | 1 | 2 | 3 { return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 2 : 1) : (dy > 0 ? 0 : 3); }
function startIndexOf(distance: DerbyDistance): number { return RACE_START_INDEX[distance] ?? RACE_START_INDEX[1000]; }
function travelOf(distance: DerbyDistance): number { const s = startIndexOf(distance); return (LOOP_LEN - (s % LOOP_LEN)) % LOOP_LEN || LOOP_LEN; }

// 출발 대열 순서 (결과를 모르는 출발 직후 몇 초. 경주 번호로만 정한다)
function packOrderOf(n: number): number[] { return shuffle(mulberry32(n * 2654435761 % 2147483647), [1, 2, 3, 4, 5, 6, 7, 8]); }
function styleCurve(style: RunStyle, u: number): number {
  if (style === '선행') return Math.pow(u, 0.8); // 앞에서 버틴다
  if (style === '추입') return Math.pow(u, 1.4); // 막판에 몰아친다
  return u; // 선입
}

// 퍼레이드 길 누적 길이
const PARADE_CUM: number[] = (() => {
  const cum = [0];
  for (let i = 1; i < RACE_PARADE_PATH.length; i++) {
    const [x0, y0] = RACE_PARADE_PATH[i - 1], [x1, y1] = RACE_PARADE_PATH[i];
    cum.push(cum[i - 1] + Math.hypot(x1 - x0, y1 - y0));
  }
  return cum;
})();
const PARADE_LEN = PARADE_CUM[PARADE_CUM.length - 1];
// 들어갈 때(확정 단계): 주로를 따라 지하마도 입구 앞(퍼레이드 길의 셋째 점)까지 가서 지하마도로 사라진다. 주로·지하마도 밖으로는 나가지 않는다
const TUNNEL = { x: RACE_PARADE_PATH[1][0], y: RACE_PARADE_PATH[1][1] };
const TUNNEL_JOIN_S = nearestLoopS(RACE_PARADE_PATH[2][0], RACE_PARADE_PATH[2][1]);
const HOME_RUN_MS = 18000, HOME_TUNNEL_MS = 2500, HOME_GAP_MS = 900;
function paradePoint(s: number): { x: number; y: number; dir: 0 | 1 | 2 | 3 } {
  const c = Math.max(0, Math.min(PARADE_LEN, s));
  let i = 0;
  while (i < PARADE_CUM.length - 2 && PARADE_CUM[i + 1] < c) i++;
  const [x0, y0] = RACE_PARADE_PATH[i], [x1, y1] = RACE_PARADE_PATH[i + 1];
  const seg = PARADE_CUM[i + 1] - PARADE_CUM[i] || 1, f = (c - PARADE_CUM[i]) / seg;
  const dx = x1 - x0, dy = y1 - y0;
  return { x: lerp(x0, x1, f), y: lerp(y0, y1, f), dir: (Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 2 : 1) : (dy > 0 ? 0 : 3)) as 0 | 1 | 2 | 3 };
}

// ---- 프레임 계산 (순수: 같은 입력이면 같은 장면) ----
export function derbyFrame(input: DerbyShowInput): DerbyFrame {
  const { n, runners, result, distance } = input;
  const ms = ((input.ms % DERBY_CYCLE_MS) + DERBY_CYCLE_MS) % DERBY_CYCLE_MS;
  const phase = derbyPhaseAt(ms).phase;
  const byGate = new Map(runners.map((r) => [r.gate, r]));
  const pack = packOrderOf(n).filter((g) => byGate.has(g)); // 출전표에 있는 말만 (일부만 와도 버틴다)
  const packRank = new Map(pack.map((g, i) => [g, i]));
  const order = result?.order.length === 8 ? result.order : null;
  const finalRank = new Map<number, number>();
  for (let g = 1; g <= 8; g++) finalRank.set(g, order ? order.indexOf(g) : (packRank.get(g) ?? 0));
  const travel = travelOf(distance), startIdx = startIndexOf(distance);
  const spliceMs = result ? result.spliceMs : DERBY_RACE_END_MS;
  const arrived = !!result && ms >= result.spliceMs; // 이 시각에 결과가 와 있는가 (아직이면 대열·서성이 유지)
  const q = arrived ? clamp01((ms - spliceMs) / 6000) : 0; // 결과 경로로 이어 붙이기 (6초에 걸쳐. 늦으면 세리머니까지 이어진다)
  const raceU = clamp01((ms - DERBY_RACE_START_MS) / (DERBY_RACE_END_MS - DERBY_RACE_START_MS));

  // 경주 중 선두 (진행 거리로만 판정. x/y 좌표가 아니라 달린 거리다)
  let leaderGate = 0;
  if (phase === 'race') {
    let best = -Infinity;
    for (const [g, r] of byGate) {
      const { d } = racePose(r, raceU, travel, finalRank.get(g) ?? 0, result, q, packRank.get(g) ?? 0);
      if (d > best) { best = d; leaderGate = g; }
    }
  }

  // 세리머니 입장표 (각자 결승을 밟은 순간. 결과·거리·순위만으로 정해지므로 프레임마다 같다)
  let entries: Map<number, CeremonyEntry | null> | null = null;
  if (result && (phase === 'ceremony' || phase === 'payout')) {
    entries = new Map();
    for (let g = 1; g <= 8; g++) {
      const r = byGate.get(g);
      if (!r) continue;
      entries.set(g, ceremonyEntry(r, travel, startIdx, finalRank.get(g) ?? 0, packRank.get(g) ?? 0, result));
    }
  }
  const horses: DerbyHorseView[] = [];
  for (let g = 1; g <= 8; g++) {
    const r = byGate.get(g);
    if (!r) continue;
    horses.push(horseAt(g, r, { ms, phase, packRank: packRank.get(g) ?? 0, finalRank: finalRank.get(g) ?? 0, travel, startIdx, raceU, q, result, n, entries }));
  }
  return { input: { ...input, ms }, phase, horses, leaderGate };
}

// 게이트 박스 차선 (게이트 단계 박스 자리와 경주 시작 자세가 같아야 이어진다)
function boxLaneOf(gate: number): number { return (gate - 4.5) * 0.55; }
// 경주 구간에서 한 마리의 주로 위 거리·차선 (출발 대열과 결과 경로를 q 로 섞는다)
// u=0 에서는 대열·결과 경로 모두 게이트 박스 자세(-0.6, 박스 차선)라 결과가 언제 와도 시작이 어긋나지 않는다
function racePose(r: DerbyRunner, u: number, travel: number, rank: number, result: DerbyResult | null, q: number, prank: number): { d: number; lane: number; uu: number } {
  const packEnd = travel * 0.7; // 출발 대열: 결승까지 70% 지점까지만 달린다 (늦게 와도 이어 붙일 수 있게)
  const uc = Math.min(u, 1);
  const packD = -0.6 + (packEnd + 0.6) * easeInOut(uc) - prank * 0.9 * Math.sin(uc * Math.PI / 2);
  const box = boxLaneOf(r.gate);
  const packL = box + ((prank % 3 - 1) * 0.5 - box) * clamp01(uc * 2);
  if (!result) return { d: packD, lane: packL, uu: uc };
  const crossU = 0.93 + rank * 0.01; // 1착이 먼저 밟고 순위당 약 0.4초 간격
  const startDelay = (r.gate - 1) * 0.004;
  const uuRaw = (u - startDelay) / Math.max(0.001, crossU - startDelay);
  const uu = clamp01(uuRaw);
  let f = styleCurve(r.style, uu);
  const ev = result.event?.gate === r.gate ? result.event.kind : null;
  if (ev === 'drop' || ev === 'fall') f *= 1 - 0.35 * clamp01((uu - 0.62) / 0.2); // 4코너부터 처진다
  if (ev === 'boost') f = Math.min(1.04, f + 0.1 * clamp01((uu - 0.7) / 0.3)); // 막판 바깥에서 몰아친다
  let raceD = -0.6 + (travel + 0.6) * f;
  if (uuRaw > 1) raceD += (uuRaw - 1) * 10; // 결승을 밟고도 관성으로 조금 더 (uu=1 에서 끊기지 않게 f(1)에서 잇는다)
  if (ev === 'fall') raceD = Math.min(raceD, -0.6 + (travel + 0.6) * 0.66 + travel * 0.1 * uu); // 낙마한 말은 riderless 로 꼴찌
  const raceT = ev === 'boost' ? 1.6 : ev === 'fall' ? -1 : (rank % 3 - 1) * 0.5;
  const raceL = box + (raceT - box) * clamp01(uu * 2.5);
  return { d: packD * (1 - q) + raceD * q, lane: packL * (1 - q) + raceL * q, uu };
}
// 결과 없을 때 서성이는 자리 (대열 끝 자세를 맴돈다. 결승 선언 없음)
function holdCenter(r: DerbyRunner, c: HorseCtx): { x: number; y: number } {
  const p = racePose(r, 1, c.travel, c.packRank, null, 0, c.packRank);
  return loopPoint(c.startIdx + p.d, p.lane);
}
// 서성이는 반경은 경주 끝(280000)에서 0 으로 시작해 8초에 걸쳐 커진다 (결승 정각 연속). 어느 시각에 보든 같은 자리라 도중에 결과가 와도 튀지 않는다
function holdPose(r: DerbyRunner, c: HorseCtx, ms: number): { x: number; y: number; dir: 0 | 1 | 2 | 3 } {
  const hc = holdCenter(r, c);
  const a = ms / 6000 + r.gate * 0.8, m = easeInOut((ms - DERBY_RACE_END_MS) / 8000);
  return { x: hc.x + Math.cos(a) * 1.5 * m, y: hc.y + Math.sin(a) * 1.0 * m, dir: Math.cos(a) > 0 ? 2 : 1 };
}
// 기승 한 바퀴의 시작·끝 각도 (슬롯 방향의 타원 위 점. 퍼레이드 인계도 같은 점이다)
function mountLapAngle(gate: number): number {
  const [sx, sy] = RACE_PADDOCK_SLOTS[gate - 1];
  const R = RACE_PADDOCK_RING;
  return Math.atan2((sy - R.cy) / R.ry, (sx - R.cx) / R.rx);
}
function mountLapPose(gate: number, a: number): { x: number; y: number } {
  void gate;
  const R = RACE_PADDOCK_RING;
  return { x: R.cx + Math.cos(a) * R.rx, y: R.cy + Math.sin(a) * R.ry };
}
// 예시장 행진: 마번 순으로 같은 타원을 돈다 (공유 경로라 순서가 보인다)
function processionSpot(gate: number, ms: number): { x: number; y: number; dir: 0 | 1 | 2 } {
  const R = RACE_PADDOCK_RING;
  const a = (ms / 100000) * Math.PI * 2 * 0.75 - (gate - 1) * (Math.PI * 2 / 8);
  const x = R.cx + Math.cos(a) * R.rx, y = R.cy + Math.sin(a) * R.ry;
  return { x, y, dir: R.cx + Math.cos(a + 0.05) * R.rx >= x ? 2 : 1 };
}

interface HorseCtx {
  ms: number; phase: DerbyPhase; packRank: number; finalRank: number;
  travel: number; startIdx: number; raceU: number; q: number; result: DerbyResult | null; n: number;
  entries: Map<number, CeremonyEntry | null> | null;
}
function horseAt(gate: number, r: DerbyRunner, c: HorseCtx): DerbyHorseView {
  const { phase } = c;
  const base: DerbyHorseView = {
    gate, x: 0, y: 0, dir: 2, gait: 'stand', progress: -1, rear: 0, jump: 0, side: 0,
    headLow: false, headHigh: false, rider: false, riderDown: false, groom: true, hidden: false,
  };
  switch (phase) {
    case 'paddock': return paddockHorse(gate, r, c, base);
    case 'mount': return mountHorse(gate, r, c, base);
    case 'parade': return paradeHorse(gate, r, c, base);
    case 'warmup': return warmupHorse(gate, r, c, base);
    case 'gate': return gateHorse(gate, r, c, base);
    case 'race': return raceHorse(gate, r, c, base);
    case 'ceremony': return ceremonyHorse(gate, r, c, base);
    case 'payout': return payoutHorse(gate, r, c, base);
  }
}

// 사나운 말의 좌우 날뜀 (기승 단계로 넘어갈 때 같은 값에서 이어받는다)
function paddockWob(r: DerbyRunner, gate: number, ms: number): number { return r.behavior === 'wild' ? Math.sin(ms / 130 + gate * 2) * 0.4 : 0; }
// 예시장 주회: 마번 순으로 같은 타원을 돈다 (공유 행진. 순서가 보인다). 몸짓 7종이 여기서 보인다
function paddockHorse(gate: number, r: DerbyRunner, c: HorseCtx, v: DerbyHorseView): DerbyHorseView {
  const s = processionSpot(gate, c.ms);
  const wob = paddockWob(r, gate, c.ms);
  v.x = s.x + wob; v.y = s.y;
  v.dir = s.dir;
  v.gait = r.behavior === 'lazy' ? 'walk' : r.behavior === 'gallopIn' ? 'trot' : 'walk';
  if (r.behavior === 'dash') v.jump = Math.pow(Math.max(0, Math.sin(c.ms / 700 + gate)), 12); // 점프하며 등장·힘찬 걸음
  else if (r.behavior === 'wild') v.rear = Math.pow(Math.max(0, Math.sin(c.ms / 1100 + gate * 1.7)), 8); // 사나움(날뛰고 앞발 들기)
  else if (r.behavior === 'side') v.side = 0.7 + 0.3 * Math.sin(c.ms / 900 + gate); // 옆으로 걸으며 등장
  else if (r.behavior === 'lazy') v.headLow = true; // 설렁설렁 등장
  else if (r.behavior === 'calm') v.headLow = false; // 차분하게 걷기 (잔잔한 걸음. headHigh 도 없이)
  else if (r.behavior === 'unseat') v.rear = Math.pow(Math.max(0, Math.sin(c.ms / 9000 + gate)), 24) * 0.6; // 가끔 흠칫
  v.groom = true;
  return v;
}
// 기승: 자리로 걸어가 멈추고 기수가 오른 뒤 한 바퀴 돈다. unseat 는 떨어뜨렸다 다시 태운다
function mountHorse(gate: number, r: DerbyRunner, c: HorseCtx, v: DerbyHorseView): DerbyHorseView {
  const stopT = 102000 + (gate - 1) * 2400; // 1번마도 최소 2초는 걸어서 간다 (행진 자리에서 시작점으로 순간이동하지 않게)
  const from = processionSpot(gate, 100000);
  const wob0 = paddockWob(r, gate, 100000); // 예시장 마지막 순간의 날뜀 자리에서 이어받아 걸으며 지운다
  const a0 = mountLapAngle(gate);
  const lapStart = mountLapPose(gate, a0);
  if (c.ms < stopT) { // 행진에서 빠져 기승 한 바퀴 시작점으로
    const p = easeInOut((c.ms - 100000) / Math.max(1, stopT - 100000));
    v.x = lerp(from.x + wob0, lapStart.x, p); v.y = lerp(from.y, lapStart.y, p);
    v.dir = lapStart.x >= from.x ? 2 : 1; v.gait = 'walk';
  } else { // 기승 뒤 한 바퀴: 시작점에서 타원을 한 바퀴 돈다 (끝 = 시작점)
    const k = clamp01((c.ms - stopT - 1500) / Math.max(1, 130000 - stopT - 1500));
    const a = a0 + k * Math.PI * 2;
    const p = mountLapPose(gate, a);
    v.x = p.x; v.y = p.y;
    const p2 = mountLapPose(gate, a + 0.05);
    v.dir = p2.x >= v.x ? 2 : 1; v.gait = 'trot';
  }
  const mountedAt = stopT + 1500;
  if (r.behavior === 'unseat') {
    const fellAt = stopT + 2000, remountAt = 122000 + gate * 500;
    if (c.ms < mountedAt) { v.rider = false; }
    else if (c.ms < remountAt) { v.rider = false; v.riderDown = c.ms >= fellAt; v.rear = c.ms < fellAt + 800 ? 0.7 : 0; }
    else { v.rider = true; v.jump = Math.pow(Math.max(0, Math.sin((c.ms - remountAt) / 300)), 2) * (c.ms - remountAt < 900 ? 0.5 : 0); }
  } else v.rider = c.ms >= mountedAt;
  v.groom = true;
  return v;
}
// 퍼레이드: 예시장 → 지하마도 → 관람대 앞 마번 순 일렬 (뛰어서 입장은 여기서 힘차게)
function paradeHorse(gate: number, r: DerbyRunner, c: HorseCtx, v: DerbyHorseView): DerbyHorseView {
  const p = clamp01((c.ms - 130000) / 30000);
  const s = p * (PARADE_LEN + 10) - 10 - (gate - 1) * PARADE_GAP;
  if (s < 0) { // 아직 예시장 안: 기승 한 바퀴 끝자리에서 입구로 모인다
    const from = mountLapPose(gate, mountLapAngle(gate) + Math.PI * 2); // 기승 한 바퀴 끝 = 시작점
    const [ex, ey] = RACE_PARADE_PATH[0];
    const k = easeInOut(clamp01(1 + s / 10));
    v.x = lerp(from.x, ex, k); v.y = lerp(from.y, ey, k);
    v.dir = ex >= from.x ? 2 : 1; v.gait = 'walk';
  } else {
    const pt = paradePoint(Math.min(PARADE_LEN, s));
    v.x = pt.x; v.y = pt.y; v.dir = pt.dir;
    v.gait = r.behavior === 'gallopIn' ? 'gallop' : 'trot'; // 뛰어서 입장
    if (r.behavior === 'dash') v.jump = Math.pow(Math.max(0, Math.sin(c.ms / 600 + gate)), 12) * 0.7;
  }
  v.rider = true; v.groom = s < PARADE_LEN * 0.4;
  return v;
}
// 출발대 뒤 원 돌기의 각도: 준비운동(1/1400)에서 게이트 단계(1/1200)로 넘어가도 끊기지 않게 200000ms 에서 이어 붙인다
function circleAngle(gate: number, ms: number): number {
  return gate * 0.8 + (ms < 200000 ? ms / 1400 : 200000 / 1400 + (ms - 200000) / 1200);
}
// 준비운동: 주로를 따라 반대 방향으로 가볍게 달려 거리별 출발대 쪽으로 (안쪽 잔디밭을 가로지르지 않는다)
function warmupHorse(gate: number, r: DerbyRunner, c: HorseCtx, v: DerbyHorseView): DerbyHorseView {
  const p = easeInOut((c.ms - 160000) / 40000);
  const from = paradePoint(Math.max(0, PARADE_LEN - (gate - 1) * PARADE_GAP));
  const sA = c.startIdx - 2.5 - gate * 0.3;
  const asm = loopPoint(sA, 0);
  if (p < 0.8) {
    const k = easeInOut(p / 0.8);
    const s0 = nearestLoopS(from.x, from.y), base = loopPoint(s0, 0);
    const back = (((s0 - sA) % LOOP_LEN) + LOOP_LEN) % LOOP_LEN; // 경주 반대 방향으로 갈 거리
    const pt = loopPoint(s0 - back * k, 0), ahead = loopPoint(s0 - back * k - 0.05, 0);
    v.x = pt.x + (from.x - base.x) * (1 - k); v.y = pt.y + (from.y - base.y) * (1 - k); // 퍼레이드 끝자리의 차선 어긋남은 서서히 지운다
    v.dir = dirOf(ahead.x - pt.x, ahead.y - pt.y);
  } else { // 출발대 뒤에서 원을 그린다 (반지름 0 에서 시작해 게이트 단계의 원 크기까지 커진다)
    const rad = easeInOut((p - 0.8) / 0.2), a = circleAngle(gate, c.ms);
    v.x = asm.x + Math.cos(a) * 1.8 * rad; v.y = asm.y + Math.sin(a) * 1.2 * rad;
    v.dir = Math.cos(a) > 0 ? 2 : 1;
  }
  v.gait = 'gallop';
  if (r.behavior === 'unseat' && c.ms > 190000) v.riderDown = false; // 이미 다시 탔다 (기승 단계에서)
  v.rider = true; v.groom = false;
  if (r.behavior === 'dash') v.headHigh = true;
  return v;
}
// 게이트 입장: 차례로 게이트에 들어간다
const GATE_WALK_MS = 5000;
function gateHorse(gate: number, r: DerbyRunner, c: HorseCtx, v: DerbyHorseView): DerbyHorseView {
  const walkT = 200000 + (gate - 1) * 3500, enterT = walkT + GATE_WALK_MS; // walkT 에 원에서 빠져 주로를 따라 박스로 걸어가고 enterT 에 들어선다
  const sAsm = c.startIdx - 2.5 - gate * 0.3, sBox = c.startIdx - 0.6, laneBox = boxLaneOf(gate);
  const box = loopPoint(sBox, laneBox);
  if (c.ms < enterT) {
    const e = easeInOut((c.ms - walkT) / GATE_WALK_MS), a = circleAngle(gate, c.ms);
    const ctr = loopPoint(lerp(sAsm, sBox, e), lerp(0, laneBox, e)); // 원의 중심이 박스로 옮겨 가며 원 반지름은 0 으로 줄어든다
    v.x = ctr.x + Math.cos(a) * 1.8 * (1 - e); v.y = ctr.y + Math.sin(a) * 1.2 * (1 - e);
    v.dir = e > 0.5 ? box.dir : Math.cos(a) > 0 ? 2 : 1; v.gait = 'trot';
  } else {
    v.x = box.x; v.y = box.y; v.dir = box.dir; v.gait = 'stand';
    if (r.behavior === 'wild' && c.ms < enterT + 4000) v.rear = Math.pow(Math.max(0, Math.sin(c.ms / 500)), 6) * 0.8;
  }
  v.rider = true; v.groom = false;
  return v;
}
// 경주: 출발 대열 → 결과 경로. 선행은 앞에서 버티고 추입은 막판에. boost 바깥 늦추입, drop 4코너 처짐, fall 낙마
// 낙마는 결과 시각·낙마 지점 중 늦은 쪽에서 2.5초에 걸쳐 일어난다 (늦게 온 결과에도 기수가 튀지 않는다)
const FALL_AT_MS = DERBY_RACE_START_MS + 0.62 * (DERBY_RACE_END_MS - DERBY_RACE_START_MS);
function raceHorse(gate: number, r: DerbyRunner, c: HorseCtx, v: DerbyHorseView): DerbyHorseView {
  const { d, lane } = racePose(r, c.raceU, c.travel, c.finalRank, c.result, c.q, c.packRank);
  const pt = loopPoint(c.startIdx + d, lane);
  const ev = c.result?.event?.gate === gate ? c.result.event.kind : null;
  const fallen = ev === 'fall' && !!c.result && c.ms >= Math.max(c.result.spliceMs, FALL_AT_MS);
  v.x = pt.x; v.y = pt.y; v.dir = pt.dir; v.progress = d;
  v.gait = fallen ? 'trot' : c.raceU > 0.97 ? 'trot' : 'gallop';
  if (fallen) { v.rider = false; v.riderDown = true; v.headLow = true; } // 낙마: riderless 로 꼴찌
  else { v.rider = true; if (ev === 'boost') v.headHigh = true; if (ev === 'drop' && c.raceU > 0.7) v.headLow = true; if (ev === 'place' && c.raceU > 0.9 && c.finalRank <= 2) v.headHigh = true; }
  v.groom = false;
  return v;
}
// 세리머니 입장 = 각자 결승을 밟은 순간 (전체 시계가 아니다)
// 결승을 못 밟는 말(낙마로 거리가 묶인 말)은 경주가 끝나는 순간(ts=0)의 자리에서 입장해 같은 멈춤 자리로 걸어간다
// (결과가 늦게 와도 같은 멈춤 자리로 모이게). 입력(결과·거리·순위)에만 의존하므로 프레임마다 다시 찾아도 같은 값이다
interface CeremonyEntry { tStar: number; s: number; lane: number }
function ceremonyEntry(r: DerbyRunner, travel: number, startIdx: number, rank: number, prank: number, result: DerbyResult): CeremonyEntry {
  const poseAt = (ts: number) => racePose(r, Math.min(1 + ts / 40000, 1.6), travel, rank, result, clamp01((DERBY_RACE_END_MS + ts - result.spliceMs) / 6000), prank);
  for (let ts = 0; ts <= 40000; ts += 250) {
    const rp = poseAt(ts);
    if (rp.d >= travel) return { tStar: ts, s: startIdx + rp.d, lane: rp.lane }; // 경주 끝 자세 그대로 이어받는다 (잘라내면 결승선 너머로 달려 나간 말이 뒤로 튄다)
  }
  const rp = poseAt(0);
  return { tStar: 0, s: startIdx + Math.min(rp.d, travel + 1.5), lane: rp.lane };
}
function endLaneOf(r: DerbyRunner, rank: number, result: DerbyResult | null): number {
  const ev = result?.event?.gate === r.gate ? result.event.kind : null;
  return ev === 'boost' ? 1.6 : ev === 'fall' ? -1 : (rank % 3 - 1) * 0.5;
}
interface CeremonyTarget { s: number; lane: number; x: number; y: number; dir: 0 | 1 | 2 | 3; gait: 'stand' | 'walk' | 'trot'; hidden: boolean; rider: boolean; riderDown: boolean; headHigh: boolean; headLow: boolean; rear: number }
// 세리머니 목표 자세 (tau = 입장·도착부터의 각자 시계, s0·lane0 = 결승을 밟은 주로 위 자리)
// 결승을 지나 주로를 따라 감속해 멈춘다 (주로 밖으로 나가지 않는다). 멈출 자리는 순위·결과로만 정해서 결과가 늦게 와도 같은 자리로 모인다.
// 늦게 들어온 말일수록 조금 뒤에 멈춘다. 우승마는 멈춘 자리에서 앞발을 들어 세리머니
const STOP_SEG = 2.6, STOP_MS = 14000;
// 결과가 제때 와 있을 때(q=1) 경주 끝 시각에 결승선 너머로 달려 나가 있는 거리. 결과가 얼마나 늦게 오든 같은 값이라 멈춤 자리가 늦은 결과에도 같다.
// 멈춤 자리가 이보다 뒤에 있으면 세리머니가 시작되는 순간 말이 뒤로 걸어야 해서(기세로 몰아친 말) 넘어선 만큼 더 간 곳에서 멈춘다
function overrunOf(r: DerbyRunner, c: HorseCtx): number {
  return Math.max(0, racePose(r, 1, c.travel, c.finalRank, c.result, 1, c.packRank).d - c.travel);
}
function ceremonyTarget(r: DerbyRunner, c: HorseCtx, tau: number, s0: number, lane0: number, fall: boolean): CeremonyTarget {
  const rank = c.finalRank;
  const sEnd = c.startIdx + c.travel + Math.max(0.4, STOP_SEG - rank * 0.3, overrunOf(r, c) + 0.8), laneEnd = endLaneOf(r, rank, c.result);
  const k = clamp01(tau / STOP_MS), eo = 1 - (1 - k) * (1 - k);
  const s = lerp(s0, sEnd, eo), lane = lerp(lane0, laneEnd, eo);
  const pt = loopPoint(s, lane);
  const stopped = k >= 1, win = rank === 0 && !fall;
  return {
    s, lane, x: pt.x, y: pt.y, dir: pt.dir, gait: k < 0.5 ? 'trot' : stopped ? 'stand' : 'walk',
    hidden: false, rider: !fall, riderDown: fall, headHigh: win, headLow: fall,
    rear: win && stopped ? Math.pow(Math.max(0, Math.sin(c.ms / 1000)), 6) : 0,
  };
}
function ceremonyHorse(gate: number, r: DerbyRunner, c: HorseCtx, v: DerbyHorseView): DerbyHorseView {
  const rank = c.finalRank;
  const t = c.ms - 280000;
  const active = !!c.result && c.ms >= c.result.spliceMs; // 이 시각에 결과가 와 있는가
  const fall = !!c.result && c.result.event?.gate === gate && c.result.event.kind === 'fall';
  if (!active) {
    // 결과 없음(또는 아직 안 옴): 결승 선언 없이 결승선 앞에서 서성인다 (위너 서클·퇴장 없음)
    const h = holdPose(r, c, c.ms);
    v.x = h.x; v.y = h.y; v.dir = h.dir; v.gait = 'walk';
    v.rider = true; v.groom = false;
    return v;
  }
  const res = c.result!;
  const tArr = res.spliceMs - DERBY_RACE_END_MS;
  if (tArr > 0) {
    // 세리머니 도중에 결과가 왔다: 도착 순간의 실제 서성이 자세에서 8초에 걸쳐 주로를 따라 목표 자세로
    // (서성이던 자리 → 결승 너머는 주로 위 거리·차선으로 섞는다. 직선으로 가로지르면 안쪽 잔디밭으로 들어간다)
    const holdAtArr = holdPose(r, c, res.spliceMs);
    const hp = racePose(r, 1, c.travel, c.packRank, null, 0, c.packRank);
    const hBase = loopPoint(c.startIdx + hp.d, hp.lane);
    const tau = t - tArr;
    const tgt = ceremonyTarget(r, c, tau, c.startIdx + c.travel, endLaneOf(r, rank, res), fall);
    const b = easeInOut(tau / 8000);
    const pt = loopPoint(lerp(c.startIdx + hp.d, tgt.s, b), lerp(hp.lane, tgt.lane, b));
    v.x = pt.x + (holdAtArr.x - hBase.x) * (1 - b); v.y = pt.y + (holdAtArr.y - hBase.y) * (1 - b);
    v.dir = b > 0.5 ? tgt.dir : holdAtArr.dir; v.gait = b > 0.5 ? tgt.gait : 'walk';
    v.rider = tgt.rider; v.riderDown = tgt.riderDown; v.headHigh = tgt.headHigh; v.headLow = tgt.headLow; v.rear = tgt.rear;
    v.hidden = tgt.hidden && b >= 1; v.groom = false;
    return v;
  }
  // 세리머니 시작 전에 결과가 와 있다: 각자 결승을 밟은 순간에 입장한다
  const entry = c.entries?.get(gate) ?? null;
  const qCer = clamp01((c.ms - res.spliceMs) / 6000);
  if (!entry || t < entry.tStar) {
    // 아직 결승 전: 경주를 이어 달린다 (뒷말도 결승을 밟고 합류한다)
    const rp = racePose(r, Math.min(1 + t / 40000, 1.6), c.travel, rank, res, qCer, c.packRank);
    const pt = loopPoint(c.startIdx + Math.min(rp.d, c.travel + 1.5), rp.lane);
    const fallen = fall && c.ms >= Math.max(res.spliceMs, FALL_AT_MS);
    v.x = pt.x; v.y = pt.y; v.dir = pt.dir; v.progress = Math.min(rp.d, c.travel + 1.5);
    v.gait = fallen ? 'trot' : 'gallop';
    v.rider = !fallen; v.riderDown = fallen; v.headLow = fallen;
    v.groom = false; v.hidden = false;
    return v;
  }
  const tau = t - entry.tStar;
  const tgt = ceremonyTarget(r, c, tau, entry.s, entry.lane, fall);
  v.x = tgt.x; v.y = tgt.y; v.dir = tgt.dir; v.gait = tgt.gait;
  v.rider = tgt.rider; v.riderDown = tgt.riderDown; v.headLow = tgt.headLow; v.headHigh = tgt.headHigh; v.rear = tgt.rear;
  v.hidden = tgt.hidden; v.groom = false;
  return v;
}
// 확정 배당: 세리머니 끝 자세(결과 없으면 서성이던 자세)에서 주로를 따라 지하마도 입구 앞까지 가서 지하마도로 사라진다.
// 주로·지하마도 밖(마방·풀밭·펜스 너머)으로는 가지 않는다. 다음 경주 출전마는 다음 주기 시작에 예시장에서 바로 보인다
function blankHorseView(gate: number): DerbyHorseView {
  return { gate, x: 0, y: 0, dir: 2, gait: 'stand', progress: -1, rear: 0, jump: 0, side: 0, headLow: false, headHigh: false, rider: false, riderDown: false, groom: false, hidden: false };
}
// start: 출발 자세 (시작 순간 그대로 이어진다), s0: 출발 자세 근처의 주로 위 거리, t: 확정 단계 경과, delay: 각자 출발 지연
function homeRun(v: DerbyHorseView, start: { x: number; y: number; dir: 0 | 1 | 2 | 3 }, s0: number, t: number, delay: number): DerbyHorseView {
  const ka = (t - delay) / HOME_RUN_MS;
  if (ka <= 0) { v.x = start.x; v.y = start.y; v.dir = start.dir; v.gait = 'stand'; return v; }
  const sN = ((s0 % LOOP_LEN) + LOOP_LEN) % LOOP_LEN;
  const fwd = (((TUNNEL_JOIN_S - sN) % LOOP_LEN) + LOOP_LEN) % LOOP_LEN;
  const delta = fwd <= LOOP_LEN / 2 ? fwd : fwd - LOOP_LEN; // 주로를 따라 지하마도 입구 앞까지 가까운 쪽으로
  if (ka < 1) {
    const k = easeInOut(ka), base = loopPoint(sN, 0);
    const s = sN + delta * k, pt = loopPoint(s, 0), ahead = loopPoint(s + Math.sign(delta || 1) * 0.05, 0);
    v.x = pt.x + (start.x - base.x) * (1 - k); v.y = pt.y + (start.y - base.y) * (1 - k); // 출발 자세의 차선 어긋남은 서서히 지운다
    v.dir = dirOf(ahead.x - pt.x, ahead.y - pt.y); v.gait = 'trot';
    return v;
  }
  const kb = (t - delay - HOME_RUN_MS) / HOME_TUNNEL_MS;
  const join = loopPoint(TUNNEL_JOIN_S, 0);
  if (kb >= 1) { v.x = TUNNEL.x; v.y = TUNNEL.y; v.hidden = true; return v; }
  v.x = lerp(join.x, TUNNEL.x, kb); v.y = lerp(join.y, TUNNEL.y, kb);
  v.dir = dirOf(TUNNEL.x - join.x, TUNNEL.y - join.y); v.gait = 'walk';
  return v;
}
function payoutHorse(gate: number, r: DerbyRunner, c: HorseCtx, v: DerbyHorseView): DerbyHorseView {
  const t = c.ms - 320000;
  const active = !!c.result && c.ms >= c.result.spliceMs; // 이 시각에 결과가 와 있는가
  v.groom = false;
  if (!active) {
    const h = holdPose(r, c, c.ms);
    const hp = racePose(r, 1, c.travel, c.packRank, null, 0, c.packRank);
    v.rider = true;
    return homeRun(v, h, c.startIdx + hp.d, t, c.packRank * HOME_GAP_MS);
  }
  const res = c.result!;
  const fall = res.event?.gate === gate && res.event.kind === 'fall';
  // 시작 = 세리머니 끝 자세 (같은 입력의 319999ms 장면). 낙마는 기수 없이 들어간다
  const endV = ceremonyHorse(gate, r, { ...c, ms: DERBY_RACE_END_MS + 39999, phase: 'ceremony' }, blankHorseView(gate));
  v.rider = !fall; v.riderDown = fall; v.headLow = fall;
  return homeRun(v, endV, nearestLoopS(endV.x, endV.y), t, c.finalRank * HOME_GAP_MS);
}

// ---- 장내 방송 자막 (한국어. SPEC 시간표 문구 그대로. 출전표가 비어 있어도 버틴다) ----
export interface DerbyCaptionInfo {
  n: number;
  distance?: DerbyDistance; // 장면과 같은 스냅샷의 실제 거리 (리더 계산용. 없으면 n 으로 추정한다. 티켓 판 호환용)
  runners: DerbyRunner[];
  result: DerbyResult | null;
  winOdds?: { [gate: number]: number | null } | null; // 실제 단승 배당. 없으면 배당을 쓰지 않는다
}
export function derbyCaption(ms: number, info: DerbyCaptionInfo): string {
  const t = ((ms % DERBY_CYCLE_MS) + DERBY_CYCLE_MS) % DERBY_CYCLE_MS;
  const { n, runners, result } = info;
  const distance = info.distance ?? derbyDistanceFor(n); // 호출 쪽이 스냅샷 거리를 안 주면 추정 (티켓 판 호환. world/dev 는 실제 값을 준다)
  const arrived = !!result && ms >= result.spliceMs; // 이 시각에 결과가 와 있는가
  if (t < 100000) return `${raceClock(n)} 경주 출전마 예시 중입니다`;
  if (t < 130000) return '기수 기승';
  if (t < 160000) {
    const ordered = [...runners].sort((a, b) => a.gate - b.gate);
    if (!ordered.length) return `${raceClock(n)} 경주 출전마 입장 중입니다`;
    const r = ordered[Math.min(ordered.length - 1, Math.floor((t - 130000) / 30000 * 8))];
    const odd = info.winOdds?.[r.gate];
    const oddText = typeof odd === 'number' && isFinite(odd) ? `, 단승 ${odd.toFixed(1)}배` : ''; // 실제 값 없으면 숫자를 지어내지 않는다
    return `${r.gate}번 ${r.name}, 기수 ${r.jockey}${oddText}`;
  }
  if (t < 200000) return `${raceClock(n)} 경주 준비운동 중입니다`;
  if (t < 240000) return '마권 발매 마감 30초 전';
  if (t < 280000) {
    const u = (t - 240000) / 40000;
    if (u < 0.55) return `${raceClock(n)} 경주 출발!`;
    const fr = derbyFrame({ n, ms: t, distance, runners, result });
    if (!fr.leaderGate) return `${raceClock(n)} 경주 진행 중입니다`;
    return `${u < 0.8 ? 3 : 4}코너 돌아 선두는 ${fr.leaderGate}번`;
  }
  if (t < 320000) {
    const order = arrived && result?.order.length === 8 ? result.order : null;
    if (order) return `1착 ${order[0]}번, 2착 ${order[1]}번, 3착 ${order[2]}번`;
    return `${raceClock(n)} 경주 결과 확인 중입니다`; // 결과 없으면 결승 선언 없음
  }
  if (arrived && result?.order.length === 8) return `${raceClock(n)} 경주 승식별 확정 배당`;
  return `${raceClock(n)} 경주 결과 확인 중입니다`;
}

// ---- 소리 (경계에서 한 번씩. 호출 쪽이 serverNow 기준으로 부른다) ----
export type DerbySound = 'derbyBell' | 'gate' | 'fanfare' | 'cheer';
export function derbySoundEvents(prevMs: number, ms: number, hasResult = true): DerbySound[] {
  const out: DerbySound[] = [];
  const crossed = (at: number) => {
    const p = ((prevMs % DERBY_CYCLE_MS) + DERBY_CYCLE_MS) % DERBY_CYCLE_MS;
    const c = ((ms % DERBY_CYCLE_MS) + DERBY_CYCLE_MS) % DERBY_CYCLE_MS;
    return p < at && c >= at; // 주기 경계(6:00→0:00)를 넘어가면 p>c 라 아무 일도 없음
  };
  if (crossed(100000)) out.push('derbyBell'); // 기승 종
  if (crossed(240000)) out.push('gate', 'fanfare'); // 게이트 열림 + 팡파르
  if (hasResult && crossed(279000)) out.push('cheer'); // 결승 함성 (결과가 있을 때만: 확정 전에는 결승 선언 없음)
  return out;
}
export function derbyHoofActive(ms: number): boolean { return derbyPhaseAt(ms).phase === 'race'; }

// ---- 카메라: 관람석에 앉아 있으면 경주 40초 동안 선두 무리를 따라간다 (진행 거리 순) ----
export function derbyFocusAt(frame: DerbyFrame): { x: number; y: number } {
  const top = frame.horses
    .filter((h) => !h.hidden && h.progress >= 0)
    .sort((a, b) => b.progress - a.progress)
    .slice(0, 3);
  if (!top.length) { const fin = loopPoint(0, 0); return { x: fin.x, y: fin.y }; } // 경주 밖·빈 출전표: 결승선
  let x = 0, y = 0;
  for (const h of top) { x += h.x; y += h.y; }
  return { x: x / top.length, y: y / top.length };
}
// 예시장 펜스 앞에서 가장 가까운 출전마 (있는 말만, maxDist 타일 안)
export interface DerbyNearbyRunner { gate: number; name: string; x: number; y: number }
export function derbyNearestRunner(frame: DerbyFrame, x: number, y: number, maxDist = 4): DerbyNearbyRunner | null {
  let best: DerbyHorseView | null = null, bd = Infinity;
  for (const h of frame.horses) {
    if (h.hidden) continue;
    const d = Math.abs(h.x - x) + Math.abs(h.y - y);
    if (d < bd) { bd = d; best = h; }
  }
  if (!best || bd > maxDist) return null;
  const r = frame.input.runners.find((rr) => rr.gate === best!.gate);
  return { gate: best.gate, name: r?.name ?? `${best.gate}번마`, x: best.x, y: best.y };
}

// ---- 그림 ----
// 말 한 마리: 캐릭터·펫과 같은 픽셀 스프라이트(sprites/horse.ts)를 발밑 기준으로 놓는다. px·py: 발밑 한가운데 픽셀
function drawHorse(ctx: CanvasRenderingContext2D, px: number, py: number, v: DerbyHorseView, r: DerbyRunner, now: number): void {
  const [silkA, silkB] = r.silk;
  const lift = (v.jump * 7 + (v.gait === 'gallop' ? Math.abs(Math.sin(now / 130 + v.gate)) * 2 : v.gait === 'trot' ? Math.abs(Math.sin(now / 200 + v.gate)) * 1.5 : 0)) * HORSE_SCALE;
  const facing = v.dir === 1 ? -1 : 1; // 1 왼쪽 · 2 오른쪽 (옆모습), 0·3 은 정면·뒷모습
  const profile = v.dir === 1 || v.dir === 2;
  const rate = v.gait === 'gallop' ? 110 : v.gait === 'trot' ? 170 : 260;
  const frame = v.gait === 'stand' ? 0 : Math.floor(now / rate + v.gate * 1.7) & 3;
  const cx = Math.round(px + (v.side > 0 ? facing * -v.side * 4 * HORSE_SCALE : 0)); // 옆걸음은 옆으로 미끄러지듯
  const foot = Math.round(py - lift - v.rear * 2 * HORSE_SCALE);
  // 그림자 (땅에 붙어 있다)
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(cx, Math.round(py) + 1, (profile ? 14 : 9) * HORSE_SCALE, 3 * HORSE_SCALE, 0, 0, Math.PI * 2); ctx.fill();
  const spr = horseSprite({
    coat: r.coat, silkA, silkB, dir: v.dir, frame, gait: v.gait, rider: v.rider,
    head: v.headLow ? 1 : v.headHigh ? -1 : 0, rear: v.rear > 0.3,
  });
  ctx.drawImage(spr, cx - HORSE_W / 2, foot - HORSE_FOOT);
  // 떨어진 기수 (말 뒤쪽 바닥에 눕는다)
  if (v.riderDown) {
    const fx = cx + (profile ? -facing * 20 : 16) * HORSE_SCALE;
    ctx.drawImage(fallenJockeySprite(silkA, silkB, facing > 0), Math.round(fx - FALLEN_W / 2), Math.round(py) - FALLEN_H + 2 * HORSE_SCALE);
  }
  // 마필관리사 (말 코앞에서 고삐를 끈다. 사람 캐릭터 크기 그대로)
  if (v.groom) {
    const gx = cx + (profile ? facing * 22 : 18) * HORSE_SCALE;
    const gFrame = v.gait === 'stand' ? 0 : Math.floor(now / 180 + v.gate) & 3;
    const hx = cx + (profile ? facing * 16 : 6) * HORSE_SCALE, hy = foot - (profile ? 24 : 21) * HORSE_SCALE;
    const tx = gx - (profile ? facing * 5 : 6), ty = Math.round(py) - 14;
    ctx.fillStyle = '#d9c7a0';
    const steps = Math.max(Math.abs(tx - hx), Math.abs(ty - hy));
    for (let i = 0; i <= steps; i++) ctx.fillRect(Math.round(hx + (tx - hx) * i / steps), Math.round(hy + (ty - hy) * i / steps), 1, 1);
    ctx.drawImage(groomSprite(v.dir, gFrame), Math.round(gx - FRAME_W / 2), Math.round(py) - FRAME_H + 3);
  }
}

// 게이트 박스 + 결승 기둥 (주로 위 고정물. 게이트는 입장 단계부터, 결승선은 항상)
// 게이트 칸은 말 그림 높이에 맞추고 폭은 차선 간격(이웃 칸과 붙는다)
function drawGateBox(ctx: CanvasRenderingContext2D, px: number, py: number, open: boolean): void {
  ctx.fillStyle = open ? '#3f5a3a' : '#2c4433';
  ctx.fillRect(Math.round(px - 10), Math.round(py - 44), 20, 42);
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(Math.round(px - 10), Math.round(py - 47), 20, 4);
  ctx.fillRect(Math.round(px - 10), Math.round(py - 44), 2, 42);
  ctx.fillStyle = open ? '#7fae7f' : '#c9a13b';
  ctx.fillRect(Math.round(px - 10), Math.round(py - 6), 20, 3);
}
function drawFinishPost(ctx: CanvasRenderingContext2D, px: number, py: number): void {
  ctx.fillStyle = '#f4f4f4';
  ctx.fillRect(Math.round(px - 3), Math.round(py - 66), 6, 64);
  ctx.fillStyle = '#c33';
  for (let i = 0; i < 8; i++) ctx.fillRect(Math.round(px - 3), Math.round(py - 66 + i * 8), 6, 4);
}

export interface DerbyDrawItem { y: number; order: number; draw: (ctx: CanvasRenderingContext2D) => void }
// render.ts 가 items 에 섞어 y 순서로 그린다
export function derbyItems(frame: DerbyFrame, now: number): DerbyDrawItem[] {
  const out: DerbyDrawItem[] = [];
  const { input, phase, horses } = frame;
  // 결승 기둥 (결승선 idx 0 자리의 주로 안쪽·바깥쪽 가장자리)
  for (const s of [-3.3, 3.3]) {
    const p = loopPoint(0, s);
    const fx = p.x * TILE + TILE / 2, fy = (p.y + 0.6) * TILE;
    out.push({ y: p.y + 0.6, order: 0, draw: (ctx) => drawFinishPost(ctx, fx, fy) });
  }
  void input;
  // 게이트 박스 8개 (입장 단계부터 보인다. 열린 게이트는 경주 시작 뒤)
  if (phase === 'gate' || phase === 'race') {
    for (let g = 1; g <= 8; g++) {
      const box = loopPoint(startIndexOf(input.distance) - 0.6, (g - 4.5) * 0.55);
      const open = phase === 'race' || input.ms >= 200000 + (g - 1) * 3500;
      const bx = box.x * TILE + TILE / 2, by = (box.y + 0.6) * TILE;
      out.push({ y: box.y + 0.6, order: 0, draw: (ctx) => drawGateBox(ctx, bx, by, open) });
    }
  }
  for (const h of horses) {
    if (h.hidden) continue;
    const r = input.runners.find((x) => x.gate === h.gate);
    if (!r) continue;
    const px = h.x * TILE + TILE / 2, py = (h.y + 0.9) * TILE;
    out.push({ y: h.y + 0.9, order: 1, draw: (ctx) => drawHorse(ctx, px, py, h, r, now) });
  }
  return out;
}

// 마번 고유 색 (마사회 마번 색: 1 흰 · 2 검정 · 3 빨강 · 4 파랑 · 5 노랑 · 6 초록 · 7 주황 · 8 분홍).
// 이름표·마권 판 번호·분점 미니 중계가 같은 색을 써서 색으로 보고 고를 수 있다. bg 바탕 · fg 글자 · edge 테두리
export interface DerbyGateColor { bg: string; fg: string; edge: string }
const GATE_COLORS: ReadonlyArray<DerbyGateColor> = [
  { bg: '#f4f4f4', fg: '#1a1a1a', edge: '#1a1a1a' },
  { bg: '#1f1f1f', fg: '#ffffff', edge: '#d0d0d0' },
  { bg: '#d8312f', fg: '#ffffff', edge: '#ffd0cf' },
  { bg: '#1e5bd8', fg: '#ffffff', edge: '#cfe0ff' },
  { bg: '#f5d000', fg: '#1a1a1a', edge: '#5a4a00' },
  { bg: '#2e9e44', fg: '#ffffff', edge: '#cff0d6' },
  { bg: '#e65100', fg: '#ffffff', edge: '#ffe0c0' }, // 주황은 흰 글자가 읽히게 조금 짙게
  { bg: '#f06ba8', fg: '#ffffff', edge: '#ffd9ea' },
];
export function derbyGateColor(gate: number): DerbyGateColor { return GATE_COLORS[(Math.max(1, Math.floor(gate)) - 1) % GATE_COLORS.length]; }

// 출전마 이름표: 보이는 말마다 "번호 이름"을 마번 색 바탕으로. x·y 는 발밑 한가운데 (월드 픽셀, 점프해도 그림자처럼 제자리)
export interface DerbyNameTag { x: number; y: number; text: string; color: DerbyGateColor }
export function derbyNameTags(frame: DerbyFrame): DerbyNameTag[] {
  const out: DerbyNameTag[] = [];
  for (const h of frame.horses) {
    if (h.hidden) continue;
    const r = frame.input.runners.find((x) => x.gate === h.gate);
    if (!r) continue;
    out.push({ x: h.x * TILE + TILE / 2, y: (h.y + 0.9) * TILE, text: `${h.gate}번 ${r.name}`, color: derbyGateColor(h.gate) });
  }
  return out;
}

// ---- 분점(지점) 중계 미니 렌더러: 작은 캔버스에 지금 단계를 작게 그린다 (글자 없이 도형만) ----
// 경계 계산은 순수 함수로 분리 (예시·기승 단계에는 예시장 링까지 들어간다)
export function derbyMiniView(input: DerbyShowInput): DerbyMiniView {
  const frame = derbyFrame(input);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const eat = (x: number, y: number, pad: number) => { x0 = Math.min(x0, x - pad); y0 = Math.min(y0, y - pad); x1 = Math.max(x1, x + pad); y1 = Math.max(y1, y + pad); };
  for (const [x, y] of RACE_LOOP) eat(x, y, 1);
  eat(TUNNEL.x, TUNNEL.y, 1); // 지하마도 (퍼레이드에 나오고 확정 때 들어가는 자리)
  const showPaddock = frame.phase === 'paddock' || frame.phase === 'mount';
  if (showPaddock) {
    for (const [x, y] of RACE_PADDOCK_SLOTS) eat(x, y, 1.5);
    eat(RACE_PADDOCK.x, RACE_PADDOCK.y, 0.5); eat(RACE_PADDOCK.x + RACE_PADDOCK.w, RACE_PADDOCK.y + RACE_PADDOCK.h, 0.5);
  }
  const fin = loopPoint(0, 0);
  return {
    x0, y0, x1, y1,
    horses: frame.horses.filter((h) => !h.hidden).map((h) => ({ x: h.x, y: h.y, color: derbyGateColor(h.gate).bg, leader: h.gate === frame.leaderGate })),
    paddock: showPaddock ? { x: RACE_PADDOCK.x, y: RACE_PADDOCK.y, w: RACE_PADDOCK.w, h: RACE_PADDOCK.h } : null,
    finish: { x: fin.x, y: fin.y },
  };
}
export function drawDerbyMini(cv: HTMLCanvasElement, input: DerbyShowInput): void {
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const W = cv.width, H = cv.height;
  const view = derbyMiniView(input);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#1d2b1f'; ctx.fillRect(0, 0, W, H);
  const sc = Math.min((W - 8) / Math.max(1, view.x1 - view.x0), (H - 8) / Math.max(1, view.y1 - view.y0));
  const ox = (W - (view.x1 - view.x0) * sc) / 2, oy = (H - (view.y1 - view.y0) * sc) / 2;
  const X = (x: number) => ox + (x - view.x0) * sc, Y = (y: number) => oy + (y - view.y0) * sc;
  // 주로
  ctx.strokeStyle = '#8a6f4d'; ctx.lineWidth = Math.max(2, sc * 3);
  ctx.beginPath();
  RACE_LOOP.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(X(x), Y(y)); else ctx.lineTo(X(x), Y(y)); });
  ctx.closePath(); ctx.stroke();
  // 결승선
  ctx.strokeStyle = '#f4f4f4'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(X(view.finish.x), Y(view.finish.y) - 3); ctx.lineTo(X(view.finish.x), Y(view.finish.y) + 3); ctx.stroke();
  // 예시장 (예시·기승 단계: 마번 순 행렬 대신 링 + 안의 점)
  if (view.paddock) {
    ctx.strokeStyle = '#c9a13b'; ctx.lineWidth = 1;
    ctx.strokeRect(X(view.paddock.x), Y(view.paddock.y), view.paddock.w * sc, view.paddock.h * sc);
  }
  // 말 점 (마번 고유 색. 검정 말도 보이게 옅은 테두리, 선두는 흰 고리)
  for (const h of view.horses) {
    const cx = X(h.x), cy = Y(h.y);
    ctx.fillStyle = h.color;
    ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.8; ctx.stroke();
    if (h.leader) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.stroke(); }
  }
}

// ---- 개발 미리보기·차후 클라이언트 로직용 목 출전표 (코어 모듈이 붙으면 실제 데이터로 바뀐다) ----
const MOCK_NAMES = ['번개', '돌풍', '해오름', '달빛', '천둥', '바람꽃', '금빛', '은하', '태풍', '무지개', '별빛', '초원', '질주', '우뢰', '샛별', '검은콩'];
const MOCK_COATS = ['#7a4a2b', '#4a3220', '#9c6b3c', '#2e2e2e', '#b08d5a', '#6e3b22', '#d9c39a', '#54331d'];
const MOCK_SILKS: [string, string][] = [['#e33', '#fff'], ['#36c', '#ff0'], ['#2a2', '#fff'], ['#e80', '#222'], ['#939', '#ff0'], ['#0aa', '#fff'], ['#c0c', '#222'], ['#888', '#e33']];
const MOCK_JOCKEYS = ['김기수', '이승', '박찬', '최달', '정바람', '강산', '윤별', '한결'];
const MOCK_STYLES: RunStyle[] = ['선행', '선입', '추입', '선행', '선입', '추입', '선행', '선입'];
const MOCK_BEHAVIORS: (DerbyBehavior | null)[] = ['dash', 'wild', 'gallopIn', 'side', 'lazy', 'unseat', 'calm', null];
export function mockDerbyField(n: number): DerbyRunner[] {
  const rnd = mulberry32(n * 97 + 13);
  const names = shuffle(rnd, MOCK_NAMES).slice(0, 8);
  const coats = shuffle(rnd, MOCK_COATS).slice(0, 8);
  const silks = shuffle(rnd, MOCK_SILKS).slice(0, 8);
  const jockeys = shuffle(rnd, MOCK_JOCKEYS).slice(0, 8);
  const out: DerbyRunner[] = [];
  for (let g = 1; g <= 8; g++) {
    out.push({
      gate: g, name: names[g - 1], coat: coats[g - 1], jockey: jockeys[g - 1], silk: silks[g - 1],
      style: MOCK_STYLES[(g - 1 + n) % 8], behavior: MOCK_BEHAVIORS[(g - 1 + n) % 8],
    });
  }
  return out;
}
// 목 결과 (미리보기용. event 말은 착순 의무 자리로 옮긴다: boost 1착 · place 3착 · fall 꼴찌 · drop 착외)
export function mockDerbyResult(n: number): DerbyResult {
  const kinds: DerbyEventKind[] = ['boost', 'drop', 'place', 'fall'];
  const kind = kinds[((n >> 3) % 4 + 4) % 4];
  const gate = (n % 8) + 1;
  const order = shuffle(mulberry32(n * 31 + 7), [1, 2, 3, 4, 5, 6, 7, 8]).filter((g) => g !== gate);
  if (kind === 'boost') order.unshift(gate);
  else if (kind === 'place') order.splice(2, 0, gate);
  else if (kind === 'fall') order.push(gate);
  else order.splice(5, 0, gate);
  return { order, event: { gate, kind }, spliceMs: DERBY_RACE_START_MS + 3000 };
}
