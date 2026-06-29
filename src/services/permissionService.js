import { PermissionsBitField } from 'discord.js';

export function hasManageGuild(member) {
  return Boolean(member?.permissions?.has(PermissionsBitField.Flags.ManageGuild));
}

export function hasModerationPermission(member) {
  if (!member?.permissions) return false;
  return member.permissions.has(PermissionsBitField.Flags.ModerateMembers)
    || member.permissions.has(PermissionsBitField.Flags.KickMembers)
    || member.permissions.has(PermissionsBitField.Flags.BanMembers)
    || member.permissions.has(PermissionsBitField.Flags.ManageMessages);
}

export function canModerateTarget(actorMember, targetMember, botMember, action) {
  if (!actorMember || !targetMember || !botMember) {
    return { ok: false, reason: 'Missing member context.' };
  }

  if (targetMember.id === actorMember.id) {
    return { ok: false, reason: 'You cannot moderate yourself.' };
  }

  if (targetMember.id === botMember.id) {
    return { ok: false, reason: 'The bot cannot moderate itself.' };
  }

  if (targetMember.roles.highest.comparePositionTo(actorMember.roles.highest) >= 0 && actorMember.guild.ownerId !== actorMember.id) {
    return { ok: false, reason: 'Target role is equal to or higher than your highest role.' };
  }

  if (targetMember.roles.highest.comparePositionTo(botMember.roles.highest) >= 0) {
    return { ok: false, reason: 'Target role is equal to or higher than the bot highest role.' };
  }

  const required = {
    timeout: PermissionsBitField.Flags.ModerateMembers,
    kick: PermissionsBitField.Flags.KickMembers,
    ban: PermissionsBitField.Flags.BanMembers,
    unban: PermissionsBitField.Flags.BanMembers,
    purge: PermissionsBitField.Flags.ManageMessages,
    warn: PermissionsBitField.Flags.ModerateMembers,
  }[action];

  if (required && !actorMember.permissions.has(required)) {
    return { ok: false, reason: `Missing Discord permission for ${action}.` };
  }

  if (required && !botMember.permissions.has(required)) {
    return { ok: false, reason: `Bot is missing Discord permission for ${action}.` };
  }

  return { ok: true };
}
