import { EmbedBuilder } from 'discord.js';
import { ensureGuild, isModuleEnabled } from '../db/index.js';
import { hasManageGuild, hasModerationPermission } from '../services/permissionService.js';
import { purgeChannelMessages, runModerationAction } from '../services/moderationService.js';
import {
  claimTicket,
  closeTicket,
  createTicketPanel,
  openTicketFromPanel,
} from '../services/ticketService.js';

export async function handleInteraction(context, interaction) {
  if (interaction.isButton() && interaction.customId.startsWith('ticket:')) {
    await handleTicketButton(context, interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  try {
    if (!interaction.guild) {
      await interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
      return;
    }

    await ensureGuild(context.db, interaction.guild);

    const handler = handlers[interaction.commandName];
    if (!handler) {
      await interaction.reply({ content: 'Unknown command.', ephemeral: true });
      return;
    }

    await handler(context, interaction);
  } catch (error) {
    console.error('[discord] Interaction failed', error);
    context.liveFeed.publish('discord.interaction_failed', {
      command: interaction.commandName,
      error: String(error?.message || error),
    }, 'error');

    const response = { content: 'The command failed. Check the dashboard live feed or Railway logs.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(response).catch(() => null);
    else await interaction.reply(response).catch(() => null);
  }
}

const handlers = {
  setup: async (context, interaction) => {
    if (!hasManageGuild(interaction.member)) {
      await interaction.reply({ content: 'Manage Server permission is required.', ephemeral: true });
      return;
    }

    await ensureGuild(context.db, interaction.guild);
    await context.audit.record({
      guildId: interaction.guild.id,
      actorId: interaction.user.id,
      action: 'setup.completed',
      source: 'discord',
    });

    await interaction.reply({
      content: 'ThePurge baseline settings, modules, and dashboard records are ready for this server.',
      ephemeral: true,
    });
  },

  dashboard: async (context, interaction) => {
    const url = context.config.publicBaseUrl || 'Set PUBLIC_BASE_URL in Railway to enable an external dashboard link.';
    await interaction.reply({
      content: `Dashboard: ${url}`,
      ephemeral: true,
    });
  },

  purge: async (context, interaction) => {
    if (!(await isModuleEnabled(context.db, interaction.guild.id, 'moderation'))) {
      await interaction.reply({ content: 'Moderation module is disabled.', ephemeral: true });
      return;
    }

    if (!hasModerationPermission(interaction.member)) {
      await interaction.reply({ content: 'A moderation permission is required.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.options.getChannel('channel', true);
    const mediaType = interaction.options.getString('media') || 'all';
    const limit = interaction.options.getInteger('limit') || 100;
    const result = await purgeChannelMessages(context, { interaction, channel, mediaType, limit });

    await interaction.editReply(`Inspected ${result.inspectedCount} messages and deleted ${result.deletedCount}.`);
  },

  mod: async (context, interaction) => {
    if (!(await isModuleEnabled(context.db, interaction.guild.id, 'moderation'))) {
      await interaction.reply({ content: 'Moderation module is disabled.', ephemeral: true });
      return;
    }

    const action = interaction.options.getSubcommand();
    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || 'No reason provided.';
    const durationSeconds = interaction.options.getInteger('seconds');
    const result = await runModerationAction(context, {
      interaction,
      action,
      targetUser,
      reason,
      durationSeconds,
    });

    await interaction.reply({ content: result.message, ephemeral: true });
  },

  automod: async (context, interaction) => {
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
  },

  logs: async (context, interaction) => {
    if (interaction.options.getSubcommand() === 'set-channel') {
      if (!hasManageGuild(interaction.member)) {
        await interaction.reply({ content: 'Manage Server permission is required.', ephemeral: true });
        return;
      }

      const channel = interaction.options.getChannel('channel', true);
      await context.db.query(
        'UPDATE guild_settings SET log_channel_id = $2, updated_at = NOW() WHERE guild_id = $1',
        [interaction.guild.id, channel.id],
      );
      await interaction.reply({ content: `Log channel set to ${channel}.`, ephemeral: true });
      return;
    }

    const result = await context.db.query(
      `
      SELECT action, severity, created_at
      FROM audit_events
      WHERE guild_id = $1
      ORDER BY created_at DESC
      LIMIT 10
      `,
      [interaction.guild.id],
    );

    const description = result.rows.length
      ? result.rows.map((row) => `- ${row.created_at.toISOString()} [${row.severity}] ${row.action}`).join('\n')
      : 'No audit events yet.';

    await interaction.reply({
      embeds: [new EmbedBuilder().setTitle('Recent ThePurge Events').setDescription(description).setColor(0xb71c1c)],
      ephemeral: true,
    });
  },

  'custom-command': async (context, interaction) => {
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
  },

  welcome: async (context, interaction) => {
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
  },

  autorole: async (context, interaction) => {
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
  },

  schedule: async (context, interaction) => {
    if (!hasManageGuild(interaction.member)) {
      await interaction.reply({ content: 'Manage Server permission is required.', ephemeral: true });
      return;
    }

    if (interaction.options.getSubcommand() === 'message') {
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
  },

  rank: async (context, interaction) => {
    const result = await context.db.query(
      'SELECT xp, level FROM levels WHERE guild_id = $1 AND user_id = $2',
      [interaction.guild.id, interaction.user.id],
    );
    const row = result.rows[0] || { xp: 0, level: 0 };
    await interaction.reply({ content: `Level ${row.level}, ${row.xp} XP.`, ephemeral: true });
  },

  economy: async (context, interaction) => {
    const result = await context.db.query(
      `
      INSERT INTO economy_accounts (guild_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET updated_at = NOW()
      RETURNING cash, bank;
      `,
      [interaction.guild.id, interaction.user.id],
    );
    const row = result.rows[0];
    await interaction.reply({ content: `Cash: ${row.cash}. Bank: ${row.bank}.`, ephemeral: true });
  },

  ticket: async (context, interaction) => {
    if (!(await isModuleEnabled(context.db, interaction.guild.id, 'tickets'))) {
      await interaction.reply({ content: 'Tickets module is disabled.', ephemeral: true });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'quicksetup') {
      if (!hasManageGuild(interaction.member)) {
        await interaction.reply({ content: 'Manage Server permission is required.', ephemeral: true });
        return;
      }

      const panelChannel = interaction.options.getChannel('panel-channel', true);
      const staffRole = interaction.options.getRole('staff-role', true);
      const logChannel = interaction.options.getChannel('log-channel');
      const category = interaction.options.getChannel('category');

      if (logChannel) {
        await context.db.query(
          'UPDATE guild_settings SET log_channel_id = $2, updated_at = NOW() WHERE guild_id = $1',
          [interaction.guild.id, logChannel.id],
        );
      }

      await context.db.query(
        `
        INSERT INTO module_settings (guild_id, module_name, enabled, config, updated_at)
        VALUES ($1, 'tickets', TRUE, $2, NOW())
        ON CONFLICT (guild_id, module_name) DO UPDATE SET
          enabled = TRUE,
          config = module_settings.config || EXCLUDED.config,
          updated_at = NOW();
        `,
        [interaction.guild.id, JSON.stringify({ staffRoleIds: [staffRole.id], logChannelId: logChannel?.id || null })],
      );

      const panel = await createTicketPanel(context, interaction.guild, {
        channelId: panelChannel.id,
        categoryId: category?.id || null,
        staffRoleIds: [staffRole.id],
        actorId: interaction.user.id,
        source: 'discord',
      });

      await interaction.reply({ content: `Ticket panel #${panel.id} posted in ${panelChannel}.`, ephemeral: true });
      return;
    }

    if (subcommand === 'panel') {
      if (!hasManageGuild(interaction.member)) {
        await interaction.reply({ content: 'Manage Server permission is required.', ephemeral: true });
        return;
      }

      const channel = interaction.options.getChannel('channel', true);
      const moduleResult = await context.db.query(
        "SELECT config FROM module_settings WHERE guild_id = $1 AND module_name = 'tickets'",
        [interaction.guild.id],
      );
      const staffRoleIds = moduleResult.rows[0]?.config?.staffRoleIds || [];

      const panel = await createTicketPanel(context, interaction.guild, {
        channelId: channel.id,
        staffRoleIds,
        title: interaction.options.getString('title') || undefined,
        description: interaction.options.getString('description') || undefined,
        buttonLabel: interaction.options.getString('button-label') || undefined,
        actorId: interaction.user.id,
        source: 'discord',
      });

      await interaction.reply({ content: `Ticket panel #${panel.id} posted in ${channel}.`, ephemeral: true });
      return;
    }

    if (subcommand === 'claim') {
      const result = await claimTicket(context, interaction);
      await interaction.reply({ content: result.message, ephemeral: !result.ok });
      return;
    }

    if (subcommand === 'close') {
      const reason = interaction.options.getString('reason') || 'Closed from Discord command.';
      const result = await closeTicket(context, interaction, reason);
      await interaction.reply({ content: result.message, ephemeral: !result.ok });
    }
  },
};

function normalizeCommandName(value) {
  return value.toLowerCase().replace(/^[!/]+/, '').replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

async function handleTicketButton(context, interaction) {
  const [, action, id] = interaction.customId.split(':');

  try {
    if (action === 'open') {
      await interaction.deferReply({ ephemeral: true });
      const result = await openTicketFromPanel(context, interaction, id);
      await interaction.editReply(result.message);
      return;
    }

    if (action === 'claim') {
      const result = await claimTicket(context, interaction);
      await interaction.reply({ content: result.message, ephemeral: !result.ok });
      return;
    }

    if (action === 'close') {
      const result = await closeTicket(context, interaction, 'Closed with ticket button.');
      await interaction.reply({ content: result.message, ephemeral: !result.ok });
    }
  } catch (error) {
    console.error('[tickets] Button action failed', error);
    context.liveFeed.publish('tickets.button_failed', {
      action,
      error: String(error?.message || error),
    }, 'error');

    const response = { content: 'Ticket action failed. Check the dashboard live feed.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(response).catch(() => null);
    else await interaction.reply(response).catch(() => null);
  }
}
