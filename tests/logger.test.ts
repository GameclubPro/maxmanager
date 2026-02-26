import { describe, expect, it, vi } from 'vitest';
import { BotLogger } from '../src/services/logger';

describe('bot logger chat notifications', () => {
  it('does not send generic info/warn/error messages to log chat', async () => {
    const sendMessageToChat = vi.fn(async () => ({ body: { mid: 'log-1' } }));
    const logger = new BotLogger(
      { sendMessageToChat } as any,
      () => -71481441617927,
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await logger.info('plain info', { a: 1 });
    await logger.warn('plain warn', { b: 2 });
    await logger.error('plain error', { c: 3 });

    expect(sendMessageToChat).toHaveBeenCalledTimes(0);

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('sends only mute and exclusion moderation events to log chat', async () => {
    const sendMessageToChat = vi.fn(async () => ({ body: { mid: 'log-2' } }));
    const logger = new BotLogger(
      { sendMessageToChat } as any,
      () => -71481441617927,
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await logger.moderation({ chatId: 1, userId: 2, action: 'delete_message', reason: 'spam' });
    await logger.moderation({ chatId: 1, userId: 2, action: 'warn', reason: 'spam' });
    await logger.moderation({ chatId: 1, userId: 2, action: 'mute', reason: 'spam' });
    await logger.moderation({ chatId: 1, userId: 2, action: 'ban', reason: 'spam' });
    await logger.moderation({ chatId: 1, userId: 2, action: 'kick_auto', reason: 'mute_repeat_24h' });

    expect(sendMessageToChat).toHaveBeenCalledTimes(3);
    expect(sendMessageToChat).toHaveBeenNthCalledWith(
      1,
      -71481441617927,
      expect.stringContaining('action=mute reason=spam'),
    );
    expect(sendMessageToChat).toHaveBeenNthCalledWith(
      2,
      -71481441617927,
      expect.stringContaining('action=ban reason=spam'),
    );
    expect(sendMessageToChat).toHaveBeenNthCalledWith(
      3,
      -71481441617927,
      expect.stringContaining('action=kick_auto reason=mute_repeat_24h'),
    );

    logSpy.mockRestore();
  });

  it('uses user name in log message when provided in moderation meta', async () => {
    const sendMessageToChat = vi.fn(async () => ({ body: { mid: 'log-3' } }));
    const logger = new BotLogger(
      { sendMessageToChat } as any,
      () => -71481441617927,
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await logger.moderation({
      chatId: 1,
      userId: 2,
      action: 'mute',
      reason: 'spam',
      meta: { userName: 'Иван' },
    });

    expect(sendMessageToChat).toHaveBeenCalledTimes(1);
    expect(sendMessageToChat).toHaveBeenCalledWith(
      -71481441617927,
      expect.stringContaining('user=Иван action=mute reason=spam'),
    );

    logSpy.mockRestore();
  });
});
