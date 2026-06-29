import { Router } from 'express';
import { normalizeName } from '../routeUtils.js';

export function createAutomationRouter(context) {
  const router = Router({ mergeParams: true });

  router.post('/custom-commands', wrap(async (req, res) => {
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

  router.delete('/custom-commands/:name', wrap(async (req, res) => {
    await context.db.query('DELETE FROM custom_commands WHERE guild_id = $1 AND name = $2', [req.guild.id, normalizeName(req.params.name)]);
    res.json({ ok: true });
  }));

  router.post('/automod-rules', wrap(async (req, res) => {
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

  router.post('/scheduled-jobs', wrap(async (req, res) => {
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

  router.delete('/scheduled-jobs/:id', wrap(async (req, res) => {
    await context.db.query('UPDATE scheduled_jobs SET enabled = FALSE, updated_at = NOW() WHERE guild_id = $1 AND id = $2', [req.guild.id, req.params.id]);
    res.json({ ok: true });
  }));

  return router;
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
