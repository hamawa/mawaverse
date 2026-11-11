import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMapId, playerMapId, sameMap, occupancyKey } from '../src/shared/maps.ts';

test('기존 사용자와 새 기본 맵 사용자는 같은 공간에 속한다', () => {
  assert.equal(playerMapId({}), 'main');
  assert.equal(sameMap({}, { m: 'main' }), true);
  assert.equal(sameMap({ m: 'main' }, { m: 'portal-garden' }), false);
});

test('같은 좌표라도 다른 맵의 자리 점유는 충돌하지 않는다', () => {
  assert.equal(occupancyKey('main', 3, 4), '3_4');
  assert.equal(occupancyKey('portal-garden', 3, 4), 'portal-garden~3_4');
  assert.notEqual(occupancyKey('island', 3, 4), occupancyKey('portal-garden', 3, 4));
});

test('목적지 맵 ID는 Firebase 경로 구분자와 잘못된 형식을 거부한다', () => {
  assert.equal(isMapId('island_2'), true);
  for (const value of ['', 'maps/island', '../island', 'a.b', 'a#b', 'a$b', 'a[b]', 'a'.repeat(21), null, 1]) {
    assert.equal(isMapId(value), false);
  }
});
