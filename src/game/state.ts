import type { TossMsg } from '../shared/types';
import type { ContestMgr } from './contest';
import type { CatchLog } from './catchlog';
import type { WalletMgr } from './wallet';
import type { Dir, PlayerState, UserProfile, ServerConfig, RoomState, Channel } from '../shared/types';
import type { MapData } from './map';
import type { Bubble } from './render';
import type { Pose } from './sprites';
import type { Engine } from './engine';
import type { Input } from './input';
import type { Emitter } from './emitter';

export interface RemotePlayer {
  uid: string;
  st: PlayerState;
  x: number; y: number;             // 화면 표시용(보간)
  fromX: number; fromY: number;
  toX: number; toY: number;
  prevX: number; prevY: number;     // 마지막 걸음에서 떠난 칸 (펫이 따라올 자리)
  moveStart: number;
  moveDur: number;                  // 이번 한 칸 이동에 쓰는 시간(ms). 상대가 달리면 짧아짐
  lastMoveAt: number;               // 마지막 위치 갱신 시각 (보간 시간 추정용)
  fishAt: number;                   // 찌를 던진 시각 (performance.now). 던지는 동작 재생용
  pose: Pose; poseAt: number; emoteId: number;
  bubble: Bubble | null;
  pushAt: number; pushDir: Dir;
  hitAt: number;                    // 말랑이에 맞은 시각
  blockAt: number;                  // 갑옷으로 막은 시각 (🛡 표시)
}

export interface LocalPlayer {
  x: number; y: number;             // 논리적 현재 타일(이동 목표)
  fromX: number; fromY: number;
  dispX: number; dispY: number;     // 표시용 보간 좌표
  moveStart: number;
  moveDur: number;                  // 한 칸 이동 시간(ms). Shift 달리기면 STEP_MS/2
  moving: boolean;
  dir: Dir;
  pose: Pose; poseAt: number; emoteId: number;
  bubble: Bubble | null;
  pushAt: number; pushDir: Dir;
  hitAt: number;                    // 말랑이에 맞은 시각 (😵 표시)
  blockAt: number;                  // 갑옷으로 막은 시각 (🛡 표시)
  pushMore: { dx: number; dy: number; dir: Dir } | null; // 장풍에 밀려 도착하면 한 칸 더 밀릴 예정
  stunUntil: number;                // 이 시각까지 이동 불가 (말랑이 스턴)
  lastPushAt: number;               // 밀치기 쿨타임
  locked: boolean;                  // 이동 금지 (지금은 켜는 곳이 없다. 옛 커피 내기 결과 화면용)
  roomId: string | null;
}

export interface LogEntry {
  channel: Channel;
  uid?: string;
  from: string;
  to?: string;
  text: string;
  ts: number;
  self?: boolean;
}

export type WorldEvents = {
  log: [LogEntry];
  toast: [string, boolean?];
  players: [];
  rooms: [];
  config: [ServerConfig];
  profile: [];
  logout: [string];
  toss: [string, TossMsg];          // 누군가(대상 uid)에게 말랑이가 날아갔다
  wave: [number, number, number, number]; // 장풍이 나에게 날아왔다 (fx, fy, tx, ty): 💨 효과용
  hook: [number, number, number, number]; // 갈고리가 나에게 날아왔다 (fx, fy, tx, ty): ⚓ 효과용
  ghost: [boolean];                 // 마피아: 내가 유령이 됐다/풀렸다 (유령 채팅 구독 전환)
};

// 모듈 간 공유되는 월드 컨텍스트 (world.ts 의 World 클래스가 구현)
export interface WorldCtx {
  uid: string;
  profile: UserProfile;
  sessionId: string;
  isAdmin: boolean;
  map: MapData;                          // 지금 있는 맵
  mapId: string;                         // 지금 있는 맵의 논리 id (shared/maps.ts). MapData.id 와 다르다: 기본 맵은 'main'
  mainMap: MapData;                      // 기본 맵 (마피아 미션 자리·보물 지도처럼 기본 맵에만 있는 것)
  onMyMap(st: { m?: string | null }): boolean; // 그 presence 가 나와 같은 맵에 있나
  readonly switching: boolean;           // 포탈로 맵을 옮기는 중 (목적지 읽기 ~ 쓰기 완료). 이동·낚시·행동·채팅을 멈춘다
  config: ServerConfig;
  players: Map<string, RemotePlayer>;
  me: LocalPlayer;
  rooms: Record<string, RoomState>;
  engine: Engine;
  input: Input;
  wallet: WalletMgr;
  contest: ContestMgr;
  events: Emitter<WorldEvents>;
  joinedAt: number;
  online: boolean;
  toast(msg: string, err?: boolean): void;
  // 내 낚시·채집 소식: 화면 아래 한 줄 알림 + 개인 기록(도감 "내 기록"). 채팅에는 안 남긴다 (2026-11-09)
  catchNote(kind: 'fish' | 'bug' | 'etc', text: string): void;
  catchLog: CatchLog;
  note(text: string): void;              // 한 줄 알림만 (기록 없음)
  batNote(used: number): void;           // 빠따를 썼으면 한 줄 알림
  banner(title: string, sub?: string): void; // 화면 가운데 큰 배너 (신화 등급 소식)
  forceLogout(reason: string, replaced?: boolean): void;
  isTileVisible(x: number, y: number): boolean;
  playerAt(x: number, y: number): RemotePlayer | null;
  occupied(x: number, y: number): boolean;
  passThrough(uid: string): boolean;     // 마피아 유령과 산 사람은 서로 지나칠 수 있다
  nickOf(uid: string): string;
  setBubble(uid: string, bubble: Bubble): void;
  teleportTo(x: number, y: number): Promise<void>;
  // 한 칸(또는 갈고리처럼 여러 칸) 이동 시작. pushedDir: 밀려서 움직이는 방향(애니메이션용). dur: 이동 시간(ms), onDone: 점유 결과
  startStep(nx: number, ny: number, pushedDir?: Dir, opts?: { dur?: number; onDone?: (ok: boolean) => void }): void;
  // 밀치기·끌기를 당했다: 도착한 뒤 PUSH_STUN_MS 동안 못 움직이고 😵 가 뜬다
  stunAfter(moveMs: number): void;
  guardUntil: number;                    // 빠따에 맞아 방어가 깨져 있으면 풀리는 서버 시각 (아니면 0 또는 지난 시각)
  guardBroken(): boolean;                // 지금 방어(갑옷·펫)가 깨져 있나
  breakGuard(byNick: string): void;      // 빠따에 맞았다: GUARD_BREAK_MS 동안 방어 없음
  petGuard(): boolean;                   // 펫 Lv8 이상: 밀치기·장풍·말랑이·끌기·갈고리를 갑옷처럼 막는다
  petReflect(): boolean;                 // 막은 보통 밀치기·말랑이를 되받아칠지 (80%)
  leaveForTeleport(): void;             // 순간이동 전 정리: 낚시 취소, 방에 있으면 나감
  canStep(nx: number, ny: number, pushed?: boolean): boolean; // pushed: 밀치기·끌기로 움직이는 걸음 (밀려서는 카지노에 못 들어간다)
  settleIfStalled(): void;              // 화면 갱신이 멈춘 동안(뒤쪽 탭) 끝나지 않은 걸음을 마무리
  reloadForUpdate(min: number): void;   // config/minVersion 이 올라 새로고침이 필요
}
