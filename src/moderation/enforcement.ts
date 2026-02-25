import { Context } from '@maxhub/max-bot-api';
import { BotConfig, RestrictionType, ViolationKind } from '../types';
import { Repositories } from '../repos';
import { BotLogger } from '../services/logger';
import { computeBotMessageDeleteAt, extractMessageId } from '../services/bot-message-autodelete';
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
const PHOTO_QUOTA_WINDOW_MS = 60 * 60 * 1000;
const PHOTO_QUOTA_MAX_DELETES_BEFORE_MUTE = 5;
const PHOTO_QUOTA_MUTE_HOURS = 3;
const ACTIVE_MUTE_MAX_MESSAGES = 5;
const ACTIVE_MUTE_TEMP_KICK_HOURS = 3;
const DELETE_MESSAGE_RETRY_DELAYS_MS = [350, 1_200] as const;

interface DeleteMessageResult {
  deleted: boolean;
  attempts: number;
  lastError?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class EnforcementService {
  constructor(
    private readonly repos: Repositories,
    private readonly config: BotConfig,
    private readonly logger: BotLogger,
  ) {}

  async enforceActiveRestriction(
    ctx: Context,
    args: ViolationContext & { restrictionType: RestrictionType; untilTs: number; createdAtTs: number },
  ): Promise<void> {
    await this.deleteMessageSafe(ctx, args.messageId);

    if (args.restrictionType === 'mute') {
      const messagesDuringMute = this.repos.moderationActions.countByActionAndReasonSince(
        args.chatId,
        args.userId,
        'delete_message',
        'active_mute',
        args.createdAtTs,
      ) + 1;

      this.recordAndLog(args.chatId, args.userId, 'delete_message', 'active_mute', {
        untilTs: args.untilTs,
        createdAtTs: args.createdAtTs,
        messagesDuringMute,
      });

      if (messagesDuringMute > ACTIVE_MUTE_MAX_MESSAGES) {
        await this.kickForMuteEvasion(ctx, args, messagesDuringMute);
      }
      return;
    }

    if (this.config.noticeInChat) {
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

    const deleteResult = await this.deleteMessageSafe(ctx, args.messageId);
    if (!deleteResult.deleted) {
      await this.logger.warn('Link violation message was not deleted; skipping escalation', {
        chatId: args.chatId,
        userId: args.userId,
        messageId: args.messageId,
        attempts: deleteResult.attempts,
        error: deleteResult.lastError ?? 'unknown',
      });
      return;
    }

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

  async enforceTextLengthViolation(
    ctx: Context,
    args: ViolationContext,
    currentTextLength: number,
    maxTextLength: number,
  ): Promise<void> {
    await this.deleteMessageSafe(ctx, args.messageId);

    if (this.config.noticeInChat) {
      await this.replySafe(
        ctx,
        this.withUserName(
          `сообщение слишком длинное (${currentTextLength} символов). Допустимо до ${maxTextLength} символов.`,
          args.userName,
          args.userId,
        ),
        { notify: false },
      );
    }

    this.recordAndLog(args.chatId, args.userId, 'delete_message', 'text_length', {
      currentTextLength,
      maxTextLength,
    });
    this.recordAndLog(args.chatId, args.userId, 'warn', 'text_length', {
      currentTextLength,
      maxTextLength,
    });
  }

  async enforcePhotoQuotaViolation(
    ctx: Context,
    args: ViolationContext,
    currentPhotoCountInWindow: number,
    limitPerHour: number,
  ): Promise<void> {
    const nowTs = Date.now();
    const sinceTs = nowTs - PHOTO_QUOTA_WINDOW_MS;
    const photoViolationsCount = this.repos.moderationActions.countByActionAndReasonSince(
      args.chatId,
      args.userId,
      'delete_message',
      'photo_quota',
      sinceTs,
    ) + 1;
    const warningCount = this.repos.moderationActions.countByActionAndReasonSince(
      args.chatId,
      args.userId,
      'warn',
      'photo_quota',
      sinceTs,
    );

    await this.deleteMessageSafe(ctx, args.messageId);

    this.recordAndLog(args.chatId, args.userId, 'delete_message', 'photo_quota', {
      currentPhotoCountInWindow,
      limitPerHour,
      photoViolationsCount,
      windowMinutes: 60,
    });

    if (photoViolationsCount > PHOTO_QUOTA_MAX_DELETES_BEFORE_MUTE) {
      const untilTs = nowTs + hoursToMs(PHOTO_QUOTA_MUTE_HOURS);
      this.repos.restrictions.upsert(args.chatId, args.userId, 'mute', untilTs);

      if (this.config.noticeInChat) {
        await this.replySafe(
          ctx,
          this.withUserName(
            `вы продолжили отправку фото сверх лимита. Выдан мут на ${PHOTO_QUOTA_MUTE_HOURS} часа.`,
            args.userName,
            args.userId,
          ),
          { notify: false },
        );
      }

      this.recordAndLog(args.chatId, args.userId, 'mute', 'photo_quota', {
        currentPhotoCountInWindow,
        limitPerHour,
        photoViolationsCount,
        untilTs,
        muteHours: PHOTO_QUOTA_MUTE_HOURS,
        windowMinutes: 60,
      });
      return;
    }

    if (warningCount === 0 && this.config.noticeInChat) {
      await this.replySafe(
        ctx,
        this.withUserName(
          `в этом чате можно отправлять не более ${limitPerHour} фото-сообщений в час. Это помогает не перегружать ленту. Следующее фото отправьте, пожалуйста, позже.`,
          args.userName,
          args.userId,
        ),
        { notify: false },
      );

      this.recordAndLog(args.chatId, args.userId, 'warn', 'photo_quota', {
        currentPhotoCountInWindow,
        limitPerHour,
        photoViolationsCount,
        windowMinutes: 60,
      });
    }
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
      const deleteResult = await this.deleteMessageSafe(ctx, args.messageId);
      if (!deleteResult.deleted) {
        await this.logger.warn('Link fail-closed message was not deleted; skipping chat notice', {
          chatId: args.chatId,
          userId: args.userId,
          messageId: args.messageId,
          attempts: deleteResult.attempts,
          error: deleteResult.lastError ?? 'unknown',
        });
        return;
      }

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

  private async deleteMessageSafe(ctx: Context, messageId: string): Promise<DeleteMessageResult> {
    let attempts = 0;
    let lastError: string | undefined;

    for (let index = 0; index <= DELETE_MESSAGE_RETRY_DELAYS_MS.length; index += 1) {
      attempts += 1;

      try {
        await ctx.deleteMessage(messageId);
        return { deleted: true, attempts };
      } catch (error) {
        if (this.isMessageAlreadyDeleted(error)) {
          return { deleted: true, attempts };
        }

        lastError = error instanceof Error ? error.message : String(error);

        const retryDelay = DELETE_MESSAGE_RETRY_DELAYS_MS[index];
        if (retryDelay !== undefined) {
          await sleep(retryDelay);
        }
      }
    }

    await this.logger.warn('Failed to delete message', {
      messageId,
      attempts,
      error: lastError ?? 'unknown',
    });

    return { deleted: false, attempts, lastError };
  }

  private async replySafe(ctx: Context, text: string, extra?: unknown): Promise<void> {
    try {
      const sentMessage = await ctx.reply(text, extra as never);
      const sentMessageId = extractMessageId(sentMessage);
      if (sentMessageId) {
        this.repos.botMessageDeletes.schedule(sentMessageId, computeBotMessageDeleteAt());
      }
    } catch (error) {
      await this.logger.warn('Failed to send chat notice', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private withUserName(text: string, userName: string | undefined, userId: number): string {
    return `«${this.resolveDisplayName(userName, userId)}», ${text}`;
  }

  private async kickForMuteEvasion(
    ctx: Context,
    args: ViolationContext & { untilTs: number },
    messagesDuringMute: number,
  ): Promise<void> {
    const rejoinAtTs = Date.now() + hoursToMs(ACTIVE_MUTE_TEMP_KICK_HOURS);

    try {
      await (ctx.api.raw.chats as {
        removeChatMember: (payload: { chat_id: number; user_id: number; block?: boolean }) => Promise<unknown>;
      }).removeChatMember({
        chat_id: args.chatId,
        user_id: args.userId,
      });

      this.repos.pendingRejoins.upsert(args.chatId, args.userId, rejoinAtTs);

      this.recordAndLog(args.chatId, args.userId, 'kick_temp', 'active_mute', {
        messagesDuringMute,
        threshold: ACTIVE_MUTE_MAX_MESSAGES,
        rejoinAtTs,
        kickHours: ACTIVE_MUTE_TEMP_KICK_HOURS,
      });
    } catch (error) {
      await this.logger.warn('Failed to temporarily kick user for mute evasion', {
        chatId: args.chatId,
        userId: args.userId,
        messagesDuringMute,
        error: error instanceof Error ? error.message : String(error),
      });

      this.recordAndLog(args.chatId, args.userId, 'kick_temp_failed', 'active_mute', {
        messagesDuringMute,
        threshold: ACTIVE_MUTE_MAX_MESSAGES,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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

  private isMessageAlreadyDeleted(error: unknown): boolean {
    const status = this.extractErrorStatus(error);
    if (status === 404) {
      return true;
    }

    const normalized = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return normalized.includes('not found')
      || normalized.includes('message not found')
      || normalized.includes('already deleted');
  }

  private extractErrorStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') {
      return undefined;
    }

    const status = (error as { status?: unknown }).status;
    if (typeof status !== 'number') {
      return undefined;
    }

    return Number.isFinite(status) ? status : undefined;
  }
}
