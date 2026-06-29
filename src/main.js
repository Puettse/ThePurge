import { createDiscordClient } from './bot/client.js';
import { registerCommands } from './bot/registerCommands.js';
import { wireDiscordEvents } from './bot/events.js';
import { loadConfig } from './config.js';
import { createDb, migrate } from './db/index.js';
import { createLiveFeed } from './services/liveFeed.js';
import { createAuditService } from './services/auditService.js';
import { createScheduler } from './services/scheduler.js';
import { createDashboardServer } from './web/server.js';

export async function startApplication() {
  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  const liveFeed = createLiveFeed();
  const audit = createAuditService({ db, liveFeed });

  await db.connect();
  await migrate(db);

  const client = createDiscordClient();
  const context = { config, db, client, liveFeed, audit };

  wireDiscordEvents(context);
  await registerCommands(context);

  const dashboard = createDashboardServer(context);
  const scheduler = createScheduler(context);

  await client.login(config.botToken);
  scheduler.start();

  dashboard.listen(config.port, () => {
    const message = `[dashboard] Listening on port ${config.port}`;
    console.log(message);
    liveFeed.publish('dashboard.ready', { message, port: config.port });
  });

  const shutdown = async (signal) => {
    console.log(`[shutdown] Received ${signal}`);
    liveFeed.publish('system.shutdown', { signal });
    scheduler.stop();
    dashboard.close();
    client.destroy();
    await db.end();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (error) => {
    console.error('[process] Unhandled rejection', error);
    liveFeed.publish('process.unhandledRejection', { error: String(error?.stack || error) }, 'error');
  });

  process.on('uncaughtException', (error) => {
    console.error('[process] Uncaught exception', error);
    liveFeed.publish('process.uncaughtException', { error: String(error?.stack || error) }, 'error');
  });
}
