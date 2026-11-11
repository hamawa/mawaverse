// 낚시 데이터. 게임과 관리자 페이지가 같이 쓴다 (DOM/Firebase 의존 없음)
// 종류 목록은 DB `fish/defs` 가 우선(관리자가 추가·수정·비활성화)이고, 비어 있으면 DEFAULT_FISH 를 쓴다.
// 공용 로직은 collection.ts 의 Collection. 아래 함수들은 fishColl 에 위임하는 얇은 이름들이다.
import { Collection, TIME_LABEL, timeActive, RARITY_POINTS, type CollDef, type CollDefRecord, type PickOpt, type DefTime, type BookEntry, type WeekEntry, type BestEntry, type FeedEntry } from './collection';
export { RARITY_NAME, RARITY_POINTS, RARITY_COLOR } from './collection';
export type { Rarity, PickOpt } from './collection';

// 찌가 흔들린("!") 뒤 F 를 눌러야 하는 제한시간(ms). 희귀할수록 짧다 (신화는 전설과 같다: 한 번 걸린 걸 반응 속도로 놓치게 하진 않는다)
export const REACT_MS = [1200, 900, 600, 400, 400] as const;
export const JUNK_REACT_MS = 1500;
// 던진 뒤 입질까지 기다리는 시간 범위(ms)
export const BITE_WAIT_MIN_MS = 3000;
export const BITE_WAIT_MAX_MS = 10000;
// 영웅 등급 이상을 낚으면 모두에게 공지
export const ANNOUNCE_RARITY = 2;

export type FishTime = DefTime;
export const FISH_TIME_LABEL = TIME_LABEL;
export type FishDef = CollDef;
export type FishDefRecord = CollDefRecord;

// 코드에 들어 있는 기본 목록. 관리자 화면의 "기본 목록" 과 "기본값으로" 가 이걸 쓴다
export const DEFAULT_FISH: FishDef[] = [
  // 일반
  { id: 'medaka', name: '송사리', icon: '🐟', rarity: 0, min: 3, max: 7, w: 14, desc: '연못의 터줏대감. 작지만 당당하다.' },
  { id: 'minnow', name: '피라미', icon: '🐟', rarity: 0, min: 6, max: 14, w: 13, desc: '햇빛에 반짝이는 은빛 꼬마.' },
  { id: 'crucian', name: '붕어', icon: '🐟', rarity: 0, min: 12, max: 35, w: 12, desc: '한국 낚시의 기본. 붕어빵의 그 붕어.' },
  { id: 'loach', name: '미꾸라지', icon: '🐟', rarity: 0, min: 8, max: 22, w: 10, desc: '미끌미끌. 손에서 자꾸 빠져나간다.' },
  { id: 'bluegill', name: '블루길', icon: '🐠', rarity: 0, min: 10, max: 25, w: 9, desc: '어디서 왔는지 모르겠지만 여기 산다.' },
  // 희귀
  { id: 'carp', name: '잉어', icon: '🐟', rarity: 1, min: 30, max: 80, w: 6, desc: '묵직한 손맛. 연못의 중견 사원.' },
  { id: 'catfish', name: '메기', icon: '🐟', rarity: 1, min: 30, max: 90, w: 5, desc: '수염이 멋진 밤의 사냥꾼.' },
  { id: 'goldfish', name: '금붕어', icon: '🐠', rarity: 1, min: 5, max: 15, w: 5, desc: '누가 연못에 놓아준 걸까.' },
  { id: 'lunchtrout', name: '도시락 송어', icon: '🍱', rarity: 1, min: 20, max: 45, w: 5, time: 'lunch', desc: '점심시간에만 올라온다. 밥 먹고 왔니?' },
  // 영웅
  { id: 'koi', name: '비단잉어', icon: '🎏', rarity: 2, min: 40, max: 90, w: 2.2, desc: '알록달록 비단결. 연못의 임원급.' },
  { id: 'sturgeon', name: '철갑상어', icon: '🦈', rarity: 2, min: 60, max: 150, w: 1.6, desc: '이게 왜 회사 연못에…?' },
  { id: 'nighteel', name: '야근 장어', icon: '🌙', rarity: 2, min: 50, max: 110, w: 2.2, time: 'night', desc: '퇴근 후에만 나타난다. 눈 밑이 어둡다.' },
  // 전설
  { id: 'goldcarp', name: '황금잉어', icon: '✨', rarity: 3, min: 50, max: 120, w: 0.5, desc: '전설로만 전해지던 그 잉어. 소원을 들어준다는 소문이.' },
  { id: 'turtle', name: '용궁 거북', icon: '🐢', rarity: 3, min: 30, max: 60, w: 0.4, desc: '용궁에서 심부름 나온 길. 등에 토끼는 없다.' },
  // 신화 (2026-11-09): 장비·미끼와 무관하게 w/전체 ≈ 1/100,000 로만 뽑힌다 (collection.ts pick)
  { id: 'dragon', name: '용', icon: '🐉', rarity: 4, min: 300, max: 900, w: 0.001, desc: '용궁에서 올라왔다. 비늘 한 장이 월급. 낚은 사람은 회사 전설이 된다.' },
  // 대회 한정
  { id: 'trophy', name: '트로피 붕어', icon: '🏆', rarity: 2, min: 30, max: 70, w: 2.5, time: 'contest', desc: '대회 때만 나타나는 금빛 붕어. 들어 올리면 박수 소리가 난다.' },
  { id: 'medal', name: '금메달 잉어', icon: '🥇', rarity: 3, min: 60, max: 130, w: 0.6, time: 'contest', desc: '대회의 주인공. 비늘마다 메달이 박혀 있다.' },
  // 꽝
  { id: 'boot', name: '낡은 장화', icon: '👢', rarity: 0, junk: true, min: 0, max: 0, w: 7, desc: '한 짝뿐이다. 나머지 한 짝은 어디에?' },
  { id: 'can', name: '빈 깡통', icon: '🥫', rarity: 0, junk: true, min: 0, max: 0, w: 7, desc: '분리수거는 제대로 합시다.' },
  { id: 'badge', name: '젖은 사원증', icon: '🪪', rarity: 0, junk: true, min: 0, max: 0, w: 5, desc: '사진이 번져서 누군지 모르겠다.' },
  { id: 'coffee', name: '식은 커피', icon: '☕', rarity: 0, junk: true, min: 0, max: 0, w: 6, desc: '커피 내기에서 진 사람이 버린 걸까.' },
  { id: 'namecard', name: '퇴사자의 명함', icon: '📇', rarity: 0, junk: true, min: 0, max: 0, w: 3, desc: '이름은 지워져 있다. 누구였더라…' },
];

export const fishColl = new Collection(DEFAULT_FISH);
export const fishDefs = (): FishDef[] => fishColl.list();
export const activeFish = (): FishDef[] => fishColl.active();
export const setFishDefs = (list: FishDef[] | null): void => fishColl.set(list);
export const fishById = (id: string): FishDef | undefined => fishColl.byId(id);
export const isDefaultFish = (id: string): boolean => fishColl.isDefault(id);
export const defaultFishById = (id: string): FishDef | undefined => fishColl.defaultById(id);
export const defToRecord = (f: FishDef, ord: number): FishDefRecord => fishColl.toRecord(f, ord);
export const defsFromDb = (v: Record<string, Partial<FishDefRecord>> | null | undefined): FishDef[] | null => fishColl.fromDb(v);
export const defaultDefsRecord = (): Record<string, FishDefRecord> => fishColl.defaultRecord();
export const fishTimeActive = timeActive;
export const fishPool = (d = new Date(), list = activeFish(), contest = false): FishDef[] => fishColl.pool(d, list, contest);
export const fishChance = (id: string, pool: FishDef[]): number => fishColl.chance(id, pool);
export const pickFish = (rand = Math.random, d = new Date(), opt?: PickOpt): FishDef => fishColl.pick(rand, d, opt);
export const rollSize = (f: FishDef, rand = Math.random): number => fishColl.rollSize(f, rand);
export const rollKingSize = (f: FishDef, rand = Math.random): number => fishColl.rollKingSize(f, rand); // 킹 낚싯대: 최대 크기 × 1.5~2.0
export function fmtSize(cm: number): string { return `${cm}cm`; }

export function reactWindowMs(f: FishDef): number { return f.junk ? JUNK_REACT_MS : REACT_MS[f.rarity]; }
export function fishPoints(f: FishDef): number { return f.junk ? 0 : RARITY_POINTS[f.rarity]; }

// 주간 랭킹 키: 그 주 월요일 날짜 (로컬 시간). 예: 20261102
export function weekKey(ts = Date.now()): string {
  const d = new Date(ts);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const p = (n: number) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// ---- DB 레코드 (fish/book, fish/week, fish/best, fish/feed) ----
export type FishBookEntry = BookEntry;
export type FishWeekEntry = WeekEntry;
export type FishBest = BestEntry;
export type FishFeed = FeedEntry;
