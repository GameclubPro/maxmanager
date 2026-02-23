import { BetterSqliteDb } from '../db/sqlite';
import { SanctionLevel } from '../types';

interface StrikeRow {
  strike_count: number;
  first_violation_ts: number;
  last_violation_ts: number;
}

export class StrikesRepo {
  constructor(private readonly db: BetterSqliteDb) {}

  registerViolation(chatId: number, userId: number, nowTs: number, decayMs: number): SanctionLevel {
    const row = this.db.prepare(`
      SELECT strike_count, first_violation_ts, last_violation_ts
      FROM user_strikes
      WHERE chat_id = ? AND user_id = ?
    `).get(chatId, userId) as StrikeRow | undefined;

    let strikeCount = 1;
    let firstViolationTs = nowTs;

    if (row) {
      const isExpired = nowTs - row.last_violation_ts > decayMs;
      if (isExpired) {
        strikeCount = 1;
        firstViolationTs = nowTs;
      } else {
        strikeCount = Math.min(3, row.strike_count + 1);
        firstViolationTs = row.first_violation_ts;
      }
    }

    this.db.prepare(`
      INSERT INTO user_strikes (chat_id, user_id, strike_count, first_violation_ts, last_violation_ts)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(chat_id, user_id)
      DO UPDATE SET
        strike_count = excluded.strike_count,
        first_violation_ts = excluded.first_violation_ts,
        last_violation_ts = excluded.last_violation_ts
    `).run(chatId, userId, strikeCount, firstViolationTs, nowTs);

    return strikeCount as SanctionLevel;
  }

  purgeOlderThan(cutoffTsMs: number): void {
    this.db.prepare('DELETE FROM user_strikes WHERE last_violation_ts < ?').run(cutoffTsMs);
  }
}
