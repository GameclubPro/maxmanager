import { describe, expect, it } from 'vitest';
import { SqliteDatabase } from '../src/db/sqlite';
import { createRepositories } from '../src/repos';
import { BotConfig } from '../src/types';
import { toDayKey } from '../src/utils/time';
import { hoursToMs } from '../src/utils/time';

const config: BotConfig = {
  botToken: 'test',
  timezone: 'Europe/Moscow',
  dailyMessageLimit: 3,
  spamWindowSec: 10,
  spamThreshold: 3,
  strikeDecayHours: 24,
  muteHours: 1,
  banHours: 24,
  noticeInChat: true,
  databasePath: ':memory:',
  cleanupIntervalSec: 300,
};

describe('repositories', () => {
  it('increments daily counter', () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);

    const day = toDayKey(Date.now(), config.timezone);
    expect(repos.dailyCount.incrementAndGet(1, 2, day)).toBe(1);
    expect(repos.dailyCount.incrementAndGet(1, 2, day)).toBe(2);
    expect(repos.dailyCount.incrementAndGet(1, 2, day)).toBe(3);

    db.close();
  });

  it('progresses strike levels and resets after decay', () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);

    const now = Date.now();
    const decay = hoursToMs(24);

    expect(repos.strikes.registerViolation(1, 2, now, decay)).toBe(1);
    expect(repos.strikes.registerViolation(1, 2, now + 1000, decay)).toBe(2);
    expect(repos.strikes.registerViolation(1, 2, now + 2000, decay)).toBe(3);
    expect(repos.strikes.registerViolation(1, 2, now + 3000, decay)).toBe(3);
    expect(repos.strikes.registerViolation(1, 2, now + decay + 5000, decay)).toBe(1);

    db.close();
  });

  it('stores and resolves active restrictions', () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);

    const now = Date.now();
    repos.restrictions.upsert(55, 77, 'mute', now + 10_000);

    const active = repos.restrictions.getActive(55, 77, now);
    expect(active?.type).toBe('mute');

    repos.restrictions.purgeExpired(now + 15_000);
    const expired = repos.restrictions.getActive(55, 77, now + 15_000);
    expect(expired).toBeNull();

    db.close();
  });
});
