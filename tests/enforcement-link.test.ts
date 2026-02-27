import { Context } from '@maxhub/max-bot-api';
import { describe, expect, it, vi } from 'vitest';
import { SqliteDatabase } from '../src/db/sqlite';
import { EnforcementService } from '../src/moderation/enforcement';
import { AntiBotAssessment } from '../src/moderation/anti-bot';
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
    const { ctx, replies, replyExtras, deletedMessages, kickedUserIds } = makeContext();

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

    await enforcement.enforceLinkViolation(ctx, {
      chatId: 10,
      userId: 20,
      userName: 'Иван',
      messageId: 'm4',
    }, { source: 'test' });

    expect(deletedMessages).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(replies[0]).toBe('«Иван», Ссылки в этом чате запрещены. Сообщение удалено. Правила в описании.');
    expect(replies[1]).toContain('«Иван», предупреждение: повторная отправка ссылок');
    expect(replies[2]).toContain('«Иван», крайнее предупреждение: следующая ссылка в течение 24 часов приведет к удалению из чата.');
    expect(replies[3]).toContain('«Иван», повторное нарушение: вы удалены из чата за отправку ссылок в течение 24 часов.');
    expect(replyExtras[0]).toEqual(expectedPriceButtonExtra);
    expect(replyExtras[1]).toEqual(expectedPriceButtonExtra);
    expect(replyExtras[2]).toEqual(expectedPriceButtonExtra);
    expect(replyExtras[3]).toBeUndefined();
    expect(repos.botMessageDeletes.listDue(Date.now() + 4 * 60 * 1000, 10)).toHaveLength(4);
    expect(kickedUserIds).toEqual([20]);

    const activeRestriction = repos.restrictions.getActive(10, 20, Date.now());
    expect(activeRestriction).toBeNull();

    const linkActionsCount = repos.moderationActions.countByReasonSince(10, 20, 'link', Date.now() - 24 * 60 * 60 * 1000);
    expect(linkActionsCount).toBe(4);

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

  it('deletes first duplicate message and sends explanation', async () => {
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

    await enforcement.enforceDuplicateViolation(
      ctx,
      {
        chatId: 10,
        userId: 20,
        userName: 'Иван',
        messageId: 'dup-1',
      },
      {
        windowHours: 12,
        secondsSincePrevious: 45,
      },
    );

    expect(deletedMessages).toEqual(['dup-1']);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toBe('«Иван», дубликат удален. Одно и то же сообщение можно отправлять не чаще 1 раза в 12 часов.');
    expect(replyExtras[0]).toEqual({ notify: false });

    const duplicateDeletes = repos.moderationActions.countByActionAndReasonSince(
      10,
      20,
      'delete_message',
      'duplicate',
      Date.now() - 60_000,
    );
    const duplicateWarns = repos.moderationActions.countByActionAndReasonSince(
      10,
      20,
      'warn',
      'duplicate',
      Date.now() - 60_000,
    );
    expect(duplicateDeletes).toBe(1);
    expect(duplicateWarns).toBe(0);

    db.close();
  });

  it('escalates duplicates in 12h: explanation, warning, then kick', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const logger = {
      warn: async () => {},
      error: async () => {},
      moderation: async () => {},
      info: async () => {},
    } as any;
    const enforcement = new EnforcementService(repos, config, logger);
    const { ctx, replies, replyExtras, deletedMessages, kickedUserIds } = makeContext();

    await enforcement.enforceDuplicateViolation(
      ctx,
      { chatId: 10, userId: 20, userName: 'Иван', messageId: 'dup-e1' },
      { previousChatId: 10, currentChatId: 10 },
    );
    await enforcement.enforceDuplicateViolation(
      ctx,
      { chatId: 11, userId: 20, userName: 'Иван', messageId: 'dup-e2' },
      { previousChatId: 10, currentChatId: 11 },
    );
    await enforcement.enforceDuplicateViolation(
      ctx,
      { chatId: 12, userId: 20, userName: 'Иван', messageId: 'dup-e3' },
      { previousChatId: 11, currentChatId: 12 },
    );

    expect(deletedMessages).toEqual(['dup-e1', 'dup-e2', 'dup-e3']);
    expect(replies).toHaveLength(3);
    expect(replies[0]).toContain('«Иван», дубликат удален.');
    expect(replies[1]).toContain('«Иван», предупреждение: повторный дубликат за 12 часов.');
    expect(replies[2]).toContain('«Иван», вы удалены из чата: 3 дубля за 12 часов.');
    expect(replyExtras[0]).toEqual({ notify: false });
    expect(replyExtras[1]).toEqual({ notify: false });
    expect(replyExtras[2]).toEqual({ notify: false });
    expect(kickedUserIds).toEqual([20]);

    const duplicateDeletes = repos.moderationActions.countByUserActionAndReasonSince(
      20,
      'delete_message',
      'duplicate',
      Date.now() - 60_000,
    );
    const duplicateWarns = repos.moderationActions.countByUserActionAndReasonSince(
      20,
      'warn',
      'duplicate',
      Date.now() - 60_000,
    );
    const duplicateKicks = repos.moderationActions.countByUserActionAndReasonSince(
      20,
      'kick',
      'duplicate',
      Date.now() - 60_000,
    );

    expect(duplicateDeletes).toBe(3);
    expect(duplicateWarns).toBe(1);
    expect(duplicateKicks).toBe(1);

    db.close();
  });

  it('auto-removes user after second mute within 24 hours', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const logger = {
      warn: async () => {},
      error: async () => {},
      moderation: async () => {},
      info: async () => {},
    } as any;
    const enforcement = new EnforcementService(repos, config, logger);
    const { ctx, kickedUserIds } = makeContext();

    const now = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
    const assessment: AntiBotAssessment = {
      totalScore: 85,
      shouldAct: true,
      shouldMute: true,
      signals: [
        { type: 'behavior', key: 'burst_10s', score: 45, value: 6 },
        { type: 'content', key: 'suspicious_patterns', score: 30, value: 'money_offer,external_contact' },
      ],
    };

    await enforcement.enforceAntiBotViolation(ctx, {
      chatId: 10,
      userId: 20,
      userName: 'Иван',
      messageId: 'antibot-1',
    }, assessment);

    await enforcement.enforceAntiBotViolation(ctx, {
      chatId: 10,
      userId: 20,
      userName: 'Иван',
      messageId: 'antibot-2',
    }, assessment);

    expect(kickedUserIds).toEqual([20]);

    const autoKickCount = repos.moderationActions.countByActionAndReasonSince(
      10,
      20,
      'kick_auto',
      'mute_repeat_24h',
      now - 24 * 60 * 60 * 1000,
    );
    expect(autoKickCount).toBe(1);

    nowSpy.mockRestore();
    db.close();
  });

  it('sends admin alert after kick for spam with reason details', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const logger = {
      warn: vi.fn(async () => {}),
      error: async () => {},
      moderation: async () => {},
      info: async () => {},
    } as any;
    const enforcement = new EnforcementService(repos, config, logger);
    const { ctx, kickedUserIds } = makeContext();

    await enforcement.enforceSpamViolation(ctx, {
      chatId: 10,
      userId: 20,
      userName: 'Иван',
      messageId: 'spam-1',
    }, 4);

    await enforcement.enforceSpamViolation(ctx, {
      chatId: 10,
      userId: 20,
      userName: 'Иван',
      messageId: 'spam-2',
    }, 5);

    await enforcement.enforceSpamViolation(ctx, {
      chatId: 10,
      userId: 20,
      userName: 'Иван',
      messageId: 'spam-3',
    }, 6);

    expect(kickedUserIds).toEqual([20]);
    expect(logger.warn).toHaveBeenCalledWith(
      'Spam kick executed',
      expect.objectContaining({
        chatId: 10,
        userId: 20,
        reason: 'spam',
        strikeLevel: 3,
        messageCountInWindow: 6,
        spamWindowSec: config.spamWindowSec,
        blocked: true,
      }),
    );

    db.close();
  });

  it('retries remove member via query params when API reports missing user_id in DELETE body', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const logger = {
      warn: vi.fn(async () => {}),
      error: async () => {},
      moderation: async () => {},
      info: async () => {},
    } as any;
    const enforcement = new EnforcementService(repos, config, logger);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as any);

    const ctx = {
      reply: async () => ({ body: { mid: 'enforcement-reply-fallback-1' } }),
      deleteMessage: async () => {},
      api: {
        raw: {
          chats: {
            removeChatMember: async () => {
              throw new Error('400: Missing required parameter: user_id');
            },
          },
        },
      },
    } as unknown as Context;

    await enforcement.enforceSpamViolation(ctx, {
      chatId: 10,
      userId: 20,
      userName: 'Иван',
      messageId: 'spam-fallback-1',
    }, 4);
    await enforcement.enforceSpamViolation(ctx, {
      chatId: 10,
      userId: 20,
      userName: 'Иван',
      messageId: 'spam-fallback-2',
    }, 5);
    await enforcement.enforceSpamViolation(ctx, {
      chatId: 10,
      userId: 20,
      userName: 'Иван',
      messageId: 'spam-fallback-3',
    }, 6);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/chats/10/members');
    expect(String(url)).toContain('user_id=20');
    expect(String(url)).toContain('block=true');
    expect(init).toEqual(expect.objectContaining({ method: 'DELETE' }));

    const banCount = repos.moderationActions.countByActionAndReasonSince(
      10,
      20,
      'ban',
      'spam',
      Date.now() - 60_000,
    );
    const banFallbackCount = repos.moderationActions.countByActionAndReasonSince(
      10,
      20,
      'ban_fallback',
      'spam',
      Date.now() - 60_000,
    );

    expect(banCount).toBe(1);
    expect(banFallbackCount).toBe(0);

    fetchSpy.mockRestore();
    db.close();
  });
});
