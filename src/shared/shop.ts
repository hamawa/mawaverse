// 상점 품목과 지갑 형태. 게임·관리자 페이지가 같이 쓴다 (DOM/Firebase 의존 없음)
// 가격은 config/prices/{id} 로 관리자가 덮어쓸 수 있다 (priceOf)
import { snowActive } from './snowpenalty';

export type ItemKind = 'hat' | 'name' | 'fx' | 'title' | 'bubble' | 'pet' | 'pethat' | 'petglass' | 'fish' | 'use' | 'push' | 'gear' | 'rod' | 'net' | 'home' | 'ticket'; // use: 소모품 (펫 먹이·강화 주문서. 지갑에만 기록, 2026-11-10)
export type CosmeticKind = Exclude<ItemKind, 'fish' | 'use' | 'push' | 'gear' | 'rod' | 'net' | 'home' | 'ticket'>; // 착용하는 것들 (펫도 "착용": 한 번에 한 마리)
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
  // 비싼 꾸미기 (2026-11-18, 코인 쓸 곳): 다 갖춘 사람이 절반을 넘고 지갑 상위 25% 가 24만 코인 이상이라 넣었다. 값은 사용자가 고른 5만~100만대
  { id: 'tophat', kind: 'hat', name: '실크햇', price: 80000, icon: '🎩', desc: '붉은 띠를 두른 신사 모자.' },
  { id: 'halo', kind: 'hat', name: '천사 링', price: 150000, icon: '😇', desc: '머리 위에 떠 있는 금빛 고리.' },
  { id: 'emperor', kind: 'hat', name: '황제관', price: 300000, icon: '👑', desc: '보석이 박힌 높은 관.' },
  // 크리스마스 한정 (2026-11-21. 아래 XMAS_IDS)
  { id: 'santa', kind: 'hat', name: '산타 모자', price: 20000, icon: '🎅', desc: '하얀 방울이 달린 빨간 모자. 크리스마스 한정.' },
  { id: 'rudolph', kind: 'hat', name: '루돌프 뿔 머리띠', price: 20000, icon: '🦌', desc: '사슴 뿔이 달린 머리띠. 크리스마스 한정.' },
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
  { id: 'ncflame', kind: 'name', name: '불꽃', price: 100000, icon: '🔥', desc: '타오르듯 일렁이는 글자.' },
  { id: 'ncneon', kind: 'name', name: '네온', price: 200000, icon: '💡', desc: '형광빛이 흐르는 글자.' },
  { id: 'ncdiamond', kind: 'name', name: '다이아', price: 300000, icon: '💎', desc: '얼음빛 글자에 반짝이는 테두리.' },
  { id: 'ggname', kind: 'name', name: '순금', price: 100000, icon: '⭐', desc: '금덩이를 녹여 만든 이름표. 금덩이 1,000개가 함께 든다.' },
];

export const FX: ShopItem[] = [
  { id: 'dust', kind: 'fx', name: '먼지', price: 800, icon: '💨', desc: '걸을 때 발밑에서 먼지가 폴폴.' },
  { id: 'sparkle', kind: 'fx', name: '반짝이', price: 1000, icon: '✨', desc: '지나간 자리가 반짝반짝.' },
  { id: 'heart', kind: 'fx', name: '하트', price: 1200, icon: '💗', desc: '분홍 하트가 떠오른다.' },
  { id: 'fire', kind: 'fx', name: '불꽃', price: 1500, icon: '🔥', desc: '발에 불이 났다.' },
  { id: 'rainbowtrail', kind: 'fx', name: '무지개 꼬리', price: 2000, icon: '🌈', desc: '무지개가 꼬리처럼 따라온다.' }, // 2026-11-18: 이름표 색 '무지개'와 같은 id(rainbow)를 쓰고 있어 하나를 사면 둘 다 가진 것이 됐다. 이펙트 쪽 id 를 바꾸고, 그때까지 rainbow 를 가진 사람에게는 둘 다 줬다 (사용자 결정)
  { id: 'petal', kind: 'fx', name: '꽃잎', price: 100000, icon: '🌸', desc: '걸을 때마다 분홍 꽃잎이 흩날린다.' },
  { id: 'stardust', kind: 'fx', name: '별가루', price: 200000, icon: '🌟', desc: '금빛 별이 반짝이며 따라온다.' },
  { id: 'snowfx', kind: 'fx', name: '눈송이', price: 30000, icon: '❄', desc: '걸을 때 눈송이가 흩날린다. 크리스마스 한정.' }, // 2026-11-21 (XMAS_IDS)
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
  { id: 'pethamster', kind: 'pet', name: '햄스터', price: 5000, icon: '🐹', desc: PET_DESC }, // 2026-11-16 건의 반영
  { id: 'petparrot', kind: 'pet', name: '앵무새', price: 5000, icon: '🦜', desc: PET_DESC + ' 주인이 한 말을 따라 해요.' }, // 2026-11-19 사용자 요청
];
// 펫 꾸미기 (2026-11-20 건의): 펫 모자(착용 칸 ph)·펫 안경(pg). 데리고 다니는 펫이 쓴다 (탈 때는 안 보인다). 그림은 cosmetics.ts drawPetHat·drawPet
export const PET_HATS: ShopItem[] = [
  { id: 'ph_ribbon', kind: 'pethat', name: '펫 리본', price: 1000, icon: '🎀', desc: '펫 머리에 분홍 리본.' },
  { id: 'ph_straw', kind: 'pethat', name: '펫 밀짚모자', price: 1000, icon: '👒', desc: '펫에게 밀짚모자.' },
  { id: 'ph_party', kind: 'pethat', name: '펫 고깔모자', price: 1500, icon: '🎉', desc: '펫에게 알록달록 고깔.' },
  { id: 'ph_crown', kind: 'pethat', name: '펫 왕관', price: 5000, icon: '👑', desc: '펫에게 작은 왕관.' },
  { id: 'ph_santa', kind: 'pethat', name: '펫 산타 모자', price: 10000, icon: '🎅', desc: '펫에게 작은 산타 모자. 크리스마스 한정.' }, // 2026-11-21 (XMAS_IDS)
];
export const PET_GLASSES: ShopItem[] = [
  { id: 'pg_round', kind: 'petglass', name: '펫 동그란 안경', price: 1000, icon: '👓', desc: '똑똑해 보이는 안경.' },
  { id: 'pg_sun', kind: 'petglass', name: '펫 선글라스', price: 2000, icon: '🕶', desc: '클럽 밖에서도 선글라스.' },
];
// 펫 이름 (2026-11-20 건의): 펫마다 하나 (users/{uid}/eq/pns/{펫 id}). 지을 때마다 요금을 낸다 (외모·닉네임 변경과 같은 소모품 결제. 이름을 없애는 것은 무료)
export const PET_NAME_FEE: ShopItem = { id: 'petnamefee', kind: 'use', name: '펫 이름 짓기', price: 2000, icon: '✏', desc: '펫 이름을 지을 때마다 낸다.' };
export const PET_NAME_MAX = 8;
export function cleanPetName(v: unknown): string { return typeof v === 'string' ? [...v.replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').replace(/\s+/g, ' ').trim()].slice(0, PET_NAME_MAX).join('') : ''; }
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
// 앵무새 (2026-11-19): 주인이 말하면 조금 뒤에 마지막 낱말을 두 번 따라 한다 (길면 끝 여섯 글자). 화면에만 그리는 장난이라 서버로 가는 것은 없다 (render.ts)
export const PARROT_ID = 'petparrot';
export function parrotEcho(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const w = [...(words[words.length - 1] || '').replace(/[.!?~,…ㅋㅎㅠㅜ]+$/u, '')].slice(-6).join('');
  return w ? `${w}! ${w}!` : '';
}
export function petLevel(xp: number): number { let lv = 1; for (let i = 1; i < PET_LEVEL_XP.length; i++) if (xp >= PET_LEVEL_XP[i]) lv = i + 1; return lv; }
export function petNextXp(xp: number): number | null { const lv = petLevel(xp); return lv >= PET_MAX_LEVEL ? null : PET_LEVEL_XP[lv]; }
export function petScale(xp: number): number { return 1 + 0.08 * (petLevel(xp) - 1); } // 따라다닐 때 크기 (Lv10 1.72배). 탑승 모습은 cosmetics MOUNT_ART 가 따로
export function petCanRide(xp: number): boolean { return xp >= PET_RIDE_XP; }
// 실제로 타고 있나: 탈 수 있는 레벨이고, 내려서 데리고 다니기(nr)를 고르지 않았을 때
export function petRiding(xp: number, noRide?: boolean | null): boolean { return petCanRide(xp) && !noRide; }
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
  { id: 'campfire', kind: 'gear', name: '모닥불 키트', price: 3000, icon: '🔥', desc: '바깥에서 내 앞 칸에 모닥불을 피운다 (내 메뉴 → 모닥불 피우기). 피울 때마다 나무 30개, 10분 동안 탄다. 모두에게 보이고 밤에는 둘레가 밝아진다. 영구.' }, // 2026-11-20 (shared/campfire.ts)
  { id: 'wave', kind: 'gear', name: '장풍', price: 10000, icon: '🌀', desc: '밀치기(0)가 장풍이 된다: 앞 4칸 × 옆 4칸 안의 모두를 두 칸 밀어낸다. 막힌 칸에서 멈춤. 영구.' },
  { id: 'tossbag', kind: 'gear', name: '말랑이 보따리', price: 10000, icon: '🎁', desc: '말랑이를 앞 4칸 × 옆 4칸 안의 모두에게 한꺼번에 던진다. 영구.' },
  { id: 'pusharmor', kind: 'gear', name: '철벽 갑옷', price: 10000, icon: '🛡', desc: '입고 있으면 밀치기가 안 먹힌다. 입고 벗을 수 있음. 영구.' },
  { id: 'tossarmor', kind: 'gear', name: '푹신 갑옷', price: 10000, icon: '🧥', desc: '입고 있으면 말랑이를 맞아도 멀쩡하다. 입고 벗을 수 있음. 영구.' },
  { id: 'hook', kind: 'gear', name: '갈고리', price: 20000, icon: '⚓', desc: '끌기(R)를 할 때 바로 앞에 아무도 없으면 앞 4칸 × 옆 4칸 안의 한 명을 무작위로 내 앞까지 끌어온다. 철벽 갑옷은 못 끈다. 영구.' },
];
export type ArmorKey = 'pa' | 'ta';
export const ARMOR_KEY: Partial<Record<string, ArmorKey>> = { pusharmor: 'pa', tossarmor: 'ta' };

// ---- 스키 장갑 (겨울 눈싸움) ----
// 단일 영구 품목(기본 2,000 코인, 일반 구매 분기로 사고 가격은 config/prices). 보유만으로는 안 되고 users/{uid}/eq/sg 를 켜야 쓴다(입고 벗기, 규칙: 보유 필요).
// 켠 채 겨울 맵 눈 위에서 F 로 눈을 뭉치고(보관 상태는 이 브라우저에만), 다음 F 로 던진다. 던진 눈덩이는 말랑이 경로(TossMsg)에 s=1 로 실려 가고, 맞으면 말랑이와 같은 스턴이지만
// 갑옷·펫 방어·되받아치기를 모두 무시한다(방어 깨짐 gb·갑옷 해제도 없다). 규칙: s=1 은 장갑을 보유·착용한 겨울 맵의 보낸 사람이 같은 겨울 맵 대상에게 범위 안으로 쓸 때만 (tools/gen-rules.cjs·database.rules.json).
// presence 에는 싣지 않는다(켜고 끄는 것만 프로필에 쓰고, 눈 뭉치기·던지기는 DB 에 쓰지 않는다)
export const SKI_GLOVES_ID = 'skigloves';
export const SKI_GLOVES_EQ = 'sg' as const;
export const SKI_GLOVES: ShopItem = { id: SKI_GLOVES_ID, kind: 'gear', name: '스키 장갑', price: 2000, icon: '🧤', desc: '겨울 맵 전용 눈싸움. 끼고 눈 위에서 F 로 눈을 뭉친 뒤 다시 F 로 던진다. 맞으면 말랑이처럼 1초 스턴이고 갑옷·펫 방어도 뚫는다(방어가 깨지지는 않는다). 끼고 빼는 것은 직접. 영구.' };
// 입고 벗는(켜고 끄는) 장비의 프로필 칸: 갑옷 둘 + 스키 장갑. 갑옷만 presence 에도 실린다
export type ToggleKey = ArmorKey | typeof SKI_GLOVES_EQ;
export const TOGGLE_KEY: Partial<Record<string, ToggleKey>> = { ...ARMOR_KEY, [SKI_GLOVES_ID]: SKI_GLOVES_EQ };

// ---- 빠따 (2026-11-11 밸런스 패치) ----
// 갑옷(만 코인)과 펫 Lv8 방어를 거의 모두가 갖추면서 밀치기·말랑이가 안 통하게 됐다(12명 중 8명). 방어 확률은 그대로 두고, 깨는 수단을 소모품으로 판다.
// 밀치기·말랑이·끌기를 쓸 때 상대가 방어 중이면 빠따 하나를 써서(지갑 bt −1) 방어를 깨고 그대로 맞힌다(메시지에 b=1). 맞은 사람은 GUARD_BREAK_MS 동안
// 방어가 깨진 상태(presence gb = 풀리는 서버 시각)라 누구에게나 밀리고 맞는다. 갑옷·펫을 잃지는 않고 시간이 지나면 저절로 돌아온다.
// 규칙: b=1 이 붙은 메시지는 보낸 사람의 지갑 bt 가 같은 쓰기에서 줄어들 때만 받는다. 깨진 상태를 지키는 것은 받는 쪽 클라이언트다 (밀치기와 같은 신뢰 수준)
export const BAT: ShopItem = { id: 'bat', kind: 'use', name: '빠따', price: 1000, icon: '🏏', desc: '밀치기·말랑이·끌기가 상대의 갑옷이나 펫 방어에 막힐 때 하나를 써서 방어를 깨고 그대로 맞힌다. 맞은 사람은 60초 동안 방어가 깨져 누구에게나 밀린다(갑옷이 없어지지는 않는다).' };
export const GUARD_BREAK_MS = 60000;
// 어둠의 빠따 (2026-11-17, 사용자 제안): 효과는 빠따와 같지만 맞은 사람의 알림·기록에 누가 쳤는지 남지 않는다 ("누군가"). 메시지에 b=2, 지갑 bd −1.
// 가지고 있으면 보통 빠따보다 먼저 쓴다 (상점에서 끌 수 있다: 이 브라우저에만 적는다). 화면을 보고 있던 사람에게는 미는 동작이 그대로 보인다: 숨기는 것은 글자뿐이다.
// 누가 누구에게 썼는지는 관리자만 보는 채팅 로그(logs/chat, c='d')에 남는다 (같은 쓰기에 실어 보낸다. 규칙이 강제하지는 않는다)
export const DARK_BAT: ShopItem = { id: 'darkbat', kind: 'use', name: '어둠의 빠따', price: 3000, icon: '🌑', desc: '빠따와 같지만 맞은 사람에게 누가 쳤는지 알려지지 않는다("누군가"로만 남는다). 가지고 있으면 보통 빠따보다 먼저 쓴다.' };
export type BatKind = 0 | 1 | 2; // 0 안 씀 · 1 빠따 · 2 어둠의 빠따 (메시지의 b 값)
// 빠따를 쓴 뒤 이만큼 기다렸다가 상대의 접속 표시(방어 깨짐 gb · 든든함 sd)를 보고 결과를 알린다 (world.batReport. 2026-11-20)
export const BAT_CHECK_MS = 1500;
// 빠따 결과 한 줄. n: 쓴 빠따 수, broke: 방어가 깨진 사람, shielded: 든든함으로 버틴 사람 (나머지는 통하지 않음), left: 남은 개수, failed: 쓰기가 받아들여지지 않았다(소모 없음)
export function batResultText(r: { dark?: boolean; failed?: boolean; n: number; broke?: number; shielded?: number; left: number }): string {
  const icon = r.dark ? '🌑' : '🏏', name = r.dark ? '어둠의 빠따' : '빠따';
  if (r.failed) return `${icon} ${name}가 나가지 않았다. (소모되지 않았어요. 잠시 뒤 다시 해 보세요)`;
  const broke = r.broke || 0, shielded = r.shielded || 0, none = Math.max(0, r.n - broke - shielded), left = `(남은 ${name} ${r.left}개)`;
  if (r.n === 1) {
    if (broke) return `${icon} ${name}로 방어를 깼다!${r.dark ? ' 누가 쳤는지는 남지 않는다.' : ''} ${left}`;
    if (shielded) return `${icon} ${name}를 썼지만 상대의 🐟 든든함에 막혔다! 든든함이 하나 줄었다. ${left}`;
    return `${icon} ${name}를 썼지만 통하지 않았다. 상대가 그새 움직였거나, 자리를 비워 화면이 멈춘 사람일 수 있어요. ${left}`;
  }
  const parts = [broke ? `${broke}명은 방어가 깨짐` : '', shielded ? `${shielded}명은 🐟 든든함으로 버팀` : '', none ? `${none}명은 통하지 않음` : ''].filter(Boolean).join(', ');
  return `${icon} ${name} ${r.n}개 사용: ${parts}. ${left}`;
}
export const ANON = '누군가';
type GuardState = { pa?: boolean | null; ta?: boolean | null; pt?: string | null; pl?: number | null; gb?: number | null; sn?: number | null } | undefined;
// 방어가 깨져 있나: gb(풀리는 시각)가 지금(서버 시각)보다 뒤
export function guardBrokenOf(st: GuardState, now: number): boolean { return typeof st?.gb === 'number' && st.gb > now; }
// presence 에 싣는 빠따 방어 깨짐(gb): 풀리는 시각이 아직 남았을 때만. 눈사람 벌칙(sn)은 guardBroken() 이 켜져도 gb 를 싣지 않는다 (둘은 별개 상태)
export function batGuardField(guardUntil: number, now: number): { gb?: number } { return guardBrokenOf({ gb: guardUntil }, now) ? { gb: guardUntil } : {}; }
// 남의 presence 로 보는 방어. kind: 'push' 밀치기·끌기(철벽 갑옷 pa) | 'toss' 말랑이(푹신 갑옷 ta). 펫 Lv8 은 둘 다 막는다. 깨져 있으면 방어가 없는 것으로 본다
export function guardedOf(st: GuardState, kind: 'push' | 'toss', now: number): boolean {
  if (!st || guardBrokenOf(st, now) || snowActive(st.sn, now)) return false; // 눈사람 부순 벌칙(sn)은 갑옷·펫 방어를 SNOW_PENALTY_MS 동안 끈다
  return !!(kind === 'push' ? st.pa : st.ta) || petGuardOf(st);
}
// 겨냥한 사람들 가운데 누구에게 빠따를 쓸지: 방어 중인 사람에게 앞에서부터 한 개씩, 빠따가 모자라면 나머지는 막힌다
// dark: 쓸 수 있는 어둠의 빠따 수. 있으면 그것부터 쓴다. kind 가 메시지에 실을 b 값
export function assignBats(guarded: boolean[], bats: number, dark = 0): { bat: boolean; blocked: boolean; kind: BatKind }[] {
  let left = Math.max(0, Math.floor(bats)), dleft = Math.max(0, Math.floor(dark));
  return guarded.map((g) => {
    if (!g) return { bat: false, blocked: false, kind: 0 };
    if (dleft > 0) { dleft--; return { bat: true, blocked: false, kind: 2 }; }
    if (left > 0) { left--; return { bat: true, blocked: false, kind: 1 }; }
    return { bat: false, blocked: true, kind: 0 };
  });
}

// 상위 낚싯대 2단계 (2단계는 1단계가 있어야). 희귀 이상 가중치 ROD_BOOST 배, 꽝 가중치 ROD_JUNK 배. 미끼 효과와 곱해진다 (2026-11-09)
export const ROD_GOODS: ShopItem[] = [
  { id: 'rod1', kind: 'rod', name: '좋은 낚싯대', price: 5000, icon: '🎣', desc: '희귀 이상이 1.5배 잘 물고 꽝은 절반. 미끼와 겹치면 곱해진다. 영구.' },
  { id: 'rod2', kind: 'rod', name: '명품 낚싯대', price: 15000, icon: '🌟', desc: '희귀 이상이 2.5배 잘 물고 꽝은 1/4. 좋은 낚싯대가 있어야 함. 강화 주문서로 30성까지 강화할 수 있다 (실패하면 부서져 좋은 낚싯대로 돌아감).' },
  { id: 'rod3', kind: 'rod', name: '킹 낚싯대', price: 20000, icon: '👑', desc: '명품 낚싯대 30성이 있어야 만들 수 있다(금덩이 100개 + 코인). 확률은 명품 35성과 같고, 잡을 때 가끔 최대 크기를 넘는 킹 사이즈가 나온다. 강화할수록 킹 사이즈가 잘 나온다. 선물할 수 없다.' },
];
// 등급별 배수 (0 기본, 1 좋은, 2 명품, 3 킹). 킹 낚싯대는 명품과 같은 배수에 강화 성만 35성으로 고정해 쓴다 (KING_BASE_STARS)
export const ROD_BOOST = [1, 1.5, 2.5, 2.5];
export const ROD_JUNK = [1, 0.5, 0.25, 0.25];
// 얼음 낚싯대 (겨울 맵 전용): 단일 영구 품목 하나. 선행 조건 없이 가격표대로 산다(기본 1,000 코인). 성능은 명품 낚싯대 20성으로 고정(등급 2 배수 + 20성 효과)이고,
// 강화·킹 낚싯대·킹 사이즈·지갑 성 칸이 없다. 미끼는 일반 낚싯대와 같이 쓴다. 일반 낚싯대의 보유·강화와 서로 영향이 없다
export type RodFamily = 'normal' | 'ice';
export const ICE_ROD_ID = 'iceRod';
export const ICE_ROD_TIER = 2;     // ROD_BOOST·ROD_JUNK 에서 명품(2)과 같은 배수
export const ICE_ROD_STARS = 20;   // 낚시 확률에 쓰는 고정 성 (starFactor)
export const ICE_ROD: ShopItem = { id: ICE_ROD_ID, kind: 'rod', name: '얼음 낚싯대', price: 1000, icon: '🧊', desc: '겨울 맵 낚시 전용. 명품 낚싯대 20성급 성능(희귀 이상 2.5배·꽝 1/4)으로 고정이라 강화할 수 없고 킹 사이즈도 없다. 영구.' };
export function rodTierOf(own?: Record<string, true> | null, family: RodFamily = 'normal'): number {
  if (family === 'ice') return own?.[ICE_ROD_ID] ? ICE_ROD_TIER : 0;
  return own?.rod3 ? 3 : own?.rod2 ? 2 : own?.rod1 ? 1 : 0;
}

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

// 내 집 (2026-11-17, shared/home.ts): 통나무집·벽돌집을 짓는 코인 값과 창고 칸. 상점에는 안 나오고 집 창(homeui.ts)에서 산다.
// 보관함 품목이라 기존 구매 규칙(가격표의 값을 내면 own 등록)을 그대로 쓰고, homes 규칙이 "그 품목을 가졌는가"를 본다. 선물은 안 된다 (화면에 없다)
// 칭호 (2026-11-18): 닉네임 바로 위에 뜨는 한 줄. 코인으로 사서 하나를 단다 (착용 칸 tt). 자랑용이라 효과는 없다
export const TITLES: ShopItem[] = [
  { id: 'tt-angler', kind: 'title', name: '낚시 중독', price: 50000, icon: '🎣', desc: '물가를 떠나지 않는 사람.' },
  { id: 'tt-bug', kind: 'title', name: '곤충 박사', price: 50000, icon: '🐞', desc: '풀밭의 모든 것을 아는 사람.' },
  { id: 'tt-miner', kind: 'title', name: '황금 손', price: 80000, icon: '⛏', desc: '곡괭이를 놓지 않는 사람.' },
  { id: 'tt-rich', kind: 'title', name: '마을 부자', price: 150000, icon: '💰', desc: '지갑이 두둑한 사람.' },
  { id: 'tt-boss', kind: 'title', name: '카지노 큰손', price: 300000, icon: '🎰', desc: '판이 클수록 웃는 사람.' },
  { id: 'tt-mayor', kind: 'title', name: '명예 이장', price: 500000, icon: '🏅', desc: '마을이 인정한 사람.' },
  { id: 'tt-legend', kind: 'title', name: '살아있는 전설', price: 1000000, icon: '👑', desc: '더 설명이 필요 없는 사람.' },
  { id: 'tt-xmas', kind: 'title', name: '메리 크리스마스', price: 30000, icon: '🎄', desc: '빨간 바탕에 초록 테두리. 크리스마스 한정.' }, // 2026-11-21 (XMAS_IDS. 빛깔은 cosmetics.ts titleStyle 이 따로 정한다)
];
// 말풍선 꾸미기 (2026-11-20, 사용자 요청): 내 일반 채팅 말풍선의 모양·빛깔을 바꾼다 (착용 칸 bb. 그리기는 game/bubbles.ts). 글꼴은 바꾸지 않는다 (2026-11-21 건의 반영). 귓속말 말풍선은 그대로다. 자랑용이라 효과는 없다.
// 값은 사용자 결정으로 높게 잡았다 (의견을 들어 보고 바꾸기로). 그때 라이브: 지갑 중앙 2만·상위 25% 10만, 1만짜리 샤샤샥을 21명 중 7명이 샀고 5만 이상 꾸미기는 산 사람이 사실상 없었다
export const BUBBLES: ShopItem[] = [
  { id: 'bb-ink', kind: 'bubble', name: '먹물', price: 10000, icon: '🖤', desc: '검은 바탕에 흰 글씨.' },
  { id: 'bb-candy', kind: 'bubble', name: '솜사탕', price: 10000, icon: '🍭', desc: '분홍 말풍선에 작은 하트.' },
  { id: 'bb-cloud', kind: 'bubble', name: '구름', price: 15000, icon: '☁', desc: '몽글몽글한 구름 말풍선.' },
  { id: 'bb-retro', kind: 'bubble', name: '레트로', price: 15000, icon: '🕹', desc: '옛 게임 대화창 모양.' },
  { id: 'bb-gold', kind: 'bubble', name: '금테', price: 20000, icon: '🏅', desc: '검은 바탕에 금 테두리, 금빛 글씨.' },
  { id: 'bb-ice', kind: 'bubble', name: '얼음', price: 20000, icon: '❄', desc: '반짝이는 얼음 말풍선.' },
  { id: 'bb-rainbow', kind: 'bubble', name: '무지개', price: 30000, icon: '🌈', desc: '테두리에 무지개가 천천히 흐른다.' },
  { id: 'bb-neon', kind: 'bubble', name: '네온', price: 40000, icon: '💡', desc: '빛나는 테두리와 글씨. 빛깔이 천천히 바뀐다.' },
  { id: 'bb-flame', kind: 'bubble', name: '불꽃', price: 50000, icon: '🔥', desc: '말풍선 위로 불길이 일렁인다.' },
  { id: 'bb-xmas', kind: 'bubble', name: '크리스마스', price: 20000, icon: '🎄', desc: '빨강·초록 줄무늬 테두리. 크리스마스 한정.' }, // 2026-11-21 (XMAS_IDS)
];
// 금덩이로 만드는 것 (2026-11-18, 금광 살리기: 킹 낚싯대를 만든 뒤에는 금덩이 쓸 곳이 없어 채광이 하루 2,400번에서 200번 아래로 줄었다). id 는 gg 로 시작한다: 지갑 규칙이 그 접두사로 가른다.
// 코인 값(가격표)과 함께 금덩이가 정확히 이만큼 줄어야 한다 (gen-rules.cjs 의 GOLD_GOODS 와 같아야 한다). 선물할 수 없다
export const GOLD_COST: Readonly<Record<string, number>> = { gg40: 200, gg41: 500, ggname: 1000 };
export const isGoldItem = (id: string): boolean => id in GOLD_COST;
export const HOME_GOODS: ShopItem[] = [
  { id: 'house2', kind: 'home', name: '통나무집 짓는 값', price: 10000, icon: '🌲', desc: '통나무집으로 올릴 때 나무 300개와 함께 낸다.' },
  { id: 'house3', kind: 'home', name: '벽돌집 짓는 값', price: 50000, icon: '🧱', desc: '벽돌집으로 올릴 때 나무 1,000개와 함께 낸다.' },
  ...[1, 2, 3, 4, 5, 6].map((n): ShopItem => ({ id: `hslot${n}`, kind: 'home', name: `창고 ${4 + n}번째 칸`, price: 5000 * n, icon: '📦', desc: '창고 한 칸(물고기 100마리)을 늘린다.' })),
  // 코인으로 사는 고급 가구 (2026-11-18): id 는 fn{오브젝트 번호}. 사면 집에 몇 개든 놓을 수 있다 (shared/home.ts FURNITURE 의 item)
  { id: 'fn39', kind: 'home', name: '텔레비전', price: 60000, icon: '📺', desc: '집에 놓는 가구.' },
  { id: 'fn36', kind: 'home', name: '벽난로', price: 80000, icon: '🔥', desc: '집에 놓는 가구.' },
  { id: 'fn37', kind: 'home', name: '어항', price: 120000, icon: '🐠', desc: '집에 놓는 가구.' },
  { id: 'fn38', kind: 'home', name: '피아노', price: 200000, icon: '🎹', desc: '집에 놓는 가구.' },
  { id: 'fn54', kind: 'home', name: '꼬마 트리', price: 30000, icon: '🎄', desc: '집에 놓는 가구. 전구가 깜빡인다. 크리스마스 한정.' }, // 2026-11-21 (XMAS_IDS)
  // 금덩이 가구: 코인 값과 함께 금덩이가 든다 (GOLD_COST)
  { id: 'gg40', kind: 'home', name: '황금 화분', price: 10000, icon: '🏺', desc: '집에 놓는 가구. 금덩이 200개가 함께 든다.' },
  { id: 'gg41', kind: 'home', name: '황금 동상', price: 30000, icon: '🗿', desc: '집에 놓는 가구. 금덩이 500개가 함께 든다.' },
  // 사진 액자 (2026-11-20): 사면 집 벽의 어느 자리에든 그 액자로 사진을 걸 수 있다 (homes 의 ph)
  { id: 'frame1', kind: 'home', name: '나무 액자', price: 3000, icon: '🖼', desc: '집 벽에 사진을 거는 나무 액자.' },
  { id: 'frame2', kind: 'home', name: '금테 액자', price: 30000, icon: '🖼', desc: '집 벽에 사진을 거는 금테 액자.' },
  // 벽지: 사면 집 벽을 그 빛깔로 바꿀 수 있다 (homes 의 wl)
  { id: 'wall1', kind: 'home', name: '분홍 벽지', price: 30000, icon: '🌸', desc: '집 벽을 분홍빛으로.' },
  { id: 'wall2', kind: 'home', name: '민트 벽지', price: 30000, icon: '🍃', desc: '집 벽을 민트빛으로.' },
  { id: 'wall3', kind: 'home', name: '밤하늘 벽지', price: 50000, icon: '🌙', desc: '집 벽을 짙은 남빛으로.' },
];
// 변경 요금 (2026-11-17, 사용자 요청): 외모·닉네임을 바꿀 때 낸다. 소모품이라 지갑에만 기록된다. 요금은 화면이 받는다: 규칙이 변경과 결제를 묶어 보지는 않는다
export const AVATAR_FEE: ShopItem = { id: 'avatarfee', kind: 'use', name: '외모 변경 요금', price: 1000, icon: '🎨', desc: '외모를 바꿀 때마다 낸다.' };
export const NICK_FEE: ShopItem = { id: 'nickfee', kind: 'use', name: '닉네임 변경 요금', price: 5000, icon: '✏', desc: '닉네임을 바꿀 때마다 낸다.' };
// 교환권 (2026-11-17, 건의 반영): 남에게 선물하는 외모·닉네임 변경권. 보관함 품목이라 기존 선물 규칙을 그대로 쓴다 (값을 낸 사람이 받는 사람의 보관함에 등록).
// 받은 사람은 변경할 때 요금 대신 교환권을 쓰고, 쓴 뒤에 보관함에서 지운다. 종류마다 한 장만 가질 수 있다 (이미 가진 사람에게는 선물이 안 된다). 값은 변경 요금과 같다
export const AVATAR_TICKET: ShopItem = { id: 'avatarticket', kind: 'ticket', name: '외모 교환권', price: 1000, icon: '🎟', desc: '받은 사람이 외모를 한 번 무료로 바꿀 수 있다. 선물 전용.' };
export const NICK_TICKET: ShopItem = { id: 'nickticket', kind: 'ticket', name: '닉네임 교환권', price: 5000, icon: '🎟', desc: '받은 사람이 닉네임을 한 번 무료로 바꿀 수 있다. 선물 전용.' };
// 크리스마스 한정 (2026-11-21, 건의 반영): 12월 1일~25일에만 상점·집 창에 나온다 (shared/season.ts xmasSeason). 산 것은 계속 가지고 언제든 착용한다.
// 기간은 화면이 지킨다: 규칙은 날짜를 보지 않는다 (가격표에 값이 있으면 언제든 사진다. 코인이 걸린 문제가 아니라 그대로 뒀다).
// 값은 건의대로 "적당히 비싸게": 그때 라이브 지갑 중앙 4.9만, 하루 만에 1만~4만짜리 말풍선을 21명 중 5명이 샀다. 품목을 더하면 여기와 라이브 config/prices/{id}
export const XMAS_IDS: ReadonlySet<string> = new Set(['santa', 'rudolph', 'ph_santa', 'snowfx', 'bb-xmas', 'tt-xmas', 'fn54']);
export const isXmasItem = (id: string): boolean => XMAS_IDS.has(id);
// 지금 내놓는 품목인가 (xmas: 크리스마스 철인가). 철이 아니어도 이미 가진 사람에게는 보여야 착용·해제를 할 수 있다: 그건 부르는 쪽이 본다
export const onSale = (id: string, xmas: boolean): boolean => xmas || !XMAS_IDS.has(id);
export const ALL_ITEMS: ShopItem[] = [...HATS, ...NAME_COLORS, ...FX, ...TITLES, ...BUBBLES, ...PET_GOODS, ...PET_HATS, ...PET_GLASSES, PET_NAME_FEE, PET_FOOD, ...FISH_GOODS, SCROLL, BAT, ...PUSH_GOODS, ...GEAR_GOODS, ...ROD_GOODS, ICE_ROD, SKI_GLOVES, ...NET_GOODS, ...HOME_GOODS, AVATAR_FEE, NICK_FEE, DARK_BAT, AVATAR_TICKET, NICK_TICKET];
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
export interface Wallet { c: number; e: number; sp?: number; bait?: number; ar?: number; bu?: boolean; rd?: number | string; ab?: number; b?: string; wt?: number; we?: number; gf?: { n: number; at: number }; gt?: string; cb?: string; ch?: number; ca?: number; cr?: string; md?: number; ad?: number; an?: number; bn?: number; px?: Record<string, number>; pp?: string; es?: number; rs?: number; gn?: number; ga?: number; ks?: number; pi?: number; bt?: number; bd?: number; bo?: boolean; ik?: 's' | 'o'; ib?: number; ip?: number; it?: number; ic?: number; dl?: string; dc?: string; pk?: string; ps?: 'a' | 'b'; pc?: string }
// pk/ps/pc: 인디언 포커(2026-11-12, shared/poker.ts). pk = 내가 들어간 마지막 판 id, ps = 그 판의 내 자리 (b='poker' 결제에서만 바뀜), pc = 마지막으로 정산한 판 id. pk != pc 이면 아직 정산 안 한 판
// dl/dc: 1:1 내기(2026-11-12, shared/duel.ts). dl = 내가 판돈을 낸 마지막 내기 id (b='duel' 결제에서만 바뀜), dc = 마지막으로 정산(승리·환불)한 내기 id
// ik/ib/ip/it/ic: 슬롯 방의 즉석 게임(슬롯·홀짝. 2026-11-12, shared/slots.ts). 베팅하면 ik(게임)·ib(건 돈)·ip(홀짝에서 고른 쪽)·it(서버 시각)가 적히고, 정산하면 ic 가 그 it 가 된다. it != ic 이면 아직 정산 안 한 판
// bd: 어둠의 빠따 개수 (2026-11-17. b='darkbat' 결제에서만 늘고, b=2 가 붙은 밀치기·말랑이·끌기 쓰기에서 준다)
// bt: 빠따 개수 (2026-11-11. b='bat' 결제에서만 늘고, 방어를 깨는 밀치기·말랑이·끌기 쓰기에서 준다), bo: 빠따 자동 사용 (기본 true)
// gn: 가진 금덩이 (2026-11-11. 금광 채광으로 늘고 킹 낚싯대 제작·강화로 준다), ga: 마지막 채광 시각(서버 시각. 규칙이 간격을 본다), ks: 킹 낚싯대 강화 성(0~30. 주문서 1장 + 금덩이 1개가 같이 줄 때만 +1 또는 0)
// pi: 곡괭이 단계 (0~10, 없으면 0. b='pick' 결제에서만 +1, 값은 정확히 1000·단계² 코인. shared/mine.ts. 포커의 pk 와 이름이 겹쳐 pi).
// cb/ch/ca: 마지막 경마 배팅(라운드 id, 말 번호, 금액. b='race' 결제 쓰기에서만 바뀜) → casino/r/{cb}/bets/{uid} 에 그대로 적어야 배팅이 성립. cr: 배당을 받은 마지막 라운드 id (커지기만 함, 한 라운드 한 번)
// px/{펫 id}: 그 펫에게 먹인 누적 먹이 (2026-11-10. b='petfood' 결제 쓰기에서 pp 에 적은 펫만 사용액/가격 만큼 오른다), pp: 마지막으로 먹인 펫
// es: 강화 주문서 개수 (b='scroll' 결제에서만 는다), rs: 명품 낚싯대 강화 성(0~30. es 가 1 줄어드는 쓰기에서만 +1 또는 0 으로 바뀐다. 0 보다 크면 rod2 를 가지고 있어야 함)
// gf: 관리자가 마지막으로 지급(양수)·회수(음수)한 코인과 시각. 관리자만 쓸 수 있고, 받는 사람 화면은 이걸 보고 알림을 띄운다
// gt: 마지막 구매(b)가 선물이면 받는 사람 uid (2026-11-09). 이 값이 있으면 b 품목의 보유 등록은 그 사람에게만, 없으면 나에게만 할 수 있다 (한 번 결제 = 한 번 등록)
// 받는 사람의 users/{uid}/gift = { f, fn, i, m, at } 가 마지막 선물 표시(알림용), users/{uid}/gifts/{item} = true 는 선물받은 품목(의심 지표에서 뺀다)
export interface GiftMark { f: string; fn: string; i: string; m?: string; at: number }
export const GIFT_MSG_MAX = 40;
// users/{uid}/eq: 착용 중인 모자(h), 이름표 색(nc), 이동 이펙트(fx), 펫(pt), 철벽 갑옷(pa), 푹신 갑옷(ta). players/{uid} 에도 같은 키로 실린다
export interface Equip { h?: string | null; nc?: string | null; fx?: string | null; tt?: string | null; bb?: string | null; pt?: string | null; pa?: boolean | null; ta?: boolean | null; nr?: boolean | null; sg?: boolean | null; ph?: string | null; pg?: string | null; pns?: Record<string, string> | null }
// ph·pg: 펫 모자·안경 (2026-11-20). pns: 펫 이름 (펫 id → 이름. presence 에는 데리고 있는 펫의 이름만 pn 으로 싣는다)
// sg: 스키 장갑을 낀 상태 (프로필에만. presence 에는 안 싣는다. 규칙: 보유해야 켤 수 있다)
// nr: 만렙(Lv10) 펫을 타지 않고 데리고 다닌다 (2026-11-12 건의 반영. 없으면 지금까지처럼 탄다). 걷기 속도 등 펫 효과는 타든 안 타든 같다: 모습만 바뀐다
export const EQUIP_KEY: Record<CosmeticKind, 'h' | 'nc' | 'fx' | 'tt' | 'bb' | 'pt' | 'ph' | 'pg'> = { hat: 'h', name: 'nc', fx: 'fx', title: 'tt', bubble: 'bb', pet: 'pt', pethat: 'ph', petglass: 'pg' }; // tt: 칭호 (2026-11-18)

export const fmtCoins = (n: number): string => `💰 ${Math.floor(n).toLocaleString('ko-KR')}`;
