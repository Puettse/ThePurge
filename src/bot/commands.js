import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

export const commandData = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Create default settings for this server.'),
  new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Get the dashboard link and current bot health.'),
  new SlashCommandBuilder()
    .setName('invite')
    .setDescription('DM a one-use server invite to a user by ID or known username.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) => option
      .setName('target')
      .setDescription('Discord user ID, mention, or username visible to the bot')
      .setRequired(true))
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('Channel where the invite should be created')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false)),
  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete recent media messages from a channel.')
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('Channel to purge')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true))
    .addStringOption((option) => option
      .setName('media')
      .setDescription('Media type to purge')
      .setRequired(false)
      .addChoices(
        { name: 'All media', value: 'all' },
        { name: 'Attachments', value: 'attachments' },
        { name: 'GIFs', value: 'gifs' },
        { name: 'Stickers', value: 'stickers' },
        { name: 'Emojis', value: 'emojis' },
      ))
    .addIntegerOption((option) => option
      .setName('limit')
      .setDescription('Messages to inspect, maximum 500')
      .setMinValue(1)
      .setMaxValue(500)
      .setRequired(false)),
  new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Moderation actions.')
    .addSubcommand((command) => command
      .setName('warn')
      .setDescription('Record a warning.')
      .addUserOption((option) => option.setName('user').setDescription('User').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason').setRequired(false)))
    .addSubcommand((command) => command
      .setName('timeout')
      .setDescription('Timeout a user.')
      .addUserOption((option) => option.setName('user').setDescription('User').setRequired(true))
      .addIntegerOption((option) => option.setName('seconds').setDescription('Duration in seconds').setMinValue(10).setMaxValue(2_419_200).setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason').setRequired(false)))
    .addSubcommand((command) => command
      .setName('kick')
      .setDescription('Kick a user.')
      .addUserOption((option) => option.setName('user').setDescription('User').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason').setRequired(false)))
    .addSubcommand((command) => command
      .setName('ban')
      .setDescription('Ban a user.')
      .addUserOption((option) => option.setName('user').setDescription('User').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason').setRequired(false))),
  new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Manage AutoMod rules.')
    .addSubcommand((command) => command
      .setName('block-invites')
      .setDescription('Create or update the invite-blocking rule.')
      .addBooleanOption((option) => option.setName('enabled').setDescription('Enable rule').setRequired(true)))
    .addSubcommand((command) => command
      .setName('block-word')
      .setDescription('Add a blocked word rule.')
      .addStringOption((option) => option.setName('word').setDescription('Word or phrase').setRequired(true))),
  new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Manage audit log channel.')
    .addSubcommand((command) => command
      .setName('set-channel')
      .setDescription('Set the channel for moderation logs.')
      .addChannelOption((option) => option
        .setName('channel')
        .setDescription('Log channel')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)))
    .addSubcommand((command) => command
      .setName('recent')
      .setDescription('Show recent audit events.')),
  new SlashCommandBuilder()
    .setName('custom-command')
    .setDescription('Manage custom commands.')
    .addSubcommand((command) => command
      .setName('set')
      .setDescription('Create or update a custom command.')
      .addStringOption((option) => option.setName('name').setDescription('Command name').setRequired(true))
      .addStringOption((option) => option.setName('response').setDescription('Response template').setRequired(true)))
    .addSubcommand((command) => command
      .setName('delete')
      .setDescription('Delete a custom command.')
      .addStringOption((option) => option.setName('name').setDescription('Command name').setRequired(true)))
    .addSubcommand((command) => command
      .setName('list')
      .setDescription('List custom commands.')),
  new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configure welcome and leave messages.')
    .addSubcommand((command) => command
      .setName('set')
      .setDescription('Set the welcome channel and message.')
      .addChannelOption((option) => option
        .setName('channel')
        .setDescription('Welcome channel')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
      .addStringOption((option) => option.setName('message').setDescription('Template message').setRequired(true))),
  new SlashCommandBuilder()
    .setName('autorole')
    .setDescription('Manage automatic role assignment.')
    .addSubcommand((command) => command
      .setName('join-role')
      .setDescription('Set the role assigned to new members.')
      .addRoleOption((option) => option.setName('role').setDescription('Role').setRequired(true))),
  new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Manage scheduled jobs.')
    .addSubcommand((command) => command
      .setName('message')
      .setDescription('Schedule a recurring message.')
      .addChannelOption((option) => option
        .setName('channel')
        .setDescription('Target channel')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
      .addStringOption((option) => option.setName('message').setDescription('Message template').setRequired(true))
      .addIntegerOption((option) => option.setName('interval-seconds').setDescription('Interval in seconds').setMinValue(60).setRequired(true)))
    .addSubcommand((command) => command
      .setName('purge')
      .setDescription('Schedule recurring media purges.')
      .addChannelOption((option) => option
        .setName('channel')
        .setDescription('Target channel')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
      .addIntegerOption((option) => option
        .setName('interval-seconds')
        .setDescription('Interval in seconds')
        .setMinValue(60)
        .setRequired(true))
      .addStringOption((option) => option
        .setName('media')
        .setDescription('Media type to purge')
        .setRequired(false)
        .addChoices(
          { name: 'All media', value: 'all' },
          { name: 'Attachments', value: 'attachments' },
          { name: 'GIFs', value: 'gifs' },
          { name: 'Stickers', value: 'stickers' },
          { name: 'Emojis', value: 'emojis' },
        ))
      .addIntegerOption((option) => option
        .setName('limit')
        .setDescription('Messages to inspect, maximum 500')
        .setMinValue(1)
        .setMaxValue(500)
        .setRequired(false)))
    .addSubcommand((command) => command
      .setName('list')
      .setDescription('List active jobs.')),
  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Show your server rank.'),
  new SlashCommandBuilder()
    .setName('economy')
    .setDescription('Economy commands.')
    .addSubcommand((command) => command
      .setName('balance')
      .setDescription('Show your balance.')),
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticketing control.')
    .addSubcommand((command) => command
      .setName('quicksetup')
      .setDescription('Create a ticket panel with staff and log routing.')
      .addChannelOption((option) => option
        .setName('panel-channel')
        .setDescription('Channel where the ticket panel is posted')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
      .addRoleOption((option) => option
        .setName('staff-role')
        .setDescription('Role that can see and answer tickets')
        .setRequired(true))
      .addChannelOption((option) => option
        .setName('log-channel')
        .setDescription('Channel for ticket and moderation logs')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false))
      .addChannelOption((option) => option
        .setName('category')
        .setDescription('Category where ticket channels are created')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(false)))
    .addSubcommand((command) => command
      .setName('panel')
      .setDescription('Post a ticket panel.')
      .addChannelOption((option) => option
        .setName('channel')
        .setDescription('Channel where the ticket panel is posted')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
      .addStringOption((option) => option
        .setName('title')
        .setDescription('Panel title')
        .setRequired(false))
      .addStringOption((option) => option
        .setName('description')
        .setDescription('Panel description')
        .setRequired(false))
      .addStringOption((option) => option
        .setName('button-label')
        .setDescription('Open button label')
        .setRequired(false)))
    .addSubcommand((command) => command
      .setName('claim')
      .setDescription('Claim the current ticket.'))
    .addSubcommand((command) => command
      .setName('close')
      .setDescription('Close the current ticket and store a transcript.')
      .addStringOption((option) => option
        .setName('reason')
        .setDescription('Close reason')
        .setRequired(false))),
].map((command) => command.toJSON());
