import { Context } from '@maxhub/max-bot-api';
import { BotConfig, ChatSetting, IncomingMessage } from '../types';
import { Repositories } from '../repos';
import { AdminResolver } from '../services/admin-resolver';
import { InMemoryIdempotencyGuard } from '../services/idempotency';
import { BotLogger } from '../services/logger';
import { toDayKey } from '../utils/time';
import { getForbiddenLinks } from './link-detector';
import { isPhotoMessage } from './photo-detector';
import { EnforcementService } from './enforcement';
import { isQuotaExceeded } from './quota';
import { isSpamTriggered } from './spam';
import { AntiBotRiskScorer } from './anti-bot';

const PHOTO_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const DUPLICATE_PURGE_INTERVAL_MS = 5 * 60 * 1000;
const DUPLICATE_SIGNATURE_MIN_LENGTH = 8;
const GLOBAL_SPAMMER_WINDOW_MS = 72 * 60 * 60 * 1000;
const GLOBAL_SPAMMER_MIN_SEVERE_ACTIONS = 1;
const GLOBAL_SPAMMER_MIN_MUTES = 2;
const GLOBAL_SPAMMER_MIN_WARNS = 4;
const GLOBAL_SPAMMER_MIN_RISK_EVENTS = 4;

interface DuplicateMessageSignal extends Record<string, number> {
  windowHours: number;
  previousTs: number;
  secondsSincePrevious: number;
  signatureLength: number;
}

interface GlobalSpammerSignal extends Record<string, number> {
  windowHours: number;
  severeActions: number;
  warns: number;
  mutes: number;
  spamEvents: number;
  linkEvents: number;
  antiBotEvents: number;
}

function getIncomingMessage(ctx: Context): IncomingMessage | undefined {
  const message = ctx.message as IncomingMessage | undefined;
  if (!message) return undefined;
  return message;
}

function getMessageTextLength(message: IncomingMessage): number {
  const directTextLength = typeof message.body.text === 'string'
    ? message.body.text.length
    : 0;
  const forwardedTextLength = typeof message.link?.message?.text === 'string'
    ? message.link.message.text.length
    : 0;

  return directTextLength + forwardedTextLength;
}

export class ModerationEngine {
  private readonly antiBotRiskScorer: AntiBotRiskScorer;
  private readonly recentTextSignatures = new Map<string, number>();
  private lastDuplicatePurgeTs = 0;

  constructor(
    private readonly config: BotConfig,
    private readonly repos: Repositories,
    private readonly adminResolver: AdminResolver,
    private readonly idempotency: InMemoryIdempotencyGuard,
    private readonly enforcement: EnforcementService,
    private readonly logger: BotLogger,
  ) {
    this.antiBotRiskScorer = new AntiBotRiskScorer(repos);
  }

  async handleMessage(ctx: Context): Promise<void> {
    const message = getIncomingMessage(ctx);
    if (!message) return;

    const chatType = message.recipient?.chat_type;
    if (chatType !== 'chat' && chatType !== 'channel') return;

    const chatId = message.recipient.chat_id ?? ctx.chatId;
    const userId = message.sender?.user_id;
    const userName = message.sender?.name;
    const messageId = message.body?.mid;

    if (!chatId || !userId || !messageId) {
      return;
    }

    if (message.sender?.is_bot || userId === ctx.myId) {
      return;
    }

    const nowTs = Date.now();

    if (!this.idempotency.tryMark(chatId, messageId, nowTs)) {
      return;
    }

    try {
      if (!this.repos.processedMessages.tryMarkProcessed(chatId, messageId, nowTs)) {
        return;
      }
    } catch (error) {
      await this.logger.warn('DB dedupe failed, fallback to memory guard', {
        chatId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    let chatSettings: ChatSetting;
    try {
      chatSettings = this.repos.chatSettings.get(chatId);
    } catch (error) {
      await this.logger.error('Failed to load chat settings, using defaults', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      chatSettings = {
        chatId,
        enabled: true,
        dailyLimit: this.config.dailyMessageLimit,
        photoLimitPerHour: this.config.photoLimitPerHour,
        maxTextLength: this.config.maxTextLength,
        spamThreshold: this.config.spamThreshold,
        spamWindowSec: this.config.spamWindowSec,
      };
    }

    if (!chatSettings.enabled) {
      return;
    }

    const isAdmin = await this.adminResolver.isAdmin(ctx, chatId, userId);
    if (isAdmin) {
      return;
    }

    const globalSpammerSignal = this.resolveGlobalSpammerSignal(userId, nowTs);
    if (globalSpammerSignal) {
      await this.enforcement.enforceGlobalSpammerViolation(
        ctx,
        { chatId, userId, userName, messageId },
        globalSpammerSignal,
      );
      return;
    }

    try {
      const activeRestriction = this.repos.restrictions.getActive(chatId, userId, nowTs);
      if (activeRestriction) {
        await this.enforcement.enforceActiveRestriction(ctx, {
          chatId,
          userId,
          userName,
          messageId,
          restrictionType: activeRestriction.type,
          untilTs: activeRestriction.untilTs,
          createdAtTs: activeRestriction.createdAtTs,
        });
        return;
      }
    } catch (error) {
      await this.logger.error('Restriction check failed', {
        chatId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    let whitelistDomains: string[] = [];
    let whitelistError = false;

    try {
      whitelistDomains = this.repos.domainWhitelist.list(chatId);
    } catch (error) {
      whitelistError = true;
      await this.logger.error('Whitelist lookup failed, fail-closed for link moderation', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (whitelistError) {
      await this.enforcement.handleCriticalFailure(ctx, { chatId, userId, userName, messageId }, 'link');
      return;
    }

    const forbiddenLinks = getForbiddenLinks(message, whitelistDomains);
    if (forbiddenLinks.length > 0) {
      await this.enforcement.enforceLinkViolation(ctx, { chatId, userId, userName, messageId }, {
        forbiddenLinks,
      });
      return;
    }

    if (chatSettings.maxTextLength > 0) {
      const textLength = getMessageTextLength(message);
      if (textLength > chatSettings.maxTextLength) {
        await this.enforcement.enforceTextLengthViolation(
          ctx,
          { chatId, userId, userName, messageId },
          textLength,
          chatSettings.maxTextLength,
        );
        return;
      }
    }

    const duplicateSignal = this.resolveDuplicateMessageSignal(chatId, userId, message, nowTs);
    if (duplicateSignal) {
      await this.enforcement.enforceDuplicateViolation(
        ctx,
        { chatId, userId, userName, messageId },
        duplicateSignal,
      );
      return;
    }

    const antiBotAssessment = this.antiBotRiskScorer.assess({
      chatId,
      userId,
      message,
      nowTs,
    });
    if (antiBotAssessment.shouldAct) {
      await this.enforcement.enforceAntiBotViolation(
        ctx,
        { chatId, userId, userName, messageId },
        antiBotAssessment,
      );
      return;
    }

    if (chatSettings.photoLimitPerHour > 0 && isPhotoMessage(message)) {
      try {
        const fromTs = nowTs - PHOTO_LIMIT_WINDOW_MS;
        const photoCountInWindow = this.repos.photoEvents.countSince(chatId, userId, fromTs);
        if (photoCountInWindow >= chatSettings.photoLimitPerHour) {
          await this.enforcement.enforcePhotoQuotaViolation(
            ctx,
            { chatId, userId, userName, messageId },
            photoCountInWindow + 1,
            chatSettings.photoLimitPerHour,
          );
          return;
        }

        this.repos.photoEvents.add(chatId, userId, nowTs);
      } catch (error) {
        await this.logger.error('Photo quota check failed (fail-open)', {
          chatId,
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (chatSettings.dailyLimit > 0) {
      try {
        const dayKey = toDayKey(nowTs, this.config.timezone);
        const currentCount = this.repos.dailyCount.incrementAndGet(chatId, userId, dayKey);
        if (isQuotaExceeded(currentCount, chatSettings.dailyLimit)) {
          await this.enforcement.enforceQuotaViolation(
            ctx,
            { chatId, userId, userName, messageId },
            currentCount,
            chatSettings.dailyLimit,
          );
          return;
        }
      } catch (error) {
        await this.logger.error('Quota check failed (fail-open)', {
          chatId,
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    try {
      this.repos.messageEvents.add(chatId, userId, nowTs);
      const fromTs = nowTs - chatSettings.spamWindowSec * 1_000;
      const messageCountInWindow = this.repos.messageEvents.countSince(chatId, userId, fromTs);

      if (isSpamTriggered(messageCountInWindow, chatSettings.spamThreshold)) {
        await this.enforcement.enforceSpamViolation(
          ctx,
          { chatId, userId, userName, messageId },
          messageCountInWindow,
        );
      }
    } catch (error) {
      await this.logger.error('Spam check failed (fail-open)', {
        chatId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private resolveDuplicateMessageSignal(
    chatId: number,
    userId: number,
    message: IncomingMessage,
    nowTs: number,
  ): DuplicateMessageSignal | null {
    this.purgeDuplicateSignatures(nowTs);

    const signature = this.buildDuplicateSignature(message);
    if (!signature) {
      return null;
    }

    const cacheKey = `${chatId}:${userId}:${signature}`;
    const previousTs = this.recentTextSignatures.get(cacheKey);
    this.recentTextSignatures.set(cacheKey, nowTs);

    if (typeof previousTs !== 'number' || previousTs < nowTs - DUPLICATE_WINDOW_MS) {
      return null;
    }

    return {
      windowHours: DUPLICATE_WINDOW_MS / (60 * 60 * 1000),
      previousTs,
      secondsSincePrevious: Math.max(1, Math.floor((nowTs - previousTs) / 1000)),
      signatureLength: signature.length,
    };
  }

  private buildDuplicateSignature(message: IncomingMessage): string | null {
    const combinedText = [message.body.text, message.link?.message?.text]
      .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      .map((value) => value.trim())
      .join(' ')
      .trim();

    if (!combinedText) {
      return null;
    }

    const normalized = combinedText
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (normalized.length < DUPLICATE_SIGNATURE_MIN_LENGTH) {
      return null;
    }

    return normalized.slice(0, 240);
  }

  private purgeDuplicateSignatures(nowTs: number): void {
    if (this.lastDuplicatePurgeTs > 0 && nowTs - this.lastDuplicatePurgeTs < DUPLICATE_PURGE_INTERVAL_MS) {
      return;
    }

    const minTs = nowTs - DUPLICATE_WINDOW_MS;
    for (const [key, ts] of this.recentTextSignatures.entries()) {
      if (ts < minTs) {
        this.recentTextSignatures.delete(key);
      }
    }

    this.lastDuplicatePurgeTs = nowTs;
  }

  private resolveGlobalSpammerSignal(userId: number, nowTs: number): GlobalSpammerSignal | null {
    const sinceTs = nowTs - GLOBAL_SPAMMER_WINDOW_MS;

    const severeActions = this.repos.moderationActions.countByUserActionSince(userId, 'ban', sinceTs)
      + this.repos.moderationActions.countByUserActionSince(userId, 'ban_fallback', sinceTs)
      + this.repos.moderationActions.countByUserActionSince(userId, 'kick', sinceTs)
      + this.repos.moderationActions.countByUserActionSince(userId, 'kick_auto', sinceTs);

    if (severeActions < GLOBAL_SPAMMER_MIN_SEVERE_ACTIONS) {
      return null;
    }

    const warns = this.repos.moderationActions.countByUserActionSince(userId, 'warn', sinceTs);
    const mutes = this.repos.moderationActions.countByUserActionSince(userId, 'mute', sinceTs);
    const spamEvents = this.repos.moderationActions.countByUserReasonSince(userId, 'spam', sinceTs);
    const linkEvents = this.repos.moderationActions.countByUserReasonSince(userId, 'link', sinceTs);
    const antiBotEvents = this.repos.moderationActions.countByUserReasonSince(userId, 'anti_bot', sinceTs);
    const riskEvents = spamEvents + linkEvents + antiBotEvents;

    if (
      mutes < GLOBAL_SPAMMER_MIN_MUTES
      && warns < GLOBAL_SPAMMER_MIN_WARNS
      && riskEvents < GLOBAL_SPAMMER_MIN_RISK_EVENTS
    ) {
      return null;
    }

    return {
      windowHours: GLOBAL_SPAMMER_WINDOW_MS / (60 * 60 * 1000),
      severeActions,
      warns,
      mutes,
      spamEvents,
      linkEvents,
      antiBotEvents,
    };
  }
}
