import { isModuleEnabled } from '../../db/index.js';
import { hasModerationPermission } from '../../services/permissionService.js';
import { purgeChannelMessages, runModerationAction } from '../../services/moderationService.js';

export async function handlePurge(context, interaction) {
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
}

export async function handleMod(context, interaction) {
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
}
