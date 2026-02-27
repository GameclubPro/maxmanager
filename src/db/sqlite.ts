import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

type BetterSqliteDb = Database.Database;

function resolveSchemaPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'src/db/schema.sql'),
    path.resolve(__dirname, 'schema.sql'),
    path.resolve(__dirname, '../db/schema.sql'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('schema.sql not found');
}

export class SqliteDatabase {
  readonly db: BetterSqliteDb;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');

    this.migrate();
  }

  private migrate(): void {
    const schemaPath = resolveSchemaPath();
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    this.db.exec(schemaSql);
    this.runPostMigrations();
  }

  private runPostMigrations(): void {
    this.ensureChatSettingsPhotoLimitColumn();
    this.ensureChatSettingsMaxTextLengthColumn();
    this.ensureChatSettingsPriceButtonEnabledColumn();
  }

  private ensureChatSettingsPhotoLimitColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info('chat_settings')").all() as Array<{ name: string }>;
    const hasPhotoLimitColumn = columns.some((column) => column.name === 'photo_limit_per_hour');
    if (hasPhotoLimitColumn) {
      return;
    }

    this.db.exec('ALTER TABLE chat_settings ADD COLUMN photo_limit_per_hour INTEGER NOT NULL DEFAULT 1');
  }

  private ensureChatSettingsMaxTextLengthColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info('chat_settings')").all() as Array<{ name: string }>;
    const hasMaxTextLengthColumn = columns.some((column) => column.name === 'max_text_length');
    if (hasMaxTextLengthColumn) {
      return;
    }

    this.db.exec('ALTER TABLE chat_settings ADD COLUMN max_text_length INTEGER NOT NULL DEFAULT 800');
  }

  private ensureChatSettingsPriceButtonEnabledColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info('chat_settings')").all() as Array<{ name: string }>;
    const hasPriceButtonEnabledColumn = columns.some((column) => column.name === 'price_button_enabled');
    if (hasPriceButtonEnabledColumn) {
      return;
    }

    this.db.exec('ALTER TABLE chat_settings ADD COLUMN price_button_enabled INTEGER NOT NULL DEFAULT 1');
  }

  close(): void {
    this.db.close();
  }
}

export type { BetterSqliteDb };
