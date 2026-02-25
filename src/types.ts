export type ViolationKind = 'link' | 'quota' | 'spam';

export type SanctionLevel = 1 | 2 | 3;

export type RestrictionType = 'mute' | 'ban_fallback';

export type ChatKind = 'dialog' | 'chat' | 'channel';

export interface BotConfig {
  botToken: string;
  timezone: 'Europe/Moscow';
  dailyMessageLimit: number;
  photoLimitPerHour: number;
  maxTextLength: number;
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
  photoLimitPerHour: number;
  maxTextLength: number;
  spamThreshold: number;
  spamWindowSec: number;
}

export interface ActiveRestriction {
  chatId: number;
  userId: number;
  type: RestrictionType;
  untilTs: number;
  createdAtTs: number;
}

export interface PendingRejoin {
  chatId: number;
  userId: number;
  rejoinAtTs: number;
  createdAtTs: number;
}

export interface PendingBotMessageDelete {
  messageId: string;
  deleteAtTs: number;
  createdAtTs: number;
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

export interface IncomingLinkedBody {
  mid?: string;
  seq?: number;
  text?: string | null;
  attachments?: unknown[] | null;
  markup?: unknown[] | null;
}

export interface IncomingLink {
  type?: 'forward' | 'reply' | string;
  sender?: IncomingSender | null;
  chat_id?: number;
  message?: IncomingLinkedBody | null;
}

export interface IncomingMessage {
  sender?: IncomingSender | null;
  recipient: IncomingRecipient;
  body: IncomingBody;
  link?: IncomingLink | null;
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
