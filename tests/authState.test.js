import test from 'node:test';
import assert from 'node:assert/strict';
import { createOAuthState, OAUTH_STATE_TTL_MS, verifyOAuthState } from '../src/web/auth.js';

test('OAuth state verifies without a browser cookie', () => {
  const state = createOAuthState('test-secret', 1_000);

  assert.equal(verifyOAuthState('test-secret', state, 1_500), true);
});

test('OAuth state rejects tampering and expired callbacks', () => {
  const state = createOAuthState('test-secret', 1_000);
  const [payload] = state.split('.');

  assert.equal(verifyOAuthState('test-secret', `${payload}.bad-signature`, 1_500), false);
  assert.equal(verifyOAuthState('wrong-secret', state, 1_500), false);
  assert.equal(verifyOAuthState('test-secret', state, 1_000 + OAUTH_STATE_TTL_MS + 1), false);
});
