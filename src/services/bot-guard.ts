import { Api, Context } from '@maxhub/max-bot-api';
import { Repositories } from '../repos';
import { IncomingMessage } from '../types';
import { BotLogger } from './logger';

const CHAT_PAGE_SIZE = 100;
const CHAT_MEMBERS_PAGE_SIZE = 100;

type BotGuardOrigin = 'bot_added' | 'message_created' | 'startup_sweep';

export class BotGuardService {
  private selfUserId?: number;

  constructor(
    private readonly api: Api,
    private readonly repos: Repositories,
    private readonly logger: BotLogger,
  ) {}

  async handleBotAdded(ctx: Context): Promise<void> {
    const user = ctx.user as { user_id?: number; is_bot?: boolean } | undefined;
    const chatId = ctx.chatId;

    if (!chatId || !user?.user_id || user.is_bot !== true) {
      return;
    }

    const selfUserId = await this.resolveSelfUserId(ctx.myId);
    if (!selfUserId) {
      await this.logger.warn('Auto bot guard skipped: self user id unavailable', {
        origin: 'bot_added',
        chatId,
        targetUserId: user.user_id,
      });
      return;
    }

    if (user.user_id === selfUserId) {
      return;
    }

    await this.removeBotFromChat(chatId, user.user_id, 'bot_added');
  }

  async handleBotMessage(ctx: Context, message: IncomingMessage): Promise<boolean> {
    const senderId = message.sender?.user_id;
    const isSenderBot = message.sender?.is_bot === true;
    const chatId = message.recipient.chat_id ?? ctx.chatId;

    if (!isSenderBot || !senderId || !chatId) {
      return false;
    }

    const selfUserId = await this.resolveSelfUserId(ctx.myId);
    if (!selfUserId) {
      await this.logger.warn('Auto bot guard skipped: self user id unavailable', {
        origin: 'message_created',
        chatId,
        targetUserId: senderId,
      });
      return false;
    }

    if (senderId === selfUserId) {
      return false;
    }

    await this.removeBotFromChat(chatId, senderId, 'message_created');
    return true;
  }

  async sweepExistingChats(): Promise<void> {
    const selfUserId = await this.resolveSelfUserId();
    if (!selfUserId) {
      await this.logger.warn('Startup bot sweep skipped: self user id unavailable');
      return;
    }

    let marker: number | null | undefined;

    do {
      let chatsPage: { chats: Array<{ chat_id: number; type: string }>; marker: number | null };

      try {
        chatsPage = await this.api.getAllChats({
          count: CHAT_PAGE_SIZE,
          ...(typeof marker === 'number' ? { marker } : {}),
        });
      } catch (error) {
        await this.logger.warn('Failed to list chats during startup bot sweep', {
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      for (const chat of chatsPage.chats) {
        if (chat.type !== 'chat' && chat.type !== 'channel') {
          continue;
        }

        await this.sweepChatBots(chat.chat_id, selfUserId);
      }

      marker = chatsPage.marker;
    } while (typeof marker === 'number');
  }

  private async sweepChatBots(chatId: number, selfUserId: number): Promise<void> {
    let marker: number | null | undefined;

    do {
      let membersPage: { members: Array<{ user_id: number; is_bot: boolean }>; marker?: number | null };

      try {
        membersPage = await this.api.getChatMembers(chatId, {
          count: CHAT_MEMBERS_PAGE_SIZE,
          ...(typeof marker === 'number' ? { marker } : {}),
        });
      } catch (error) {
        await this.logger.warn('Failed to list chat members during startup bot sweep', {
          chatId,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      for (const member of membersPage.members) {
        if (!member.is_bot || member.user_id === selfUserId) {
          continue;
        }

        await this.removeBotFromChat(chatId, member.user_id, 'startup_sweep');
      }

      marker = membersPage.marker;
    } while (typeof marker === 'number');
  }

  private async removeBotFromChat(chatId: number, userId: number, origin: BotGuardOrigin): Promise<void> {
    try {
      await this.api.raw.chats.removeChatMember({
        chat_id: chatId,
        user_id: userId,
        block: true,
      });

      this.recordAndLog(chatId, userId, origin);
    } catch (error) {
      await this.logger.warn('Failed to auto-remove bot from chat', {
        chatId,
        userId,
        origin,
        blocked: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async resolveSelfUserId(preferred?: number): Promise<number | undefined> {
    if (typeof preferred === 'number' && Number.isFinite(preferred)) {
      this.selfUserId = preferred;
      return preferred;
    }

    if (typeof this.selfUserId === 'number') {
      return this.selfUserId;
    }

    try {
      const me = await this.api.getMyInfo();
      const userId = (me as { user_id?: unknown }).user_id;
      if (typeof userId === 'number' && Number.isFinite(userId)) {
        this.selfUserId = userId;
        return userId;
      }
    } catch (error) {
      await this.logger.warn('Failed to resolve self user id for bot guard', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return undefined;
  }

  private recordAndLog(chatId: number, userId: number, origin: BotGuardOrigin): void {
    const meta = {
      origin,
      blocked: true,
    };

    try {
      this.repos.moderationActions.record({
        chatId,
        userId,
        action: 'remove_bot',
        reason: 'auto_bot_guard',
        meta,
      });
    } catch {
      // DB write failures are logged separately.
    }

    void this.logger.moderation({
      chatId,
      userId,
      action: 'remove_bot',
      reason: 'auto_bot_guard',
      meta,
    });
  }
}
