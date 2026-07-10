import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInviteDm,
  extractUserId,
  InviteValidationError,
  sendServerInvite,
  userMatchesQuery,
} from '../src/services/inviteService.js';

test('extractUserId accepts raw IDs and user mentions', () => {
  assert.equal(extractUserId('123456789012345678'), '123456789012345678');
  assert.equal(extractUserId('<@123456789012345678>'), '123456789012345678');
  assert.equal(extractUserId('<@!123456789012345678>'), '123456789012345678');
  assert.equal(extractUserId('somebody'), '');
});

test('userMatchesQuery checks known username fields exactly', () => {
  const user = {
    username: 'PurgeUser',
    globalName: 'Purge Global',
    tag: 'PurgeUser#0001',
  };
  const member = { displayName: 'Server Nick' };

  assert.equal(userMatchesQuery(user, member, 'purgeuser'), true);
  assert.equal(userMatchesQuery(user, member, 'Purge Global'), true);
  assert.equal(userMatchesQuery(user, member, 'server nick'), true);
  assert.equal(userMatchesQuery(user, member, 'purge'), false);
});

test('sendServerInvite creates one-use invite and DMs fetched user', async () => {
  const createdInvites = [];
  const sentMessages = [];
  const auditEvents = [];
  const targetUser = {
    id: '123456789012345678',
    username: 'target',
    tag: 'target#0001',
    send: async (message) => sentMessages.push(message),
  };
  const channel = {
    id: 'channel-1',
    name: 'general',
    permissionsFor: () => ({ has: () => true }),
    createInvite: async (options) => {
      createdInvites.push(options);
      return { url: 'https://discord.gg/example', code: 'example' };
    },
  };
  const guild = {
    id: 'guild-1',
    name: 'Test Guild',
    channels: {
      cache: new Map([['channel-1', channel]]),
      fetch: async () => channel,
    },
    members: {
      me: { id: 'bot-1' },
      fetch: async () => {
        throw new Error('not a member');
      },
      cache: new Map(),
    },
  };
  const context = {
    client: {
      users: {
        fetch: async () => targetUser,
        cache: new Map(),
      },
    },
    audit: {
      record: async (event) => auditEvents.push(event),
    },
  };

  const result = await sendServerInvite(context, guild, { id: 'actor-1', username: 'admin' }, {
    target: targetUser.id,
    channelId: channel.id,
  });

  assert.equal(result.ok, true);
  assert.equal(result.dmDelivered, true);
  assert.equal(result.inviteUrl, 'https://discord.gg/example');
  assert.equal(createdInvites[0].maxUses, 1);
  assert.equal(sentMessages[0].content, buildInviteDm({ guild, inviteUrl: result.inviteUrl, actor: { username: 'admin' } }));
  assert.equal(auditEvents[0].action, 'invite.sent');
});

test('sendServerInvite rejects users already in the guild', async () => {
  const targetUser = {
    id: '123456789012345678',
    username: 'target',
    tag: 'target#0001',
  };
  const channel = {
    id: 'channel-1',
    name: 'general',
    permissionsFor: () => ({ has: () => true }),
    createInvite: async () => ({ url: 'https://discord.gg/example' }),
  };
  const guild = {
    id: 'guild-1',
    name: 'Test Guild',
    channels: {
      cache: new Map([['channel-1', channel]]),
    },
    members: {
      me: { id: 'bot-1' },
      fetch: async () => ({ user: targetUser }),
      cache: new Map(),
    },
  };
  const context = {
    client: {
      users: {
        fetch: async () => targetUser,
        cache: new Map(),
      },
    },
  };

  await assert.rejects(
    () => sendServerInvite(context, guild, { id: 'actor-1' }, { target: targetUser.id, channelId: channel.id }),
    InviteValidationError,
  );
});
