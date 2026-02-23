import 'dotenv/config';
import { loadConfig } from './config';
import { createRuntime } from './bot';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const config = loadConfig();
  const runtime = await createRuntime(config);

  runtime.cleanupService.run();

  const cleanupTimer = setInterval(() => {
    try {
      runtime.cleanupService.run();
    } catch (error) {
      void runtime.logger.error('Cleanup job failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, config.cleanupIntervalSec * 1_000);

  cleanupTimer.unref();

  let stopRequested = false;

  const shutdown = async (signal: string): Promise<void> => {
    stopRequested = true;
    await runtime.logger.info('Shutting down', { signal });
    runtime.bot.stop();
    clearInterval(cleanupTimer);
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
