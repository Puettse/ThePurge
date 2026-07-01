import test from 'node:test';
import assert from 'node:assert/strict';
import { createMovieSelectionResponse } from '../src/bot/handlers/catalog.js';

test('catalog movie response omits Jellyfin button when playback links are disabled', () => {
  const response = createMovieSelectionResponse(movie({ playUrl: '' }));

  assert.equal(response.ephemeral, true);
  assert.equal(response.components.length, 0);
});

test('catalog movie response includes Jellyfin button when playback links are enabled', () => {
  const response = createMovieSelectionResponse(movie({
    playUrl: 'https://entertainment.ebmsol.com/web/#/details?id=movie-1',
  }));

  assert.equal(response.ephemeral, true);
  assert.equal(response.components.length, 1);
});

function movie(overrides = {}) {
  return {
    id: 'movie-1',
    name: 'Alpha',
    overview: '',
    productionYear: 2001,
    runtimeMinutes: 120,
    genres: ['Action'],
    ...overrides,
  };
}
