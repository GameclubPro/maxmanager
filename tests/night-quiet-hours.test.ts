import { describe, expect, it } from 'vitest';
import { resolveNightQuietHoursWindow } from '../src/moderation/night-quiet-hours';

describe('night quiet hours resolver', () => {
  it('returns null for chats outside configured city list', () => {
    const window = resolveNightQuietHoursWindow(-999999, Date.parse('2026-02-27T22:00:00.000Z'));
    expect(window).toBeNull();
  });

  it('builds 23:00-07:00 window in Europe/Moscow for midnight hours', () => {
    const nowTs = Date.parse('2026-02-27T21:30:00.000Z'); // 00:30 local
    const window = resolveNightQuietHoursWindow(-71313986483690, nowTs); // Волгоград

    expect(window).not.toBeNull();
    expect(window?.timezone).toBe('Europe/Moscow');
    expect(window?.localHour).toBe(0);
    expect(window?.windowStartTs).toBe(Date.parse('2026-02-27T20:00:00.000Z'));
    expect(window?.windowEndTs).toBe(Date.parse('2026-02-28T04:00:00.000Z'));
  });

  it('returns null during daytime for configured city chat', () => {
    const nowTs = Date.parse('2026-02-27T12:00:00.000Z'); // 15:00 local in MSK
    const window = resolveNightQuietHoursWindow(-71313986483690, nowTs);
    expect(window).toBeNull();
  });

  it('builds correct window for Asia/Chita chat', () => {
    const nowTs = Date.parse('2026-02-27T14:10:00.000Z'); // 23:10 local in Chita
    const window = resolveNightQuietHoursWindow(-71489818560519, nowTs);

    expect(window).not.toBeNull();
    expect(window?.timezone).toBe('Asia/Chita');
    expect(window?.localHour).toBe(23);
    expect(window?.windowStartTs).toBe(Date.parse('2026-02-27T14:00:00.000Z'));
    expect(window?.windowEndTs).toBe(Date.parse('2026-02-27T22:00:00.000Z'));
  });
});
