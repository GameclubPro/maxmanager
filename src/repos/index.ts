import { BotConfig } from '../types';
import { BetterSqliteDb } from '../db/sqlite';
import { AppSettingsRepo } from './app-settings-repo';
import { BotMessageDeletesRepo } from './bot-message-deletes-repo';
import { ChatSettingsRepo } from './chat-settings-repo';
import { DailyCountRepo } from './daily-count-repo';
import { DomainWhitelistRepo } from './domain-whitelist-repo';
import { MessageEventsRepo } from './message-events-repo';
import { ModerationActionsRepo } from './moderation-actions-repo';
import { ProcessedMessagesRepo } from './processed-messages-repo';
import { PhotoEventsRepo } from './photo-events-repo';
import { RestrictionsRepo } from './restrictions-repo';
import { StrikesRepo } from './strikes-repo';
import { PendingRejoinsRepo } from './pending-rejoins-repo';

export interface Repositories {
  appSettings: AppSettingsRepo;
  botMessageDeletes: BotMessageDeletesRepo;
  chatSettings: ChatSettingsRepo;
  dailyCount: DailyCountRepo;
  domainWhitelist: DomainWhitelistRepo;
  messageEvents: MessageEventsRepo;
  photoEvents: PhotoEventsRepo;
  moderationActions: ModerationActionsRepo;
  pendingRejoins: PendingRejoinsRepo;
  processedMessages: ProcessedMessagesRepo;
  restrictions: RestrictionsRepo;
  strikes: StrikesRepo;
}

export function createRepositories(db: BetterSqliteDb, config: BotConfig): Repositories {
  return {
    appSettings: new AppSettingsRepo(db),
    botMessageDeletes: new BotMessageDeletesRepo(db),
    chatSettings: new ChatSettingsRepo(db, {
      dailyLimit: config.dailyMessageLimit,
      photoLimitPerHour: config.photoLimitPerHour,
      maxTextLength: config.maxTextLength,
      spamThreshold: config.spamThreshold,
      spamWindowSec: config.spamWindowSec,
    }),
    dailyCount: new DailyCountRepo(db),
    domainWhitelist: new DomainWhitelistRepo(db),
    messageEvents: new MessageEventsRepo(db),
    photoEvents: new PhotoEventsRepo(db),
    moderationActions: new ModerationActionsRepo(db),
    pendingRejoins: new PendingRejoinsRepo(db),
    processedMessages: new ProcessedMessagesRepo(db),
    restrictions: new RestrictionsRepo(db),
    strikes: new StrikesRepo(db),
  };
}
