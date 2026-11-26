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
  assert.ok(CLUB_DANCERS.length >= PET_IDS.length, '펫 종류마다 한 마리씩 춤춘다 (펫을 더하면 자리도 더한다)');
  assert.equal(new Set(CLUB_DANCERS.map((d) => `${d.x}_${d.y}`)).size, CLUB_DANCERS.length, '자리가 겹치지 않는다');
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

// 전송량 (2026-11-18 사용량 검토): 화면은 신화 배너에만 소식을 쓴다. 영웅·전설까지 보내면 쓰이지 않는 전송이 낚을 때마다 전원에게 나간다
test('소식: 낚시·채집 소식은 신화만 보낸다 (화면이 쓰지 않는 전송을 되살리지 않는다)', async () => {
  const { MYTHIC } = await import('../src/shared/collection.ts');
  const { ANNOUNCE_RARITY } = await import('../src/shared/fish.ts');
  const { BUG_ANNOUNCE_RARITY } = await import('../src/shared/bugs.ts');
  assert.equal(ANNOUNCE_RARITY, MYTHIC);
  assert.equal(BUG_ANNOUNCE_RARITY, MYTHIC);
});

// ---------- 2026-11-19: 계절, 클럽 음악, 앵무새 ----------
test('계절: 11/15~1/31 은 눈과 단풍, 4~5월은 벚꽃 (한국 날짜로 가른다)', async () => {
  const { snowSeason, treeLook, kstMonthDay } = await import('../src/shared/season.ts');
  const kst = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi);
  assert.deepEqual(kstMonthDay(kst(2026, 11, 15)), { m: 11, d: 15 });
  assert.equal(snowSeason(kst(2026, 11, 14, 23, 59)), false);
  assert.equal(snowSeason(kst(2026, 11, 15, 0, 0)), true);
  assert.equal(snowSeason(kst(2026, 12, 25, 12)), true);
  assert.equal(snowSeason(kst(2027, 1, 31, 23, 59)), true);
  assert.equal(snowSeason(kst(2027, 2, 1, 0, 0)), false);
  assert.equal(treeLook(kst(2026, 11, 19, 12)), 'autumn');
  assert.equal(treeLook(kst(2027, 2, 1)), null);
  assert.equal(treeLook(kst(2027, 3, 31, 23, 59)), null);
  assert.equal(treeLook(kst(2027, 4, 1, 0, 0)), 'blossom');
  assert.equal(treeLook(kst(2027, 5, 31, 23, 59)), 'blossom');
  assert.equal(treeLook(kst(2027, 6, 1, 0, 0)), null);
  assert.equal(treeLook(kst(2027, 8, 15)), null);
});

test('클럽 음악: 구간이 있는 편곡이고(인트로·빌드업·드롭·브레이크), 가락이 마디 길이와 화음에 맞는다', async () => {
  const { EDM_FORM, EDM_BARS, edmSection, hookNotes } = await import('../src/game/edm.ts');
  assert.deepEqual(EDM_FORM.map(([k]) => k), ['intro', 'build', 'drop', 'break', 'build', 'drop', 'outro']);
  assert.equal(EDM_BARS, 68);
  assert.deepEqual(edmSection(0), { kind: 'intro', i: 0, n: 8, rep: 0 });
  assert.deepEqual(edmSection(16), { kind: 'drop', i: 0, n: 16, rep: 0 });
  assert.deepEqual(edmSection(47), { kind: 'build', i: 7, n: 8, rep: 1 });
  assert.deepEqual(edmSection(48), { kind: 'drop', i: 0, n: 16, rep: 1 });
  assert.deepEqual(edmSection(67), { kind: 'outro', i: 3, n: 4, rep: 0 });
  assert.deepEqual(hookNotes('7--7..9-'), [{ step: 0, deg: 7, len: 3 }, { step: 3, deg: 7, len: 1 }, { step: 6, deg: 9, len: 2 }]);
  const clubs = ['club1', 'club2', 'club3'].map((k) => audio.TUNES[k]);
  assert.equal(new Set(clubs.map((t) => t.edm.bass)).size, 3, '세 곡의 베이스 방식이 다 다르다');
  for (const t of clubs) {
    const e = t.edm;
    assert.equal(t.bars, EDM_BARS); assert.equal(t.bpm, e.bpm);
    assert.ok(e.bpm >= 120 && e.bpm <= 140);
    assert.equal(e.prog.length, 8); assert.equal(e.hook.length, 8);
    for (const row of e.hook) {
      assert.equal(row.length, 16, row);
      assert.match(row, /^[0-9a-z.-]+$/);
      const ns = hookNotes(row);
      assert.ok(ns.length >= 3, '마디마다 음이 셋 이상');
      for (const n of ns) assert.ok(n.deg >= 0 && n.deg <= 21 && n.step + n.len <= 16);
    }
    // 마디의 첫 음은 그 마디 화음의 음이다 (가락이 화음과 어긋나지 않게)
    e.hook.forEach((row, b) => { const first = hookNotes(row)[0].deg; assert.ok([0, 2, 4].includes((((first - e.prog[b]) % 7) + 7) % 7), `${t.name} ${b + 1}마디 첫 음`); });
    if (e.bass === 'bounce') assert.equal(e.bounce.length, 16);
    if (e.stabs) assert.equal(e.stabs.length, 16);
  }
});

test('앵무새: 주인의 마지막 낱말을 두 번 따라 한다 (길면 끝 여섯 글자, 웃음·기호만이면 조용히)', async () => {
  const { parrotEcho, PARROT_ID, itemById } = await import('../src/shared/shop.ts');
  assert.equal(itemById(PARROT_ID)?.kind, 'pet');
  assert.equal(parrotEcho('오늘 점심 뭐 먹지?'), '먹지! 먹지!');
  assert.equal(parrotEcho('  안녕  '), '안녕! 안녕!');
  assert.equal(parrotEcho('아주아주긴한낱말입니다'), '한낱말입니다! 한낱말입니다!');
  assert.equal(parrotEcho('ㅋㅋㅋㅋ'), '');
  assert.equal(parrotEcho(''), '');
});

test('rings: five kinds by rarity, and together they raise the expected score only a little', async () => {
  const { DEFAULT_FISH } = await import('../src/shared/fish.ts');
  const { RARITY_POINTS } = await import('../src/shared/collection.ts');
  const rings = DEFAULT_FISH.filter((f) => f.id.startsWith('ring'));
  assert.deepEqual(rings.map((f) => [f.id, f.rarity]), [['ringtoy', 1], ['ringsilver', 2], ['ringgold', 3], ['ringdia', 3], ['ringgerma', 4]]);
  assert.ok(rings.every((f) => !f.time && !f.junk && f.name.length <= 20 && f.desc.length <= 80 && f.min > 0 && f.max < 10));
  const base = DEFAULT_FISH.filter((f) => !f.time && !f.id.startsWith('ring'));
  const ev = (list) => list.reduce((s, f) => s + (f.junk ? 0 : f.w * RARITY_POINTS[f.rarity]), 0) / list.reduce((s, f) => s + f.w, 0);
  const up = ev([...base, ...rings]) / ev(base);
  assert.ok(up > 1 && up < 1.05, `expected score x${up.toFixed(3)}`);
  const dragon = DEFAULT_FISH.find((f) => f.id === 'dragon');
  assert.ok(rings[4].w <= dragon.w / 2, 'the mythic ring is rarer than the dragon');
});

// ---------- 클럽 DJ (2026-11-19) ----------
test('유튜브 링크: 여러 모양의 주소에서 영상 id 를 뽑고, 다른 사이트·잘못된 주소는 받지 않는다', async () => {
  const { youtubeId } = await import('../src/shared/youtube.ts');
  const ID = 'dQw4w9WgXcQ';
  for (const u of [ID, `https://youtu.be/${ID}`, `https://youtu.be/${ID}?t=42`, `https://www.youtube.com/watch?v=${ID}`, `https://www.youtube.com/watch?v=${ID}&list=PL123&t=10s`,
    `youtube.com/watch?v=${ID}`, `https://m.youtube.com/watch?v=${ID}`, `https://music.youtube.com/watch?v=${ID}&feature=share`, `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`, `https://www.youtube.com/live/${ID}?si=abc`, `  https://youtu.be/${ID}  `]) assert.equal(youtubeId(u), ID, u);
  for (const u of ['', '   ', 'hello', 'https://example.com/watch?v=' + ID, 'https://youtu.be/short', 'https://www.youtube.com/watch?v=tooshort', 'https://www.youtube.com/channel/abc',
    'https://www.youtube.com/watch', 'https://notyoutube.com/' + ID, 'javascript:alert(1)']) assert.equal(youtubeId(u), null, u);
});

test('DJ 기계에 닿는 자리: 탁자의 사방 여섯 칸이고 걸어서 갈 수 있다. 규칙에 든 좌표와 같다', async () => {
  const { buildClubMap, CLUB_DJ_SPOTS, CLUB_DJ_DECK, djDeckFor, O_DJ, objectAt, isWalkable } = await import('../src/game/map.ts');
  const club = buildClubMap();
  for (const d of CLUB_DJ_DECK) assert.equal(objectAt(club, d.x, d.y), O_DJ);
  // 탁자에 맞닿은, 걸을 수 있는 칸 전부가 그 자리다 (2026-11-20 밤: 사방. 전에는 뒤의 두 칸뿐이었다)
  const around = new Set();
  for (const d of CLUB_DJ_DECK) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isWalkable(club, d.x + dx, d.y + dy)) around.add(`${d.x + dx},${d.y + dy}`);
  assert.deepEqual([...around].sort(), CLUB_DJ_SPOTS.map((q) => `${q.x},${q.y}`).sort());
  assert.equal(CLUB_DJ_SPOTS.length, 6);
  for (const q of CLUB_DJ_SPOTS) { const d = djDeckFor(q.x, q.y); assert.ok(d && objectAt(club, d.x, d.y) === O_DJ, `(${q.x},${q.y}) 에서 닿는 탁자`); }
  assert.equal(djDeckFor(5, 8), null);
  // 시작 자리에서 걸어서 닿는다
  const seen = new Set([`${club.spawn.x},${club.spawn.y}`]), todo = [[club.spawn.x, club.spawn.y]];
  while (todo.length) { const [x, y] = todo.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = `${x + dx},${y + dy}`; if (!seen.has(k) && isWalkable(club, x + dx, y + dy)) { seen.add(k); todo.push([x + dx, y + dy]); } } }
  for (const q of CLUB_DJ_SPOTS) assert.ok(seen.has(`${q.x},${q.y}`), `DJ 기계 옆 (${q.x},${q.y})`);
  // 규칙의 좌표: 예약 쓰기에서 자리 조건을 떼어 내 그대로 계산해 본다
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules.club;
  const w = rules.q.$k['.write'];
  // 자리 조건은 "마와폰이 있거나 (클럽의 DJ 기계 옆)" 의 뒤쪽이다 (2026-11-24): 괄호 둘이 더 닫힌 뒤에 삭제 쪽 조건이 온다
  assert.ok(w.includes("(root.child('users/' + auth.uid + '/own/mawaphone').val() === true || (root.child('players/' + auth.uid + '/m').val() == 'club' && "), '마와폰이 있으면 어디서나 예약');
  assert.ok(rules.dj['.write'].includes("(root.child('players/' + auth.uid + '/m').val() == 'club' || root.child('users/' + auth.uid + '/own/mawaphone').val() === true) && "), '마와폰이 있으면 어디서나 다음 곡으로');
  const from = w.indexOf("root.child('players/' + auth.uid + '/m').val() == 'club'"), to = w.indexOf('))) : (');
  assert.ok(from > 0 && to > from, '예약 쓰기의 자리 조건');
  const expr = w.slice(from, to).replaceAll("root.child('players/' + auth.uid + '/m').val()", 'm').replaceAll("root.child('players/' + auth.uid + '/x').val()", 'x').replaceAll("root.child('players/' + auth.uid + '/y').val()", 'y');
  const at = new Function('m', 'x', 'y', `return ${expr};`);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 22; x++) assert.equal(at('club', x, y), CLUB_DJ_SPOTS.some((q) => q.x === x && q.y === y), `(${x},${y})`);
  assert.equal(at('main', 10, 1), false, '다른 맵의 같은 좌표');
  assert.ok(rules.dj['.validate'].includes("newData.child('at').val() == now") && rules.q.$k.v['.validate'].includes('matches(/^[A-Za-z0-9_-]{11}$/)'));
});

// ---------- 클럽 노래 예약 (2026-11-20 밤) ----------
test('노래 예약: 우선 예약이 먼저, 그 안에서는 먼저 건 것부터 나온다. 낡은 예약은 뺀다', async () => {
  const Y = await import('../src/shared/youtube.ts');
  const now = 1_800_000_000_000;
  const raw = {
    a_0: { v: 'A', u: 'a', n: '가', at: now - 5000 }, b_0: { v: 'B', u: 'b', n: '나', at: now - 4000, p: 1 }, a_1: { v: 'C', u: 'a', n: '가', at: now - 3000, p: 1, t: '제목' },
    c_0: { v: 'D', u: 'c', n: '다', at: now - Y.DJ_Q_TTL_MS - 1 }, bad: { u: 'x' },
  };
  const list = Y.djOrder(raw, now);
  assert.deepEqual(list.map((e) => e.k), ['b_0', 'a_1', 'a_0']);
  assert.equal(list[1].t, '제목'); assert.equal(list[0].p, 1); assert.equal(list[2].p, undefined);
  assert.deepEqual(Y.djOrder(null, now), []);
  // 한 사람 열 곡: 열쇠가 {uid}_0 ~ {uid}_9 열 개뿐이다 (2026-11-23 에 두 곡 → 열 곡). 전체 20곡은 화면이 지킨다
  assert.equal(Y.DJ_MY_MAX, 10); assert.equal(Y.DJ_Q_MAX, 20);
  assert.equal(Y.djSlotKey('me', []), 'me_0');
  assert.equal(Y.djSlotKey('me', ['me_0', 'you_0', 'you_1']), 'me_1');
  assert.equal(Y.djSlotKey('me', ['me_1', 'me_0']), 'me_2');
  const all = [...Array(10).keys()].map((i) => `me_${i}`);
  assert.equal(Y.djSlotKey('me', all.filter((k) => k !== 'me_7')), 'me_7');
  assert.equal(Y.djSlotKey('me', all), null);
  // 제목
  assert.equal(Y.djCleanTitle('  가나\n다   라 '), '가나 다 라');
  assert.equal(Y.djCleanTitle('x'.repeat(200)).length, Y.DJ_TITLE_MAX);
  assert.equal(Y.djCleanTitle(undefined), ''); assert.equal(Y.djCleanTitle(123), '');
});

test('노래 예약: 규칙의 숫자가 화면의 숫자와 같고, 넘기는 쓰기는 한 번이다', async () => {
  const Y = await import('../src/shared/youtube.ts');
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const rules = JSON.parse(read('../database.rules.json')).rules.club;
  assert.equal(rules['.read'], 'auth != null', '지금 곡과 예약을 한 노드로 같이 읽는다');
  assert.ok(rules.q.$k['.write'].includes(`data.child('at').val() + ${Y.DJ_Q_TTL_MS}`), '낡은 예약');
  assert.ok(rules.dj['.write'].includes(`data.child('at').val() + ${Y.DJ_SKIP_MIN_MS}`), '남의 곡 넘기기');
  assert.ok(rules.dj.t['.validate'].includes(`<= ${Y.DJ_TITLE_MAX}`) && rules.q.$k.t['.validate'].includes(`<= ${Y.DJ_TITLE_MAX}`), '제목 길이');
  // 열쇠는 내 uid + '_' + 숫자 한 자리 (= DJ_MY_MAX 열 개). 우선 예약은 내 다른 열쇠 아홉 개에 하나도 없어야 한다
  assert.equal(Y.DJ_MY_MAX, 10, '규칙의 열쇠 모양(숫자 한 자리)과 같아야 한다');
  assert.ok(rules.q.$k['.write'].includes("$k.beginsWith(auth.uid + '_') && $k.length == auth.uid.length + 2 && $k.matches(/_[0-9]$/)"), '열쇠 모양');
  for (let i = 0; i < Y.DJ_MY_MAX; i++) assert.ok(rules.q.$k['.validate'].includes(`($k == auth.uid + '_${i}' || !newData.parent().child(auth.uid + '_${i}/p').exists())`), `우선 예약: 열쇠 _${i}`);
  assert.ok(!rules.q.$k['.validate'].includes(`auth.uid + '_${Y.DJ_MY_MAX}`), '그보다 많은 열쇠는 없다');
  const djSrc = read('../src/game/dj.ts');
  assert.ok(djSrc.includes("if (this.queue.length >= DJ_Q_MAX) return 'qfull';"), '전체 한도는 화면이 지킨다');
  // 두더지 창: 정리(키 입력 되살리기)는 닫는 길이 모두 거치는 onClose 로 넘긴다 (2026-11-23: Esc·바깥 누르기로 닫으면 키가 안 먹던 일)
  const mole = read('../src/game/moleui.ts');
  assert.ok(mole.includes("modal('🕹 두더지 잡기', body, [], false, cleanup)") && !mole.includes('m.close ='), '두더지 창의 정리');
  assert.ok(rules.dj['.validate'].includes("!newData.parent().child('q/' + newData.child('k').val()).exists()"), '올린 예약은 같은 쓰기에서 빠져야 한다');
  const dj = read('../src/game/dj.ts');
  assert.ok(dj.includes("await update(ref(db), { 'club/dj': { v: head.v, at: serverTimestamp(), u: head.u, n: head.n, k: head.k, ...(head.t ? { t: head.t } : {}) }, [`club/q/${head.k}`]: null });"), '올리기와 예약 지우기를 한 번에');
  assert.ok(dj.includes("onValue(ref(db, 'club'), (s) => {"), '지금 곡과 예약을 같이 받는다 (따로 받으면 예약만 먼저 와서 잘못 넘긴다)');
  const world = read('../src/game/world.ts');
  assert.ok(world.includes('onEnded: (song) => this.dj.ended(song)'), '끝난 곡은 누구 화면이든 넘긴다');
  assert.deepEqual([...Y.DJ_DEAD_CODES], [100, 101, 150], '없는 영상·막힌 영상만 스스로 넘긴다 (기기 탓인 오류로 남의 곡을 넘기지 않는다)');
});

// ---------- 2026-11-23 건의: 낚시 대회 상금·참가상·메달, 눈 오는 날 한정 채집 ----------
test('낚시 대회: 상금·참가상 계산과 순위 순서, 규칙의 숫자가 같다', async () => {
  const c = await import('../src/shared/contest.ts');
  assert.deepEqual([...c.CONTEST_PRIZES], [30000, 20000, 10000]); // 사용자가 정한 금액 (2026-11-23)
  assert.deepEqual([c.CONTEST_JOIN_MIN, c.CONTEST_JOIN_PRIZE], [100, 5000]);
  assert.ok(/^\d{8}$/.test(c.CONTEST_PRIZE_FROM) && c.CONTEST_PRIZE_FROM > '20261123', '이 기능을 넣기 전에 끝난 대회에는 주지 않는다 (사용자가 정하면 내린다)');
  // 1~3등은 순위 상금, 100마리 이상이면 참가상을 더 받는다. 순위 밖이고 100마리가 안 되면 없다
  assert.deepEqual([c.contestPrize(0, 400), c.contestPrize(1, 99), c.contestPrize(2, 100), c.contestPrize(-1, 100), c.contestPrize(-1, 99), c.contestPrize(3, 500)], [35000, 20000, 15000, 5000, 0, 5000]);
  // 순위: 점수 → 마릿수 → 먼저 닿은 사람. 결과 칸은 참가자가 아니다
  const rows = c.contestRows({ a: { n: 'A', p: 10, c: 5, at: 9 }, b: { n: 'B', p: 30, c: 1, at: 5 }, d: { n: 'D', p: 10, c: 7, at: 9 }, e: { n: 'E', p: 10, c: 7, at: 3 }, result: { at: 1, top: [] } });
  assert.deepEqual(rows.map((r) => r.u), ['b', 'e', 'd', 'a']);
  assert.deepEqual(c.contestRows(null), []);
  // 메달: 결과를 읽었으면 1~3등, 아직이면 챔피언 칸의 1등만
  assert.deepEqual(['x', 'y', 'z', 'w'].map((u) => c.contestMedal(u, 'x', ['x', 'y', 'z'])), ['🏆', '🥈', '🥉', '']);
  assert.deepEqual(['x', 'y'].map((u) => c.contestMedal(u, 'x', null)), ['🏆', '']);
  // 규칙 (fish/cprize, 손으로 넣은 줄)의 금액·마릿수가 같은 값이다
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const rules = read('../database.rules.json');
  const line = rules.slice(rules.indexOf('"cprize"'), rules.indexOf('"best"'));
  assert.ok(line.includes("top/0/u').val() == $uid ? 30000") && line.includes("top/1/u').val() == $uid ? 20000") && line.includes("top/2/u').val() == $uid ? 10000"), '순위 상금');
  assert.ok(line.includes("'/c').val() >= 100 ? 5000 : 0"), '참가상');
  assert.ok(line.includes('!data.exists() && newData.exists()'), '한 번만 받는다 (지울 수도 없다)');
  // 화면: 상금은 지갑과 받았다는 표시를 쓰기 한 번에, 이름표의 메달은 1~3등
  assert.ok(read('../src/game/wallet.ts').includes('[`${W}/c`]: increment(amount), [`${W}/e`]: increment(amount), [`fish/cprize/${key}/${uid}`]: amount'));
  assert.ok(read('../src/game/world.ts').includes('const m = this.contest.medal(uid) + this.weekTop.marks(uid);'));
  const mgr = read('../src/game/contest.ts');
  assert.ok(mgr.includes('get(ref(db, `fish/contest/${win.key}/${uid}/c`))'), '마릿수는 받기 직전에 다시 읽는다');
  assert.ok(mgr.includes('if (win.key < CONTEST_PRIZE_FROM || this.claiming.has(win.key)) return;'), '시작 날짜 앞의 대회는 건너뛴다');
  assert.equal((mgr.match(/void this\.claim\(win, /g) || []).length, 3, '결과를 알게 되는 세 길 모두에서 받는다');
});

test('눈 오는 날 한정 채집: 눈이 올 때만 풀에 들어오고, 규칙이 그 시간대를 받는다', async () => {
  const { timeActive, DEF_TIMES, TIME_LABEL } = await import('../src/shared/collection.ts');
  const { DEFAULT_BUGS, bugColl } = await import('../src/shared/bugs.ts');
  const at = new Date(2026, 10, 23, 15, 0, 0);
  assert.deepEqual([timeActive('snow', at), timeActive('snow', at, false, true), timeActive('snow', at, false, true, true)], [false, false, true]);
  assert.equal(timeActive('rain', at, false, true, true), true, '비 한정은 눈이 올 때도 나온다');
  assert.ok(TIME_LABEL.snow && DEF_TIMES.includes('snow'));
  const snow = DEFAULT_BUGS.filter((f) => f.time === 'snow');
  assert.deepEqual(snow.map((f) => [f.id, f.rarity]), [['snowsled', 1], ['snowdeer', 3], ['snowsanta', 4]]); // 건의대로: 썰매 희귀 · 루돌프 전설 · 산타 신화
  // 가중치는 같은 등급의 기존 종을 넘지 않는다 (호랑나비 6 · 황금 무당벌레 0.5 · 요정 0.002)
  const w = (id) => DEFAULT_BUGS.find((f) => f.id === id).w;
  assert.ok(w('snowsled') <= w('swallowtail') && w('snowdeer') <= w('goldbug') && w('snowsanta') <= w('fairy'));
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 4000; i++) assert.notEqual(bugColl.pick(rnd, at, { rain: true }).time, 'snow', '눈이 아니면 나오지 않는다');
  let got = 0; for (let i = 0; i < 4000; i++) if (bugColl.pick(rnd, at, { rain: true, snow: true }).time === 'snow') got++;
  assert.ok(got > 50, '눈이 오면 나온다');
  // 화면: 벌레를 뽑을 때 날씨를 넘긴다. 눈 = 눈 오는 철의 비
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.ok(read('../src/game/bugs.ts').includes('bugColl.pick(undefined, undefined, { rain: this.w.raining(), snow: this.w.snowing() })'));
  assert.ok(read('../src/game/world.ts').includes('snowing(): boolean { return this.raining() && snowSeason(serverNow()); }'));
  // 규칙: 곤충 목록의 시간대에 snow 가 있다 (없으면 관리자 화면의 첫 저장이 통째로 거부된다: 2026-11-05 에 겪은 일)
  const rules = read('../database.rules.json');
  const times = [...rules.matchAll(/"time": \{ "\.validate": "([^"]+)" \}/g)].map((m) => m[1]);
  assert.equal(times.length, 2);
  for (const t of DEF_TIMES) assert.ok(times[0].includes(`'${t}'`), `물고기 ${t}`);
  for (const t of DEFAULT_BUGS.map((f) => f.time).filter(Boolean)) assert.ok(times[1].includes(`'${t}'`), `곤충 ${t}`);
});

// ---------- 2026-11-23 건의·제보: 이름표 효과는 닉네임에만 · 별가루는 밤에 빛난다 · 찌를 기다리는 중의 F ----------
test('이름표: 닉네임 앞뒤의 표시는 따로 넘기고, 이름표 효과는 닉네임에만 입힌다', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const world = read('../src/game/world.ts'), render = read('../src/game/render.ts');
  // 표시(🏆 · 🐟3 · 💥 …)를 닉네임 글자열에 붙이지 않는다
  assert.ok(world.includes('nick: this.profile.nick, nickPost:') && world.includes('nick: rp.st.n, nickPost:'), '닉네임만 nick 에');
  assert.ok(world.includes("nickPre: (iGhost ? '👻 ' : '') + this.nickMarks(this.uid)") && world.includes("nickPre: (ghost ? '👻 ' : '') + this.nickMarks(rp.uid)"), '앞 표시');
  // 그리는 쪽: 흐르는 빛깔의 폭은 닉네임만큼, 표시는 기본 빛깔
  assert.ok(render.includes('side?: { pre: string; post: string; color: string }'), 'drawLabel 의 side');
  assert.ok(render.includes('labelFlow(ctx, color, tx - 4, tx + wText + 4, performance.now())'), '흐르는 빛깔은 닉네임 폭');
  assert.ok(render.includes("color: e.isMe ? '#ffe9a8' : '#ffffff' } : undefined;"), '표시는 기본 빛깔');
});

test('별가루: 낮밤 덧칠 뒤에 한 번 더 얹는다 (밤에 어두워지지 않게)', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const cos = read('../src/game/cosmetics.ts'), render = read('../src/game/render.ts');
  assert.ok(/export function drawFxGlow\([^)]*lamp: number\): void \{\s*if \(lamp <= 0\.02\) return;/.test(cos), '낮에는 아무것도 하지 않는다');
  assert.ok(cos.includes("if (p.kind !== 'stardust') continue;"), '별가루만');
  assert.ok(/drawNight\(eng, map, vis, st\.night, st\.fires, xmasLights\); drawFxGlow\(ctx, st\.now, eng\.cam\.x, eng\.cam\.y, eng\.scale \* eng\.dpr, st\.night\.lamp\);/.test(render), '덧칠 바로 뒤');
});

test('낚시: 찌를 기다리는 중에 옆에 벌레가 있으면 F 는 벌레를 잡는다 (입질이 오면 당기기)', () => {
  const world = readFileSync(new URL('../src/game/world.ts', import.meta.url), 'utf8');
  const i = world.indexOf("if (bug && !fv.bite) return { x: bug.x, y: bug.y, text: 'F 채집', kind: 'bug' };");
  const j = world.indexOf("text: fv.bite ? 'F 당겨!' : '찌를 기다리는 중… (이동하면 취소)', kind: 'fishing' }");
  assert.ok(i > 0 && j > i, '벌레가 낚시 안내보다 먼저');
  assert.ok(world.indexOf('if (fv.auto) return null;') < i, '자동 낚시 중에는 그대로 (안내 없음)');
});

// ---------- 포커 판: 테이블 상자의 높이 (2026-11-23 제보: 1번 테이블에서 판이 돌면 2번 테이블의 단추가 오르내렸다) ----------
test('포커 판: 테이블 상자의 높이를 붙박는다 (위 테이블의 상태가 바뀌어도 아래 테이블이 밀리지 않게)', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const css = read('../src/styles.css'), ui = read('../src/game/pokerui.ts');
  // 보통 상태의 높이는 CSS 가, 그보다 커진 높이는 화면이 --pt-min 으로 넘긴다. 둘 중 큰 쪽이 쓰인다 (min-height 를 직접 적으면 CSS 의 더 큰 값을 이겨 버린다)
  assert.ok(/#casino\.poker \.ptable \{[^}]*min-height: max\(224px, var\(--pt-min, 0px\)\)/.test(css), 'PC');
  assert.ok(/body\.mobile #casino\.poker \.ptable \{ min-height: max\(241px, var\(--pt-min, 0px\)\)/.test(css), '폰');
  assert.ok(ui.includes("b.style.setProperty('--pt-min', `${this.minH[i]}px`)") && !ui.includes('style.minHeight'), '높이는 --pt-min 으로 넘긴다');
  assert.ok(ui.includes('this.minH[i] = Math.max(this.minH[i] || 0, b.offsetHeight)'), '커지기만 하고 줄지 않는다');
  assert.ok(ui.includes('this.minH = [];'), '판을 다시 열면 처음부터 잰다');
});

// ---------- 로그인: 프로필을 "못 읽은 것"과 "없는 것" (2026-11-23) ----------
test('로그인: 프로필 읽기가 실패하면 로그인 계정을 지우지 않는다 (읽기가 됐고 없을 때만 껍데기를 지운다)', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const main = read('../src/main.ts'), authSrc = read('../src/firebase/auth.ts');
  assert.ok(!/loadProfile\(uid\)\.catch\(/.test(main), '읽기 실패를 "없음"으로 바꾸지 않는다');
  assert.ok(/try \{ profile = await loadProfile\(uid\); \}\s*catch \(e\) \{[\s\S]*?return;\s*\}\s*if \(!profile\) \{[\s\S]*?await dropOrphanAccount\(uid\);/.test(main), '실패하면 안내하고 끝낸다. 지우는 것은 읽기가 됐고 없을 때만');
  assert.equal(main.split('dropOrphanAccount(').length - 1, 1, '계정을 지우는 곳은 한 군데');
  assert.ok(authSrc.includes('if (!user || user.uid !== uid) return;'), '프로필이 없다고 확인한 그 계정만 지운다');
});

// ---------- 클럽 영상의 자막 (2026-11-23, 사용자 요청: 자막은 꺼진 채로 나오게) ----------
test('클럽 영상: 자막은 꺼 둔다 (준비됐을 때·자막 모듈이 실렸을 때·재생이 시작됐을 때)', () => {
  const ui = readFileSync(new URL('../src/game/djui.ts', import.meta.url), 'utf8');
  assert.ok(ui.includes("p.setOption('captions', 'track', {})"), '자막 모듈에 트랙 없음을 넣는다');
  assert.ok(ui.includes('this.ready = true; this.volume(); this.captionsOff();'), '준비됐을 때');
  assert.ok(ui.includes('onApiChange: () => this.captionsOff()'), '자막 모듈이 실렸을 때 (영상이 바뀔 때마다)');
  assert.ok(ui.includes('if (e.data === 1) this.captionsOff();'), '재생이 시작됐을 때');
  assert.ok(ui.includes('controls: 0'), '조작 줄은 숨긴 채다 (그래서 보는 사람이 자막을 끌 수 없다)');
  assert.ok(!/cc_load_policy\s*:/.test(ui), '자막을 켜는 설정은 넣지 않는다 (주석에서 말하는 것은 괜찮다)');
});

// ---------- 소모품 한도 안내 (2026-11-23 제보: 미끼 999개에서 더 사려 하면 "코인이 모자랍니다"가 떴다) ----------
test('상점: 999개 한도에 걸린 구매는 코인 부족이 아니라 한도라고 알린다 (미끼·강화 주문서)', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const shop = read('../src/game/shopui.ts'), gen = read('../tools/gen-rules.cjs');
  // 한도는 지갑 규칙의 숫자와 같아야 한다
  assert.ok(gen.includes("child('bait', 'newData.isNumber() && newData.val() >= 0 && newData.val() <= 999')"), '규칙: 미끼 999');
  assert.ok(gen.includes("child('es', 'newData.isNumber() && newData.val() >= 0 && newData.val() <= 999')"), '규칙: 주문서 999');
  assert.ok(shop.includes('if (h.wallet.bait + n > 999) { h.toast(`미끼는 999개까지 가질 수 있어요.'), '미끼: 한도를 먼저 본다');
  assert.equal(shop.split('if (h.wallet.scrolls + n > 999) { h.toast(`강화 주문서는 999장까지 가질 수 있어요.').length - 1, 2, '주문서: 두 곳(명품·킹) 모두');
  // 구매가 거부됐을 때 코인이 충분하면 "코인이 모자랍니다"라고 하지 않는다
  assert.ok(!/buyBait\(bPrice, n\)\) h\.toast\([^;]*\); else h\.toast\('코인이 모자랍니다\.'/.test(shop), '미끼 실패 안내');
  assert.ok(!/buyScrolls\(sp, n\)\) h\.toast\([^;]*\); else h\.toast\('코인이 모자랍니다\.'/.test(shop), '주문서 실패 안내');
});

// ---------- 2026-11-20 묶음 (v43) ----------
const RULES43 = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules;

test('마피아 사보타지: 안개·불의 상태와 시간, 불이 나는 자리, 규칙의 숫자', async () => {
  const M = await import('../src/shared/mafia.ts');
  const t = 1_000_000_000_000;
  assert.equal(M.sabState(null, t), 'none');
  assert.equal(M.sabState({ k: 1, at: t }, t + M.FOG_MS - 1), 'fog');
  assert.equal(M.sabState({ k: 1, at: t }, t + M.FOG_MS), 'none');
  assert.equal(M.sabState({ k: 2, at: t }, t + M.FIRE_MS - 1), 'fire');
  assert.equal(M.sabState({ k: 2, at: t }, t + M.FIRE_MS), 'lost', '제때 못 끄면 마피아 승리');
  assert.equal(M.sabState({ k: 2, at: t, a: true }, t + 1000), 'fire', '한 곳만 꺼서는 안 끝난다');
  assert.equal(M.sabState({ k: 2, at: t, a: true, b: true }, t + M.FIRE_MS + 5000), 'none', '둘 다 끄면 끝');
  assert.equal(M.sabState({ k: 2, at: t, x: true }, t + M.FIRE_MS + 5000), 'none', '회의가 열리면 풀린다');
  const ids = new Set(M.TASK_DEFS.map((d) => d.id)), at = (id) => M.TASK_DEFS.find((d) => d.id === id).at;
  for (let i = 0; i < 20; i++) {
    const [a, b] = M.firePair(t + i * 7919);
    assert.ok(ids.has(a) && ids.has(b) && a !== b);
    assert.ok(Math.abs(at(a)[0] - at(b)[0]) + Math.abs(at(a)[1] - at(b)[1]) >= 25, `${a}·${b} 는 서로 멀다`);
  }
  assert.ok(M.FIRE_CD_MS > M.FIRE_MS && M.FOG_CD_MS > M.FOG_MS, '걸려 있는 동안에는 또 못 건다');
  const w = RULES43.mafia.sab['.write'];
  assert.ok(w.includes(`(data.child('k').val() == 2 ? ${M.FIRE_CD_MS} : ${M.FOG_CD_MS})`) && w.includes(`root.child('mafia/game/at').val() + ${M.FIRE_AFTER_MS} <= now`));
  assert.ok(RULES43.mafia.roles.$uid['.read'].includes("root.child('mafia/roles/' + auth.uid).val() == 'm'"), '마피아는 동료를 알아볼 수 있다');
});

test('모닥불·눈사람·사진: 상수가 규칙의 숫자와 같다', async () => {
  const C = await import('../src/shared/campfire.ts'), H = await import('../src/shared/home.ts'), S = await import('../src/shared/shop.ts');
  const fw = RULES43.fires.$map.$pos['.write'];
  assert.ok(fw.includes(`data.child('at').val() + ${C.CAMPFIRE_MS} <= now`) && fw.includes(`/w').val() - ${C.CAMPFIRE_WOOD})`) && fw.includes(`/own/${C.CAMPFIRE_ID}')`));
  assert.equal(S.itemById(C.CAMPFIRE_ID)?.price, C.CAMPFIRE_PRICE);
  assert.deepEqual(C.fireXY(C.fireKey(12, 7)), { x: 12, y: 7 });
  assert.equal(C.fireXY('a_b'), null);
  assert.equal(C.fireBurning({ u: 'x', at: 1000 }, 1000 + C.CAMPFIRE_MS - 1), true);
  assert.equal(C.fireBurning({ u: 'x', at: 1000 }, 1000 + C.CAMPFIRE_MS), false);
  // 눈사람 (game/snowmen.ts 의 숫자는 화면 모듈이라 글자로 본다)
  const sn = readFileSync(new URL('../src/game/snowmen.ts', import.meta.url), 'utf8');
  assert.ok(/SNOWMAN_OWN_MAX = 3;/.test(sn) && /SNOWMAN_MS = 60 \* 60 \* 1000;/.test(sn));
  assert.ok(RULES43.winter.sm.$pos['.write'].includes("data.child('at').val() + 3600000 <= now"));
  // 사진 액자
  assert.ok(H.PHOTO_MAX_CHARS < H.PHOTO_RULE_CHARS);
  assert.ok(RULES43.homepic.$uid.$slot['.validate'].includes(`length <= ${H.PHOTO_RULE_CHARS}`));
  for (const f of H.PHOTO_FRAMES) { assert.ok(S.itemById(f.item), f.item); assert.ok(RULES43.homes.$uid.ph.$slot['.validate'].includes(`newData.child('k').val() == ${f.k}`)); }
  assert.equal(H.vaultOf({ vc: 1234.9 }), 1234);
  assert.equal(H.vaultOf({}), 0);
  assert.ok(RULES43.homes.$uid.vc['.validate'].includes("root.child('wallet/' + $uid + '/c').val() - newData.parent().parent().parent().child('wallet/' + $uid + '/c').val()"), '금고가 는 만큼 지갑이 줄어야 한다');
});

test('펫 꾸미기: 품목·이름 다듬기, 바깥 게임 오락기', async () => {
  const S = await import('../src/shared/shop.ts'), L = await import('../src/shared/links.ts');
  const ids = [...S.PET_HATS, ...S.PET_GLASSES].map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) { assert.ok(S.itemById(id), id); assert.equal(S.isOwnItem(id), true); assert.ok(!S.PET_IDS.includes(id)); }
  assert.equal(S.EQUIP_KEY.pethat, 'ph'); assert.equal(S.EQUIP_KEY.petglass, 'pg');
  assert.equal(S.isOwnItem(S.PET_NAME_FEE.id), false, '이름 짓기는 소모품 결제');
  assert.equal(S.cleanPetName('  멍멍이  '), '멍멍이');
  assert.equal(S.cleanPetName('<b>나</b>'), 'b나/b');
  assert.equal([...S.cleanPetName('가나다라마바사아자차카')].length, S.PET_NAME_MAX);
  assert.equal(S.cleanPetName(null), '');
  for (const g of Object.values(L.GAME_LINKS)) assert.ok(/^https:\/\//.test(g.url) && g.name && g.hint);
  assert.equal(L.gameLinkOf('zoo')?.url, 'https://zooescape.web.app/');
  assert.equal(L.gameLinkOf('nope'), null);
  const { buildDefaultMap, O, O_ARCADE_ZOO, objectAt, validateZone, isWalkable } = await import('../src/game/map.ts');
  const m = buildDefaultMap();
  const mole = m.zones.find((z) => z.kind === 'arcade'), zoo = m.zones.find((z) => z.kind === 'link');
  assert.ok(mole && zoo && validateZone(zoo));
  assert.equal(objectAt(m, zoo.x, zoo.y), O_ARCADE_ZOO);
  assert.ok(Math.abs(zoo.x - mole.x) === 1 && zoo.y === mole.y, '두더지 오락기 바로 옆');
  assert.ok(!Object.values(O).includes(O_ARCADE_ZOO), '편집기 팔레트에는 없다');
  assert.ok(L.gameLinkOf(zoo.id));
  assert.equal(isWalkable(m, zoo.x, zoo.y + 1), true, '앞에 설 수 있다');
});

test('겨울 놀이: 서버의 눈사람 목록으로 맞추면 길을 막고, 다시 채우기는 내 눈사람만 센다', async () => {
  const { WinterPlay, MAX_SNOWMEN, SNOW_SEEDS } = await import('../src/game/winterplay.ts');
  const { buildWinterMap } = await import('../src/game/map.ts');
  const p = new WinterPlay(buildWinterMap());
  const [sx, sy] = SNOW_SEEDS[0];
  assert.equal(p.toyAt(sx, sy), true, '시작 눈덩이');
  p.setMen([{ x: sx, y: sy }, { x: 3, y: 22 }], 0);
  assert.equal(p.views().filter((v) => v.kind === 'man').length, 2);
  assert.equal(p.views().some((v) => v.kind === 'ball' && v.x === sx && v.y === sy), false, '눈사람이 선 칸의 눈덩이는 치운다');
  assert.equal(p.toyAt(3, 22), true);
  assert.ok(p.manAhead(3, 23, 3), '남이 세운 눈사람도 앞에서 보인다');
  p.setMen(Array.from({ length: MAX_SNOWMEN + 2 }, (_, i) => ({ x: 3 + i, y: 22 })), 1);
  assert.equal(p.views().filter((v) => v.kind === 'man').length, MAX_SNOWMEN + 2, '남의 눈사람이 많아도 다 보인다');
  p.setMen([], 0);
  assert.equal(p.toyAt(3, 22), false, '녹으면 사라진다');
});

// ---------- 클럽 DJ 창 (2026-11-20): 크기 계산, 끝난 영상 판정 ----------
test('DJ 창: 크기는 16:9 를 지키되 200×200 아래로는 안 내려가고 화면을 넘지 않는다', async () => {
  const Y = await import('../src/shared/youtube.ts');
  assert.equal(Y.djFrameHeight(200), 200, '가장 작을 때는 정사각형 (약관의 최소 크기)');
  assert.equal(Y.djFrameHeight(640), 360);
  assert.equal(Y.djClampWidth(50, 1280, 720, 30), Y.DJ_MIN_EDGE);
  assert.equal(Y.djClampWidth(5000, 1280, 720, 30), Math.floor(((720 - 30 - 24) * 16) / 9), '높이가 화면에 들어가는 만큼만');
  assert.equal(Y.djClampWidth(5000, 375, 812, 30), 375 - 16 - Y.DJ_PAD, '폰에서는 화면 너비까지');
  assert.equal(Y.djClampWidth(400, 1280, 720, 30), 400);
  for (const w of [200, 333, 640, 1000]) assert.ok(Y.djFrameHeight(Y.djClampWidth(w, 1280, 720, 30)) + 30 + 24 <= 720 || Y.djClampWidth(w, 1280, 720, 30) === Y.DJ_MIN_EDGE);
});

test('DJ 창: 끝난 영상은 다시 틀지 않고 끈다 (광고가 끝난 것과는 가른다)', async () => {
  const Y = await import('../src/shared/youtube.ts');
  assert.equal(Y.djEnded(100, 200, 100, false), false, '재생 중');
  assert.equal(Y.djEnded(200, 200, 199, false), true, '튼 뒤 길이만큼 지났다');
  assert.equal(Y.djEnded(197, 200, 200, true), true, '조금 앞서 끝난 플레이어: 다시 틀지 않는다 (첫 부분이 되풀이되던 버그)');
  assert.equal(Y.djEnded(10, 200, 0, true), false, '영상 앞 광고가 끝났을 뿐');
  assert.equal(Y.djEnded(500, 0, 0, true), false, '길이를 아직 모른다');
  assert.equal(Y.sameSong({ v: 'a', at: 1000 }, { v: 'a', at: 2400 }), true);
  assert.equal(Y.sameSong({ v: 'a', at: 1000 }, { v: 'a', at: 9000 }), false, '같은 영상을 다시 튼 것은 새 노래');
  assert.equal(Y.sameSong({ v: 'a', at: 1000 }, { v: 'b', at: 1000 }), false);
  assert.equal(Y.sameSong(null, { v: 'a', at: 1 }), false);
});

// ---------- 2026-11-20 저녁 (v45): 탁자 옆 의자, 클럽 좌석, 포탈 정원 벤치 ----------
test('탁자 옆 의자는 탁자를 본다: 왼쪽 의자는 오른쪽을, 오른쪽 의자는 왼쪽을, 탁자 아래 의자는 뒤를', async () => {
  const { emptyMap, faceChairs, O, buildPortalGarden } = await import('../src/game/map.ts');
  const m = emptyMap('t', 't', 7, 5);
  const set = (x, y, o) => { m.objects[y * m.w + x] = o; };
  set(3, 2, O.TABLE); set(2, 2, O.CHAIR); set(4, 2, O.CHAIR); set(3, 1, O.CHAIR); set(3, 3, O.CHAIR); set(6, 4, O.CHAIR); set(0, 0, O.BENCH);
  faceChairs(m);
  const d = (x, y) => m.dirs?.[y * m.w + x];
  assert.equal(d(2, 2), 2, '왼쪽 의자는 오른쪽(탁자)을 본다');
  assert.equal(d(4, 2), 1, '오른쪽 의자는 왼쪽을 본다');
  assert.equal(d(3, 3), 3, '탁자 아래 의자는 뒤(탁자)를 본다');
  assert.equal(d(3, 1), undefined, '탁자 위 의자는 원래대로 앞을 본다');
  assert.equal(d(6, 4), undefined, '탁자가 없으면 그대로');
  assert.equal(d(0, 0), undefined, '벤치는 돌리지 않는다');
  m.dirs[2 * m.w + 2] = 3; faceChairs(m);
  assert.equal(d(2, 2), 3, '따로 정한 방향은 건드리지 않는다');
  const g = buildPortalGarden(); faceChairs(g);
  assert.equal(g.dirs?.[5 * g.w + 4], 2); assert.equal(g.dirs?.[5 * g.w + 6], 1);
});

test('클럽 좌석: 4인석·2인석이 고루 있고, 모든 의자가 탁자를 보며, 옆 길에서 앉을 수 있다', async () => {
  const { buildClubMap, CLUB_SEATS, CLUB_FLOOR, faceChairs, O, objectAt, isWalkable } = await import('../src/game/map.ts');
  const m = buildClubMap(); faceChairs(m);
  assert.ok(CLUB_SEATS.filter((s) => s.n === 4).length >= 2 && CLUB_SEATS.filter((s) => s.n === 2).length >= 2);
  let chairs = 0;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    if (objectAt(m, x, y) !== O.CHAIR) continue;
    chairs++;
    const dir = m.dirs?.[y * m.w + x];
    assert.ok(dir === 1 || dir === 2, `(${x},${y}) 의자가 옆의 탁자를 본다`);
    const tx = x + (dir === 2 ? 1 : -1), o = objectAt(m, tx, y);
    assert.ok(o === O.TABLE || o === O.TABLE_ROUND, `(${x},${y}) 앞이 탁자`);
    assert.equal(isWalkable(m, x + (dir === 2 ? -1 : 1), y), true, `(${x},${y}) 의자 뒤가 지나다니는 길`);
    assert.ok(x < CLUB_FLOOR.x || x >= CLUB_FLOOR.x + CLUB_FLOOR.w, '춤추는 바닥 밖');
  }
  assert.equal(chairs, CLUB_SEATS.reduce((t, s) => t + s.n, 0));
  // 좌석을 놓아도 시작 자리에서 양쪽 길 끝까지 걸어갈 수 있다
  const seen = new Set([`${m.spawn.x},${m.spawn.y}`]), q = [[m.spawn.x, m.spawn.y]];
  while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = `${x + dx},${y + dy}`; if (!seen.has(k) && isWalkable(m, x + dx, y + dy)) { seen.add(k); q.push([x + dx, y + dy]); } } }
  for (const [x, y] of [[1, 4], [1, 12], [5, 4], [20, 6], [20, 13], [16, 12]]) assert.ok(seen.has(`${x},${y}`), `(${x},${y}) 까지 갈 수 있다`);
});

test('포탈 정원: 연못 위쪽 한 줄이 전부 벤치이고, 그 북쪽에서 앉으면 바로 앞이 물이다', async () => {
  const { buildPortalGarden, O, objectAt, isWalkable, isWater } = await import('../src/game/map.ts');
  const g = buildPortalGarden();
  for (let x = 14; x <= 20; x++) {
    assert.equal(objectAt(g, x, 3), O.BENCH, `(${x},3) 벤치`);
    assert.equal(isWater(g, x, 4), true, '벤치 앞(아래)이 물');
    assert.equal(isWalkable(g, x, 2), true, '벤치 뒤(북쪽)에 설 수 있다');
  }
});

// ---------- 2026-11-20 사용량 검토 (v46) ----------
test('자주 나가는 지갑 쓰기(낚을 때·미끼·채광)는 트랜잭션이 아니라 바뀐 칸만 보낸다', () => {
  // 트랜잭션은 지갑 전체를 응답과 구독으로 두 번 내려받게 한다 (지갑 500B 면 한 번에 약 1KB). 소스에서 그 세 함수가 patch(update + increment)를 쓰는지 본다
  const src = readFileSync(new URL('../src/game/wallet.ts', import.meta.url), 'utf8');
  const body = (name) => { const i = src.indexOf(`\n  ${name}(`); assert.ok(i >= 0, name); return src.slice(i, src.indexOf('\n  }', i)); };
  for (const [name, field] of [['earn', 'c: increment(pts), e: increment(pts)'], ['takeBait', 'bait: increment(-1)'], ['mine', 'gn: increment(n), ga: serverTimestamp()']]) {
    const b = body(name);
    assert.ok(b.includes('this.patch(') && b.includes(field), `${name} 은 바뀐 칸만 보낸다`);
    assert.ok(!b.includes('this.tx('), `${name} 은 트랜잭션을 쓰지 않는다`);
  }
  assert.ok(/private patch\(fields[^)]*\)[^{]*\{\s*return update\(ref\(db, `wallet\/\$\{this\.w\.uid\}`\), fields\)/.test(src), 'patch 는 내 지갑에 update 한 번');
  assert.ok(body('takeBait').includes('<= 0'), '미끼가 없으면 보내지 않는다');
  assert.ok(body('mine').includes('goldMax('), '곡괭이 단계보다 많으면 보내지 않는다');
});

// ---------- 2026-11-20 빠따 제보·백그라운드 (v47) ----------
const { ServerClock, CLOCK_TOLERANCE_MS, CLOCK_STREAK, CLOCK_SPAN_MS } = await import('../src/shared/clock.ts');
const { batResultText, BAT_CHECK_MS, GUARD_BREAK_MS, guardBrokenOf } = await import('../src/shared/shop.ts');
const { whereLabel, MAP_INFO } = await import('../src/game/portal.ts');
const { LEAVE_NOTICE_MS, STALE_MS } = await import('../src/shared/config.ts');

// 기기 시계(wall)와 멈추지 않는 시계(mono)를 손으로 움직이는 가짜. real: 실제 서버 시각
function fakeClock() {
  const t = { real: 1_800_000_000_000, wall: 1_800_000_000_000, mono: 5000 };
  const c = new ServerClock(() => t.wall, () => t.mono);
  const pass = (ms) => { t.real += ms; t.wall += ms; t.mono += ms; };
  return { t, c, pass, err: () => c.now() - t.real };
}

test('서버 시각: 기기 시계가 뒤로 튀면(내 어림이 뒤처짐) 서버가 찍은 시각 하나로 바로 맞춘다', () => {
  // 제보된 화면: 어림이 274초 뒤처져 있어 방어 깨짐(gb = 어림 + 60초)이 남에게는 이미 지난 시각이었다
  const { t, c, pass, err } = fakeClock();
  t.wall -= 274_000;
  assert.equal(err(), -274_000);
  assert.ok(!guardBrokenOf({ gb: c.now() + GUARD_BREAK_MS }, t.real), '고치기 전: 맞은 표시가 남에게 안 보인다');
  pass(3000);
  assert.equal(c.sample(t.real - 120), true, '남의 하트비트 하나 (0.12초 전에 서버가 찍음)');
  assert.ok(Math.abs(err()) <= 200, `맞춘 뒤 어긋남 ${err()}ms`);
  assert.ok(guardBrokenOf({ gb: c.now() + GUARD_BREAK_MS }, t.real + 55_000), '맞춘 뒤: 55초 뒤에도 깨진 것으로 보인다');
  assert.ok(!guardBrokenOf({ gb: c.now() + GUARD_BREAK_MS }, t.real + 61_000), '61초 뒤에는 풀린다');
});

test('서버 시각: 기기 시계가 앞으로 튀면(내 어림이 앞섬) 연달아 여러 번 확인한 뒤에 맞춘다', () => {
  // 앞서 있으면 날아온 밀치기를 "4초 넘게 지난 것"으로 보고 버렸다 (보낸 사람의 빠따만 줄었다)
  const { t, c, pass, err } = fakeClock();
  t.wall += 1_450_000;
  assert.equal(c.sample(t.real - 100), false, '한 번으로는 안 맞춘다 (늦게 온 소식일 수도 있다)');
  pass(3000);
  assert.equal(c.sample(t.real - 300), false);
  assert.equal(err(), 1_450_000);
  pass(3000);
  assert.equal(c.sample(t.real - 80), true, `${CLOCK_STREAK}번째, ${CLOCK_SPAN_MS}ms 넘게 이어짐`);
  assert.equal(err(), -80, '가장 덜 어긋난 값으로 맞춘다 (그 소식이 오는 데 걸린 0.08초만큼만 남는다)');
});

test('서버 시각: 멈췄다 깨어난 화면에 밀린 소식이 한꺼번에 와도 시계를 건드리지 않는다', () => {
  const { t, c, pass, err } = fakeClock();
  for (const late of [40_000, 25_000, 12_000, 30_000]) assert.equal(c.sample(t.real - late), false, '한꺼번에 온 옛 소식'); // 같은 순간에 도착: 이어진 시간이 0
  assert.equal(err(), 0);
  pass(4000);
  assert.equal(c.sample(t.real - 90), false, '제때 온 소식이 하나 오면 처음부터 다시 센다');
  pass(4000);
  assert.equal(c.sample(t.real - 30_000), false);
  assert.equal(err(), 0);
});

test('서버 시각: 전달 지연 정도의 차이는 그냥 두고, 다시 연결하면 맞춘 값을 버린다', () => {
  const { t, c, pass, err } = fakeClock();
  for (const d of [-CLOCK_TOLERANCE_MS, -900, 0, 700, CLOCK_TOLERANCE_MS]) { assert.equal(c.sample(t.real + d), false); pass(2500); }
  assert.equal(c.fixed(), 0);
  t.wall -= 60_000; c.sample(t.real);
  assert.equal(c.fixed(), 60_000);
  c.setOffset(60_000); // 다시 연결하면서 SDK 가 새로 잰 값
  assert.equal(c.fixed(), 0);
  assert.equal(err(), 0);
  assert.equal(c.sample(NaN), false);
  assert.equal(c.sample(undefined), false);
});

test('빠따 결과 안내: 상대의 반응에 따라 다르게 알린다', () => {
  assert.match(batResultText({ n: 1, broke: 1, left: 4 }), /^🏏 빠따로 방어를 깼다! \(남은 빠따 4개\)$/);
  assert.match(batResultText({ n: 1, shielded: 1, left: 4 }), /든든함에 막혔다/);
  assert.match(batResultText({ n: 1, left: 4 }), /통하지 않았다/);
  assert.match(batResultText({ dark: true, n: 1, broke: 1, left: 0 }), /^🌑 어둠의 빠따로 방어를 깼다! 누가 쳤는지는 남지 않는다\. \(남은 어둠의 빠따 0개\)$/);
  assert.match(batResultText({ n: 3, broke: 1, shielded: 1, left: 2 }), /빠따 3개 사용: 1명은 방어가 깨짐, 1명은 🐟 든든함으로 버팀, 1명은 통하지 않음\. \(남은 빠따 2개\)/);
  assert.match(batResultText({ failed: true, n: 1, left: 0 }), /나가지 않았다.*소모되지 않았어요/);
  assert.ok(BAT_CHECK_MS >= 1000 && BAT_CHECK_MS <= 3000, '반응을 기다리는 시간');
});

test('빠따: 보내는 쓰기의 성패를 돌려주고, 받는 쪽은 서버가 찍은 시각으로 내 시계를 견준다', () => {
  const src = readFileSync(new URL('../src/game/net.ts', import.meta.url), 'utf8');
  for (const name of ['toss', 'tossMany', 'pull', 'push', 'pushMany']) {
    const i = src.indexOf(`\n  ${name}(`); assert.ok(i >= 0, name);
    const body = src.slice(i, src.indexOf('\n  }', i));
    assert.ok(/\): Promise<boolean> \{/.test(body) && body.includes('return sent(update('), `${name} 은 쓰기 결과를 돌려준다`);
    assert.ok(body.includes('this.batCost('), `${name} 은 빠따 값을 같은 쓰기에 싣는다`);
  }
  assert.ok(src.includes("if (typeof st.hb === 'number' && st.hb > (prev.hb || 0)) syncServerTime(st.hb);"), '남의 하트비트로 시계를 견준다');
  assert.equal((src.match(/syncServerTime\((p|m)\.t\)/g) || []).length, 3, '밀치기·끌기·말랑이의 시각으로도 견준다');
  const world = readFileSync(new URL('../src/game/world.ts', import.meta.url), 'utf8');
  assert.ok(!/batNote\(/.test(world) && (world.match(/this\.batReport\(this\.net\./g) || []).length === 4, '밀치기·장풍·끌기·갈고리가 결과를 확인해 알린다');
});

test('접속자 목록의 위치: 맵 이름까지만, 집은 누구 집인지', () => {
  const nick = (uid) => ({ owner1: '문어' }[uid] || '');
  assert.equal(whereLabel('main', 'u1', nick), '광장');
  for (const id of Object.keys(MAP_INFO)) assert.equal(whereLabel(id, 'u1', nick), MAP_INFO[id].name);
  assert.equal(whereLabel('h-u1', 'u1', nick), '🏠 자기 집');
  assert.equal(whereLabel('h-owner1', 'u1', nick), '🏠 문어의 집');
  assert.equal(whereLabel('h-nobody', 'u1', nick), '🏠 다른 사람의 집', '집주인이 접속해 있지 않으면 이름을 모른다');
  assert.equal(whereLabel('custom9', 'u1', nick, '시험 맵'), '시험 맵');
  assert.equal(whereLabel('custom9', 'u1', nick), '다른 맵');
  const ui = readFileSync(new URL('../src/game/ui.ts', import.meta.url), 'utf8');
  const i = ui.indexOf('  showOnlineList(): void {'), body = ui.slice(i, ui.indexOf('\n  }\n', i));
  assert.ok(body.includes('window.setInterval(draw, 1000)') && body.includes('window.clearInterval(timer)'), '열어 둔 동안 1초마다 다시 보고, 닫으면 멈춘다');
  assert.ok(body.includes('if (sig === shown) return;'), '달라졌을 때만 다시 그린다');
});

test('입퇴장 알림: 잠깐 끊겼다 돌아온 사람은 알리지 않는다', () => {
  assert.equal(LEAVE_NOTICE_MS, 180000);
  assert.ok(LEAVE_NOTICE_MS > STALE_MS, '유령 정리(2분)보다 길어야 정리됐다 바로 돌아온 사람도 묶인다');
  const src = readFileSync(new URL('../src/game/net.ts', import.meta.url), 'utf8');
  assert.equal((src.match(/this\.noteLeft\(/g) || []).length, 2, '서버가 지운 사람 · 유령 정리로 지운 사람');
  assert.equal((src.match(/this\.noteJoined\(/g) || []).length, 1);
  assert.ok(!/this\.notice\(`\$\{rp\.st\.n\} 님이 퇴장했습니다\.`\)/.test(src), '퇴장 알림을 바로 띄우는 곳이 남아 있지 않다');
});

test('집 벽의 박제 이름·크기는 그 액자를 눌렀을 때만 잠깐 보인다', () => {
  // 늘 떠 있으면 벽 바로 아래에 선 캐릭터를 가린다 (2026-11-20 사용자 요청)
  const world = readFileSync(new URL('../src/game/world.ts', import.meta.url), 'utf8');
  const render = readFileSync(new URL('../src/game/render.ts', import.meta.url), 'utf8');
  assert.match(world, /const PLAQUE_SHOW_MS = 3000;/);
  assert.ok(world.includes('else if (h?.tr?.[String(i)]) this.plaqueShown = { map: this.mapId, slot: i, until: performance.now() + PLAQUE_SHOW_MS };'), '박제 액자를 누르면 그 자리만 켠다');
  assert.ok(world.includes('show: !!ps && ps.map === this.mapId && ps.slot === i && performance.now() < ps.until'), '누른 자리만, 시간이 남았을 때만');
  assert.ok(render.includes('if (!p.show || (!p.text && !p.sub)) continue;'), '누르지 않은 박제는 글자를 그리지 않는다');
});

// ---------- 2026-11-20 밤: 글자가 캐릭터를 가리지 않게 ----------
const { standsBelow, inRowBelow, LABEL_FADE } = await import('../src/shared/overlap.ts');
const { djClampY } = await import('../src/shared/youtube.ts');

test('글자 자리 판정: 바로 아래 칸에 선 캐릭터, 아래 줄의 대상', () => {
  // 펫 (30,19) 바로 아래 칸의 주인 (30,20): 펫 이름을 펫 위로 올린다. 주인이 옆·위에 있으면 그대로 아래
  assert.ok(standsBelow(30, 19, 30, 20));
  assert.ok(standsBelow(30, 19, 30, 19.5), '걸어 내려가는 중에도');
  assert.ok(!standsBelow(30, 19, 31, 19) && !standsBelow(30, 19, 29, 19), '옆(동·서)');
  assert.ok(!standsBelow(30, 19, 30, 18), '위(북)');
  assert.ok(!standsBelow(30, 19, 31, 20), '대각선은 얼굴을 덮지 않는다');
  assert.ok(!standsBelow(30, 19, 30, 21), '두 칸 아래');
  assert.ok(!standsBelow(30, 19, 30, 19), '같은 칸');
  // 안내 글자: 내 아래 줄(바로 아래·양옆 대각선)을 가리킬 때만 내 이름표 아래로 내린다
  assert.ok(inRowBelow(16, 3, 16, 4) && inRowBelow(16, 3, 15, 4) && inRowBelow(16, 3, 17, 4));
  assert.ok(!inRowBelow(16, 3, 16, 2) && !inRowBelow(16, 3, 17, 3) && !inRowBelow(16, 3, 16, 3) && !inRowBelow(16, 3, 18, 4) && !inRowBelow(16, 3, 16, 5));
  assert.ok(LABEL_FADE.box > 0 && LABEL_FADE.box <= 0.35 && LABEL_FADE.text >= 0.7 && LABEL_FADE.text <= 1, '바탕은 거의 비우고 글자는 읽히게');
});

test('그리는 쪽이 그 판정을 쓴다: 펫 이름·이름표·자동 표시·안내 글자', () => {
  const src = readFileSync(new URL('../src/game/render.ts', import.meta.url), 'utf8');
  assert.ok(src.includes('if (st.entities.some((e) => standsBelow(p.x, p.y, e.x, e.y))) {'), '펫 아래 칸에 누가 있으면 이름을 펫 위에');
  assert.ok(src.includes('const fade = ents.some((o) => o !== e && standsBelow(e.x, e.y, o.x, o.y)) ? LABEL_FADE : undefined;'), '아래 칸에 누가 있으면 이름표를 비치게');
  assert.equal((src.match(/, fade(, side)?\);/g) || []).length, 3, '벌칙 칭호·칭호·이름 셋 다'); // 이름은 앞뒤 표시(side)를 같이 넘긴다 (2026-11-23)
  assert.ok(src.includes("if (autoBelow(e)) drawLabel(ctx, txt, sx, under + 17,"), '남쪽으로 던진 찌의 자동 표시는 이름표 아래에');
  assert.ok(src.includes('if (me && inRowBelow(me.x, me.y, st.hint.x, st.hint.y)) {') && src.includes('Math.max(tileBottom - 4, stackBottom(me) + 22)'), '아래 줄을 가리키는 안내는 내 이름표 아래로');
});

test('DJ 창: 다른 화면 요소보다 앞에 그리고, 위쪽 버튼 줄 아래로만 옮겨진다', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const z = (sel) => { const i = css.indexOf(`\n${sel} {`); assert.ok(i >= 0, sel); return Number(/z-index: (\d+)/.exec(css.slice(i, css.indexOf('}', i)))[1]); };
  assert.ok(z('#dj-panel') > z('#hud') && z('#dj-panel') > z('#mafia-invite'), `DJ ${z('#dj-panel')} > HUD ${z('#hud')}`);
  assert.ok(z('#dj-panel') < z('#toasts') && z('#dj-panel') < z('.modal-bg'), '알림·창보다는 뒤');
  assert.equal(djClampY(0, 768, 28, 43), 43, '위로는 버튼 줄 아래까지');
  assert.equal(djClampY(-500, 768, 28, 43), 43);
  assert.equal(djClampY(300, 768, 28, 43), 300);
  assert.equal(djClampY(99999, 768, 28, 43), 728, '아래로는 제목 줄이 화면 안에 남게');
  assert.equal(djClampY(10, 60, 28, 43), 20, '화면이 아주 낮으면 아래쪽 한계가 먼저');
  assert.equal(djClampY(10, 768, 28, 0), 10, '버튼 줄을 못 찾으면 화면 맨 위부터');
  // 영상의 높이를 주면 영상이 절반 넘게 화면 안에 남는 데까지만 내려간다 (2026-11-24: 화면에 보이지 않는 플레이어로 재생하면 안 된다)
  const y = djClampY(99999, 768, 28, 43, 200);
  assert.ok(768 - (y + 28 + 12) > 100 && 768 - (y + 28 + 12) <= 120, `영상 200 가운데 ${768 - (y + 28 + 12)} 이 보인다`);
});

// ---------- 2026-11-24: 마와폰 · 유튜브 창(Y 키 · 📺 버튼 · 최소화 · 전체 화면) · 대회 점수판(TAB · 🏁 버튼) ----------
test('유튜브 창: 폰에서 최소화하면 위에 붙이고 게임 화면을 내린다 (기준: 아이폰 17 프로 402×714)', async () => {
  const Y = await import('../src/shared/youtube.ts');
  assert.deepEqual(Y.djDockFrame(402, 714, 28), { w: 386, h: 217 }, '화면 너비에 맞춘 16:9');
  assert.ok(714 - (217 + 28 + 14) >= Y.DJ_DOCK_GAME_MIN, '게임 화면이 380 넘게 남는다');
  assert.deepEqual(Y.djDockFrame(360, 760, 28), { w: 344, h: 200 }, '좁은 폰: 높이는 가장 작게 200');
  assert.equal(Y.djDockFrame(375, 560, 28), null, '세로가 짧으면 붙이지 않는다 (게임 화면이 너무 좁아진다)');
  assert.equal(Y.djDockFrame(874, 402, 28), null, '가로로 눕힌 화면');
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const ui = read('../src/game/djui.ts'), css = read('../src/styles.css');
  // 화면 밖에서 재생하는 길을 만들지 않는다: 접기(가린 채 재생)·화면 밖 자리는 없다. 닫으면 플레이어를 없앤다
  assert.ok(!ui.includes('folded') && !css.includes('#dj-panel.fold'), '접기는 없앴다');
  assert.ok(ui.includes("this.dock(root.getBoundingClientRect().height);") && ui.includes("document.body.style.setProperty('--dj-dock', `${h}px`);"), '붙인 높이를 알린다');
  assert.ok(css.includes('body.dj-dock #app, body.dj-dock #casino { top: var(--dj-dock, 0px); }'), '게임 화면이 그만큼 내려간다');
  assert.ok(ui.includes("djClampY(pos.y, window.innerHeight, headH, top, frame.getBoundingClientRect().height)"), '끌어도 영상의 절반은 남는다');
  assert.ok(ui.includes("if (m === 'max' && document.fullscreenEnabled) void root.requestFullscreen?.()"), '전체 화면은 창 전체(제목 줄 포함)');
  // 영상 위에 다른 것을 겹치지 않는다: 붙인 동안 알림은 게임 화면 쪽으로 내린다
  assert.ok(css.includes('body.dj-dock #toasts { top: calc(var(--dj-dock, 0px) + 48px); }'));
});

test('마와폰: 장비 품목이고, 가지면 어디서나 유튜브 화면을 켜고 예약한다', async () => {
  const shop = await import('../src/shared/shop.ts');
  const it = shop.itemById(shop.MAWAPHONE_ID);
  assert.ok(it && it.kind === 'gear' && it.price === 30000 && shop.isOwnItem(it.id), '보관함에 들어가는 장비 30,000');
  assert.ok(shop.GEAR_GOODS.includes(it));
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const world = read('../src/game/world.ts'), dj = read('../src/game/dj.ts'), input = read('../src/game/input.ts'), hud = read('../src/game/ui.ts');
  assert.ok(world.includes('private tvUsable(): boolean { return this.mapId === CLUB_MAP_ID || this.wallet.owns(MAWAPHONE_ID); }'), '클럽 안이거나 마와폰 보유');
  assert.ok(world.includes('private tvBlocked(): boolean { return this.mafia.active && this.mafia.isParticipant(this.uid); }'), '마피아 게임 중에는 못 켠다');
  assert.ok(world.includes('this.dj.setActive(this.mapId === CLUB_MAP_ID || want);'), '켜 둔 동안에만 클럽 밖에서 구독한다');
  assert.ok(dj.includes('canReserve(): boolean { return this.w.wallet.owns(MAWAPHONE_ID) || this.atBooth(); }'));
  assert.equal((dj.match(/if \(!this\.canReserve\(\)\) return 'spot';/g) || []).length, 2, '제목을 읽기 전과 읽은 뒤 둘 다');
  assert.ok(input.includes("KeyY: 'tv'") && world.includes("if (a === 'tv') { this.toggleTv(); return; }"), 'Y 키');
  assert.ok(hud.includes("const tvB = act('📺', '유튜브 화면 켜기 · 끄기', () => h.tv());") && hud.includes('btns.append(scB, tvB, tB, pullB, pushB, fB, rB);'), '폰: 말랑이 위에 📺, 그 위에 🏁');
});

test('대회 점수판: TAB 은 누르는 동안, 고정하면 켜고 끄기. 폰은 🏁 버튼', async () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const input = read('../src/game/input.ts'), ui = read('../src/game/contestui.ts'), mgr = read('../src/game/contest.ts'), hud = read('../src/game/ui.ts');
  assert.ok(input.includes("if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat) this.onAction?.({ board: true }); return; }"), '누름');
  assert.ok(input.includes("if (e.code === 'Tab') this.onAction?.({ board: false });"), '뗌은 언제나 알린다');
  assert.ok(/onBlur = \(\): void => \{[^\n]*this\.onAction\?\.\(\{ board: false \}\);/.test(input) && input.includes("window.addEventListener('blur', this.onBlur);"), '창이 뒤로 가면 닫는다');
  assert.ok(ui.includes('if (this.pinned) this.open = !this.open; else this.held = true;'), '고정이면 토글, 아니면 누르는 동안');
  assert.ok(ui.includes("if (scPin && e.type === 'pointerup') h.boardPin();") || hud.includes("if (scPin && e.type === 'pointerup') h.boardPin();"), '폰: 누른 채 아래로 내렸다 떼면 고정');
  // 순위는 판이 떠 있는 동안에만, 15초마다 읽는다 (구독하지 않는다)
  const c = await import('../src/shared/contest.ts');
  assert.equal(c.CONTEST_RANK_POLL_MS, 15000);
  assert.ok(mgr.includes('if (this.watching) this.pollRank();') && mgr.includes('get(ref(db, `fish/contest/${a.key}`))') && !/onValue\(ref\(db, `fish\/contest/.test(mgr));
  assert.ok(read('../src/game/fishing.ts').includes('if (contest) w.contest.noteCatch(pts);'), '내가 낚은 것은 바로 반영');
});

// ---------- 2026-11-24 밤 (제보 두 건: 유튜브 창이 두 개 뜬다 · 집에서 F 를 누르니 "미끼를 달았다"가 뜬다) ----------
// 원인은 하나였다: 게임에서 나가도(로그아웃·다른 곳에서 로그인되어 끊김) 그 게임의 키 리스너가 창(window)에 남아서,
// 새로고침 없이 다시 들어오면 옛 게임이 F·Y 에 같이 반응했다 (옛 자리가 물가면 낚시를 던지고, Y 를 누르면 자기 유튜브 창을 따로 띄웠다)
test('입력: 게임에서 나가면 키 리스너를 뗀다 (나간 게임은 F·Y 에 반응하지 않는다)', async () => {
  const { Input } = await import('../src/game/input.ts');
  const had = 'window' in globalThis, prev = globalThis.window;
  const hs = new Map(); // 종류 → 걸려 있는 리스너
  globalThis.window = {
    addEventListener: (t, fn) => { if (!hs.has(t)) hs.set(t, new Set()); hs.get(t).add(fn); },
    removeEventListener: (t, fn) => { hs.get(t)?.delete(fn); },
  };
  try {
    const fire = (t, e) => { for (const fn of [...(hs.get(t) || [])]) fn(e); };
    const key = (code, k) => ({ isTrusted: true, code, key: k, target: null, preventDefault() {} });
    const count = () => [...hs.values()].reduce((n, s) => n + s.size, 0);
    const old = new Input(), got = [];
    old.onAction = (a) => got.push(a);
    fire('keydown', key('KeyF', 'f')); fire('keydown', key('KeyY', 'y'));
    assert.deepEqual(got, ['interact', 'tv'], '들어와 있는 게임은 받는다');
    assert.equal(count(), 3, '키 누름 · 키 뗌 · 창이 뒤로 감');
    old.dispose(); // 게임에서 나감
    assert.equal(count(), 0, '나가면 하나도 남지 않는다');
    const now = new Input(), got2 = []; // 새로고침 없이 다시 들어옴
    now.onAction = (a) => got2.push(a);
    fire('keydown', key('KeyF', 'f')); fire('keydown', key('KeyY', 'y')); fire('keydown', key('KeyE', 'e')); fire('keydown', key('ArrowLeft', 'ArrowLeft')); fire('blur', {});
    assert.deepEqual(got, ['interact', 'tv'], '나간 게임은 더 받지 않는다');
    assert.deepEqual(got2, ['interact', 'tv', { emote: 10 }, { board: false }], '새 게임만 받는다');
    assert.equal(old.heldDir(), null, '방향키도 나간 게임을 움직이지 않는다');
    assert.equal(count(), 3, '새 게임의 것만 걸려 있다');
    now.dispose();
  } finally { if (had) globalThis.window = prev; else delete globalThis.window; }
  const world = readFileSync(new URL('../src/game/world.ts', import.meta.url), 'utf8');
  assert.ok(/private async stop\(replaced = false\): Promise<void> \{\r?\n    if \(this\.stopped\) return;\r?\n    this\.stopped = true;\r?\n    this\.input\.dispose\(\);/.test(world), '나갈 때 맨 먼저 입력을 끊는다');
  assert.ok(/private syncTv\(\): void \{\r?\n    if \(this\.stopped\) return;/.test(world), '나간 게임은 유튜브 창을 다시 띄우지도, 방송을 다시 구독하지도 않는다');
});

// ---- 2026-11-20: 말풍선 꾸미기 ----
test('말풍선 꾸미기: 품목·착용 칸·그리기가 서로 맞고, 글꼴은 바꾸지 않는다', async () => {
  const { BUBBLES, EQUIP_KEY, isOwnItem, itemById, ALL_ITEMS } = await import('../src/shared/shop.ts');
  const bubbles = await import('../src/game/bubbles.ts');
  const { BUBBLE_SKIN_IDS, hasBubbleSkin } = bubbles;
  assert.equal(EQUIP_KEY.bubble, 'bb');
  assert.ok(BUBBLES.length >= 9);
  for (const it of BUBBLES) {
    assert.equal(it.kind, 'bubble'); assert.ok(it.id.startsWith('bb-'), it.id);
    assert.equal(itemById(it.id), it); assert.ok(isOwnItem(it.id), '보관함 품목이어야 기존 구매·선물 규칙을 쓴다');
    assert.equal(ALL_ITEMS.filter((o) => o.id === it.id).length, 1, `${it.id} 는 하나뿐`);
    assert.ok(BUBBLE_SKIN_IDS.includes(it.id) && hasBubbleSkin(it.id), `${it.id} 그리기`);
    assert.ok(!/글씨체|명조|도트 글씨|둥근 글씨/.test(it.desc), `${it.id} 설명에 글꼴 얘기가 없다`);
  }
  assert.equal(BUBBLE_SKIN_IDS.length, BUBBLES.length, '그리기만 있고 품목이 없는 것은 없다');
  assert.ok(!hasBubbleSkin('nope') && !hasBubbleSkin(null) && !hasBubbleSkin(undefined), '모르는 꾸미기는 기본 말풍선으로');
  // 2026-11-21 건의 반영: 꾸미기는 상자만 바꾸고 글꼴은 기본 글꼴 하나다. 바깥에서 글꼴을 받지 않는다
  assert.ok(!('bubbleFont' in bubbles) && !('loadBubbleFont' in bubbles) && !('BUBBLE_FONTS' in bubbles));
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  for (const f of ['../src/game/bubbles.ts', '../src/game/render.ts', '../src/game/shopui.ts']) assert.ok(!/fonts\.googleapis|jsdelivr|document\.fonts|FontFace/.test(read(f)), `${f}: 바깥 글꼴을 받지 않는다`);
  assert.equal((read('../src/game/render.ts').match(/const font = `\$\{size\}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;/g) || []).length, 1, '말풍선 글꼴은 하나');
});

test('말풍선 꾸미기: 일반 채팅에만 입히고, 규칙과 접속 표시에 칸이 있다', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const render = read('../src/game/render.ts');
  assert.ok(render.includes("const sk = b.kind === 'near' && hasBubbleSkin(skin) ? skin : null;"), '귓속말 말풍선은 그대로');
  assert.equal((render.match(/const size = 12 \+ \(s >= 2 \? 1 : 0\);/g) || []).length, 1, '말풍선 글자 크기 식은 꾸미기와 상관없이 하나');
  assert.ok(render.includes('drawBubble(ctx, e.bubble, sx, top - 2, s, e.bubbleSkin, st.now)'));
  const line = `"bb": { ".validate": "newData.isString() && root.child('users/' + $uid + '/own/' + newData.val()).val() === true" }`;
  assert.equal(read('../database.rules.json').split(line).length - 1, 2, '프로필 착용 칸과 접속 표시 두 곳: 가진 것만');
  assert.ok(read('../tools/gen-rules.cjs').includes('"bb": { ".validate": ${q(ownsStr(pre))} },'), '프로필 착용 칸은 생성기가 만든다');
  assert.ok(read('../src/game/net.ts').includes('bb: has(p.eq?.bb)'), '접속 표시에 싣는다 (가진 것만)');
  assert.ok(read('../src/game/world.ts').includes('bubbleSkin: rp.st.bb || null'));
});

// ---- 2026-11-21: 건의 묶음 (주간 1위 표시 · 크리스마스 철: 소나무 조명·한정 품목·캐롤) ----
test('주간 1위 표시: 랭킹 표와 같은 순서로 1위를 뽑고, 종류마다 다른 표시를 단다', async () => {
  const { topCatch, topToss, weekMarks, weekKindsOf, WEEK_MARKS, WEEK_KINDS } = await import('../src/shared/weektop.ts');
  assert.deepEqual(WEEK_KINDS, ['fish', 'bug', 'toss']);
  assert.notEqual(WEEK_MARKS.fish, '🐟', '낚시 표시는 든든함 표시(🐟n)와 달라야 한다');
  assert.equal(new Set(Object.values(WEEK_MARKS)).size, 3);
  // 점수 → 마릿수 → 먼저 세운 사람
  const rows = { a: { n: 'A', p: 50, c: 9, at: 30 }, b: { n: 'B', p: 80, c: 3, at: 20 }, c: { n: 'C', p: 80, c: 5, at: 40 }, d: { n: 'D', p: 80, c: 5, at: 10 } };
  assert.equal(topCatch(rows), 'd');
  assert.equal(topCatch({ a: { n: 'A', p: 0, c: 4, at: 1 } }), null, '점수가 없으면 1위도 없다');
  assert.equal(topCatch(null), null); assert.equal(topCatch({}), null);
  // 명중 → 덜 던진 사람
  assert.equal(topToss({ a: { n: 'A', h: 5, t: 9, at: 1 }, b: { n: 'B', h: 7, t: 30, at: 2 }, c: { n: 'C', h: 7, t: 12, at: 3 } }), 'c');
  assert.equal(topToss({ a: { n: 'A', h: 0, t: 9, at: 1 } }), null, '한 번도 못 맞혔으면 1위도 없다');
  const tops = { fish: 'u1', bug: 'u2', toss: 'u1' };
  assert.equal(weekMarks(tops, 'u1'), WEEK_MARKS.fish + WEEK_MARKS.toss);
  assert.equal(weekMarks(tops, 'u2'), WEEK_MARKS.bug);
  assert.equal(weekMarks(tops, 'u3'), '');
  assert.equal(weekMarks({ fish: null }, ''), '', '1위가 없는 종류는 누구에게도 붙지 않는다');
  assert.deepEqual(weekKindsOf(tops, 'u1'), ['fish', 'toss']);
  // 화면: 랭킹 표의 순서 식과 같고(fishui), 이름표에 붙이며(world), 서버에 쓰지 않는다
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const ui = read('../src/game/fishui.ts'), shared = read('../src/shared/weektop.ts'), mgr = read('../src/game/weektop.ts'), world = read('../src/game/world.ts');
  for (const expr of ['(b[1].p - a[1].p) || (b[1].c - a[1].c) || (a[1].at - b[1].at)']) { assert.ok(ui.includes(expr)); assert.ok(shared.includes(expr), '낚시·곤충 순서가 랭킹 표와 같다'); }
  assert.ok(ui.includes('(y[1].h - x[1].h) || (x[1].t - y[1].t)') && shared.includes('(b[1].h - a[1].h) || (a[1].t - b[1].t)'), '말랑이 순서가 랭킹 표와 같다');
  assert.equal((world.match(/this\.nickMarks\(/g) || []).length, 2, '내 이름표와 남의 이름표 두 곳');
  assert.ok(!/\b(set|update|push|remove|runTransaction)\(/.test(mgr), '읽기만 한다');
  assert.ok(mgr.includes('weekKey(serverNow() - WEEK_MS)'), '지난 주의 열쇠는 서버 시각으로');
});

test('크리스마스 철: 한국 날짜 12월 1일~25일', async () => {
  const { xmasSeason } = await import('../src/shared/season.ts');
  const kst = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi);
  assert.equal(xmasSeason(kst(2026, 11, 30, 23, 59)), false);
  assert.equal(xmasSeason(kst(2026, 12, 1, 0, 0)), true);
  assert.equal(xmasSeason(kst(2026, 12, 25, 23, 59)), true);
  assert.equal(xmasSeason(kst(2026, 12, 26, 0, 0)), false);
  assert.equal(xmasSeason(kst(2027, 1, 10)), false);
  assert.equal(xmasSeason(kst(2026, 11, 21)), false);
});

test('크리스마스 한정 품목: 일곱 가지, 전부 보관함 품목이고 그리기가 있으며 그 철에만 판다', async () => {
  const shop = await import('../src/shared/shop.ts');
  const { XMAS_IDS, isXmasItem, onSale, itemById, isOwnItem, ALL_ITEMS, HATS, FX, TITLES, BUBBLES, PET_HATS, HOME_GOODS, GOLD_COST } = shop;
  assert.deepEqual([...XMAS_IDS].sort(), ['bb-xmas', 'fn54', 'ph_santa', 'rudolph', 'santa', 'snowfx', 'tt-xmas']);
  for (const id of XMAS_IDS) {
    const it = itemById(id);
    assert.ok(it, id); assert.ok(isOwnItem(id), `${id}: 보관함 품목이어야 기존 구매·선물 규칙을 쓴다`);
    assert.equal(ALL_ITEMS.filter((o) => o.id === id).length, 1, `${id} 는 하나뿐`);
    assert.ok(it.price >= 10000 && it.price <= 30000, `${id}: 적당히 비싸게 (1만~3만)`);
    assert.ok(it.desc.includes('크리스마스 한정'), `${id} 설명`);
    assert.ok(!id.startsWith('gg') && !(id in GOLD_COST), `${id}: 금덩이 품목이 아니다`);
    assert.ok(isXmasItem(id) && onSale(id, true) && !onSale(id, false));
  }
  assert.ok(onSale('crown', false) && onSale('crown', true), '보통 품목은 언제나 판다');
  const kindOf = (id) => itemById(id).kind;
  assert.deepEqual([kindOf('santa'), kindOf('rudolph'), kindOf('ph_santa'), kindOf('snowfx'), kindOf('bb-xmas'), kindOf('tt-xmas'), kindOf('fn54')], ['hat', 'hat', 'pethat', 'fx', 'bubble', 'title', 'home']);
  for (const [list, id] of [[HATS, 'santa'], [HATS, 'rudolph'], [FX, 'snowfx'], [TITLES, 'tt-xmas'], [BUBBLES, 'bb-xmas'], [PET_HATS, 'ph_santa'], [HOME_GOODS, 'fn54']]) assert.ok(list.some((i) => i.id === id), id);
  // 그리기
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const cos = read('../src/game/cosmetics.ts');
  for (const s of ["  santa: { overlap:", "  rudolph: { overlap:", "hat === 'ph_santa'", "case 'snowfx':", "it.id === 'tt-xmas'"]) assert.ok(cos.includes(s), s);
  for (const hat of ['santa', 'rudolph']) { const m = new RegExp(`  ${hat}: \\{[^\\[]*rows: \\[([^\\]]*)\\]`).exec(cos); assert.ok(m, hat); for (const row of m[1].match(/'[^']*'/g)) assert.equal(row.length, 18, `${hat} 그림은 한 줄 16칸: ${row}`); }
  const { hasBubbleSkin } = await import('../src/game/bubbles.ts');
  assert.ok(hasBubbleSkin('bb-xmas'));
  // 꼬마 트리: 가구 목록·맵 오브젝트·규칙의 번호가 같다
  const { FURNITURE } = await import('../src/shared/home.ts');
  const map = await import('../src/game/map.ts');
  assert.equal(map.O_XMAS_TREE, 54); assert.ok(map.TALL_OBJECTS.has(54));
  assert.deepEqual(FURNITURE.find((f) => f.o === 54), { o: 54, name: '꼬마 트리', wood: 0, item: 'fn54' });
  assert.ok(read('../src/game/tiles.ts').includes('case O_XMAS_TREE:'));
  assert.ok(read('../database.rules.json').includes("($id.matches(/^(36|37|38|39|54)$/) && root.child('users/' + $uid + '/own/fn' + $id).val() == true)"));
  // 파는 화면: 철이 아니면 안 가진 사람에게 보이지 않는다
  const shopui = read('../src/game/shopui.ts'), homeui = read('../src/game/homeui.ts');
  assert.ok(shopui.includes('return xmasNow() ? [...x, ...rest] : [...rest, ...x.filter((i) => h.wallet.owns(i.id))];'));
  assert.equal((shopui.match(/onShelf\(/g) || []).length, 2, '꾸미기 목록과 펫 모자 목록');
  assert.equal((homeui.match(/onOffer\(w, f\)/g) || []).length, 2, '집 창의 고급 가구와 가구 고르기 창');
  // 소나무 조명: 그 철의 바깥 맵에서만, 서 있는 소나무에만
  const render = read('../src/game/render.ts'), world = read('../src/game/world.ts');
  assert.ok(render.includes('if (st.xmas && id === O.PINE) {'));
  assert.ok(world.includes('this.xmasOn = this.outdoors() && xmasSeason(serverNow());'));
});

test('캐롤: 가락의 마디 길이·화음이 맞고, 크리스마스 철에는 캐롤만 나온다', async () => {
  const { CAROL_TUNES, CAROL_LIST, TUNES, parseSong, parseChord } = audio;
  assert.deepEqual([...CAROL_LIST], ['jingle', 'wewish', 'deck', 'tannen', 'silent', 'joy', 'noel', 'faithful', 'angels', 'hark', 'manger'], '사용자가 미리 듣고 고른 열한 곡');
  assert.deepEqual(parseChord('C'), [0, 4, 7, 12]);
  assert.deepEqual(parseChord('Am'), [-3, 0, 4, 9]);
  assert.deepEqual(parseChord('G7'), [-5, -1, 2, 5]);
  assert.deepEqual(parseChord('D7'), [2, 6, 9, 12]);
  assert.throws(() => parseChord('H'));
  for (const key of CAROL_LIST) {
    const tu = CAROL_TUNES[key];
    assert.equal(TUNES[key], tu, `${key} 가 곡 목록에 있다`);
    assert.ok(tu.song, key);
    const bars = parseSong(tu.song); // 마디 길이가 안 맞거나 모르는 화음이면 여기서 던진다
    assert.ok(bars.length >= 12, `${key} 마디 수`);
    assert.equal(tu.bars % bars.length, 0, `${key}: 곡 길이는 가락의 배수`);
    const secs = (tu.bars * tu.beats * 60) / tu.bpm;
    assert.ok(secs >= 30 && secs <= 80, `${key} 길이 ${secs.toFixed(0)}초`);
    let lo = 999, hi = -999, count = 0;
    for (const b of bars) {
      assert.ok(b.chords.length >= 1 && b.chords.length <= 4, `${key} 한 마디의 화음 수`);
      let end = 0;
      for (const nt of b.notes) { assert.ok(nt.at >= end - 1e-6, `${key}: 가락의 음은 서로 겹치지 않는다`); end = nt.at + nt.dur; lo = Math.min(lo, nt.n); hi = Math.max(hi, nt.n); count++; }
    }
    const top = tu.root + hi + 12 * tu.lead.oct, bottom = tu.root + lo + 12 * tu.lead.oct;
    assert.ok(bottom >= 64 && top <= 94, `${key} 가락의 높이 ${bottom}~${top} (너무 낮거나 높지 않게)`);
    assert.ok(count >= 40, `${key} 음 수`);
    assert.equal(tu.lead.dens, 0, '지어내는 가락은 쓰지 않는다');
  }
  // 널리 아는 첫머리가 맞는지 (으뜸음 C 에서 잰 반음)
  const head = (key, n) => parseSong(CAROL_TUNES[key].song).flatMap((b) => b.notes.map((x) => x.n)).slice(0, n);
  if (CAROL_TUNES.jingle) assert.deepEqual(parseSong(CAROL_TUNES.jingle.song)[16].notes.map((x) => x.n), [4, 4, 4], '징글벨 후렴: 미 미 미');
  if (CAROL_TUNES.silent) assert.deepEqual(head('silent', 4), [7, 9, 7, 4], '고요한 밤: 솔 라 솔 미');
  if (CAROL_TUNES.joy) assert.deepEqual(head('joy', 8), [12, 11, 9, 7, 5, 4, 2, 0], '기쁘다 구주 오셨네: 도 시 라 솔 파 미 레 도');
  if (CAROL_TUNES.wewish) assert.deepEqual(head('wewish', 6), [-5, 0, 0, 2, 0, -1], '위 위시 유: 솔 도 도 레 도 시');
  // 화면: 철에는 캐롤만 (마피아·클럽은 그대로)
  const src = readFileSync(new URL('../src/game/audio.ts', import.meta.url), 'utf8');
  assert.ok(src.includes("new Set<Scene>(['main', 'home', 'mine', 'winter', 'race', 'slots', 'poker'])"));
  assert.ok(src.includes('list = carols ? CAROL_LIST : want.night && set.night ? set.night : set.day'));
  assert.ok(readFileSync(new URL('../src/game/world.ts', import.meta.url), 'utf8').includes('setScene(this.sceneNow(), isNight(kstMinuteOfDay(serverNow())), xmasSeason(serverNow()))'));
  assert.doesNotThrow(() => audio.setScene('main', false, true));
  audio.stopSound();
});

test('칭호: 재미 칭호 21개는 3만, 달성 칭호 2개는 조건이 있고, 빛깔을 따로 정한 것은 그리는 쪽에 있다', async () => {
  const { TITLES, TITLE_NEEDS, ALL_ITEMS, itemById, isOwnItem } = await import('../src/shared/shop.ts');
  const ids = TITLES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, '칭호 id 가 겹치지 않는다');
  assert.equal(new Set(ALL_ITEMS.map((i) => i.id)).size, ALL_ITEMS.length, '품목 id 가 겹치지 않는다');
  for (const t of TITLES) { assert.ok(t.id.startsWith('tt-') && t.kind === 'title' && itemById(t.id) === t && isOwnItem(t.id), t.id); assert.ok(t.name.length <= 8, `${t.name}: 이름표 너비`); }
  const fun = TITLES.filter((t) => t.price === 30000 && t.id !== 'tt-xmas');
  assert.equal(fun.length, 21);
  for (const name of ['핑크공주', '동네 개', '마을 거지', '마을 도둑놈', '마을 카사노바', '마을 졸부', '알콜중독', '골목대장', '귀염둥이', '마을 인싸', '마을 아싸', '마을 관종', '동네 바보', '소비요정', '돈미새', '노예', '될놈될', '인생역전', '인생여전', '소녀가장', '소년가장']) assert.ok(fun.some((t) => t.name === name), name);
  // 달성 칭호: 조건이 있는 것은 칭호 목록에 있고, 낚시·채집 하나씩
  assert.deepEqual(Object.keys(TITLE_NEEDS).sort(), ['tt-fisher', 'tt-netter']);
  for (const [id, need] of Object.entries(TITLE_NEEDS)) { assert.ok(ids.includes(id), id); assert.ok(need.n >= 100000 && ['fish', 'bug'].includes(need.what)); }
  assert.deepEqual([TITLE_NEEDS['tt-fisher'].what, TITLE_NEEDS['tt-netter'].what], ['fish', 'bug']);
  const cos = readFileSync(new URL('../src/game/cosmetics.ts', import.meta.url), 'utf8');
  for (const s of ["it.id === 'tt-pink'", 'TITLE_NEEDS[it.id]']) assert.ok(cos.includes(s), s);
  // 상점: 조건을 못 채우면 살 수 없고 선물 단추가 없다
  const ui = readFileSync(new URL('../src/game/shopui.ts', import.meta.url), 'utf8');
  for (const s of ['const locked = !!need && !owned && (done === null || done < need.n)', 'if (locked) { btn.disabled = true;', 'gold || need || (isXmasItem(item.id) && !xmasNow()) ? [btn]']) assert.ok(ui.includes(s), s);
});

test('치장템 판매: 치장템만, 지금 값의 30% (내림), 금덩이 품목과 펫·장비는 팔 수 없다', async () => {
  const { SELL_PCT, canSell, sellPrice, itemById, ALL_ITEMS, GOLD_COST, TITLES, HATS, FX, BUBBLES, NAME_COLORS, PET_HATS, PET_GLASSES, PET_GOODS, ROD_GOODS } = await import('../src/shared/shop.ts');
  assert.equal(SELL_PCT, 30);
  for (const list of [TITLES, HATS, FX, BUBBLES, NAME_COLORS, PET_HATS, PET_GLASSES]) for (const it of list) assert.equal(canSell(it), !GOLD_COST[it.id], it.id);
  for (const it of [...PET_GOODS, ...ROD_GOODS]) assert.equal(canSell(it), false, it.id);
  for (const it of ALL_ITEMS) if (!['hat', 'pin', 'wing', 'hand', 'name', 'fx', 'title', 'bubble', 'pethat', 'petglass'].includes(it.kind)) assert.equal(sellPrice(it, null), 0, it.id);
  for (const id of Object.keys(GOLD_COST)) assert.equal(sellPrice(itemById(id), null), 0, id);
  assert.equal(canSell(undefined), false);
  assert.equal(sellPrice(undefined, null), 0);
  // 값은 가격표가 먼저다 (관리자가 값을 바꾸면 환불도 따라간다)
  const pink = itemById('tt-pink');
  assert.equal(sellPrice(pink, null), 9000);
  assert.equal(sellPrice(pink, { 'tt-pink': 50000 }), 15000);
  assert.equal(sellPrice(pink, { 'tt-pink': 33333 }), 9999);
  assert.equal(sellPrice(itemById('tt-fisher'), null), 300);
  // 샀다 팔기를 되풀이해도 남지 않는다
  for (const it of ALL_ITEMS) assert.ok(sellPrice(it, null) * 2 < Math.max(1, it.price), it.id);
});

test('치장템 판매: 판 것(false)은 다음 접속 때 다시 주지 않는다. 이 기기에서 방금 값을 낸 것만 준다', async () => {
  const { shouldDeliver } = await import('../src/shared/shop.ts');
  assert.equal(shouldDeliver(true, false), false);       // 이미 가졌다
  assert.equal(shouldDeliver(true, true), false);
  assert.equal(shouldDeliver(undefined, false), true);   // 값은 냈는데 등록이 안 됐다
  assert.equal(shouldDeliver(null, false), true);
  assert.equal(shouldDeliver(false, false), false);      // 가졌다가 팔았다
  assert.equal(shouldDeliver(false, true), true);        // 판 것을 다시 사다가 끊겼다
  const src = readFileSync(new URL('../src/game/wallet.ts', import.meta.url), 'utf8');
  // 지갑: 판 품목은 지우지 않고 false 로 두고, 환불과 한 번의 쓰기로 보낸다. 접속할 때의 마저 등록은 shouldDeliver 를 거친다
  for (const s of ["[`users/${uid}/own/${item.id}`]: false", '[`wallet/${uid}/c`]: increment(refund), [`wallet/${uid}/e`]: increment(refund)', 'shouldDeliver(has, this.pendingIs(`${b}>${gt}`))', 'shouldDeliver(this.w.profile.own?.[b], this.pendingIs(b))']) assert.ok(src.includes(s), s);
  // 규칙: 가진 칸을 false 로 내리는 것은 주인만
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules;
  assert.ok(rules.users.$uid.own.$item['.validate'].includes('(data.val() === true && (newData.val() === true || auth.uid == $uid))'));
});

test('금 이름표: 다섯 빛깔 모두 금덩이 3,000 + 5만 코인이고 흐르는 금빛으로 그린다', async () => {
  const { NAME_COLORS, GOLD_COST, itemById, canSell } = await import('../src/shared/shop.ts');
  const ids = ['ggrose', 'ggwhite', 'ggchamp', 'gggreen', 'ggblack'];
  for (const id of ids) {
    const it = itemById(id);
    assert.ok(it && NAME_COLORS.includes(it) && it.kind === 'name', id);
    assert.deepEqual([it.price, GOLD_COST[id]], [50000, 3000], id);
    assert.equal(canSell(it), false, `${id}: 금덩이 품목은 팔 수 없다`);
    assert.ok(it.desc.includes('금덩이 3,000개'), id);
  }
  assert.equal(GOLD_COST.ggname, 1000, '순금은 그대로');
  // 그리기: 품목마다 빛깔이 있고, 그 빛깔은 흐르는 띠로 등록돼 있다 (없으면 글자가 안 칠해진다)
  const cos = readFileSync(new URL('../src/game/cosmetics.ts', import.meta.url), 'utf8');
  for (const id of ids) {
    const m = new RegExp(`nc === '${id}'\\) return \\{ color: '(\\w+)'`).exec(cos);
    assert.ok(m, `${id}: nameStyle`);
    assert.ok(new RegExp(`^  ${m[1]}: \\[`, 'm').test(cos), `${id}: 흐르는 빛깔 ${m[1]}`);
  }
});

test('건의 꾸미기: 모자 칸 여덟 가지와 음표 이펙트는 그림이 있고 값이 정한 대로다', async () => {
  const { HATS, PINS, WINGS, HANDS, FX, itemById, canSell } = await import('../src/shared/shop.ts');
  const want = { propeller: 30000, balloon: 30000, pinheart: 20000, pinstar: 20000, pindrop: 20000, pinbolt: 20000, wingangel: 100000, wingdevil: 100000 };
  // 칸이 따로다: 프로펠러만 모자, 머리핀 넷·날개 둘·풍선은 저마다의 칸
  const where = { propeller: [HATS, 'hat'], balloon: [HANDS, 'hand'], pinheart: [PINS, 'pin'], pinstar: [PINS, 'pin'], pindrop: [PINS, 'pin'], pinbolt: [PINS, 'pin'], wingangel: [WINGS, 'wing'], wingdevil: [WINGS, 'wing'] };
  for (const [id, price] of Object.entries(want)) {
    const it = itemById(id);
    assert.ok(it && where[id][0].includes(it) && it.kind === where[id][1], id);
    assert.equal(it.price, price, id);
    assert.equal(canSell(it), true, id);
  }
  assert.deepEqual([PINS.length, WINGS.length, HANDS.length], [4, 2, 1]);
  assert.ok(!HATS.some((h) => h.id in where && h.id !== 'propeller'), '모자 목록에는 프로펠러 모자만 남는다');
  const notes = itemById('notes');
  assert.ok(notes && FX.includes(notes) && notes.price === 50000);
  // 그림: 품목마다 줄들이 있고, 모든 줄의 너비가 같으며(짝수: 가운데 맞춤), 쓰인 글자는 팔레트에 있다
  const cos = readFileSync(new URL('../src/game/cosmetics.ts', import.meta.url), 'utf8').replace(/\r/g, '');
  for (const id of Object.keys(want)) {
    const m = new RegExp(`\\n  ${id}: \\{ overlap: (\\d+), pal: \\{([^}]*)\\}, rows: \\[\\n([\\s\\S]*?)\\n  \\] \\}`).exec(cos);
    assert.ok(m, `${id}: 그림이 없다`);
    const rows = [...m[3].matchAll(/'([^']*)'/g)].map((x) => x[1]), keys = new Set([...m[2].matchAll(/(\w): '/g)].map((x) => x[1]));
    assert.ok(rows.length >= 6, id);
    assert.equal(new Set(rows.map((r) => r.length)).size, 1, `${id}: 줄 너비가 다르다`);
    assert.ok(rows[0].length % 2 === 0 && rows[0].length >= 16 && rows[0].length <= 36, `${id}: 너비 ${rows[0].length}`);
    for (const r of rows) for (const ch of r) assert.ok(ch === '.' || keys.has(ch), `${id}: 팔레트에 없는 글자 ${ch}`);
    assert.ok(Number(m[1]) <= 26, `${id}: 발 아래로 내려가지 않는다`);
  }
  // 날개는 좌우가 거울이다
  for (const id of ['wingangel', 'wingdevil']) {
    const m = new RegExp(`\\n  ${id}: [^\\n]*\\n([\\s\\S]*?)\\n  \\] \\}`).exec(cos);
    for (const x of m[1].matchAll(/'([^']*)'/g)) assert.equal(x[1], [...x[1]].reverse().join(''), `${id}: ${x[1]}`);
  }
  // 음표: 그리는 갈래와 수명이 있다. 머리 위로 솟지 않는 그림(머리핀·날개)이 말풍선 자리를 아래로 끌어내리지 않는다
  for (const s of ["case 'notes': {", "kind === 'snowfx' || kind === 'notes' ? 700", 'Math.max(0, art.rows.length - art.overlap)', 'cv.width = Math.max(16, ...art.rows.map((r) => r.length))', 'Math.floor((FRAME_W - cv.width) / 2)']) assert.ok(cos.includes(s), s);
  // 상점 미리보기와 잔상에 여백이 있다 (풍선 12px 위 · 천사 날개 6px 옆)
  assert.ok(cos.includes('const GHOST_PAD_X = 6, GHOST_PAD_TOP = 16;'));
  assert.ok(readFileSync(new URL('../src/game/shopui.ts', import.meta.url), 'utf8').includes('const HAT_PAD_X = 6, HAT_PAD_TOP = 12;'));
});

test('착용 칸: 머리핀 · 날개 · 손에 드는 것은 모자와 따로 쓰고, 규칙·접속 표시·그리기에 칸이 있다', async () => {
  const { EQUIP_KEY } = await import('../src/shared/shop.ts');
  assert.deepEqual([EQUIP_KEY.hat, EQUIP_KEY.pin, EQUIP_KEY.wing, EQUIP_KEY.hand], ['h', 'hp', 'wg', 'bl']);
  assert.equal(new Set(Object.values(EQUIP_KEY)).size, Object.keys(EQUIP_KEY).length, '칸 이름이 겹치지 않는다');
  // 규칙: 프로필의 착용 칸과 접속 표시 양쪽에 "가진 것만"으로 들어 있다 (접속 표시는 손으로 넣은 줄이다)
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules;
  for (const k of ['h', 'hp', 'wg', 'bl']) {
    for (const node of [rules.users.$uid.eq[k], rules.players.$uid[k]]) assert.ok(node && node['.validate'].includes("/own/' + newData.val()).val() === true"), k);
  }
  const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  // 접속 표시에 싣고, 남의 것을 그리고, 모자 뒤에 머리핀을 그린다
  assert.ok(read('../src/game/net.ts').includes('hp: has(p.eq?.hp), wg: has(p.eq?.wg), bl: has(p.eq?.bl)'));
  assert.ok(read('../src/game/world.ts').includes('pin: rp.st.hp || null, wing: rp.st.wg || null, hand: rp.st.bl || null'));
  assert.ok(read('../src/game/render.ts').includes('const wear = [e.wing, e.hat, e.pin, e.hand].filter('));
  // 모자 칸에 들어가 있던 것을 접속 표시를 올리기 전에 제 칸으로 옮긴다
  const world = read('../src/game/world.ts');
  assert.ok(world.indexOf('this.wallet.fixSlots();') > 0 && world.indexOf('this.wallet.fixSlots();') < world.indexOf('await this.net.join(spawn.x, spawn.y, dir);'));
});
