// 닉네임 검사 시험 (src/shared/util.ts validateNick). 실행: node --test tests/nick.test.mjs
// 규칙(database.rules.json 의 users/$uid/nick)에 글자로 든 허용 범위가 코드의 NICK_RANGES 와 같은지도 본다. 규칙 자체의 허용·거부는 tests/rules-gate.test.mjs (에뮬레이터)
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

const { validateNick, NICK_RANGES, nickCharOk } = await import('../src/shared/util.ts');
const { WEEK_MARKS } = await import('../src/shared/weektop.ts');
const { CONTEST_MEDALS } = await import('../src/shared/contest.ts');
const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules;

test('닉네임: 한글·영문·숫자·흔한 기호·다른 나라 글자는 그대로 쓸 수 있다', () => {
  for (const n of ['마와', '열두글자닉네임열두글자', 'Mawa123', '닉_네.임-~!', 'ㅋㅋㅋ', '漢字かなカナ', 'Ünïcödé', '１２전각']) assert.equal(validateNick(n), null, n);
});

test('닉네임: 이모지와 그림 기호는 못 쓴다 (이름표 앞뒤의 표시를 흉내 낼 수 없게)', () => {
  const E = /이모지/;
  // 실제로 쓰였던 모양들: 표시를 앞에 붙인 것, 뒤에 붙인 것, 눈송이·상어
  for (const n of ['🏆🧸🎣🐛마와🐶', '마와🥈', '마와🏆', '마와❄🦈', '🍤🍤', '🐲용']) assert.match(validateNick(n) || '', E, n);
  // 글자처럼 보이는 그림 기호, 조합으로 만드는 이모지, 눈에 안 보이는 글자
  for (const n of ['★마와', '마와♥', '마와☆', '→마와', '마와©', '㊗마와', '1️⃣등마와', '🇰🇷마와', '마와‍', '마​와', '마와️', '마와']) assert.match(validateNick(n) || '', E, JSON.stringify(n));
  // 게임이 이름표에 붙이는 표시는 하나도 닉네임에 들어갈 수 없다
  for (const m of [...CONTEST_MEDALS, ...Object.values(WEEK_MARKS), '👻', '🔪', '💤', '😴', '🐟', '💥']) assert.match(validateNick(`마와${m}`) || '', E, m);
});

test('닉네임: 길이·공백·금지 문자 안내는 전과 같다', () => {
  assert.match(validateNick('가'), /2자 이상/);
  assert.match(validateNick('가'.repeat(13)), /12자 이하/);
  assert.match(validateNick('마 와'), /공백/);
  assert.match(validateNick('마　와'), /공백/);
  assert.match(validateNick('마/와'), /문자는 쓸 수 없/);
});

test('닉네임: 허용 범위가 겹치지 않고 순서대로이며, 이모지가 든 구역과 빈칸이 빠져 있다', () => {
  for (let i = 0; i < NICK_RANGES.length; i++) {
    const [a, b] = NICK_RANGES[i];
    assert.ok(a <= b && b <= 0xffff, `범위 ${i}`);
    if (i) assert.ok(a > NICK_RANGES[i - 1][1], `범위 ${i} 가 앞 범위와 겹친다`);
  }
  for (const cp of [0x20, 0xa9, 0xad, 0xae, 0x2000, 0x200d, 0x20e3, 0x2605, 0x2665, 0x2744, 0x2b50, 0x2bff, 0x3030, 0x303d, 0x3297, 0x3299, 0xd800, 0xdfff, 0xe000, 0xf8ff, 0xfe0f, 0xfeff, 0xfffd, 0x1f3c6, 0x1f9f8, 0xe0020]) assert.equal(nickCharOk(cp), false, cp.toString(16));
  for (const cp of [0x21, 0x41, 0x7e, 0xc0, 0x1100, 0x3131, 0x3163, 0x3042, 0x4e00, 0xac00, 0xd7a3, 0xff11]) assert.equal(nickCharOk(cp), true, cp.toString(16));
  // 모든 그림 이모지 (유니코드의 Extended_Pictographic) 는 범위 밖이다
  for (let cp = 0x21; cp <= 0x1fffd; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}/u.test(String.fromCodePoint(cp))) assert.equal(nickCharOk(cp), false, `U+${cp.toString(16)}`);
  }
});

test('규칙: users/$uid/nick 의 정규식에 든 범위가 NICK_RANGES 와 같다', () => {
  const v = rules.users.$uid.nick['.validate'];
  const m = /newData\.val\(\)\.matches\(\/\^\[(.+)\]\+\$\/\)/u.exec(v);
  assert.ok(m, '닉네임 규칙에 허용 글자 정규식이 있다');
  const chars = [...m[1]], got = [];
  for (let i = 0; i < chars.length; i++) {
    const a = chars[i].codePointAt(0);
    if (chars[i + 1] === '-' && i + 2 < chars.length) { got.push([a, chars[i + 2].codePointAt(0)]); i += 2; }
    else got.push([a, a]);
  }
  assert.deepEqual(got, NICK_RANGES.map(([a, b]) => [a, b]));
  assert.match(v, /length >= 2 && newData\.val\(\)\.length <= 12/);
  // 규칙의 길이는 UTF-16 단위로 센다: 화면의 n.length 와 같다
});

// ---------- 작명 칭호의 글자 (2026-11-27. src/shared/shop.ts cleanTitleName · titleNameError)
const { cleanTitleName, titleNameError, TITLE_NAME_MAX, TITLES, CUSTOM_TITLE_ID } = await import('../src/shared/shop.ts');
const { SNOW_PENALTY_TITLE } = await import('../src/shared/snowpenalty.ts');

test('작명 칭호: 글자는 닉네임과 같은 범위에 낱말 사이 빈칸만 더 받고, 8자까지다', () => {
  assert.equal(TITLE_NAME_MAX, 8);
  for (const n of ['마와버스 주인', '낚시왕', 'GM', '1등', '漢字かな', '여덟글자칭호야요', 'ㅋㅋㅋ', '가 나 다 라']) assert.equal(titleNameError(n), null, n);
  // 앞뒤 빈칸과 겹친 빈칸은 다듬는다 (다듬은 것이 8자 안이면 된다)
  assert.equal(titleNameError('  마와   버스  '), null);
  assert.equal(cleanTitleName('  마와   버스  '), '마와 버스');
  assert.equal(cleanTitleName('마와\u3000버스'), '마와 버스', '전각 빈칸도 보통 빈칸으로');
  assert.match(titleNameError('') || '', /적어/);
  assert.match(titleNameError('   ') || '', /적어/);
  assert.match(titleNameError('아홉글자는안되는칭호') || '', /8자/);
  // 이모지·그림 기호: 닉네임에서 막는 것은 여기서도 막는다
  for (const n of ['🏆우승', '마와🧸', '★별', '마와♥', '1\ufe0f\u20e3등', '마\u200b와', '\u{1f1f0}\u{1f1f7}']) assert.match(titleNameError(n) || '', /이모지/, JSON.stringify(n));
});

test('작명 칭호: 이미 있는 칭호의 이름은 지을 수 없다 (빈칸을 넣고 빼도)', () => {
  const E = /이미 있는 칭호/;
  for (const t of TITLES) if (t.id !== CUSTOM_TITLE_ID && [...t.name].length <= TITLE_NAME_MAX) assert.match(titleNameError(t.name) || '', E, t.name);
  for (const n of ['살아있는전설', '살아있는 전설', '강 태 공', '잠자리채', '마을부자', '하마와', SNOW_PENALTY_TITLE, SNOW_PENALTY_TITLE.replace(/ /g, '')]) assert.match(titleNameError(n) || '', E, n);
  // 품목의 이름 "작명 칭호" 자체는 막지 않는다 (흉내 낼 것이 없다). 비슷하지만 다른 이름은 된다
  assert.equal(titleNameError('작명 칭호'), null);
  assert.equal(titleNameError('살아있는 전설2'), null);
});

test('작명 칭호: 남이 보낸 글자를 그릴 때는 범위 밖 글자를 버리고 8자에서 자른다', () => {
  assert.equal(cleanTitleName('마와🏆 버스'), '마와 버스');
  assert.equal(cleanTitleName('🏆🧸'), '');
  assert.equal(cleanTitleName('가나다라마바사아자차'), '가나다라마바사아');
  assert.equal(cleanTitleName('가나다라마바사 아'), '가나다라마바사', '자른 끝의 빈칸은 뗀다');
  for (const v of [undefined, null, 3, {}, true]) assert.equal(cleanTitleName(v), '');
  // 다듬은 글자는 다시 다듬어도 같다
  for (const n of ['마와 버스', '낚시왕', 'a b c']) assert.equal(cleanTitleName(cleanTitleName(n)), cleanTitleName(n));
});

test('규칙: 작명 칭호의 글자 (프로필 eq/ttn · 접속 표시 ttn) 는 NICK_RANGES + 빈칸, 8자까지, 작명 칭호를 가진 사람만', () => {
  const eq = rules.users.$uid.eq.ttn['.validate'], pl = rules.players.$uid.ttn['.validate'];
  assert.equal(pl, eq, '접속 표시의 식은 프로필의 식과 같다 (손으로 옮긴 줄)');
  const m = /newData\.val\(\)\.matches\(\/\^\[(.+?)\]\[(.+?)\]\*\$\/\)/u.exec(eq);
  assert.ok(m, '허용 글자 정규식이 있다');
  const ranges = (cls) => {
    const chars = [...cls], got = [];
    for (let i = 0; i < chars.length; i++) {
      const a = chars[i].codePointAt(0);
      if (chars[i + 1] === '-' && i + 2 < chars.length) { got.push([a, chars[i + 2].codePointAt(0)]); i += 2; }
      else got.push([a, a]);
    }
    return got;
  };
  const want = NICK_RANGES.map(([a, b]) => [a, b]);
  assert.deepEqual(ranges(m[1]), want, '첫 글자: 닉네임과 같은 범위 (빈칸 없음)');
  assert.deepEqual(ranges(m[2]), [...want, [0x20, 0x20]], '그 뒤: 같은 범위 + 빈칸');
  assert.match(eq, /length >= 1 && newData\.val\(\)\.length <= 8/);
  assert.ok(eq.includes("/own/tt-custom').val() === true"));
  // 규칙의 정규식을 그대로 돌려 본다: 화면이 받는 글자는 규칙도 받고, 화면이 막는 이모지는 규칙도 막는다
  const re = new RegExp(`^[${m[1]}][${m[2]}]*$`, 'u');
  for (const n of ['마와버스 주인', '낚시왕', 'GM', '가 나 다 라']) assert.ok(re.test(cleanTitleName(n)), n);
  for (const n of ['🏆우승', '마와♥', ' 앞빈칸', '마\u200b와']) assert.ok(!re.test(n), JSON.stringify(n));
  // 생성기에 적힌 범위가 파일의 것과 같다 (final 을 다시 돌려도 바뀌지 않는다)
  const gen = readFileSync(new URL('../tools/gen-rules.cjs', import.meta.url), 'utf8');
  const cls = /const TITLE_NAME_CLASS = '([^']+)';/.exec(gen);
  assert.ok(cls);
  assert.equal(JSON.parse(`"${cls[1].replace(/\\\\/g, '\\')}"`), m[1]);
});
