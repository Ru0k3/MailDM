import test from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentWeekStart, buildUnreadWeekQuery } from '../src/gmail/query.js';

test('getCurrentWeekStart returns the same Monday when the date is Monday', () => {
  assert.equal(getCurrentWeekStart(new Date('2026-08-31T12:00:00Z')), '2026-08-31');
});

test('getCurrentWeekStart returns the most recent Monday for dates later in the week', () => {
  assert.equal(getCurrentWeekStart(new Date('2026-09-03T12:00:00Z')), '2026-08-31');
  assert.equal(getCurrentWeekStart(new Date('2026-09-06T12:00:00Z')), '2026-08-31');
});

test('getCurrentWeekStart computes the Monday in the requested timezone', () => {
  assert.equal(getCurrentWeekStart(new Date('2026-08-31T00:30:00Z'), 'America/Los_Angeles'), '2026-08-24');
});

test('buildUnreadWeekQuery includes unread and the current week after date', () => {
  assert.equal(
    buildUnreadWeekQuery({ date: new Date('2026-09-03T12:00:00Z'), timeZone: 'UTC' }),
    'is:unread after:2026/08/31'
  );
});
