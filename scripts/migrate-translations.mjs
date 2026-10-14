import fs from 'fs';
import { neon } from '@neondatabase/serverless';

// Parse .env.local manually
const envPath = './.env.local';
let databaseUrl = '';
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    if (line.trim().startsWith('DATABASE_URL=')) {
      databaseUrl = line.split('DATABASE_URL=')[1].replace(/['"]/g, '').trim();
    }
  }
}
if (!databaseUrl) {
  console.error('DATABASE_URL not found in .env.local');
  process.exit(1);
}

const sql = neon(databaseUrl);

async function main() {
  // 1. Create translations table
  await sql`
    CREATE TABLE IF NOT EXISTS translations (
      id TEXT PRIMARY KEY,
      novel_url TEXT NOT NULL,
      url TEXT UNIQUE NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('[OK] translations table ready');

  // 0. Report current state
  const before = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE is_llm_translated = true)::int AS polished
    FROM chapters
  `;
  const existingTranslations = await sql`SELECT COUNT(*)::int AS n FROM translations`;
  console.log(`[STATE] chapters total=${before[0].total}, polished=${before[0].polished}, translations existing=${existingTranslations[0].n}`);

  // 2. Copy previously polished chapter content into translations (before restoring raw)
  const migrated = await sql`
    INSERT INTO translations (id, novel_url, url, title, content)
    SELECT md5(url), novel_url, url, title, content
    FROM chapters
    WHERE is_llm_translated = true
      AND original_content IS NOT NULL
      AND content IS NOT NULL
    ON CONFLICT (url) DO NOTHING
    RETURNING url
  `;
  console.log(`[OK] migrated ${migrated.length} polished chapters into translations`);

  // 3. Restore raw content back into chapters.content for those rows
  const restored = await sql`
    UPDATE chapters
    SET content = original_content,
        is_llm_translated = false
    WHERE is_llm_translated = true
      AND original_content IS NOT NULL
    RETURNING url
  `;
  console.log(`[OK] restored raw content for ${restored.length} chapters`);

  // 4. Final state
  const finalState = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM translations) AS translations,
      (SELECT COUNT(*)::int FROM chapters WHERE is_llm_translated = true) AS still_polished
  `;
  console.log(`[DONE] translations=${finalState[0].translations}, still_polished_rows=${finalState[0].still_polished}`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
