import { Context } from '@maxhub/max-bot-api';
import { describe, expect, it, vi } from 'vitest';
import { SqliteDatabase } from '../src/db/sqlite';
import { EnforcementService } from '../src/moderation/enforcement';
import { createRepositories } from '../src/repos';
import { BotConfig } from '../src/types';

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

const expectedPriceButtonExtra = {
  attachments: [
    {
      type: 'inline_keyboard',
      payload: {
        buttons: [[{ type: 'link', text: 'Прайс', url: 'https://max.ru/join/pgwSRjGbOCcwHyT0U2nckeFIl-xpwlv_7Iy5UArer6o' }]],
      },
    },
  ],
};

function makeContext() {
  const replies: string[] = [];
  const replyExtras: unknown[] = [];
  const deletedMessages: string[] = [];
  const kickedUserIds: number[] = [];
  let replyCounter = 0;

  const ctx = {
    reply: async (text: string, extra?: unknown) => {
      replies.push(text);
      replyExtras.push(extra);
      replyCounter += 1;
      return {
        body: {
          mid: `enforcement-reply-${replyCounter}`,
        },
      };
    },
    deleteMessage: async (messageId: string) => {
      deletedMessages.push(messageId);
    },
    api: {
      raw: {
        chats: {
          removeChatMember: async (payload: { user_id: number }) => {
            kickedUserIds.push(payload.user_id);
          },
        },
      },
    },
  } as unknown as Context;

  return { ctx, replies, replyExtras, deletedMessages, kickedUserIds };
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
    const { ctx, replies, replyExtras, deletedMessages } = makeContext();

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
    expect(replies[0]).toBe('«Иван», Ссылки в этом чате запрещены. Сообщение удалено. Правила в описании.');
    expect(replies[1]).toContain('«Иван», предупреждение: повторная отправка ссылок');
    expect(replies[2]).toContain('«Иван», повторное нарушение: вы получили мут на 3 часа');
    expect(replyExtras[0]).toEqual(expectedPriceButtonExtra);
    expect(replyExtras[1]).toEqual(expectedPriceButtonExtra);
    expect(replyExtras[2]).toBeUndefined();
    expect(repos.botMessageDeletes.listDue(Date.now() + 4 * 60 * 1000, 10)).toHaveLength(3);

    const activeRestriction = repos.restrictions.getActive(10, 20, Date.now());
    expect(activeRestriction?.type).toBe('mute');

    const linkActionsCount = repos.moderationActions.countByReasonSince(10, 20, 'link', Date.now() - 24 * 60 * 60 * 1000);
    expect(linkActionsCount).toBe(3);

    db.close();
  });

  it('silently deletes messages for active mute restrictions', async () => {
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

    await enforcement.enforceActiveRestriction(ctx, {
      chatId: 10,
      userId: 20,
      userName: 'Иван',
      messageId: 'm-mute',
      restrictionType: 'mute',
      untilTs: Date.now() + 60_000,
      createdAtTs: Date.now() - 1_000,
    });

    expect(deletedMessages).toEqual(['m-mute']);
    expect(replies).toHaveLength(0);

    db.close();
  });

  it('temporarily kicks user for 3 hours after more than 5 messages during mute', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    repos.restrictions.upsert(10, 20, 'mute', Date.now() + 60 * 60 * 1000);

    const logger = {
      warn: async () => {},
      error: async () => {},
      moderation: async () => {},
      info: async () => {},
    } as any;
    const enforcement = new EnforcementService(repos, config, logger);
    const { ctx, replies, deletedMessages, kickedUserIds } = makeContext();

    const activeRestriction = repos.restrictions.getActive(10, 20, Date.now());
    expect(activeRestriction).not.toBeNull();

    for (let i = 1; i <= 6; i += 1) {
      await enforcement.enforceActiveRestriction(ctx, {
        chatId: 10,
        userId: 20,
        userName: 'Иван',
        messageId: `mute-${i}`,
        restrictionType: 'mute',
        untilTs: activeRestriction!.untilTs,
        createdAtTs: activeRestriction!.createdAtTs,
      });
    }

    expect(deletedMessages).toHaveLength(6);
    expect(replies).toHaveLength(0);
    expect(kickedUserIds).toEqual([20]);

    const pending = repos.pendingRejoins.listDue(Date.now() + 4 * 60 * 60 * 1000, 10);
    expect(pending.some((entry) => entry.chatId === 10 && entry.userId === 20)).toBe(true);

    db.close();
  });

  it('warns once per hour for photo limit and mutes on 6th photo violation', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const logger = {
      warn: async () => {},
      error: async () => {},
      moderation: async () => {},
      info: async () => {},
    } as any;
    const enforcement = new EnforcementService(repos, config, logger);
    const { ctx, replies, replyExtras, deletedMessages } = makeContext();
    const now = Date.now();
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

    for (let i = 0; i < 6; i += 1) {
      await enforcement.enforcePhotoQuotaViolation(
        ctx,
        {
          chatId: 10,
          userId: 20,
          userName: 'Иван',
          messageId: `photo-${i + 1}`,
        },
        i + 2,
        1,
      );
    }

    expect(deletedMessages).toHaveLength(6);
    expect(replies).toHaveLength(2);
    expect(replies[0]).toContain('«Иван», в этом чате можно отправлять не более 1 фото-сообщений в час.');
    expect(replies[1]).toContain('«Иван», вы продолжили отправку фото сверх лимита. Выдан мут на 3 часа.');
    expect(replyExtras[0]).toEqual({ notify: false });
    expect(replyExtras[1]).toEqual({ notify: false });

    const activeRestriction = repos.restrictions.getActive(10, 20, now);
    expect(activeRestriction?.type).toBe('mute');

    dateNowSpy.mockRestore();
    db.close();
  });

  it('deletes too long text and warns user with highlighted name', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const logger = {
      warn: async () => {},
      error: async () => {},
      moderation: async () => {},
      info: async () => {},
    } as any;
    const enforcement = new EnforcementService(repos, config, logger);
    const { ctx, replies, replyExtras, deletedMessages } = makeContext();

    await enforcement.enforceTextLengthViolation(
      ctx,
      {
        chatId: 10,
        userId: 20,
        userName: 'Иван',
        messageId: 'long-text-1',
      },
      1500,
      1200,
    );

    expect(deletedMessages).toEqual(['long-text-1']);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toBe('«Иван», сообщение слишком длинное (1500 символов). Допустимо до 1200 символов.');
    expect(replyExtras[0]).toEqual({ notify: false });

    db.close();
  });
});
