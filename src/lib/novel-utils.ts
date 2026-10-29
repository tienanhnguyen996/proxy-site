export function normalizeUrl(url: string): string {
  if (!url) return '';
  let normalized = url.trim();
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function getNovelBaseUrl(chapterUrl: string): string {
  if (!chapterUrl) return '';
  if (chapterUrl.startsWith('local://')) {
    const match = chapterUrl.match(/^(local:\/\/[a-f0-9]+)/);
    return match ? match[1] : chapterUrl.split('/').slice(0, 2).join('/');
  }

  try {
    const url = new URL(chapterUrl);
    if (url.hostname.includes('royalroad.com')) {
      const match = url.pathname.match(/^\/fiction\/(\d+)\/([^/]+)/);
      if (match) return `${url.origin}/fiction/${match[1]}/${match[2]}`;
    }

    const paths = url.pathname.split('/').filter(Boolean);
    if (paths.length > 0) {
      const last = paths[paths.length - 1];
      // Check for embedded chapter suffix like '-chap-123' or '-chuong-123' or '_chap_123'
      const matchEmbedded = last.match(/^(.*?)[-_](?:chap|chuong|chapter|tap)[-_]?\d+(?:\.html)?$/i);
      if (matchEmbedded && matchEmbedded[1]) {
        const novelSegment = matchEmbedded[1];
        const basePaths = [...paths.slice(0, -1), novelSegment];
        return `${url.origin}/${basePaths.join('/')}`;
      }
    }

    if (paths.length > 1) {
      const last = paths[paths.length - 1];
      if (
        /^(?:chuong|chapter|chap|tap)[-_]?\d+(?:\.html)?$/i.test(last) ||
        !isNaN(Number(last.replace(/\.html$/i, '')))
      ) {
        return `${url.origin}/${paths.slice(0, -1).join('/')}/`;
      }
    }

    return `${url.origin}/${paths.join('/')}/`;
  } catch {
    return chapterUrl;
  }
}

export function inferPrevNextFromUrl(chapterUrl: string): { prevUrl: string | null; nextUrl: string | null } {
  let inferredPrev: string | null = null;
  let inferredNext: string | null = null;
  try {
    const urlObj = new URL(chapterUrl);
    let path = urlObj.pathname;
    const hasTrailingSlash = path.endsWith('/');
    if (hasTrailingSlash) path = path.slice(0, -1);

    // Match patterns like /truyen-tranh/yeu-than-ky-746-chap-0 or /novel/chap-1.html or /chapter-12
    const match =
      path.match(/^(.*?(?:chap|chuong|chapter|tap)[-_]?)(\d+)(\.html)?$/i) ||
      path.match(/^(.*\/[^\d]*)(\d+)(\.html)?$/i);

    if (match) {
      const prefix = match[1];
      const numStr = match[2];
      const ext = match[3] || '';
      const chapNum = parseInt(numStr, 10);
      if (!isNaN(chapNum)) {
        if (chapNum > 0) {
          const prevNumStr = String(chapNum - 1).padStart(numStr.length, '0');
          inferredPrev = urlObj.origin + prefix + prevNumStr + ext + (hasTrailingSlash ? '/' : '');
        }
        const nextNumStr = String(chapNum + 1).padStart(numStr.length, '0');
        inferredNext = urlObj.origin + prefix + nextNumStr + ext + (hasTrailingSlash ? '/' : '');
      }
    }
  } catch {}
  return { prevUrl: inferredPrev, nextUrl: inferredNext };
}

export function getChapterNumber(url: string, title?: string): number | null {
  if (!url) return null;
  const norm = url.trim();
  const urlMatch = norm.match(/(?:chap|chuong|chapter|tap)[-_]?(\d+(?:\.\d+)?)/i);
  if (urlMatch) {
    const val = parseFloat(urlMatch[1]);
    if (!isNaN(val)) return val;
  }
  if (title) {
    const titleMatch = title.match(/(?:chap|chuong|chapter|tap|tập|chương)\s*(\d+(?:\.\d+)?)/i);
    if (titleMatch) {
      const val = parseFloat(titleMatch[1]);
      if (!isNaN(val)) return val;
    }
  }
  const endMatch = norm.match(/(\d+)(?:\.html)?$/);
  if (endMatch) {
    const val = parseFloat(endMatch[1]);
    if (!isNaN(val)) return val;
  }
  return null;
}

export function sortChaptersAscending<T extends { url: string; title?: string }>(chapters: T[]): T[] {
  if (!chapters || chapters.length <= 1) return chapters;

  // Deduplicate by normalized URL first while preserving order
  const seenUrls = new Set<string>();
  const uniqueChapters: T[] = [];
  for (const ch of chapters) {
    const norm = normalizeUrl(ch.url);
    if (!seenUrls.has(norm)) {
      seenUrls.add(norm);
      uniqueChapters.push(ch);
    }
  }

  if (uniqueChapters.length <= 1) return uniqueChapters;

  // Count how many items have valid numeric chapter numbers
  let validCount = 0;
  const withNumbers = uniqueChapters.map((ch, originalIndex) => {
    const num = getChapterNumber(ch.url, ch.title);
    if (num !== null) validCount++;
    return { ch, num, originalIndex };
  });

  // If at least 60% of chapters have parseable chapter numbers, sort numerically ascending
  if (validCount >= uniqueChapters.length * 0.6) {
    withNumbers.sort((a, b) => {
      if (a.num !== null && b.num !== null) {
        if (a.num !== b.num) return a.num - b.num;
        return a.originalIndex - b.originalIndex;
      }
      if (a.num !== null) return -1;
      if (b.num !== null) return 1;
      return a.originalIndex - b.originalIndex;
    });
    return withNumbers.map((x) => x.ch);
  }

  let firstNum: number | null = null;
  for (let i = 0; i < Math.min(5, uniqueChapters.length); i++) {
    const n = getChapterNumber(uniqueChapters[i].url, uniqueChapters[i].title);
    if (n !== null) {
      firstNum = n;
      break;
    }
  }

  let lastNum: number | null = null;
  for (let i = uniqueChapters.length - 1; i >= Math.max(0, uniqueChapters.length - 5); i--) {
    const n = getChapterNumber(uniqueChapters[i].url, uniqueChapters[i].title);
    if (n !== null) {
      lastNum = n;
      break;
    }
  }

  if (firstNum !== null && lastNum !== null && firstNum > lastNum) {
    return [...uniqueChapters].reverse();
  }

  return uniqueChapters;
}

/**
 * Deduplicate repeated paragraphs or scrambled duplicate blocks often found in web novel scrapers.
 * Preserves short dialogue / interjections unless they form part of a repeating block.
 */
/**
 * Deduplicate repeated paragraphs or scrambled duplicate blocks often found in web novel scrapers.
 * Preserves short dialogue / interjections unless they form part of a repeating block.
 */
export function deduplicateParagraphs(html: string): string {
  if (!html || typeof html !== 'string') return html;
  if (html.includes('manga-viewer') || html.includes('class="manga-img')) return html;

  // Match all <p ...>...</p> tags
  const pRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  const matches: { full: string; inner: string; index: number; length: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = pRegex.exec(html)) !== null) {
    matches.push({
      full: m[0],
      inner: m[1],
      index: m.index,
      length: m[0].length,
    });
  }

  if (matches.length < 4) return html;

  const getText = (str: string): string =>
    str
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const paraTexts: string[] = matches.map((item) => getText(item.inner));
  const seenTexts = new Set<string>();
  const removeIndices = new Set<number>();

  for (let i = 0; i < matches.length; i++) {
    const text = paraTexts[i];
    if (!text) continue;

    // Substantial text (>= 30 characters) already seen earlier in chapter
    if (text.length >= 30 && seenTexts.has(text)) {
      removeIndices.add(i);
      continue;
    }

    // Shorter text (< 30 characters) already seen, BUT adjacent to another duplicate
    if (seenTexts.has(text)) {
      const prevIsDupe = i > 0 && removeIndices.has(i - 1);
      const nextText = i + 1 < paraTexts.length ? paraTexts[i + 1] : '';
      const nextIsDupe = nextText ? seenTexts.has(nextText) : false;
      if (prevIsDupe || nextIsDupe) {
        removeIndices.add(i);
        continue;
      }
    }

    seenTexts.add(text);
  }

  if (removeIndices.size === 0) return html;

  let lastEnd = 0;
  let result = '';
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    result += html.slice(lastEnd, match.index);
    if (!removeIndices.has(i)) {
      result += match.full;
    }
    lastEnd = match.index + match.length;
  }
  result += html.slice(lastEnd);

  return result;
}

/**
 * Cleans excessive non-breaking spaces and leading/trailing indentation from HTML paragraphs
 * (common in raw novel sites like metruyenhotvn that insert 10-12 &nbsp; per paragraph).
 */
export function cleanParagraphSpacing(html: string): string {
  if (!html) return '';
  return html
    .replace(/(<p[^>]*>)(?:[\s\u00a0]|&nbsp;|&#160;)+/gi, '$1')
    .replace(/(?:[\s\u00a0]|&nbsp;|&#160;)+(<\/p>)/gi, '$1')
    .replace(/<p[^>]*>(?:[\s\u00a0]|&nbsp;|&#160;)*<\/p>/gi, '');
}
