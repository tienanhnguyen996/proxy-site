import { NextRequest, NextResponse } from 'next/server';
import { sql, pruneReadChapters } from '@/lib/db';
import { normalizeUrl } from '@/lib/utils';

export const preferredRegion = 'sin1';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { novelUrl, lastReadUrl, lastReadTitle, scrollPosition } = body;

    if (!novelUrl || !lastReadUrl) {
      return NextResponse.json(
        { error: 'Missing novelUrl or lastReadUrl' },
        { status: 400 }
      );
    }

    const normalizedNovelUrl = normalizeUrl(novelUrl);
    const normalizedLastReadUrl = normalizeUrl(lastReadUrl);

    await sql`
      UPDATE library
      SET 
        last_read_url = ${normalizedLastReadUrl},
        last_read_title = ${lastReadTitle || null},
        scroll_position = ${scrollPosition !== undefined ? Number(scrollPosition) : 0},
        updated_at = CURRENT_TIMESTAMP
      WHERE novel_url = ${normalizedNovelUrl}
    `;

    // Prune already-read chapters from the cache
    await pruneReadChapters(novelUrl, lastReadUrl);

    return NextResponse.json({ success: true, message: 'Reading progress updated' });
  } catch (error: any) {
    console.error('Error updating progress:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update progress' },
      { status: 500 }
    );
  }
}

