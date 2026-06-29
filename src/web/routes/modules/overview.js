import { Router } from 'express';

export function createOverviewRouter(context) {
  const router = Router({ mergeParams: true });

  router.get('/overview', wrap(async (req, res) => {
    const sections = await loadOverviewSections(context, req.guild.id);

    res.json({
      guild: { id: req.guild.id, name: req.guild.name, iconUrl: req.guild.iconURL?.() || null },
      settings: sections.settings.rows[0] || {},
      modules: sections.modules.rows,
      logs: sections.logs.rows,
      customCommands: sections.customCommands.rows,
      scheduledJobs: sections.scheduledJobs.rows,
      automodRules: sections.automodRules.rows,
      ticketPanels: sections.ticketPanels.rows,
      tickets: sections.tickets.rows,
      sectionErrors: sections.errors,
    });
  }));

  return router;
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function loadOverviewSections(context, guildId) {
  const definitions = {
    settings: () => context.db.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]),
    modules: () => context.db.query('SELECT * FROM module_settings WHERE guild_id = $1 ORDER BY module_name ASC', [guildId]),
    logs: () => context.db.query('SELECT * FROM audit_events WHERE guild_id = $1 ORDER BY created_at DESC LIMIT 25', [guildId]),
    customCommands: () => context.db.query('SELECT id, name, response, enabled, allow_mentions FROM custom_commands WHERE guild_id = $1 ORDER BY name ASC LIMIT 100', [guildId]),
    scheduledJobs: () => context.db.query('SELECT id, channel_id, job_type, payload, interval_seconds, next_run_at, enabled FROM scheduled_jobs WHERE guild_id = $1 ORDER BY id DESC LIMIT 50', [guildId]),
    automodRules: () => context.db.query('SELECT id, trigger, actions, enabled FROM automation_rules WHERE guild_id = $1 AND rule_type = $2 ORDER BY id DESC LIMIT 50', [guildId, 'automod']),
    ticketPanels: () => context.db.query('SELECT id, channel_id, message_id, title, description, button_label, enabled FROM ticket_panels WHERE guild_id = $1 ORDER BY id DESC LIMIT 50', [guildId]),
    tickets: () => context.db.query('SELECT id, panel_id, channel_id, opener_id, claimed_by, status, subject, opened_at, closed_at, close_reason FROM tickets WHERE guild_id = $1 ORDER BY opened_at DESC LIMIT 100', [guildId]),
  };

  const loaded = {};
  const errors = {};

  await Promise.all(Object.entries(definitions).map(async ([name, load]) => {
    try {
      loaded[name] = await load();
    } catch (error) {
      loaded[name] = { rows: [] };
      errors[name] = String(error?.message || error);
      context.liveFeed.publish('dashboard.overview_section_failed', { section: name, error: errors[name] }, 'error');
    }
  }));

  return { ...loaded, errors };
}
