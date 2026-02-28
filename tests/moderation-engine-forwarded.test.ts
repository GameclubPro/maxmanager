import { describe, expect, it } from 'vitest';
import { SqliteDatabase } from '../src/db/sqlite';
import { ModerationEngine } from '../src/moderation/moderation-engine';
import { createRepositories } from '../src/repos';
import { InMemoryIdempotencyGuard } from '../src/services/idempotency';
import { BotConfig, IncomingMessage } from '../src/types';

const config: BotConfig = {
  botToken: 'test',
  timezone: 'Europe/Moscow',
  dailyMessageLimit: 0,
  photoLimitPerHour: 1,
  maxTextLength: 800,
  spamWindowSec: 10,
  spamThreshold: 100,
  strikeDecayHours: 24,
  muteHours: 1,
  banHours: 24,
  noticeInChat: true,
  databasePath: ':memory:',
  cleanupIntervalSec: 300,
};

function makeBaseMessage(mid: string): IncomingMessage {
  return {
    sender: { user_id: 10, name: 'Иван' },
    recipient: { chat_id: 100, chat_type: 'chat' },
    body: {
      mid,
      text: 'обычный текст',
      attachments: null,
    },
  };
}

function makeContext(message: IncomingMessage) {
  return {
    message,
    chatId: message.recipient.chat_id,
    myId: 999,
  } as any;
}

describe('moderation engine forwarded messages', () => {
  it('does not treat forwarded message without links as violation', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const linkViolations: unknown[] = [];

    const enforcement = {
      enforceActiveRestriction: async () => {},
      enforceLinkViolation: async (_ctx: unknown, _args: unknown, meta: unknown) => {
        linkViolations.push(meta);
      },
      enforceTextLengthViolation: async () => {},
      enforcePhotoQuotaViolation: async () => {},
      enforceQuotaViolation: async () => {},
      enforceSpamViolation: async () => {},
      enforceAntiBotViolation: async () => {},
      handleCriticalFailure: async () => {},
    } as any;

    const logger = {
      info: async () => {},
      warn: async () => {},
      error: async () => {},
      moderation: async () => {},
    } as any;

    const engine = new ModerationEngine(
      config,
      repos,
      { isAdmin: async () => false } as any,
      new InMemoryIdempotencyGuard(),
      enforcement,
      logger,
    );

    const message: IncomingMessage = {
      ...makeBaseMessage('fwd-1'),
      link: {
        type: 'forward',
        message: {
          text: 'пересланное без ссылки',
          attachments: null,
        },
      },
    };

    await engine.handleMessage(makeContext(message));

    expect(linkViolations).toHaveLength(0);
    db.close();
  });

  it('treats forwarded message with forbidden link as violation', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const linkViolations: unknown[] = [];

    const enforcement = {
      enforceActiveRestriction: async () => {},
      enforceLinkViolation: async (_ctx: unknown, _args: unknown, meta: unknown) => {
        linkViolations.push(meta);
      },
      enforceTextLengthViolation: async () => {},
      enforcePhotoQuotaViolation: async () => {},
      enforceQuotaViolation: async () => {},
      enforceSpamViolation: async () => {},
      enforceAntiBotViolation: async () => {},
      handleCriticalFailure: async () => {},
    } as any;

    const logger = {
      info: async () => {},
      warn: async () => {},
      error: async () => {},
      moderation: async () => {},
    } as any;

    const engine = new ModerationEngine(
      config,
      repos,
      { isAdmin: async () => false } as any,
      new InMemoryIdempotencyGuard(),
      enforcement,
      logger,
    );

    const message: IncomingMessage = {
      ...makeBaseMessage('fwd-link-1'),
      link: {
        type: 'forward',
        message: {
          text: 'ссылка https://spam.example.org',
          attachments: null,
        },
      },
    };

    await engine.handleMessage(makeContext(message));

    expect(linkViolations).toHaveLength(1);
    const [firstViolation] = linkViolations as Array<{ forbiddenLinks?: Array<{ domain: string | null }> }>;
    expect(firstViolation.forbiddenLinks?.some((item) => item.domain === 'spam.example.org')).toBe(true);
    db.close();
  });

  it('applies text length limit to forwarded message text', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    repos.chatSettings.setMaxTextLength(100, 10);
    const textViolations: Array<{ textLength: number; maxLength: number }> = [];

    const enforcement = {
      enforceActiveRestriction: async () => {},
      enforceLinkViolation: async () => {},
      enforceTextLengthViolation: async (
        _ctx: unknown,
        _args: unknown,
        currentTextLength: number,
        maxTextLength: number,
      ) => {
        textViolations.push({ textLength: currentTextLength, maxLength: maxTextLength });
      },
      enforcePhotoQuotaViolation: async () => {},
      enforceQuotaViolation: async () => {},
      enforceSpamViolation: async () => {},
      enforceAntiBotViolation: async () => {},
      handleCriticalFailure: async () => {},
    } as any;

    const logger = {
      info: async () => {},
      warn: async () => {},
      error: async () => {},
      moderation: async () => {},
    } as any;

    const engine = new ModerationEngine(
      config,
      repos,
      { isAdmin: async () => false } as any,
      new InMemoryIdempotencyGuard(),
      enforcement,
      logger,
    );

    const message: IncomingMessage = {
      ...makeBaseMessage('fwd-long-1'),
      body: {
        mid: 'fwd-long-1',
        text: null,
        attachments: null,
      },
      link: {
        type: 'forward',
        message: {
          text: '12345678901',
          attachments: null,
        },
      },
    };

    await engine.handleMessage(makeContext(message));

    expect(textViolations).toEqual([{ textLength: 11, maxLength: 10 }]);
    db.close();
  });

  it('treats forwarded photo with forbidden link as violation', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const linkViolations: unknown[] = [];

    const enforcement = {
      enforceActiveRestriction: async () => {},
      enforceLinkViolation: async (_ctx: unknown, _args: unknown, meta: unknown) => {
        linkViolations.push(meta);
      },
      enforceTextLengthViolation: async () => {},
      enforceDuplicateViolation: async () => {},
      enforcePhotoQuotaViolation: async () => {},
      enforceQuotaViolation: async () => {},
      enforceSpamViolation: async () => {},
      enforceAntiBotViolation: async () => {},
      handleCriticalFailure: async () => {},
    } as any;

    const logger = {
      info: async () => {},
      warn: async () => {},
      error: async () => {},
      moderation: async () => {},
    } as any;

    const engine = new ModerationEngine(
      config,
      repos,
      { isAdmin: async () => false } as any,
      new InMemoryIdempotencyGuard(),
      enforcement,
      logger,
    );

    const message: IncomingMessage = {
      ...makeBaseMessage('fwd-photo-link-1'),
      body: {
        mid: 'fwd-photo-link-1',
        text: null,
        attachments: null,
      },
      link: {
        type: 'forward',
        message: {
          text: 'https://spam.example.org',
          attachments: [{ type: 'image', payload: { photo_id: 1 } }],
          markup: null,
        },
      },
    };

    await engine.handleMessage(makeContext(message));

    expect(linkViolations).toHaveLength(1);
    const [firstViolation] = linkViolations as Array<{ forbiddenLinks?: Array<{ domain: string | null }> }>;
    expect(firstViolation.forbiddenLinks?.some((item) => item.domain === 'spam.example.org')).toBe(true);
    db.close();
  });
});
