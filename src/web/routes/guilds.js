import { Router } from 'express';
import { canManageGuild } from '../auth.js';
import { ensureGuild } from '../../db/index.js';
import { lazyRouter } from './routeUtils.js';

export function createGuildRouter(context) {
  const router = Router();

  router.get('/', (req, res) => {
    const guilds = req.session.guilds
      .filter(canManageGuild)
      .map((guild) => ({
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        botPresent: context.client.guilds.cache.has(guild.id),
      }));

    res.json({ guilds });
  });

  router.use('/:guildId', requireGuildAccess(context));
  router.use('/:guildId', wrap(async (req, res, next) => {
    await ensureGuild(context.db, req.guild);
    next();
  }));

  router.use('/:guildId', lazyRouter('overview', () => import('./modules/overview.js').then((module) => module.createOverviewRouter(context))));
  router.use('/:guildId', lazyRouter('settings', () => import('./modules/settings.js').then((module) => module.createSettingsRouter(context))));
  router.use('/:guildId', lazyRouter('automation', () => import('./modules/automation.js').then((module) => module.createAutomationRouter(context))));
  router.use('/:guildId', lazyRouter('tickets', () => import('./modules/tickets.js').then((module) => module.createTicketsRouter(context))));
  router.use('/:guildId', lazyRouter('moderation', () => import('./modules/moderation.js').then((module) => module.createModerationRouter(context))));
  router.use('/:guildId', lazyRouter('remoteOps', () => import('./modules/remoteOps.js').then((module) => module.createRemoteOpsRouter(context))));
  router.use('/:guildId', lazyRouter('invites', () => import('./modules/invites.js').then((module) => module.createInvitesRouter(context))));

  return router;
}

function requireGuildAccess(context) {
  return async (req, res, next) => {
    const userGuild = req.session.guilds.find((guild) => guild.id === req.params.guildId);
    if (!userGuild || !canManageGuild(userGuild)) {
      res.status(403).json({ error: 'You do not have Manage Server access for this guild.' });
      return;
    }

    const guild = context.client.guilds.cache.get(req.params.guildId);
    if (!guild) {
      res.status(404).json({ error: 'The bot is not in this guild.' });
      return;
    }

    req.guild = guild;
    next();
  };
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
