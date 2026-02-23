import { BetterSqliteDb } from '../db/sqlite';
import { ChatSetting } from '../types';

interface ChatSettingsDefaults {
  dailyLimit: number;
  spamThreshold: number;
  spamWindowSec: number;
}

interface ChatSettingRow {
  chat_id: number;
  enabled: number;
  daily_limit: number;
  spam_threshold: number;
  spam_window_sec: number;
}

export class ChatSettingsRepo {
  constructor(
    private readonly db: BetterSqliteDb,
    private readonly defaults: ChatSettingsDefaults,
  ) {}

  private ensure(chatId: number): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO chat_settings (chat_id, enabled, daily_limit, spam_threshold, spam_window_sec, updated_at)
      VALUES (@chat_id, 1, @daily_limit, @spam_threshold, @spam_window_sec, @updated_at)
      ON CONFLICT(chat_id) DO NOTHING
    `).run({
      chat_id: chatId,
      daily_limit: this.defaults.dailyLimit,
      spam_threshold: this.defaults.spamThreshold,
      spam_window_sec: this.defaults.spamWindowSec,
      updated_at: now,
    });
  }

  get(chatId: number): ChatSetting {
    this.ensure(chatId);

    const row = this.db.prepare(`
      SELECT chat_id, enabled, daily_limit, spam_threshold, spam_window_sec
      FROM chat_settings
      WHERE chat_id = ?
    `).get(chatId) as ChatSettingRow;

    return {
      chatId: row.chat_id,
      enabled: row.enabled === 1,
      dailyLimit: row.daily_limit,
      spamThreshold: row.spam_threshold,
      spamWindowSec: row.spam_window_sec,
    };
  }

  setEnabled(chatId: number, enabled: boolean): void {
    this.ensure(chatId);

    this.db.prepare(`
      UPDATE chat_settings
      SET enabled = ?, updated_at = ?
      WHERE chat_id = ?
    `).run(enabled ? 1 : 0, Date.now(), chatId);
  }

  setDailyLimit(chatId: number, dailyLimit: number): void {
    this.ensure(chatId);

    this.db.prepare(`
      UPDATE chat_settings
      SET daily_limit = ?, updated_at = ?
      WHERE chat_id = ?
    `).run(dailyLimit, Date.now(), chatId);
  }

  setSpam(chatId: number, spamThreshold: number, spamWindowSec: number): void {
    this.ensure(chatId);

    this.db.prepare(`
      UPDATE chat_settings
      SET spam_threshold = ?, spam_window_sec = ?, updated_at = ?
      WHERE chat_id = ?
    `).run(spamThreshold, spamWindowSec, Date.now(), chatId);
  }
}
