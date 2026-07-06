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
