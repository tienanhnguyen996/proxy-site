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
