export const BOT_MESSAGE_AUTO_DELETE_DELAY_MS = 60 * 1000;
export const BOT_MESSAGE_DELETE_POLL_INTERVAL_MS = 15 * 1000;
export const BOT_MESSAGE_DELETE_RETRY_DELAY_MS = 60 * 1000;
export const BOT_MESSAGE_DELETE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function computeBotMessageDeleteAt(nowTs: number = Date.now()): number {
  return nowTs + BOT_MESSAGE_AUTO_DELETE_DELAY_MS;
}

export function extractMessageId(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const body = (message as { body?: unknown }).body;
  if (!body || typeof body !== 'object') return null;
  const mid = (body as { mid?: unknown }).mid;
  return typeof mid === 'string' && mid.trim() !== '' ? mid : null;
}
