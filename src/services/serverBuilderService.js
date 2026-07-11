import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';
import YAML from 'yaml';
import {
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField,
} from 'discord.js';

export const MAX_SERVER_BUILDER_CONFIG_BYTES = 1024 * 1024;
export const SERVER_BUILDER_MODES = ['CREATE', 'UPDATE', 'REVAMP', 'CLEAN'];

const allowedExtensions = new Set(['.yaml', '.yml', '.json']);
const destructiveModes = new Set(['REVAMP', 'CLEAN']);
const createStarterChannelLimit = 8;
const channelTypeByName = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  announcement: ChannelType.GuildAnnouncement,
  forum: ChannelType.GuildForum,
  media: ChannelType.GuildMedia,
  stage: ChannelType.GuildStageVoice,
};
const reverseChannelTypes = new Map(Object.entries(channelTypeByName).map(([name, type]) => [type, name]));

const ajv = new Ajv({ allErrors: true });
const validateConfigSchema = ajv.compile({
  type: 'object',
  required: ['schema_version', 'server', 'danger_zone', 'roles', 'categories', 'channels'],
  additionalProperties: false,
  properties: {
    schema_version: { type: 'string', minLength: 1 },
    server: {
      type: 'object',
      required: ['key', 'name'],
      additionalProperties: false,
      properties: {
        key: { type: 'string', minLength: 1, maxLength: 100 },
        name: { type: 'string', minLength: 1, maxLength: 100 },
        description: { type: 'string' },
        locale: { type: 'string' },
      },
    },
    danger_zone: {
      type: 'object',
      additionalProperties: false,
      properties: {
        allow_deletes: { type: 'boolean' },
        allow_administrator_permission: { type: 'boolean' },
        allow_role_position_changes: { type: 'boolean' },
      },
    },
    colors: {
      type: 'object',
      additionalProperties: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
    },
    roles: {
      type: 'array',
      items: roleSchema(),
    },
    categories: {
      type: 'array',
      items: categorySchema(),
    },
    channels: {
      type: 'array',
      items: channelSchema(),
    },
    cleanup: {
      type: 'object',
      additionalProperties: false,
      properties: {
        roles: keyArraySchema(),
        categories: keyArraySchema(),
        channels: keyArraySchema(),
      },
    },
    post_build: {
      type: 'object',
      additionalProperties: false,
      properties: {
        summary_channel_key: { type: 'string', minLength: 1 },
        send_summary_message: { type: 'boolean' },
        audit_log_reason: { type: 'string', minLength: 1, maxLength: 512 },
      },
    },
  },
});

export class ServerBuilderValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ServerBuilderValidationError';
    this.details = details;
  }
}

export function sanitizeServerBuilderKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function normalizeServerBuilderMode(value) {
  const mode = String(value || 'UPDATE').trim().toUpperCase();
  if (!SERVER_BUILDER_MODES.includes(mode)) {
    throw new ServerBuilderValidationError(`Unsupported server builder mode: ${mode}.`);
  }
  return mode;
}

export function parseServerBuilderFile(file) {
  const normalized = normalizeUploadedConfigFile(file);
  let config;

  try {
    if (normalized.extension === '.json') {
      config = JSON.parse(normalized.content);
    } else {
      const document = YAML.parseDocument(normalized.content, {
        schema: 'core',
        prettyErrors: false,
      });
      if (document.errors.length > 0) {
        throw new Error(document.errors.map((error) => error.message).join('; '));
      }
      config = document.toJS({ maxAliasCount: 50 });
    }
  } catch (error) {
    throw new ServerBuilderValidationError(`Could not parse ${normalized.fileName}: ${error.message}`);
  }

  return {
    ...normalized,
    config,
    contentHash: hashText(normalized.content),
  };
}

export function validateServerBuilderConfig(config) {
  const errors = [];
  const ok = validateConfigSchema(config);
  if (!ok) {
    for (const error of validateConfigSchema.errors || []) {
      errors.push(formatAjvError(error));
    }
  }

  if (config && typeof config === 'object') {
    runSemanticValidation(config, errors);
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: summarizeServerBuilderConfig(config),
  };
}

export function parseAndValidateServerBuilderFile(file) {
  const parsed = parseServerBuilderFile(file);
  const validation = validateServerBuilderConfig(parsed.config);
  if (!validation.ok) {
    throw new ServerBuilderValidationError('Server Builder config is invalid.', validation.errors);
  }
  return { ...parsed, validation };
}

export function summarizeServerBuilderConfig(config) {
  if (!config || typeof config !== 'object') {
    return { roles: 0, categories: 0, channels: 0 };
  }

  return {
    schemaVersion: config.schema_version || null,
    serverKey: config.server?.key || null,
    serverName: config.server?.name || null,
    roles: Array.isArray(config.roles) ? config.roles.length : 0,
    categories: Array.isArray(config.categories) ? config.categories.length : 0,
    channels: Array.isArray(config.channels) ? config.channels.length : 0,
    destructiveAllowed: Boolean(config.danger_zone?.allow_deletes),
    administratorAllowed: Boolean(config.danger_zone?.allow_administrator_permission),
    rolePositionChangesAllowed: Boolean(config.danger_zone?.allow_role_position_changes),
    summaryChannelKey: config.post_build?.summary_channel_key || null,
  };
}

export async function saveServerBuilderConfig(context, guild, actor, body) {
  const configKey = sanitizeRequiredKey(body.configKey || body.key || body.name);
  const parsed = parseAndValidateServerBuilderFile(body.file || {
    fileName: body.fileName,
    content: body.content,
    dataBase64: body.dataBase64,
  });
  const storagePath = await mirrorServerBuilderConfig(guild.id, configKey, parsed);

  const result = await context.db.query(
    `
    INSERT INTO server_builder_configs (
      guild_id, config_key, file_name, content_hash, content, parsed, storage_path,
      uploaded_by, validation_summary, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    ON CONFLICT (guild_id, config_key) DO UPDATE SET
      file_name = EXCLUDED.file_name,
      content_hash = EXCLUDED.content_hash,
      content = EXCLUDED.content,
      parsed = EXCLUDED.parsed,
      storage_path = EXCLUDED.storage_path,
      uploaded_by = EXCLUDED.uploaded_by,
      validation_summary = EXCLUDED.validation_summary,
      updated_at = NOW()
    RETURNING *;
    `,
    [
      guild.id,
      configKey,
      parsed.fileName,
      parsed.contentHash,
      parsed.content,
      JSON.stringify(parsed.config),
      storagePath,
      actor?.id || null,
      JSON.stringify(parsed.validation.summary),
    ],
  );

  await context.audit?.record?.({
    guildId: guild.id,
    actorId: actor?.id || null,
    action: 'server_builder.config_saved',
    source: 'dashboard',
    details: { configKey, fileName: parsed.fileName, summary: parsed.validation.summary },
  });

  return {
    ok: true,
    message: `Server Builder config "${configKey}" saved.`,
    config: formatConfigRow(result.rows[0]),
    validation: parsed.validation,
  };
}

export async function listServerBuilderConfigs(context, guildId) {
  const result = await context.db.query(
    `
    SELECT id, guild_id, config_key, file_name, content_hash, storage_path, uploaded_by,
      validation_summary, created_at, updated_at
    FROM server_builder_configs
    WHERE guild_id = $1
    ORDER BY updated_at DESC;
    `,
    [guildId],
  );

  return { configs: result.rows.map(formatConfigRow) };
}

export async function validateSavedServerBuilderConfig(context, guildId, configKey) {
  const row = await loadServerBuilderConfig(context, guildId, configKey);
  const validation = validateServerBuilderConfig(row.parsed);
  if (!validation.ok) {
    throw new ServerBuilderValidationError('Server Builder config is invalid.', validation.errors);
  }
  return { ok: true, config: formatConfigRow(row), validation };
}

export async function previewServerBuilderConfig(context, guild, actor, body) {
  const configKey = sanitizeRequiredKey(body.configKey || body.key || body.name);
  const mode = normalizeServerBuilderMode(body.mode);
  const row = await loadServerBuilderConfig(context, guild.id, configKey);
  const mappings = await loadServerBuilderMappings(context, guild.id, configKey);
  const plan = await createServerBuilderPlan({
    guild,
    config: row.parsed,
    configKey,
    mode,
    mappings,
    apply: false,
  });

  await recordServerBuilderRun(context, {
    guildId: guild.id,
    configKey,
    contentHash: row.content_hash,
    mode,
    dryRun: true,
    status: plan.ok ? 'preview_ok' : 'preview_failed',
    actorId: actor?.id || null,
    result: plan,
  });

  return {
    ...plan,
    config: formatConfigRow(row),
    message: plan.ok ? 'Preview ready. No Discord changes were made.' : 'Preview found blockers.',
  };
}

export async function applyServerBuilderConfig(context, guild, actor, body) {
  const configKey = sanitizeRequiredKey(body.configKey || body.key || body.name);
  const mode = normalizeServerBuilderMode(body.mode);
  const row = await loadServerBuilderConfig(context, guild.id, configKey);
  await requireSuccessfulPreview(context, guild.id, configKey, row.content_hash, mode);

  const mappings = await loadServerBuilderMappings(context, guild.id, configKey);
  const plan = await createServerBuilderPlan({
    guild,
    config: row.parsed,
    configKey,
    mode,
    mappings,
    apply: false,
  });

  if (!plan.ok) {
    await recordServerBuilderRun(context, {
      guildId: guild.id,
      configKey,
      contentHash: row.content_hash,
      mode,
      dryRun: false,
      status: 'apply_blocked',
      actorId: actor?.id || null,
      result: plan,
    });
    return { ...plan, config: formatConfigRow(row), message: 'Apply blocked by preview errors.' };
  }

  const result = await applyServerBuilderPlan(context, guild, actor, {
    configKey,
    config: row.parsed,
    mode,
    plan,
  });

  await recordServerBuilderRun(context, {
    guildId: guild.id,
    configKey,
    contentHash: row.content_hash,
    mode,
    dryRun: false,
    status: result.ok ? 'applied' : 'apply_failed',
    actorId: actor?.id || null,
    result,
  });

  await context.audit?.record?.({
    guildId: guild.id,
    actorId: actor?.id || null,
    action: result.ok ? 'server_builder.applied' : 'server_builder.apply_failed',
    source: 'dashboard',
    severity: result.ok ? 'info' : 'error',
    details: { configKey, mode, summary: result.summary, errors: result.errors },
  });

  return { ...result, config: formatConfigRow(row), message: result.ok ? 'Server Builder apply complete.' : 'Server Builder apply failed.' };
}

export async function listServerBuilderRuns(context, guildId, limit = 10) {
  const cappedLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 10, 50));
  const result = await context.db.query(
    `
    SELECT id, guild_id, config_key, content_hash, mode, dry_run, status, actor_id, result,
      created_at
    FROM server_builder_runs
    WHERE guild_id = $1
    ORDER BY created_at DESC
    LIMIT $2;
    `,
    [guildId, cappedLimit],
  );

  return { runs: result.rows.map((row) => ({ ...row, result: row.result || {} })) };
}

export async function createServerBuilderPlan({ guild, config, configKey = 'preview', mode = 'UPDATE', mappings = [] }) {
  const normalizedMode = normalizeServerBuilderMode(mode);
  const validation = validateServerBuilderConfig(config);
  const errors = [...validation.errors];
  const warnings = [];
  const operations = [];
  const summary = {
    ...validation.summary,
    mode: normalizedMode,
    create: 0,
    update: 0,
    delete: 0,
    skip: 0,
    failed: 0,
  };

  if (!validation.ok) {
    return { ok: false, dryRun: true, summary, errors, warnings, operations };
  }

  if (destructiveModes.has(normalizedMode) && !config.danger_zone?.allow_deletes) {
    errors.push(`${normalizedMode} requires danger_zone.allow_deletes: true.`);
  }

  const state = await collectGuildState(guild);
  const mappingIndex = indexMappings(mappings);
  const botCheck = checkBotBuildPermissions(state, config, normalizedMode);
  errors.push(...botCheck.errors);
  warnings.push(...botCheck.warnings);

  if (normalizedMode === 'CREATE') {
    const readiness = assessCreateGuildReadiness(state);
    errors.push(...readiness.errors);
    warnings.push(...readiness.warnings);
  }

  if (normalizedMode === 'CLEAN') {
    addCleanOperations({ config, state, mappingIndex, operations, errors, summary });
  } else if (normalizedMode === 'REVAMP') {
    addRevampDeleteOperations({ state, operations, errors, summary });
    addBuildOperations({ config, configKey, state, mappingIndex: new Map(), mode: normalizedMode, operations, errors, summary });
  } else {
    if (normalizedMode === 'CREATE') {
      addCreateStarterCleanupOperations({ config, state, operations, warnings, summary });
    }
    addBuildOperations({ config, configKey, state, mappingIndex, mode: normalizedMode, operations, errors, summary });
  }

  return {
    ok: errors.length === 0,
    dryRun: true,
    summary,
    errors,
    warnings,
    operations,
  };
}

async function applyServerBuilderPlan(context, guild, actor, { configKey, config, mode, plan }) {
  const errors = [];
  const warnings = [...(plan.warnings || [])];
  const summary = { ...plan.summary, create: 0, update: 0, delete: 0, skip: 0, failed: 0 };
  const state = await collectGuildState(guild);
  const roleIds = new Map(state.roles.map((role) => [role.key || role.name, role.id]));
  const categoryIds = new Map(state.categories.map((category) => [category.key || category.name, category.id]));
  const channelIds = new Map(state.channels.map((channel) => [channel.key || channel.name, channel.id]));
  const reason = buildAuditReason(config, actor, mode);

  const getLiveRole = (id) => guild.roles.cache?.get?.(id) || state.roles.find((role) => role.id === id);
  const getLiveChannel = (id) => guild.channels.cache?.get?.(id) || state.allChannels.find((channel) => channel.id === id);

  for (const operation of plan.operations.filter((item) => item.phase === 'delete')) {
    try {
      const target = operation.objectType === 'role' ? getLiveRole(operation.discordId) : getLiveChannel(operation.discordId);
      if (!target) {
        summary.skip += 1;
        continue;
      }
      await target.delete(reason);
      summary.delete += 1;
    } catch (error) {
      summary.failed += 1;
      errors.push(`${operation.label} delete failed: ${error.message}`);
    }
  }

  if (mode === 'CLEAN') {
    return finishApplyResult({ plan, summary, errors, warnings });
  }

  for (const role of config.roles || []) {
    const operation = plan.operations.find((item) => item.objectType === 'role' && item.key === role.key && item.phase === 'build');
    if (!operation || operation.action === 'blocked') continue;
    try {
      let discordRole = operation.discordId ? getLiveRole(operation.discordId) : null;
      const payload = rolePayload(role, config);
      if (discordRole) {
        await discordRole.edit(payload, reason);
        summary.update += 1;
      } else {
        discordRole = await guild.roles.create({ ...payload, reason });
        summary.create += 1;
      }

      if (config.danger_zone?.allow_role_position_changes && Number.isInteger(role.position) && typeof discordRole.setPosition === 'function') {
        await discordRole.setPosition(role.position, { reason }).catch((error) => {
          warnings.push(`Role ${role.key} position update failed: ${error.message}`);
        });
      }

      roleIds.set(role.key, discordRole.id);
      await upsertServerBuilderMapping(context, guild.id, configKey, 'role', role.key, discordRole.id, role.name);
    } catch (error) {
      summary.failed += 1;
      errors.push(`Role ${role.key} apply failed: ${error.message}`);
    }
  }

  for (const category of config.categories || []) {
    const operation = plan.operations.find((item) => item.objectType === 'category' && item.key === category.key && item.phase === 'build');
    if (!operation || operation.action === 'blocked') continue;
    try {
      let discordCategory = operation.discordId ? getLiveChannel(operation.discordId) : null;
      const payload = categoryPayload(category);
      if (discordCategory) {
        await discordCategory.edit({ ...payload, reason });
        summary.update += 1;
      } else {
        discordCategory = await guild.channels.create({ ...payload, type: ChannelType.GuildCategory, reason });
        summary.create += 1;
      }

      categoryIds.set(category.key, discordCategory.id);
      await upsertServerBuilderMapping(context, guild.id, configKey, 'category', category.key, discordCategory.id, category.name);
    } catch (error) {
      summary.failed += 1;
      errors.push(`Category ${category.key} apply failed: ${error.message}`);
    }
  }

  for (const channel of config.channels || []) {
    const operation = plan.operations.find((item) => item.objectType === 'channel' && item.key === channel.key && item.phase === 'build');
    if (!operation || operation.action === 'blocked') continue;
    try {
      let discordChannel = operation.discordId ? getLiveChannel(operation.discordId) : null;
      const payload = channelPayload(channel, categoryIds);
      if (discordChannel) {
        await discordChannel.edit({ ...payload, reason });
        summary.update += 1;
      } else {
        discordChannel = await guild.channels.create({ ...payload, reason });
        summary.create += 1;
      }

      channelIds.set(channel.key, discordChannel.id);
      await upsertServerBuilderMapping(context, guild.id, configKey, 'channel', channel.key, discordChannel.id, channel.name);
    } catch (error) {
      summary.failed += 1;
      errors.push(`Channel ${channel.key} apply failed: ${error.message}`);
    }
  }

  await applyPermissionOverwrites({ config, guild, roleIds, categoryIds, channelIds, reason, errors, warnings, summary });
  await sendPostBuildSummary({ config, guild, channelIds, summary, errors, reason });

  return finishApplyResult({ plan, summary, errors, warnings });
}

function finishApplyResult({ plan, summary, errors, warnings }) {
  return {
    ok: errors.length === 0,
    dryRun: false,
    summary,
    errors,
    warnings,
    operations: plan.operations,
  };
}

function normalizeUploadedConfigFile(file = {}) {
  const fileName = sanitizeFileName(file.fileName || file.name || 'server-builder.yaml');
  const extension = path.extname(fileName).toLowerCase();
  if (!allowedExtensions.has(extension)) {
    throw new ServerBuilderValidationError('Upload a .yaml, .yml, or .json Server Builder config.');
  }

  const content = file.content != null
    ? String(file.content)
    : Buffer.from(String(file.dataBase64 || '').replace(/^data:[^;]+;base64,/, ''), 'base64').toString('utf8');
  const byteSize = Buffer.byteLength(content, 'utf8');
  if (byteSize <= 0) {
    throw new ServerBuilderValidationError('Server Builder config file is empty.');
  }
  if (byteSize > MAX_SERVER_BUILDER_CONFIG_BYTES) {
    throw new ServerBuilderValidationError('Server Builder config files must be 1 MB or smaller.');
  }

  return { fileName, extension, content, byteSize };
}

function runSemanticValidation(config, errors) {
  const roleKeys = validateUniqueKeys(config.roles, 'roles', errors);
  const categoryKeys = validateUniqueKeys(config.categories, 'categories', errors);
  const channelKeys = validateUniqueKeys(config.channels, 'channels', errors);
  const colors = config.colors || {};
  const adminAllowed = Boolean(config.danger_zone?.allow_administrator_permission);

  for (const [index, role] of (config.roles || []).entries()) {
    if (role.color && !isHexColor(role.color) && !colors[role.color]) {
      errors.push(`roles[${index}].color references unknown color "${role.color}".`);
    }
    validatePermissionList(role.permissions?.allow, `roles[${index}].permissions.allow`, errors, { adminAllowed });
    validatePermissionList(role.permissions?.deny, `roles[${index}].permissions.deny`, errors, { adminAllowed: true });
  }

  for (const [index, category] of (config.categories || []).entries()) {
    validateOverwrites(category.permission_overwrites, `categories[${index}].permission_overwrites`, roleKeys, errors, adminAllowed);
  }

  for (const [index, channel] of (config.channels || []).entries()) {
    if (!Object.prototype.hasOwnProperty.call(channelTypeByName, channel.type)) {
      errors.push(`channels[${index}].type "${channel.type}" is not supported.`);
    }
    if (channel.category && !categoryKeys.has(channel.category)) {
      errors.push(`channels[${index}].category references unknown category key "${channel.category}".`);
    }
    validateOverwrites(channel.permission_overwrites, `channels[${index}].permission_overwrites`, roleKeys, errors, adminAllowed);
  }

  if (config.post_build?.summary_channel_key && !channelKeys.has(config.post_build.summary_channel_key)) {
    errors.push(`post_build.summary_channel_key references unknown channel key "${config.post_build.summary_channel_key}".`);
  }

  validateCleanupKeys(config.cleanup, roleKeys, categoryKeys, channelKeys, errors);
}

function validateUniqueKeys(items, label, errors) {
  const keys = new Set();
  for (const [index, item] of (items || []).entries()) {
    if (!item?.key) continue;
    if (keys.has(item.key)) {
      errors.push(`${label}[${index}].key duplicates "${item.key}".`);
    }
    keys.add(item.key);
  }
  return keys;
}

function validatePermissionList(names = [], pathLabel, errors, { adminAllowed }) {
  for (const name of names || []) {
    if (!Object.prototype.hasOwnProperty.call(PermissionFlagsBits, name)) {
      errors.push(`${pathLabel} contains unknown Discord permission "${name}".`);
    }
    if (name === 'Administrator' && !adminAllowed) {
      errors.push(`${pathLabel} grants Administrator but danger_zone.allow_administrator_permission is not true.`);
    }
  }
}

function validateOverwrites(overwrites = [], pathLabel, roleKeys, errors, adminAllowed) {
  for (const [index, overwrite] of (overwrites || []).entries()) {
    const target = String(overwrite.target || '');
    if (target !== '@everyone' && !target.startsWith('user:') && !target.startsWith('role:')) {
      errors.push(`${pathLabel}[${index}].target must be @everyone, role:<role_key>, or user:<discord_user_id>.`);
    }
    if (target.startsWith('role:') && !roleKeys.has(target.slice(5))) {
      errors.push(`${pathLabel}[${index}].target references unknown role key "${target.slice(5)}".`);
    }
    if (target.startsWith('user:') && !/^\d{17,22}$/.test(target.slice(5))) {
      errors.push(`${pathLabel}[${index}].target user ID is invalid.`);
    }
    validatePermissionList(overwrite.allow, `${pathLabel}[${index}].allow`, errors, { adminAllowed });
    validatePermissionList(overwrite.deny, `${pathLabel}[${index}].deny`, errors, { adminAllowed: true });
  }
}

function validateCleanupKeys(cleanup, roleKeys, categoryKeys, channelKeys, errors) {
  if (!cleanup) return;
  for (const key of cleanup.roles || []) {
    if (!roleKeys.has(key)) errors.push(`cleanup.roles references unknown role key "${key}".`);
  }
  for (const key of cleanup.categories || []) {
    if (!categoryKeys.has(key)) errors.push(`cleanup.categories references unknown category key "${key}".`);
  }
  for (const key of cleanup.channels || []) {
    if (!channelKeys.has(key)) errors.push(`cleanup.channels references unknown channel key "${key}".`);
  }
}

async function collectGuildState(guild) {
  if (guild.roles?.fetch) await guild.roles.fetch().catch(() => null);
  const fetchedChannels = guild.channels?.fetch ? await guild.channels.fetch().catch(() => null) : null;
  const allRoles = collectionValues(guild.roles?.cache || []);
  const allChannels = collectionValues(fetchedChannels || guild.channels?.cache || []);
  const botMember = guild.members?.me || await guild.members?.fetchMe?.().catch(() => null);

  return {
    guild,
    botMember,
    allRoles,
    allChannels,
    roles: allRoles.filter((role) => role && role.id !== guild.id),
    categories: allChannels.filter((channel) => channel?.type === ChannelType.GuildCategory),
    channels: allChannels.filter((channel) => channel && channel.type !== ChannelType.GuildCategory),
  };
}

function checkBotBuildPermissions(state, config, mode) {
  const errors = [];
  const warnings = [];
  const botMember = state.botMember;
  if (!botMember) {
    errors.push('The bot member record could not be loaded for this guild.');
    return { errors, warnings };
  }

  if (!botMember.permissions?.has?.(PermissionFlagsBits.ManageChannels)) {
    errors.push('The bot needs Manage Channels permission for Server Builder.');
  }
  if ((config.roles || []).length > 0 && !botMember.permissions?.has?.(PermissionFlagsBits.ManageRoles)) {
    errors.push('The bot needs Manage Roles permission for Server Builder roles.');
  }

  if (config.danger_zone?.allow_role_position_changes) {
    const botPosition = botMember.roles?.highest?.position;
    if (Number.isFinite(botPosition)) {
      for (const role of config.roles || []) {
        if (Number.isInteger(role.position) && role.position >= botPosition) {
          errors.push(`Role ${role.key} position ${role.position} is at or above the bot highest role position ${botPosition}.`);
        }
      }
    } else {
      warnings.push('Could not verify bot highest role position before role moves.');
    }
  }

  if (destructiveModes.has(mode) && !botMember.permissions?.has?.(PermissionFlagsBits.ManageRoles)) {
    warnings.push('Destructive role cleanup will skip roles the bot cannot manage.');
  }

  return { errors, warnings };
}

function assessCreateGuildReadiness(state) {
  const botRoleId = state.botMember?.roles?.botRole?.id || null;
  const roles = state.roles.filter((role) => !role.managed && role.id !== botRoleId);
  const channels = state.allChannels.filter(Boolean);
  const errors = [];
  const warnings = [];

  if (roles.length > 0) {
    errors.push(`CREATE mode only accepts a fresh server with no custom roles. Found ${roles.length} existing non-managed role(s).`);
  }
  if (channels.length > createStarterChannelLimit) {
    errors.push(`CREATE mode only accepts a fresh starter server. Found ${channels.length} existing channel/category item(s), which is more than the ${createStarterChannelLimit} item starter limit. Use UPDATE or REVAMP instead.`);
  } else if (channels.length > 0) {
    warnings.push(`CREATE mode will treat ${channels.length} existing starter channel/category item(s) as Discord defaults.`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

function addBuildOperations({ config, state, mappingIndex, mode, operations, errors, summary }) {
  for (const role of config.roles || []) {
    const match = findRoleMatch({ role, state, mappingIndex, mode, errors });
    addBuildOperation(operations, summary, {
      objectType: 'role',
      key: role.key,
      name: role.name,
      discordId: match?.id || null,
      action: match ? 'update' : 'create',
      label: `role:${role.key}`,
    });
  }

  for (const category of config.categories || []) {
    const match = findChannelMatch({ item: category, objectType: 'category', state, mappingIndex, mode, errors });
    addBuildOperation(operations, summary, {
      objectType: 'category',
      key: category.key,
      name: category.name,
      discordId: match?.id || null,
      action: match ? 'update' : 'create',
      label: `category:${category.key}`,
    });
  }

  for (const channel of config.channels || []) {
    const match = findChannelMatch({ item: channel, objectType: 'channel', state, mappingIndex, mode, errors });
    addBuildOperation(operations, summary, {
      objectType: 'channel',
      key: channel.key,
      name: channel.name,
      discordId: match?.id || null,
      action: match ? 'update' : 'create',
      label: `channel:${channel.key}`,
    });
  }

  if ((config.categories || []).some((category) => category.permission_overwrites?.length > 0)
    || (config.channels || []).some((channel) => channel.permission_overwrites?.length > 0 || channel.sync_permissions_with_category)) {
    operations.push({
      phase: 'permissions',
      action: 'set',
      objectType: 'permission_overwrites',
      label: 'permission_overwrites',
    });
  }
}

function addCreateStarterCleanupOperations({ config, state, operations, warnings, summary }) {
  const starterChannels = state.channels.filter((channel) => !matchesConfiguredChannel(channel, config));
  const starterCategories = state.categories.filter((category) => !matchesConfiguredCategory(category, config));
  const starterItems = [...starterChannels, ...starterCategories];

  if (starterItems.length === 0) return;
  if (!config.danger_zone?.allow_deletes) {
    warnings.push(`CREATE mode found ${starterItems.length} Discord starter channel/category item(s), but danger_zone.allow_deletes is false, so they will be left in place.`);
    summary.skip += starterItems.length;
    return;
  }

  for (const channel of starterChannels) {
    if (!isChannelDeletable(channel)) continue;
    operations.push(deleteOperation('channel', channel));
    summary.delete += 1;
  }

  for (const category of starterCategories) {
    if (!isChannelDeletable(category)) continue;
    operations.push(deleteOperation('category', category));
    summary.delete += 1;
  }
}

function matchesConfiguredChannel(channel, config) {
  return (config.channels || []).some((configured) => (
    configured.name === channel.name && channelTypeByName[configured.type] === channel.type
  ));
}

function matchesConfiguredCategory(category, config) {
  return (config.categories || []).some((configured) => configured.name === category.name);
}

function addBuildOperation(operations, summary, operation) {
  operations.push({ phase: 'build', ...operation });
  summary[operation.action] += 1;
}

function findRoleMatch({ role, state, mappingIndex, mode, errors }) {
  const mappedId = mappingIndex.get(`role:${role.key}`);
  if (mappedId) {
    const mapped = state.roles.find((item) => item.id === mappedId);
    if (mapped) return mapped;
  }

  const exact = state.roles.filter((item) => item.name === role.name);
  if (exact.length > 1) {
    errors.push(`Role ${role.key} conflicts with multiple existing roles named "${role.name}".`);
    return null;
  }
  if (exact.length === 1) {
    if (mode === 'UPDATE') {
      errors.push(`Role ${role.key} matches existing unmapped role "${role.name}". Resolve mapping or use another mode.`);
      return null;
    }
    return exact[0];
  }

  return null;
}

function findChannelMatch({ item, objectType, state, mappingIndex, mode, errors }) {
  const mappedId = mappingIndex.get(`${objectType}:${item.key}`);
  const candidates = objectType === 'category' ? state.categories : state.channels;
  if (mappedId) {
    const mapped = candidates.find((channel) => channel.id === mappedId);
    if (mapped) return mapped;
  }

  const expectedType = objectType === 'category' ? ChannelType.GuildCategory : channelTypeByName[item.type];
  const exact = candidates.filter((channel) => channel.name === item.name && channel.type === expectedType);
  if (exact.length > 1) {
    errors.push(`${objectType} ${item.key} conflicts with multiple existing items named "${item.name}".`);
    return null;
  }
  if (exact.length === 1) {
    if (mode === 'UPDATE') {
      errors.push(`${objectType} ${item.key} matches existing unmapped item "${item.name}". Resolve mapping or use another mode.`);
      return null;
    }
    return exact[0];
  }

  return null;
}

function addRevampDeleteOperations({ state, operations, errors, summary }) {
  for (const channel of state.channels) {
    if (!isChannelDeletable(channel)) {
      errors.push(`REVAMP cannot delete channel "${channel.name}".`);
      continue;
    }
    operations.push(deleteOperation('channel', channel));
    summary.delete += 1;
  }
  for (const category of state.categories) {
    if (!isChannelDeletable(category)) {
      errors.push(`REVAMP cannot delete category "${category.name}".`);
      continue;
    }
    operations.push(deleteOperation('category', category));
    summary.delete += 1;
  }
  for (const role of state.roles) {
    if (!isRoleDeletable(role, state.botMember)) continue;
    operations.push(deleteOperation('role', role));
    summary.delete += 1;
  }
}

function addCleanOperations({ config, state, mappingIndex, operations, errors, summary }) {
  const cleanup = config.cleanup || {};
  const requested = [
    ...(cleanup.channels || []).map((key) => ['channel', key]),
    ...(cleanup.categories || []).map((key) => ['category', key]),
    ...(cleanup.roles || []).map((key) => ['role', key]),
  ];
  if (requested.length === 0) {
    errors.push('CLEAN mode requires cleanup.roles, cleanup.categories, or cleanup.channels.');
    return;
  }

  for (const [objectType, key] of requested) {
    const mappedId = mappingIndex.get(`${objectType}:${key}`);
    const pool = objectType === 'role' ? state.roles : objectType === 'category' ? state.categories : state.channels;
    const target = mappedId ? pool.find((item) => item.id === mappedId) : null;
    if (!target) {
      errors.push(`CLEAN could not find mapped ${objectType}:${key}.`);
      continue;
    }
    if (objectType === 'role' && !isRoleDeletable(target, state.botMember)) {
      errors.push(`CLEAN cannot delete protected role "${target.name}".`);
      continue;
    }
    if (objectType !== 'role' && !isChannelDeletable(target)) {
      errors.push(`CLEAN cannot delete protected ${objectType} "${target.name}".`);
      continue;
    }
    operations.push(deleteOperation(objectType, target));
    summary.delete += 1;
  }
}

function deleteOperation(objectType, target) {
  return {
    phase: 'delete',
    action: 'delete',
    objectType,
    key: null,
    discordId: target.id,
    name: target.name,
    label: `${objectType}:${target.name}`,
  };
}

function isRoleDeletable(role, botMember) {
  if (!role || role.id === role.guild?.id || role.managed || role.name === '@everyone') return false;
  if (role.id === botMember?.roles?.botRole?.id) return false;
  if (role.editable === false) return false;
  const botHighest = botMember?.roles?.highest;
  if (botHighest && typeof role.comparePositionTo === 'function' && role.comparePositionTo(botHighest) >= 0) return false;
  return true;
}

function isChannelDeletable(channel) {
  return channel && channel.deletable !== false;
}

function rolePayload(role, config) {
  return {
    name: role.name,
    color: resolveColor(role.color, config.colors || {}),
    hoist: Boolean(role.hoist),
    mentionable: Boolean(role.mentionable),
    permissions: permissionBits(role.permissions?.allow || []),
  };
}

function categoryPayload(category) {
  return {
    name: category.name,
    position: Number.isInteger(category.position) ? category.position : undefined,
  };
}

function channelPayload(channel, categoryIds) {
  return {
    name: channel.name,
    type: channelTypeByName[channel.type],
    parent: channel.category ? categoryIds.get(channel.category) : undefined,
    position: Number.isInteger(channel.position) ? channel.position : undefined,
    topic: channel.topic || channel.description || undefined,
    nsfw: Boolean(channel.nsfw),
    rateLimitPerUser: Number.isInteger(channel.slowmode_seconds) ? channel.slowmode_seconds : undefined,
    userLimit: Number.isInteger(channel.user_limit) ? channel.user_limit : undefined,
    bitrate: Number.isInteger(channel.bitrate) ? channel.bitrate : undefined,
    defaultAutoArchiveDuration: Number.isInteger(channel.default_auto_archive_duration_minutes)
      ? channel.default_auto_archive_duration_minutes
      : undefined,
    defaultReactionEmoji: channel.default_reaction_emoji || undefined,
    availableTags: Array.isArray(channel.available_tags)
      ? channel.available_tags.map((tag) => ({
        name: tag.name,
        emoji: tag.emoji || undefined,
        moderated: Boolean(tag.moderated),
      }))
      : undefined,
  };
}

async function applyPermissionOverwrites({ config, guild, roleIds, categoryIds, channelIds, reason, errors, warnings, summary }) {
  const allTargets = [
    ...(config.categories || []).map((item) => ({ ...item, objectType: 'category', discordId: categoryIds.get(item.key) })),
    ...(config.channels || []).map((item) => ({ ...item, objectType: 'channel', discordId: channelIds.get(item.key) })),
  ];

  for (const item of allTargets) {
    const discordChannel = item.discordId ? guild.channels.cache?.get?.(item.discordId) || await guild.channels.fetch(item.discordId).catch(() => null) : null;
    if (!discordChannel) continue;
    try {
      if (item.sync_permissions_with_category && item.category && typeof discordChannel.lockPermissions === 'function') {
        await discordChannel.lockPermissions(reason);
        continue;
      }
      if (!item.permission_overwrites?.length) continue;
      const overwrites = item.permission_overwrites.map((overwrite) => ({
        id: resolveOverwriteTargetId(guild, roleIds, overwrite.target),
        allow: permissionBits(overwrite.allow || []),
        deny: permissionBits(overwrite.deny || []),
      }));
      await discordChannel.permissionOverwrites.set(overwrites, reason);
      summary.update += 1;
    } catch (error) {
      warnings.push(`${item.objectType} ${item.key} permission overwrite failed: ${error.message}`);
    }
  }
}

async function sendPostBuildSummary({ config, guild, channelIds, summary, errors, reason }) {
  if (!config.post_build?.send_summary_message) return;
  const channelId = channelIds.get(config.post_build.summary_channel_key);
  if (!channelId) return;
  const channel = guild.channels.cache?.get?.(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || typeof channel.send !== 'function') return;
  await channel.send({
    content: [
      `Server Builder applied: ${config.server?.name || config.server?.key || 'server config'}`,
      `Created: ${summary.create} | Updated: ${summary.update} | Deleted: ${summary.delete} | Failed: ${summary.failed}`,
      errors.length ? `Errors: ${errors.slice(0, 5).join(' | ')}` : 'Status: complete',
    ].join('\n'),
    allowedMentions: { parse: [] },
  }).catch(() => null);
}

function resolveOverwriteTargetId(guild, roleIds, target) {
  if (target === '@everyone') return guild.id;
  if (target.startsWith('role:')) return roleIds.get(target.slice(5));
  if (target.startsWith('user:')) return target.slice(5);
  return target;
}

function permissionBits(names) {
  return new PermissionsBitField((names || []).map((name) => PermissionFlagsBits[name])).bitfield;
}

function resolveColor(value, colors) {
  if (!value) return undefined;
  return colors[value] || value;
}

async function loadServerBuilderConfig(context, guildId, configKey) {
  const result = await context.db.query(
    'SELECT * FROM server_builder_configs WHERE guild_id = $1 AND config_key = $2',
    [guildId, sanitizeRequiredKey(configKey)],
  );
  if (result.rowCount === 0) {
    throw new ServerBuilderValidationError(`No saved Server Builder config found for "${configKey}".`);
  }
  return result.rows[0];
}

async function loadServerBuilderMappings(context, guildId, configKey) {
  const result = await context.db.query(
    'SELECT object_type, object_key, discord_id, discord_name FROM server_builder_mappings WHERE guild_id = $1 AND config_key = $2',
    [guildId, configKey],
  );
  return result.rows;
}

async function upsertServerBuilderMapping(context, guildId, configKey, objectType, objectKey, discordId, discordName) {
  await context.db.query(
    `
    INSERT INTO server_builder_mappings (
      guild_id, config_key, object_type, object_key, discord_id, discord_name, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (guild_id, config_key, object_type, object_key) DO UPDATE SET
      discord_id = EXCLUDED.discord_id,
      discord_name = EXCLUDED.discord_name,
      updated_at = NOW();
    `,
    [guildId, configKey, objectType, objectKey, discordId, discordName],
  );
}

async function recordServerBuilderRun(context, run) {
  await context.db.query(
    `
    INSERT INTO server_builder_runs (
      guild_id, config_key, content_hash, mode, dry_run, status, actor_id, result
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
    `,
    [
      run.guildId,
      run.configKey,
      run.contentHash,
      run.mode,
      run.dryRun,
      run.status,
      run.actorId,
      JSON.stringify(run.result || {}),
    ],
  );
}

async function requireSuccessfulPreview(context, guildId, configKey, contentHash, mode) {
  const result = await context.db.query(
    `
    SELECT id
    FROM server_builder_runs
    WHERE guild_id = $1
      AND config_key = $2
      AND content_hash = $3
      AND mode = $4
      AND dry_run = TRUE
      AND status = 'preview_ok'
    ORDER BY created_at DESC
    LIMIT 1;
    `,
    [guildId, configKey, contentHash, mode],
  );
  if (result.rowCount === 0) {
    throw new ServerBuilderValidationError('Run a successful Preview for this exact config and mode before Apply.');
  }
}

function indexMappings(mappings) {
  const index = new Map();
  for (const mapping of mappings || []) {
    index.set(`${mapping.object_type}:${mapping.object_key}`, mapping.discord_id);
  }
  return index;
}

async function mirrorServerBuilderConfig(guildId, configKey, parsed) {
  const dir = path.resolve('server-builder/configs', sanitizeFileName(guildId), configKey);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, parsed.fileName);
  await fs.writeFile(filePath, parsed.content, 'utf8');
  return path.relative(process.cwd(), filePath).replace(/\\/g, '/');
}

function sanitizeRequiredKey(value) {
  const key = sanitizeServerBuilderKey(value);
  if (!key) throw new ServerBuilderValidationError('Enter a Server Builder config key.');
  return key;
}

function sanitizeFileName(value) {
  const name = path.basename(String(value || 'server-builder.yaml')).replace(/[^a-zA-Z0-9._-]/g, '_');
  return name || 'server-builder.yaml';
}

function formatConfigRow(row) {
  return {
    id: row.id,
    guildId: row.guild_id,
    key: row.config_key,
    fileName: row.file_name,
    contentHash: row.content_hash,
    storagePath: row.storage_path,
    uploadedBy: row.uploaded_by,
    validationSummary: row.validation_summary || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatAjvError(error) {
  const pathLabel = error.instancePath || '(root)';
  if (error.keyword === 'additionalProperties') {
    return `${pathLabel} has unsupported property "${error.params.additionalProperty}".`;
  }
  return `${pathLabel} ${error.message}.`;
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()].filter(Boolean);
  return Object.values(collection).filter(Boolean);
}

function buildAuditReason(config, actor, mode) {
  const base = config.post_build?.audit_log_reason || `ThePurge Server Builder ${mode}`;
  const suffix = actor?.username || actor?.id ? ` by ${actor.username || actor.id}` : '';
  return `${base}${suffix}`.slice(0, 512);
}

function hashText(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function isHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || ''));
}

function roleSchema() {
  return {
    type: 'object',
    required: ['key', 'name'],
    additionalProperties: false,
    properties: {
      key: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1, maxLength: 100 },
      color: { type: 'string' },
      hoist: { type: 'boolean' },
      mentionable: { type: 'boolean' },
      position: { type: 'integer' },
      permissions: permissionSetSchema(),
    },
  };
}

function categorySchema() {
  return {
    type: 'object',
    required: ['key', 'name'],
    additionalProperties: false,
    properties: {
      key: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1, maxLength: 100 },
      position: { type: 'integer' },
      description: { type: 'string' },
      permission_overwrites: overwriteArraySchema(),
    },
  };
}

function channelSchema() {
  return {
    type: 'object',
    required: ['key', 'name', 'type'],
    additionalProperties: false,
    properties: {
      key: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1, maxLength: 100 },
      type: { type: 'string', enum: Object.keys(channelTypeByName) },
      category: { type: 'string' },
      position: { type: 'integer' },
      description: { type: 'string' },
      topic: { type: 'string' },
      nsfw: { type: 'boolean' },
      slowmode_seconds: { type: 'integer', minimum: 0, maximum: 21600 },
      user_limit: { type: 'integer', minimum: 0, maximum: 99 },
      bitrate: { type: 'integer', minimum: 8000 },
      default_auto_archive_duration_minutes: { type: 'integer' },
      default_reaction_emoji: { type: 'string' },
      available_tags: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 20 },
            emoji: { type: 'string' },
            moderated: { type: 'boolean' },
          },
        },
      },
      sync_permissions_with_category: { type: 'boolean' },
      permission_overwrites: overwriteArraySchema(),
    },
  };
}

function permissionSetSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      allow: permissionArraySchema(),
      deny: permissionArraySchema(),
    },
  };
}

function overwriteArraySchema() {
  return {
    type: 'array',
    items: {
      type: 'object',
      required: ['target'],
      additionalProperties: false,
      properties: {
        target: { type: 'string', minLength: 1 },
        allow: permissionArraySchema(),
        deny: permissionArraySchema(),
      },
    },
  };
}

function permissionArraySchema() {
  return {
    type: 'array',
    items: { type: 'string', minLength: 1 },
  };
}

function keyArraySchema() {
  return {
    type: 'array',
    items: { type: 'string', minLength: 1 },
  };
}
