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
  const config = loadConfig(process.env, { allowPartial: true });
  const liveFeed = createLiveFeed();
  const client = createDiscordClient();
  const runtime = {
    database: { connected: false, error: null },
    discord: { commandsRegistered: false, loggedIn: false, error: null },
  };
  const context = { config, db: null, client, liveFeed, audit: null, runtime };
  const dashboard = createDashboardServer(context);
  let scheduler = null;

  dashboard.listen(config.port, () => {
    const message = `[dashboard] Listening on port ${config.port}`;
    console.log(message);
    liveFeed.publish('dashboard.ready', { message, port: config.port });
  });

  if (config.missingRequired.length > 0) {
    const message = `Missing required environment variables: ${config.missingRequired.join(', ')}`;
    console.error(`[config] ${message}`);
    liveFeed.publish('system.config_missing', { missing: config.missingRequired }, 'error');
    registerShutdownHandlers({ dashboard, scheduler, client, db: null, liveFeed });
    return;
  }

  const db = createDb(config.databaseUrl);
  context.db = db;

  try {
    await db.connect();
    runtime.database.connected = true;
    await migrate(db);
  } catch (error) {
    runtime.database.connected = false;
    runtime.database.error = String(error?.message || error);
    console.error('[database] Failed to initialize', error);
    liveFeed.publish('database.error', { error: runtime.database.error }, 'error');
    registerShutdownHandlers({ dashboard, scheduler, client, db, liveFeed });
    return;
  }

  const audit = createAuditService({ db, liveFeed });
  context.audit = audit;

  wireDiscordEvents(context);
  try {
    await registerCommands(context);
    runtime.discord.commandsRegistered = true;
    await client.login(config.botToken);
    runtime.discord.loggedIn = true;
  } catch (error) {
    runtime.discord.error = String(error?.message || error);
    console.error('[discord] Failed to initialize', error);
    liveFeed.publish('discord.error', { error: runtime.discord.error }, 'error');
    registerShutdownHandlers({ dashboard, scheduler, client, db, liveFeed });
    return;
  }

  scheduler = createScheduler(context);
  scheduler.start();

  registerShutdownHandlers({ dashboard, scheduler, client, db, liveFeed });
}

function registerShutdownHandlers({ dashboard, scheduler, client, db, liveFeed }) {
  const shutdown = async (signal) => {
    console.log(`[shutdown] Received ${signal}`);
    liveFeed.publish('system.shutdown', { signal });
    scheduler?.stop();
    dashboard.close();
    client.destroy();
    if (db) await db.end().catch(() => null);
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
