import { Context } from '@maxhub/max-bot-api';

interface CacheItem {
  isAdmin: boolean;
  expiresAt: number;
}

interface ChatMemberLike {
  user_id: number;
  is_admin?: boolean;
  is_owner?: boolean;
}

interface ChatAdminsResponse {
  members?: ChatMemberLike[];
}

interface ChatMembersResponse {
  members?: ChatMemberLike[];
}

export class AdminResolver {
  private readonly cache = new Map<string, CacheItem>();

  constructor(
    private readonly ttlMs: number = 60_000,
    private readonly onWarn?: (message: string, meta?: Record<string, unknown>) => void,
  ) {}

  async isAdmin(ctx: Context, chatId: number, userId: number): Promise<boolean> {
    const key = `${chatId}:${userId}`;
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.isAdmin;
    }

    // Primary source of truth for permissions.
    try {
      const admins = await ctx.api.getChatAdmins(chatId) as ChatAdminsResponse;
      const adminMember = admins.members?.find((item) => item.user_id === userId);
      const isAdmin = Boolean(adminMember?.is_admin || adminMember?.is_owner);
      this.cache.set(key, { isAdmin, expiresAt: now + this.ttlMs });
      if (isAdmin) {
        return true;
      }
    } catch (error) {
      this.onWarn?.('getChatAdmins failed in AdminResolver', {
        chatId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fallback: query a specific member by id.
    try {
      const response = await ctx.api.getChatMembers(chatId, { user_ids: [userId] }) as ChatMembersResponse;
      const member = response.members?.find((item) => item.user_id === userId);
      const isAdmin = Boolean(member?.is_admin || member?.is_owner);
      this.cache.set(key, { isAdmin, expiresAt: now + this.ttlMs });
      return isAdmin;
    } catch (error) {
      this.onWarn?.('getChatMembers failed in AdminResolver', {
        chatId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.cache.set(key, { isAdmin: false, expiresAt: now + Math.min(this.ttlMs, 20_000) });
      return false;
    }
  }
}
