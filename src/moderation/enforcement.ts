import { Context } from '@maxhub/max-bot-api';
import { BotConfig, RestrictionType, ViolationKind } from '../types';
import { Repositories } from '../repos';
import { BotLogger } from '../services/logger';
import { computeBotMessageDeleteAt, extractMessageId } from '../services/bot-message-autodelete';
import { hoursToMs } from '../utils/time';
import { AntiBotAssessment } from './anti-bot';

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
const DELETE_RETRY_DELAYS_MS = [0, 200, 500];
const ANTI_BOT_MUTE_HOURS = 6;
const REPEATED_MUTE_WINDOW_MS = 24 * 60 * 60 * 1000;
const REPEATED_MUTE_AUTO_REMOVE_THRESHOLD = 2;
const REPEATED_MUTE_REASON = 'mute_repeat_24h';
const PRICE_CHAT_BUTTON_TEXT = 'Прайс';
const PRICE_CHAT_BUTTON_URL = 'https://max.ru/join/pgwSRjGbOCcwHyT0U2nckeFIl-xpwlv_7Iy5UArer6o';

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
          this.priceChatButtonExtra(),
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
          this.priceChatButtonExtra(),
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

    await this.recordMuteAndHandleRepeatRemoval(ctx, args, 'link', {
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

      await this.recordMuteAndHandleRepeatRemoval(ctx, args, 'photo_quota', {
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

      await this.recordMuteAndHandleRepeatRemoval(ctx, args, 'spam', {
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
        userName: this.resolveDisplayName(args.userName, args.userId),
      });
      await this.notifyAdminsAboutSpamKick(args, level, messageCountInWindow, banUntilTs);
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
        userName: this.resolveDisplayName(args.userName, args.userId),
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

  async enforceAntiBotViolation(ctx: Context, args: ViolationContext, assessment: AntiBotAssessment): Promise<void> {
    const antiBotMeta = {
      totalScore: assessment.totalScore,
      signals: assessment.signals,
    };

    await this.deleteMessageSafe(ctx, args.messageId);
    this.recordAndLog(args.chatId, args.userId, 'delete_message', 'anti_bot', antiBotMeta);

    if (!assessment.shouldMute) {
      if (this.config.noticeInChat) {
        await this.replySafe(
          ctx,
          this.withUserName(
            'подозрительная активность: сообщение удалено. Повторение приведёт к муту.',
            args.userName,
            args.userId,
          ),
          { notify: false },
        );
      }

      this.recordAndLog(args.chatId, args.userId, 'warn', 'anti_bot', antiBotMeta);
      return;
    }

    const untilTs = Date.now() + hoursToMs(ANTI_BOT_MUTE_HOURS);
    this.repos.restrictions.upsert(args.chatId, args.userId, 'mute', untilTs);

    if (this.config.noticeInChat) {
      await this.replySafe(
        ctx,
        this.withUserName(
          `подозрение на бота: выдан мут на ${ANTI_BOT_MUTE_HOURS} ч. до ${formatDate(untilTs)}.`,
          args.userName,
          args.userId,
        ),
        { notify: false },
      );
    }

    await this.recordMuteAndHandleRepeatRemoval(ctx, args, 'anti_bot', {
      ...antiBotMeta,
      untilTs,
      muteHours: ANTI_BOT_MUTE_HOURS,
    });
  }

  private async deleteMessageSafe(ctx: Context, messageId: string): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt < DELETE_RETRY_DELAYS_MS.length; attempt += 1) {
      const delayMs = DELETE_RETRY_DELAYS_MS[attempt];
      if (delayMs > 0) {
        await this.delay(delayMs);
      }

      try {
        await ctx.deleteMessage(messageId);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    await this.logger.warn('Failed to delete message', {
      messageId,
      attempts: DELETE_RETRY_DELAYS_MS.length,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    });
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

  private priceChatButtonExtra(): unknown {
    return {
      attachments: [
        {
          type: 'inline_keyboard',
          payload: {
            buttons: [[{ type: 'link', text: PRICE_CHAT_BUTTON_TEXT, url: PRICE_CHAT_BUTTON_URL }]],
          },
        },
      ],
    };
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
        userName: this.resolveDisplayName(args.userName, args.userId),
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
        userName: this.resolveDisplayName(args.userName, args.userId),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async recordMuteAndHandleRepeatRemoval(
    ctx: Context,
    args: ViolationContext,
    reason: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    this.recordAndLog(args.chatId, args.userId, 'mute', reason, {
      ...meta,
      userName: this.resolveDisplayName(args.userName, args.userId),
    });
    await this.maybeAutoRemoveAfterRepeatedMutes(ctx, args, reason);
  }

  private async maybeAutoRemoveAfterRepeatedMutes(
    ctx: Context,
    args: ViolationContext,
    triggerReason: string,
  ): Promise<void> {
    const nowTs = Date.now();
    const sinceTs = nowTs - REPEATED_MUTE_WINDOW_MS;

    const mutesInWindow = this.repos.moderationActions.countByActionSince(
      args.chatId,
      args.userId,
      'mute',
      sinceTs,
    );

    if (mutesInWindow < REPEATED_MUTE_AUTO_REMOVE_THRESHOLD) {
      return;
    }

    const alreadyAutoRemoved = this.repos.moderationActions.countByActionAndReasonSince(
      args.chatId,
      args.userId,
      'kick_auto',
      REPEATED_MUTE_REASON,
      sinceTs,
    );
    if (alreadyAutoRemoved > 0) {
      return;
    }

    try {
      await (ctx.api.raw.chats as {
        removeChatMember: (payload: { chat_id: number; user_id: number; block?: boolean }) => Promise<unknown>;
      }).removeChatMember({
        chat_id: args.chatId,
        user_id: args.userId,
      });

      if (this.config.noticeInChat) {
        await this.replySafe(
          ctx,
          this.withUserName(
            'получено 2 мута за 24 часа. Вы автоматически удалены из чата.',
            args.userName,
            args.userId,
          ),
          { notify: false },
        );
      }

      this.recordAndLog(args.chatId, args.userId, 'kick_auto', REPEATED_MUTE_REASON, {
        triggerReason,
        mutesInWindow,
        threshold: REPEATED_MUTE_AUTO_REMOVE_THRESHOLD,
        windowHours: 24,
        userName: this.resolveDisplayName(args.userName, args.userId),
      });
    } catch (error) {
      await this.logger.warn('Failed to auto-remove user after repeated mutes', {
        chatId: args.chatId,
        userId: args.userId,
        triggerReason,
        mutesInWindow,
        error: error instanceof Error ? error.message : String(error),
      });

      this.recordAndLog(args.chatId, args.userId, 'kick_auto_failed', REPEATED_MUTE_REASON, {
        triggerReason,
        mutesInWindow,
        threshold: REPEATED_MUTE_AUTO_REMOVE_THRESHOLD,
        windowHours: 24,
        userName: this.resolveDisplayName(args.userName, args.userId),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async notifyAdminsAboutSpamKick(
    args: ViolationContext,
    level: number,
    messageCountInWindow: number,
    banUntilTs: number,
  ): Promise<void> {
    await this.logger.warn('Spam kick executed', {
      chatId: args.chatId,
      userId: args.userId,
      userName: this.resolveDisplayName(args.userName, args.userId),
      reason: 'spam',
      strikeLevel: level,
      messageCountInWindow,
      spamWindowSec: this.config.spamWindowSec,
      blocked: true,
      banUntilTs,
      banUntil: formatDate(banUntilTs),
    });
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

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
