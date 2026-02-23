import { Api } from '@maxhub/max-bot-api';
import { ModerationActionRecord } from '../types';

export interface LogEvent {
  level: 'info' | 'warn' | 'error';
  message: string;
  meta?: Record<string, unknown>;
}

export class BotLogger {
  constructor(
    private readonly api: Api,
    private readonly getLogChatId: () => number | undefined,
  ) {}

  async info(message: string, meta?: Record<string, unknown>): Promise<void> {
    await this.emit({ level: 'info', message, meta });
  }

  async warn(message: string, meta?: Record<string, unknown>): Promise<void> {
    await this.emit({ level: 'warn', message, meta });
  }

  async error(message: string, meta?: Record<string, unknown>): Promise<void> {
    await this.emit({ level: 'error', message, meta });
  }

  async moderation(record: ModerationActionRecord): Promise<void> {
    await this.info(
      `[moderation] chat=${record.chatId} user=${record.userId} action=${record.action} reason=${record.reason}`,
      record.meta,
    );
  }

  private async emit(event: LogEvent): Promise<void> {
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
}
