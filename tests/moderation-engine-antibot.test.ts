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

describe('moderation engine anti-bot integration', () => {
  it('routes suspicious message to anti-bot enforcement', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const antiBotCalls: Array<{ totalScore: number; shouldMute: boolean }> = [];
    let spamCalled = false;

    const now = Date.now();
    for (let i = 0; i < 5; i += 1) {
      repos.messageEvents.add(100, 10, now - i * 1_000);
    }

    const enforcement = {
      enforceActiveRestriction: async () => {},
      enforceLinkViolation: async () => {},
      enforceTextLengthViolation: async () => {},
      enforcePhotoQuotaViolation: async () => {},
      enforceQuotaViolation: async () => {},
      enforceSpamViolation: async () => {
        spamCalled = true;
      },
      enforceAntiBotViolation: async (_ctx: unknown, _args: unknown, assessment: { totalScore: number; shouldMute: boolean }) => {
        antiBotCalls.push(assessment);
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
        mid: 'antibot-msg-1',
        text: 'Быстрый заработок!!! Пиши в лс, есть крипт-доход и прибыль!!!',
        attachments: null,
      },
    };

    await engine.handleMessage(makeContext(message));

    expect(antiBotCalls).toHaveLength(1);
    expect(antiBotCalls[0].totalScore).toBeGreaterThanOrEqual(45);
    expect(antiBotCalls[0].shouldMute).toBe(true);
    expect(spamCalled).toBe(false);

    db.close();
  });
});
