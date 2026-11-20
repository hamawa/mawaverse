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

test('클럽 DJ 자리: 디제이 탁자 바로 뒤이고, 걸어서 갈 수 있다. 규칙에 든 좌표와 같다', async () => {
  const { buildClubMap, CLUB_DJ_SPOTS, O_DJ, objectAt, isWalkable } = await import('../src/game/map.ts');
  const club = buildClubMap();
  assert.ok(CLUB_DJ_SPOTS.length >= 1);
  for (const p of CLUB_DJ_SPOTS) { assert.equal(isWalkable(club, p.x, p.y), true); assert.equal(objectAt(club, p.x, p.y + 1), O_DJ, '바로 앞이 디제이 탁자'); }
  // 시작 자리에서 걸어서 닿는다
  const seen = new Set([`${club.spawn.x},${club.spawn.y}`]), q = [[club.spawn.x, club.spawn.y]];
  while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = `${x + dx},${y + dy}`; if (!seen.has(k) && isWalkable(club, x + dx, y + dy)) { seen.add(k); q.push([x + dx, y + dy]); } } }
  for (const p of CLUB_DJ_SPOTS) assert.ok(seen.has(`${p.x},${p.y}`), `DJ 자리 (${p.x},${p.y})`);
  const rule = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules.club.dj;
  assert.ok(new Set(CLUB_DJ_SPOTS.map((p) => p.y)).size === 1 && rule['.write'].includes(`/y').val() == ${CLUB_DJ_SPOTS[0].y}`));
  for (const p of CLUB_DJ_SPOTS) assert.ok(rule['.write'].includes(`/x').val() == ${p.x}`), `규칙에 x=${p.x}`);
  assert.ok(rule['.validate'].includes('matches(/^[A-Za-z0-9_-]{11}$/)') && rule['.validate'].includes("newData.child('at').val() == now"));
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
  assert.equal((src.match(/, fade\);/g) || []).length, 3, '벌칙 칭호·칭호·이름 셋 다');
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
});

// ---- 2026-11-20: 말풍선 꾸미기 ----
test('말풍선 꾸미기: 품목·착용 칸·글꼴·그리기가 서로 맞는다', async () => {
  const { BUBBLES, EQUIP_KEY, isOwnItem, itemById, ALL_ITEMS } = await import('../src/shared/shop.ts');
  const { BUBBLE_FONTS, BUBBLE_SKIN_IDS, hasBubbleSkin, bubbleFont } = await import('../src/game/bubbles.ts');
  assert.equal(EQUIP_KEY.bubble, 'bb');
  assert.ok(BUBBLES.length >= 9);
  for (const it of BUBBLES) {
    assert.equal(it.kind, 'bubble'); assert.ok(it.id.startsWith('bb-'), it.id);
    assert.equal(itemById(it.id), it); assert.ok(isOwnItem(it.id), '보관함 품목이어야 기존 구매·선물 규칙을 쓴다');
    assert.equal(ALL_ITEMS.filter((o) => o.id === it.id).length, 1, `${it.id} 는 하나뿐`);
    assert.ok(BUBBLE_SKIN_IDS.includes(it.id) && hasBubbleSkin(it.id), `${it.id} 그리기`);
    const f = BUBBLE_FONTS[it.id];
    assert.ok(f && f.family, `${it.id} 글꼴`);
    // 글꼴 주소: 구글 글꼴 목록이거나, 판을 고정한 파일 하나
    assert.ok(f.css ? f.css.startsWith('https://fonts.googleapis.com/css2?family=') : /^https:\/\/cdn\.jsdelivr\.net\/gh\/[^@]+@\d+\.\d+\//.test(f.file), `${it.id} 글꼴 주소`);
  }
  assert.equal(BUBBLE_SKIN_IDS.length, BUBBLES.length, '그리기만 있고 품목이 없는 것은 없다');
  // 글자 크기는 받은 그대로 쓴다 (사용자 결정: 꾸미기가 글자를 키우지 않는다)
  assert.ok(bubbleFont('bb-ink', 13, '가').startsWith('700 13px "Gowun Batang", '));
  assert.ok(bubbleFont('bb-retro', 12, '가').startsWith('12px "NeoDunggeunmo", '));
  assert.ok(bubbleFont(null, 13, '가').startsWith('13px "Malgun Gothic"'), '꾸미기가 없으면 기본 글꼴');
  assert.ok(!hasBubbleSkin('nope') && !hasBubbleSkin(null) && !hasBubbleSkin(undefined), '모르는 꾸미기는 기본 말풍선으로');
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
