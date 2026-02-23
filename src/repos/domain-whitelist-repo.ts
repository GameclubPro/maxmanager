import { BetterSqliteDb } from '../db/sqlite';
import { normalizeDomain } from '../utils/domain';

interface WhitelistRow {
  domain: string;
}

export class DomainWhitelistRepo {
  constructor(private readonly db: BetterSqliteDb) {}

  add(chatId: number, domain: string): string {
    const normalized = normalizeDomain(domain);
    if (!normalized) {
      throw new Error('Invalid domain');
    }

    this.db.prepare(`
      INSERT INTO domain_whitelist (chat_id, domain, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(chat_id, domain) DO NOTHING
    `).run(chatId, normalized, Date.now());

    return normalized;
  }

  remove(chatId: number, domain: string): string {
    const normalized = normalizeDomain(domain);
    if (!normalized) {
      throw new Error('Invalid domain');
    }

    this.db.prepare('DELETE FROM domain_whitelist WHERE chat_id = ? AND domain = ?').run(chatId, normalized);
    return normalized;
  }

  list(chatId: number): string[] {
    const rows = this.db.prepare('SELECT domain FROM domain_whitelist WHERE chat_id = ? ORDER BY domain ASC').all(chatId) as WhitelistRow[];
    return rows.map((row) => row.domain);
  }
}
