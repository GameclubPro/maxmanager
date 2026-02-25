import { describe, expect, it } from 'vitest';
import { SqliteDatabase } from '../src/db/sqlite';
import { AdminCommands } from '../src/commands/admin';
import { createRepositories } from '../src/repos';
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

function makeMessage(text: string, chatId: number = 100, userId: number = 10): IncomingMessage {
  return {
    sender: { user_id: userId, name: 'Admin' },
    recipient: { chat_id: chatId, chat_type: 'chat' },
    body: {
      mid: `${Date.now()}`,
      text,
      attachments: null,
    },
  };
}

function makeContext(message: IncomingMessage) {
  const replies: string[] = [];
  let replyCounter = 0;
  const ctx = {
    message,
    chatId: message.recipient.chat_id,
    reply: async (text: string) => {
      replies.push(text);
      replyCounter += 1;
      return {
        body: {
          mid: `admin-reply-${replyCounter}`,
        },
      };
    },
  } as any;

  return { ctx, replies };
}

describe('admin photo limit command', () => {
  it('updates photo limit with /set_photo_limit', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const admin = new AdminCommands(
      repos,
      config,
      { isAdmin: async () => true } as any,
      { info: async () => {}, warn: async () => {}, error: async () => {}, moderation: async () => {} } as any,
    );

    const { ctx, replies } = makeContext(makeMessage('/set_photo_limit 0'));
    const handled = await admin.tryHandle(ctx);

    expect(handled).toBe(true);
    expect(repos.chatSettings.get(100).photoLimitPerHour).toBe(0);
    expect(replies[0]).toBe('Новый лимит фото-сообщений в час: 0');
    expect(repos.botMessageDeletes.listDue(Date.now() + 4 * 60 * 1000, 10)).toHaveLength(1);

    db.close();
  });

  it('includes photo limit in /mod_status', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    repos.chatSettings.setPhotoLimit(100, 4);

    const admin = new AdminCommands(
      repos,
      config,
      { isAdmin: async () => true } as any,
      { info: async () => {}, warn: async () => {}, error: async () => {}, moderation: async () => {} } as any,
    );

    const { ctx, replies } = makeContext(makeMessage('/mod_status'));
    await admin.tryHandle(ctx);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('photo_limit_per_hour: 4');
    expect(replies[0]).toContain('text_limit: 1200');

    db.close();
  });

  it('updates text limit with /set_text_limit', async () => {
    const db = new SqliteDatabase(':memory:');
    const repos = createRepositories(db.db, config);
    const admin = new AdminCommands(
      repos,
      config,
      { isAdmin: async () => true } as any,
      { info: async () => {}, warn: async () => {}, error: async () => {}, moderation: async () => {} } as any,
    );

    const { ctx, replies } = makeContext(makeMessage('/set_text_limit 700'));
    const handled = await admin.tryHandle(ctx);

    expect(handled).toBe(true);
    expect(repos.chatSettings.get(100).maxTextLength).toBe(700);
    expect(replies[0]).toBe('Новый лимит длины текста: 700');

    db.close();
  });
});
