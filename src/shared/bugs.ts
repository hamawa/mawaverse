// 곤충 채집 데이터. 게임과 관리자 페이지가 같이 쓴다 (DOM/Firebase 의존 없음)
// 종류 목록은 DB `bug/defs` 가 우선이고 비어 있으면 DEFAULT_BUGS. 공용 로직은 collection.ts
import { Collection, RARITY_POINTS, type CollDef } from './collection';

// 잠자리채를 휘둘렀을 때 잡힐 확률 (등급별). 꽝은 항상. 신화는 절반 (황금 잠자리채면 무조건)
export const CATCH_CHANCE = [1, 0.7, 0.5, 0.35, 0.5] as const;
export const BUG_MAX_ALIVE = 4;          // 내 화면에 동시에 있는 벌레 수
export const BUG_SPAWN_MS = 3000;        // 새 벌레가 나타나는 간격
export const BUG_LIFE_MIN_MS = 20000;    // 벌레가 머무는 시간 범위
export const BUG_LIFE_MAX_MS = 40000;
export const BUG_SCARE_DIST = 3;         // 이 거리 안에서 달리면 날아간다
export const BUG_ANNOUNCE_RARITY = 2;    // 영웅 이상은 전체 공지
export const BUG_SAVE_GAP_MS = 350;      // 기록 쓰기 간격 (주간 기록 규칙 0.3초). 채집 자체에는 쿨타임이 없다
export const BUG_AUTO_GAP_MS = 250;      // 자동 채집 버프: 휘두르는 간격

export const DEFAULT_BUGS: CollDef[] = [
  // 일반
  { id: 'cabbage', name: '배추흰나비', icon: '🦋', rarity: 0, min: 45, max: 60, w: 14, desc: '풀밭의 단골. 팔랑팔랑.' },
  { id: 'ladybug', name: '무당벌레', icon: '🐞', rarity: 0, min: 5, max: 8, w: 13, desc: '점이 일곱 개면 행운이래.' },
  { id: 'ant', name: '개미', icon: '🐜', rarity: 0, min: 3, max: 6, w: 12, desc: '야근 중. 말 걸지 마세요.' },
  { id: 'bee', name: '꿀벌', icon: '🐝', rarity: 0, min: 10, max: 15, w: 10, desc: '화단에서 출근 도장 찍는 중.' },
  { id: 'hopper', name: '메뚜기', icon: '🦗', rarity: 0, min: 20, max: 40, w: 9, desc: '한 번에 세 칸은 뛴다.' },
  // 희귀
  { id: 'swallowtail', name: '호랑나비', icon: '🦋', rarity: 1, min: 80, max: 110, w: 6, desc: '줄무늬가 멋진 큰 나비. 가까이 가면 금방 안다.' },
  { id: 'snail', name: '달팽이', icon: '🐌', rarity: 1, min: 15, max: 40, w: 5, desc: '느리지만 성실하다. 집은 자가.' },
  { id: 'spider', name: '무당거미', icon: '🕷', rarity: 1, min: 10, max: 25, w: 5, desc: '거미줄에 걸린 건 보고서였다.' },
  { id: 'lunchfly', name: '도시락 나비', icon: '🦋', rarity: 1, min: 50, max: 70, w: 5, time: 'lunch', desc: '점심시간에만 날아온다. 반찬 냄새를 좋아한다.' },
  // 영웅
  { id: 'mantis', name: '왕사마귀', icon: '🦗', rarity: 2, min: 60, max: 90, w: 2.2, desc: '풀밭의 사냥꾼. 팔짱 끼고 노려본다.' },
  { id: 'firefly', name: '반딧불이', icon: '✨', rarity: 2, min: 8, max: 12, w: 2.2, time: 'night', desc: '퇴근 후 어둠 속에서만 보인다.' },
  { id: 'scorpion', name: '사막 전갈', icon: '🦂', rarity: 2, min: 40, max: 70, w: 1.6, desc: '어디서 들어왔지? 조심조심.' },
  // 전설
  { id: 'goldbug', name: '황금 무당벌레', icon: '🌟', rarity: 3, min: 6, max: 9, w: 0.5, desc: '등딱지가 진짜 금이라는 소문. 보면 소원을 빌자.' },
  { id: 'ghostmoth', name: '유령 나방', icon: '👻', rarity: 3, min: 90, max: 130, w: 0.4, time: 'night', desc: '밤에만 나타나는 반투명 나방. 잡아도 믿어주지 않는다.' },
  // 신화 (2026-11-09): 장비와 무관하게 나타날 확률 w/전체 ≈ 1/50,000 (나타나도 잡힐 확률은 절반). collection.ts pick
  { id: 'fairy', name: '요정', icon: '🧚', rarity: 4, min: 90, max: 150, w: 0.002, desc: '잠자리채에 걸린 요정. 화가 많이 났다. 소원 대신 잔소리를 들어준다.' },
  // 꽝
  { id: 'leaf', name: '나뭇잎', icon: '🍃', rarity: 0, junk: true, min: 0, max: 0, w: 7, desc: '벌레인 줄 알았는데 잎이었다.' },
  { id: 'dandelion', name: '민들레 씨', icon: '🌾', rarity: 0, junk: true, min: 0, max: 0, w: 6, desc: '후 불면 날아간다.' },
  { id: 'plane', name: '종이비행기', icon: '🛩', rarity: 0, junk: true, min: 0, max: 0, w: 5, desc: '누가 회의 중에 접은 것 같다.' },
  { id: 'minutes', name: '날아간 회의록', icon: '📄', rarity: 0, junk: true, min: 0, max: 0, w: 5, desc: '결론: 다음에 다시 논의.' },
  { id: 'dustball', name: '먼지 뭉치', icon: '🌫', rarity: 0, junk: true, min: 0, max: 0, w: 4, desc: '청소 담당은 누구였더라.' },
  { id: 'fallen', name: '낙엽', icon: '🍂', rarity: 0, junk: true, min: 0, max: 0, w: 3, desc: '가을이 왔다는 신호.' },
];

export const bugColl = new Collection(DEFAULT_BUGS);
export function bugCatchChance(f: CollDef): number { return f.junk ? 1 : CATCH_CHANCE[f.rarity]; }
export function bugPoints(f: CollDef): number { return f.junk ? 0 : RARITY_POINTS[f.rarity]; }
export function fmtBugSize(mm: number): string { return `${mm}mm`; }
