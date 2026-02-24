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

const PHOTO_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function getIncomingMessage(ctx: Context): IncomingMessage | undefined {
  const message = ctx.message as IncomingMessage | undefined;
  if (!message) return undefined;
  return message;
}

export class ModerationEngine {
  constructor(
    private readonly config: BotConfig,
    private readonly repos: Repositories,
    private readonly adminResolver: AdminResolver,
    private readonly idempotency: InMemoryIdempotencyGuard,
    private readonly enforcement: EnforcementService,
    private readonly logger: BotLogger,
  ) {}

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
}
