import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { loadConfig } from './config';
import { createRuntime } from './bot';
import { BOT_MESSAGE_DELETE_POLL_INTERVAL_MS } from './services/bot-message-autodelete';

function loadEnv(): void {
  const candidatePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../.env'),
  ];

  const seen = new Set<string>();
  for (const envPath of candidatePaths) {
    if (seen.has(envPath)) continue;
    seen.add(envPath);

    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  loadEnv();
  const config = loadConfig();
  const runtime = await createRuntime(config);

  await runtime.botGuardService.sweepExistingChats().catch((error) => {
    void runtime.logger.warn('Startup bot sweep failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  await runtime.cleanupService.run();

  const cleanupTimer = setInterval(() => {
    void runtime.cleanupService.run().catch((error) => {
      void runtime.logger.error('Cleanup job failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, config.cleanupIntervalSec * 1_000);

  const botMessagesCleanupTimer = setInterval(() => {
    void runtime.cleanupService.runBotMessageDeletes().catch((error) => {
      void runtime.logger.error('Bot message auto-delete job failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, BOT_MESSAGE_DELETE_POLL_INTERVAL_MS);

  cleanupTimer.unref();
  botMessagesCleanupTimer.unref();

  let stopRequested = false;

  const shutdown = async (signal: string): Promise<void> => {
    stopRequested = true;
    await runtime.logger.info('Shutting down', { signal });
    runtime.bot.stop();
    clearInterval(cleanupTimer);
    clearInterval(botMessagesCleanupTimer);
    runtime.db.close();
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await runtime.logger.info('MAX moderation bot initialized');

  let backoffMs = 1_000;

  while (!stopRequested) {
    try {
      await runtime.logger.info('Polling started');
      await runtime.bot.start();

      if (stopRequested) {
        break;
      }

      await runtime.logger.warn('Polling loop stopped unexpectedly. Restarting.');
    } catch (error) {
      await runtime.logger.error('Polling crashed, restarting with backoff', {
        error: error instanceof Error ? error.message : String(error),
        backoffMs,
      });
    }

    runtime.bot.stop();
    await sleep(backoffMs);
    backoffMs = Math.min(backoffMs * 2, 30_000);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
