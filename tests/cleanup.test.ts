import { describe, expect, it } from 'vitest';
import { SqliteDatabase } from '../src/db/sqlite';
import { createRepositories } from '../src/repos';
import { CleanupService } from '../src/services/cleanup';
import { BotConfig } from '../src/types';

const config: BotConfig = {
  botToken: 'test',
  timezone: 'Europe/Moscow',
  dailyMessageLimit: 3,
  photoLimitPerHour: 1,
  spamWindowSec: 10,
  spamThreshold: 3,
  strikeDecayHours: 24,
  muteHours: 1,
  banHours: 24,
  noticeInChat: true,
  databasePath: ':memory:',
  cleanupIntervalSec: 300,
};

describe('cleanup service', () => {
  it('re-adds due users from pending rejoin queue', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const now = Date.now();

    repos.pendingRejoins.upsert(100, 200, now - 1_000);

    const rejoinCalls: Array<{ chatId: number; userIds: number[] }> = [];
    const api = {
      addChatMembers: async (chatId: number, userIds: number[]) => {
        rejoinCalls.push({ chatId, userIds });
      },
    } as any;
    const logger = {
      info: async () => {},
      warn: async () => {},
      error: async () => {},
      moderation: async () => {},
    } as any;

    const cleanup = new CleanupService(repos, config, api, logger);
    await cleanup.run(now);

    expect(rejoinCalls).toEqual([{ chatId: 100, userIds: [200] }]);
    expect(repos.pendingRejoins.listDue(now + 1_000, 10)).toHaveLength(0);

    db.close();
  });

  it('postpones failed rejoin attempts', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const now = Date.now();

    repos.pendingRejoins.upsert(300, 400, now - 1_000);

    const api = {
      addChatMembers: async () => {
        throw new Error('forbidden');
      },
    } as any;
    const logger = {
      info: async () => {},
      warn: async () => {},
      error: async () => {},
      moderation: async () => {},
    } as any;

    const cleanup = new CleanupService(repos, config, api, logger);
    await cleanup.run(now);

    expect(repos.pendingRejoins.listDue(now + 1_000, 10)).toHaveLength(0);
    const dueAfterRetryDelay = repos.pendingRejoins.listDue(now + 11 * 60 * 1000, 10);
    expect(dueAfterRetryDelay).toHaveLength(1);
    expect(dueAfterRetryDelay[0].chatId).toBe(300);
    expect(dueAfterRetryDelay[0].userId).toBe(400);

    db.close();
  });
});
