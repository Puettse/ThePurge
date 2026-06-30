import { AttachmentBuilder, ChannelType, PermissionsBitField } from 'discord.js';
import { entersState, getVoiceConnection, joinVoiceChannel, VoiceConnectionStatus } from '@discordjs/voice';

export const MAX_REMOTE_MESSAGE_LENGTH = 2000;
export const MAX_REMOTE_FILES = 5;
export const MAX_REMOTE_UPLOAD_BYTES = 8 * 1024 * 1024;

const TEXT_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
]);

const VOICE_CHANNEL_TYPES = new Set([
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
]);

export async function listRemoteChannels(guild) {
  const channels = await guild.channels.fetch();
  const textChannels = [];
  const voiceChannels = [];

  for (const channel of channels.values()) {
    if (!channel) continue;
    const item = {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentId: channel.parentId || null,
    };

    if (TEXT_CHANNEL_TYPES.has(channel.type) && typeof channel.send === 'function') {
      textChannels.push(item);
    }

    if (VOICE_CHANNEL_TYPES.has(channel.type)) {
      voiceChannels.push({
        ...item,
        memberCount: channel.members?.size || 0,
      });
    }
  }

  const sortByName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  textChannels.sort(sortByName);
  voiceChannels.sort(sortByName);

  return { textChannels, voiceChannels };
}

export function getRemoteVoiceStatus(guild) {
  const connection = getVoiceConnection(guild.id);
  if (!connection) {
    return {
      connected: false,
      channelId: null,
      status: 'disconnected',
    };
  }

  return {
    connected: connection.state.status !== VoiceConnectionStatus.Destroyed,
    channelId: connection.joinConfig.channelId || null,
    status: connection.state.status,
  };
}

export async function sendRemoteChannelMessage(context, guild, actor, body) {
  const payload = validateRemoteMessagePayload(body);
  const channel = await fetchTextChannel(guild, payload.channelId);
  const botMember = await guild.members.fetchMe();
  const permissions = channel.permissionsFor(botMember);

  if (!permissions?.has(PermissionsBitField.Flags.ViewChannel) || !permissions?.has(PermissionsBitField.Flags.SendMessages)) {
    return { ok: false, message: 'The bot cannot send messages in that channel.' };
  }

  if (payload.files.length > 0 && !permissions.has(PermissionsBitField.Flags.AttachFiles)) {
    return { ok: false, message: 'The bot cannot attach files in that channel.' };
  }

  const message = await channel.send({
    content: payload.content || undefined,
    files: payload.files.map((file) => new AttachmentBuilder(file.buffer, { name: file.name })),
    allowedMentions: payload.allowMentions ? undefined : { parse: [] },
  });

  await recordRemoteAudit(context, {
    guildId: guild.id,
    actorId: actor.id,
    targetId: channel.id,
    action: 'remote.message_sent',
    details: {
      channelId: channel.id,
      messageId: message.id,
      contentLength: payload.content.length,
      fileCount: payload.files.length,
    },
  });

  return {
    ok: true,
    message: `Message sent to #${channel.name}.`,
    result: {
      channelId: channel.id,
      messageId: message.id,
      fileCount: payload.files.length,
    },
  };
}

export async function joinRemoteVoiceChannel(context, guild, actor, body) {
  const channelId = String(body.channelId || '').trim();
  if (!channelId) {
    return { ok: false, message: 'channelId is required.' };
  }

  const channel = await fetchVoiceChannel(guild, channelId);
  const botMember = await guild.members.fetchMe();
  const permissions = channel.permissionsFor(botMember);

  if (!permissions?.has(PermissionsBitField.Flags.ViewChannel) || !permissions?.has(PermissionsBitField.Flags.Connect)) {
    return { ok: false, message: 'The bot cannot connect to that voice channel.' };
  }

  if (channel.type === ChannelType.GuildStageVoice && !permissions.has(PermissionsBitField.Flags.Speak)) {
    return { ok: false, message: 'The bot needs Speak permission to join that stage channel usefully.' };
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: Boolean(body.selfDeaf),
    selfMute: Boolean(body.selfMute),
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

  await recordRemoteAudit(context, {
    guildId: guild.id,
    actorId: actor.id,
    targetId: channel.id,
    action: 'remote.voice_joined',
    details: {
      channelId: channel.id,
      channelName: channel.name,
      selfDeaf: Boolean(body.selfDeaf),
      selfMute: Boolean(body.selfMute),
    },
  });

  return {
    ok: true,
    message: `Connected to ${channel.name}.`,
    voice: getRemoteVoiceStatus(guild),
  };
}

export async function leaveRemoteVoiceChannel(context, guild, actor) {
  const connection = getVoiceConnection(guild.id);
  if (!connection) {
    return {
      ok: true,
      message: 'The bot is not connected to a voice channel.',
      voice: getRemoteVoiceStatus(guild),
    };
  }

  const channelId = connection.joinConfig.channelId || null;
  connection.destroy();

  await recordRemoteAudit(context, {
    guildId: guild.id,
    actorId: actor.id,
    targetId: channelId,
    action: 'remote.voice_left',
    details: { channelId },
  });

  return {
    ok: true,
    message: 'Disconnected from voice.',
    voice: getRemoteVoiceStatus(guild),
  };
}

export function validateRemoteMessagePayload(body) {
  const channelId = String(body.channelId || '').trim();
  const content = String(body.content || '').trim();
  const files = normalizeUploadedFiles(body.files || []);

  if (!channelId) {
    throw new RemoteValidationError('channelId is required.');
  }

  if (!content && files.length === 0) {
    throw new RemoteValidationError('Message content or at least one file is required.');
  }

  if (content.length > MAX_REMOTE_MESSAGE_LENGTH) {
    throw new RemoteValidationError(`Message content must be ${MAX_REMOTE_MESSAGE_LENGTH} characters or less.`);
  }

  return {
    channelId,
    content,
    files,
    allowMentions: Boolean(body.allowMentions),
  };
}

export function normalizeUploadedFiles(files) {
  if (!Array.isArray(files)) {
    throw new RemoteValidationError('files must be an array.');
  }

  if (files.length > MAX_REMOTE_FILES) {
    throw new RemoteValidationError(`A maximum of ${MAX_REMOTE_FILES} files can be sent at once.`);
  }

  let totalBytes = 0;
  return files.map((file, index) => {
    const name = sanitizeFileName(file?.name || `upload-${index + 1}`);
    const dataBase64 = String(file?.dataBase64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!dataBase64) {
      throw new RemoteValidationError(`File ${index + 1} is missing data.`);
    }

    const buffer = Buffer.from(dataBase64, 'base64');
    if (buffer.length === 0) {
      throw new RemoteValidationError(`File ${index + 1} is empty.`);
    }

    totalBytes += buffer.length;
    if (totalBytes > MAX_REMOTE_UPLOAD_BYTES) {
      throw new RemoteValidationError(`Uploaded files must total ${formatBytes(MAX_REMOTE_UPLOAD_BYTES)} or less.`);
    }

    return { name, buffer };
  });
}

export class RemoteValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RemoteValidationError';
  }
}

async function fetchTextChannel(guild, channelId) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !TEXT_CHANNEL_TYPES.has(channel.type) || typeof channel.send !== 'function') {
    throw new RemoteValidationError('A text-capable channel is required.');
  }
  return channel;
}

async function fetchVoiceChannel(guild, channelId) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !VOICE_CHANNEL_TYPES.has(channel.type)) {
    throw new RemoteValidationError('A voice-capable channel is required.');
  }
  return channel;
}

async function recordRemoteAudit(context, event) {
  if (context.audit) {
    await context.audit.record({
      ...event,
      source: 'dashboard',
    });
    return;
  }

  context.liveFeed.publish(`audit.${event.action}`, {
    ...event,
    source: 'dashboard',
    severity: 'info',
  });
}

function sanitizeFileName(value) {
  const name = String(value)
    .replace(/[\\/:"*?<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return name || 'upload.bin';
}

function formatBytes(bytes) {
  return `${Math.floor(bytes / 1024 / 1024)} MB`;
}
