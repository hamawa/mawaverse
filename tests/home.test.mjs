// 내 집 시험 (src/shared/home.ts, 집 안 맵, 집 맵 id). 실행: node --test tests/home.test.mjs
// 규칙(database.rules.json 의 homes 블록)에 글자로 든 숫자가 코드의 상수와 같은지도 본다. 규칙 자체의 허용·거부는 tests/rules-gate.test.mjs (에뮬레이터)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(spec, ctx, next) {
    try { return next(spec, ctx); } catch (e) {
      if (spec.startsWith('.') && !/\.[cm]?[jt]s$/.test(spec)) return next(`${spec}.ts`, ctx);
      throw e;
    }
  },
  load(url, ctx, next) {
    if (!url.startsWith('file:') || !url.endsWith('.ts')) return next(url, ctx);
    return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
  },
});

const H = await import('../src/shared/home.ts');
const { itemById, isOwnItem, AVATAR_FEE, NICK_FEE } = await import('../src/shared/shop.ts');
const { isHomeMapId, homeMapId, homeOwnerOf, isMapId, occupancyKey } = await import('../src/shared/maps.ts');
const { mapSource, savedMapId, arrivalTile } = await import('../src/game/portal.ts');
const { buildHomeMap, homeCanPlace, HOME_EXIT_ZONE, O, G, O_BED, O_CHEST, objectAt, groundAt, isWalkable, portalNear } = await import('../src/game/map.ts');
const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules;

test('집 단계: 값이 오르고, 코인이 드는 단계는 보관함 품목으로 낸다', () => {
  assert.deepEqual(H.HOME_TIERS.map((t) => [t.tier, t.wood, t.coins, t.extraSlots]), [[1, 30, 0, 0], [2, 300, 10000, 3], [3, 1000, 50000, 6]]);
  for (const t of H.HOME_TIERS) {
    if (!t.item) { assert.equal(t.coins, 0); continue; }
    const it = itemById(t.item);
    assert.ok(it && isOwnItem(t.item), `${t.item} 은 보관함 품목이어야 한다 (기존 구매 규칙으로 값을 낸다)`);
    assert.equal(it.price, t.coins);
  }
  assert.equal(H.tierOf(null), 0);
  assert.equal(H.tierOf({ t: 2 }), 2);
  assert.equal(H.tierOf({ t: 9 }), 0);
  assert.equal(H.nextTier(null).tier, 1);
  assert.equal(H.nextTier({ t: 3 }), null);
  assert.equal(H.needsWood({ t: 1, w: 299 }), true);
  assert.equal(H.needsWood({ t: 1, w: 300 }), false);
});

test('창고: 기본 4칸, 칸마다 100마리, 늘리는 값은 5,000씩 오른다', () => {
  assert.equal(H.capacityOf(null), 0, '집이 없으면 창고도 없다');
  assert.equal(H.capacityOf({ t: 1 }), 400);
  assert.equal(H.capacityOf({ t: 2, s: 3 }), 700);
  assert.equal(H.capacityOf({ t: 3, s: 6 }), 1000);
  assert.equal(H.capacityOf({ t: 3, s: 99 }), 1000, '칸은 6개까지만 센다');
  let total = 0;
  for (let n = 1; n <= H.MAX_EXTRA_SLOTS; n++) {
    const it = itemById(H.slotItem(n));
    assert.ok(it && isOwnItem(it.id));
    assert.equal(it.price, H.slotPrice(n));
    total += it.price;
  }
  assert.equal(total, 105000);
  assert.equal(itemById(H.slotItem(H.MAX_EXTRA_SLOTS + 1)), undefined);
});

test('묶음 판매: 큰 묶음일수록 한 마리 값이 높고, 그 묶음이 들어갈 칸이 있어야 한다', () => {
  let unit = 0;
  for (const b of H.BUNDLES) {
    assert.ok(b.price / b.n > unit, '단가는 묶음이 클수록 오른다');
    unit = b.price / b.n;
    assert.ok(b.n <= b.slots * H.SLOT_FISH, '그 칸 수에 묶음이 들어간다');
    assert.ok(b.slots <= H.BASE_SLOTS + H.MAX_EXTRA_SLOTS);
  }
  // 밸런스 선 (2026-11-17, 사용자 결정 "보수적으로"): 하루 2,000마리쯤 낚으니 한 마리 2코인을 넘기지 않는다
  assert.ok(unit <= 2);
  assert.equal(H.BUNDLES[0].slots <= H.BASE_SLOTS, true, '가장 작은 묶음은 기본 칸으로 팔 수 있다');
  assert.ok(H.BUNDLES.at(-1).slots > H.BASE_SLOTS + H.HOME_TIERS[1].extraSlots, '가장 큰 묶음은 벽돌집에서만');
});

test('겨울잠: 든든함 하나에 드는 물고기가 기본 창고에 들어가고, 빠따 값보다 싸지만 공짜는 아니다', () => {
  assert.ok(H.SHIELD_FISH <= H.BASE_SLOTS * H.SLOT_FISH);
  assert.equal(H.shieldOf({ sh: 5 }), H.SHIELD_MAX);
  assert.equal(H.shieldOf(null), 0);
  const worth = H.SHIELD_FISH * (H.BUNDLES.at(-1).price / H.BUNDLES.at(-1).n); // 가장 좋은 값에 팔았을 때
  assert.ok(worth >= 300 && worth < itemById('bat').price, `든든함 하나의 값 ${worth}`);
});

test('규칙에 든 숫자가 코드와 같다', () => {
  const v = rules.homes.$uid['.validate'];
  for (const t of H.HOME_TIERS) assert.ok(v.includes(` - ${t.wood})`) || v.includes(` - ${t.wood} &&`), `나무 ${t.wood}`);
  assert.ok(v.includes("/own/house2').val() == true") && v.includes("/own/house3').val() == true"));
  assert.ok(v.includes(` + ${H.CHOP_MAX} && newData.child('wa').val() == now`) && v.includes(`now - ${H.CHOP_GAP_MS}`));
  assert.ok(v.includes(` + ${H.STORE_MAX} && `) && v.includes(`${H.SLOT_FISH} * (${H.BASE_SLOTS} + `) && v.includes(`now - ${H.STORE_GAP_MS}`));
  assert.ok(v.includes(`? ${H.HOME_TIERS[2].extraSlots} : (`) && v.includes(`? ${H.HOME_TIERS[1].extraSlots} : ${H.HOME_TIERS[0].extraSlots}`));
  assert.ok(v.includes(` - ${H.SHIELD_FISH}))`));
  assert.ok(rules.homes.$uid.w['.validate'].includes(`<= ${H.WOOD_MAX}`));
  assert.ok(rules.homes.$uid.sh['.validate'].includes(`<= ${H.SHIELD_MAX}`));
  assert.ok(rules.homes.$uid.s['.validate'].includes(`<= ${H.MAX_EXTRA_SLOTS}`));
  assert.ok(H.CHOP_GAP_MS < H.CHOP_MS && H.STORE_GAP_MS < H.STORE_FLUSH_MS, '규칙의 간격은 화면의 간격보다 짧아야 정상 쓰기가 거부되지 않는다');
  assert.ok(rules.players.$uid.m['.validate'].includes('/^h-[a-zA-Z0-9]{1,40}$/'));
});

test('집 맵 id: 주인 uid 로 만들고, 저장된 맵 id 와 따로 판정한다', () => {
  const uid = 'mWAgjEZsAo1nOPpSNYQd1mYwE3Ab';
  const id = homeMapId(uid);
  assert.equal(isHomeMapId(id), true);
  assert.equal(homeOwnerOf(id), uid);
  assert.equal(isMapId(id), false, '28자 uid 는 저장된 맵 id 길이를 넘는다');
  assert.equal(mapSource(id), 'home');
  assert.equal(savedMapId({ m: id }), id);
  assert.equal(isHomeMapId('h-'), false);
  assert.equal(isHomeMapId('h-ab_cd'), false);
  assert.equal(occupancyKey(id, 3, 4), `${id}~3_4`);
});

test('집 안 맵: 단계마다 커지고, 문 앞에 서며, 침대와 창고 상자가 있다', () => {
  let area = 0;
  for (const t of H.HOME_TIERS) {
    const m = buildHomeMap('h-x', t.tier, '시험');
    assert.equal(m.w, t.iw + 2); assert.equal(m.h, t.ih + 2);
    assert.ok(m.w * m.h > area); area = m.w * m.h;
    assert.ok(isWalkable(m, m.spawn.x, m.spawn.y));
    assert.deepEqual(arrivalTile(m, m.spawn, () => false), m.spawn, '들어오면 문 앞에 선다');
    assert.equal(portalNear(m, m.spawn.x, m.spawn.y)?.id, HOME_EXIT_ZONE, '문 앞에서 F 로 나간다');
    assert.equal(objectAt(m, 1, 1), O_BED);
    assert.equal(objectAt(m, m.w - 2, 1), O_CHEST);
    // 침대·창고 상자 앞 칸은 걸을 수 있고, 문(포탈) 범위와 겹치지 않아 F 가 그쪽으로 간다
    for (const [x, y] of [[1, 2], [m.w - 2, 2]]) { assert.ok(isWalkable(m, x, y), `${t.name} (${x},${y})`); assert.equal(portalNear(m, x, y), undefined); }
    // 테두리는 전부 막혀 있다 (문 한 칸만 열림)
    let open = 0;
    for (let x = 0; x < m.w; x++) for (const y of [0, m.h - 1]) if (isWalkable(m, x, y)) open++;
    for (let y = 0; y < m.h; y++) for (const x of [0, m.w - 1]) if (isWalkable(m, x, y)) open++;
    assert.equal(open, 1);
  }
});

test('변경 요금: 소모품이라 보관함에 들어가지 않는다', () => {
  assert.equal(isOwnItem(AVATAR_FEE.id), false);
  assert.equal(isOwnItem(NICK_FEE.id), false);
  assert.ok(AVATAR_FEE.price > 0 && NICK_FEE.price > AVATAR_FEE.price);
});

test('꾸미기: 가구 값이 규칙과 같고, 단계마다 놓을 수 있는 수와 박제 자리가 늘어난다', () => {
  assert.equal(H.FURNITURE.reduce((a, f) => a + f.wood, 0), 600, '전부 만들면 나무 600개');
  assert.equal(new Set(H.FURNITURE.map((f) => f.o)).size, H.FURNITURE.length);
  const fu = rules.homes.$uid.fu.$id['.validate'];
  // 규칙의 값 계산을 그대로 흉내 낸다: 적힌 id 묶음마다의 값, 나머지는 20
  const cost = (o) => { const id = String(o); return ['23', '33'].includes(id) ? 100 : ['21', '22'].includes(id) ? 60 : id === '32' ? 50 : ['10', '27'].includes(id) ? 40 : ['4', '5', '30'].includes(id) ? 30 : 20; };
  for (const f of H.FURNITURE) {
    assert.equal(cost(f.o), f.wood, f.name);
    assert.ok(new RegExp(`\\(([0-9]+\\|)*${f.o}(\\|[0-9]+)*\\)`).test(fu), `규칙의 가구 목록에 ${f.name}(${f.o})`);
    assert.ok(Object.values(O).includes(f.o), `${f.name} 은 맵 오브젝트여야 한다`);
  }
  assert.ok(fu.includes("? 100 : (") && fu.includes("? 60 : (") && fu.includes("? 50 : (") && fu.includes("? 40 : (") && fu.includes("? 30 : 20"));
  assert.equal((fu.match(/\(([0-9]+\|)+[0-9]+\)/)[0].match(/[0-9]+/g) || []).length, H.FURNITURE.length, '규칙의 목록과 가구 수가 같다');
  assert.deepEqual(H.HOME_TIERS.map((t) => [t.deco, t.trophyX.length]), [[4, 1], [10, 2], [24, 4]]);
  assert.ok(rules.homes.$uid.fl['.validate'].includes(`- ${H.FLOOR_WOOD})`));
  for (const f of H.FLOORS) assert.ok(rules.homes.$uid.fl['.validate'].includes(`newData.val() == ${f.g}`), f.name);
  // 박제 자리: 벽 위(창문이 아닌 칸)이고 방 너비 안
  for (const t of H.HOME_TIERS) {
    const m = buildHomeMap('h-x', t.tier, '시험');
    for (const x of t.trophyX) assert.equal(objectAt(m, x, 0), O.WALL, `${t.name} 박제 자리 x=${x}`);
  }
  assert.equal(H.TROPHY_MIN_RARITY, 3);
});

test('꾸미기: 놓은 가구가 방에 나타나고, 침대·창고 상자·문 앞은 막을 수 없다', () => {
  for (const t of H.HOME_TIERS) {
    const W = t.iw + 2, Hh = t.ih + 2, door = Math.floor(W / 2);
    for (const [x, y] of [[1, 1], [1, 2], [W - 2, 1], [W - 2, 2], [door, Hh - 2], [0, 1], [W - 1, 2], [2, 0], [door, Hh - 1]]) assert.equal(homeCanPlace(t.tier, x, y), false, `${t.name} (${x},${y})`);
    assert.equal(homeCanPlace(t.tier, 2, 2), true);
    let free = 0;
    for (let y = 1; y <= Hh - 2; y++) for (let x = 1; x <= W - 2; x++) if (homeCanPlace(t.tier, x, y)) free++;
    assert.ok(free >= t.deco, `${t.name}: 놓을 수 있는 칸 ${free} ≥ 한도 ${t.deco}`);
  }
  // 통나무집: 아무것도 안 놓으면 기본 가구, 하나라도 놓으면 놓은 것만
  const base = buildHomeMap('h-x', 2, '시험');
  assert.equal(objectAt(base, 4, 2), O.TABLE);
  const m = buildHomeMap('h-x', 2, '시험', { t: 2, d: { '3_3': 22, '1_1': 6, '9_9': 6, '2_2': 999 }, fl: 8 });
  assert.equal(objectAt(m, 3, 3), O.SOFA);
  assert.equal(objectAt(m, 4, 2), O.NONE, '기본 가구는 치워진다');
  assert.equal(objectAt(m, 1, 1), O_BED, '침대 자리에 놓은 값은 무시');
  assert.equal(objectAt(m, 2, 2), O.NONE, '가구가 아닌 값은 무시');
  assert.equal(groundAt(m, 2, 2), G.CARPET, '고른 바닥재로 깐다');
  assert.equal(groundAt(buildHomeMap('h-x', 2, '시험', { fl: 99 }), 2, 2), G.WOOD, '모르는 바닥 값이면 기본 바닥');
  assert.deepEqual(H.decoList({ d: { '3_3': 22, 'x': 6, '4_4': 1 } }), [{ x: 3, y: 3, o: 22 }]);
});

test('나무: 베면 그루터기, 자라는 중에는 덤불, 5분 뒤 다시 나무', () => {
  const T = 1_800_000_000_000;
  assert.equal(H.treeStage(undefined, T), 'tree');
  assert.equal(H.treeStage(T, T + 1000), 'tree', '베는 동안은 서 있는 나무로 그린다');
  assert.equal(H.treeStage(T, T + H.TREE_HIDE_MS), 'stump');
  assert.equal(H.treeStage(T, T + H.TREE_REGROW_MS * 0.6 - 1), 'stump');
  assert.equal(H.treeStage(T, T + H.TREE_REGROW_MS * 0.6), 'bush');
  assert.equal(H.treeStage(T, T + H.TREE_REGROW_MS - 1), 'bush');
  assert.equal(H.treeStage(T, T + H.TREE_REGROW_MS), 'tree');
  assert.equal(H.treeCut(T, T + 1000), true, '첫 도끼질부터 남은 못 벤다');
  assert.equal(H.treeCut(T, T + H.TREE_REGROW_MS), false);
  assert.equal(H.treeCut(undefined, T), false);
  assert.equal(H.TREE_HIDE_MS, (H.CHOP_SWINGS - 1) * H.CHOP_MS);
  const w = rules.trees.$map.$pos['.write'];
  assert.equal((w.match(new RegExp(`now - ${H.TREE_REGROW_MS}`, 'g')) || []).length, 2, '규칙의 다시 자라는 시간');
  assert.ok(w.includes("child('homes/' + auth.uid + '/wa').val() == now"), '나무를 받는 쓰기와 함께여야 한다');
});
