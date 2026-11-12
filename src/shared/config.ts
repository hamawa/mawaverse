import { DEFAULT_CONTEST } from './contest';
import type { ServerConfig } from './types';

export const APP_NAME = 'MawaVerse';
export const TILE = 32;             // 타일 한 변 (아트 픽셀)
export const STEP_MS = 160;         // 한 칸 이동 시간
export const CHAT_MAX_LEN = 100;
export const PUSH_COOLDOWN_MS = 10000;
export const PUSH_STUN_MS = 500;    // 밀치기·끌기를 당한 사람은 도착한 뒤 이만큼 못 움직인다 (😵)
export const WATER_TURN_HOLD_MS = 400; // 물가에서 물 쪽으로 돌아선 뒤 이만큼 계속 누르고 있어야 물로 들어간다 (짧게 누르면 바라보기만, 2026-11-09)
export const HOOK_SLIDE_MS = 90;    // 갈고리에 끌려올 때 한 칸당 시간
export const ALL_COOLDOWN_MS = 10000;
export const MSG_MIN_INTERVAL_MS = 400;
export const HEARTBEAT_MS = 45000;  // presence 하트비트 주기
export const STALE_MS = 120000;     // 하트비트가 이만큼 없으면 접속 끊김으로 간주 (database.rules.json 의 players 규칙과 같은 값)
export const AFK_AFTER_MS = 60000;  // 탭이 이만큼 뒤에 있으면 자리 비움(💤) 표시
// 규칙·지갑 형식처럼 옛 클라이언트가 못 쓰게 되는 변경을 배포할 때마다 1씩 올린다. config/minVersion 이 이 값보다 크면 그 클라이언트는 스스로 새로고침한다
export const CLIENT_VERSION = 20; // 4: 끌기·갈고리·스턴·광장 보내기, 5: 채팅 정리·자동 30분/1시간·낚싯대·잠자리채, 6: 선물하기(지갑 gt), 7: 펫, 8: 카지노 경마·커피 거리 개편, 9: 마피아, 10: 자동 낚시 안내 숨김·알림 자리·미끼 상향, 11: 신화 등급(지갑 md)·미끼 재조정·물가 돌아서기·모바일 복귀 정리 (2026-11-09), 12: 파티 삭제·획득 상한 삭제·펫 레벨(지갑 px)·낚싯대 강화(지갑 rs/es)·마피아 개편·경마 1만 (2026-11-10), 13: 펫 먹이 가격이 먹인 수에 비례해 오름(지갑 규칙 변경) (2026-11-10), 14: 탑승 그림 교체·펫 스킬 Lv8 해금·상향(규칙 sh/sk 170) (2026-11-10), 15: 펫 스킬(Q) 삭제 → 종류 무관 상시 효과(걷기 +2.5%/Lv·Lv5 벌레 안 도망·Lv8 100% 막기+80% 반사), 규칙 sh/sk 삭제 (2026-11-10), 16: 걸음 한 번 쓰기(occ 규칙)·전송량 줄이기, 17: 포탈 맵(presence m·맵별 occ 키·채팅 m), 18: 포탈 행선지 선택·금광 채광(지갑 gn/ga)·킹 낚싯대(지갑 ks, rod3)·부서진 낚싯대 무료 복구 수정 (2026-11-11), 19: 빠따(지갑 bt/bo, 타격 메시지 b, presence gb)·샤샤샥 이펙트 (2026-11-11), 20: 키 E·R·T·모바일 버튼 재배치·귓속말 이어 가기·카지노 자리 고정·커피 내기 삭제·게시판 패치 노트 (2026-11-12. 옛 클라이언트와 섞여도 문제없어 minVersion 은 올리지 않았다)
// 코인 획득 속도 상한(10분 창 wt/we, config/earnCap)은 2026-11-10 에 없앴다: 자동 낚시 + 미끼 + 상위 낚싯대 조합에서 정상 플레이인데 지급이 막히는 일이 있어서. 옛 지갑의 wt/we/md 칸은 남아 있어도 무시한다
export const BUBBLE_MS = 6000;
export const EMOTE_MS = 1800;

export interface EmoteDef { id: number; key: string; name: string; icon: string; desc: string }
export const EMOTES: EmoteDef[] = [
  { id: 1, key: '1', name: '인사', icon: '👋', desc: '손 흔들기' },
  { id: 2, key: '2', name: '점프', icon: '⤴', desc: '폴짝' },
  { id: 3, key: '3', name: '웃기', icon: '😄', desc: '하하' },
  { id: 4, key: '4', name: '울기', icon: '😢', desc: '흑흑' },
  { id: 5, key: '5', name: '잠자기', icon: '💤', desc: 'zzz' },
  { id: 6, key: '6', name: '하품', icon: '🥱', desc: '하암' },
  { id: 7, key: '7', name: '화내기', icon: '💢', desc: '부들부들' },
  { id: 8, key: '8', name: '하트', icon: '❤', desc: '사랑해요' },
  { id: 9, key: '9', name: '춤', icon: '🎵', desc: '신난다' },
  { id: 10, key: 'E', name: '밀치기', icon: '👊', desc: '앞사람 한 칸 밀기 (쿨타임 10초, 상점에서 단축)' },
  { id: 14, key: 'R', name: '끌기', icon: '🧲', desc: '앞사람을 내 자리로 끌어오고 나는 한 칸 물러남 (밀치기와 쿨타임 공유). 갈고리가 있으면 앞 4칸 안의 한 명을 무작위로' },
];

export const DEFAULT_CONFIG: ServerConfig = {
  maxPlayers: 60,
  maintenance: { on: false, message: '서버 점검 중입니다. 잠시 후 다시 접속해 주세요.' },
  announcement: null,
  activeMap: 'default',
  logRetention: { chat: 2000, conn: 2000 },
  allCooldownSec: 10,
  boardRetention: 300,
  contest: { ...DEFAULT_CONTEST },
  hoursBlock: false,
};
