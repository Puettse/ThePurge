import { Router } from 'express';
import { defaultModules } from '../../../db/index.js';

export function createSettingsRouter(context) {
  const router = Router({ mergeParams: true });

  router.put('/modules/:moduleName', wrap(async (req, res) => {
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

  router.put('/settings', wrap(async (req, res) => {
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

  return router;
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
