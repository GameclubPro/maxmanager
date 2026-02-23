import { BetterSqliteDb } from '../db/sqlite';

interface AppSettingRow {
  value: string;
}

export class AppSettingsRepo {
  constructor(private readonly db: BetterSqliteDb) {}

  setLogChatId(chatId: number): void {
    this.set('log_chat_id', String(chatId));
  }

  getLogChatId(): number | undefined {
    const raw = this.get('log_chat_id');
    if (!raw) return undefined;

    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private set(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key)
      DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, Date.now());
  }

  private get(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as AppSettingRow | undefined;
    return row?.value;
  }
}
