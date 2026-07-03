import { neon } from '@neondatabase/serverless';
import { normalizeUrl } from './utils';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not defined');
}

export const sql = neon(process.env.DATABASE_URL);

/**
 * Prunes cached chapters from the database that are before the current reading position.
 */
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
    const currentIndex = chaptersList.findIndex((ch: any) => normalizeUrl(ch.url) === normalizedLastReadUrl);
    if (currentIndex <= 0) return; // If not found, or it's the first chapter, nothing to prune

    // 3. Get all read chapter URLs (everything before the current index)
    const readUrls = chaptersList.slice(0, currentIndex).map((ch: any) => normalizeUrl(ch.url));
    if (readUrls.length === 0) return;

    // 4. Delete read chapters from DB cache
    console.log(`[PRUNE] Deleting ${readUrls.length} read chapters for novel: ${normalizedNovelUrl}`);
    await sql`
      DELETE FROM chapters 
      WHERE novel_url = ${normalizedNovelUrl} 
        AND url = ANY(${readUrls})
    `;
  } catch (err) {
    console.error('Failed to prune read chapters:', err);
  }
}

export default sql;

