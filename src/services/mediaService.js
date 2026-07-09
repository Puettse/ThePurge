import { PermissionsBitField } from 'discord.js';

const messageFetchPageSize = 100;

export async function fetchMessagesForPurge(channel, limit) {
  const requestedLimit = Math.min(Math.max(Number(limit || messageFetchPageSize), 1), 500);
  const collected = [];
  let before;

  while (collected.length < requestedLimit) {
    const page = await channel.messages.fetch({
      limit: Math.min(messageFetchPageSize, requestedLimit - collected.length),
      before,
    });

    if (page.size === 0) break;
    collected.push(...page.values());
    before = page.last()?.id;
    if (!before) break;
  }

  return collected;
}

export async function deleteMessagesIndividually(messages) {
  const results = await Promise.allSettled(messages.map((message) => message.delete()));
  return {
    attemptedCount: messages.length,
    deletedCount: results.filter((item) => item.status === 'fulfilled').length,
    failedCount: results.filter((item) => item.status === 'rejected').length,
  };
}

export function assertCanManageMessages(channel, user) {
  const permissions = channel.permissionsFor(user);
  if (!permissions?.has(PermissionsBitField.Flags.ManageMessages)) {
    throw new Error(`Missing Manage Messages permission in #${channel.name || channel.id}.`);
  }
}

export function matchesMediaType(message, mediaType) {
  if (mediaType === 'all') {
    return message.attachments.size > 0
      || message.stickers.size > 0
      || hasCustomEmoji(message)
      || hasGif(message);
  }

  if (mediaType === 'attachments') return message.attachments.size > 0;
  if (mediaType === 'stickers') return message.stickers.size > 0;
  if (mediaType === 'emojis') return hasCustomEmoji(message);
  if (mediaType === 'gifs') return hasGif(message);
  return false;
}

function hasCustomEmoji(message) {
  return /<a?:\w+:\d+>/.test(message.content || '');
}

function hasGif(message) {
  const content = message.content || '';
  const embedText = [...(message.embeds?.values?.() || message.embeds || [])]
    .flatMap((embed) => [
      embed.url,
      embed.image?.url,
      embed.thumbnail?.url,
      embed.provider?.url,
    ])
    .filter(Boolean)
    .join(' ');

  return /(tenor\.com|giphy\.com|\.gif\b)/i.test(`${content} ${embedText}`);
}
