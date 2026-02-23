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
  }

  close(): void {
    this.db.close();
  }
}

export type { BetterSqliteDb };
