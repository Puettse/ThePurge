import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';

export async function createTicketPanel(context, guild, options) {
  const staffRoleIds = normalizeRoleIds(options.staffRoleIds || []);
  const result = await context.db.query(
    `
    INSERT INTO ticket_panels (
      guild_id, channel_id, title, description, button_label, button_emoji,
      category_id, staff_role_ids, questions, enabled, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, NOW())
    RETURNING *;
    `,
    [
      guild.id,
      options.channelId || null,
      options.title || 'Open a Support Ticket',
      options.description || 'Click the button below to open a private support ticket.',
      options.buttonLabel || 'Open Ticket',
      options.buttonEmoji || null,
      options.categoryId || null,
      staffRoleIds,
      JSON.stringify(options.questions || []),
    ],
  );

  const panel = result.rows[0];
  if (options.channelId) {
    await publishTicketPanel(context, guild, panel);
  }

  await context.audit.record({
    guildId: guild.id,
    actorId: options.actorId || null,
    targetId: options.channelId || null,
    action: 'tickets.panel_created',
    source: options.source || 'dashboard',
    details: { panelId: panel.id, title: panel.title },
  });

  return panel;
}

export async function publishTicketPanel(context, guild, panel) {
  const channel = await guild.channels.fetch(panel.channel_id).catch(() => null);
  if (!channel?.isTextBased()) {
    throw new Error('Ticket panel channel was not found or is not text-based.');
  }

  const embed = new EmbedBuilder()
    .setTitle(panel.title)
    .setDescription(panel.description)
    .setColor(parseColor(panel.color));

  const button = new ButtonBuilder()
    .setCustomId(`ticket:open:${panel.id}`)
    .setLabel(panel.button_label || 'Open Ticket')
    .setStyle(ButtonStyle.Primary);

  if (panel.button_emoji) button.setEmoji(panel.button_emoji);

  const message = await channel.send({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)],
  });

  await context.db.query(
    'UPDATE ticket_panels SET message_id = $2, updated_at = NOW() WHERE id = $1',
    [panel.id, message.id],
  );

  return message;
}

export async function openTicketFromPanel(context, interaction, panelId) {
  const result = await context.db.query(
    'SELECT * FROM ticket_panels WHERE id = $1 AND guild_id = $2 AND enabled = TRUE',
    [panelId, interaction.guild.id],
  );

  if (result.rowCount === 0) {
    return { ok: false, message: 'This ticket panel is no longer active.' };
  }

  const panel = result.rows[0];
  const existing = await context.db.query(
    `
    SELECT id, channel_id
    FROM tickets
    WHERE guild_id = $1
      AND panel_id = $2
      AND opener_id = $3
      AND status = 'open'
    ORDER BY opened_at DESC
    LIMIT 1;
    `,
    [interaction.guild.id, panel.id, interaction.user.id],
  );

  if (existing.rowCount > 0) {
    return { ok: true, message: `You already have an open ticket: <#${existing.rows[0].channel_id}>.` };
  }

  const ticketNumber = await nextTicketNumber(context, interaction.guild.id);
  const channel = await createTicketChannel(context, interaction.guild, panel, interaction.user, ticketNumber);

  const ticket = await context.db.query(
    `
    INSERT INTO tickets (guild_id, panel_id, channel_id, opener_id, subject)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
    `,
    [interaction.guild.id, panel.id, channel.id, interaction.user.id, panel.title],
  );

  await sendTicketIntro(channel, ticket.rows[0], panel, interaction.user);

  await context.audit.record({
    guildId: interaction.guild.id,
    actorId: interaction.user.id,
    targetId: channel.id,
    action: 'tickets.opened',
    source: 'discord',
    details: { panelId: panel.id, ticketId: ticket.rows[0].id },
  });

  return { ok: true, message: `Ticket opened: ${channel}.` };
}

export async function claimTicket(context, interaction) {
  const ticket = await getOpenTicketByChannel(context, interaction.guild.id, interaction.channel.id);
  if (!ticket) return { ok: false, message: 'This channel is not an open ticket.' };

  await context.db.query(
    `
    UPDATE tickets
    SET claimed_by = $2, claimed_at = NOW()
    WHERE id = $1;
    `,
    [ticket.id, interaction.user.id],
  );

  await context.audit.record({
    guildId: interaction.guild.id,
    actorId: interaction.user.id,
    targetId: interaction.channel.id,
    action: 'tickets.claimed',
    source: 'discord',
    details: { ticketId: ticket.id },
  });

  return { ok: true, message: `Ticket claimed by ${interaction.user}.` };
}

export async function closeTicket(context, interaction, reason = 'No reason provided.') {
  const ticket = await getOpenTicketByChannel(context, interaction.guild.id, interaction.channel.id);
  if (!ticket) return { ok: false, message: 'This channel is not an open ticket.' };

  const transcript = await buildTranscript(interaction.channel);
  await context.db.query(
    `
    INSERT INTO ticket_transcripts (ticket_id, guild_id, channel_id, message_count, transcript)
    VALUES ($1, $2, $3, $4, $5);
    `,
    [ticket.id, interaction.guild.id, interaction.channel.id, transcript.length, JSON.stringify(transcript)],
  );

  await context.db.query(
    `
    UPDATE tickets
    SET status = 'closed',
        closed_at = NOW(),
        closed_by = $2,
        close_reason = $3
    WHERE id = $1;
    `,
    [ticket.id, interaction.user.id, reason],
  );

  await lockTicketChannel(interaction.channel, ticket.opener_id);

  await context.audit.record({
    guildId: interaction.guild.id,
    actorId: interaction.user.id,
    targetId: interaction.channel.id,
    action: 'tickets.closed',
    source: 'discord',
    details: { ticketId: ticket.id, reason, messageCount: transcript.length },
  });

  return { ok: true, message: `Ticket #${ticket.id} closed. Transcript stored in the dashboard database.` };
}

export async function closeTicketFromDashboard(context, guild, actorId, ticketId, reason = 'Closed from dashboard') {
  const result = await context.db.query(
    'SELECT * FROM tickets WHERE id = $1 AND guild_id = $2 AND status = $3',
    [ticketId, guild.id, 'open'],
  );
  if (result.rowCount === 0) return { ok: false, message: 'Open ticket was not found.' };

  const ticket = result.rows[0];
  const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
  let transcript = [];

  if (channel?.isTextBased()) {
    transcript = await buildTranscript(channel);
    await lockTicketChannel(channel, ticket.opener_id);
  }

  await context.db.query(
    'INSERT INTO ticket_transcripts (ticket_id, guild_id, channel_id, message_count, transcript) VALUES ($1, $2, $3, $4, $5)',
    [ticket.id, guild.id, ticket.channel_id, transcript.length, JSON.stringify(transcript)],
  );
  await context.db.query(
    'UPDATE tickets SET status = $2, closed_at = NOW(), closed_by = $3, close_reason = $4 WHERE id = $1',
    [ticket.id, 'closed', actorId, reason],
  );

  await context.audit.record({
    guildId: guild.id,
    actorId,
    targetId: ticket.channel_id,
    action: 'tickets.closed',
    source: 'dashboard',
    details: { ticketId: ticket.id, reason },
  });

  return { ok: true, message: `Ticket #${ticket.id} closed.` };
}

async function createTicketChannel(context, guild, panel, user, ticketNumber) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    {
      id: context.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];

  for (const roleId of panel.staff_role_ids || []) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }

  return guild.channels.create({
    name: `ticket-${ticketNumber}-${safeChannelName(user.username)}`,
    type: ChannelType.GuildText,
    parent: panel.category_id || null,
    topic: `ThePurge ticket for ${user.tag || user.username} (${user.id})`,
    permissionOverwrites: overwrites,
    reason: 'ThePurge ticket opened',
  });
}

async function sendTicketIntro(channel, ticket, panel, user) {
  const embed = new EmbedBuilder()
    .setTitle(`Ticket #${ticket.id}`)
    .setDescription('Support staff can claim this ticket. Close it when the issue is resolved.')
    .addFields(
      { name: 'Opened by', value: `${user}`, inline: true },
      { name: 'Panel', value: panel.title, inline: true },
    )
    .setColor(parseColor(panel.color));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:claim:${ticket.id}`)
      .setLabel('Claim')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`ticket:close:${ticket.id}`)
      .setLabel('Close')
      .setStyle(ButtonStyle.Danger),
  );

  await channel.send({ content: `${user}`, embeds: [embed], components: [row] });
}

async function buildTranscript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  return [...messages.values()]
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map((message) => ({
      id: message.id,
      authorId: message.author?.id || null,
      authorTag: message.author?.tag || null,
      content: message.content || '',
      attachmentUrls: [...message.attachments.values()].map((attachment) => attachment.url),
      createdAt: message.createdAt.toISOString(),
    }));
}

async function lockTicketChannel(channel, openerId) {
  await channel.permissionOverwrites.edit(openerId, {
    SendMessages: false,
    ViewChannel: true,
    ReadMessageHistory: true,
  }).catch(() => null);

  await channel.setName(`closed-${channel.name}`.slice(0, 100)).catch(() => null);
}

async function getOpenTicketByChannel(context, guildId, channelId) {
  const result = await context.db.query(
    'SELECT * FROM tickets WHERE guild_id = $1 AND channel_id = $2 AND status = $3 ORDER BY opened_at DESC LIMIT 1',
    [guildId, channelId, 'open'],
  );
  return result.rows[0] || null;
}

async function nextTicketNumber(context, guildId) {
  const result = await context.db.query('SELECT COUNT(*)::int AS count FROM tickets WHERE guild_id = $1', [guildId]);
  return Number(result.rows[0]?.count || 0) + 1;
}

function parseColor(value) {
  const cleaned = String(value || '#b71c1c').replace('#', '');
  return Number.parseInt(cleaned, 16);
}

function safeChannelName(value) {
  return String(value || 'user').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 24);
}

function normalizeRoleIds(roleIds) {
  if (!Array.isArray(roleIds)) return [];
  return roleIds.map(String).filter(Boolean);
}
