import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import crypto from 'crypto';

export const preferredRegion = 'sin1';

// Chapter detection patterns (Vietnamese + English)
const CHAPTER_PATTERNS = [
  // Vietnamese: "Chương 123", "Chương 123:", "Chương 123 -"
  /(?:^|\n)\s*(?:Chương|CHƯƠNG|Chương)\s+(\d+)(?:\s*[:\-–—]|\.?\s*\n)/im,
  // English: "Chapter 123", "CHAPTER 123"
  /(?:^|\n)\s*(?:Chapter|CHAPTER)\s+(\d+)(?:\s*[:\-–—]|\.?\s*\n)/im,
  // Short: "Ch. 123", "Ch 123"
  /(?:^|\n)\s*(?:Ch\.?|chap\.?)\s+(\d+)(?:\s*[:\-–—]|\.?\s*\n)/im,
  // "123." at start of line (common in raw text)
  /(?:^|\n)\s*(\d{1,4})\.\s*\n/im,
  // "Tập 123" (Vietnamese volume)
  /(?:^|\n)\s*(?:Tập|TẬP)\s+(\d+)(?:\s*[:\-–—]|\.?\s*\n)/im,
];

/**
 * Try to detect chapter boundaries in text.
 * Returns an array of { title, content } objects, or null if no chapters found.
 */
function detectChapters(text: string): { title: string; content: string }[] | null {
  // Find all chapter boundaries
  const boundaries: { index: number; title: string; number: number }[] = [];

  for (const pattern of CHAPTER_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const titleMatch = match[0].trim().split('\n')[0].trim();
      const num = match[1] ? parseInt(match[1]) : 0;
      boundaries.push({ index: start, title: titleMatch, number: num });
    }
  }

  if (boundaries.length < 2) return null;

  // Sort by position and deduplicate
  boundaries.sort((a, b) => a.index - b.index);
  const unique = boundaries.filter((b, i) => i === 0 || b.index !== boundaries[i - 1].index);
  if (unique.length < 2) return null;

  // Extract chapters
  const chapters: { title: string; content: string }[] = [];
  for (let i = 0; i < unique.length; i++) {
    const start = unique[i].index;
    const end = i + 1 < unique.length ? unique[i + 1].index : text.length;
    const content = text.slice(start, end).trim();
    if (content.length > 0) {
      chapters.push({ title: unique[i].title, content });
    }
  }

  return chapters;
}

/**
 * Split text into batches of approximately maxChars size, splitting on paragraph boundaries.
 */
function splitIntoBatches(text: string, maxChars: number = 5000): { title: string; content: string }[] {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const batches: { title: string; content: string }[] = [];
  let currentBatch: string[] = [];
  let currentSize = 0;
  let batchNum = 1;

  for (const para of paragraphs) {
    if (currentSize + para.length > maxChars && currentBatch.length > 0) {
      batches.push({
        title: `Part ${batchNum}`,
        content: currentBatch.join('\n\n').trim()
      });
      batchNum++;
      currentBatch = [];
      currentSize = 0;
    }
    currentBatch.push(para);
    currentSize += para.length;
  }

  if (currentBatch.length > 0) {
    batches.push({
      title: `Part ${batchNum}`,
      content: currentBatch.join('\n\n').trim()
    });
  }

  return batches;
}

async function readFileText(file: File): Promise<string> {
  // Try native .text() first (modern runtimes)
  if (typeof file.text === 'function') {
    return await file.text();
  }
  // Fallback: read as ArrayBuffer then decode
  const buffer = await file.arrayBuffer();
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(buffer);
}

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let title: string;
    let text: string;

    if (contentType.includes('application/json')) {
      const body = await request.json();
      text = body.text as string;
      title = (body.title as string) || 'Untitled Book';
    } else {
      // Legacy FormData support
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      title = (formData.get('title') as string) || 'Untitled Book';

      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }

      if (file.size === 0) {
        return NextResponse.json({ error: 'File is empty' }, { status: 400 });
      }

      text = await readFileText(file);
    }

    if (!text || text.trim().length === 0) {
      return NextResponse.json({ error: 'File is empty' }, { status: 400 });
    }

    // Try to detect chapters
    let chapters = detectChapters(text);
    if (!chapters || chapters.length < 2) {
      // Fall back to batch splitting
      chapters = splitIntoBatches(text);
    }

    // Create a unique novel URL for this uploaded book
    const bookId = crypto.randomBytes(8).toString('hex');
    const novelUrl = `local://${bookId}`;

    // Build chapters list and store content
    const chaptersList: { title: string; url: string }[] = [];

    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      const chapterUrl = `${novelUrl}/chapter-${i + 1}`;
      chaptersList.push({ title: ch.title, url: chapterUrl });

      // Store each chapter in the chapters table
      const chapterId = crypto.createHash('md5').update(chapterUrl).digest('hex');
      const htmlContent = ch.content
        .split(/\n\s*\n/)
        .filter(p => p.trim())
        .map(p => `<p>${p.trim().replace(/\n/g, '<br/>')}</p>`)
        .join('\n');

      await sql`
        INSERT INTO chapters (id, novel_url, url, title, content, next_url, prev_url)
        VALUES (
          ${chapterId},
          ${novelUrl},
          ${chapterUrl},
          ${ch.title},
          ${htmlContent},
          ${i + 1 < chapters.length ? `${novelUrl}/chapter-${i + 2}` : null},
          ${i > 0 ? `${novelUrl}/chapter-${i}` : null}
        )
        ON CONFLICT (url) DO UPDATE SET
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          next_url = EXCLUDED.next_url,
          prev_url = EXCLUDED.prev_url
      `;
    }

    // Add to library
    const normalizedNovelUrl = novelUrl;
    const libId = crypto.createHash('md5').update(normalizedNovelUrl).digest('hex');

    await sql`
      INSERT INTO library (id, novel_url, title, author, cover_url, site_name, total_chapters, chapters_list, updated_at)
      VALUES (
        ${libId},
        ${normalizedNovelUrl},
        ${title},
        ${null},
        ${null},
        ${'Local Upload'},
        ${chaptersList.length},
        ${JSON.stringify(chaptersList)},
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (novel_url) DO UPDATE SET
        title = EXCLUDED.title,
        total_chapters = EXCLUDED.total_chapters,
        chapters_list = EXCLUDED.chapters_list,
        updated_at = CURRENT_TIMESTAMP
    `;

    return NextResponse.json({
      success: true,
      message: `Uploaded "${title}" with ${chaptersList.length} chapters`,
      novel_url: novelUrl,
      chapter_count: chaptersList.length,
      first_chapter_url: chaptersList.length > 0 ? chaptersList[0].url : null
    });
  } catch (error: unknown) {
    console.error('Error uploading file:', error);
    const errorMsg = error instanceof Error ? error.message : 'Failed to upload file';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
