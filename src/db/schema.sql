PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_settings (
  chat_id INTEGER PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  daily_limit INTEGER NOT NULL,
  photo_limit_per_hour INTEGER NOT NULL DEFAULT 1,
  max_text_length INTEGER NOT NULL DEFAULT 800,
  spam_threshold INTEGER NOT NULL,
  spam_window_sec INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS domain_whitelist (
  chat_id INTEGER NOT NULL,
  domain TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, domain)
);

CREATE TABLE IF NOT EXISTS user_daily_count (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  day_key TEXT NOT NULL,
  count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id, day_key)
);

CREATE TABLE IF NOT EXISTS message_events (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  ts_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_message_events_chat_user_ts
  ON message_events (chat_id, user_id, ts_ms);

CREATE TABLE IF NOT EXISTS photo_events (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  ts_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photo_events_chat_user_ts
  ON photo_events (chat_id, user_id, ts_ms);

CREATE TABLE IF NOT EXISTS user_strikes (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  strike_count INTEGER NOT NULL,
  first_violation_ts INTEGER NOT NULL,
  last_violation_ts INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_strikes_last_violation
  ON user_strikes (last_violation_ts);

CREATE TABLE IF NOT EXISTS user_restrictions (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  restriction_type TEXT NOT NULL,
  until_ts INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id, restriction_type)
);

CREATE INDEX IF NOT EXISTS idx_user_restrictions_until
  ON user_restrictions (until_ts);

CREATE TABLE IF NOT EXISTS pending_rejoins (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  rejoin_at_ts INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pending_rejoins_rejoin_at
  ON pending_rejoins (rejoin_at_ts);

CREATE TABLE IF NOT EXISTS pending_bot_message_deletes (
  message_id TEXT PRIMARY KEY,
  delete_at_ts INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_bot_message_deletes_delete_at
  ON pending_bot_message_deletes (delete_at_ts);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  meta_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_moderation_actions_chat_created
  ON moderation_actions (chat_id, created_at);

CREATE TABLE IF NOT EXISTS processed_messages (
  chat_id INTEGER NOT NULL,
  message_id TEXT NOT NULL,
  processed_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_processed_messages_processed_at
  ON processed_messages (processed_at);
