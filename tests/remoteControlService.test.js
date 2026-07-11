import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import {
  listRemoteChannels,
  MAX_REMOTE_FILES,
  normalizeUploadedFiles,
  RemoteValidationError,
  validateRemoteMessagePayload,
} from '../src/services/remoteControlService.js';

test('remote message payload requires a channel and content or files', () => {
  assert.throws(
    () => validateRemoteMessagePayload({ channelId: '', content: 'hello' }),
    RemoteValidationError,
  );

  assert.throws(
    () => validateRemoteMessagePayload({ channelId: '123', content: '   ', files: [] }),
    RemoteValidationError,
  );
});

test('remote message payload accepts uploaded files without text content', () => {
  const payload = validateRemoteMessagePayload({
    channelId: '123',
    content: '',
    files: [{ name: 'report.txt', dataBase64: Buffer.from('ok').toString('base64') }],
  });

  assert.equal(payload.channelId, '123');
  assert.equal(payload.content, '');
  assert.equal(payload.files[0].name, 'report.txt');
  assert.equal(payload.files[0].buffer.toString(), 'ok');
});

test('remote uploads are sanitized and capped by count', () => {
  const files = normalizeUploadedFiles([
    { name: '../bad:name?.txt', dataBase64: Buffer.from('ok').toString('base64') },
  ]);

  assert.equal(files[0].name, '.._bad_name_.txt');

  assert.throws(
    () => normalizeUploadedFiles(Array.from({ length: MAX_REMOTE_FILES + 1 }, (_, index) => ({
      name: `file-${index}.txt`,
      dataBase64: Buffer.from('ok').toString('base64'),
    }))),
    RemoteValidationError,
  );
});

test('remote channel list includes all bot-sendable channels from fetch, cache, and active threads', async () => {
  const parent = createChannel({ id: 'cat-1', name: 'Community', type: ChannelType.GuildCategory, sendable: false });
  const general = createChannel({ id: 'text-1', name: 'general', type: ChannelType.GuildText, parent });
  const announcements = createChannel({ id: 'text-2', name: 'announcements', type: ChannelType.GuildAnnouncement, parent });
  const locked = createChannel({ id: 'text-3', name: 'locked', type: ChannelType.GuildText, canSend: false });
  const thread = createChannel({ id: 'thread-1', name: 'active-thread', type: ChannelType.PublicThread, parent: general, canSendInThreads: true });
  const voice = createChannel({ id: 'voice-1', name: 'Voice', type: ChannelType.GuildVoice, sendable: false });
  const guild = createGuild({
    fetched: [general],
    cached: [parent, general, announcements, locked, voice],
    activeThreads: [thread],
  });

  const result = await listRemoteChannels(guild);

  assert.deepEqual(result.textChannels.map((channel) => channel.id).sort(), ['text-1', 'text-2', 'thread-1']);
  assert.equal(result.textChannels.find((channel) => channel.id === 'text-2').displayName, 'Community / announcements');
  assert.deepEqual(result.voiceChannels.map((channel) => channel.id), ['voice-1']);
});

function createGuild({ fetched = [], cached = [], activeThreads = [] }) {
  const cache = new Map(cached.map((channel) => [channel.id, channel]));
  return {
    channels: {
      cache,
      fetch: async () => new Map(fetched.map((channel) => [channel.id, channel])),
      fetchActiveThreads: async () => ({
        threads: new Map(activeThreads.map((channel) => [channel.id, channel])),
      }),
    },
    members: {
      me: { id: 'bot-member' },
      fetchMe: async () => ({ id: 'bot-member' }),
    },
  };
}

function createChannel({ id, name, type, parent = null, canSend = true, canSendInThreads = false, sendable = true }) {
  return {
    id,
    name,
    type,
    parent,
    parentId: parent?.id || null,
    members: { size: 0 },
    send: sendable ? async () => null : undefined,
    permissionsFor() {
      const permissions = [PermissionFlagsBits.ViewChannel];
      if (canSend) permissions.push(PermissionFlagsBits.SendMessages);
      if (canSendInThreads) permissions.push(PermissionFlagsBits.SendMessagesInThreads);
      return new PermissionsBitField(permissions);
    },
  };
}
