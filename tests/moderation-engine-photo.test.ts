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

function makePhotoMessage(mid: string): IncomingMessage {
  return {
    sender: { user_id: 10, name: 'Иван' },
    recipient: { chat_id: 100, chat_type: 'chat' },
    body: {
      mid,
      text: null,
      attachments: [{ type: 'image', payload: { photo_id: 1 } }],
    },
  };
}

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

describe('moderation engine photo limit', () => {
  it('allows first photo, blocks second in hour, allows after hour window', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const photoViolations: Array<{ currentCount: number; limit: number }> = [];

    const enforcement = {
      enforceActiveRestriction: async () => {},
      enforceLinkViolation: async () => {},
      enforcePhotoQuotaViolation: async (
        _ctx: unknown,
        _args: unknown,
        currentPhotoCountInWindow: number,
        limitPerHour: number,
      ) => {
        photoViolations.push({ currentCount: currentPhotoCountInWindow, limit: limitPerHour });
      },
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

    const nowSpy = vi.spyOn(Date, 'now');
    const baseTs = 1_700_000_000_000;

    nowSpy.mockReturnValue(baseTs);
    await engine.handleMessage(makeContext(makePhotoMessage('m1')));

    nowSpy.mockReturnValue(baseTs + 15_000);
    await engine.handleMessage(makeContext(makePhotoMessage('m2')));

    nowSpy.mockReturnValue(baseTs + 61 * 60 * 1000);
    await engine.handleMessage(makeContext(makePhotoMessage('m3')));

    expect(photoViolations).toHaveLength(1);
    expect(photoViolations[0]).toEqual({ currentCount: 2, limit: 1 });

    const recentPhotos = repos.photoEvents.countSince(100, 10, baseTs + 61 * 60 * 1000 - 60 * 60 * 1000);
    expect(recentPhotos).toBe(1);

    nowSpy.mockRestore();
    db.close();
  });

  it('blocks too long text before photo/daily/spam checks', async () => {
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

    await engine.handleMessage(makeContext(makeTextMessage('long-1', '12345678901')));

    expect(textViolations).toEqual([{ textLength: 11, maxLength: 10 }]);

    db.close();
  });
});
