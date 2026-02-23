import { describe, expect, it } from 'vitest';
import { toDayKey } from '../src/utils/time';

describe('toDayKey', () => {
  it('uses Europe/Moscow day boundary', () => {
    const beforeMoscowMidnight = Date.parse('2026-02-23T20:59:59.000Z');
    const afterMoscowMidnight = Date.parse('2026-02-23T21:00:00.000Z');

    expect(toDayKey(beforeMoscowMidnight, 'Europe/Moscow')).toBe('2026-02-23');
    expect(toDayKey(afterMoscowMidnight, 'Europe/Moscow')).toBe('2026-02-24');
  });
});
