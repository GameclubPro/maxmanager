import { BetterSqliteDb } from '../db/sqlite';
import { PendingBotMessageDelete } from '../types';

interface PendingBotMessageDeleteRow {
  message_id: string;
  delete_at_ts: number;
  created_at: number;
}

export class BotMessageDeletesRepo {
  constructor(private readonly db: BetterSqliteDb) {}

  schedule(messageId: string, deleteAtTs: number): void {
    const nowTs = Date.now();
    this.db.prepare(`
      INSERT INTO pending_bot_message_deletes (message_id, delete_at_ts, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(message_id)
      DO UPDATE SET
        delete_at_ts = excluded.delete_at_ts,
        created_at = excluded.created_at
    `).run(messageId, deleteAtTs, nowTs);
  }

  listDue(nowTs: number, limit: number = 100): PendingBotMessageDelete[] {
    const rows = this.db.prepare(`
      SELECT message_id, delete_at_ts, created_at
      FROM pending_bot_message_deletes
      WHERE delete_at_ts <= ?
      ORDER BY delete_at_ts ASC
      LIMIT ?
    `).all(nowTs, limit) as PendingBotMessageDeleteRow[];

    return rows.map((row) => ({
      messageId: row.message_id,
      deleteAtTs: row.delete_at_ts,
      createdAtTs: row.created_at,
    }));
  }

  remove(messageId: string): void {
    this.db.prepare('DELETE FROM pending_bot_message_deletes WHERE message_id = ?').run(messageId);
  }

  postpone(messageId: string, nextDeleteAtTs: number): void {
    this.db.prepare(`
      UPDATE pending_bot_message_deletes
      SET delete_at_ts = ?
      WHERE message_id = ?
    `).run(nextDeleteAtTs, messageId);
  }

  purgeOlderThan(cutoffTsMs: number): void {
    this.db.prepare('DELETE FROM pending_bot_message_deletes WHERE created_at < ?').run(cutoffTsMs);
  }
}
