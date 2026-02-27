import { BetterSqliteDb } from '../db/sqlite';
import { ModerationActionRecord } from '../types';

export class ModerationActionsRepo {
  constructor(private readonly db: BetterSqliteDb) {}

  record(entry: ModerationActionRecord): void {
    this.db.prepare(`
      INSERT INTO moderation_actions (chat_id, user_id, action, reason, meta_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      entry.chatId,
      entry.userId,
      entry.action,
      entry.reason,
      entry.meta ? JSON.stringify(entry.meta) : null,
      Date.now(),
    );
  }

  countByReasonSince(chatId: number, userId: number, reason: string, sinceTs: number): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM moderation_actions
      WHERE chat_id = ? AND user_id = ? AND reason = ? AND created_at >= ?
    `).get(chatId, userId, reason, sinceTs) as { count: number };

    return row.count;
  }

  countByActionSince(chatId: number, userId: number, action: string, sinceTs: number): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM moderation_actions
      WHERE chat_id = ? AND user_id = ? AND action = ? AND created_at >= ?
    `).get(chatId, userId, action, sinceTs) as { count: number };

    return row.count;
  }

  countByActionAndReasonSince(chatId: number, userId: number, action: string, reason: string, sinceTs: number): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM moderation_actions
      WHERE chat_id = ? AND user_id = ? AND action = ? AND reason = ? AND created_at >= ?
    `).get(chatId, userId, action, reason, sinceTs) as { count: number };

    return row.count;
  }

  countByUserActionSince(userId: number, action: string, sinceTs: number): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM moderation_actions
      WHERE user_id = ? AND action = ? AND created_at >= ?
    `).get(userId, action, sinceTs) as { count: number };

    return row.count;
  }

  countByUserReasonSince(userId: number, reason: string, sinceTs: number): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM moderation_actions
      WHERE user_id = ? AND reason = ? AND created_at >= ?
    `).get(userId, reason, sinceTs) as { count: number };

    return row.count;
  }
}
