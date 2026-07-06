import { ensureGuild } from '../db/index.js';
import { resolveButtonHandler, resolveCommandHandler } from './handlers/index.js';

export async function handleInteraction(context, interaction) {
  try {
    if (interaction.isButton() && interaction.customId.startsWith('ticket:')) {
      const handler = await resolveButtonHandler('ticket');
      await handler(context, interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (!interaction.guild) {
      await interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
      return;
    }

    await ensureGuild(context.db, interaction.guild);

    const handler = await resolveCommandHandler(interaction.commandName);
    if (!handler) {
      await interaction.reply({ content: 'Unknown command.', ephemeral: true });
      return;
    }

    await handler(context, interaction);
  } catch (error) {
    await handleInteractionError(context, interaction, error);
  }
}

async function handleInteractionError(context, interaction, error) {
  console.error('[discord] Interaction failed', error);
  context.liveFeed.publish('discord.interaction_failed', {
    command: interaction.commandName || interaction.customId,
    error: String(error?.message || error),
  }, 'error');

  const response = {
    content: 'The command failed. Check the dashboard live feed or Railway logs.',
    ephemeral: true,
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(response).catch(() => null);
  } else {
    await interaction.reply(response).catch(() => null);
  }
}
