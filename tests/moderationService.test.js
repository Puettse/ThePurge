import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesMediaType } from '../src/services/moderationService.js';

function fakeMessage({ attachments = 0, stickers = 0, content = '' }) {
  return {
    attachments: { size: attachments },
    stickers: { size: stickers },
    content,
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
});

test('matchesMediaType all includes every media family', () => {
  assert.equal(matchesMediaType(fakeMessage({ content: 'image.gif' }), 'all'), true);
  assert.equal(matchesMediaType(fakeMessage({ content: 'plain text' }), 'all'), false);
});
