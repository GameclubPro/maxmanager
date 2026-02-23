import { Context } from '@maxhub/max-bot-api';

interface CacheItem {
  isAdmin: boolean;
  expiresAt: number;
}

interface ChatMembersResponse {
  members?: Array<{
    user_id: number;
    is_admin: boolean;
    is_owner: boolean;
  }>;
}

export class AdminResolver {
  private readonly cache = new Map<string, CacheItem>();

  constructor(private readonly ttlMs: number = 60_000) {}

  async isAdmin(ctx: Context, chatId: number, userId: number): Promise<boolean> {
    const key = `${chatId}:${userId}`;
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.isAdmin;
    }

    try {
      const response = await ctx.api.getChatMembers(chatId, { user_ids: [userId] }) as ChatMembersResponse;
      const member = response.members?.find((item) => item.user_id === userId);
      const isAdmin = Boolean(member?.is_admin || member?.is_owner);
      this.cache.set(key, { isAdmin, expiresAt: now + this.ttlMs });
      return isAdmin;
    } catch {
      this.cache.set(key, { isAdmin: false, expiresAt: now + Math.min(this.ttlMs, 20_000) });
      return false;
    }
  }
}
