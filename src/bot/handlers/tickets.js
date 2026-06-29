import { isModuleEnabled } from '../../db/index.js';
import { hasManageGuild } from '../../services/permissionService.js';
import {
  claimTicket,
  closeTicket,
  createTicketPanel,
  openTicketFromPanel,
} from '../../services/ticketService.js';

export async function handleTicket(context, interaction) {
  if (!(await isModuleEnabled(context.db, interaction.guild.id, 'tickets'))) {
    await interaction.reply({ content: 'Tickets module is disabled.', ephemeral: true });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'quicksetup') {
    await handleTicketQuickSetup(context, interaction);
    return;
  }

  if (subcommand === 'panel') {
    await handleTicketPanel(context, interaction);
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
}

export async function handleTicketButton(context, interaction) {
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

async function handleTicketQuickSetup(context, interaction) {
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
}

async function handleTicketPanel(context, interaction) {
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
}
