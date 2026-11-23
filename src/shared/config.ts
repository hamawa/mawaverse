import { DEFAULT_CONTEST } from './contest';
import type { ServerConfig } from './types';
import type { RaceHours } from './derby/time';

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
export const LEAVE_NOTICE_MS = 180000; // 퇴장 알림을 이만큼 늦춘다: 그 안에 돌아오면 퇴장·입장 둘 다 알리지 않는다 (폰의 앱 전환·PC 절전으로 잠깐 끊긴 사람. 2026-11-20)
// 규칙·지갑 형식처럼 옛 클라이언트가 못 쓰게 되는 변경을 배포할 때마다 1씩 올린다. config/minVersion 이 이 값보다 크면 그 클라이언트는 스스로 새로고침한다
export const CLIENT_VERSION = 53; // 53: 경마공원 (race-park 맵·마권 발매·정산 규칙과 지갑 칸이 바뀌어 옛 화면은 경마공원 마권을 못 산다) · 52: 클럽 예약 한 사람 10곡·전체 20곡 (club 규칙의 열쇠가 {uid}_0~9 로. 옛 화면은 2곡까지만 건다)·두더지 창을 Esc·바깥 누르기로 닫으면 키가 안 먹던 것 수정 (옛 화면에서는 계속 난다) · 51: 건의 묶음 (말풍선 글꼴을 기본으로 · 주간 1위 표시 · 크리스마스: 소나무 조명·한정 품목·캐롤. 옛 화면에는 새 모자·말풍선·가구·표시가 안 보인다) · 50: 클럽 노래 예약 (club 규칙이 바뀌어 옛 화면은 노래를 틀 수 없다) · 49: 말풍선 꾸미기 (옛 화면에는 남의 꾸민 말풍선이 기본 모양으로 보인다) · 4: 끌기·갈고리·스턴·광장 보내기, 5: 채팅 정리·자동 30분/1시간·낚싯대·잠자리채, 6: 선물하기(지갑 gt), 7: 펫, 8: 카지노 경마·커피 거리 개편, 9: 마피아, 10: 자동 낚시 안내 숨김·알림 자리·미끼 상향, 11: 신화 등급(지갑 md)·미끼 재조정·물가 돌아서기·모바일 복귀 정리 (2026-11-09), 12: 파티 삭제·획득 상한 삭제·펫 레벨(지갑 px)·낚싯대 강화(지갑 rs/es)·마피아 개편·경마 1만 (2026-11-10), 13: 펫 먹이 가격이 먹인 수에 비례해 오름(지갑 규칙 변경) (2026-11-10), 14: 탑승 그림 교체·펫 스킬 Lv8 해금·상향(규칙 sh/sk 170) (2026-11-10), 15: 펫 스킬(Q) 삭제 → 종류 무관 상시 효과(걷기 +2.5%/Lv·Lv5 벌레 안 도망·Lv8 100% 막기+80% 반사), 규칙 sh/sk 삭제 (2026-11-10), 16: 걸음 한 번 쓰기(occ 규칙)·전송량 줄이기, 17: 포탈 맵(presence m·맵별 occ 키·채팅 m), 18: 포탈 행선지 선택·금광 채광(지갑 gn/ga)·킹 낚싯대(지갑 ks, rod3)·부서진 낚싯대 무료 복구 수정 (2026-11-11), 19: 빠따(지갑 bt/bo, 타격 메시지 b, presence gb)·샤샤샥 이펙트 (2026-11-11), 20: 키 E·R·T·모바일 버튼 재배치·귓속말 이어 가기·카지노 자리 고정·커피 내기 삭제·게시판 패치 노트 (2026-11-12. 옛 클라이언트와 섞여도 문제없어 minVersion 은 올리지 않았다), 21: 경마 배팅이 사라지던 버그 수정 (2026-11-12. 옛 클라이언트가 달리는 경주 위에 새 라운드를 열 수 있어 minVersion 도 21 로), 22: 슬롯 방(슬롯·홀짝, 지갑 ik/ib/ip/it/ic, slot/jp) (2026-11-12), 23: 1:1 내기 주사위 대결(duel·duelInv, 지갑 dl/dc, presence nd, config/duelFee) (2026-11-12), 24: 포커 방 인디언 포커(pkh·pkc·pkt, 지갑 pk/ps/pc) (2026-11-12), 25: 낚시 내기(duel k='fish', fa/fb/ra/rb) (2026-11-12), 26: 코인 곡괭이 강화(지갑 pi)·단계별 연속 채광·겨울 맵(얼음 낚싯대 iceRod·스키 장갑 눈싸움: 말랑이 메시지 s, eq sg·눈사람 벌칙: users snowBrokenAt, presence sn, winter/events) (2026-11-12, 기여자 PR. 이 줄의 지갑 pi 는 곡괭이 단계: 포커의 pk 와 겹쳐 pi 로 옮겼다), 27: 햄스터 캐릭터(x51~x53)·햄스터 펫(pethamster, 지갑 px)·겨울 낚시 붕어빵 (2026-11-16 건의 반영. 옛 화면은 햄스터 캐릭터를 기본 캐릭터로, 햄스터 펫은 안 보이게 그린다), 28: 귓속말의 끝 글자가 공개 채팅으로도 나가던 버그 수정 (2026-11-17. 옛 화면에서는 계속 나므로 minVersion 도 28 로), 29: 내 집(homes, 집 맵 id h-{uid}, presence sd·hz, 보관함 house2·house3·hslot1~6)·음식 캐릭터(x54~x59)·외모/닉네임 변경 요금(avatarfee·nickfee) (2026-11-17 건의 반영. 옛 화면은 집 안에 있는 사람을 다른 맵에 있는 것으로 보고 안 그리고, 음식 캐릭터는 기본 캐릭터로 그린다), 30: 어둠의 빠따(지갑 bd, 메시지 b=2, 관리자용 기록 logs/chat c='d') (2026-11-17 사용자 제안. 옛 화면은 b=2 를 빠따로 알아보지 못해 갑옷으로 막고 "막았다" 안내에 이름이 그대로 나오므로 minVersion 도 30 으로), 31: 집 꾸미기(homes 의 fu·d·fl·tr: 가구·바닥·물고기 박제)·나무가 베이고 다시 자라기(trees/{맵}/{x_y}) (2026-11-17 저녁. 옛 화면은 벤 나무를 그대로 캐고 그루터기를 안 그리며, 남의 집 가구가 안 보인다), 32: 외모·닉네임 교환권 선물(보관함 avatarticket·nickticket)·계란 캐릭터(x60·x61) (2026-11-17 저녁 건의 반영. 옛 화면은 받은 교환권을 쓰지 못하고 요금을 낸다), 33: 서 있는 자리와 떨어진 찌는 그리지 않고 스스로 거둔다·계란 캐릭터 모양·내 소식은 왼쪽 위에(남의 전설 토스트 삭제)·뒤쪽 탭 나무 캐기·갈고리 뒤 펫 자리 (2026-11-18. 옛 화면은 떨어진 찌를 그대로 그린다), 34: 소리(효과음·배경음악, 처음엔 꺼짐)·낮밤 효과·집 안을 돌아다니는 펫·화면 꺼짐 방지 (2026-11-18 사용자 요청. 전부 화면·스피커에만 있는 효과라 옛 화면과 섞여도 문제없다), 35: 나무 캐기 진행 막대·눈사람 칭호를 닉네임 바로 위로·집 안에서는 데리고 온 펫도(주인·손님) 풀려나 돌아다님 (2026-11-18 사용자 요청. 옛 화면은 집 안에서 펫이 주인을 따라다니는 것으로 그린다), 36: 아이폰에서 소리가 나지 않던 것 대응(무음 스위치·interrupted)·박제 이름을 닉네임 크기로·집 안 펫은 전부 기본 크기 (2026-11-18), 37: 칭호(착용 칸 tt)·비싼 꾸미기·고급 가구(fn)·벽지(homes wl)·금덩이 품목(gg, 지갑 규칙)·새벽/비 한정 물고기(시간대 dawn·rain)·날씨·방명록(homes gb)·앉기(presence si)·클럽 맵(club)·무지개 꼬리 id 분리(rainbowtrail) (2026-11-18 사용자 요청. 옛 화면은 새 시간대를 몰라 한정 종을 언제나 낚으므로 물고기를 넣을 때 minVersion 도 37 로), 38: 낚시·채집 소식(fish/feed·bug/feed)은 신화만 보낸다: 화면이 쓰지 않는 영웅·전설 소식 전송 중단 (2026-11-18 사용량 검토. 옛 화면은 계속 보내므로 바로 줄이려면 minVersion 도 38 로), 39: 가구 방향(homes dr)·클럽 음악을 구간이 있는 EDM 으로(edm.ts)·계절(11/15~1/31 눈과 단풍, 4~5월 벚꽃)·앵무새 펫(petparrot, 지갑 px·따라 말하기) (2026-11-19 사용자 요청. 옛 화면은 돌린 가구를 앞모습으로, 앵무새를 안 보이게 그리고 눈 대신 비를 그린다), 40: 앉으면 가구 칸으로 실제로 옮겨 간다(서 있던 칸이 빈다)·앉은 모습 높이·이펙트 미리보기·곡괭이 단계만큼 나무(homes 규칙이 지갑 pi 를 본다)·낚시 반지 5종(fish/defs)·두더지 금빛 잔상 (2026-11-19 건의·제보 반영. 옛 화면은 새 방식으로 앉은 사람을 의자 위에 서 있는 것으로 그리고, 곡괭이 보너스 없이 나무를 캔다), 41: 거래소(stock/p·hist·h: 세 종목, 가격은 접속한 화면이 5분마다 굴린다)·배포 규칙 압축(gen-gate) (2026-11-19 건의 반영. 옛 화면에는 거래소가 없고 가격도 굴리지 않는다), 42: 클럽 DJ(club/dj: DJ 자리에서 유튜브 링크로 노래 틀기, 클럽에 있는 모두에게 같은 지점부터) (2026-11-19 사용자 요청. 옛 화면에는 DJ 화면이 없어 노래가 안 나온다), 43: 2026-11-20 건의 묶음(마피아 안개·불 사보타지와 초대·동료 표시, 거래소 한도 1000주, 금고, 사진 액자, 모두에게 보이는 눈사람, 모닥불, 펫 이름·모자·안경, 바깥 게임 오락기. 옛 화면은 사보타지·남의 눈사람·모닥불·펫 꾸미기를 모르고, 맵의 새 오락기가 안 보이는 장애물로 나온다), 44: 모닥불이 길을 막는다(화면이 막으므로 옛 화면은 불 위를 지나다닌다), 펫 이름을 펫 아래로, 앉으면 펫이 머리 위에, DJ 창 끌기·크기 조절·전체 화면과 끝난 영상 자동 종료, 집 사진을 눌러 크게 보기, 45: 내 모닥불 끄기, 포탈 정원 연못 위쪽을 벤치로(앉아서 낚시), 탁자 옆 의자가 탁자를 본다, 클럽 좌석을 4인석·2인석으로 (옛 화면은 포탈 정원·클럽의 가구 자리가 달라 앉은 사람이 엉뚱한 칸에 보인다), 46: 낚을 때·미끼·채광의 지갑 쓰기를 바뀐 칸만 보내게 (전송량. 옛 화면도 그대로 동작하지만 줄어드는 효과가 없다), 47: 서버 시각 어림을 스스로 맞춤 (옛 화면은 기기 시계가 튀면 빠따에 맞아도 방어 깨짐 표시가 안 뜬다)·접속자 목록 위치·입퇴장 알림 묶기, 48: 글자가 캐릭터를 가리지 않게(펫 이름·겹치는 이름표·남쪽 안내)·박제 이름은 눌렀을 때만·클럽 영상 창을 앞에 (옛 화면도 그대로 동작한다. 모두에게 바로 적용하려고 올렸다)
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

// 경마공원 운영 시간 config/raceHours. 읽은 값(타입 없음)을 time.ts 가 받는 모양으로: 객체가 아니면 null(= 휴장). 칸의 s·e 검사는 raceSlot 이 한다
export function normalizeRaceHours(raw: unknown): RaceHours | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { on?: unknown; d?: unknown };
  return { on: r.on, d: r.d && typeof r.d === 'object' ? (r.d as RaceHours['d']) : null };
}
// 이미 읽어 둔 config(타입에 없는 raceHours 칸 포함)에서 꺼낸다
export function raceHoursOf(cfg: object | null | undefined): RaceHours | null {
  return normalizeRaceHours((cfg as { raceHours?: unknown } | null | undefined)?.raceHours);
}
