import {
  assertCanManageMessages,
  deleteMessagesIndividually,
  fetchMessagesForPurge,
  matchesMediaType,
} from './mediaService.js';

export async function purgeScheduledChannel(context, job) {
  const payload = job.payload || {};
  const channel = await context.client.channels.fetch(job.channel_id);
  assertCanManageMessages(channel, context.client.user);
  const messages = await fetchMessagesForPurge(channel, Number(payload.limit || 100));
  const mediaType = payload.mediaType || 'all';
  const filtered = messages.filter((message) => matchesMediaType(message, mediaType));
  return deleteMessagesIndividually(filtered);
}
