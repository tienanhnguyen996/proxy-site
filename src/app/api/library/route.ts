import { NextRequest, NextResponse } from 'next/server';
import { sql, pruneReadChapters, shouldUpdateProgress } from '@/lib/db';
import { getUrlId, normalizeUrl } from '@/lib/utils';

export const preferredRegion = 'sin1';


// GET: Fetch all books in the library or check a specific book
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const novelUrl = searchParams.get('novel_url');

    if (novelUrl) {
      const normalizedNovelUrl = normalizeUrl(novelUrl);
      const books = await sql`
        SELECT id, novel_url, title, author, cover_url, site_name, total_chapters, last_read_url, last_read_title, scroll_position, updated_at
        FROM library 
        WHERE novel_url = ${normalizedNovelUrl}
        LIMIT 1
      `;
      return NextResponse.json(books.length > 0 ? books[0] : null);
    }

    const includeChapters = searchParams.get('include_chapters') === 'true';
    if (includeChapters) {
      const books = await sql`
        SELECT * FROM library 
        ORDER BY updated_at DESC
      `;
      return NextResponse.json(books);
    } else {
      const books = await sql`
        SELECT id, novel_url, title, author, cover_url, site_name, total_chapters, last_read_url, last_read_title, scroll_position, updated_at
        FROM library 
        ORDER BY updated_at DESC
      `;
      return NextResponse.json(books);
    }
  } catch (error: unknown) {
    console.error('Error fetching library:', error);
    const errorMsg = error instanceof Error ? error.message : 'Failed to fetch library';
    return NextResponse.json(
      { error: errorMsg },
      { status: 500 }
    );
  }
}

// POST: Add a book to library or update progress
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      action, // 'add' or 'progress'
      novel_url, 
      title, 
      author, 
      cover_url, 
      site_name, 
      chapters_list,
      last_read_url,
      last_read_title,
      scroll_position
    } = body;

    if (!novel_url) {
      return NextResponse.json(
        { error: 'Missing novel_url' },
        { status: 400 }
      );
    }

    const normalizedNovelUrl = normalizeUrl(novel_url);

    if (action === 'add') {
      if (!title) {
        return NextResponse.json(
          { error: 'Missing title for adding novel' },
          { status: 400 }
        );
      }
      
      const id = getUrlId(normalizedNovelUrl);
      
      let normalizedChaptersList = '[]';
      let chaptersCount = 0;
      if (chapters_list) {
        try {
          const list = JSON.parse(chapters_list);
          if (Array.isArray(list)) {
            const normalizedList = list.map((ch: { url: string }) => ({
              ...ch,
              url: normalizeUrl(ch.url)
            }));
            normalizedChaptersList = JSON.stringify(normalizedList);
            chaptersCount = normalizedList.length;
          }
        } catch (e) {
          console.error('Failed to parse chapters_list', e);
        }
      }

      await sql`
        INSERT INTO library (id, novel_url, title, author, cover_url, site_name, total_chapters, chapters_list, updated_at)
        VALUES (
          ${id}, 
          ${normalizedNovelUrl}, 
          ${title}, 
          ${author || null}, 
          ${cover_url || null}, 
          ${site_name || null}, 
          ${chaptersCount}, 
          ${normalizedChaptersList},
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (novel_url) DO UPDATE SET
          title = EXCLUDED.title,
          author = COALESCE(EXCLUDED.author, library.author),
          cover_url = COALESCE(EXCLUDED.cover_url, library.cover_url),
          total_chapters = EXCLUDED.total_chapters,
          chapters_list = EXCLUDED.chapters_list,
          updated_at = CURRENT_TIMESTAMP
      `;

      return NextResponse.json({ success: true, message: 'Novel added/updated in library' });
    } 
    
    if (action === 'progress') {
      if (last_read_url) {
        const shouldUpdate = await shouldUpdateProgress(novel_url, last_read_url);
        if (!shouldUpdate) {
          return NextResponse.json({ success: true, message: 'Ignored older progress update' });
        }
      }

      const normalizedLastReadUrl = last_read_url ? normalizeUrl(last_read_url) : null;
      await sql`
        UPDATE library
        SET 
          last_read_url = ${normalizedLastReadUrl},
          last_read_title = ${last_read_title || null},
          scroll_position = ${scroll_position !== undefined ? Number(scroll_position) : 0},
          updated_at = CURRENT_TIMESTAMP
        WHERE novel_url = ${normalizedNovelUrl}
      `;

      if (last_read_url) {
        await pruneReadChapters(novel_url, last_read_url);
      }

      return NextResponse.json({ success: true, message: 'Reading progress updated' });
    }

    return NextResponse.json(
      { error: 'Invalid action. Must be "add" or "progress"' },
      { status: 400 }
    );
  } catch (error: unknown) {
    console.error('Error modifying library:', error);
    const errorMsg = error instanceof Error ? error.message : 'Failed to update library';
    return NextResponse.json(
      { error: errorMsg },
      { status: 500 }
    );
  }
}

// DELETE: Delete a book and its cached chapters
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const novel_url = searchParams.get('novel_url');

    if (!novel_url) {
      return NextResponse.json(
        { error: 'Missing novel_url parameter' },
        { status: 400 }
      );
    }

    const normalizedNovelUrl = normalizeUrl(novel_url);

    // 1. Delete all cached chapters belonging to this novel
    try {
      await sql`
        DELETE FROM chapters 
        WHERE novel_url = ${normalizedNovelUrl}
      `;
    } catch (chDelErr) {
      console.error('Error deleting chapters from DB cache:', chDelErr);
    }

    // 2. Delete the library record
    await sql`
      DELETE FROM library 
      WHERE novel_url = ${normalizedNovelUrl}
    `;

    return NextResponse.json({ 
      success: true, 
      message: 'Novel and cached chapters deleted successfully' 
    });
  } catch (error: unknown) {
    console.error('Error deleting library entry:', error);
    const errorMsg = error instanceof Error ? error.message : 'Failed to delete from library';
    return NextResponse.json(
      { error: errorMsg },
      { status: 500 }
    );
  }
}
