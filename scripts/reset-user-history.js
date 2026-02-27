#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const Database = require('better-sqlite3');

const USER_HISTORY_TABLES = [
  'user_daily_count',
  'message_events',
  'photo_events',
  'user_strikes',
  'user_restrictions',
  'pending_rejoins',
  'pending_bot_message_deletes',
  'moderation_actions',
  'processed_messages',
];

function resolveDbPath() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
  const configured = (process.env.DATABASE_PATH || './data/moderation.sqlite').trim();
  return path.resolve(process.cwd(), configured);
}

function printUsage() {
  console.log(
    [
      'Usage:',
      '  node scripts/reset-user-history.js --yes                 # reset only user history',
      '  node scripts/reset-user-history.js --full --yes          # remove whole DB file',
      '',
      'Notes:',
      '  --yes   required safety flag',
      '  --full  removes the entire SQLite file (settings/whitelist will also be lost)',
    ].join('\n'),
  );
}

function requireYesFlag(args) {
  if (!args.includes('--yes')) {
    console.error('Refusing to run without --yes flag.');
    printUsage();
    process.exit(1);
  }
}

function backupFile(filePath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.backup-${timestamp}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function resetUserHistory(dbPath) {
  const db = new Database(dbPath);
  const tx = db.transaction(() => {
    for (const table of USER_HISTORY_TABLES) {
      db.prepare(`DELETE FROM ${table}`).run();
    }

    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('moderation_actions')").run();
  });

  tx();
  db.pragma('optimize');
  db.close();
}

function removeDatabase(dbPath) {
  fs.unlinkSync(dbPath);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  requireYesFlag(args);

  const fullReset = args.includes('--full');
  const dbPath = resolveDbPath();

  if (!fs.existsSync(dbPath)) {
    console.error(`Database file not found: ${dbPath}`);
    process.exit(1);
  }

  const backupPath = backupFile(dbPath);
  if (fullReset) {
    removeDatabase(dbPath);
    console.log(`Full reset done. Database removed: ${dbPath}`);
    console.log(`Backup created: ${backupPath}`);
    return;
  }

  resetUserHistory(dbPath);
  console.log(`User history reset done for: ${dbPath}`);
  console.log(`Backup created: ${backupPath}`);
}

main();

