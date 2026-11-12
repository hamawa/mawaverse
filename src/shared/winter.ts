// 겨울 얼음 낚시터(winter 맵) 전용 물고기 풀. 이 맵 안에서 던진 낚시에만 쓰이고, 일반 물고기 목록(shared/fish.ts DEFAULT_FISH · DB fish/defs)과는 섞이지 않는다:
//  - 일반 맵의 낚시는 이 풀을 못 뽑고, 겨울 맵의 낚시는 일반 풀을 못 뽑는다 (fishing.ts 가 맵으로 가른다)
//  - 관리자가 고치는 DB 목록(fish/defs)에 의존하지 않는다: 늘 코드의 이 목록이다. 종 id 는 모두 'ice-' 로 시작해 도감·최고 기록 경로(fish/book·fish/best)에서 일반 종과 겹치지 않는다
//  - 시간대·대회 한정 종은 없다. 낚싯대 배수·강화·킹 사이즈·미끼 규칙은 일반과 같은 collection.ts 로직을 쓴다 (경제 인터페이스는 그대로)
import { Collection, type CollDef, type PickOpt } from './collection';

export const WINTER_FISH_PREFIX = 'ice-';

export const WINTER_FISH: CollDef[] = [
  // 일반
  { id: 'ice-smelt', name: '빙어', icon: '🐟', rarity: 0, min: 5, max: 15, w: 14, desc: '얼음 구멍으로 올라오는 맑은 은빛 물고기.' },
  { id: 'ice-char', name: '산천어', icon: '🐟', rarity: 0, min: 20, max: 35, w: 12, desc: '찬 물에서만 산다. 손이 시려도 놓칠 수 없다.' },
  { id: 'ice-shrimp', name: '얼음 새우', icon: '🦐', rarity: 0, min: 2, max: 6, w: 9, desc: '얼음 아래에서 꼼지락거린다.' },
  // 희귀
  { id: 'ice-trout', name: '서리 송어', icon: '🐟', rarity: 1, min: 30, max: 70, w: 6, desc: '비늘에 서리가 내려앉았다.' },
  { id: 'ice-lenok', name: '열목어', icon: '🐟', rarity: 1, min: 40, max: 80, w: 5, desc: '물이 차가워야 산다. 눈빛이 매섭다.' },
  { id: 'ice-dolly', name: '곤들매기', icon: '🐠', rarity: 1, min: 25, max: 55, w: 5, desc: '점박이 무늬가 눈송이 같다.' },
  // 영웅
  { id: 'ice-pike', name: '서리 강꼬치', icon: '🦈', rarity: 2, min: 60, max: 130, w: 2.2, desc: '얼음 밑의 사냥꾼. 이빨에도 서리가 맺혔다.' },
  { id: 'ice-aurora', name: '오로라 연어', icon: '🌌', rarity: 2, min: 50, max: 100, w: 1.8, desc: '몸에서 오로라 빛이 일렁인다.' },
  // 전설
  { id: 'ice-crystal', name: '수정 빙어', icon: '💎', rarity: 3, min: 20, max: 40, w: 0.5, desc: '투명한 몸이 수정처럼 빛난다.' },
  // 신화: 장비·미끼와 무관하게 w/전체 ≈ 1/100,000 (collection.ts pick)
  { id: 'ice-dragon', name: '빙룡', icon: '🐲', rarity: 4, min: 300, max: 800, w: 0.001, desc: '얼어붙은 호수 아래 잠든 용. 낚은 사람은 겨울의 전설이 된다.' },
  // 꽝
  { id: 'ice-icicle', name: '고드름', icon: '🧊', rarity: 0, junk: true, min: 0, max: 0, w: 7, desc: '낚싯줄에 매달린 차가운 고드름.' },
  { id: 'ice-glove', name: '얼어붙은 장갑', icon: '🧤', rarity: 0, junk: true, min: 0, max: 0, w: 6, desc: '한 짝만 딱딱하게 얼어 있다.' },
  { id: 'ice-snowball', name: '눈덩이', icon: '⚪', rarity: 0, junk: true, min: 0, max: 0, w: 6, desc: '누가 던져 넣었을까.' },
  { id: 'ice-shard', name: '깨진 얼음 조각', icon: '❄️', rarity: 0, junk: true, min: 0, max: 0, w: 4, desc: '구멍을 낼 때 떨어진 조각.' },
];

// DB 로 덮어쓰지 않는 고정 풀 (set 을 부르지 않는다)
export const winterColl = new Collection(WINTER_FISH);
export const winterFishById = (id: string): CollDef | undefined => winterColl.byId(id);
export const isWinterFish = (id: string): boolean => id.startsWith(WINTER_FISH_PREFIX);
export const kingEligibleFish = (defs: readonly CollDef[]): CollDef[] => defs.filter((f) => !f.junk && !isWinterFish(f.id));
// 겨울 맵에서 낚시 한 번의 결과. 대회 한정 종이 없고 시간대 제한도 없어 시각·대회 인자는 쓰지 않는다
export const pickWinterFish = (rand = Math.random, opt?: PickOpt): CollDef => winterColl.pick(rand, new Date(), { ...opt, contest: false });
