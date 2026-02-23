import { BetterSqliteDb } from '../db/sqlite';

export class ProcessedMessagesRepo {
  constructor(private readonly db: BetterSqliteDb) {}

  tryMarkProcessed(chatId: number, messageId: string, nowTs: number): boolean {
    const result = this.db.prepare(`
      INSERT INTO processed_messages (chat_id, message_id, processed_at)
      VALUES (?, ?, ?)
      ON CONFLICT(chat_id, message_id) DO NOTHING
    `).run(chatId, messageId, nowTs);

    return result.changes > 0;
  }

  purgeOlderThan(cutoffTsMs: number): void {
    this.db.prepare('DELETE FROM processed_messages WHERE processed_at < ?').run(cutoffTsMs);
  }
}
