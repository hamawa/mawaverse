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
  assert.equal(a.views([{ key: 'owner|petdog', id: 'petdog', scale: 1.4 }], t)[0].scale, 1.4, '데리고 온 펫은 크기 그대로');
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
