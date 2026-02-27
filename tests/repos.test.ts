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
  photoLimitPerHour: 1,
  maxTextLength: 1200,
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

  it('tracks photo events by rolling window', () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);

    const now = Date.now();
    repos.photoEvents.add(1, 2, now - 2 * 60 * 60 * 1000);
    repos.photoEvents.add(1, 2, now - 30 * 60 * 1000);
    repos.photoEvents.add(1, 2, now - 10 * 60 * 1000);

    const countInHour = repos.photoEvents.countSince(1, 2, now - 60 * 60 * 1000);
    expect(countInHour).toBe(2);

    repos.photoEvents.purgeOlderThan(now - 60 * 60 * 1000);
    const countAfterPurge = repos.photoEvents.countSince(1, 2, now - 24 * 60 * 60 * 1000);
    expect(countAfterPurge).toBe(2);

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

  it('stores per-chat photo limit', () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);

    repos.chatSettings.setPhotoLimit(42, 0);
    const settings = repos.chatSettings.get(42);
    expect(settings.photoLimitPerHour).toBe(0);

    repos.chatSettings.setPhotoLimit(42, 5);
    const updated = repos.chatSettings.get(42);
    expect(updated.photoLimitPerHour).toBe(5);

    db.close();
  });

  it('stores per-chat price button setting', () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);

    const initial = repos.chatSettings.get(42);
    expect(initial.priceButtonEnabled).toBe(true);

    repos.chatSettings.setPriceButtonEnabled(42, false);
    const disabled = repos.chatSettings.get(42);
    expect(disabled.priceButtonEnabled).toBe(false);

    repos.chatSettings.setPriceButtonEnabled(42, true);
    const enabled = repos.chatSettings.get(42);
    expect(enabled.priceButtonEnabled).toBe(true);

    db.close();
  });

  it('caps existing text limits to configured ceiling', () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);

    repos.chatSettings.setMaxTextLength(10, 1200);
    repos.chatSettings.setMaxTextLength(11, 700);

    const updated = repos.chatSettings.capMaxTextLength(800);
    expect(updated).toBe(1);
    expect(repos.chatSettings.get(10).maxTextLength).toBe(800);
    expect(repos.chatSettings.get(11).maxTextLength).toBe(700);

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

  it('counts moderation actions by user across chats', () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);

    const now = Date.now();
    repos.moderationActions.record({
      chatId: 1,
      userId: 77,
      action: 'kick',
      reason: 'link',
    });
    repos.moderationActions.record({
      chatId: 2,
      userId: 77,
      action: 'warn',
      reason: 'spam',
    });
    repos.moderationActions.record({
      chatId: 3,
      userId: 77,
      action: 'warn',
      reason: 'anti_bot',
    });

    db.db.prepare(`
      UPDATE moderation_actions
      SET created_at = ?
      WHERE chat_id = ? AND user_id = ? AND action = ? AND reason = ?
    `).run(now - hoursToMs(80), 1, 77, 'kick', 'link');

    const warns72h = repos.moderationActions.countByUserActionSince(77, 'warn', now - hoursToMs(72));
    const spam72h = repos.moderationActions.countByUserReasonSince(77, 'spam', now - hoursToMs(72));
    const kicks72h = repos.moderationActions.countByUserActionSince(77, 'kick', now - hoursToMs(72));

    expect(warns72h).toBe(2);
    expect(spam72h).toBe(1);
    expect(kicks72h).toBe(0);

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

  it('queues bot messages for delayed auto-delete', () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);

    const now = Date.now();
    repos.botMessageDeletes.schedule('m1', now + 3_000);
    repos.botMessageDeletes.schedule('m2', now + 6_000);

    const dueEarly = repos.botMessageDeletes.listDue(now + 3_500, 10);
    expect(dueEarly.map((entry) => entry.messageId)).toEqual(['m1']);

    repos.botMessageDeletes.postpone('m1', now + 9_000);
    const dueAfterPostpone = repos.botMessageDeletes.listDue(now + 6_500, 10);
    expect(dueAfterPostpone.map((entry) => entry.messageId)).toEqual(['m2']);

    repos.botMessageDeletes.remove('m2');
    const dueAfterRemove = repos.botMessageDeletes.listDue(now + 20_000, 10);
    expect(dueAfterRemove.map((entry) => entry.messageId)).toEqual(['m1']);

    repos.botMessageDeletes.purgeOlderThan(now + 60_000);
    const dueAfterPurge = repos.botMessageDeletes.listDue(now + 120_000, 10);
    expect(dueAfterPurge).toHaveLength(0);

    db.close();
  });
});
