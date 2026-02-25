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
});
