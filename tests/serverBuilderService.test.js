import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { commandData } from '../src/bot/commands.js';
import {
  createServerBuilderPlan,
  parseAndValidateServerBuilderFile,
  validateServerBuilderConfig,
} from '../src/services/serverBuilderService.js';

const exampleContent = fs.readFileSync(new URL('../docs/server-builder.example.yaml', import.meta.url), 'utf8');

test('Domus-Ursi YAML parses and validates as the canonical Server Builder template', () => {
  const parsed = parseAndValidateServerBuilderFile({
    fileName: 'Domus-Ursi_Discord_Server_Config.yaml',
    content: exampleContent,
  });

  assert.equal(parsed.validation.ok, true);
  assert.equal(parsed.validation.summary.serverKey, 'domus-ursi');
  assert.equal(parsed.validation.summary.roles, 32);
  assert.equal(parsed.validation.summary.categories, 12);
  assert.equal(parsed.validation.summary.channels, 64);
});

test('duplicate keys are rejected with useful errors', () => {
  const config = validConfig();
  config.roles.push({ ...config.roles[0] });

  const result = validateServerBuilderConfig(config);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /duplicates "guest"/);
});

test('unknown permissions and invalid color references are rejected', () => {
  const config = validConfig();
  config.roles[0].color = 'missing-color';
  config.roles[0].permissions.allow.push('LaunchRockets');

  const result = validateServerBuilderConfig(config);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /unknown color "missing-color"/);
  assert.match(result.errors.join('\n'), /unknown Discord permission "LaunchRockets"/);
});

test('Administrator grants are rejected unless explicitly allowed', () => {
  const config = validConfig();
  config.roles[0].permissions.allow.push('Administrator');

  const result = validateServerBuilderConfig(config);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /grants Administrator/);
});

test('CREATE dry-run produces a plan without mutating Discord', async () => {
  const guild = createMockGuild();

  const plan = await createServerBuilderPlan({
    guild,
    config: validConfig(),
    mode: 'CREATE',
    mappings: [],
  });

  assert.equal(guild.mutated, false);
  assert.equal(plan.ok, true);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.summary.create, 108);
  assert.ok(plan.operations.some((operation) => operation.label === 'permission_overwrites'));
});

test('CREATE mode allows Discord starter channels on a fresh server', async () => {
  const config = validConfig();
  config.danger_zone.allow_deletes = true;
  const guild = createMockGuild({
    channels: [
      createChannel({ id: 'starter-text', name: 'default-chat', type: ChannelType.GuildText }),
      createChannel({ id: 'starter-voice', name: 'Default Voice', type: ChannelType.GuildVoice }),
    ],
  });

  const plan = await createServerBuilderPlan({
    guild,
    config,
    mode: 'CREATE',
    mappings: [],
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.summary.delete, 2);
  assert.match(plan.warnings.join('\n'), /Discord defaults/);
});

test('CREATE mode still blocks populated servers', async () => {
  const guild = createMockGuild({
    channels: Array.from({ length: 9 }, (_, index) => createChannel({
      id: `existing-${index}`,
      name: `existing-${index}`,
      type: ChannelType.GuildText,
    })),
  });

  const plan = await createServerBuilderPlan({
    guild,
    config: validConfig(),
    mode: 'CREATE',
    mappings: [],
  });

  assert.equal(plan.ok, false);
  assert.match(plan.errors.join('\n'), /more than the 8 item starter limit/);
});

test('UPDATE mode blocks unmapped exact-name conflicts', async () => {
  const guild = createMockGuild({
    roles: [
      createRole({ id: 'guest-existing', name: 'Guest', position: 10 }),
    ],
  });

  const plan = await createServerBuilderPlan({
    guild,
    config: validConfig(),
    mode: 'UPDATE',
    mappings: [],
  });

  assert.equal(plan.ok, false);
  assert.match(plan.errors.join('\n'), /unmapped role "Guest"/);
});

test('Server Builder remains dashboard-only with no slash command registration', () => {
  const names = commandData.map((command) => command.name);

  assert.equal(names.includes('server'), false);
});

function validConfig() {
  return parseAndValidateServerBuilderFile({
    fileName: 'server-builder.example.yaml',
    content: exampleContent,
  }).config;
}

function createMockGuild(options = {}) {
  const permissions = new PermissionsBitField([
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageRoles,
  ]);
  const botMember = {
    permissions: { has: (permission) => permissions.has(permission) },
    roles: {
      highest: { position: 500 },
      botRole: { id: 'bot-role' },
    },
  };
  const guild = {
    id: 'guild-1',
    mutated: false,
    roles: {
      cache: new Map([
        ['guild-1', createRole({ id: 'guild-1', name: '@everyone', position: 0 })],
        ['bot-role', createRole({ id: 'bot-role', name: 'ThePurge', position: 499, managed: true })],
        ...(options.roles || []).map((role) => [role.id, role]),
      ]),
      fetch: async () => null,
      create: async () => {
        guild.mutated = true;
        throw new Error('Dry-run should not create roles.');
      },
    },
    channels: {
      cache: new Map((options.channels || []).map((channel) => [channel.id, channel])),
      fetch: async () => guild.channels.cache,
      create: async () => {
        guild.mutated = true;
        throw new Error('Dry-run should not create channels.');
      },
    },
    members: {
      me: botMember,
      fetchMe: async () => botMember,
    },
  };
  return guild;
}

function createRole({ id, name, position = 1, managed = false }) {
  return {
    id,
    name,
    position,
    managed,
    editable: true,
    comparePositionTo(other) {
      return position - (other?.position || 0);
    },
  };
}

function createChannel({ id, name, type = ChannelType.GuildText }) {
  return {
    id,
    name,
    type,
    deletable: true,
  };
}
