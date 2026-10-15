'use client';

/**
 * Client-side chapter detection for uploaded text files (stored in IndexedDB).
 * Mirrors the server logic so local books never need a server round-trip.
 */

const CHAPTER_PATTERNS = [
  /(?:^|\n)\s*(?:Chương|CHƯƠNG|Chương)\s+(\d+)(?:\s*[:\-–—]|\.?\s*\n)/gim,
  /(?:^|\n)\s*(?:Chapter|CHAPTER)\s+(\d+)(?:\s*[:\-–—]|\.?\s*\n)/gim,
  /(?:^|\n)\s*(?:Ch\.?|chap\.?)\s+(\d+)(?:\s*[:\-–—]|\.?\s*\n)/gim,
  /(?:^|\n)\s*(\d{1,4})\.\s*\n/gim,
  /(?:^|\n)\s*(?:Tập|TẬP)\s+(\d+)(?:\s*[:\-–—]|\.?\s*\n)/gim,
];

export function detectChapters(text: string): { title: string; content: string }[] | null {
  const boundaries: { index: number; title: string; number: number }[] = [];

  for (const pattern of CHAPTER_PATTERNS) {
    const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
    const regex = new RegExp(pattern.source, flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      let actualStart = match.index;
      while (actualStart < text.length && (text[actualStart] === '\n' || text[actualStart] === '\r')) {
        actualStart++;
      }
      const lineEnd = text.indexOf('\n', actualStart);
      const titleMatch = (lineEnd === -1 ? text.slice(actualStart) : text.slice(actualStart, lineEnd)).trim();
      const num = match[1] ? parseInt(match[1]) : 0;
      boundaries.push({ index: actualStart, title: titleMatch, number: num });
      if (regex.lastIndex === match.index) {
        regex.lastIndex++;
      }
    }
  }

  if (boundaries.length < 2) return null;

  boundaries.sort((a, b) => a.index - b.index);
  const unique = boundaries.filter((b, i) => i === 0 || b.index !== boundaries[i - 1].index);
  if (unique.length < 2) return null;

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

export function splitIntoBatches(text: string, maxChars: number = 5000): { title: string; content: string }[] {
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

export function textToHtml(content: string): string {
  return content
    .split(/\n\s*\n/)
    .filter(p => p.trim())
    .map(p => `<p>${p.trim().replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
}
