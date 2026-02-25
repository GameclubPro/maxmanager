import { Context } from '@maxhub/max-bot-api';
import { describe, expect, it, vi } from 'vitest';
import { SqliteDatabase } from '../src/db/sqlite';
import { createRepositories } from '../src/repos';
import { BotGuardService } from '../src/services/bot-guard';
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

function makeMessage(chatId: number, senderId: number, isBot: boolean): IncomingMessage {
  return {
    sender: { user_id: senderId, is_bot: isBot, name: 'Sender' },
    recipient: { chat_id: chatId, chat_type: 'chat' },
    body: {
      mid: `m-${chatId}-${senderId}`,
      text: 'hello',
      attachments: null,
    },
  };
}

function makeLogger() {
  return {
    info: vi.fn(async () => {}),
    warn: vi.fn(async () => {}),
    error: vi.fn(async () => {}),
    moderation: vi.fn(async () => {}),
  } as any;
}

describe('bot guard service', () => {
  it('removes newly added foreign bot with block=true', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const removeCalls: Array<{ chat_id: number; user_id: number; block?: boolean }> = [];
    const logger = makeLogger();

    const api = {
      getMyInfo: async () => ({ user_id: 1 }),
      raw: {
        chats: {
          removeChatMember: async (payload: { chat_id: number; user_id: number; block?: boolean }) => {
            removeCalls.push(payload);
          },
        },
      },
    } as any;

    const service = new BotGuardService(api, repos, logger);
    const ctx = {
      chatId: 100,
      myId: 1,
      user: { user_id: 22, is_bot: true },
    } as unknown as Context;

    await service.handleBotAdded(ctx);

    expect(removeCalls).toEqual([{ chat_id: 100, user_id: 22, block: true }]);
    expect(repos.moderationActions.countByActionAndReasonSince(100, 22, 'remove_bot', 'auto_bot_guard', Date.now() - 60_000)).toBe(1);

    db.close();
  });

  it('does not remove self bot on bot_added event', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const removeCalls: Array<{ chat_id: number; user_id: number; block?: boolean }> = [];
    const logger = makeLogger();

    const api = {
      getMyInfo: async () => ({ user_id: 1 }),
      raw: {
        chats: {
          removeChatMember: async (payload: { chat_id: number; user_id: number; block?: boolean }) => {
            removeCalls.push(payload);
          },
        },
      },
    } as any;

    const service = new BotGuardService(api, repos, logger);
    const ctx = {
      chatId: 100,
      myId: 1,
      user: { user_id: 1, is_bot: true },
    } as unknown as Context;

    await service.handleBotAdded(ctx);

    expect(removeCalls).toHaveLength(0);
    expect(repos.moderationActions.countByActionAndReasonSince(100, 1, 'remove_bot', 'auto_bot_guard', Date.now() - 60_000)).toBe(0);

    db.close();
  });

  it('handles message_created from foreign bot as fallback', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const removeCalls: Array<{ chat_id: number; user_id: number; block?: boolean }> = [];
    const logger = makeLogger();

    const api = {
      getMyInfo: async () => ({ user_id: 1 }),
      raw: {
        chats: {
          removeChatMember: async (payload: { chat_id: number; user_id: number; block?: boolean }) => {
            removeCalls.push(payload);
          },
        },
      },
    } as any;

    const service = new BotGuardService(api, repos, logger);
    const message = makeMessage(100, 77, true);
    const ctx = {
      chatId: 100,
      myId: 1,
    } as unknown as Context;

    const handled = await service.handleBotMessage(ctx, message);

    expect(handled).toBe(true);
    expect(removeCalls).toEqual([{ chat_id: 100, user_id: 77, block: true }]);
    expect(repos.moderationActions.countByActionAndReasonSince(100, 77, 'remove_bot', 'auto_bot_guard', Date.now() - 60_000)).toBe(1);

    db.close();
  });

  it('sweeps existing chats and removes foreign bots only', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const removeCalls: Array<{ chat_id: number; user_id: number; block?: boolean }> = [];
    const logger = makeLogger();

    const getAllChats = vi.fn()
      .mockResolvedValueOnce({
        chats: [
          { chat_id: 100, type: 'chat' },
          { chat_id: 200, type: 'channel' },
        ],
        marker: 42,
      })
      .mockResolvedValueOnce({
        chats: [{ chat_id: 300, type: 'dialog' }],
        marker: null,
      });

    const getChatMembers = vi.fn(async (chatId: number) => {
      if (chatId === 100) {
        return {
          members: [
            { user_id: 1, is_bot: true },
            { user_id: 2, is_bot: true },
            { user_id: 11, is_bot: false },
          ],
          marker: null,
        };
      }

      if (chatId === 200) {
        return {
          members: [{ user_id: 3, is_bot: true }],
          marker: null,
        };
      }

      return { members: [], marker: null };
    });

    const api = {
      getMyInfo: async () => ({ user_id: 1 }),
      getAllChats,
      getChatMembers,
      raw: {
        chats: {
          removeChatMember: async (payload: { chat_id: number; user_id: number; block?: boolean }) => {
            removeCalls.push(payload);
          },
        },
      },
    } as any;

    const service = new BotGuardService(api, repos, logger);
    await service.sweepExistingChats();

    expect(removeCalls).toEqual([
      { chat_id: 100, user_id: 2, block: true },
      { chat_id: 200, user_id: 3, block: true },
    ]);
    expect(getAllChats).toHaveBeenCalledTimes(2);
    expect(getChatMembers).toHaveBeenCalledTimes(2);

    db.close();
  });

  it('continues startup sweep when one chat members request fails', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const removeCalls: Array<{ chat_id: number; user_id: number; block?: boolean }> = [];
    const logger = makeLogger();

    const getAllChats = vi.fn().mockResolvedValue({
      chats: [
        { chat_id: 100, type: 'chat' },
        { chat_id: 200, type: 'chat' },
      ],
      marker: null,
    });

    const getChatMembers = vi.fn(async (chatId: number) => {
      if (chatId === 100) {
        throw new Error('forbidden');
      }

      return {
        members: [{ user_id: 7, is_bot: true }],
        marker: null,
      };
    });

    const api = {
      getMyInfo: async () => ({ user_id: 1 }),
      getAllChats,
      getChatMembers,
      raw: {
        chats: {
          removeChatMember: async (payload: { chat_id: number; user_id: number; block?: boolean }) => {
            removeCalls.push(payload);
          },
        },
      },
    } as any;

    const service = new BotGuardService(api, repos, logger);
    await service.sweepExistingChats();

    expect(removeCalls).toEqual([{ chat_id: 200, user_id: 7, block: true }]);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to list chat members during startup bot sweep',
      expect.objectContaining({ chatId: 100 }),
    );

    db.close();
  });
});
