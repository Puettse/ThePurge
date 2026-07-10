import { PermissionsBitField } from 'discord.js';
import { InviteValidationError, sendServerInvite } from '../../services/inviteService.js';

export async function handleInvite(context, interaction) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    await interaction.reply({ content: 'Manage Server permission is required.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await sendServerInvite(context, interaction.guild, interaction.user, {
      target: interaction.options.getString('target', true),
      channelId: interaction.options.getChannel('channel')?.id || interaction.channelId,
      source: 'discord',
    });

    await interaction.editReply(formatInviteResponse(result));
  } catch (error) {
    if (error instanceof InviteValidationError) {
      await interaction.editReply(error.message);
      return;
    }
    throw error;
  }
}

function formatInviteResponse(result) {
  const delivery = result.dmDelivered
    ? 'DM delivered.'
    : `DM failed: ${result.dmError || 'unknown error'}`;
  return `${result.message}\n${delivery}\nInvite: ${result.inviteUrl}`;
}
