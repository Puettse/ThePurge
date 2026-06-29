import { EmbedBuilder } from 'discord.js';
import { hasManageGuild } from '../../services/permissionService.js';

export async function handleLogs(context, interaction) {
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
}
