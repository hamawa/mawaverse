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
