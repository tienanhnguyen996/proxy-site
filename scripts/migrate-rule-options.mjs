#!/usr/bin/env node
/**
 * Migration: Add case_sensitive and ignore_accents columns to replace_rules.
 */
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
try {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([A-Z_]+)\s*=\s*(.*)$/);
    if (match) {
      const key = match[1];
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
} catch {}

const sql = neon(process.env.DATABASE_URL);

async function migrate() {
  console.log('Adding case_sensitive and ignore_accents columns to replace_rules...');

  await sql`
    ALTER TABLE replace_rules
    ADD COLUMN IF NOT EXISTS case_sensitive BOOLEAN DEFAULT FALSE
  `;

  await sql`
    ALTER TABLE replace_rules
    ADD COLUMN IF NOT EXISTS ignore_accents BOOLEAN DEFAULT FALSE
  `;

  console.log('Migration complete.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
