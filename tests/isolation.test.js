import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveButtonHandler, resolveCommandHandler } from '../src/bot/handlers/index.js';

test('unknown command handlers resolve without importing feature modules', async () => {
  assert.equal(await resolveCommandHandler('missing-command'), null);
});

test('unknown button namespaces fail at the boundary', async () => {
  await assert.rejects(
    () => resolveButtonHandler('missing-button'),
    /Unknown button namespace/,
  );
});
