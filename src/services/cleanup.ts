import { BotConfig } from '../types';
import { Repositories } from '../repos';
import { hoursToMs, toDayKey } from '../utils/time';

export class CleanupService {
  constructor(
    private readonly repos: Repositories,
    private readonly config: BotConfig,
  ) {}

  run(nowTs: number = Date.now()): void {
    const maxWindowMs = Math.max(
      hoursToMs(this.config.banHours),
      hoursToMs(this.config.strikeDecayHours),
      this.config.spamWindowSec * 1_000,
    );

    this.repos.messageEvents.purgeOlderThan(nowTs - Math.max(maxWindowMs, 24 * 60 * 60 * 1000));
    this.repos.restrictions.purgeExpired(nowTs);
    this.repos.strikes.purgeOlderThan(nowTs - hoursToMs(this.config.strikeDecayHours));
    this.repos.processedMessages.purgeOlderThan(nowTs - 2 * 24 * 60 * 60 * 1000);

    const eightDaysAgo = nowTs - 8 * 24 * 60 * 60 * 1000;
    this.repos.dailyCount.purgeOlderThan(toDayKey(eightDaysAgo, this.config.timezone));
  }
}
