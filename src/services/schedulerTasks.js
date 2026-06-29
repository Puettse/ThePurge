import { matchesMediaType } from './moderationService.js';

export async function purgeScheduledChannel(context, job) {
  const payload = job.payload || {};
  const channel = await context.client.channels.fetch(job.channel_id);
  const messages = await channel.messages.fetch({ limit: Math.min(Number(payload.limit || 100), 100) });
  const mediaType = payload.mediaType || 'all';
  const filtered = messages.filter((message) => matchesMediaType(message, mediaType));
  const results = await Promise.allSettled(filtered.map((message) => message.delete()));
  return results.filter((item) => item.status === 'fulfilled').length;
}
