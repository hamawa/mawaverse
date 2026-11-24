// 경마공원 말 · 기수 · 출마표 (순수 함수, 결정적. 서버에 저장하지 않는다).
// 말: 한국 시간 주(월요일 시작) w 마다 신마 4두가 데뷔(시드 = 주 번호), 4~8주 뒤 은퇴. 앞선 8주를 거슬러 계산하므로 언제 시작해도 현역이 차 있다(약 24두).
// 이름은 음절 조합 목록(실존 유명 경주마 이름은 뺀다)을 전역 번호 4w+i 로 순열 대응시켜, 목록 크기만큼 연속한 말끼리는 겹치지 않는다.
// 출마표: 경주 번호 n 으로 현역 8두 · 기수 · 마번 · 거리 · 주로 상태를 정한다. 원래 점수 순서가 인기 순위이고,
// 보이는 레이팅은 그 경주 프로필의 순위별 승률에서 만든다(벌어짐이 프로필과 같다). 컨디션 = 레이팅 − 원래 점수.
import { seededRandom } from '../hash';
import { rainBlock, WEATHER_BLOCK_MS } from '../weather';
import { DERBY_PROFILES } from './odds';
import { derbyScenarioFor } from './scenario';
import type { DerbyBehavior } from './scenario';
import { cycleStart } from './time';

const DAY_MS = 86400000, KST_MS = 9 * 3600000;
export const DERBY_DEBUTS_PER_WEEK = 4;
export const DERBY_CAREER_MIN = 4, DERBY_CAREER_MAX = 8;
export const DERBY_DISTANCES = [1000, 1200, 1400, 1800] as const;
export type DerbyDistance = (typeof DERBY_DISTANCES)[number];
export type DerbyStyle = '선행' | '선입' | '추입';
export const DERBY_TRACKS = ['양호', '다습', '불량'] as const;

// 한국 시간 월요일 시작 주 번호 (1970-01-05 월요일 = 1)
export function derbyWeek(ms: number): number { return Math.floor((Math.floor((ms + KST_MS) / DAY_MS) + 3) / 7); }
export function derbyWeekStart(w: number): number { return (w * 7 - 3) * DAY_MS - KST_MS; }

const NAME_HEAD = ['번개', '바람', '은빛', '황금', '푸른', '천둥', '새벽', '노을', '하늘', '별빛', '질풍', '태양', '강철', '불꽃', '달빛', '구름', '파도', '용감', '행운', '백두', '초원', '무지개', '해돋이', '들판'];
const NAME_TAIL = ['질주', '왕자', '공주', '대장', '스타', '보이', '걸', '킹', '퀸', '전사', '날개', '화살', '신화', '돌풍', '영웅', '머니', '투혼', '파워', '로드', '챔프'];
// 실존 유명 경주마 이름 (조합이 우연히 같아지면 뺀다)
export const DERBY_NAME_BLOCKLIST = [
  '미스터파크', '트리플나인', '당대불패', '새강자', '지금이순간', '청담도끼', '위너스맨', '문학보이', '경부대로', '실버울프',
  '차밍걸', '동반의강자', '클린업조이', '파워블레이드', '감동의바다', '터프윈', '돌콩', '가온챔프', '투혼의반석', '소닉붐',
  '백광', '영천에이스', '황금보이', '은빛질주', '천둥질주', '바람의왕자', '닉스고', '블루치퍼', '심장의고동', '라이언록',
];
const NAMES = NAME_HEAD.flatMap((h) => NAME_TAIL.map((t) => h + t)).filter((x) => !DERBY_NAME_BLOCKLIST.includes(x));
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
let NAME_MULT = 7919;
while (gcd(NAME_MULT, NAMES.length) !== 1) NAME_MULT += 2;

export interface DerbyHorse {
  id: string;             // 'h{주}_{0~3}' (race/h/{말 id} 열쇠)
  name: string;
  sex: '수' | '암' | '거';
  age: number;
  coat: string;
  speed: number; stamina: number; burst: number;   // 50~95
  dist: DerbyDistance;    // 거리 적성 (가장 잘 뛰는 거리)
  style: DerbyStyle;      // 각질
  mud: number;            // 비 오는 주로 적성 −2~+2
  debut: number;          // 데뷔 주
  career: number;         // 현역 주 수 4~8
  retire: number;         // 은퇴하는 주 (그 주 월요일부터 출전하지 않는다)
}

export function derbyHorse(w: number, i: number): DerbyHorse {
  const rng = seededRandom(`derby|horse|${w}|${i}`);
  const g = w * DERBY_DEBUTS_PER_WEEK + i;
  const stat = () => 50 + Math.round(rng() * 45);
  const career = DERBY_CAREER_MIN + Math.floor(rng() * (DERBY_CAREER_MAX - DERBY_CAREER_MIN + 1));
  const sx = rng();
  return {
    id: `h${w}_${i}`,
    name: NAMES[(((g * NAME_MULT) % NAMES.length) + NAMES.length) % NAMES.length],
    sex: sx < 0.5 ? '수' : sx < 0.85 ? '암' : '거',
    age: 2 + Math.floor(rng() * 3),
    coat: ['갈색', '밤색', '흑갈색', '회색', '흑색'][Math.floor(rng() * 5)],
    speed: stat(), stamina: stat(), burst: stat(),
    dist: DERBY_DISTANCES[Math.floor(rng() * 4)],
    style: (['선행', '선입', '추입'] as const)[Math.floor(rng() * 3)],
    mud: Math.floor(rng() * 5) - 2,
    debut: w, career, retire: w + career,
  };
}

// id → 말 (형식이 틀리면 null)
export function derbyHorseById(id: string): DerbyHorse | null {
  const m = /^h(-?\d+)_([0-3])$/.exec(id);
  return m ? derbyHorse(+m[1], +m[2]) : null;
}

// 그 주의 현역 (id 순: 데뷔 주, 번호)
export function derbyRoster(week: number): DerbyHorse[] {
  const out: DerbyHorse[] = [];
  for (let w = week - DERBY_CAREER_MAX + 1; w <= week; w++) for (let i = 0; i < DERBY_DEBUTS_PER_WEEK; i++) {
    const h = derbyHorse(w, i);
    if (h.retire > week) out.push(h);
  }
  return out;
}
export function derbyRosterAt(ms: number): DerbyHorse[] { return derbyRoster(derbyWeek(ms)); }
// 그 주 월요일에 은퇴한 말 / 데뷔한 말
export function derbyRetirements(week: number): DerbyHorse[] {
  const out: DerbyHorse[] = [];
  for (let w = week - DERBY_CAREER_MAX; w < week; w++) for (let i = 0; i < DERBY_DEBUTS_PER_WEEK; i++) {
    const h = derbyHorse(w, i);
    if (h.retire === week) out.push(h);
  }
  return out;
}
export function derbyDebuts(week: number): DerbyHorse[] { return [0, 1, 2, 3].map((i) => derbyHorse(week, i)); }

// 능력 곡선: 데뷔 → 전성기(현역 가운데) → 하락. 0.9~1.02
export function derbyForm(h: DerbyHorse, week: number): number {
  const t = (week - h.debut + 0.5) / h.career;
  return 0.9 + 0.12 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
}

export interface DerbyJockey { id: number; name: string; skill: number; silk: { body: string; sleeve: string; cap: string } }
export const DERBY_JOCKEYS: readonly DerbyJockey[] = [
  { id: 0, name: '한도윤', skill: 0.95, silk: { body: '#d32f2f', sleeve: '#ffffff', cap: '#d32f2f' } },
  { id: 1, name: '서지호', skill: 0.92, silk: { body: '#1565c0', sleeve: '#ffeb3b', cap: '#ffffff' } },
  { id: 2, name: '문하준', skill: 0.88, silk: { body: '#2e7d32', sleeve: '#2e7d32', cap: '#fbc02d' } },
  { id: 3, name: '배서연', skill: 0.86, silk: { body: '#6a1b9a', sleeve: '#f8bbd0', cap: '#6a1b9a' } },
  { id: 4, name: '유태민', skill: 0.84, silk: { body: '#ff6f00', sleeve: '#212121', cap: '#ff6f00' } },
  { id: 5, name: '노은채', skill: 0.82, silk: { body: '#ffffff', sleeve: '#c62828', cap: '#1565c0' } },
  { id: 6, name: '구민혁', skill: 0.80, silk: { body: '#212121', sleeve: '#ffd54f', cap: '#212121' } },
  { id: 7, name: '탁수아', skill: 0.78, silk: { body: '#00838f', sleeve: '#ffffff', cap: '#00838f' } },
  { id: 8, name: '변재원', skill: 0.75, silk: { body: '#f9a825', sleeve: '#1b5e20', cap: '#f9a825' } },
  { id: 9, name: '방예린', skill: 0.72, silk: { body: '#ad1457', sleeve: '#ad1457', cap: '#ffffff' } },
];

export interface DerbyRunner {
  gate: number;           // 마번 1~8
  horse: DerbyHorse;
  jockey: DerbyJockey;
  rank: number;           // 인기 순위 0 = 1인기
  raw: number;            // 원래 점수 (능력·적성·기수·주로)
  rating: number;         // 보이는 레이팅 (소수 한 자리)
  cond: number;           // 그날 컨디션 = rating − raw
  behavior: DerbyBehavior | null;
}
export interface DerbyCard {
  n: number; s: number; p: number; profile: string;
  distance: DerbyDistance;
  track: (typeof DERBY_TRACKS)[number]; wet: number;   // 0 양호 · 1 다습 · 2 불량
  runners: DerbyRunner[];   // 마번 순
  gateOfRank: number[];     // 인기 순위 → 마번
}

function shuffled<T>(list: readonly T[], rng: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// 주로 상태: 발매 시작 시각에 비가 오면 불량, 지난 한 시간 안에 왔으면 다습
export function derbyTrack(ms: number): number {
  const i = Math.floor(ms / WEATHER_BLOCK_MS);
  return rainBlock(i) ? 2 : rainBlock(i - 1) || rainBlock(i - 2) ? 1 : 0;
}

const cards = new Map<number, DerbyCard>();
const CARD_CACHE_LIMIT = 32;
export function derbyCard(n: number): DerbyCard {
  const hit = cards.get(n);
  if (hit) return hit;
  const st = cycleStart(n), week = derbyWeek(st), sc = derbyScenarioFor(n);
  const rng = seededRandom(`derby|card|${n}`);
  const horses = shuffled(derbyRoster(week), rng).slice(0, 8);
  const jockeys = shuffled(DERBY_JOCKEYS, rng).slice(0, 8);
  const gates = shuffled([1, 2, 3, 4, 5, 6, 7, 8], rng);
  const distance = DERBY_DISTANCES[Math.floor(rng() * 4)];
  const wet = derbyTrack(st);
  const di = DERBY_DISTANCES.indexOf(distance);
  const mix = [[0.5, 0.15, 0.35], [0.45, 0.2, 0.35], [0.35, 0.35, 0.3], [0.2, 0.5, 0.3]][di];
  const runners: DerbyRunner[] = horses.map((h, k) => {
    const j = jockeys[k];
    const ability = mix[0] * h.speed + mix[1] * h.stamina + mix[2] * h.burst;
    const apt = -4 * Math.abs(DERBY_DISTANCES.indexOf(h.dist) - di);
    const raw = Math.round((ability * derbyForm(h, week) + apt + 2 * h.mud * wet + 20 * (j.skill - 0.8) + (rng() - 0.5) * 8) * 10) / 10;
    return { gate: gates[k], horse: h, jockey: j, rank: 0, raw, rating: 0, cond: 0, behavior: null };
  });
  const w = DERBY_PROFILES[sc.p].w;
  const byRank = [...runners].sort((x, y) => y.raw - x.raw || x.gate - y.gate);
  byRank.forEach((r, i) => {
    r.rank = i;
    r.rating = Math.round((100 + 20 * Math.log(w[i] * 8)) * 10) / 10;
    r.cond = Math.round((r.rating - r.raw) * 10) / 10;
    r.behavior = sc.horses.find((x) => x.r === i)?.k ?? null;
  });
  runners.sort((x, y) => x.gate - y.gate);
  const card: DerbyCard = {
    n, s: sc.s, p: sc.p, profile: DERBY_PROFILES[sc.p].name, distance, track: DERBY_TRACKS[wet], wet,
    runners, gateOfRank: byRank.map((r) => r.gate),
  };
  cards.set(n, card);
  if (cards.size > CARD_CACHE_LIMIT) cards.delete(cards.keys().next().value!);
  return card;
}
