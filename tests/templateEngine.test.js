import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, suppressMassMentions } from '../src/services/templateEngine.js';

test('renderTemplate replaces known user, server, and channel variables', () => {
  const result = renderTemplate('Hi {user.mention} in {server.name} / {channel.mention}', {
    user: { id: '123', username: 'Seth' },
    guild: { id: '456', name: 'Test Guild' },
    channel: { id: '789', name: 'general' },
  });

  assert.equal(result, 'Hi <@123> in Test Guild / <#789>');
});

test('renderTemplate suppresses mass mentions by default', () => {
  const result = renderTemplate('hello @everyone and @here');
  assert.equal(result, 'hello @\u200beveryone and @\u200bhere');
});

test('suppressMassMentions can be tested directly', () => {
  assert.equal(suppressMassMentions('@everyone'), '@\u200beveryone');
});
