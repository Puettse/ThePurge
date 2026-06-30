import { AttachmentBuilder, ChannelType, PermissionsBitField } from 'discord.js';
import {
  createAudioPlayer,
  createAudioResource,
  EndBehaviorType,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import prism from 'prism-media';

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

const PCM_SAMPLE_RATE = 48_000;
const PCM_CHANNELS = 2;
const PCM_BYTES_PER_SAMPLE = 2;
const PCM_FRAME_SIZE = 960;
const MAX_VOICE_CLIP_MS = 30_000;
const MAX_VOICE_CLIP_PCM_BYTES = PCM_SAMPLE_RATE * PCM_CHANNELS * PCM_BYTES_PER_SAMPLE * (MAX_VOICE_CLIP_MS / 1000);

const remoteMicSessions = new Map();
const remoteReceiveSessions = new Map();

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
  const micSession = remoteMicSessions.get(guild.id);
  const receiveSession = remoteReceiveSessions.get(guild.id);
  if (!connection) {
    if (micSession) stopRemoteMicSession(guild.id, micSession);
    if (receiveSession) stopRemoteReceiveSession(guild.id, receiveSession);
    return {
      connected: false,
      channelId: null,
      status: 'disconnected',
      selfMute: false,
      selfDeaf: false,
      transmitting: false,
      receiving: false,
      speakingUsers: [],
    };
  }

  if (connection.state.status === VoiceConnectionStatus.Destroyed && micSession) {
    stopRemoteMicSession(guild.id, micSession);
  }
  if (connection.state.status === VoiceConnectionStatus.Destroyed && receiveSession) {
    stopRemoteReceiveSession(guild.id, receiveSession);
  }

  return {
    connected: connection.state.status !== VoiceConnectionStatus.Destroyed,
    channelId: connection.joinConfig.channelId || null,
    status: connection.state.status,
    selfMute: Boolean(connection.joinConfig.selfMute),
    selfDeaf: Boolean(connection.joinConfig.selfDeaf),
    transmitting: Boolean(remoteMicSessions.get(guild.id)),
    receiving: Boolean(remoteReceiveSessions.get(guild.id)?.subscribers.size),
    speakingUsers: Array.from(remoteReceiveSessions.get(guild.id)?.speakingUsers.keys() || []),
    audioStartedAt: remoteMicSessions.get(guild.id)?.startedAt || null,
    audioActorId: remoteMicSessions.get(guild.id)?.actorId || null,
    receiveStartedAt: remoteReceiveSessions.get(guild.id)?.startedAt || null,
    receiveActorId: remoteReceiveSessions.get(guild.id)?.actorId || null,
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

export async function updateRemoteVoiceState(context, guild, actor, body) {
  const connection = getVoiceConnection(guild.id);
  if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
    throw new RemoteValidationError('Join a voice channel before changing voice state.');
  }

  const selfMute = body.selfMute === true;
  const selfDeaf = body.selfDeaf === true;
  const channelId = connection.joinConfig.channelId;
  const ok = connection.rejoin({
    channelId,
    selfMute,
    selfDeaf,
  });

  if (!ok) {
    throw new RemoteValidationError('The bot could not update its voice state.');
  }

  await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

  if (selfDeaf) {
    const receiveSession = remoteReceiveSessions.get(guild.id);
    if (receiveSession) stopRemoteReceiveSession(guild.id, receiveSession);
  }

  await recordRemoteAudit(context, {
    guildId: guild.id,
    actorId: actor.id,
    targetId: channelId || null,
    action: 'remote.voice_state_updated',
    details: {
      channelId: channelId || null,
      selfMute,
      selfDeaf,
    },
  });

  return {
    ok: true,
    message: `Voice state updated: ${selfMute ? 'muted' : 'unmuted'}, ${selfDeaf ? 'deafened' : 'undeafened'}.`,
    voice: getRemoteVoiceStatus(guild),
  };
}

export async function startRemoteMicStream(context, guild, actor, pcmStream, options = {}) {
  const connection = getVoiceConnection(guild.id);
  if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
    throw new RemoteValidationError('Join a voice channel before starting dashboard audio.');
  }

  const existing = remoteMicSessions.get(guild.id);
  if (existing) stopRemoteMicSession(guild.id, existing);

  const player = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Play,
    },
  });
  const resource = createAudioResource(pcmStream, {
    inputType: StreamType.Raw,
  });
  const subscription = connection.subscribe(player);

  if (!subscription) {
    player.stop(true);
    throw new RemoteValidationError('The bot could not attach dashboard audio to the voice connection.');
  }

  const session = {
    actorId: actor.id,
    player,
    source: options.source || 'dashboard',
    startedAt: new Date().toISOString(),
    stream: pcmStream,
    subscription,
  };

  player.on('error', (error) => {
    context.liveFeed.publish('remote.voice_audio_error', {
      guildId: guild.id,
      actorId: actor.id,
      error: String(error?.message || error),
    }, 'error');
  });

  remoteMicSessions.set(guild.id, session);
  player.play(resource);

  await recordRemoteAudit(context, {
    guildId: guild.id,
    actorId: actor.id,
    targetId: connection.joinConfig.channelId || null,
    action: 'remote.voice_audio_started',
    details: {
      channelId: connection.joinConfig.channelId || null,
      source: session.source,
    },
  });

  return {
    ok: true,
    message: 'Dashboard audio is live in voice.',
    voice: getRemoteVoiceStatus(guild),
  };
}

export async function stopRemoteMicStream(context, guild, actor, options = {}) {
  const session = remoteMicSessions.get(guild.id);
  if (!session) {
    return {
      ok: true,
      message: 'Dashboard audio is already stopped.',
      voice: getRemoteVoiceStatus(guild),
    };
  }

  stopRemoteMicSession(guild.id, session);

  await recordRemoteAudit(context, {
    guildId: guild.id,
    actorId: actor.id,
    targetId: getVoiceConnection(guild.id)?.joinConfig.channelId || null,
    action: 'remote.voice_audio_stopped',
    details: {
      reason: options.reason || 'dashboard',
      source: session.source,
    },
  });

  return {
    ok: true,
    message: 'Dashboard audio stopped.',
    voice: getRemoteVoiceStatus(guild),
  };
}

export async function startRemoteVoiceReceive(context, guild, actor, subscriber) {
  const connection = getVoiceConnection(guild.id);
  if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
    throw new RemoteValidationError('Join a voice channel before listening.');
  }

  if (connection.joinConfig.selfDeaf) {
    throw new RemoteValidationError('Turn Self deaf off before listening to voice.');
  }

  let session = remoteReceiveSessions.get(guild.id);
  if (!session) {
    session = createRemoteReceiveSession(context, guild, actor, connection);
    remoteReceiveSessions.set(guild.id, session);
  }

  session.subscribers.add(subscriber);
  subscriber.sendJson?.({
    type: 'ready',
    message: 'Incoming voice feed is live.',
    voice: getRemoteVoiceStatus(guild),
  });

  await recordRemoteAudit(context, {
    guildId: guild.id,
    actorId: actor.id,
    targetId: connection.joinConfig.channelId || null,
    action: 'remote.voice_receive_started',
    details: {
      channelId: connection.joinConfig.channelId || null,
      subscribers: session.subscribers.size,
    },
  });

  return {
    ok: true,
    message: 'Incoming voice feed is live.',
    voice: getRemoteVoiceStatus(guild),
  };
}

export async function stopRemoteVoiceReceive(context, guild, actor, subscriber, options = {}) {
  const session = remoteReceiveSessions.get(guild.id);
  if (!session) {
    return {
      ok: true,
      message: 'Incoming voice feed is already stopped.',
      voice: getRemoteVoiceStatus(guild),
    };
  }

  if (subscriber) session.subscribers.delete(subscriber);

  if (session.subscribers.size === 0) {
    stopRemoteReceiveSession(guild.id, session);
  }

  await recordRemoteAudit(context, {
    guildId: guild.id,
    actorId: actor.id,
    targetId: getVoiceConnection(guild.id)?.joinConfig.channelId || null,
    action: 'remote.voice_receive_stopped',
    details: {
      reason: options.reason || 'dashboard',
      subscribers: session.subscribers.size,
    },
  });

  return {
    ok: true,
    message: 'Incoming voice feed stopped.',
    voice: getRemoteVoiceStatus(guild),
  };
}

export async function listRemoteVoiceRecords(context, guildId, limit = 50) {
  if (!context.db) return { events: [], clips: [] };
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100);
  const [events, clips] = await Promise.all([
    context.db.query(
      `
      SELECT id, guild_id, channel_id, user_id, event_type, details, created_at
      FROM remote_voice_events
      WHERE guild_id = $1
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [guildId, safeLimit],
    ),
    context.db.query(
      `
      SELECT id, guild_id, channel_id, user_id, content_type, byte_size, duration_ms,
             transcript, transcript_status, created_at
      FROM remote_voice_clips
      WHERE guild_id = $1
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [guildId, safeLimit],
    ),
  ]);

  return {
    events: events.rows,
    clips: clips.rows,
  };
}

export async function getRemoteVoiceClip(context, guildId, clipId) {
  if (!context.db) return null;
  const result = await context.db.query(
    `
    SELECT id, guild_id, content_type, audio
    FROM remote_voice_clips
    WHERE guild_id = $1 AND id = $2
    `,
    [guildId, clipId],
  );
  return result.rows[0] || null;
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
  const micSession = remoteMicSessions.get(guild.id);
  const receiveSession = remoteReceiveSessions.get(guild.id);
  if (micSession) stopRemoteMicSession(guild.id, micSession);
  if (receiveSession) stopRemoteReceiveSession(guild.id, receiveSession);
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

function createRemoteReceiveSession(context, guild, actor, connection) {
  const session = {
    actorId: actor.id,
    channelId: connection.joinConfig.channelId || null,
    connection,
    context,
    guildId: guild.id,
    startedAt: new Date().toISOString(),
    subscribers: new Set(),
    speakingUsers: new Map(),
    userStreams: new Map(),
    onSpeakingStart: null,
    onConnectionStateChange: null,
  };

  session.onSpeakingStart = (userId) => {
    startReceiveUserStream(context, guild, session, userId).catch((error) => {
      context.liveFeed.publish('remote.voice_receive_error', {
        guildId: guild.id,
        userId,
        error: String(error?.message || error),
      }, 'error');
    });
  };
  session.onConnectionStateChange = (oldState, newState) => {
    if (newState.status === VoiceConnectionStatus.Destroyed) {
      stopRemoteReceiveSession(guild.id, session);
    }
  };

  connection.receiver.speaking.on('start', session.onSpeakingStart);
  connection.on('stateChange', session.onConnectionStateChange);

  return session;
}

async function startReceiveUserStream(context, guild, session, userId) {
  if (!userId || userId === context.client.user?.id || session.userStreams.has(userId)) return;
  const connection = getVoiceConnection(guild.id);
  if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) return;

  const userState = {
    decoder: null,
    ended: false,
    opusStream: null,
    recorder: createVoiceClipRecorder(),
    startedAt: Date.now(),
    userId,
  };
  session.userStreams.set(userId, userState);
  session.speakingUsers.set(userId, new Date().toISOString());

  broadcastReceiveJson(session, {
    type: 'speaking_start',
    userId,
    voice: getRemoteVoiceStatus(guild),
  });
  recordVoiceEvent(context, session, userId, 'speaking_start').catch(() => null);

  const opusStream = connection.receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.AfterSilence,
      duration: 750,
    },
  });
  const decoder = new prism.opus.Decoder({
    rate: PCM_SAMPLE_RATE,
    channels: PCM_CHANNELS,
    frameSize: PCM_FRAME_SIZE,
  });
  userState.opusStream = opusStream;
  userState.decoder = decoder;

  const finish = (error = null) => {
    if (userState.ended) return;
    userState.ended = true;
    session.userStreams.delete(userId);
    session.speakingUsers.delete(userId);
    flushVoiceClip(context, session, userId, userState, 'speaker_end');
    broadcastReceiveJson(session, {
      type: 'speaking_end',
      userId,
      error: error ? String(error?.message || error) : null,
      voice: getRemoteVoiceStatus(guild),
    });
    recordVoiceEvent(context, session, userId, 'speaking_end', {
      durationMs: Date.now() - userState.startedAt,
      error: error ? String(error?.message || error) : null,
    }).catch(() => null);
  };

  decoder.on('data', (chunk) => {
    const pcm = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    broadcastReceivePcm(session, pcm);
    appendVoiceClipPcm(context, session, userId, userState, pcm);
  });
  opusStream.on('error', finish);
  decoder.on('error', finish);
  decoder.on('end', () => finish());
  decoder.on('close', () => finish());
  opusStream.pipe(decoder);
}

function stopRemoteReceiveSession(guildId, session) {
  remoteReceiveSessions.delete(guildId);

  if (session.onSpeakingStart) {
    session.connection.receiver.speaking.off('start', session.onSpeakingStart);
  }
  if (session.onConnectionStateChange) {
    session.connection.off('stateChange', session.onConnectionStateChange);
  }

  for (const [userId, userState] of session.userStreams.entries()) {
    recordVoiceEvent(session.context, session, userId, 'speaking_end', {
      durationMs: Date.now() - userState.startedAt,
      reason: 'receive_stopped',
    }).catch(() => null);
    userState.ended = true;
    flushVoiceClip(session.context, session, userId, userState, 'receive_stopped');
    userState.decoder?.destroy();
    userState.opusStream?.destroy();
  }

  broadcastReceiveJson(session, {
    type: 'stopped',
    message: 'Incoming voice feed stopped.',
  });
  session.subscribers.clear();
  session.userStreams.clear();
  session.speakingUsers.clear();
}

function broadcastReceiveJson(session, payload) {
  for (const subscriber of session.subscribers) {
    subscriber.sendJson?.(payload);
  }
}

function broadcastReceivePcm(session, chunk) {
  for (const subscriber of session.subscribers) {
    subscriber.sendPcm?.(chunk);
  }
}

function createVoiceClipRecorder() {
  return {
    bytes: 0,
    chunks: [],
    startedAt: Date.now(),
  };
}

function appendVoiceClipPcm(context, session, userId, userState, chunk) {
  userState.recorder.chunks.push(chunk);
  userState.recorder.bytes += chunk.length;
  if (userState.recorder.bytes >= MAX_VOICE_CLIP_PCM_BYTES) {
    flushVoiceClip(context, session, userId, userState, 'max_duration');
  }
}

function flushVoiceClip(context, session, userId, userState, reason) {
  const recorder = userState.recorder;
  if (!recorder?.bytes) return;

  userState.recorder = createVoiceClipRecorder();
  const pcm = Buffer.concat(recorder.chunks, recorder.bytes);
  const durationMs = Math.round((pcm.length / (PCM_SAMPLE_RATE * PCM_CHANNELS * PCM_BYTES_PER_SAMPLE)) * 1000);
  if (durationMs < 250) return;

  const audio = encodeWav(pcm);
  if (!context?.db) return;

  context.db.query(
    `
    INSERT INTO remote_voice_clips (
      guild_id, channel_id, user_id, content_type, byte_size, duration_ms,
      transcript_status, audio
    )
    VALUES ($1, $2, $3, 'audio/wav', $4, $5, 'not_configured', $6)
    `,
    [session.guildId, session.channelId, userId, audio.length, durationMs, audio],
  ).then(() => {
    context.liveFeed.publish('remote.voice_clip_recorded', {
      guildId: session.guildId,
      channelId: session.channelId,
      userId,
      durationMs,
      reason,
    });
  }).catch((error) => {
    context.liveFeed.publish('remote.voice_clip_error', {
      guildId: session.guildId,
      userId,
      error: String(error?.message || error),
    }, 'error');
  });
}

async function recordVoiceEvent(context, session, userId, eventType, details = {}) {
  if (!context.db) return;
  await context.db.query(
    `
    INSERT INTO remote_voice_events (guild_id, channel_id, user_id, event_type, details)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [session.guildId, session.channelId, userId, eventType, JSON.stringify(details)],
  );
  context.liveFeed.publish(`remote.voice_${eventType}`, {
    guildId: session.guildId,
    channelId: session.channelId,
    userId,
    ...details,
  });
}

function encodeWav(pcm) {
  const header = Buffer.alloc(44);
  const byteRate = PCM_SAMPLE_RATE * PCM_CHANNELS * PCM_BYTES_PER_SAMPLE;
  const blockAlign = PCM_CHANNELS * PCM_BYTES_PER_SAMPLE;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(PCM_CHANNELS, 22);
  header.writeUInt32LE(PCM_SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(PCM_BYTES_PER_SAMPLE * 8, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm], header.length + pcm.length);
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

function stopRemoteMicSession(guildId, session) {
  remoteMicSessions.delete(guildId);
  session.player.stop(true);
  session.subscription.unsubscribe?.();
  if (typeof session.stream.destroy === 'function') {
    session.stream.destroy();
  }
}
