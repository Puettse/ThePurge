import test from 'node:test';
import assert from 'node:assert/strict';
import { commandData } from '../src/bot/commands.js';

test('all planned public commands are registered', () => {
  const names = commandData.map((command) => command.name).sort();

  assert.deepEqual(names, [
    'automod',
    'autorole',
    'custom-command',
    'dashboard',
    'economy',
    'invite',
    'logs',
    'mod',
    'purge',
    'rank',
    'schedule',
    'setup',
    'ticket',
    'welcome',
  ]);
});

test('schedule command includes recurring purge support', () => {
  const schedule = commandData.find((command) => command.name === 'schedule');
  const subcommands = schedule.options.map((option) => option.name).sort();

  assert.deepEqual(subcommands, ['list', 'message', 'purge']);
});
