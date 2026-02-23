import { Context } from '@maxhub/max-bot-api';
import { BotConfig, IncomingMessage } from '../types';
import { Repositories } from '../repos';
import { AdminResolver } from '../services/admin-resolver';
import { BotLogger } from '../services/logger';

const ADMIN_COMMANDS = new Set([
  'mod_status',
  'mod_on',
  'mod_off',
  'allowdomain_add',
  'allowdomain_del',
  'allowdomain_list',
  'set_limit',
  'set_spam',
  'set_logchat',
]);

interface ParsedCommand {
  command: string;
  rawArgs: string;
}

function getMessage(ctx: Context): IncomingMessage | undefined {
  return ctx.message as IncomingMessage | undefined;
}

function parseAdminCommand(text: string): ParsedCommand | null {
  const match = text.trim().match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+(.+))?$/i);
  if (!match) return null;

  const command = match[1].toLowerCase();
  const rawArgs = (match[2] ?? '').trim();

  if (!ADMIN_COMMANDS.has(command)) {
    return null;
  }

  return { command, rawArgs };
}

export class AdminCommands {
  constructor(
    private readonly repos: Repositories,
    private readonly config: BotConfig,
    private readonly adminResolver: AdminResolver,
    private readonly logger: BotLogger,
  ) {}

  async tryHandle(ctx: Context): Promise<boolean> {
    const message = getMessage(ctx);
    if (!message?.body?.text) return false;

    const parsed = parseAdminCommand(message.body.text);
    if (!parsed) return false;

    const chatType = message.recipient?.chat_type;
    const chatId = message.recipient?.chat_id ?? ctx.chatId;
    const userId = message.sender?.user_id;

    if ((chatType !== 'chat' && chatType !== 'channel') || !chatId || !userId) {
      return true;
    }

    const isAdmin = await this.adminResolver.isAdmin(ctx, chatId, userId);
    if (!isAdmin) {
      await this.replySafe(ctx, 'Команда доступна только администраторам чата.');
      await this.logger.warn('Admin command denied', { chatId, userId, command: parsed.command });
      return false;
    }

    try {
      switch (parsed.command) {
        case 'mod_status':
          await this.handleModStatus(ctx, chatId);
          break;
        case 'mod_on':
          this.repos.chatSettings.setEnabled(chatId, true);
          await this.replySafe(ctx, 'Модерация включена.');
          this.auditConfigChange(chatId, userId, parsed.command, {});
          break;
        case 'mod_off':
          this.repos.chatSettings.setEnabled(chatId, false);
          await this.replySafe(ctx, 'Модерация отключена.');
          this.auditConfigChange(chatId, userId, parsed.command, {});
          break;
        case 'allowdomain_add':
          await this.handleAllowDomainAdd(ctx, chatId, userId, parsed.rawArgs);
          break;
        case 'allowdomain_del':
          await this.handleAllowDomainDelete(ctx, chatId, userId, parsed.rawArgs);
          break;
        case 'allowdomain_list':
          await this.handleAllowDomainList(ctx, chatId);
          break;
        case 'set_limit':
          await this.handleSetLimit(ctx, chatId, userId, parsed.rawArgs);
          break;
        case 'set_spam':
          await this.handleSetSpam(ctx, chatId, userId, parsed.rawArgs);
          break;
        case 'set_logchat':
          await this.handleSetLogChat(ctx, chatId, userId, parsed.rawArgs);
          break;
        default:
          break;
      }
    } catch (error) {
      await this.replySafe(ctx, 'Не удалось выполнить команду. Проверьте аргументы.');
      await this.logger.error('Admin command failed', {
        chatId,
        userId,
        command: parsed.command,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return true;
  }

  private async handleModStatus(ctx: Context, chatId: number): Promise<void> {
    const settings = this.repos.chatSettings.get(chatId);
    const whitelist = this.repos.domainWhitelist.list(chatId);
    const logChatId = this.repos.appSettings.getLogChatId() ?? this.config.logChatId;

    const text = [
      'Текущие настройки модерации:',
      `- status: ${settings.enabled ? 'on' : 'off'}`,
      `- daily_limit: ${settings.dailyLimit}`,
      `- spam: ${settings.spamThreshold} сообщений / ${settings.spamWindowSec} сек`,
      `- whitelist: ${whitelist.length > 0 ? whitelist.join(', ') : '(пусто)'}`,
      `- log_chat_id: ${logChatId ?? '(не задан)'}`,
    ].join('\n');

    await this.replySafe(ctx, text);
  }

  private async handleAllowDomainAdd(ctx: Context, chatId: number, userId: number, rawArgs: string): Promise<void> {
    if (!rawArgs) {
      await this.replySafe(ctx, 'Использование: /allowdomain_add <domain>');
      return;
    }

    const normalized = this.repos.domainWhitelist.add(chatId, rawArgs);
    await this.replySafe(ctx, `Домен добавлен в whitelist: ${normalized}`);
    this.auditConfigChange(chatId, userId, 'allowdomain_add', { domain: normalized });
  }

  private async handleAllowDomainDelete(ctx: Context, chatId: number, userId: number, rawArgs: string): Promise<void> {
    if (!rawArgs) {
      await this.replySafe(ctx, 'Использование: /allowdomain_del <domain>');
      return;
    }

    const normalized = this.repos.domainWhitelist.remove(chatId, rawArgs);
    await this.replySafe(ctx, `Домен удален из whitelist: ${normalized}`);
    this.auditConfigChange(chatId, userId, 'allowdomain_del', { domain: normalized });
  }

  private async handleAllowDomainList(ctx: Context, chatId: number): Promise<void> {
    const list = this.repos.domainWhitelist.list(chatId);
    const text = list.length > 0
      ? `Разрешенные домены:\n${list.map((domain) => `- ${domain}`).join('\n')}`
      : 'Whitelist пуст.';

    await this.replySafe(ctx, text);
  }

  private async handleSetLimit(ctx: Context, chatId: number, userId: number, rawArgs: string): Promise<void> {
    const value = Number.parseInt(rawArgs, 10);
    if (!Number.isFinite(value) || value < 1 || value > 10_000) {
      await this.replySafe(ctx, 'Использование: /set_limit <1..10000>');
      return;
    }

    this.repos.chatSettings.setDailyLimit(chatId, value);
    await this.replySafe(ctx, `Новый суточный лимит: ${value}`);
    this.auditConfigChange(chatId, userId, 'set_limit', { value });
  }

  private async handleSetSpam(ctx: Context, chatId: number, userId: number, rawArgs: string): Promise<void> {
    const [thresholdRaw, windowRaw] = rawArgs.split(/\s+/).filter(Boolean);
    const threshold = Number.parseInt(thresholdRaw, 10);
    const windowSec = Number.parseInt(windowRaw, 10);

    if (!Number.isFinite(threshold) || !Number.isFinite(windowSec) || threshold < 2 || threshold > 100 || windowSec < 3 || windowSec > 600) {
      await this.replySafe(ctx, 'Использование: /set_spam <threshold 2..100> <windowSec 3..600>');
      return;
    }

    this.repos.chatSettings.setSpam(chatId, threshold, windowSec);
    await this.replySafe(ctx, `Новый антиспам-порог: ${threshold} сообщений за ${windowSec} сек.`);
    this.auditConfigChange(chatId, userId, 'set_spam', { threshold, windowSec });
  }

  private async handleSetLogChat(ctx: Context, chatId: number, userId: number, rawArgs: string): Promise<void> {
    const value = Number.parseInt(rawArgs, 10);
    if (!Number.isFinite(value) || value <= 0) {
      await this.replySafe(ctx, 'Использование: /set_logchat <chatId>');
      return;
    }

    this.repos.appSettings.setLogChatId(value);
    await this.replySafe(ctx, `Лог-чат обновлен: ${value}`);
    this.auditConfigChange(chatId, userId, 'set_logchat', { value });
  }

  private auditConfigChange(chatId: number, userId: number, command: string, meta: Record<string, unknown>): void {
    this.repos.moderationActions.record({
      chatId,
      userId,
      action: 'config_update',
      reason: command,
      meta,
    });

    void this.logger.moderation({
      chatId,
      userId,
      action: 'config_update',
      reason: command,
      meta,
    });
  }

  private async replySafe(ctx: Context, text: string): Promise<void> {
    try {
      await ctx.reply(text);
    } catch {
      // no-op
    }
  }
}
