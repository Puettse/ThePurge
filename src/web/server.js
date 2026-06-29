import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { defaultModules, ensureGuild } from '../db/index.js';
import { createAuth, canManageGuild } from './auth.js';
import { runDashboardModerationAction } from './webActions.js';
import { closeTicketFromDashboard, createTicketPanel } from '../services/ticketService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../../public');

export function createDashboardServer(context) {
  const app = express();
  const auth = createAuth(context.config);
  let server = null;

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(express.static(publicDir));

  app.get('/health', (req, res) => {
    res.json(buildHealth(context, auth));
  });

  app.get('/auth/login', auth.login);
  app.get('/auth/callback', wrap(auth.callback));
  app.post('/auth/logout', auth.logout);

  app.get('/api/health', (req, res) => {
    res.json(buildHealth(context, auth));
  });

  app.get('/api/feed/history', (req, res) => {
    res.json({ events: context.liveFeed.getHistory(100) });
  });

  app.get('/api/feed/events', (req, res) => {
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

  app.get('/api/me', (req, res) => {
    const session = auth.readCookie(req);
    res.json({
      authConfigured: auth.isConfigured(),
      user: session?.user || null,
      manageableGuildIds: session?.guilds?.filter(canManageGuild).map((guild) => guild.id) || [],
    });
  });

  app.get('/api/guilds', auth.requireAuth, (req, res) => {
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

  app.get('/api/guilds/:guildId/overview', auth.requireAuth, requireGuildAccess(context), wrap(async (req, res) => {
    await ensureGuild(context.db, req.guild);

    const [settings, modules, logs, commands, jobs, automod, panels, tickets] = await Promise.all([
      context.db.query('SELECT * FROM guild_settings WHERE guild_id = $1', [req.guild.id]),
      context.db.query('SELECT * FROM module_settings WHERE guild_id = $1 ORDER BY module_name ASC', [req.guild.id]),
      context.db.query('SELECT * FROM audit_events WHERE guild_id = $1 ORDER BY created_at DESC LIMIT 25', [req.guild.id]),
      context.db.query('SELECT id, name, response, enabled, allow_mentions FROM custom_commands WHERE guild_id = $1 ORDER BY name ASC LIMIT 100', [req.guild.id]),
      context.db.query('SELECT id, channel_id, job_type, payload, interval_seconds, next_run_at, enabled FROM scheduled_jobs WHERE guild_id = $1 ORDER BY id DESC LIMIT 50', [req.guild.id]),
      context.db.query('SELECT id, trigger, actions, enabled FROM automation_rules WHERE guild_id = $1 AND rule_type = $2 ORDER BY id DESC LIMIT 50', [req.guild.id, 'automod']),
      context.db.query('SELECT id, channel_id, message_id, title, description, button_label, enabled FROM ticket_panels WHERE guild_id = $1 ORDER BY id DESC LIMIT 50', [req.guild.id]),
      context.db.query('SELECT id, panel_id, channel_id, opener_id, claimed_by, status, subject, opened_at, closed_at, close_reason FROM tickets WHERE guild_id = $1 ORDER BY opened_at DESC LIMIT 100', [req.guild.id]),
    ]);

    res.json({
      guild: { id: req.guild.id, name: req.guild.name, iconUrl: req.guild.iconURL?.() || null },
      settings: settings.rows[0] || {},
      modules: modules.rows,
      logs: logs.rows,
      customCommands: commands.rows,
      scheduledJobs: jobs.rows,
      automodRules: automod.rows,
      ticketPanels: panels.rows,
      tickets: tickets.rows,
    });
  }));

  app.put('/api/guilds/:guildId/modules/:moduleName', auth.requireAuth, requireGuildAccess(context), wrap(async (req, res) => {
    const moduleName = req.params.moduleName;
    if (!defaultModules.includes(moduleName)) {
      res.status(400).json({ error: 'Unknown module.' });
      return;
    }

    await context.db.query(
      `
      INSERT INTO module_settings (guild_id, module_name, enabled, config, updated_at)
      VALUES ($1, $2, $3, COALESCE($4::jsonb, '{}'::jsonb), NOW())
      ON CONFLICT (guild_id, module_name) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        config = module_settings.config || EXCLUDED.config,
        updated_at = NOW();
      `,
      [req.guild.id, moduleName, Boolean(req.body.enabled), JSON.stringify(req.body.config || {})],
    );

    await context.audit.record({
      guildId: req.guild.id,
      actorId: req.session.user.id,
      action: 'dashboard.module_updated',
      source: 'dashboard',
      details: { moduleName, enabled: Boolean(req.body.enabled) },
    });

    res.json({ ok: true });
  }));

  app.put('/api/guilds/:guildId/settings', auth.requireAuth, requireGuildAccess(context), wrap(async (req, res) => {
    const body = req.body || {};
    await context.db.query(
      `
      UPDATE guild_settings
      SET prefix = COALESCE($2, prefix),
          log_channel_id = COALESCE($3, log_channel_id),
          welcome_channel_id = COALESCE($4, welcome_channel_id),
          welcome_message = COALESCE($5, welcome_message),
          leave_channel_id = COALESCE($6, leave_channel_id),
          leave_message = COALESCE($7, leave_message),
          updated_at = NOW()
      WHERE guild_id = $1;
      `,
      [
        req.guild.id,
        body.prefix || null,
        body.logChannelId || null,
        body.welcomeChannelId || null,
        body.welcomeMessage || null,
        body.leaveChannelId || null,
        body.leaveMessage || null,
      ],
    );
    res.json({ ok: true });
  }));

  app.post('/api/guilds/:guildId/custom-commands', auth.requireAuth, requireGuildAccess(context), wrap(async (req, res) => {
    const name = normalizeName(req.body.name);
    if (!name || !req.body.response) {
      res.status(400).json({ error: 'name and response are required.' });
      return;
    }

    await context.db.query(
      `
      INSERT INTO custom_commands (guild_id, name, response, allow_mentions, enabled, updated_at)
      VALUES ($1, $2, $3, $4, TRUE, NOW())
      ON CONFLICT (guild_id, name) DO UPDATE SET
        response = EXCLUDED.response,
        allow_mentions = EXCLUDED.allow_mentions,
        enabled = TRUE,
        updated_at = NOW();
      `,
      [req.guild.id, name, req.body.response, Boolean(req.body.allowMentions)],
    );

    res.json({ ok: true, name });
  }));

  app.delete('/api/guilds/:guildId/custom-commands/:name', auth.requireAuth, requireGuildAccess(context), wrap(async (req, res) => {
    await context.db.query('DELETE FROM custom_commands WHERE guild_id = $1 AND name = $2', [req.guild.id, normalizeName(req.params.name)]);
    res.json({ ok: true });
  }));

  app.post('/api/guilds/:guildId/automod-rules', auth.requireAuth, requireGuildAccess(context), wrap(async (req, res) => {
    await context.db.query(
      `
      INSERT INTO automation_rules (guild_id, rule_type, trigger, actions, enabled)
      VALUES ($1, 'automod', $2, $3, $4);
      `,
      [
        req.guild.id,
        JSON.stringify(req.body.trigger || {}),
        JSON.stringify(req.body.actions || [{ type: 'delete' }]),
        req.body.enabled !== false,
      ],
    );
    res.json({ ok: true });
  }));

  app.post('/api/guilds/:guildId/scheduled-jobs', auth.requireAuth, requireGuildAccess(context), wrap(async (req, res) => {
    const intervalSeconds = Number(req.body.intervalSeconds);
    if (!req.body.channelId || !req.body.jobType || !Number.isInteger(intervalSeconds) || intervalSeconds < 60) {
      res.status(400).json({ error: 'channelId, jobType, and intervalSeconds >= 60 are required.' });
      return;
    }

    await context.db.query(
      `
      INSERT INTO scheduled_jobs (guild_id, channel_id, job_type, payload, interval_seconds, next_run_at)
      VALUES ($1, $2, $3, $4, $5, NOW() + ($5::int * INTERVAL '1 second'));
      `,
      [req.guild.id, req.body.channelId, req.body.jobType, JSON.stringify(req.body.payload || {}), intervalSeconds],
    );
    res.json({ ok: true });
  }));

  app.delete('/api/guilds/:guildId/scheduled-jobs/:id', auth.requireAuth, requireGuildAccess(context), wrap(async (req, res) => {
    await context.db.query('UPDATE scheduled_jobs SET enabled = FALSE, updated_at = NOW() WHERE guild_id = $1 AND id = $2', [req.guild.id, req.params.id]);
    res.json({ ok: true });
  }));

  app.post('/api/guilds/:guildId/ticket-panels', auth.requireAuth, requireGuildAccess(context), wrap(async (req, res) => {
    const body = req.body || {};
    if (!body.channelId) {
      res.status(400).json({ error: 'channelId is required.' });
      return;
    }

    const staffRoleIds = String(body.staffRoleIds || '')
      .split(',')
      .map((roleId) => roleId.trim())
      .filter(Boolean);

    const panel = await createTicketPanel(context, req.guild, {
      channelId: body.channelId,
      categoryId: body.categoryId || null,
      staffRoleIds,
      title: body.title || undefined,
      description: body.description || undefined,
      buttonLabel: body.buttonLabel || undefined,
      actorId: req.session.user.id,
      source: 'dashboard',
    });

    res.json({ ok: true, panel });
  }));

  app.post('/api/guilds/:guildId/tickets/:ticketId/close', auth.requireAuth, requireGuildAccess(context), wrap(async (req, res) => {
    const result = await closeTicketFromDashboard(
      context,
      req.guild,
      req.session.user.id,
      req.params.ticketId,
      req.body?.reason || 'Closed from dashboard.',
    );

    if (!result.ok) {
      res.status(400).json(result);
      return;
    }

    res.json(result);
  }));

  app.post('/api/guilds/:guildId/moderation/actions', auth.requireAuth, requireGuildAccess(context), wrap(async (req, res) => {
    const result = await runDashboardModerationAction(context, req.guild, req.session.user, req.body || {});
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  }));

  app.use((error, req, res, next) => {
    console.error('[dashboard] Request failed', error);
    context.liveFeed.publish('dashboard.error', { error: String(error?.message || error), path: req.path }, 'error');
    res.status(500).json({ error: 'Dashboard request failed.' });
  });

  return {
    app,
    listen(port, callback) {
      server = app.listen(port, callback);
      return server;
    },
    close() {
      if (server) server.close();
    },
  };
}

function buildHealth(context, auth) {
  return {
    ok: true,
    bot: {
      ready: context.client.isReady(),
      user: context.client.user?.tag || null,
      guildCount: context.client.guilds.cache.size,
    },
    database: { connected: true },
    dashboard: { authConfigured: auth.isConfigured() },
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
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

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/^[!/]+/, '').replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}
