import path from 'node:path';
import { BotConfig } from './types';

function parsePositiveInt(value: string | undefined, fallback: number, key: string): number {
  if (!value || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${key} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, fallback: number, key: string): number {
  if (!value || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Environment variable ${key} must be a non-negative integer`);
  }
  return parsed;
}

function parseOptionalInt(value: string | undefined, key: string): number | undefined {
  if (!value || value.trim() === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${key} must be an integer`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const botToken = env.BOT_TOKEN?.trim();
  if (!botToken) {
    throw new Error('BOT_TOKEN is required');
  }

  const timezone = 'Europe/Moscow' as const;

  return {
    botToken,
    timezone,
    dailyMessageLimit: parsePositiveInt(env.DAILY_MESSAGE_LIMIT, 3, 'DAILY_MESSAGE_LIMIT'),
    photoLimitPerHour: parseNonNegativeInt(env.PHOTO_LIMIT_PER_HOUR, 1, 'PHOTO_LIMIT_PER_HOUR'),
    maxTextLength: parseNonNegativeInt(env.MAX_TEXT_LENGTH, 1200, 'MAX_TEXT_LENGTH'),
    spamWindowSec: parsePositiveInt(env.SPAM_WINDOW_SEC, 10, 'SPAM_WINDOW_SEC'),
    spamThreshold: parsePositiveInt(env.SPAM_THRESHOLD, 3, 'SPAM_THRESHOLD'),
    strikeDecayHours: parsePositiveInt(env.STRIKE_DECAY_HOURS, 24, 'STRIKE_DECAY_HOURS'),
    muteHours: parsePositiveInt(env.MUTE_HOURS, 1, 'MUTE_HOURS'),
    banHours: parsePositiveInt(env.BAN_HOURS, 24, 'BAN_HOURS'),
    logChatId: parseOptionalInt(env.LOG_CHAT_ID, 'LOG_CHAT_ID'),
    noticeInChat: parseBoolean(env.NOTICE_IN_CHAT, true),
    databasePath: env.DATABASE_PATH?.trim() || path.resolve(process.cwd(), 'data/moderation.sqlite'),
    cleanupIntervalSec: parsePositiveInt(env.CLEANUP_INTERVAL_SEC, 300, 'CLEANUP_INTERVAL_SEC'),
  };
}
