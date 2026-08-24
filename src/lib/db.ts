import { neon } from '@neondatabase/serverless';
import { normalizeUrl } from './utils';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not defined');
}

export const sql = neon(process.env.DATABASE_URL);

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

export default sql;

