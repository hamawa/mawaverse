import type { ContestCfg } from './contest';
import type { Equip, GiftMark } from './shop';

export type Dir = 0 | 1 | 2 | 3; // 0 아래, 1 왼쪽, 2 오른쪽, 3 위

export interface UserProfile {
  id: string;
  nick: string;
  avatar: string;
  losses: number;
  createdAt: number;
  lastLoginAt?: number;
  lastLoss?: { room: string; round: number } | null;
  lastMsg?: number;
  lastAll?: number;
  lastPos?: { x: number; y: number; d?: Dir; m?: string } | null; // d: 바라보던 방향 (다시 들어올 때 복원), m: 맵 id (없으면 기본 맵)
  own?: Record<string, true>;      // 상점에서 산 꾸미기 (품목 id)
  eq?: Equip | null;                // 착용 중인 꾸미기
  gifts?: Record<string, true>;    // 선물로 받은 품목 (보낸 사람이 own 과 함께 적는다)
  gift?: GiftMark | null;          // 마지막으로 받은 선물 (알림용)
}

export interface PushEvent { f: string; dx: number; dy: number; t: number; n?: number; r?: boolean; b?: number } // n=2: 장풍 (앞 4×4칸 범위, 두 칸 밀림. 규칙이 보유를 확인). r: 거북이 등껍질이 되받아친 것 (다시 되받지 않는다)
// 말랑이: 던진 사람(f)과 그 위치(fx,fy), 겨냥한 칸(tx,ty). players/{target}/toss 에 잠깐 실린다. r: 등껍질에 튕겨 되돌아온 것
export interface TossMsg { f: string; fx: number; fy: number; tx: number; ty: number; t: number; r?: boolean; b?: number }
// 끌기: 끄는 사람(f)이 나를 (x,y) 칸으로 당긴다. 보통 끌기는 f 가 한 칸 물러난 뒤 비운 자기 자리, 갈고리(k='hook', 규칙이 보유 확인)는 f 의 바로 앞 칸
export interface PullEvent { f: string; x: number; y: number; t: number; k?: 'hook'; b?: number }
// 위 세 메시지의 b=1: 빠따로 방어를 깨는 타격 (2026-11-11). 받는 쪽은 갑옷·펫 방어를 건너뛰고, 그때부터 GUARD_BREAK_MS 동안 방어가 깨진다. 규칙이 보낸 사람의 지갑 bt 가 같은 쓰기에서 줄었는지 본다
// 관리자가 나를 (x,y)로 보낸다 (광장으로 보내기). 규칙이 f 가 관리자인지 확인
export interface TpEvent { f: string; x: number; y: number; t: number }

export interface PlayerState {
  n: string;            // nick
  a: string;            // avatar preset id
  x: number;
  y: number;
  d: Dir;
  s: string;            // session id
  e?: { t: number; at: number } | null; // emote id + 시각
  r?: string | null;    // 커피 방 id
  push?: PushEvent | null;
  toss?: TossMsg | null;
  pull?: PullEvent | null;
  tp?: TpEvent | null;
  j?: number;           // joined at
  hb?: number;          // last heartbeat (server time)
  f?: { x: number; y: number; a?: number; r?: number; s?: number } | null; // 낚시 중이면 찌가 있는 물 타일 (a=1: 자동 회수 버프 중, r: 낚싯대 등급, s: 강화 성)
  h?: string | null;    // 착용한 모자
  nc?: string | null;   // 이름표 색
  fx?: string | null;   // 이동 이펙트
  pt?: string | null;   // 데리고 다니는 펫 (품목 id)
  pl?: number | null;   // 그 펫의 누적 먹이(경험치). 남들이 크기·탑승·방어(Lv8 이상이면 밀치기 무효)를 보는 데 쓴다 (규칙: 지갑 px 이하)
  pa?: boolean | null;  // 철벽 갑옷 입는 중 (밀치기 무효)
  ta?: boolean | null;  // 푹신 갑옷 입는 중 (말랑이 무효)
  z?: boolean | null;   // 탭이 뒤에 있어 자리 비움 (💤 표시)
  v?: number;           // 클라이언트 버전 (CLIENT_VERSION). 규칙이 입장할 때 config/minVersion 이상인지 본다
  m?: string | null;    // 있는 맵 id (shared/maps.ts). 없으면 기본 맵 (옛 클라이언트와 같다)
  mn?: boolean | null;  // 금광에서 채광 중 (곡괭이질이 남에게 보이게. 곡괭이질마다 쓰지 않고 켜고 끌 때만)
  gb?: number | null;   // 빠따에 맞아 방어(갑옷·펫)가 깨진 상태: 풀리는 서버 시각. 이 시각까지는 누구의 밀치기·말랑이·끌기도 통한다
}

export type Channel = 'near' | 'all' | 'w' | 'sys' | 'notice' | 'g'; // g: 마피아 유령 채팅. (파티 채팅 'p' 는 2026-11-10 파티 기능과 함께 삭제)

export interface ChatMsg { u: string; n: string; t: string; c: 'near' | 'all'; x: number; y: number; ts: number; m?: string } // m: 보낸 맵 (없으면 기본 맵)
export interface WhisperMsg { f: string; fn: string; t: string; ts: number; x: number; y: number }
export interface GhostMsg { u: string; n: string; t: string; ts: number } // 마피아 유령 채팅 (mafia/chat)

export interface RoomMember { n: string; ready: boolean; readyAt?: number; losses: number; at: number }
export interface RoomResult { loser: string; loserNick: string; at: number; seed: string; counted?: boolean }
export interface RoomState {
  cap: number;
  round: number;
  state: 'open' | 'result';
  members?: Record<string, RoomMember>;
  result?: RoomResult | null;
}

export type BoardCat = 'promo' | 'meet' | 'junk'; // 홍보 · 벙개 · 똥글
export interface Post { title: string; body: string; u: string; n: string; ts: number; cc?: number; cat?: BoardCat } // cat 없는 글은 분류 도입 전의 옛 글
export interface Comment { u: string; n: string; t: string; ts: number }

export interface ServerConfig {
  maxPlayers: number;
  maintenance: { on: boolean; message: string };
  announcement: { text: string; ts: number } | null;
  activeMap: string;
  lossStrength: number;      // 가중치 지수 (1 = 선형)
  logRetention: { chat: number; conn: number };
  allCooldownSec: number;
  boardRetention: number;
  prices?: Record<string, number>; // 상점 가격 덮어쓰기 (품목 id → 코인). 없으면 코드 기본값
  contest?: ContestCfg;            // 낚시 대회 일정
  casinoMax?: number;              // 경마 한 번 최대 배팅 (규칙이 강제. 없으면 10000)
  minVersion?: number;             // 이 값보다 낮은 CLIENT_VERSION 의 접속자는 스스로 새로고침한다
  hoursBlock?: boolean;            // 평일 09:00~18:00 KST 이용 차단을 켤지 (관리자 설정, 기본 꺼짐). 켜져 있으면 보안 규칙이 서버 시각으로 막는다
}

export interface ConnLog { u: string; n: string; type: 'join' | 'leave'; ts: number }
export interface ChatLog { u: string; n: string; c: Channel; to?: string; toNick?: string; t: string; ts: number }
export interface AdminLog { action: string; target?: string; detail?: string; ts: number }
