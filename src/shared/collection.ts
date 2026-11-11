// 수집 도감 공용 (물고기·곤충). 종류 목록은 DB(`{base}/defs`)가 우선이고 비어 있으면 코드 기본값. DOM/Firebase 의존 없음
export type Rarity = 0 | 1 | 2 | 3 | 4; // 일반, 희귀, 영웅, 전설, 신화
export const RARITY_NAME = ['일반', '희귀', '영웅', '전설', '신화'] as const;
export const RARITY_POINTS = [1, 5, 20, 100, 1000] as const;
export const RARITY_COLOR = ['#cfd8d2', '#6fb6ff', '#c58bff', '#ffd84d', '#ff6b9d'] as const;
export const MYTHIC: Rarity = 4;
// 신화(2026-11-09): 극악 확률. 낚싯대·잠자리채·미끼 같은 장비 배수와 무관하게 "w ÷ 그 시각 풀의 w 합계" 확률로만 뽑힌다 (관리자 화면의 확률 표시와 같다).
// 코인 보상 1000(대회 2000)은 지갑 규칙의 md 분기(하루 한 번, 10분 창 상한 제외)로 지급된다 (tools/gen-rules.cjs)

export type DefTime = 'lunch' | 'night' | 'contest';
export const TIME_LABEL: Record<DefTime, string> = { lunch: '점심시간(12~13시)에만', night: '퇴근 후(18시 이후)에만', contest: '낚시 대회 중에만' };

export interface CollDef {
  id: string;
  name: string;
  icon: string;        // 이모지
  rarity: Rarity;
  junk?: boolean;      // 꽝: 점수 0, 크기 없음
  min: number;         // 크기 범위 (물고기 cm, 곤충 mm)
  max: number;
  w: number;           // 뽑힐 가중치
  time?: DefTime;      // 시간대 한정
  desc: string;
  on?: boolean;        // false 면 비활성: 뽑히지 않고, 이미 잡은 사람의 도감에만 남는다
}
// DB 형태: {base}/defs/{id}
export interface CollDefRecord { name: string; icon: string; rarity: Rarity; junk?: boolean; min: number; max: number; w: number; time?: DefTime; desc: string; on?: boolean; ord: number }
// pick 옵션: noJunk 꽝 제외, minRarity 그 등급 미만 제외(미끼: 희귀 이상만), boost 희귀 이상 가중치 배수(낚싯대), heroMul 영웅 이상 가중치 배수(지금은 안 씀), junkMul 꽝 가중치 배수(낚싯대),
// tierMul 등급 거듭제곱 배수(낚싯대 강화: 등급 r 의 가중치 × tierMul^r, 2026-11-10), contest 대회 한정 종 포함. 신화에는 어느 배수도 안 붙는다
export interface PickOpt { noJunk?: boolean; minRarity?: number; boost?: number; heroMul?: number; junkMul?: number; tierMul?: number; contest?: boolean }

export function timeActive(t: DefTime | undefined, d = new Date(), contest = false): boolean {
  if (!t) return true;
  if (t === 'contest') return contest;
  const h = d.getHours();
  if (t === 'lunch') return h === 12;
  return h >= 18 || h < 5; // 퇴근 후 (새벽 포함)
}

export class Collection {
  private defs: CollDef[];
  private byIdMap: Map<string, CollDef>;
  private defaultMap: Map<string, CollDef>;

  constructor(public readonly defaults: CollDef[]) {
    this.defs = defaults;
    this.byIdMap = new Map(defaults.map((f) => [f.id, f]));
    this.defaultMap = new Map(defaults.map((f) => [f.id, f]));
  }
  // 현재 목록 (비활성 포함)
  list(): CollDef[] { return this.defs; }
  active(): CollDef[] { return this.defs.filter((f) => f.on !== false); }
  set(list: CollDef[] | null): void {
    this.defs = list && list.length ? list : this.defaults;
    this.byIdMap = new Map(this.defs.map((f) => [f.id, f]));
  }
  byId(id: string): CollDef | undefined { return this.byIdMap.get(id); }
  isDefault(id: string): boolean { return this.defaultMap.has(id); }
  defaultById(id: string): CollDef | undefined { return this.defaultMap.get(id); }

  // 그 시각에 뽑힐 수 있는 목록
  pool(d = new Date(), list = this.active(), contest = false): CollDef[] { return list.filter((f) => timeActive(f.time, d, contest)); }
  // 관리자 화면용: 그 풀에서 id 가 뽑힐 확률 (0~1)
  chance(id: string, pool: CollDef[]): number {
    const total = pool.reduce((s, x) => s + x.w, 0);
    const f = pool.find((x) => x.id === id);
    return f && total > 0 ? f.w / total : 0;
  }
  // 가중치로 하나 고른다. 관리자가 전부 꺼 두었으면 기본 목록에서
  pick(rand = Math.random, d = new Date(), opt?: PickOpt): CollDef {
    let pool = this.pool(d, this.active(), !!opt?.contest);
    if (!pool.length || pool.every((f) => f.w <= 0)) pool = this.pool(d, this.defaults, !!opt?.contest);
    // 신화는 장비·미끼 배수를 타지 않도록 먼저 따로 굴린다 (확률 = w / 풀 전체 w)
    const myth = pool.filter((f) => !f.junk && f.rarity >= MYTHIC);
    if (myth.length) {
      let r = rand() * pool.reduce((s, f) => s + f.w, 0);
      for (const f of myth) { r -= f.w; if (r <= 0) return f; }
      pool = pool.filter((f) => f.junk || f.rarity < MYTHIC);
    }
    if (opt?.noJunk && pool.some((f) => !f.junk)) pool = pool.filter((f) => !f.junk);
    if (opt?.minRarity && pool.some((f) => !f.junk && f.rarity >= opt.minRarity!)) pool = pool.filter((f) => !f.junk && f.rarity >= opt.minRarity!);
    const wOf = (f: CollDef) => (f.junk ? f.w * (opt?.junkMul ?? 1) : f.w * (opt?.boost && f.rarity >= 1 ? opt.boost : 1) * (opt?.heroMul && f.rarity >= 2 ? opt.heroMul : 1) * (opt?.tierMul && opt.tierMul !== 1 && f.rarity >= 1 ? Math.pow(opt.tierMul, f.rarity) : 1));
    const total = pool.reduce((s, f) => s + wOf(f), 0);
    let r = rand() * total;
    for (const f of pool) { r -= wOf(f); if (r <= 0) return f; }
    return pool[pool.length - 1];
  }
  // 크기. 작은 쪽으로 치우친 분포라 큰 놈은 드물다. 최대 10 미만 종은 소수점 한 자리
  rollSize(f: CollDef, rand = Math.random): number {
    if (f.junk) return 0;
    const v = f.min + (f.max - f.min) * Math.pow(rand(), 1.6);
    return f.max < 10 ? Math.round(v * 10) / 10 : Math.round(v);
  }

  toRecord(f: CollDef, ord: number): CollDefRecord {
    const r: CollDefRecord = { name: f.name, icon: f.icon, rarity: f.rarity, min: f.min, max: f.max, w: f.w, desc: f.desc, ord };
    if (f.junk) r.junk = true;
    if (f.time) r.time = f.time;
    if (f.on === false) r.on = false;
    return r;
  }
  // DB 값 → 목록 (ord 순). 비어 있거나 쓸 수 있는 항목이 없으면 null (= 기본 목록 사용)
  fromDb(v: Record<string, Partial<CollDefRecord>> | null | undefined): CollDef[] | null {
    if (!v || typeof v !== 'object') return null;
    const out: CollDef[] = [];
    for (const [id, r] of Object.entries(v)) {
      if (!r || typeof r.name !== 'string' || !r.name || typeof r.w !== 'number') continue;
      const rarity = (typeof r.rarity === 'number' && r.rarity >= 0 && r.rarity <= MYTHIC ? Math.floor(r.rarity) : 0) as Rarity;
      const f: CollDef = {
        id, name: r.name, icon: typeof r.icon === 'string' && r.icon ? r.icon : '❔', rarity,
        min: Number(r.min) || 0, max: Number(r.max) || 0, w: Math.max(0, r.w), desc: typeof r.desc === 'string' ? r.desc : '',
      };
      if (r.junk) f.junk = true;
      if (r.time === 'lunch' || r.time === 'night' || r.time === 'contest') f.time = r.time;
      if (r.on === false) f.on = false;
      out.push(f);
    }
    const ord = (id: string) => Number(v[id]?.ord) || 0;
    out.sort((a, b) => (ord(a.id) - ord(b.id)) || a.id.localeCompare(b.id));
    return out.length ? out : null;
  }
  // 기본 목록을 DB 형태로 (관리자 "기본 목록" 버튼)
  defaultRecord(): Record<string, CollDefRecord> {
    const o: Record<string, CollDefRecord> = {};
    this.defaults.forEach((f, i) => { o[f.id] = this.toRecord(f, i); });
    return o;
  }
}

export function pointsOf(f: CollDef): number { return f.junk ? 0 : RARITY_POINTS[f.rarity]; }

// ---- DB 레코드 (물고기·곤충 공용) ----
export interface BookEntry { c: number; m: number; f: number }               // {base}/book/{uid}/{id}: 마릿수, 최대 크기, 처음 잡은 시각
export interface WeekEntry { n: string; p: number; c: number; at: number }   // {base}/week/{weekKey}/{uid}: 닉, 점수, 마릿수, 마지막 시각
export interface BestEntry { u: string; n: string; s: number; at: number }   // {base}/best/{id}: 서버 최고 기록
export interface FeedEntry { u: string; n: string; f: string; s: number; ts: number } // {base}/feed/{pushId}: 영웅 이상 공지
