import { Router } from 'express';
import { canManageGuild } from '../auth.js';
import { createHealthSnapshot } from './health.js';

export function createCoreRouter(context, auth) {
  const router = Router();

  router.get('/health', (req, res) => {
    res.json(createHealthSnapshot(context, auth));
  });

  router.get('/feed/history', (req, res) => {
    res.json({ events: context.liveFeed.getHistory(100) });
  });

  router.get('/feed/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    for (const event of context.liveFeed.getHistory(20).reverse()) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    const unsubscribe = context.liveFeed.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    req.on('close', unsubscribe);
  });

  router.get('/me', (req, res) => {
    const session = auth.readCookie(req);
    res.json({
      authConfigured: auth.isConfigured(),
      user: session?.user || null,
      manageableGuildIds: session?.guilds?.filter(canManageGuild).map((guild) => guild.id) || [],
    });
  });

  return router;
}
