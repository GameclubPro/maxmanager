import { BetterSqliteDb } from '../db/sqlite';
import { PendingRejoin } from '../types';

interface PendingRejoinRow {
  chat_id: number;
  user_id: number;
  rejoin_at_ts: number;
  created_at: number;
}

export class PendingRejoinsRepo {
  constructor(private readonly db: BetterSqliteDb) {}

  upsert(chatId: number, userId: number, rejoinAtTs: number): void {
    const nowTs = Date.now();
    this.db.prepare(`
      INSERT INTO pending_rejoins (chat_id, user_id, rejoin_at_ts, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(chat_id, user_id)
      DO UPDATE SET
        rejoin_at_ts = excluded.rejoin_at_ts,
        created_at = excluded.created_at
    `).run(chatId, userId, rejoinAtTs, nowTs);
  }

  listDue(nowTs: number, limit: number = 100): PendingRejoin[] {
    const rows = this.db.prepare(`
      SELECT chat_id, user_id, rejoin_at_ts, created_at
      FROM pending_rejoins
      WHERE rejoin_at_ts <= ?
      ORDER BY rejoin_at_ts ASC
      LIMIT ?
    `).all(nowTs, limit) as PendingRejoinRow[];

    return rows.map((row) => ({
      chatId: row.chat_id,
      userId: row.user_id,
      rejoinAtTs: row.rejoin_at_ts,
      createdAtTs: row.created_at,
    }));
  }

  remove(chatId: number, userId: number): void {
    this.db.prepare('DELETE FROM pending_rejoins WHERE chat_id = ? AND user_id = ?').run(chatId, userId);
  }

  postpone(chatId: number, userId: number, nextRejoinAtTs: number): void {
    this.db.prepare(`
      UPDATE pending_rejoins
      SET rejoin_at_ts = ?
      WHERE chat_id = ? AND user_id = ?
    `).run(nextRejoinAtTs, chatId, userId);
  }

  purgeOlderThan(cutoffTsMs: number): void {
    this.db.prepare('DELETE FROM pending_rejoins WHERE created_at < ?').run(cutoffTsMs);
  }
}
