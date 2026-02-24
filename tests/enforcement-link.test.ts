import { Context } from '@maxhub/max-bot-api';
import { describe, expect, it } from 'vitest';
import { SqliteDatabase } from '../src/db/sqlite';
import { EnforcementService } from '../src/moderation/enforcement';
import { createRepositories } from '../src/repos';
import { BotConfig } from '../src/types';

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

function makeContext() {
  const replies: string[] = [];
  const deletedMessages: string[] = [];

  const ctx = {
    reply: async (text: string) => {
      replies.push(text);
    },
    deleteMessage: async (messageId: string) => {
      deletedMessages.push(messageId);
    },
    api: {
      raw: {
        chats: {},
      },
    },
  } as unknown as Context;

  return { ctx, replies, deletedMessages };
}

describe('enforcement link violations', () => {
  it('escalates link sanctions in a 24-hour window and uses user name in notices', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const logger = {
      warn: async () => {},
      error: async () => {},
      moderation: async () => {},
      info: async () => {},
    } as any;
    const enforcement = new EnforcementService(repos, config, logger);
    const { ctx, replies, deletedMessages } = makeContext();

    await enforcement.enforceLinkViolation(ctx, {
      chatId: 10,
      userId: 20,
      userName: 'Иван',
      messageId: 'm1',
    }, { source: 'test' });

    await enforcement.enforceLinkViolation(ctx, {
      chatId: 10,
      userId: 20,
      userName: 'Иван',
      messageId: 'm2',
    }, { source: 'test' });

    await enforcement.enforceLinkViolation(ctx, {
      chatId: 10,
      userId: 20,
      userName: 'Иван',
      messageId: 'm3',
    }, { source: 'test' });

    expect(deletedMessages).toEqual(['m1', 'm2', 'm3']);
    expect(replies[0]).toBe('Иван, Ссылки в этом чате запрещены. Сообщение удалено. Правила в описании.');
    expect(replies[1]).toContain('Иван, предупреждение: повторная отправка ссылок');
    expect(replies[2]).toContain('Иван, повторное нарушение: вы получили мут на 3 часа');

    const activeRestriction = repos.restrictions.getActive(10, 20, Date.now());
    expect(activeRestriction?.type).toBe('mute');

    const linkActionsCount = repos.moderationActions.countByReasonSince(10, 20, 'link', Date.now() - 24 * 60 * 60 * 1000);
    expect(linkActionsCount).toBe(3);

    db.close();
  });
});
