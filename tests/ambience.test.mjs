// 낮밤·집 안 펫·소리 시험 (2026-11-18). 실행: node --test tests/ambience.test.mjs
// 셋 다 화면·스피커에만 있는 효과라 서버와 무관하다. 여기서는 계산이 흔들리지 않는지만 본다:
// 낮밤 빛깔이 시각에 따라 끊김 없이 이어지는지, 같은 집의 펫이 누구 화면에서나 같은 자리에 있는지, 소리 모듈이 소리 없는 환경에서도 조용히 넘어가는지
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

const { dayTint, kstMinuteOfDay, isNight } = await import('../src/shared/daylight.ts');
const { HomePets, ownedPets, roamTiles, ROAM_SLOT_MS, ROAM_EPOCH_MS } = await import('../src/game/homepets.ts');
const { buildHomeMap } = await import('../src/game/map.ts');
const { PET_IDS } = await import('../src/shared/shop.ts');
const audio = await import('../src/game/audio.ts');

test('낮밤: 낮에는 덧칠이 없고 밤에는 사용자가 고른 세기(0.42)까지만 어두워진다', () => {
  for (const h of [8, 10, 12, 14, 16]) assert.equal(dayTint(h * 60).a, 0, `${h}시`);
  for (const h of [21, 23, 0, 2, 4]) { const t = dayTint(h * 60); assert.ok(Math.abs(t.a - 0.42) < 1e-9, `${h}시`); assert.equal(t.lamp, 1); }
  for (let m = 0; m <= 24 * 60; m += 5) { const t = dayTint(m); assert.ok(t.a >= 0 && t.a <= 0.42 + 1e-9 && t.lamp >= 0 && t.lamp <= 1, `${m}분`); }
  assert.equal(isNight(22 * 60), true);
  assert.equal(isNight(12 * 60), false);
  assert.equal(isNight(18 * 60), false, '노을 때는 아직 밤 곡이 아니다');
});

test('낮밤: 빛깔이 튀지 않고 이어지며 자정을 넘어가도 같다', () => {
  let prev = dayTint(0);
  for (let m = 1; m <= 24 * 60; m++) {
    const t = dayTint(m);
    assert.ok(Math.abs(t.a - prev.a) < 0.01 && Math.abs(t.lamp - prev.lamp) < 0.02, `${m}분에서 튄다`);
    prev = t;
  }
  assert.deepEqual(dayTint(0), dayTint(24 * 60));
});

test('낮밤: 시각은 한국 시간으로 잰다', () => {
  assert.equal(kstMinuteOfDay(Date.UTC(2026, 10, 18, 15, 0, 0)), 0, 'UTC 15시 = 한국 자정');
  assert.equal(kstMinuteOfDay(Date.UTC(2026, 10, 18, 3, 30, 0)), 12 * 60 + 30);
});

test('집 안 펫: 가진 펫만, 상점 순서로 고른다', () => {
  assert.deepEqual(ownedPets({ petcat: true, rod2: true, petdog: true, pethamster: false }), ['petdog', 'petcat']);
  assert.deepEqual(ownedPets(null), []);
});

test('집 안 펫: 같은 집·같은 시각이면 누구 화면에서나 같은 자리에 있다', () => {
  const map = buildHomeMap('h-owner', 2, '집');
  const a = new HomePets(), b = new HomePets();
  a.setMap(map); b.setMap(map);
  const t0 = 1_800_000_000_000;
  // a 는 처음부터 차례로 보고, b 는 중간에 들어와 한 번에 본다
  const pets = PET_IDS.map((id) => ({ key: `owner|${id}`, id }));
  for (let t = t0; t < t0 + 120_000; t += 700) a.views(pets, t);
  const t = t0 + 120_000;
  assert.deepEqual(a.views(pets, t), b.views(pets, t));
  // 열쇠가 다르면(다른 집, 또는 같은 집의 손님이 데리고 온 같은 종류) 따로 돌아다닌다
  const spots = ['owner|petdog', 'other|petdog', 'owner|guest|petdog'].map((key) => { const v = a.views([{ key, id: 'petdog' }], t)[0]; return `${v.x},${v.y}`; });
  assert.ok(new Set(spots).size > 1, '열쇠마다 다르게 돌아다닌다');
  assert.ok(a.views(pets, t).every((v) => v.scale === 1), '집 안에서는 전부 기본 크기');
});

test('집 안 펫: 걸을 수 있는 칸에만 서고, 한 번에 한 칸씩만 옮긴다', () => {
  for (const tier of [1, 2, 3]) {
    const map = buildHomeMap('h-owner', tier, '집');
    const free = new Set(roamTiles(map).map((p) => `${p.x},${p.y}`));
    assert.ok(free.size > 3);
    const hp = new HomePets(); hp.setMap(map);
    const epoch0 = Math.ceil(1_800_000_000_000 / ROAM_EPOCH_MS) * ROAM_EPOCH_MS;
    let prev = null;
    for (let i = 1; i < 150; i++) {
      const v = hp.views([{ key: 'owner|petcat', id: 'petcat' }], epoch0 + i * ROAM_SLOT_MS - 1)[0]; // 그 간격의 끝: 걸음이 끝난 자리
      assert.ok(free.has(`${v.x},${v.y}`), `${tier}단계 집 ${i}번째: (${v.x},${v.y})`);
      if (prev) assert.ok(Math.abs(v.x - prev.x) + Math.abs(v.y - prev.y) <= 1);
      prev = v;
    }
  }
});

test('날씨: 비는 30분 단위로 정해지고 전체의 15% 안팎이며, 시작과 끝은 서서히 굵어지고 가늘어진다', async () => {
  const { rainLevel, rainBlock, isRaining, WEATHER_BLOCK_MS, RAIN_PERMILLE } = await import('../src/shared/weather.ts');
  const base = Math.floor(1_800_000_000_000 / WEATHER_BLOCK_MS);
  let wet = 0; const N = 20000;
  for (let i = 0; i < N; i++) if (rainBlock(base + i)) wet++;
  assert.ok(Math.abs(wet / N - RAIN_PERMILLE / 1000) < 0.02, `비 오는 구간 비율 ${wet / N}`);
  // 맑은 구간 뒤에 오는 비 구간을 하나 찾아 처음·가운데를 본다
  let i = base; while (!(rainBlock(i) && !rainBlock(i - 1))) i++;
  const t0 = i * WEATHER_BLOCK_MS;
  assert.equal(rainLevel(t0 - 1), 0);
  assert.ok(rainLevel(t0 + 1000) > 0 && rainLevel(t0 + 1000) < 0.05, '막 시작했을 때는 가늘다');
  assert.equal(rainLevel(t0 + 10 * 60 * 1000), 1, '한창일 때');
  assert.equal(isRaining(t0 + 1000), true);
  for (let t = t0 - 60000; t < t0 + 3 * WEATHER_BLOCK_MS; t += 7000) assert.ok(Math.abs(rainLevel(t + 7000) - rainLevel(t)) < 0.1, '세기가 튀지 않는다');
});

test('시간대 한정 종: 새벽은 5시~7시 반, 비는 비가 올 때만 풀에 들어온다', async () => {
  const { timeActive, DEF_TIMES, TIME_LABEL } = await import('../src/shared/collection.ts');
  const { DEFAULT_FISH, pickFish } = await import('../src/shared/fish.ts');
  const at = (h, m = 0) => new Date(2026, 10, 18, h, m, 0);
  assert.deepEqual([[4, 59], [5, 0], [7, 29], [7, 30]].map(([h, m]) => timeActive('dawn', at(h, m))), [false, true, true, false]);
  assert.equal(timeActive('rain', at(12)), false);
  assert.equal(timeActive('rain', at(12), false, true), true);
  for (const t of DEF_TIMES) assert.ok(TIME_LABEL[t]);
  const dawn = DEFAULT_FISH.filter((f) => f.time === 'dawn'), rain = DEFAULT_FISH.filter((f) => f.time === 'rain');
  assert.deepEqual([dawn.length, rain.length], [3, 3]);
  // 한정 종의 가중치: 처음 넣은 값(장비를 갖춘 사람 기준 기대 점수 +4% 안쪽)을 넘기지 않는다. 올리려면 라이브 목록으로 다시 계산할 것
  assert.ok(dawn.reduce((s, f) => s + f.w, 0) <= 2.4 + 1e-9 && rain.reduce((s, f) => s + f.w, 0) <= 3.05 + 1e-9);
  assert.ok(dawn.filter((f) => f.rarity >= 3).reduce((s, f) => s + f.w, 0) <= 0.4 + 1e-9 && rain.filter((f) => f.rarity >= 3).reduce((s, f) => s + f.w, 0) <= 0.45 + 1e-9);
  // 비가 안 오는 낮에는 한정 종이 나오지 않는다
  let seed = 1; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 3000; i++) { const f = pickFish(rnd, at(12), {}); assert.ok(f.time !== 'rain' && f.time !== 'dawn', f.name); }
  let got = 0; for (let i = 0; i < 3000; i++) if (pickFish(rnd, at(12), { rain: true }).time === 'rain') got++;
  assert.ok(got > 0, '비가 오면 비 한정 종이 나온다');
});

test('클럽: 코드에 든 맵으로 등록돼 있고, 포탈 정원과 서로 오갈 수 있으며, 춤추는 펫은 춤추는 바닥 위에 있다', async () => {
  const { buildClubMap, buildPortalGarden, CLUB_FLOOR, CLUB_DANCERS, G_DANCE, isWalkable, isReservedMapId, groundAt } = await import('../src/game/map.ts');
  const { CLUB_MAP_ID, GARDEN_MAP_ID, BUILTIN_MAP_IDS } = await import('../src/shared/maps.ts');
  const { mapSource, MAP_INFO } = await import('../src/game/portal.ts');
  const club = buildClubMap(), garden = buildPortalGarden();
  assert.equal(club.id, CLUB_MAP_ID);
  assert.ok(BUILTIN_MAP_IDS.includes(CLUB_MAP_ID) && isReservedMapId(CLUB_MAP_ID) && mapSource(CLUB_MAP_ID) === 'builtin' && MAP_INFO[CLUB_MAP_ID]);
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules;
  assert.ok(rules.players.$uid.m['.validate'].includes("newData.val() == 'club'"), '규칙의 맵 id 목록에 club');
  assert.equal(isWalkable(club, club.spawn.x, club.spawn.y), true);
  const out = club.zones.find((z) => z.kind === 'portal'), into = garden.zones.find((z) => z.kind === 'portal' && z.targetMap === CLUB_MAP_ID);
  assert.ok(out && out.targetMap === GARDEN_MAP_ID && into, '양쪽에 포탈이 있다');
  assert.equal(isWalkable(garden, out.targetSpawn.x, out.targetSpawn.y), true, '돌아갈 자리는 걸을 수 있는 땅');
  for (let x = into.x - 1; x <= into.x + into.w; x++) assert.equal(isWalkable(garden, x, into.y - 1), true, `정원 쪽 포탈 앞 (${x})`);
  for (const d of CLUB_DANCERS) { assert.equal(groundAt(club, d.x, d.y), G_DANCE, `춤추는 펫 (${d.x},${d.y})`); assert.ok(d.x >= CLUB_FLOOR.x && d.x < CLUB_FLOOR.x + CLUB_FLOOR.w && d.y >= CLUB_FLOOR.y && d.y < CLUB_FLOOR.y + CLUB_FLOOR.h); }
  // 바깥 테두리는 전부 벽이라 밖으로 나갈 수 없다
  for (let x = 0; x < club.w; x++) { assert.equal(isWalkable(club, x, 0), false); assert.equal(isWalkable(club, x, club.h - 1), false); }
  for (let y = 0; y < club.h; y++) { assert.equal(isWalkable(club, 0, y), false); assert.equal(isWalkable(club, club.w - 1, y), false); }
});

test('소리: 소리를 낼 수 없는 환경에서도 불러올 수 있고 조용히 넘어간다 (처음에는 꺼져 있다)', () => {
  assert.equal(audio.soundOn(), false);
  assert.doesNotThrow(() => { audio.sfx('catch', { k: 4 }); audio.sfxAt('push', 3); audio.setScene('main', true); audio.stopSound(); });
});

test('소리: 곡마다 화음 진행이 음계 안에 있고, 같은 씨앗이면 같은 가락이 나온다', () => {
  for (const [key, tu] of Object.entries(audio.TUNES)) {
    assert.equal(tu.scale.length, 7, key);
    assert.ok(tu.prog.every((d) => d >= 0 && d < 7), key);
    assert.ok(tu.bars >= tu.prog.length && tu.bpm >= 40 && tu.bpm <= 160, key);
    if (tu.arp) assert.ok(tu.arp.pat.every((p) => p >= -1 && p <= 3), key);
    const m1 = audio.composeMelody(tu, 7), m2 = audio.composeMelody(tu, 7);
    assert.deepEqual(m1, m2, key);
    assert.equal(m1.length, tu.prog.length);
    assert.ok(m1.every((row) => row.length === tu.beats && row.every((d) => d === null || (d >= 0 && d <= 9))), key);
  }
});
