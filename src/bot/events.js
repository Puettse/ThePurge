import { ensureGuild, isModuleEnabled } from '../db/index.js';
import { handleInteraction } from './interactions.js';
import { renderTemplate } from '../services/templateEngine.js';

export function wireDiscordEvents(context) {
  const { client, db, liveFeed, audit } = context;

  client.once('ready', async () => {
    console.log(`[discord] ThePurge online as ${client.user.tag}`);
    liveFeed.publish('discord.ready', {
      user: client.user.tag,
      guildCount: client.guilds.cache.size,
    });

    for (const guild of client.guilds.cache.values()) {
      await ensureGuild(db, guild);
    }
  });

  client.on('guildCreate', async (guild) => {
    await ensureGuild(db, guild);
    await audit.record({
      guildId: guild.id,
      action: 'guild.joined',
      source: 'discord',
      details: { name: guild.name },
    });
  });

  client.on('guildDelete', async (guild) => {
    await db.query('UPDATE guilds SET left_at = NOW(), updated_at = NOW() WHERE id = $1', [guild.id]);
    liveFeed.publish('guild.left', { guildId: guild.id, name: guild.name });
  });

  client.on('interactionCreate', async (interaction) => {
    await handleInteraction(context, interaction);
  });

  client.on('messageCreate', async (message) => {
    await runEventFeature(context, 'automod', async () => {
      const { runAutomod } = await import('../services/automodService.js');
      await runAutomod(context, message);
    });
    await runEventFeature(context, 'customCommands', () => handleCustomCommand(context, message));
    await runEventFeature(context, 'levels', () => handleLeveling(context, message));
  });

  client.on('guildMemberAdd', async (member) => {
    await runEventFeature(context, 'welcome', () => handleWelcome(context, member));
    await runEventFeature(context, 'autoroles', () => handleJoinRole(context, member));
  });

  client.on('guildMemberRemove', async (member) => {
    await runEventFeature(context, 'welcome', () => handleLeave(context, member));
  });

  client.on('messageDelete', async (message) => {
    if (!message.guild) return;
    await audit.record({
      guildId: message.guild.id,
      actorId: message.author?.id || null,
      targetId: message.channelId,
      action: 'message.deleted',
      source: 'discord',
      details: { messageId: message.id },
    });
  });

  client.on('messageReactionAdd', async (reaction, user) => {
    await runEventFeature(context, 'reactionRoles', () => handleReactionRole(context, reaction, user, 'add'));
  });

  client.on('messageReactionRemove', async (reaction, user) => {
    await runEventFeature(context, 'reactionRoles', () => handleReactionRole(context, reaction, user, 'remove'));
  });
}

async function runEventFeature(context, featureName, task) {
  try {
    await task();
  } catch (error) {
    console.error(`[event:${featureName}] failed`, error);
    context.liveFeed.publish('discord.event_feature_failed', {
      featureName,
      error: String(error?.message || error),
    }, 'error');
  }
}

async function handleCustomCommand(context, message) {
  if (!message.guild || message.author.bot) return;
  if (!(await isModuleEnabled(context.db, message.guild.id, 'customCommands'))) return;

  const settings = await context.db.query('SELECT prefix FROM guild_settings WHERE guild_id = $1', [message.guild.id]);
  const prefix = settings.rows[0]?.prefix || '!';
  if (!message.content.startsWith(prefix)) return;

  const commandName = message.content.slice(prefix.length).trim().split(/\s+/)[0]?.toLowerCase();
  if (!commandName) return;

  const result = await context.db.query(
    'SELECT * FROM custom_commands WHERE guild_id = $1 AND name = $2 AND enabled = TRUE',
    [message.guild.id, commandName],
  );
  if (result.rowCount === 0) return;

  const command = result.rows[0];
  const content = renderTemplate(command.response, {
    user: message.author,
    member: message.member,
    guild: message.guild,
    channel: message.channel,
  }, { allowMentions: command.allow_mentions });

  await message.channel.send({ content });
  await context.audit.record({
    guildId: message.guild.id,
    actorId: message.author.id,
    targetId: message.channel.id,
    action: 'custom_command.used',
    source: 'discord',
    details: { command: command.name },
  });
}

async function handleLeveling(context, message) {
  if (!message.guild || message.author.bot) return;
  if (!(await isModuleEnabled(context.db, message.guild.id, 'levels'))) return;

  const result = await context.db.query(
    `
    INSERT INTO levels (guild_id, user_id, xp, level, last_xp_at, updated_at)
    VALUES ($1, $2, 5, 0, NOW(), NOW())
    ON CONFLICT (guild_id, user_id) DO UPDATE SET
      xp = CASE
        WHEN levels.last_xp_at IS NULL OR levels.last_xp_at < NOW() - INTERVAL '60 seconds'
        THEN levels.xp + 5
        ELSE levels.xp
      END,
      last_xp_at = CASE
        WHEN levels.last_xp_at IS NULL OR levels.last_xp_at < NOW() - INTERVAL '60 seconds'
        THEN NOW()
        ELSE levels.last_xp_at
      END,
      level = FLOOR(SQRT(levels.xp / 25.0)),
      updated_at = NOW()
    RETURNING xp, level;
    `,
    [message.guild.id, message.author.id],
  );

  const row = result.rows[0];
  context.liveFeed.publish('levels.xp', {
    guildId: message.guild.id,
    userId: message.author.id,
    xp: row.xp,
    level: row.level,
  });
}

async function handleWelcome(context, member) {
  if (!(await isModuleEnabled(context.db, member.guild.id, 'welcome'))) return;
  const result = await context.db.query(
    'SELECT welcome_channel_id, welcome_message FROM guild_settings WHERE guild_id = $1',
    [member.guild.id],
  );
  const settings = result.rows[0];
  if (!settings?.welcome_channel_id) return;

  const channel = await member.guild.channels.fetch(settings.welcome_channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;

  await channel.send({
    content: renderTemplate(settings.welcome_message, {
      member,
      user: member.user,
      guild: member.guild,
      channel,
    }),
  });
}

async function handleLeave(context, member) {
  const result = await context.db.query(
    'SELECT leave_channel_id, leave_message FROM guild_settings WHERE guild_id = $1',
    [member.guild.id],
  );
  const settings = result.rows[0];
  if (!settings?.leave_channel_id) return;

  const channel = await member.guild.channels.fetch(settings.leave_channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;

  await channel.send({
    content: renderTemplate(settings.leave_message, {
      member,
      user: member.user,
      guild: member.guild,
      channel,
    }),
  });
}

async function handleJoinRole(context, member) {
  if (!(await isModuleEnabled(context.db, member.guild.id, 'autoroles'))) return;
  const result = await context.db.query(
    `
    SELECT config
    FROM module_settings
    WHERE guild_id = $1 AND module_name = 'autoroles' AND enabled = TRUE
    `,
    [member.guild.id],
  );
  const roleId = result.rows[0]?.config?.joinRoleId;
  if (!roleId) return;

  await member.roles.add(roleId, 'ThePurge join role').catch(async (error) => {
    await context.audit.record({
      guildId: member.guild.id,
      targetId: member.id,
      action: 'autorole.failed',
      source: 'discord',
      severity: 'error',
      details: { roleId, error: String(error?.message || error) },
    });
  });
}

async function handleReactionRole(context, reaction, user, direction) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  const message = reaction.message;
  if (!message.guild) return;

  const emoji = reaction.emoji.id || reaction.emoji.name;
  const result = await context.db.query(
    `
    SELECT *
    FROM reaction_roles
    WHERE guild_id = $1
      AND message_id = $2
      AND emoji = $3
      AND enabled = TRUE
    `,
    [message.guild.id, message.id, emoji],
  );

  for (const row of result.rows) {
    const member = await message.guild.members.fetch(user.id).catch(() => null);
    if (!member) continue;
    if (direction === 'add') await member.roles.add(row.role_id, 'ThePurge reaction role').catch(() => null);
    if (direction === 'remove' && row.mode === 'toggle') await member.roles.remove(row.role_id, 'ThePurge reaction role').catch(() => null);
  }
}
