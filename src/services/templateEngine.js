const maxOutputLength = 1800;

export function renderTemplate(template, context = {}, options = {}) {
  const values = buildValues(context);
  const rendered = String(template || '').replace(/\{([a-zA-Z0-9_.]+)\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
  });

  const safe = options.allowMentions ? rendered : suppressMassMentions(rendered);
  return safe.slice(0, maxOutputLength);
}

export function suppressMassMentions(value) {
  return String(value || '')
    .replace(/@everyone/g, '@\u200beveryone')
    .replace(/@here/g, '@\u200bhere');
}

function buildValues(context) {
  const user = context.user || context.member?.user || {};
  const guild = context.guild || {};
  const channel = context.channel || {};

  return {
    user: user.username || user.tag || user.id || 'user',
    'user.id': user.id || '',
    'user.name': user.username || user.tag || '',
    'user.username': user.username || '',
    'user.mention': user.id ? `<@${user.id}>` : '',
    server: guild.name || guild.id || 'server',
    'server.id': guild.id || '',
    'server.name': guild.name || '',
    'server.member_count': String(guild.memberCount || ''),
    channel: channel.name ? `#${channel.name}` : '',
    'channel.id': channel.id || '',
    'channel.name': channel.name || '',
    'channel.mention': channel.id ? `<#${channel.id}>` : '',
    level: String(context.level ?? ''),
    balance: String(context.balance ?? ''),
  };
}
