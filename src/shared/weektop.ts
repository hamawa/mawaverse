// 주간 랭킹 1위 표시 (2026-11-21, 건의 반영: 낚시 대회 우승자의 🏆 처럼 주간 1위도 한 주 동안 표시를 단다).
// 지난 주의 낚시·곤충 채집·말랑이 랭킹 1위가 이번 주 내내 이름표 앞에 🎣 · 🐛 · 🧸 를 단다 (월요일 0시에 바뀐다).
// 서버에 쓰는 것이 없다: 화면마다 지난 주 기록을 한 번 읽어 스스로 계산한다 (game/weektop.ts). 순서는 랭킹 표(fishui.ts)와 같아야 한다.
// 낚시를 🐟 로 하지 않은 것은 이름표 뒤의 든든함 표시(🐟3)와 헷갈려서다. 두더지 오락기 랭킹은 넣지 않았다.
import type { WeekEntry } from './collection';

export interface TossWeekLike { n: string; h: number; t: number; at: number }
export const WEEK_MARKS = { fish: '🎣', bug: '🐛', toss: '🧸' } as const;
export const WEEK_LABELS = { fish: '낚시', bug: '곤충 채집', toss: '말랑이' } as const;
export type WeekKind = keyof typeof WEEK_MARKS;
export const WEEK_KINDS: readonly WeekKind[] = ['fish', 'bug', 'toss'];
export type WeekTops = Partial<Record<WeekKind, string | null>>; // 종류 → 1위의 uid

// 낚시·곤충 채집: 점수 → 마릿수 → 먼저 세운 사람. 점수가 없으면 1위도 없다
export function topCatch(v: Record<string, WeekEntry> | null | undefined): string | null {
  const rows = Object.entries(v || {}).filter(([, e]) => e && e.p > 0).sort((a, b) => (b[1].p - a[1].p) || (b[1].c - a[1].c) || (a[1].at - b[1].at));
  return rows.length ? rows[0][0] : null;
}
// 말랑이: 명중 → 덜 던진 사람. 한 번도 못 맞혔으면 1위도 없다
export function topToss(v: Record<string, TossWeekLike> | null | undefined): string | null {
  const rows = Object.entries(v || {}).filter(([, e]) => e && e.h > 0).sort((a, b) => (b[1].h - a[1].h) || (a[1].t - b[1].t));
  return rows.length ? rows[0][0] : null;
}
// 그 사람이 다는 표시 (없으면 빈 글)
export function weekMarks(tops: WeekTops, uid: string): string {
  let s = '';
  for (const k of WEEK_KINDS) if (tops[k] && tops[k] === uid) s += WEEK_MARKS[k];
  return s;
}
// 그 사람이 1위를 한 종류
export function weekKindsOf(tops: WeekTops, uid: string): WeekKind[] { return WEEK_KINDS.filter((k) => !!tops[k] && tops[k] === uid); }
