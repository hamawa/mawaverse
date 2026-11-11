// 이용 시간 판정 테스트: 시각을 넣어 본다. 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hoursState, clientBlocked, kstParts, dayNumberOf, parseBreaks, blockMessage } from '../src/shared/hours.ts';

const HOLIDAYS = JSON.parse(readFileSync(new URL('../holidays.json', import.meta.url), 'utf8'));
const HOURS = JSON.parse(readFileSync(new URL('../hours.json', import.meta.url), 'utf8'));
const BREAKS = parseBreaks(HOURS.breaks);
// KST 시각 → 타임스탬프
const at = (s) => Date.parse(s.replace(' ', 'T') + '+09:00');
const st = (s, h = HOLIDAYS, b = BREAKS) => hoursState(at(s), h, b);

test('평일 08:54 는 이용 가능', () => assert.equal(st('2026-11-11 08:54:59'), 'open'));
test('평일 08:55 부터 안내', () => { assert.equal(st('2026-11-11 08:55:00'), 'warn'); assert.equal(st('2026-11-11 08:59:59'), 'warn'); });
test('평일 09:00 부터 차단', () => assert.equal(st('2026-11-11 09:00:00'), 'blocked'));
test('평일 17:59 까지 차단', () => assert.equal(st('2026-11-11 17:59:59'), 'blocked'));
test('평일 18:00 부터 이용 가능', () => assert.equal(st('2026-11-11 18:00:00'), 'open'));
test('평일 밤과 새벽은 이용 가능', () => { assert.equal(st('2026-11-11 23:30:00'), 'open'); assert.equal(st('2026-11-12 03:00:00'), 'open'); });
test('월요일과 금요일도 차단', () => { assert.equal(st('2026-11-09 11:00:00'), 'blocked'); assert.equal(st('2026-11-13 11:00:00'), 'blocked'); });
test('토요일은 종일 이용 가능 (안내도 없음)', () => { assert.equal(st('2026-11-14 08:57:00'), 'open'); assert.equal(st('2026-11-14 11:00:00'), 'open'); });
test('일요일은 종일 이용 가능', () => assert.equal(st('2026-11-15 11:00:00'), 'open'));
test('공휴일은 평일이어도 종일 이용 가능', () => { assert.equal(st('2026-12-25 08:57:00'), 'open'); assert.equal(st('2026-12-25 11:00:00'), 'open'); });
test('대체공휴일도 이용 가능', () => assert.equal(st('2027-02-09 10:00:00'), 'open'));
test('공휴일 다음 평일은 다시 차단', () => assert.equal(st('2026-12-28 10:00:00'), 'blocked'));
test('임시공휴일을 목록에 추가하면 풀린다', () => { assert.equal(st('2026-11-11 10:00:00', {}), 'blocked'); assert.equal(st('2026-11-11 10:00:00', { '2026-11-11': '임시공휴일' }), 'open'); });
test('기기 시간대와 상관없이 KST 로 본다 (UTC 자정 = KST 09:00)', () => assert.equal(hoursState(Date.UTC(2026, 10, 11, 0, 0, 0), HOLIDAYS, BREAKS), 'blocked'));

// ---- 쉬는 시간 (hours.json): 평일 근무시간 중에도 풀린다 ----
test('쉬는 시간 설정: 10:30~10:45, 12:00~13:00, 15:30~15:45', () => assert.deepEqual(BREAKS, [[630, 645], [720, 780], [930, 945]]));
test('오전 쉬는 시간 10:30~10:45', () => {
  assert.equal(st('2026-11-11 10:29:59'), 'blocked');
  assert.equal(st('2026-11-11 10:30:00'), 'open');
  assert.equal(st('2026-11-11 10:39:59'), 'open');
  assert.equal(st('2026-11-11 10:40:00'), 'warn');     // 끝나기 5분 전부터 안내
  assert.equal(st('2026-11-11 10:44:59'), 'warn');
  assert.equal(st('2026-11-11 10:45:00'), 'blocked');
});
test('점심 12:00~13:00', () => {
  assert.equal(st('2026-11-11 11:59:59'), 'blocked');
  assert.equal(st('2026-11-11 12:00:00'), 'open');
  assert.equal(st('2026-11-11 12:54:59'), 'open');
  assert.equal(st('2026-11-11 12:55:00'), 'warn');
  assert.equal(st('2026-11-11 12:59:59'), 'warn');
  assert.equal(st('2026-11-11 13:00:00'), 'blocked');
});
test('오후 쉬는 시간 15:30~15:45', () => {
  assert.equal(st('2026-11-11 15:29:59'), 'blocked');
  assert.equal(st('2026-11-11 15:30:00'), 'open');
  assert.equal(st('2026-11-11 15:40:00'), 'warn');
  assert.equal(st('2026-11-11 15:45:00'), 'blocked');
});
test('쉬는 시간 사이는 차단', () => { assert.equal(st('2026-11-11 11:00:00'), 'blocked'); assert.equal(st('2026-11-11 14:00:00'), 'blocked'); assert.equal(st('2026-11-11 16:30:00'), 'blocked'); });
test('주말과 공휴일의 쉬는 시간 경계에는 안내가 없다', () => { assert.equal(st('2026-11-14 10:42:00'), 'open'); assert.equal(st('2026-12-25 12:57:00'), 'open'); });
test('쉬는 시간을 비우면 09:00~18:00 내내 차단', () => { assert.equal(st('2026-11-11 12:30:00', HOLIDAYS, []), 'blocked'); assert.equal(st('2026-11-11 10:35:00', HOLIDAYS, []), 'blocked'); });
test('쉬는 시간 형식이 틀리면 알려 준다', () => {
  assert.throws(() => parseBreaks([['10:30', '10:15']]));   // 끝이 시작보다 빠름
  assert.throws(() => parseBreaks([['08:00', '08:30']]));   // 차단 시간 밖
  assert.throws(() => parseBreaks([['10시', '11시']]));
});

test('화면은 차단 3초 전부터 차단으로 본다 (퇴장 처리가 규칙에 막히지 않게). 풀리는 쪽은 당기지 않는다', () => {
  const cb = (s) => clientBlocked(at(s), HOLIDAYS, BREAKS);
  assert.equal(cb('2026-11-11 08:59:56'), false); assert.equal(cb('2026-11-11 08:59:57'), true); assert.equal(cb('2026-11-11 09:00:00'), true);
  assert.equal(cb('2026-11-11 17:59:59'), true); assert.equal(cb('2026-11-11 18:00:00'), false);
  assert.equal(cb('2026-11-11 10:29:59'), true); assert.equal(cb('2026-11-11 10:30:00'), false);   // 쉬는 시간 시작: 정각에 풀린다
  assert.equal(cb('2026-11-11 10:44:56'), false); assert.equal(cb('2026-11-11 10:44:57'), true);   // 쉬는 시간 끝: 3초 전에 내보낸다
  assert.equal(cb('2026-11-11 12:59:57'), true); assert.equal(cb('2026-11-11 15:44:57'), true);
  assert.equal(cb('2026-11-13 23:59:59'), false); // 금요일 밤 → 토요일
  assert.equal(cb('2026-11-14 08:59:59'), false); // 토요일
});
test('요일·날짜 계산', () => {
  const p = kstParts(at('2026-11-11 09:30:00'));
  assert.equal(p.dow, 3); assert.equal(p.key, '2026-11-11'); assert.equal(p.min, 570);
  assert.equal(dayNumberOf('2026-11-11'), p.day);
});
test('공휴일 파일 형식: 날짜 열쇠가 모두 올바르고 2026·2027년이 들어 있다', () => {
  const keys = Object.keys(HOLIDAYS).filter((k) => !k.startsWith('_'));
  for (const k of keys) { assert.match(k, /^\d{4}-\d{2}-\d{2}$/); assert.equal(new Date(dayNumberOf(k) * 86400000).toISOString().slice(0, 10), k); assert.equal(typeof HOLIDAYS[k], 'string'); }
  assert.ok(keys.some((k) => k.startsWith('2026-'))); assert.ok(keys.some((k) => k.startsWith('2027-')));
});
test('차단 안내 문구', () => {
  assert.equal(blockMessage([]), 'MawaVerse는 평일 오전 9시~오후 6시에는 이용할 수 없어요. 오후 6시 이후에 만나요!');
  assert.equal(blockMessage(BREAKS), 'MawaVerse는 평일 오전 9시~오후 6시에는 이용할 수 없어요. 쉬는 시간(10:30~10:45, 12:00~13:00, 15:30~15:45)이나 오후 6시 이후에 만나요!');
});
