import { Bot } from '@maxhub/max-bot-api';
import { BotConfig } from './types';
import { SqliteDatabase } from './db/sqlite';
import { createRepositories, Repositories } from './repos';
import { BotLogger } from './services/logger';
import { AdminResolver } from './services/admin-resolver';
import { InMemoryIdempotencyGuard } from './services/idempotency';
import { EnforcementService } from './moderation/enforcement';
import { ModerationEngine } from './moderation/moderation-engine';
import { AdminCommands } from './commands/admin';
import { CleanupService } from './services/cleanup';
import { BOT_MESSAGE_AUTO_DELETE_DELAY_MS } from './services/bot-message-autodelete';

export interface Runtime {
  bot: Bot;
  db: SqliteDatabase;
  repos: Repositories;
  logger: BotLogger;
  cleanupService: CleanupService;
}

const COMMANDS = [
  { name: 'mod_status', description: 'Показать настройки модерации' },
  { name: 'mod_on', description: 'Включить модерацию в этом чате' },
  { name: 'mod_off', description: 'Отключить модерацию в этом чате' },
  { name: 'allowdomain_add', description: 'Добавить домен в whitelist' },
  { name: 'allowdomain_del', description: 'Удалить домен из whitelist' },
  { name: 'allowdomain_list', description: 'Список whitelist доменов' },
  { name: 'set_limit', description: 'Сменить суточный лимит сообщений' },
  { name: 'set_photo_limit', description: 'Сменить лимит фото-сообщений в час' },
  { name: 'set_text_limit', description: 'Сменить лимит длины текста' },
  { name: 'set_spam', description: 'Сменить антиспам порог' },
  { name: 'set_logchat', description: 'Установить чат логов' },
];

export async function createRuntime(config: BotConfig): Promise<Runtime> {
  const db = new SqliteDatabase(config.databasePath);
  const repos = createRepositories(db.db, config);

  if (!repos.appSettings.getLogChatId() && config.logChatId) {
    repos.appSettings.setLogChatId(config.logChatId);
  }

  const bot = new Bot(config.botToken);

  const logger = new BotLogger(
    bot.api,
    () => repos.appSettings.getLogChatId() ?? config.logChatId,
    (messageId, sentAtTs) => {
      repos.botMessageDeletes.schedule(messageId, sentAtTs + BOT_MESSAGE_AUTO_DELETE_DELAY_MS);
    },
  );
  const adminResolver = new AdminResolver(60_000, (message, meta) => {
    void logger.warn(message, meta);
  });
  const idempotencyGuard = new InMemoryIdempotencyGuard();
  const enforcement = new EnforcementService(repos, config, logger);
  const moderationEngine = new ModerationEngine(
    config,
    repos,
    adminResolver,
    idempotencyGuard,
    enforcement,
    logger,
  );
  const adminCommands = new AdminCommands(repos, config, adminResolver, logger);
  const cleanupService = new CleanupService(repos, config, bot.api, logger);

  bot.catch(async (error, ctx) => {
    await logger.error('Unhandled bot middleware error', {
      updateType: ctx.updateType,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  });

  bot.on('message_created', async (ctx) => {
    if (await adminCommands.tryHandle(ctx)) {
      return;
    }

    await moderationEngine.handleMessage(ctx);
  });

  try {
    await bot.api.setMyCommands(COMMANDS);
  } catch (error) {
    await logger.warn('Failed to set bot commands', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    bot,
    db,
    repos,
    logger,
    cleanupService,
  };
}
