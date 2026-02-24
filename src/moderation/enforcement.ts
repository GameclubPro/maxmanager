import { Context } from '@maxhub/max-bot-api';
import { BotConfig, RestrictionType, ViolationKind } from '../types';
import { Repositories } from '../repos';
import { BotLogger } from '../services/logger';
import { hoursToMs } from '../utils/time';

interface ViolationContext {
  chatId: number;
  userId: number;
  messageId: string;
  userName?: string;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

const LINK_VIOLATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const LINK_MUTE_HOURS = 3;

export class EnforcementService {
  constructor(
    private readonly repos: Repositories,
    private readonly config: BotConfig,
    private readonly logger: BotLogger,
  ) {}

  async enforceActiveRestriction(ctx: Context, args: ViolationContext & { restrictionType: RestrictionType; untilTs: number }): Promise<void> {
    await this.deleteMessageSafe(ctx, args.messageId);

    if (this.config.noticeInChat && args.restrictionType !== 'mute') {
      const typeText = 'блокировка';
      await this.replySafe(
        ctx,
        this.withUserName(
          `сообщение удалено: у вас активен ${typeText} до ${formatDate(args.untilTs)}.`,
          args.userName,
          args.userId,
        ),
      );
    }

    this.recordAndLog(args.chatId, args.userId, 'restriction_enforced', 'active_restriction', {
      restrictionType: args.restrictionType,
      untilTs: args.untilTs,
    });
  }

  async enforceLinkViolation(ctx: Context, args: ViolationContext, meta: Record<string, unknown>): Promise<void> {
    const nowTs = Date.now();
    const recentLinkViolations = this.repos.moderationActions.countByReasonSince(
      args.chatId,
      args.userId,
      'link',
      nowTs - LINK_VIOLATION_WINDOW_MS,
    );
    const violationLevel = recentLinkViolations + 1;

    await this.deleteMessageSafe(ctx, args.messageId);

    if (violationLevel === 1) {
      if (this.config.noticeInChat) {
        await this.replySafe(
          ctx,
          this.withUserName(
            'Ссылки в этом чате запрещены. Сообщение удалено. Правила в описании.',
            args.userName,
            args.userId,
          ),
        );
      }

      this.recordAndLog(args.chatId, args.userId, 'delete_message', 'link', {
        ...meta,
        violationLevel,
        windowHours: 24,
      });
      return;
    }

    if (violationLevel === 2) {
      if (this.config.noticeInChat) {
        await this.replySafe(
          ctx,
          this.withUserName(
            'предупреждение: повторная отправка ссылок в течение 24 часов приведет к муту на 3 часа.',
            args.userName,
            args.userId,
          ),
        );
      }

      this.recordAndLog(args.chatId, args.userId, 'warn', 'link', {
        ...meta,
        violationLevel,
        windowHours: 24,
      });
      return;
    }

    const untilTs = nowTs + hoursToMs(LINK_MUTE_HOURS);
    this.repos.restrictions.upsert(args.chatId, args.userId, 'mute', untilTs);

    if (this.config.noticeInChat) {
      await this.replySafe(
        ctx,
        this.withUserName(
          `повторное нарушение: вы получили мут на ${LINK_MUTE_HOURS} часа до ${formatDate(untilTs)}.`,
          args.userName,
          args.userId,
        ),
      );
    }

    this.recordAndLog(args.chatId, args.userId, 'mute', 'link', {
      ...meta,
      violationLevel,
      untilTs,
      muteHours: LINK_MUTE_HOURS,
      windowHours: 24,
    });
  }

  async enforceQuotaViolation(ctx: Context, args: ViolationContext, currentCount: number, limit: number): Promise<void> {
    await this.deleteMessageSafe(ctx, args.messageId);

    if (this.config.noticeInChat) {
      await this.replySafe(
        ctx,
        this.withUserName(
          `лимит сообщений исчерпан: ${limit} в сутки. Попробуйте снова после полуночи (МСК).`,
          args.userName,
          args.userId,
        ),
      );
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
        await this.replySafe(
          ctx,
          this.withUserName(
            'предупреждение: обнаружен флуд. Повторное нарушение приведет к муту.',
            args.userName,
            args.userId,
          ),
        );
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
        await this.replySafe(
          ctx,
          this.withUserName(`флуд: выдан мут до ${formatDate(untilTs)}.`, args.userName, args.userId),
        );
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
        await this.replySafe(
          ctx,
          this.withUserName(`флуд: пользователь заблокирован на ${this.config.banHours} ч.`, args.userName, args.userId),
        );
      }

      this.recordAndLog(args.chatId, args.userId, 'ban', 'spam', {
        level,
        untilTs: banUntilTs,
        messageCountInWindow,
      });
    } catch (error) {
      this.repos.restrictions.upsert(args.chatId, args.userId, 'ban_fallback', banUntilTs);

      if (this.config.noticeInChat) {
        await this.replySafe(
          ctx,
          this.withUserName(
            `флуд: активирована блокировка сообщений до ${formatDate(banUntilTs)}.`,
            args.userName,
            args.userId,
          ),
        );
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
        await this.replySafe(
          ctx,
          this.withUserName('сообщение удалено: временная ошибка проверки ссылок.', args.userName, args.userId),
        );
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

  private withUserName(text: string, userName: string | undefined, userId: number): string {
    return `${this.resolveDisplayName(userName, userId)}, ${text}`;
  }

  private resolveDisplayName(userName: string | undefined, userId: number): string {
    const normalized = userName?.trim();
    if (normalized) {
      return normalized;
    }

    return `Пользователь ${userId}`;
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
