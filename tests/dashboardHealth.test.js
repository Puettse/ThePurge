import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createHealthSnapshot } from '../src/web/routes/health.js';

test('dashboard health reports degraded startup when required config is missing', () => {
  const config = loadConfig({}, { allowPartial: true });
  const health = createHealthSnapshot({
    config,
    client: {
      isReady: () => false,
      user: null,
      guilds: { cache: { size: 0 } },
    },
    runtime: {
      database: { connected: false, error: null },
      discord: { commandsRegistered: false, error: null },
    },
  }, {
    isConfigured: () => false,
    missingConfig: () => ['CLIENT_SECRET'],
  });

  assert.equal(health.ok, false);
  assert.equal(health.config.ready, false);
  assert.deepEqual(health.config.missingRequired, ['BOT_TOKEN', 'DATABASE_URL', 'CLIENT_ID']);
  assert.equal(health.bot.ready, false);
  assert.equal(health.database.connected, false);
  assert.deepEqual(health.dashboard.missingConfig, ['CLIENT_SECRET']);
});
