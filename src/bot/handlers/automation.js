import { hasManageGuild } from '../../services/permissionService.js';
import { normalizeCommandName } from './utils.js';

export async function handleAutomod(context, interaction) {
  if (!hasManageGuild(interaction.member)) {
    await interaction.reply({ content: 'Manage Server permission is required.', ephemeral: true });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'block-invites') {
    const enabled = interaction.options.getBoolean('enabled', true);
    await context.db.query(
      `
      INSERT INTO automation_rules (guild_id, rule_type, trigger, actions, enabled)
      VALUES ($1, 'automod', $2, $3, $4)
      ON CONFLICT DO NOTHING;
      `,
      [
        interaction.guild.id,
        JSON.stringify({ blockInvites: true }),
        JSON.stringify([{ type: 'delete' }, { type: 'reply', message: 'Invite links are blocked here.' }]),
        enabled,
      ],
    );
    await interaction.reply({ content: `Invite blocking rule ${enabled ? 'enabled' : 'created disabled'}.`, ephemeral: true });
    return;
  }

  if (subcommand === 'block-word') {
    const word = interaction.options.getString('word', true);
    await context.db.query(
      `
      INSERT INTO automation_rules (guild_id, rule_type, trigger, actions, enabled)
      VALUES ($1, 'automod', $2, $3, TRUE);
      `,
      [
        interaction.guild.id,
        JSON.stringify({ blockedWords: [word] }),
        JSON.stringify([{ type: 'delete' }, { type: 'reply', message: 'That phrase is blocked here.' }]),
      ],
    );
    await interaction.reply({ content: `Blocked word rule created for "${word}".`, ephemeral: true });
  }
}

export async function handleCustomCommand(context, interaction) {
  if (!hasManageGuild(interaction.member)) {
    await interaction.reply({ content: 'Manage Server permission is required.', ephemeral: true });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'set') {
    const name = normalizeCommandName(interaction.options.getString('name', true));
    const response = interaction.options.getString('response', true);
    await context.db.query(
      `
      INSERT INTO custom_commands (guild_id, name, response, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (guild_id, name) DO UPDATE SET
        response = EXCLUDED.response,
        enabled = TRUE,
        updated_at = NOW();
      `,
      [interaction.guild.id, name, response],
    );
    await interaction.reply({ content: `Custom command !${name} saved.`, ephemeral: true });
    return;
  }

  if (subcommand === 'delete') {
    const name = normalizeCommandName(interaction.options.getString('name', true));
    await context.db.query('DELETE FROM custom_commands WHERE guild_id = $1 AND name = $2', [interaction.guild.id, name]);
    await interaction.reply({ content: `Custom command !${name} deleted.`, ephemeral: true });
    return;
  }

  const result = await context.db.query(
    'SELECT name FROM custom_commands WHERE guild_id = $1 ORDER BY name ASC LIMIT 30',
    [interaction.guild.id],
  );
  await interaction.reply({
    content: result.rows.length ? result.rows.map((row) => `!${row.name}`).join(', ') : 'No custom commands yet.',
    ephemeral: true,
  });
}

export async function handleWelcome(context, interaction) {
  if (!hasManageGuild(interaction.member)) {
    await interaction.reply({ content: 'Manage Server permission is required.', ephemeral: true });
    return;
  }

  const channel = interaction.options.getChannel('channel', true);
  const message = interaction.options.getString('message', true);
  await context.db.query(
    'UPDATE guild_settings SET welcome_channel_id = $2, welcome_message = $3, updated_at = NOW() WHERE guild_id = $1',
    [interaction.guild.id, channel.id, message],
  );
  await interaction.reply({ content: `Welcome message saved for ${channel}.`, ephemeral: true });
}

export async function handleAutorole(context, interaction) {
  if (!hasManageGuild(interaction.member)) {
    await interaction.reply({ content: 'Manage Server permission is required.', ephemeral: true });
    return;
  }

  const role = interaction.options.getRole('role', true);
  await context.db.query(
    `
    INSERT INTO module_settings (guild_id, module_name, enabled, config, updated_at)
    VALUES ($1, 'autoroles', TRUE, $2, NOW())
    ON CONFLICT (guild_id, module_name) DO UPDATE SET
      enabled = TRUE,
      config = EXCLUDED.config,
      updated_at = NOW();
    `,
    [interaction.guild.id, JSON.stringify({ joinRoleId: role.id })],
  );
  await interaction.reply({ content: `Join role set to ${role}.`, ephemeral: true });
}

export async function handleSchedule(context, interaction) {
  if (!hasManageGuild(interaction.member)) {
    await interaction.reply({ content: 'Manage Server permission is required.', ephemeral: true });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'message') {
    const channel = interaction.options.getChannel('channel', true);
    const message = interaction.options.getString('message', true);
    const intervalSeconds = interaction.options.getInteger('interval-seconds', true);
    await context.db.query(
      `
      INSERT INTO scheduled_jobs (guild_id, channel_id, job_type, payload, interval_seconds, next_run_at)
      VALUES ($1, $2, 'message', $3, $4, NOW() + ($4::int * INTERVAL '1 second'));
      `,
      [interaction.guild.id, channel.id, JSON.stringify({ message }), intervalSeconds],
    );
    await interaction.reply({ content: `Scheduled message created for ${channel}.`, ephemeral: true });
    return;
  }

  if (subcommand === 'purge') {
    const channel = interaction.options.getChannel('channel', true);
    const intervalSeconds = interaction.options.getInteger('interval-seconds', true);
    const mediaType = interaction.options.getString('media') || 'all';
    const limit = interaction.options.getInteger('limit') || 100;

    await context.db.query(
      `
      INSERT INTO scheduled_jobs (guild_id, channel_id, job_type, payload, interval_seconds, next_run_at)
      VALUES ($1, $2, 'purge', $3, $4, NOW() + ($4::int * INTERVAL '1 second'));
      `,
      [interaction.guild.id, channel.id, JSON.stringify({ mediaType, limit }), intervalSeconds],
    );

    await context.db.query(
      `
      INSERT INTO purge_configs (guild_id, channel_id, media_type, interval_seconds, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (guild_id, channel_id) DO UPDATE SET
        media_type = EXCLUDED.media_type,
        interval_seconds = EXCLUDED.interval_seconds,
        updated_at = NOW();
      `,
      [interaction.guild.id, channel.id, mediaType, intervalSeconds],
    );

    await interaction.reply({
      content: `Scheduled ${mediaType} purge for ${channel} every ${intervalSeconds} seconds.`,
      ephemeral: true,
    });
    return;
  }

  const result = await context.db.query(
    'SELECT id, job_type, channel_id, interval_seconds FROM scheduled_jobs WHERE guild_id = $1 AND enabled = TRUE ORDER BY id DESC LIMIT 20',
    [interaction.guild.id],
  );
  await interaction.reply({
    content: result.rows.length
      ? result.rows.map((row) => `#${row.id} ${row.job_type} <#${row.channel_id}> every ${row.interval_seconds}s`).join('\n')
      : 'No active scheduled jobs.',
    ephemeral: true,
  });
}
