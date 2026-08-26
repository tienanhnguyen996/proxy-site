#!/usr/bin/env node
/**
 * Migration: Create replace_rules table for text replacement rules.
 * Scopes: global, book, chapter
 */
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local
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
  console.log('Creating replace_rules table...');

  await sql`
    CREATE TABLE IF NOT EXISTS replace_rules (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'global',
      scope_value TEXT,
      find_text TEXT NOT NULL,
      replace_with TEXT NOT NULL,
      is_regex BOOLEAN DEFAULT FALSE,
      is_enabled BOOLEAN DEFAULT TRUE,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_replace_rules_scope
    ON replace_rules (scope, scope_value)
  `;

  console.log('Migration complete. replace_rules table created.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
