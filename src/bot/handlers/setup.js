import { ensureGuild } from '../../db/index.js';
import { hasManageGuild } from '../../services/permissionService.js';

export async function handleSetup(context, interaction) {
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
}

export async function handleDashboard(context, interaction) {
  const url = context.config.publicBaseUrl || 'Set PUBLIC_BASE_URL in Railway to enable an external dashboard link.';
  await interaction.reply({
    content: `Dashboard: ${url}`,
    ephemeral: true,
  });
}
