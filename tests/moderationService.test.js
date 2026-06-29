import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchMessagesForPurge, matchesMediaType } from '../src/services/mediaService.js';

function fakeMessage({ attachments = 0, stickers = 0, content = '', embeds = [] }) {
  return {
    attachments: { size: attachments },
    stickers: { size: stickers },
    content,
    embeds,
  };
}

test('matchesMediaType detects attachments', () => {
  assert.equal(matchesMediaType(fakeMessage({ attachments: 1 }), 'attachments'), true);
  assert.equal(matchesMediaType(fakeMessage({ attachments: 0 }), 'attachments'), false);
});

test('matchesMediaType detects stickers, custom emojis, and gifs', () => {
  assert.equal(matchesMediaType(fakeMessage({ stickers: 1 }), 'stickers'), true);
  assert.equal(matchesMediaType(fakeMessage({ content: '<:ok:123>' }), 'emojis'), true);
  assert.equal(matchesMediaType(fakeMessage({ content: 'https://tenor.com/view/test' }), 'gifs'), true);
  assert.equal(matchesMediaType(fakeMessage({ embeds: [{ image: { url: 'https://cdn.example.com/thing.gif' } }] }), 'gifs'), true);
});

test('matchesMediaType all includes every media family', () => {
  assert.equal(matchesMediaType(fakeMessage({ content: 'image.gif' }), 'all'), true);
  assert.equal(matchesMediaType(fakeMessage({ content: 'plain text' }), 'all'), false);
});

test('fetchMessagesForPurge paginates up to the requested limit', async () => {
  const fetchedPages = [];
  const channel = {
    messages: {
      fetch: async ({ limit, before }) => {
        fetchedPages.push({ limit, before });
        const start = before ? Number(before) - 1 : 250;
        const values = Array.from({ length: Math.min(limit, start) }, (_, index) => ({
          id: String(start - index),
        }));
        return {
          size: values.length,
          values: () => values,
          last: () => values.at(-1),
        };
      },
    },
  };

  const messages = await fetchMessagesForPurge(channel, 225);

  assert.equal(messages.length, 225);
  assert.deepEqual(fetchedPages.map((page) => page.limit), [100, 100, 25]);
});
