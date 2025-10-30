import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Client } = pkg;
const db = new Client({ connectionString: process.env.DATABASE_URL });

const fix = async () => {
  try {
    await db.connect();
    console.log('✅ Connected to DB');

    await db.query(`
      ALTER TABLE purge_configs
      ADD COLUMN IF NOT EXISTS media_type TEXT DEFAULT 'all';
    `);

    await db.query(`
      ALTER TABLE purge_configs
      ADD COLUMN IF NOT EXISTS last_run TIMESTAMP DEFAULT NOW();
    `);

    console.log('🎉 Columns added successfully');
  } catch (err) {
    console.error('❌ Database fix failed:', err);
  } finally {
    await db.end();
  }
};

fix();
