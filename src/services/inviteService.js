import { PermissionFlagsBits } from 'discord.js';

const inviteMaxAgeSeconds = 7 * 24 * 60 * 60;

export class InviteValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InviteValidationError';
  }
}

export function extractUserId(value) {
  const input = String(value || '').trim();
  const mention = input.match(/^<@!?(\d{17,22})>$/);
  if (mention) return mention[1];
  return /^\d{17,22}$/.test(input) ? input : '';
}

export function userMatchesQuery(user, member, query) {
  const normalized = normalizeQuery(query);
  if (!normalized) return false;

  return [
    user?.username,
    user?.globalName,
    user?.tag,
    member?.displayName,
  ]
    .filter(Boolean)
    .some((value) => normalizeQuery(value) === normalized);
}

export function describeUser(user) {
  return user?.tag || user?.username || user?.globalName || user?.id || 'Unknown user';
}

export function buildInviteDm({ guild, inviteUrl, actor }) {
  const actorText = actor?.username || actor?.id ? ` from ${actor.username || actor.id}` : '';
  return `You have been invited to ${guild.name}${actorText}: ${inviteUrl}`;
}

export async function sendServerInvite(context, guild, actor, options = {}) {
  const targetInput = String(options.target || '').trim();
  if (!targetInput) {
    throw new InviteValidationError('Enter a username or user ID to invite.');
  }

  const channel = await resolveInviteChannel(guild, options.channelId || options.fallbackChannelId);
  const target = await resolveInviteTarget(context.client, guild, targetInput);
  const existingMember = await guild.members.fetch(target.user.id).catch(() => null);
  if (existingMember) {
    throw new InviteValidationError(`${describeUser(target.user)} is already in ${guild.name}.`);
  }

  await assertInvitePermission(guild, channel);

  const invite = await channel.createInvite({
    maxAge: inviteMaxAgeSeconds,
    maxUses: 1,
    unique: true,
    reason: inviteReason(actor),
  });
  const inviteUrl = invite.url || `https://discord.gg/${invite.code}`;

  let dmDelivered = false;
  let dmError = null;
  try {
    await target.user.send({ content: buildInviteDm({ guild, inviteUrl, actor }) });
    dmDelivered = true;
  } catch (error) {
    dmError = String(error?.message || error);
  }

  await context.audit?.record?.({
    guildId: guild.id,
    actorId: actor?.id || null,
    targetId: target.user.id,
    action: dmDelivered ? 'invite.sent' : 'invite.created_dm_failed',
      source: options.source || 'dashboard',
    severity: dmDelivered ? 'info' : 'warn',
    details: {
      channelId: channel.id,
      target: describeUser(target.user),
      resolution: target.resolution,
      dmDelivered,
      dmError,
      maxAgeSeconds: inviteMaxAgeSeconds,
      maxUses: 1,
    },
  });

  return {
    ok: true,
    message: dmDelivered
      ? `Invite sent to ${describeUser(target.user)}.`
      : `Invite created, but the DM could not be delivered to ${describeUser(target.user)}.`,
    inviteUrl,
    dmDelivered,
    dmError,
    target: {
      id: target.user.id,
      username: target.user.username || null,
      tag: target.user.tag || null,
      globalName: target.user.globalName || null,
      resolution: target.resolution,
    },
    channel: {
      id: channel.id,
      name: channel.name || channel.id,
    },
    expiresInSeconds: inviteMaxAgeSeconds,
    maxUses: 1,
  };
}

async function resolveInviteChannel(guild, channelId) {
  if (!channelId) {
    throw new InviteValidationError('Select a channel where the invite should be created.');
  }

  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || typeof channel.createInvite !== 'function') {
    throw new InviteValidationError('Select a server channel that can create invite links.');
  }

  return channel;
}

async function assertInvitePermission(guild, channel) {
  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const permissions = botMember ? channel.permissionsFor(botMember) : null;
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.CreateInstantInvite)) {
    throw new InviteValidationError(`The bot needs View Channel and Create Invite permission in #${channel.name || channel.id}.`);
  }
}

async function resolveInviteTarget(client, guild, input) {
  const userId = extractUserId(input);
  if (userId) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) throw new InviteValidationError(`No Discord user was found for ID ${userId}.`);
    return { user, resolution: 'user_id' };
  }

  const matches = await findKnownUsers(client, guild, input);
  if (matches.length === 1) return { user: matches[0], resolution: 'known_username' };
  if (matches.length > 1) {
    throw new InviteValidationError(`That username matched multiple known users: ${matches.slice(0, 5).map(describeUser).join(', ')}. Use a user ID.`);
  }

  throw new InviteValidationError('That username is not visible to the bot. Discord bots cannot search global usernames; use the user ID.');
}

async function findKnownUsers(client, guild, query) {
  const matches = new Map();

  for (const member of guild.members.cache?.values?.() || []) {
    if (userMatchesQuery(member.user, member, query)) matches.set(member.user.id, member.user);
  }

  if (typeof guild.members.search === 'function') {
    const searchedMembers = await guild.members.search({ query, limit: 10 }).catch(() => null);
    for (const member of searchedMembers?.values?.() || []) {
      if (userMatchesQuery(member.user, member, query)) matches.set(member.user.id, member.user);
    }
  }

  for (const user of client.users.cache?.values?.() || []) {
    if (userMatchesQuery(user, null, query)) matches.set(user.id, user);
  }

  return [...matches.values()];
}

function inviteReason(actor) {
  return `ThePurge invite requested by ${actor?.username || actor?.id || 'dashboard user'}`.slice(0, 512);
}

function normalizeQuery(value) {
  return String(value || '').trim().toLowerCase();
}
