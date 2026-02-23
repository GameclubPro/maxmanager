import { BetterSqliteDb } from '../db/sqlite';
import { ActiveRestriction, RestrictionType } from '../types';

interface RestrictionRow {
  chat_id: number;
  user_id: number;
  restriction_type: RestrictionType;
  until_ts: number;
}

export class RestrictionsRepo {
  constructor(private readonly db: BetterSqliteDb) {}

  upsert(chatId: number, userId: number, type: RestrictionType, untilTs: number): void {
    this.db.prepare(`
      INSERT INTO user_restrictions (chat_id, user_id, restriction_type, until_ts, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(chat_id, user_id, restriction_type)
      DO UPDATE SET until_ts = excluded.until_ts
    `).run(chatId, userId, type, untilTs, Date.now());
  }

  getActive(chatId: number, userId: number, nowTs: number): ActiveRestriction | null {
    const row = this.db.prepare(`
      SELECT chat_id, user_id, restriction_type, until_ts
      FROM user_restrictions
      WHERE chat_id = ? AND user_id = ? AND until_ts > ?
      ORDER BY until_ts DESC
      LIMIT 1
    `).get(chatId, userId, nowTs) as RestrictionRow | undefined;

    if (!row) return null;

    return {
      chatId: row.chat_id,
      userId: row.user_id,
      type: row.restriction_type,
      untilTs: row.until_ts,
    };
  }

  purgeExpired(nowTs: number): void {
    this.db.prepare('DELETE FROM user_restrictions WHERE until_ts <= ?').run(nowTs);
  }
}
