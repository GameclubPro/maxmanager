import { BetterSqliteDb } from '../db/sqlite';

interface CountRow {
  count: number;
}

export class DailyCountRepo {
  constructor(private readonly db: BetterSqliteDb) {}

  incrementAndGet(chatId: number, userId: number, dayKey: string): number {
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO user_daily_count (chat_id, user_id, day_key, count, updated_at)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(chat_id, user_id, day_key)
      DO UPDATE SET
        count = user_daily_count.count + 1,
        updated_at = excluded.updated_at
    `).run(chatId, userId, dayKey, now);

    const row = this.db.prepare(`
      SELECT count
      FROM user_daily_count
      WHERE chat_id = ? AND user_id = ? AND day_key = ?
    `).get(chatId, userId, dayKey) as CountRow;

    return row.count;
  }

  purgeOlderThan(minDayKeyExclusive: string): void {
    this.db.prepare('DELETE FROM user_daily_count WHERE day_key < ?').run(minDayKeyExclusive);
  }
}
