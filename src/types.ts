export type ViolationKind = 'link' | 'quota' | 'spam';

export type SanctionLevel = 1 | 2 | 3;

export type RestrictionType = 'mute' | 'ban_fallback';

export type ChatKind = 'dialog' | 'chat' | 'channel';

export interface BotConfig {
  botToken: string;
  timezone: 'Europe/Moscow';
  dailyMessageLimit: number;
  spamWindowSec: number;
  spamThreshold: number;
  strikeDecayHours: number;
  muteHours: number;
  banHours: number;
  logChatId?: number;
  noticeInChat: boolean;
  databasePath: string;
  cleanupIntervalSec: number;
}

export interface ChatSetting {
  chatId: number;
  enabled: boolean;
  dailyLimit: number;
  spamThreshold: number;
  spamWindowSec: number;
}

export interface ActiveRestriction {
  chatId: number;
  userId: number;
  type: RestrictionType;
  untilTs: number;
}

export interface IncomingSender {
  user_id: number;
  is_bot?: boolean;
  name?: string;
}

export interface IncomingRecipient {
  chat_id: number | null;
  chat_type: ChatKind;
}

export interface IncomingBody {
  mid: string;
  text: string | null;
  attachments?: unknown[] | null;
  markup?: unknown[] | null;
}

export interface IncomingMessage {
  sender?: IncomingSender | null;
  recipient: IncomingRecipient;
  body: IncomingBody;
  url?: string | null;
}

export interface ModerationActionRecord {
  chatId: number;
  userId: number;
  action: string;
  reason: string;
  meta?: Record<string, unknown>;
}

export interface DetectedLink {
  raw: string;
  domain: string | null;
  source: 'text' | 'attachment' | 'message_url';
}
