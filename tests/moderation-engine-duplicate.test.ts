import { describe, expect, it, vi } from 'vitest';
import { SqliteDatabase } from '../src/db/sqlite';
import { ModerationEngine } from '../src/moderation/moderation-engine';
import { createRepositories } from '../src/repos';
import { InMemoryIdempotencyGuard } from '../src/services/idempotency';
import { BotConfig, IncomingMessage } from '../src/types';

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

function makeTextMessage(mid: string, text: string): IncomingMessage {
  return {
    sender: { user_id: 10, name: 'Иван' },
    recipient: { chat_id: 100, chat_type: 'chat' },
    body: {
      mid,
      text,
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

describe('moderation engine duplicate messages', () => {
  it('deletes duplicate text and warns user', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const duplicateViolations: Array<Record<string, unknown>> = [];
    let antiBotCalled = false;
    let spamCalled = false;

    const enforcement = {
      enforceActiveRestriction: async () => {},
      enforceGlobalSpammerViolation: async () => {},
      enforceLinkViolation: async () => {},
      enforceTextLengthViolation: async () => {},
      enforceDuplicateViolation: async (_ctx: unknown, _args: unknown, meta: Record<string, unknown>) => {
        duplicateViolations.push(meta);
      },
      enforcePhotoQuotaViolation: async () => {},
      enforceQuotaViolation: async () => {},
      enforceSpamViolation: async () => {
        spamCalled = true;
      },
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

    const nowSpy = vi.spyOn(Date, 'now');
    const baseTs = 1_700_000_000_000;

    nowSpy.mockReturnValue(baseTs);
    await engine.handleMessage(makeContext(makeTextMessage('dup-1', 'Продам велосипед почти новый')));

    nowSpy.mockReturnValue(baseTs + 20_000);
    await engine.handleMessage(makeContext(makeTextMessage('dup-2', 'ПРОДАМ велосипед, почти новый!!!')));

    expect(duplicateViolations).toHaveLength(1);
    expect(duplicateViolations[0]).toMatchObject({
      windowHours: 24,
      secondsSincePrevious: 20,
    });
    expect(duplicateViolations[0].signatureLength).toEqual(expect.any(Number));
    expect(antiBotCalled).toBe(false);
    expect(spamCalled).toBe(false);

    nowSpy.mockRestore();
    db.close();
  });
});

