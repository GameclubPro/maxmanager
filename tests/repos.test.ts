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

  it('counts moderation actions by reason for time window', () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);

    const now = Date.now();
    repos.moderationActions.record({
      chatId: 1,
      userId: 2,
      action: 'delete_message',
      reason: 'link',
    });
    repos.moderationActions.record({
      chatId: 1,
      userId: 2,
      action: 'warn',
      reason: 'link',
    });
    repos.moderationActions.record({
      chatId: 1,
      userId: 2,
      action: 'mute',
      reason: 'spam',
    });

    db.db.prepare(`
      UPDATE moderation_actions
      SET created_at = ?
      WHERE chat_id = ? AND user_id = ? AND action = ? AND reason = ?
    `).run(now - hoursToMs(25), 1, 2, 'delete_message', 'link');

    const count = repos.moderationActions.countByReasonSince(1, 2, 'link', now - hoursToMs(24));
    expect(count).toBe(1);
    const countByAction = repos.moderationActions.countByActionAndReasonSince(
      1,
      2,
      'warn',
      'link',
      now - hoursToMs(24),
    );
    expect(countByAction).toBe(1);

    db.close();
  });

  it('queues and resolves pending rejoins', () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);

    const now = Date.now();
    repos.pendingRejoins.upsert(10, 20, now + 10_000);

    const dueNow = repos.pendingRejoins.listDue(now, 10);
    expect(dueNow).toHaveLength(0);

    const dueLater = repos.pendingRejoins.listDue(now + 20_000, 10);
    expect(dueLater).toHaveLength(1);
    expect(dueLater[0].chatId).toBe(10);
    expect(dueLater[0].userId).toBe(20);

    repos.pendingRejoins.postpone(10, 20, now + 50_000);
    const dueAfterPostpone = repos.pendingRejoins.listDue(now + 20_000, 10);
    expect(dueAfterPostpone).toHaveLength(0);

    repos.pendingRejoins.remove(10, 20);
    const dueAfterRemove = repos.pendingRejoins.listDue(now + 60_000, 10);
    expect(dueAfterRemove).toHaveLength(0);

    db.close();
  });
});
