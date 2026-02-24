import { BetterSqliteDb } from '../db/sqlite';

interface CountRow {
  cnt: number;
}

export class PhotoEventsRepo {
  constructor(private readonly db: BetterSqliteDb) {}

  add(chatId: number, userId: number, tsMs: number): void {
    this.db.prepare('INSERT INTO photo_events (chat_id, user_id, ts_ms) VALUES (?, ?, ?)').run(chatId, userId, tsMs);
  }

  countSince(chatId: number, userId: number, sinceTsMs: number): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM photo_events
      WHERE chat_id = ? AND user_id = ? AND ts_ms >= ?
    `).get(chatId, userId, sinceTsMs) as CountRow;

    return row.cnt;
  }

  purgeOlderThan(cutoffTsMs: number): void {
    this.db.prepare('DELETE FROM photo_events WHERE ts_ms < ?').run(cutoffTsMs);
  }
}
