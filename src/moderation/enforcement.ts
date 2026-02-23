import { Context } from '@maxhub/max-bot-api';
import { BotConfig, RestrictionType, ViolationKind } from '../types';
import { Repositories } from '../repos';
import { BotLogger } from '../services/logger';
import { hoursToMs } from '../utils/time';

interface ViolationContext {
  chatId: number;
  userId: number;
  messageId: string;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

export class EnforcementService {
  constructor(
    private readonly repos: Repositories,
    private readonly config: BotConfig,
    private readonly logger: BotLogger,
  ) {}

  async enforceActiveRestriction(ctx: Context, args: ViolationContext & { restrictionType: RestrictionType; untilTs: number }): Promise<void> {
    await this.deleteMessageSafe(ctx, args.messageId);

    if (this.config.noticeInChat) {
      const typeText = args.restrictionType === 'mute' ? 'мут' : 'блокировка';
      await this.replySafe(ctx, `Сообщение удалено: у пользователя активен ${typeText} до ${formatDate(args.untilTs)}.`);
    }

    this.recordAndLog(args.chatId, args.userId, 'restriction_enforced', 'active_restriction', {
      restrictionType: args.restrictionType,
      untilTs: args.untilTs,
    });
  }

  async enforceLinkViolation(ctx: Context, args: ViolationContext, meta: Record<string, unknown>): Promise<void> {
    await this.deleteMessageSafe(ctx, args.messageId);

    if (this.config.noticeInChat) {
      await this.replySafe(ctx, 'Ссылки в этом чате запрещены. Сообщение удалено.');
    }

    this.recordAndLog(args.chatId, args.userId, 'delete_message', 'link', meta);
  }

  async enforceQuotaViolation(ctx: Context, args: ViolationContext, currentCount: number, limit: number): Promise<void> {
    await this.deleteMessageSafe(ctx, args.messageId);

    if (this.config.noticeInChat) {
      await this.replySafe(ctx, `Лимит сообщений исчерпан: ${limit} в сутки. Попробуйте снова после полуночи (МСК).`);
    }

    this.recordAndLog(args.chatId, args.userId, 'delete_message', 'quota', {
      currentCount,
      limit,
    });
  }

  async enforceSpamViolation(ctx: Context, args: ViolationContext, messageCountInWindow: number): Promise<void> {
    const level = this.repos.strikes.registerViolation(
      args.chatId,
      args.userId,
      Date.now(),
      hoursToMs(this.config.strikeDecayHours),
    );

    await this.deleteMessageSafe(ctx, args.messageId);

    if (level === 1) {
      if (this.config.noticeInChat) {
        await this.replySafe(ctx, 'Предупреждение: обнаружен флуд. Повторное нарушение приведет к муту.');
      }

      this.recordAndLog(args.chatId, args.userId, 'warn', 'spam', {
        level,
        messageCountInWindow,
      });
      return;
    }

    if (level === 2) {
      const untilTs = Date.now() + hoursToMs(this.config.muteHours);
      this.repos.restrictions.upsert(args.chatId, args.userId, 'mute', untilTs);

      if (this.config.noticeInChat) {
        await this.replySafe(ctx, `Флуд: выдан мут до ${formatDate(untilTs)}.`);
      }

      this.recordAndLog(args.chatId, args.userId, 'mute', 'spam', {
        level,
        untilTs,
        messageCountInWindow,
      });
      return;
    }

    const banUntilTs = Date.now() + hoursToMs(this.config.banHours);

    try {
      await (ctx.api.raw.chats as {
        removeChatMember: (payload: { chat_id: number; user_id: number; block?: boolean }) => Promise<unknown>;
      }).removeChatMember({
        chat_id: args.chatId,
        user_id: args.userId,
        block: true,
      });

      if (this.config.noticeInChat) {
        await this.replySafe(ctx, `Флуд: пользователь заблокирован на ${this.config.banHours} ч.`);
      }

      this.recordAndLog(args.chatId, args.userId, 'ban', 'spam', {
        level,
        untilTs: banUntilTs,
        messageCountInWindow,
      });
    } catch (error) {
      this.repos.restrictions.upsert(args.chatId, args.userId, 'ban_fallback', banUntilTs);

      if (this.config.noticeInChat) {
        await this.replySafe(ctx, `Флуд: активирована блокировка сообщений до ${formatDate(banUntilTs)}.`);
      }

      this.recordAndLog(args.chatId, args.userId, 'ban_fallback', 'spam', {
        level,
        untilTs: banUntilTs,
        messageCountInWindow,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleCriticalFailure(ctx: Context, args: ViolationContext, violationKind: ViolationKind): Promise<void> {
    if (violationKind === 'link') {
      await this.deleteMessageSafe(ctx, args.messageId);
      if (this.config.noticeInChat) {
        await this.replySafe(ctx, 'Сообщение удалено: временная ошибка проверки ссылок.');
      }

      this.recordAndLog(args.chatId, args.userId, 'delete_message', 'link_fail_closed', {});
      return;
    }

    await this.logger.error('Non-link moderation failure (fail-open)', {
      chatId: args.chatId,
      userId: args.userId,
      violationKind,
    });
  }

  private async deleteMessageSafe(ctx: Context, messageId: string): Promise<void> {
    try {
      await ctx.deleteMessage(messageId);
    } catch (error) {
      await this.logger.warn('Failed to delete message', {
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async replySafe(ctx: Context, text: string): Promise<void> {
    try {
      await ctx.reply(text);
    } catch (error) {
      await this.logger.warn('Failed to send chat notice', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private recordAndLog(
    chatId: number,
    userId: number,
    action: string,
    reason: string,
    meta: Record<string, unknown>,
  ): void {
    try {
      this.repos.moderationActions.record({ chatId, userId, action, reason, meta });
    } catch {
      // DB write failures are logged separately.
    }

    void this.logger.moderation({ chatId, userId, action, reason, meta });
  }
}
