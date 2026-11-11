// 마피아 (어몽어스식, 2026-11-09). 방 없이 맵 전체에서 한다. 서버 코드가 없어 방장 클라이언트가 진행(역할 배정·단계 전환·결과 계산)을 맡고,
// 방장이 접속을 끊으면 남은 참가자 중 uid 가 가장 앞선 사람이 이어받는다(규칙: 방장이 접속 노드에 없으면 아무나 game 을 쓸 수 있다).
// 역할은 mafia/roles/{uid} 에 따로 두어 본인만 읽는다(규칙). 방장 브라우저가 무작위로 정해 쓰므로 코드를 뜯는 방장은 엿볼 수 있다 — 사용자가 감수하기로 함.
export const MAFIA_MIN = 5;
export const MAFIA_MAX = 10;
export const TASKS_PER_PLAYER = 4;       // 2026-11-10: 미션 자리를 맵 전체로 흩뿌리며 3 → 4 (이동이 늘어 마피아에게 기회가 생긴다)
export const TASK_HOLD_MS = 5000;        // 미션: F 를 5초 버티기 (사용자 지정)
export const KILL_RANGE = 1;             // 킬: 바로 옆(대각선 포함)
export const KILL_CD_MS = 30000;
export const MEET_DISCUSS_MS = 90000;    // 회의: 토론
export const MEET_VOTE_MS = 30000;       // 회의: 투표 (토론 중에도 투표할 수 있고, 투표 시간이 끝나거나 모두 투표하면 집계)
export const MEET_RESULT_MS = 6000;      // 결과 표시
export const GAME_MAX_MS = 15 * 60 * 1000; // 15분 넘으면 시민 승
export const END_SHOW_MS = 12000;        // 종료 화면 뒤 게임 노드 정리
export const WIN_COINS = 50;
export const GHOST_CHAT_KEEP = 60;

export const mafiaCountFor = (players: number): number => (players >= 7 ? 2 : 1);

export type MafiaPhase = 'lobby' | 'play' | 'end';
export type Role = 'm' | 'c';
export interface MafiaPlayer { n: string; a: string; alive: boolean; j: number }
export interface MafiaBody { x: number; y: number; a: string; n: string; at: number }
export interface MafiaMeet { by: string; kind: 'report' | 'button'; body?: string | null; at: number; votes?: Record<string, string>; result?: { out: string | null; tie: boolean; at: number; counts?: Record<string, number> } | null }
export interface MafiaGame {
  st: MafiaPhase;
  host: string;
  at: number;                                  // 단계 시작 시각 (play 시작 = 게임 시작)
  n?: number;                                  // 회의 횟수
  players: Record<string, MafiaPlayer>;
  tasks?: Record<string, Record<string, boolean>>; // uid → 미션 id → 완료
  bodies?: Record<string, MafiaBody> | null;   // 시체 (피해자 uid)
  meet?: MafiaMeet | null;
  used?: Record<string, true> | null;          // 긴급 소집 사용
  end?: { win: Role; reason: string; at: number } | null;
}

// 미션 자리 (2026-11-10 개편): 라이브 맵(maps/custom1, 60×40)의 좌표 at 에 그 오브젝트가 있으면 거기, 아니면(맵이 바뀜) 그 오브젝트가 처음 나오는 칸. 옆에서 F 5초.
// 오브젝트 id 는 game/map.ts 의 O 와 같다. 예전엔 "처음 나오는 칸"만 써서 10개 중 5개가 라운지 한 줄에 몰렸다 → 라운지 2 · 광장 2 · 공원 3 · 커피 거리 3 · 정원 2 로 흩뿌림.
// 게시판 미션은 뺐다: 게시판은 긴급 소집 버튼이 됐다 (분수에서 소집하던 때는 분수 미션을 할 수 없었다)
export interface TaskDef { id: string; obj: number; at?: [number, number]; name: string; verb: string }
export const TASK_DEFS: TaskDef[] = [
  { id: 'vending', obj: 23, at: [4, 16], name: '자판기', verb: '자판기 채우기' },        // 라운지 서쪽
  { id: 'shelf', obj: 21, at: [15, 16], name: '책장', verb: '책 정리' },               // 라운지 동쪽
  { id: 'fountain', obj: 14, at: [29, 22], name: '분수', verb: '분수 동전 줍기' },      // 중앙 광장
  { id: 'arcade', obj: 33, at: [37, 15], name: '오락기', verb: '오락기 수리' },         // 광장 북동
  { id: 'sign', obj: 18, at: [45, 20], name: '표지판', verb: '표지판 닦기' },           // 공원 (낚시 기록 표지판)
  { id: 'flower', obj: 24, at: [56, 14], name: '화단', verb: '화단 물 주기' },          // 공원 북동 구석
  { id: 'stump', obj: 28, at: [48, 28], name: '그루터기', verb: '그루터기 다듬기' },    // 공원 남쪽
  { id: 'lamp', obj: 10, at: [3, 9], name: '가로등', verb: '가로등 전구 갈기' },        // 커피 거리 서쪽 끝
  { id: 'pot', obj: 12, at: [57, 9], name: '화분', verb: '화분 물 주기' },              // 커피 거리 동쪽 끝
  { id: 'bench', obj: 4, at: [30, 9], name: '벤치', verb: '벤치 닦기' },                // 커피 거리 가운데
  { id: 'umbrella', obj: 32, at: [24, 31], name: '파라솔', verb: '파라솔 펴기' },       // 정원 서쪽
  { id: 'table', obj: 30, at: [35, 32], name: '둥근 탁자', verb: '탁자 닦기' },         // 정원 동쪽
];
// 오브젝트의 발자국(칸 수): 분수는 2×2 (좌상 칸이 미션 자리). 테두리 표시용
export const TASK_FOOTPRINT: Record<number, [number, number]> = { 14: [2, 2] };
// 긴급 소집: 게시판(zone kind 'board') 옆에서 F (1인 1회). 2026-11-10 분수 → 게시판

// 전체 미션 진행도
export function taskProgress(g: MafiaGame): { done: number; total: number } {
  let done = 0, total = 0;
  for (const t of Object.values(g.tasks || {})) for (const v of Object.values(t)) { total++; if (v) done++; }
  return { done, total };
}
export function aliveCount(g: MafiaGame, roles?: Record<string, Role>): { alive: number; mafia: number; citizens: number } {
  let alive = 0, mafia = 0;
  for (const [uid, p] of Object.entries(g.players || {})) { if (!p.alive) continue; alive++; if (roles?.[uid] === 'm') mafia++; }
  return { alive, mafia, citizens: alive - mafia };
}
// 투표 집계: 과반(산 사람 기준)이면 추방, 아니면 없음. 'skip' 은 기권
export function tallyVotes(votes: Record<string, string>, aliveN: number): { out: string | null; tie: boolean; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  for (const v of Object.values(votes)) counts[v] = (counts[v] || 0) + 1;
  let best: string | null = null, bestN = 0, tie = false;
  for (const [k, n] of Object.entries(counts)) {
    if (k === 'skip') continue;
    if (n > bestN) { best = k; bestN = n; tie = false; } else if (n === bestN) tie = true;
  }
  if (!best || tie || bestN * 2 <= aliveN) return { out: null, tie, counts };
  return { out: best, tie: false, counts };
}
