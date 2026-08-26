import { neon } from '@neondatabase/serverless';
import { normalizeUrl } from './utils';

const connectionString =
  process.env.DATABASE_URL ||
  process.env.NEON_DATABASE_URL ||
  process.env.NEON_POSTGRES_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not defined');
}

export const sql = neon(connectionString);

export async function pruneReadChapters(novelUrl: string, lastReadUrl: string) {
  try {
    const normalizedNovelUrl = normalizeUrl(novelUrl);
    const normalizedLastReadUrl = normalizeUrl(lastReadUrl);

    // 1. Fetch the chapter list
    const libRows = await sql`
      SELECT chapters_list FROM library WHERE novel_url = ${normalizedNovelUrl} LIMIT 1
    `;
    if (libRows.length === 0 || !libRows[0].chapters_list) return;

    const chaptersList = JSON.parse(libRows[0].chapters_list);
    if (!Array.isArray(chaptersList) || chaptersList.length === 0) return;

    // 2. Find index of current chapter
    const currentIndex = chaptersList.findIndex((ch: { url: string }) => normalizeUrl(ch.url) === normalizedLastReadUrl);
    if (currentIndex === -1) return;

    // 3. Get read chapter URLs to prune (everything before the current chapter)
    const readUrls = chaptersList.slice(0, currentIndex).map((ch: { url: string }) => normalizeUrl(ch.url));
    if (readUrls.length === 0) return;

    // 4. Delete read chapters from DB cache (only if older than 7 days; AI translations live in a separate table and are kept)
    console.log(`[PRUNE] Deleting stale read chapters (older than 7 days) for novel: ${normalizedNovelUrl}`);
    await sql`
      DELETE FROM chapters 
      WHERE novel_url = ${normalizedNovelUrl} 
        AND url = ANY(${readUrls})
        AND created_at < NOW() - INTERVAL '7 days'
    `;
  } catch (err) {
    console.error('Failed to prune read chapters:', err);
  }
}

/**
 * Determines whether the incoming reading progress is newer than or equal to the existing database progress.
 * Returns true if:
 * 1. The novel does not exist in the library yet.
 * 2. The database has no existing progress (last_read_url is null).
 * 3. The incoming chapter is the same as the database's last_read_url.
 * 4. The incoming chapter is further down in the chapters_list than the database's last_read_url.
 * Returns false otherwise.
 */
export async function shouldUpdateProgress(novelUrl: string, incomingLastReadUrl: string): Promise<boolean> {
  try {
    const normalizedNovelUrl = normalizeUrl(novelUrl);
    const normalizedIncomingUrl = normalizeUrl(incomingLastReadUrl);

    const rows = await sql`
      SELECT last_read_url, chapters_list
      FROM library
      WHERE novel_url = ${normalizedNovelUrl}
      LIMIT 1
    `;

    if (rows.length === 0) return true;
    const { last_read_url: dbLastReadUrl, chapters_list: dbChaptersListStr } = rows[0];

    if (!dbLastReadUrl || !dbChaptersListStr) return true;

    const normalizedDbLastReadUrl = normalizeUrl(dbLastReadUrl);
    if (normalizedDbLastReadUrl === normalizedIncomingUrl) return true;

    const chaptersList = JSON.parse(dbChaptersListStr);
    if (!Array.isArray(chaptersList) || chaptersList.length === 0) return true;

    const dbIndex = chaptersList.findIndex((ch: { url: string }) => normalizeUrl(ch.url) === normalizedDbLastReadUrl);
    const incomingIndex = chaptersList.findIndex((ch: { url: string }) => normalizeUrl(ch.url) === normalizedIncomingUrl);

    // If both are found, make sure the incoming one is not older
    if (dbIndex !== -1 && incomingIndex !== -1) {
      return incomingIndex >= dbIndex;
    }

    // Fallback: if one is not found in the chapters list, allow progress update
    return true;
  } catch (err) {
    console.error('Error in shouldUpdateProgress check:', err);
    return true; // Fallback to allowing in case of error
  }
}

/**
 * Fetch all enabled replace rules for a given scope.
 * Returns rules ordered by scope priority (chapter > book > global) then sort_order.
 */
export async function getReplaceRules(
  scope: 'global' | 'book' | 'chapter',
  scopeValue?: string
): Promise<{ find_text: string; replace_with: string; is_regex: boolean }[]> {
  try {
    type RuleRow = { find_text: string; replace_with: string; is_regex: boolean };
    let rules: RuleRow[];
    if (scope === 'chapter' && scopeValue) {
      rules = await sql`
        SELECT find_text, replace_with, is_regex
        FROM replace_rules
        WHERE is_enabled = TRUE
          AND (
            (scope = 'global')
            OR (scope = 'book' AND scope_value = ${scopeValue})
            OR (scope = 'chapter' AND scope_value = ${scopeValue})
          )
        ORDER BY
          CASE scope WHEN 'chapter' THEN 0 WHEN 'book' THEN 1 WHEN 'global' THEN 2 END,
          sort_order
      ` as RuleRow[];
    } else if (scope === 'book' && scopeValue) {
      rules = await sql`
        SELECT find_text, replace_with, is_regex
        FROM replace_rules
        WHERE is_enabled = TRUE
          AND (
            (scope = 'global')
            OR (scope = 'book' AND scope_value = ${scopeValue})
          )
        ORDER BY
          CASE scope WHEN 'book' THEN 0 WHEN 'global' THEN 1 END,
          sort_order
      ` as RuleRow[];
    } else {
      rules = await sql`
        SELECT find_text, replace_with, is_regex
        FROM replace_rules
        WHERE is_enabled = TRUE AND scope = 'global'
        ORDER BY sort_order
      ` as RuleRow[];
    }
    return rules;
  } catch (err) {
    console.error('Failed to fetch replace rules:', err);
    return [];
  }
}

/**
 * Apply replace rules to HTML content string.
 */
export function applyReplaceRules(
  html: string,
  rules: { find_text: string; replace_with: string; is_regex: boolean }[]
): string {
  let result = html;
  for (const rule of rules) {
    try {
      if (rule.is_regex) {
        const regex = new RegExp(rule.find_text, 'gi');
        result = result.replace(regex, rule.replace_with);
      } else {
        // Simple string replacement (case-insensitive)
        const escaped = rule.find_text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'gi');
        result = result.replace(regex, rule.replace_with);
      }
    } catch (e) {
      console.error(`Failed to apply replace rule "${rule.find_text}":`, e);
    }
  }
  return result;
}

export default sql;

