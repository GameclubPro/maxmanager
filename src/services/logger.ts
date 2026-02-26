import { Api } from '@maxhub/max-bot-api';
import { ModerationActionRecord } from '../types';

export interface LogEvent {
  level: 'info' | 'warn' | 'error';
  message: string;
  meta?: Record<string, unknown>;
}

const CHAT_NOTIFICATION_ACTIONS = new Set(['mute', 'ban', 'ban_fallback', 'kick_temp', 'kick_auto']);

export class BotLogger {
  constructor(
    private readonly api: Api,
    private readonly getLogChatId: () => number | undefined,
  ) {}

  async info(message: string, meta?: Record<string, unknown>): Promise<void> {
    await this.emit({ level: 'info', message, meta }, false);
  }

  async warn(message: string, meta?: Record<string, unknown>): Promise<void> {
    await this.emit({ level: 'warn', message, meta }, false);
  }

  async error(message: string, meta?: Record<string, unknown>): Promise<void> {
    await this.emit({ level: 'error', message, meta }, false);
  }

  async moderation(record: ModerationActionRecord): Promise<void> {
    const shouldSendToChat = CHAT_NOTIFICATION_ACTIONS.has(record.action);
    const userLabel = this.resolveUserLabel(record);
    await this.emit(
      {
        level: 'info',
        message: `[moderation] chat=${record.chatId} user=${userLabel} action=${record.action} reason=${record.reason}`,
        meta: record.meta,
      },
      shouldSendToChat,
    );
  }

  private async emit(event: LogEvent, sendToLogChat: boolean): Promise<void> {
    const payload = {
      ts: new Date().toISOString(),
      level: event.level,
      message: event.message,
      ...(event.meta ? { meta: event.meta } : {}),
    };

    if (event.level === 'error') {
      console.error(JSON.stringify(payload));
    } else if (event.level === 'warn') {
      console.warn(JSON.stringify(payload));
    } else {
      console.log(JSON.stringify(payload));
    }

    if (!sendToLogChat) {
      return;
    }

    const logChatId = this.getLogChatId();
    if (!logChatId) return;

    const text = [
      `[#${event.level.toUpperCase()}] ${event.message}`,
      event.meta ? `meta: ${JSON.stringify(event.meta)}` : null,
    ].filter(Boolean).join('\n');

    try {
      await this.api.sendMessageToChat(logChatId, text);
    } catch {
      // Avoid recursive logging on send failures.
    }
  }

  private resolveUserLabel(record: ModerationActionRecord): string {
    const meta = record.meta;
    if (meta && typeof meta === 'object') {
      const fromMeta = (meta as Record<string, unknown>).userName;
      if (typeof fromMeta === 'string' && fromMeta.trim() !== '') {
        return fromMeta.trim();
      }
    }

    return String(record.userId);
  }
}
