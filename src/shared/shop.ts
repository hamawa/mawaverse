// 상점 품목과 지갑 형태. 게임·관리자 페이지가 같이 쓴다 (DOM/Firebase 의존 없음)
// 가격은 config/prices/{id} 로 관리자가 덮어쓸 수 있다 (priceOf)

export type ItemKind = 'hat' | 'name' | 'fx' | 'pet' | 'fish' | 'use' | 'push' | 'gear' | 'rod' | 'net'; // use: 소모품 (펫 먹이·강화 주문서. 지갑에만 기록, 2026-11-10)
export type CosmeticKind = Exclude<ItemKind, 'fish' | 'use' | 'push' | 'gear' | 'rod' | 'net'>; // 착용하는 것들 (펫도 "착용": 한 번에 한 마리)
export interface ShopItem { id: string; kind: ItemKind; name: string; price: number; icon: string; desc: string; color?: string }

export const HATS: ShopItem[] = [
  { id: 'straw', kind: 'hat', name: '밀짚모자', price: 300, icon: '👒', desc: '햇볕 가리기용. 낚시터 기본템.' },
  { id: 'cap', kind: 'hat', name: '캡모자', price: 400, icon: '🧢', desc: '체육대회 느낌.' },
  { id: 'beanie', kind: 'hat', name: '비니', price: 400, icon: '🧶', desc: '방울 달린 겨울 비니.' },
  { id: 'party', kind: 'hat', name: '고깔모자', price: 500, icon: '🎉', desc: '오늘은 내 생일인가 봐.' },
  { id: 'ribbon', kind: 'hat', name: '리본', price: 600, icon: '🎀', desc: '커다란 분홍 리본.' },
  { id: 'wizard', kind: 'hat', name: '마법사 모자', price: 1000, icon: '🧙', desc: '별이 박힌 보라색 고깔.' },
  { id: 'catears', kind: 'hat', name: '고양이 귀', price: 1200, icon: '🐱', desc: '냥.' },
  { id: 'crown', kind: 'hat', name: '왕관', price: 1500, icon: '👑', desc: '마을의 주인은 나.' },
];

export const NAME_COLORS: ShopItem[] = [
  { id: 'red', kind: 'name', name: '빨강', price: 200, icon: '🟥', desc: '', color: '#ff8080' },
  { id: 'orange', kind: 'name', name: '주황', price: 200, icon: '🟧', desc: '', color: '#ffb35c' },
  { id: 'yellow', kind: 'name', name: '노랑', price: 200, icon: '🟨', desc: '', color: '#ffe66d' },
  { id: 'green', kind: 'name', name: '초록', price: 200, icon: '🟩', desc: '', color: '#8ce99a' },
  { id: 'mint', kind: 'name', name: '민트', price: 200, icon: '🧊', desc: '', color: '#7ff0d4' },
  { id: 'sky', kind: 'name', name: '하늘', price: 200, icon: '🟦', desc: '', color: '#8fd3ff' },
  { id: 'blue', kind: 'name', name: '파랑', price: 200, icon: '🔷', desc: '', color: '#8da2ff' },
  { id: 'purple', kind: 'name', name: '보라', price: 200, icon: '🟪', desc: '', color: '#c79bff' },
  { id: 'pink', kind: 'name', name: '분홍', price: 200, icon: '🌸', desc: '', color: '#ffa3d7' },
  { id: 'brown', kind: 'name', name: '갈색', price: 200, icon: '🟫', desc: '', color: '#d9b38c' },
  { id: 'gold', kind: 'name', name: '금테', price: 1500, icon: '🥇', desc: '금색 글자에 금테.' },
  { id: 'rainbow', kind: 'name', name: '무지개', price: 1500, icon: '🌈', desc: '흐르는 무지개 글자.' },
];

export const FX: ShopItem[] = [
  { id: 'dust', kind: 'fx', name: '먼지', price: 800, icon: '💨', desc: '걸을 때 발밑에서 먼지가 폴폴.' },
  { id: 'sparkle', kind: 'fx', name: '반짝이', price: 1000, icon: '✨', desc: '지나간 자리가 반짝반짝.' },
  { id: 'heart', kind: 'fx', name: '하트', price: 1200, icon: '💗', desc: '분홍 하트가 떠오른다.' },
  { id: 'fire', kind: 'fx', name: '불꽃', price: 1500, icon: '🔥', desc: '발에 불이 났다.' },
  { id: 'rainbow', kind: 'fx', name: '무지개 꼬리', price: 2000, icon: '🌈', desc: '무지개가 꼬리처럼 따라온다.' },
  { id: 'shasha', kind: 'fx', name: '샤샤샥', price: 10000, icon: '👥', desc: '움직일 때 내 모습의 잔상이 줄줄이 남는다.' }, // 파티클이 아니라 캐릭터 잔상 (cosmetics.ts drawAfterimages, 2026-11-11)
];

// 펫 (2026-11-09): 한 칸 뒤를 따라다니고(모두에게 보임), 주인 옆 칸에 벌레가 오면 PET_SWING_MS 마다 대신 잡아 준다 (주인의 잠자리채 등급 적용).
// 2026-11-10: 쿨타임을 0.1초로 줄였다(사용자 요청. 벌레 등장 속도가 실질적 한계라 자동 채집 아이템은 펫 주인에겐 의미가 없어짐). 한 번에 한 마리 (eq.pt, presence pt)
export const PET_SWING_MS = 100;
const PET_DESC = '한 칸 뒤를 졸졸 따라다니며 옆 칸에 온 벌레를 대신 잡아 준다(내 잠자리채 등급 적용). 먹이를 주면 레벨이 올라 몸집이 커지고 걷기가 빨라진다. Lv5 채집 2칸·달려도 벌레 안 도망, Lv8 채집 3칸·밀치기 방어, Lv10 탑승. 효과는 펫 종류와 상관없이 같다. 한 번에 한 마리.';
export const PET_GOODS: ShopItem[] = [
  { id: 'petdog', kind: 'pet', name: '강아지', price: 5000, icon: '🐶', desc: PET_DESC },
  { id: 'petcat', kind: 'pet', name: '고양이', price: 5000, icon: '🐱', desc: PET_DESC },
  { id: 'petchick', kind: 'pet', name: '병아리', price: 5000, icon: '🐤', desc: PET_DESC },
  { id: 'petrabbit', kind: 'pet', name: '토끼', price: 5000, icon: '🐰', desc: PET_DESC },
  { id: 'petslime', kind: 'pet', name: '슬라임', price: 5000, icon: '🟢', desc: PET_DESC },
  { id: 'petturtle', kind: 'pet', name: '거북이', price: 5000, icon: '🐢', desc: PET_DESC },
];
export const PET_IDS = PET_GOODS.map((p) => p.id); // 규칙 생성기(tools/gen-rules.cjs)의 PET_IDS 와 같아야 한다

// ---- 펫 먹이·레벨 (2026-11-10) ----
// 먹이를 주면 지갑 px/{펫 id} 가 1씩 오른다 (구매 = 먹이기, 한 번에 여러 개 가능). 펫 종류마다 따로 쌓인다.
// 가격은 그 펫이 먹은 수에 비례해 오른다 (2026-11-10 저녁, 거지 키우기 식): n번째 먹이 = 기본가 + PET_FOOD_STEP × n (n 은 0부터).
//  기본 100·폭 4 → Lv5 까지 9,900, Lv8 74,460, Lv10 총 209,400 (마지막 먹이 1,296). 규칙은 사용액이 foodCost 와 정확히 같은지 본다.
// 레벨은 누적 먹이로 계산: PET_LEVEL_XP[n-1] 이상이면 Lv n. Lv10(300개)이 되면 자동으로 타고 다닌다.
// 크기는 레벨마다 8%씩 (Lv9 = 1.64배). 탑승 중에는 주인 발밑에 2.6배로 그린다. Lv5 부터 채집 범위 2칸
export const PET_FOOD: ShopItem = { id: 'petfood', kind: 'use', name: '펫 먹이', price: 100, icon: '🍖', desc: '데리고 있는 펫에게 바로 먹인다. 먹일수록 다음 먹이가 조금씩 비싸진다. 먹이 5·15·30·50·80·120·170·230·300개에 Lv2~10. 레벨마다 몸집이 커지고 걷기가 2.5% 빨라진다. Lv5 채집 2칸·달려도 벌레 안 도망, Lv8 채집 3칸·밀치기 방어, Lv10 탑승.' };
export const PET_FOOD_STEP = 4; // 먹이 하나마다 다음 먹이 +4 코인 (tools/gen-rules.cjs 의 PET_FOOD_STEP 과 같아야 한다)
export function foodPrice(base: number, xp: number): number { return base + PET_FOOD_STEP * xp; } // 지금 xp 인 펫의 다음 먹이 1개 가격
export function foodCost(base: number, xp: number, n: number): number { return base * n + PET_FOOD_STEP * (n * xp + (n * (n - 1)) / 2); } // 연속 n 개 가격 합
export const PET_LEVEL_XP = [0, 5, 15, 30, 50, 80, 120, 170, 230, 300]; // Lv(index+1) 이 되는 누적 먹이
export const PET_MAX_LEVEL = PET_LEVEL_XP.length;
export const PET_RIDE_XP = PET_LEVEL_XP[PET_MAX_LEVEL - 1]; // 300: 이 이상이면 탑승
// 펫 효과는 종류와 상관없이 똑같다 (2026-11-10 밤, 사용자 결정 "종류별 밸런스 맞추기 어려우니 하나로 퉁치자". 그 전의 Q 스킬 6종은 삭제):
//  - 레벨마다 걷기 +2.5% (Lv10 +25% = 탑승 속도. 달리기는 그대로)   - Lv5 채집 2칸 + 달려도 벌레가 안 도망감
//  - Lv8 채집 3칸 + 갑옷처럼 밀치기·장풍·말랑이·끌기·갈고리 100% 막고, 보통 밀치기·말랑이는 80% 확률로 되받아침   - Lv10 탑승 그림
export const PET_RANGE_LEVEL = 5;        // 채집 2칸
export const PET_CALM_LEVEL = 5;         // 달려도 벌레 안 도망
export const PET_RANGE2_LEVEL = 8;       // 채집 3칸
export const PET_GUARD_LEVEL = 8;        // 100% 막기 (+80% 반사). 남들은 presence pt·pl 로 확인 (pl 은 규칙이 지갑 px 와 대조)
export const PET_GUARD_XP = PET_LEVEL_XP[PET_GUARD_LEVEL - 1]; // 170
export const PET_REFLECT_CHANCE = 0.8;
export const PET_SPEED_PER_LEVEL = 0.025;
export function petLevel(xp: number): number { let lv = 1; for (let i = 1; i < PET_LEVEL_XP.length; i++) if (xp >= PET_LEVEL_XP[i]) lv = i + 1; return lv; }
export function petNextXp(xp: number): number | null { const lv = petLevel(xp); return lv >= PET_MAX_LEVEL ? null : PET_LEVEL_XP[lv]; }
export function petScale(xp: number): number { return 1 + 0.08 * (petLevel(xp) - 1); } // 따라다닐 때 크기 (Lv10 1.72배). 탑승 모습은 cosmetics MOUNT_ART 가 따로
export function petCanRide(xp: number): boolean { return xp >= PET_RIDE_XP; }
export function petBugRange(xp: number): number { const lv = petLevel(xp); return lv >= PET_RANGE2_LEVEL ? 3 : lv >= PET_RANGE_LEVEL ? 2 : 1; }
export function petCalm(xp: number): boolean { return petLevel(xp) >= PET_CALM_LEVEL; }
export function petGuard(xp: number): boolean { return xp >= PET_GUARD_XP; }
export function petSpeedMul(xp: number): number { return 1 + PET_SPEED_PER_LEVEL * petLevel(xp); } // 걷기 속도 배수 (Lv1 1.025 … Lv10 1.25)
// 남의 presence 로 보는 펫 방어 (데리고 있는 펫이 Lv8 이상). 미는 쪽·던지는 쪽이 갑옷(pa/ta)처럼 미리 건너뛸 때 쓴다
export function petGuardOf(st: { pt?: string | null; pl?: number | null } | undefined): boolean { return !!st?.pt && petGuard(st.pl || 0); }

export const AUTO_REST_MS = 1500;           // 자동 낚시: 잡거나 놓친 뒤 다시 던질 때까지 쉬는 시간
// 미끼 (2026-11-09 두 번 조정): 다음 1회 던지기에 꽝·일반 제외(희귀 이상 확정). 10코인. 영웅·전설 배수는 없다 (처음 ×3 으로 올렸더니 전설이 4번에 1번 나와서 뺌).
// 기대값(실제 DB 목록 기준): 보통 던지기 ≈ 4.7코인/회 → 미끼 ≈ 19.6코인/회, 가격 10을 빼도 +9.6 으로 약 2배. 자동 낚시와 같이 쓰면 소모가 빠르니 묶음(5·20·50)으로 판다
// 자동 버프(자동 낚시 ar · 자동 채집 ab)는 10분·30분·1시간 세 가지 (2026-11-09, 30분·1시간은 사용자 지정 가격). 켜져 있을 때 더 사면 남은 시간 뒤에 이어 붙고,
// 남은 시간 포함 AUTO_MAX_MS 를 넘게는 못 산다 (규칙의 ar/ab 상한 now + 61분과 맞춤)
export const AUTO_MAX_MS = 60 * 60 * 1000;
export const AUTO_TIERS: { suffix: string; min: number; price: number; label: string }[] = [
  { suffix: '', min: 10, price: 100, label: '10분' },
  { suffix: '30', min: 30, price: 300, label: '30분' },
  { suffix: '60', min: 60, price: 600, label: '1시간' },
];
// 자동 버프 품목 id → 지속 시간(ms). 아니면 null
export function autoItemMs(id: string): number | null {
  const m = /^(autoreel|autobug)(\d*)$/.exec(id);
  if (!m) return null;
  const tier = AUTO_TIERS.find((t) => t.suffix === m[2]);
  return tier ? tier.min * 60 * 1000 : null;
}
export function autoKindOf(id: string): 'fish' | 'bug' | null { return id.startsWith('autoreel') ? 'fish' : id.startsWith('autobug') ? 'bug' : null; }

export const FISH_GOODS: ShopItem[] = [
  ...AUTO_TIERS.map((t): ShopItem => ({ id: `autoreel${t.suffix}`, kind: 'fish', name: `자동 낚시 ${t.label}`, price: t.price, icon: '🤖', desc: `${t.label} 동안 알아서 던지고 거둔다. 물가에 서 있기만 하면 됨. 잡은 뒤 1.5초 쉼. 밀려나도 버프는 유지. 켜져 있을 때 더 사면 이어진다(최대 1시간).` })),
  { id: 'bait', kind: 'fish', name: '고급 미끼', price: 10, icon: '🐛', desc: '다음 1회 던지기에 꽝과 일반은 안 물고 희귀 이상만 문다. 가지고 있으면 던질 때 자동으로 하나 쓴다 (자동 낚시 중에도).' },
  ...AUTO_TIERS.map((t): ShopItem => ({ id: `autobug${t.suffix}`, kind: 'fish', name: `자동 채집 ${t.label}`, price: t.price, icon: '🥅', desc: `${t.label} 동안 옆 칸(대각선 포함)에 벌레가 오면 알아서 잠자리채를 휘두른다. 걸어 다니기만 하면 됨. 켜져 있을 때 더 사면 이어진다(최대 1시간).` })),
];

// 밀치기 쿨타임 영구 업그레이드 (기본 10초). 2단계는 1단계가 있어야 산다
export const PUSH_GOODS: ShopItem[] = [
  { id: 'push1', kind: 'push', name: '날쌘 손', price: 300, icon: '✋', desc: '밀치기 쿨타임 10초 → 5초. 영구.' },
  { id: 'push2', kind: 'push', name: '번개 손', price: 1000, icon: '⚡', desc: '밀치기 쿨타임 5초 → 3초. 영구. 날쌘 손이 있어야 함.' },
];
export const PUSH_COOLDOWN_BY_TIER = [10000, 5000, 3000]; // 보유 단계별 쿨타임(ms)
export function pushTierOf(own?: Record<string, true> | null): number { return own?.push2 ? 2 : own?.push1 ? 1 : 0; }

// 만 코인 영구 장비. 장풍·말랑이 보따리는 가지고만 있으면 적용(범위는 game/area.ts: 앞 4칸 × 옆 4칸), 갑옷 둘은 입고 벗는다 (users/{uid}/eq 의 pa·ta, presence 에도 실림)
export const GEAR_GOODS: ShopItem[] = [
  { id: 'wave', kind: 'gear', name: '장풍', price: 10000, icon: '🌀', desc: '밀치기(0)가 장풍이 된다: 앞 4칸 × 옆 4칸 안의 모두를 두 칸 밀어낸다. 막힌 칸에서 멈춤. 영구.' },
  { id: 'tossbag', kind: 'gear', name: '말랑이 보따리', price: 10000, icon: '🎁', desc: '말랑이를 앞 4칸 × 옆 4칸 안의 모두에게 한꺼번에 던진다. 영구.' },
  { id: 'pusharmor', kind: 'gear', name: '철벽 갑옷', price: 10000, icon: '🛡', desc: '입고 있으면 밀치기가 안 먹힌다. 입고 벗을 수 있음. 영구.' },
  { id: 'tossarmor', kind: 'gear', name: '푹신 갑옷', price: 10000, icon: '🧥', desc: '입고 있으면 말랑이를 맞아도 멀쩡하다. 입고 벗을 수 있음. 영구.' },
  { id: 'hook', kind: 'gear', name: '갈고리', price: 20000, icon: '⚓', desc: '끌기(R)를 할 때 바로 앞에 아무도 없으면 앞 4칸 × 옆 4칸 안의 한 명을 무작위로 내 앞까지 끌어온다. 철벽 갑옷은 못 끈다. 영구.' },
];
export type ArmorKey = 'pa' | 'ta';
export const ARMOR_KEY: Partial<Record<string, ArmorKey>> = { pusharmor: 'pa', tossarmor: 'ta' };

// 상위 낚싯대 2단계 (2단계는 1단계가 있어야). 희귀 이상 가중치 ROD_BOOST 배, 꽝 가중치 ROD_JUNK 배. 미끼 효과와 곱해진다 (2026-11-09)
export const ROD_GOODS: ShopItem[] = [
  { id: 'rod1', kind: 'rod', name: '좋은 낚싯대', price: 5000, icon: '🎣', desc: '희귀 이상이 1.5배 잘 물고 꽝은 절반. 미끼와 겹치면 곱해진다. 영구.' },
  { id: 'rod2', kind: 'rod', name: '명품 낚싯대', price: 15000, icon: '🌟', desc: '희귀 이상이 2.5배 잘 물고 꽝은 1/4. 좋은 낚싯대가 있어야 함. 강화 주문서로 30성까지 강화할 수 있다 (실패하면 부서져 좋은 낚싯대로 돌아감).' },
  { id: 'rod3', kind: 'rod', name: '킹 낚싯대', price: 20000, icon: '👑', desc: '명품 낚싯대 30성이 있어야 만들 수 있다(금덩이 100개 + 코인). 확률은 명품 35성과 같고, 잡을 때 가끔 최대 크기를 넘는 킹 사이즈가 나온다. 강화할수록 킹 사이즈가 잘 나온다. 선물할 수 없다.' },
];
// 등급별 배수 (0 기본, 1 좋은, 2 명품, 3 킹). 킹 낚싯대는 명품과 같은 배수에 강화 성만 35성으로 고정해 쓴다 (KING_BASE_STARS)
export const ROD_BOOST = [1, 1.5, 2.5, 2.5];
export const ROD_JUNK = [1, 0.5, 0.25, 0.25];
export function rodTierOf(own?: Record<string, true> | null): number { return own?.rod3 ? 3 : own?.rod2 ? 2 : own?.rod1 ? 1 : 0; }

// ---- 낚싯대 강화 (2026-11-10) ----
// 명품 낚싯대(금색)만 강화할 수 있다. 주문서(상점 200코인, 지갑 es 에 보관) 1장으로 1성 도전. 성공하면 +1성(지갑 rs), 실패하면 명품 낚싯대가 부서져
// 좋은 낚싯대(은색)로 돌아가고 성은 0 이 된다(다시 15,000 에 사야 함). 1~10성은 100%, 11성부터 95% 에서 성마다 0.7%p 씩 내려가 30성 도전은 81.7%.
// 시뮬레이션(주문서 200 기준) 평균: 10성 2천 · 15성 1만 · 20성 2.9만 · 25성 7.6만 · 30성 21.8만 코인(파괴 11회). 성마다 희귀 이상 가중치에 (1+0.04·성)^등급 을 곱한다:
// 명품 0성 11.1코인/회 → 15성 21.7 → 30성 32.1(전설 25%). 미끼와 같이 쓰면 30성 38코인/회. 신화는 그대로 무관 (collection.pick 이 먼저 굴림).
// 성공/실패는 클라이언트가 굴린다(낚시와 같은 신뢰 수준). 규칙은 "주문서 1장이 줄어드는 쓰기에서만 성이 +1 또는 0 으로 바뀐다", "성 > 0 이면 rod2 보유" 만 본다
export const SCROLL: ShopItem = { id: 'scroll', kind: 'use', name: '강화 주문서', price: 200, icon: '📜', desc: '명품 낚싯대 강화 1회. 1~10성은 100%, 그 뒤로는 성마다 조금씩 낮아진다(30성 도전 82%). 실패하면 명품 낚싯대가 부서져 좋은 낚싯대로 돌아간다.' };
export const ROD_MAX_STARS = 30;
export const STAR_TIER_MUL = 0.04;
export function enhanceChance(stars: number): number { return stars < 10 ? 1 : Math.max(0.5, 0.95 - 0.007 * (stars - 10)); } // stars → stars+1 성공 확률
export function starFactor(stars: number): number { return 1 + STAR_TIER_MUL * stars; } // 등급 r 가중치 배수 = starFactor^r
export const fmtStars = (n: number): string => (n > 0 ? `★${n}` : '');

// ---- 킹 낚싯대 (2026-11-11) ----
// 명품 30성을 달성한 사람의 다음 목표. 금광에서 캔 금덩이(지갑 gn)와 코인으로 만든다(명품 낚싯대와 그 30성은 소모하지 않는다).
// 확률은 킹 성과 상관없이 명품 35성으로 고정이라, 만드는 순간 수입이 8~12% 오르고 그 뒤로는 늘지 않는다. 킹 성은 킹 사이즈(최대 크기 × 1.5~2.0) 확률만 올린다.
// 강화는 주문서 1장 + 금덩이 1개, 확률표와 30성 상한은 명품과 같다(enhanceChance). 실패하면 킹 낚싯대가 부서져(보관함에서 삭제, 킹 성 0) 명품 30성으로 돌아가고 다시 만들어야 한다.
// 규칙: 제작은 b='rod3' 결제 쓰기에서 명품 성이 30이고 금덩이가 정확히 KING_CRAFT_GOLD 만큼 줄 때만, 킹 성은 "주문서 1장과 금덩이 1개가 같이 주는 쓰기"에서만 +1 또는 0 (tools/gen-rules.cjs)
export const KING_ROD_ID = 'rod3';
export const KING_CRAFT_GOLD = 100;   // 제작에 드는 금덩이 (gen-rules.cjs 의 KING_CRAFT_GOLD 와 같아야 한다)
export const KING_ENHANCE_GOLD = 1;   // 강화 1회에 드는 금덩이 (주문서 1장과 함께. 규칙이 정확히 1개 주는지 본다)
export const KING_NEED_STARS = ROD_MAX_STARS; // 제작 자격: 명품 낚싯대 30성
export const KING_BASE_STARS = 35;    // 킹 낚싯대의 낚시 확률 = 명품 35성 (고정)
export const KING_MAX_STARS = 30;
// 킹 사이즈 확률: 0성 1% → 30성 5%
export function kingChance(stars: number): number { return 0.01 + (0.04 / KING_MAX_STARS) * Math.max(0, Math.min(KING_MAX_STARS, stars)); }
// 상위 잠자리채 2단계 (영구). 1단계는 실패 확률 절반, 2단계는 무조건 성공 (2026-11-09)
export const NET_GOODS: ShopItem[] = [
  { id: 'net1', kind: 'net', name: '튼튼한 잠자리채', price: 3000, icon: '🥅', desc: '채집에 실패할 확률이 절반으로. 영구.' },
  { id: 'net2', kind: 'net', name: '황금 잠자리채', price: 10000, icon: '🏆', desc: '휘두르면 무조건 잡는다. 튼튼한 잠자리채가 있어야 함. 영구.' },
];
export function netTierOf(own?: Record<string, true> | null): number { return own?.net2 ? 2 : own?.net1 ? 1 : 0; }
// 잠자리채 등급을 반영한 채집 성공 확률
export function netChance(base: number, tier: number): number { return tier >= 2 ? 1 : tier === 1 ? 1 - (1 - base) / 2 : base; }

export const ALL_ITEMS: ShopItem[] = [...HATS, ...NAME_COLORS, ...FX, ...PET_GOODS, PET_FOOD, ...FISH_GOODS, SCROLL, ...PUSH_GOODS, ...GEAR_GOODS, ...ROD_GOODS, ...NET_GOODS];
const byId = new Map(ALL_ITEMS.map((i) => [i.id, i]));
export function itemById(id: string): ShopItem | undefined { return byId.get(id); }
// 보관함(users/{uid}/own)에 들어가는 품목인가 (소모품인 자동 낚시·미끼·자동 채집·펫 먹이·강화 주문서는 지갑에만 기록된다)
export function isOwnItem(id: string): boolean { const it = byId.get(id); return !!it && it.kind !== 'fish' && it.kind !== 'use'; }
export function priceOf(item: ShopItem, prices?: Record<string, number> | null): number {
  const p = prices?.[item.id];
  return typeof p === 'number' && p >= 0 ? Math.floor(p) : item.price;
}

// wallet/{uid}: 잔액(c), 누적 획득(e), 누적 사용(sp), 미끼 개수(bait), 자동 회수 만료 시각(ar), 미끼 자동 사용(bu, 기본 true)
// ab: 자동 채집 만료 시각, rd: 마지막으로 룰렛을 돌린 날짜(dayKey), ad/an/bn: 예전 하루 한도 카운트(2026-11-05 한도 해제로 안 씀. 기존 지갑에 남은 값은 다음 자동 구매 때 지워지고, 규칙은 숫자만 허용)
// b: 마지막으로 산 품목 id (사용액이 그 품목 가격과 같아야 바뀔 수 있고, 보유 등록은 b 가 그 품목일 때만 허용). rd 는 KST 0시(ms), 예전 값은 'YYYYMMDD' 문자열
// wt/we/md: 예전 코인 획득 속도 상한(10분 창)·신화 보상 날짜. 2026-11-10 상한을 없애며 더 쓰지 않는다 (옛 지갑에 남은 값은 규칙이 숫자로만 허용)
export interface Wallet { c: number; e: number; sp?: number; bait?: number; ar?: number; bu?: boolean; rd?: number | string; ab?: number; b?: string; wt?: number; we?: number; gf?: { n: number; at: number }; gt?: string; cb?: string; ch?: number; ca?: number; cr?: string; md?: number; ad?: number; an?: number; bn?: number; px?: Record<string, number>; pp?: string; es?: number; rs?: number; gn?: number; ga?: number; ks?: number }
// gn: 가진 금덩이 (2026-11-11. 금광 채광으로 늘고 킹 낚싯대 제작·강화로 준다), ga: 마지막 채광 시각(서버 시각. 규칙이 간격을 본다), ks: 킹 낚싯대 강화 성(0~30. 주문서 1장 + 금덩이 1개가 같이 줄 때만 +1 또는 0)
// cb/ch/ca: 마지막 경마 배팅(라운드 id, 말 번호, 금액. b='race' 결제 쓰기에서만 바뀜) → casino/r/{cb}/bets/{uid} 에 그대로 적어야 배팅이 성립. cr: 배당을 받은 마지막 라운드 id (커지기만 함, 한 라운드 한 번)
// px/{펫 id}: 그 펫에게 먹인 누적 먹이 (2026-11-10. b='petfood' 결제 쓰기에서 pp 에 적은 펫만 사용액/가격 만큼 오른다), pp: 마지막으로 먹인 펫
// es: 강화 주문서 개수 (b='scroll' 결제에서만 는다), rs: 명품 낚싯대 강화 성(0~30. es 가 1 줄어드는 쓰기에서만 +1 또는 0 으로 바뀐다. 0 보다 크면 rod2 를 가지고 있어야 함)
// gf: 관리자가 마지막으로 지급(양수)·회수(음수)한 코인과 시각. 관리자만 쓸 수 있고, 받는 사람 화면은 이걸 보고 알림을 띄운다
// gt: 마지막 구매(b)가 선물이면 받는 사람 uid (2026-11-09). 이 값이 있으면 b 품목의 보유 등록은 그 사람에게만, 없으면 나에게만 할 수 있다 (한 번 결제 = 한 번 등록)
// 받는 사람의 users/{uid}/gift = { f, fn, i, m, at } 가 마지막 선물 표시(알림용), users/{uid}/gifts/{item} = true 는 선물받은 품목(의심 지표에서 뺀다)
export interface GiftMark { f: string; fn: string; i: string; m?: string; at: number }
export const GIFT_MSG_MAX = 40;
// users/{uid}/eq: 착용 중인 모자(h), 이름표 색(nc), 이동 이펙트(fx), 펫(pt), 철벽 갑옷(pa), 푹신 갑옷(ta). players/{uid} 에도 같은 키로 실린다
export interface Equip { h?: string | null; nc?: string | null; fx?: string | null; pt?: string | null; pa?: boolean | null; ta?: boolean | null }
export const EQUIP_KEY: Record<CosmeticKind, keyof Equip> = { hat: 'h', name: 'nc', fx: 'fx', pet: 'pt' };

export const fmtCoins = (n: number): string => `💰 ${Math.floor(n).toLocaleString('ko-KR')}`;
