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
}
