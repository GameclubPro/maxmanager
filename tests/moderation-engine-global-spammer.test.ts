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

function makeContext(message: IncomingMessage) {
  return {
    message,
    chatId: message.recipient.chat_id,
    myId: 999,
  } as any;
}

describe('moderation engine global spammer detection', () => {
  it('kicks user with severe cross-chat spam history before content checks', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const globalSpammerCalls: Array<Record<string, unknown>> = [];
    let antiBotCalled = false;
    let linkCalled = false;

    repos.moderationActions.record({ chatId: 500, userId: 10, action: 'ban', reason: 'spam' });
    repos.moderationActions.record({ chatId: 500, userId: 10, action: 'warn', reason: 'spam' });
    repos.moderationActions.record({ chatId: 501, userId: 10, action: 'warn', reason: 'anti_bot' });
    repos.moderationActions.record({ chatId: 502, userId: 10, action: 'mute', reason: 'spam' });

    const enforcement = {
      enforceActiveRestriction: async () => {},
      enforceGlobalSpammerViolation: async (_ctx: unknown, _args: unknown, meta: Record<string, unknown>) => {
        globalSpammerCalls.push(meta);
      },
      enforceLinkViolation: async () => {
        linkCalled = true;
      },
      enforceTextLengthViolation: async () => {},
      enforcePhotoQuotaViolation: async () => {},
      enforceQuotaViolation: async () => {},
      enforceSpamViolation: async () => {},
      enforceAntiBotViolation: async () => {
        antiBotCalled = true;
      },
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
      sender: { user_id: 10, name: 'Иван' },
      recipient: { chat_id: 100, chat_type: 'chat' },
      body: {
        mid: 'global-spam-1',
        text: 'обычный текст без ссылок',
        attachments: null,
      },
    };

    await engine.handleMessage(makeContext(message));

    expect(globalSpammerCalls).toHaveLength(1);
    expect(globalSpammerCalls[0]).toMatchObject({
      windowHours: 72,
      severeActions: 1,
      spamEvents: 3,
      linkEvents: 0,
      antiBotEvents: 1,
    });
    expect(linkCalled).toBe(false);
    expect(antiBotCalled).toBe(false);

    db.close();
  });
});
