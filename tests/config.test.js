import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PUBLIC_BASE_URL, getDiscordRedirectUri, loadConfig } from '../src/config.js';

test('loadConfig uses the ThePurge Railway domain as the dashboard fallback', () => {
  const config = loadConfig({}, { allowPartial: true });

  assert.equal(config.publicBaseUrl, DEFAULT_PUBLIC_BASE_URL);
  assert.equal(getDiscordRedirectUri(config), `${DEFAULT_PUBLIC_BASE_URL}/auth/callback`);
});

test('loadConfig still prefers explicit public dashboard URLs', () => {
  const config = loadConfig({ PUBLIC_BASE_URL: 'https://custom.example.com///' }, { allowPartial: true });

  assert.equal(config.publicBaseUrl, 'https://custom.example.com');
});

test('loadConfig normalizes optional Jellyfin API configuration', () => {
  const config = loadConfig({
    JELLYFIN_BASE_URL: 'https://media.example.com///',
    JELLYFIN_API_KEY: 'jellyfin-key',
  }, { allowPartial: true });

  assert.equal(config.jellyfinBaseUrl, 'https://media.example.com');
  assert.equal(config.jellyfinApiKey, 'jellyfin-key');
  assert.equal(config.jellyfinPublicBaseUrl, '');
  assert.equal(config.jellyfinEnablePlayLinks, false);
});

test('loadConfig separates Jellyfin sync URL from public playback URL', () => {
  const config = loadConfig({
    JELLYFIN_BASE_URL: 'https://goatskin-diffuser-fled.ngrok-free.dev///',
    JELLYFIN_PUBLIC_BASE_URL: 'https://entertainment.ebmsol.com///',
    JELLYFIN_ENABLE_PLAY_LINKS: 'true',
  }, { allowPartial: true });

  assert.equal(config.jellyfinBaseUrl, 'https://goatskin-diffuser-fled.ngrok-free.dev');
  assert.equal(config.jellyfinPublicBaseUrl, 'https://entertainment.ebmsol.com');
  assert.equal(config.jellyfinEnablePlayLinks, true);
});
