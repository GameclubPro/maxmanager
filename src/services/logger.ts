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
    const detail = this.resolveModerationDetail(record);
    const message = [
      `[moderation] chat=${record.chatId} user=${userLabel} action=${record.action} reason=${record.reason}`,
      detail ? `detail=${detail}` : null,
    ].filter(Boolean).join(' ');

    await this.emit(
      {
        level: 'info',
        message,
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

  private resolveModerationDetail(record: ModerationActionRecord): string | undefined {
    switch (record.action) {
      case 'mute':
        return this.resolveMuteDetail(record.reason, record.meta);
      case 'ban':
        return this.resolveBanDetail(record.meta);
      case 'ban_fallback':
        return this.resolveBanFallbackDetail(record.meta);
      case 'kick_temp':
        return this.resolveKickTempDetail(record.meta);
      case 'kick_auto':
        return this.resolveKickAutoDetail(record.meta);
      default:
        return undefined;
    }
  }

  private resolveMuteDetail(reason: string, meta: ModerationActionRecord['meta']): string {
    const muteHours = this.readNumber(meta, 'muteHours');
    if (typeof muteHours === 'number') {
      return `мут на ${muteHours} ч`;
    }

    if (reason === 'link') return 'мут на 3 ч';
    if (reason === 'photo_quota') return 'мут на 3 ч';
    if (reason === 'anti_bot') return 'мут на 6 ч';
    if (reason === 'spam') return 'мут за флуд';

    return 'мут';
  }

  private resolveBanDetail(meta: ModerationActionRecord['meta']): string {
    const banHours = this.readNumber(meta, 'banHours');
    if (typeof banHours === 'number') {
      return `исключение из чата с блокировкой на ${banHours} ч`;
    }

    return 'исключение из чата с блокировкой';
  }

  private resolveBanFallbackDetail(meta: ModerationActionRecord['meta']): string {
    const banHours = this.readNumber(meta, 'banHours');
    if (typeof banHours === 'number') {
      return `включен fallback-бан на ${banHours} ч`;
    }

    return 'включен fallback-бан';
  }

  private resolveKickTempDetail(meta: ModerationActionRecord['meta']): string {
    const kickHours = this.readNumber(meta, 'kickHours');
    if (typeof kickHours === 'number') {
      return `временное исключение из чата на ${kickHours} ч`;
    }

    return 'временное исключение из чата';
  }

  private resolveKickAutoDetail(meta: ModerationActionRecord['meta']): string {
    const windowHours = this.readNumber(meta, 'windowHours');
    const threshold = this.readNumber(meta, 'threshold');
    if (typeof windowHours === 'number' && typeof threshold === 'number') {
      return `автоисключение из чата: ${threshold} мута за ${windowHours} ч`;
    }

    return 'автоисключение из чата';
  }

  private readNumber(meta: ModerationActionRecord['meta'], key: string): number | undefined {
    if (!meta || typeof meta !== 'object') {
      return undefined;
    }

    const value = (meta as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }
}
