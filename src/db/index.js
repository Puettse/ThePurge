import pkg from 'pg';

const { Client } = pkg;

export function createDb(connectionString) {
  return new Client({ connectionString, ssl: getSslConfig(connectionString) });
}

function getSslConfig(connectionString) {
  if (!connectionString || connectionString.includes('localhost') || connectionString.includes('127.0.0.1')) {
    return false;
  }

  return { rejectUnauthorized: false };
}

export async function migrate(db) {
  await db.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'purge_configs'
        AND column_name = 'media_types'
      ) THEN
        ALTER TABLE purge_configs RENAME COLUMN media_types TO media_type;
      END IF;
    END$$;
  `);

  await db.query(`
    DO $$
    BEGIN
      IF to_regclass('public.purge_configs') IS NOT NULL THEN
        ALTER TABLE purge_configs
          ADD COLUMN IF NOT EXISTS media_type TEXT DEFAULT 'all',
          ADD COLUMN IF NOT EXISTS interval_seconds INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS last_run TIMESTAMPTZ DEFAULT NOW(),
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
      END IF;
    END$$;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS guilds (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon_url TEXT,
      owner_id TEXT,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      left_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
      prefix TEXT DEFAULT '!',
      log_channel_id TEXT,
      welcome_channel_id TEXT,
      welcome_message TEXT DEFAULT 'Welcome {user.mention} to {server.name}.',
      leave_channel_id TEXT,
      leave_message TEXT DEFAULT '{user} left {server.name}.',
      dashboard_enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS module_settings (
      guild_id TEXT REFERENCES guilds(id) ON DELETE CASCADE,
      module_name TEXT NOT NULL,
      enabled BOOLEAN DEFAULT TRUE,
      config JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (guild_id, module_name)
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT,
      actor_id TEXT,
      target_id TEXT,
      action TEXT NOT NULL,
      source TEXT NOT NULL,
      severity TEXT DEFAULT 'info',
      details JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS moderation_cases (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      case_type TEXT NOT NULL,
      actor_id TEXT,
      target_id TEXT,
      reason TEXT,
      duration_seconds INTEGER,
      status TEXT DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS purge_configs (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      media_type TEXT DEFAULT 'all',
      interval_seconds INTEGER DEFAULT 0,
      last_run TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    DELETE FROM purge_configs newer
    USING purge_configs older
    WHERE newer.guild_id = older.guild_id
      AND newer.channel_id = older.channel_id
      AND newer.id > older.id;

    CREATE UNIQUE INDEX IF NOT EXISTS purge_configs_guild_channel_idx
      ON purge_configs(guild_id, channel_id);

    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT,
      job_type TEXT NOT NULL,
      payload JSONB DEFAULT '{}'::jsonb,
      interval_seconds INTEGER NOT NULL,
      next_run_at TIMESTAMPTZ NOT NULL,
      last_run_at TIMESTAMPTZ,
      enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS custom_commands (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      response TEXT NOT NULL,
      enabled BOOLEAN DEFAULT TRUE,
      allow_mentions BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (guild_id, name)
    );

    CREATE TABLE IF NOT EXISTS automation_rules (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      rule_type TEXT NOT NULL,
      trigger JSONB DEFAULT '{}'::jsonb,
      actions JSONB DEFAULT '[]'::jsonb,
      enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reaction_roles (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      role_id TEXT NOT NULL,
      mode TEXT DEFAULT 'toggle',
      enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (guild_id, message_id, emoji, role_id)
    );

    CREATE TABLE IF NOT EXISTS ticket_panels (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT,
      message_id TEXT,
      title TEXT NOT NULL DEFAULT 'Open a Support Ticket',
      description TEXT NOT NULL DEFAULT 'Click the button below to open a private support ticket.',
      button_label TEXT NOT NULL DEFAULT 'Open Ticket',
      button_emoji TEXT,
      color TEXT DEFAULT '#b71c1c',
      category_id TEXT,
      staff_role_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
      questions JSONB DEFAULT '[]'::jsonb,
      enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      panel_id BIGINT REFERENCES ticket_panels(id) ON DELETE SET NULL,
      channel_id TEXT UNIQUE,
      opener_id TEXT NOT NULL,
      claimed_by TEXT,
      status TEXT DEFAULT 'open',
      subject TEXT,
      form_responses JSONB DEFAULT '{}'::jsonb,
      opened_at TIMESTAMPTZ DEFAULT NOW(),
      claimed_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      closed_by TEXT,
      close_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS ticket_transcripts (
      id BIGSERIAL PRIMARY KEY,
      ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      channel_id TEXT,
      message_count INTEGER DEFAULT 0,
      transcript JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS dashboard_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      discriminator TEXT,
      avatar_url TEXT,
      last_login_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS levels (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 0,
      last_xp_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS economy_accounts (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      cash INTEGER DEFAULT 0,
      bank INTEGER DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS jellyfin_catalog_access (
      guild_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      title TEXT NOT NULL,
      production_year INTEGER,
      genres JSONB DEFAULT '[]'::jsonb,
      people JSONB DEFAULT '[]'::jsonb,
      enabled BOOLEAN DEFAULT FALSE,
      updated_by TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (guild_id, item_id)
    );

    INSERT INTO scheduled_jobs (guild_id, channel_id, job_type, payload, interval_seconds, next_run_at)
    SELECT
      purge_configs.guild_id,
      purge_configs.channel_id,
      'purge',
      jsonb_build_object('mediaType', purge_configs.media_type, 'limit', 100),
      purge_configs.interval_seconds,
      NOW() + (purge_configs.interval_seconds::int * INTERVAL '1 second')
    FROM purge_configs
    WHERE purge_configs.interval_seconds > 0
      AND NOT EXISTS (
        SELECT 1
        FROM scheduled_jobs
        WHERE scheduled_jobs.guild_id = purge_configs.guild_id
          AND scheduled_jobs.channel_id = purge_configs.channel_id
          AND scheduled_jobs.job_type = 'purge'
          AND scheduled_jobs.enabled = TRUE
      );
  `);
}

export async function ensureGuild(db, guild) {
  await db.query(
    `
    INSERT INTO guilds (id, name, icon_url, owner_id, left_at, updated_at)
    VALUES ($1, $2, $3, $4, NULL, NOW())
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      icon_url = EXCLUDED.icon_url,
      owner_id = EXCLUDED.owner_id,
      left_at = NULL,
      updated_at = NOW();
    `,
    [guild.id, guild.name, guild.iconURL?.() || null, guild.ownerId || null],
  );

  await db.query(
    `
    INSERT INTO guild_settings (guild_id)
    VALUES ($1)
    ON CONFLICT (guild_id) DO NOTHING;
    `,
    [guild.id],
  );

  for (const moduleName of defaultModules) {
    await db.query(
      `
      INSERT INTO module_settings (guild_id, module_name, enabled)
      VALUES ($1, $2, TRUE)
      ON CONFLICT (guild_id, module_name) DO NOTHING;
      `,
      [guild.id, moduleName],
    );
  }
}

export const defaultModules = [
  'moderation',
  'automod',
  'logs',
  'customCommands',
  'welcome',
  'autoroles',
  'scheduler',
  'tickets',
  'levels',
  'economy',
  'jellyfinCatalog',
];

export async function isModuleEnabled(db, guildId, moduleName) {
  const result = await db.query(
    'SELECT enabled FROM module_settings WHERE guild_id = $1 AND module_name = $2',
    [guildId, moduleName],
  );

  return result.rowCount === 0 ? true : result.rows[0].enabled;
}
