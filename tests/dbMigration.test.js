import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../src/db/index.js';

test('migrate backfills existing purge config columns before scheduled job copy', async () => {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(sql);
      return { rowCount: 0, rows: [] };
    },
  };

  await migrate(db);

  const migrationSql = queries.join('\n');
  assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS interval_seconds INTEGER DEFAULT 0/);
  assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS media_type TEXT DEFAULT 'all'/);
  assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS last_run TIMESTAMPTZ DEFAULT NOW\(\)/);
});
