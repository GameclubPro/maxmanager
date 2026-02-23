export class InMemoryIdempotencyGuard {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs: number = 60 * 60 * 1000) {}

  tryMark(chatId: number, messageId: string, nowTs: number): boolean {
    this.gc(nowTs);

    const key = `${chatId}:${messageId}`;
    if (this.seen.has(key)) {
      return false;
    }

    this.seen.set(key, nowTs + this.ttlMs);
    return true;
  }

  private gc(nowTs: number): void {
    if (this.seen.size < 5_000) return;

    for (const [key, expiresAt] of this.seen.entries()) {
      if (expiresAt <= nowTs) {
        this.seen.delete(key);
      }
    }
  }
}
