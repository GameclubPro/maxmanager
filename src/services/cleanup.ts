import { Api } from '@maxhub/max-bot-api';
import { BotConfig } from '../types';
import { Repositories } from '../repos';
import { hoursToMs, toDayKey } from '../utils/time';
import { BotLogger } from './logger';

const REJOIN_BATCH_SIZE = 100;
const REJOIN_RETRY_DELAY_MS = 10 * 60 * 1000;
const REJOIN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export class CleanupService {
  constructor(
    private readonly repos: Repositories,
    private readonly config: BotConfig,
    private readonly api: Api,
    private readonly logger: BotLogger,
  ) {}

  async run(nowTs: number = Date.now()): Promise<void> {
    const maxWindowMs = Math.max(
      hoursToMs(this.config.banHours),
      hoursToMs(this.config.strikeDecayHours),
      this.config.spamWindowSec * 1_000,
    );

    this.repos.messageEvents.purgeOlderThan(nowTs - Math.max(maxWindowMs, 24 * 60 * 60 * 1000));
    this.repos.restrictions.purgeExpired(nowTs);
    this.repos.strikes.purgeOlderThan(nowTs - hoursToMs(this.config.strikeDecayHours));
    this.repos.processedMessages.purgeOlderThan(nowTs - 2 * 24 * 60 * 60 * 1000);
    this.repos.pendingRejoins.purgeOlderThan(nowTs - REJOIN_RETENTION_MS);

    const eightDaysAgo = nowTs - 8 * 24 * 60 * 60 * 1000;
    this.repos.dailyCount.purgeOlderThan(toDayKey(eightDaysAgo, this.config.timezone));

    await this.processPendingRejoins(nowTs);
  }

  private async processPendingRejoins(nowTs: number): Promise<void> {
    const dueRejoins = this.repos.pendingRejoins.listDue(nowTs, REJOIN_BATCH_SIZE);

    for (const entry of dueRejoins) {
      try {
        await this.api.addChatMembers(entry.chatId, [entry.userId]);
        this.repos.pendingRejoins.remove(entry.chatId, entry.userId);

        this.repos.moderationActions.record({
          chatId: entry.chatId,
          userId: entry.userId,
          action: 'rejoin',
          reason: 'active_mute',
          meta: {
            rejoinAtTs: entry.rejoinAtTs,
          },
        });

        await this.logger.info('User re-added after temporary kick', {
          chatId: entry.chatId,
          userId: entry.userId,
        });
      } catch (error) {
        const nextAttemptTs = nowTs + REJOIN_RETRY_DELAY_MS;
        this.repos.pendingRejoins.postpone(entry.chatId, entry.userId, nextAttemptTs);

        await this.logger.warn('Failed to re-add user after temporary kick; retry postponed', {
          chatId: entry.chatId,
          userId: entry.userId,
          nextAttemptTs,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
