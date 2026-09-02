import { NextRequest, NextResponse } from 'next/server';
import { sql, getReplaceRules, applyReplaceRules } from '@/lib/db';
import { getUrlId, normalizeUrl } from '@/lib/utils';

export const preferredRegion = 'sin1';


function getNovelBaseUrl(chapterUrl: string): string {
  // Handle local:// URLs for uploaded books
  if (chapterUrl.startsWith('local://')) {
    const match = chapterUrl.match(/^(local:\/\/[a-f0-9]+)/);
    return match ? match[1] : chapterUrl.split('/').slice(0, 2).join('/');
  }

  try {
    const url = new URL(chapterUrl);
    if (url.hostname.includes('royalroad.com')) {
      const match = url.pathname.match(/^\/fiction\/(\d+)\/([^/]+)/);
      if (match) {
        return `${url.origin}/fiction/${match[1]}/${match[2]}`;
      }
    }
    const paths = url.pathname.split('/').filter(Boolean);
    if (paths.length > 1) {
      const last = paths[paths.length - 1];
      if (last.includes('chuong') || last.includes('chapter') || last.includes('chap') || !isNaN(Number(last))) {
        return `${url.origin}/${paths.slice(0, -1).join('/')}/`;
      }
    }
    return `${url.origin}/${paths.join('/')}/`;
  } catch {
    return chapterUrl;
  }
}

function inferPrevNextFromUrl(chapterUrl: string): { prevUrl: string | null; nextUrl: string | null } {
  let inferredPrev: string | null = null;
  let inferredNext: string | null = null;
  try {
    const urlObj = new URL(chapterUrl);
    let path = urlObj.pathname;
    const hasTrailingSlash = path.endsWith('/');
    if (hasTrailingSlash) path = path.slice(0, -1);

    const match = path.match(/^(.*\/[^\d]*)(\d+)$/);
    if (match) {
      const prefix = match[1];
      const numStr = match[2];
      const chapNum = parseInt(numStr, 10);
      if (!isNaN(chapNum)) {
        if (chapNum > 1) {
          const prevNumStr = String(chapNum - 1).padStart(numStr.length, '0');
          inferredPrev = urlObj.origin + prefix + prevNumStr + (hasTrailingSlash ? '/' : '');
        }
        const nextNumStr = String(chapNum + 1).padStart(numStr.length, '0');
        inferredNext = urlObj.origin + prefix + nextNumStr + (hasTrailingSlash ? '/' : '');
      }
    }
  } catch {}
  return { prevUrl: inferredPrev, nextUrl: inferredNext };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');
  const mode = searchParams.get('mode') === 'translated' ? 'translated' : 'raw';

  if (!targetUrl) {
    return NextResponse.json(
      { error: 'Missing target URL parameter' },
      { status: 400 }
    );
  }

  let normalizedUrl: string;
  let isLocalBook = false;

  // Handle local:// URLs for uploaded books
  if (targetUrl.startsWith('local://')) {
    isLocalBook = true;
    normalizedUrl = normalizeUrl(targetUrl);
  } else {
    try {
      // Basic validation of URL
      new URL(targetUrl);
      normalizedUrl = normalizeUrl(targetUrl);
    } catch {
      return NextResponse.json(
        { error: 'Invalid target URL format' },
        { status: 400 }
      );
    }
  }

  // Translated mode: serve pre-generated AI translation if it exists (never scrapes)
  if (mode === 'translated') {
    try {
      const translatedRows = await sql`
        SELECT t.content, t.title, c.next_url, c.prev_url, c.original_font, c.url
        FROM translations t
        LEFT JOIN chapters c ON c.url = t.url
        WHERE t.url = ${normalizedUrl} 
        LIMIT 1
      `;
      if (translatedRows.length > 0) {
        console.log(`[TRANSLATION HIT] Chapter read: ${normalizedUrl}`);
        const row = translatedRows[0];
        // Apply replace rules
        const novelUrl = normalizeUrl(getNovelBaseUrl(normalizedUrl));
        const [globalRules, bookRules, chapterRules] = await Promise.all([
          getReplaceRules('global'),
          getReplaceRules('book', novelUrl),
          getReplaceRules('chapter', normalizedUrl),
        ]);
        const allRules = [...globalRules, ...bookRules, ...chapterRules];
        const content = allRules.length > 0 ? applyReplaceRules(row.content, allRules) : row.content;
        return NextResponse.json({
          title: row.title || 'Untitled',
          content,
          excerpt: '',
          siteName: row.url.startsWith('local://') ? 'Local Upload' : new URL(row.url).hostname,
          nextUrl: row.next_url,
          prevUrl: row.prev_url,
          originalUrl: row.url,
          chapters: [],
          originalFont: row.original_font,
          isTranslated: true,
        });
      }
      return NextResponse.json(
        { error: 'No AI translation available for this chapter yet.' },
        { status: 404 }
      );
    } catch (dbErr) {
      console.error('Database translation read error:', dbErr);
      return NextResponse.json(
        { error: 'Failed to look up translation.' },
        { status: 500 }
      );
    }
  }

  // Check database cache first (query chapters table only to avoid heavy JOIN and minimize payload size)
  try {
    const startTime = Date.now();
    const cachedRows = await sql`
      SELECT id, novel_url, url, title, content, next_url, prev_url, original_font,
             EXISTS(SELECT 1 FROM translations t WHERE t.url = chapters.url) AS has_translation
      FROM chapters 
      WHERE url = ${normalizedUrl} 
      LIMIT 1
    `;
    const dbDuration = Date.now() - startTime;
    console.log(`[DB Query Time] ${dbDuration}ms`);
    
    if (cachedRows.length > 0) {
      console.log(`[CACHE HIT] Chapter read: ${normalizedUrl}`);
      const cached = cachedRows[0];

      // Apply replace rules
      const novelUrl = normalizeUrl(getNovelBaseUrl(normalizedUrl));
      const [globalRules, bookRules, chapterRules] = await Promise.all([
        getReplaceRules('global'),
        getReplaceRules('book', novelUrl),
        getReplaceRules('chapter', normalizedUrl),
      ]);
      const allRules = [...globalRules, ...bookRules, ...chapterRules];
      const content = allRules.length > 0 ? applyReplaceRules(cached.content, allRules) : cached.content;

      let libraryChapters: { title: string; url: string }[] = [];
      let resolvedNextUrl = cached.next_url;
      let resolvedPrevUrl = cached.prev_url;

      try {
        const libRows = await sql`
          SELECT chapters_list FROM library WHERE novel_url = ${novelUrl} LIMIT 1
        `;
        if (libRows.length > 0 && libRows[0].chapters_list) {
          const list = JSON.parse(libRows[0].chapters_list);
          if (Array.isArray(list)) {
            libraryChapters = list;
            const idx = list.findIndex((c: { url: string }) => normalizeUrl(c.url) === normalizedUrl);
            if (idx !== -1) {
              if (!resolvedPrevUrl && idx > 0) resolvedPrevUrl = list[idx - 1].url;
              if (!resolvedNextUrl && idx < list.length - 1) resolvedNextUrl = list[idx + 1].url;
            }
          }
        }
      } catch (libErr) {
        console.error('Failed to resolve library chapters on cache hit:', libErr);
      }

      if (!resolvedPrevUrl || !resolvedNextUrl) {
        const inferred = inferPrevNextFromUrl(normalizedUrl);
        if (!resolvedPrevUrl) resolvedPrevUrl = inferred.prevUrl;
        if (!resolvedNextUrl) resolvedNextUrl = inferred.nextUrl;
      }

      return NextResponse.json({
        title: cached.title,
        content,
        excerpt: '',
        siteName: cached.url.startsWith('local://') ? 'Local Upload' : new URL(cached.url).hostname,
        nextUrl: resolvedNextUrl,
        prevUrl: resolvedPrevUrl,
        originalUrl: cached.url,
        chapters: libraryChapters,
        originalFont: cached.original_font,
        hasTranslation: !!cached.has_translation,
      });
    }
  } catch (dbErr) {
    console.error('Database read error:', dbErr);
  }

  console.log(`[CACHE MISS] Chapter read: ${normalizedUrl}`);

  // For local books, content is only in the database - can't scrape
  if (isLocalBook) {
    return NextResponse.json(
      { error: 'Chapter not found for this uploaded book.' },
      { status: 404 }
    );
  }

  try {
    const response = await fetch(normalizedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'max-age=0',
      },
      next: { revalidate: 3600 }, // Cache response for 1 hour
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch external site. Status: ${response.status}` },
        { status: response.status }
      );
    }

    const htmlText = await response.text();

    // Dynamically import Linkedom and Readability only on cache miss
    const { DOMParser } = await import('linkedom');
    const { Readability } = await import('@mozilla/readability');

    // Parse HTML using Linkedom
    const document = new DOMParser().parseFromString(htmlText, 'text/html');

    // Detect Previous and Next chapter links before clean up
    let nextUrl: string | null = null;
    let prevUrl: string | null = null;

    const getAbsoluteUrl = (href: string | null) => {
      if (!href) return null;
      try {
        return new URL(href, targetUrl).toString();
      } catch {
        return null;
      }
    };

    const getAbsoluteChapterUrl = (value: string | null) => {
      if (!value) return null;
      if (value.startsWith('http://') || value.startsWith('https://')) {
        return value;
      }
      if (value.startsWith('/')) {
        try {
          return new URL(value, targetUrl).toString();
        } catch {
          return null;
        }
      }
      
      try {
        const urlObj = new URL(targetUrl);
        const pathSegments = urlObj.pathname.split('/').filter(Boolean);
        if (pathSegments.length >= 2) {
          const basePath = '/' + pathSegments.slice(0, pathSegments.length - 1).join('/') + '/';
          return new URL(value, new URL(basePath, targetUrl)).toString();
        } else {
          return new URL(value, targetUrl).toString();
        }
      } catch {
        return null;
      }
    };

    const links = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
    for (const link of links) {
      const text = (link.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const id = (link.getAttribute('id') || '').toLowerCase();
      const rel = (link.getAttribute('rel') || '').toLowerCase();
      const className = (link.getAttribute('class') || '').toLowerCase();
      const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase();
      const title = (link.getAttribute('title') || '').toLowerCase();
      const href = link.getAttribute('href');
      if (!href) continue;

      const absoluteUrl = getAbsoluteUrl(href);
      if (!absoluteUrl) continue;

      // Match common prev link patterns (IDs, rel, class, text, titles, multilingual)
      const isPrev = 
        id === 'prev_chap' || 
        id === 'prev-chap' || 
        id === 'prevchap' ||
        id === 'prev' ||
        rel === 'prev' ||
        rel === 'previous' ||
        className.includes('btn-prev') ||
        className.includes('prev-chap') ||
        className.includes('chap-prev') ||
        className.includes('nav-prev') ||
        title.includes('previous') ||
        title.includes('chương trước') ||
        title.includes('chap trước') ||
        ariaLabel.includes('prev') ||
        ariaLabel.includes('trước') ||
        text === 'prev' ||
        text === 'previous' ||
        text === 'previous chapter' ||
        text === '< prev' ||
        text === '‹ prev' ||
        text === '« prev' ||
        text.includes('prev chapter') ||
        text.includes('chương trước') ||
        text.includes('chap trước') ||
        text.includes('tập trước') ||
        text === 'back' ||
        text === 'trước' ||
        text === '‹ trước' ||
        text === '« trước' ||
        text === '< trước' ||
        text === '‹' ||
        text === '«' ||
        text === '←';

      // Match common next link patterns (IDs, rel, class, text, titles, multilingual)
      const isNext = 
        id === 'next_chap' || 
        id === 'next-chap' || 
        id === 'nextchap' ||
        id === 'next' ||
        rel === 'next' ||
        className.includes('btn-next') ||
        className.includes('next-chap') ||
        className.includes('chap-next') ||
        className.includes('nav-next') ||
        title.includes('next') ||
        title.includes('chương sau') ||
        title.includes('chương tiếp') ||
        title.includes('chap sau') ||
        title.includes('chap tiếp') ||
        ariaLabel.includes('next') ||
        ariaLabel.includes('tiếp') ||
        text === 'next' ||
        text === 'next chapter' ||
        text === 'next >' ||
        text === '› next' ||
        text === '» next' ||
        text.includes('next chapter') ||
        text.includes('chương sau') ||
        text.includes('chương tiếp') ||
        text.includes('chap sau') ||
        text.includes('chap tiếp') ||
        text.includes('tập sau') ||
        text.includes('tập tiếp') ||
        text === 'forward' ||
        text === 'tiếp' ||
        text === 'sau' ||
        text === 'tiếp ›' ||
        text === 'tiếp »' ||
        text === 'tiếp >' ||
        text === '›' ||
        text === '»' ||
        text === '→';

      if (isPrev && !prevUrl) {
        prevUrl = absoluteUrl;
      }
      if (isNext && !nextUrl) {
        nextUrl = absoluteUrl;
      }
    }

    // Detect Chapter List
    const chapters: { title: string; url: string }[] = [];

    // 1. Try AJAX chapter option retrieval (e.g. truyenfull.live)
    const truyenIdInput = document.getElementById('truyen-id');
    const truyenId = truyenIdInput ? truyenIdInput.getAttribute('value') : null;

    if (truyenId) {
      try {
        const urlObj = new URL(targetUrl);
        const ajaxUrl = `${urlObj.origin}/ajax.php?type=chapter_option&data=${truyenId}`;
        const ajaxRes = await fetch(ajaxUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Referer: targetUrl,
          },
          next: { revalidate: 3600 }
        });

        if (ajaxRes.ok) {
          const ajaxHtml = await ajaxRes.text();
          const ajaxDoc = new DOMParser().parseFromString(ajaxHtml, 'text/html');
          const options = Array.from(ajaxDoc.querySelectorAll('option')) as HTMLOptionElement[];

          for (const option of options) {
            const title = option.textContent?.trim() || '';
            const value = option.getAttribute('value') || '';
            if (value && title) {
              const absoluteUrl = getAbsoluteChapterUrl(value);
              if (absoluteUrl) {
                chapters.push({ title, url: normalizeUrl(absoluteUrl) });
              }
            }
          }
        }
      } catch (ajaxErr) {
        console.error('Failed to load AJAX chapters:', ajaxErr);
      }
    }

    // 2. Fallback: Parse select elements with scoring to avoid choosing configuration dropdowns (like backgrounds/fonts)
    if (chapters.length === 0) {
      const selectElements = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
      let bestSelectElement = null;
      let maxChapterScore = 0;

      for (const select of selectElements) {
        const options = Array.from(select.querySelectorAll('option')) as HTMLOptionElement[];
        if (options.length < 2) continue;

        let score = 0;
        const className = (select.className || '').toLowerCase();
        const id = (select.id || '').toLowerCase();
        const name = (select.getAttribute('name') || '').toLowerCase();

        if (className.includes('chapter') || className.includes('chap') || className.includes('jump')) score += 10;
        if (id.includes('chapter') || id.includes('chap') || id.includes('jump')) score += 10;
        if (name.includes('chapter') || name.includes('chap')) score += 10;

        let chapterTextCount = 0;
        for (const option of options) {
          const text = (option.textContent || '').toLowerCase();
          if (
            text.includes('chương') || 
            text.includes('chapter') || 
            text.includes('chap') || 
            text.includes('tập') || 
            text.includes('chuong') || 
            /^\d+$/.test(text.trim()) ||
            /^\d+/.test(text.trim())
          ) {
            chapterTextCount++;
          }
        }

        const chapterRatio = chapterTextCount / options.length;
        score += chapterRatio * 50;
        score += Math.min(options.length, 100) * 0.5;

        // Apply penalty for setting/theme dropdowns
        if (
          className.includes('theme') || className.includes('color') || className.includes('background') ||
          id.includes('theme') || id.includes('color') || id.includes('background') ||
          name.includes('theme') || name.includes('color') || name.includes('background')
        ) {
          score -= 80;
        }

        if (score > maxChapterScore && score > 20) {
          maxChapterScore = score;
          bestSelectElement = select;
        }
      }

      if (bestSelectElement) {
        const options = Array.from(bestSelectElement.querySelectorAll('option')) as HTMLOptionElement[];
        for (const option of options) {
          const title = option.textContent?.trim() || '';
          const value = option.getAttribute('value') || '';
          if (value && title) {
            const absoluteUrl = getAbsoluteChapterUrl(value);
            if (absoluteUrl) {
              chapters.push({ title, url: normalizeUrl(absoluteUrl) });
            }
          }
        }
      }
    }

    // Detect original font-family
    let originalFont: string | null = null;
    try {
      const wrappers = document.querySelectorAll(
        '#chapter-c, .chapter-c, #chapter-content, .chapter-content, #js-chap-content, .content, #content, .post-content, #body_chapter, body'
      );
      for (const wrapper of Array.from(wrappers) as HTMLElement[]) {
        const style = wrapper.getAttribute('style') || '';
        const match = style.match(/font-family:\s*([^;]+)/i);
        if (match) {
          originalFont = match[1].replace(/['"]/g, '').trim();
          break;
        }
      }

      if (!originalFont) {
        const styles = document.querySelectorAll('style');
        for (const styleEl of Array.from(styles) as HTMLStyleElement[]) {
          const cssText = styleEl.textContent || '';
          const match = cssText.match(
            /(?:#chapter-c|\.chapter-c|\.chapter-content|#chapter-content|\.content|#content|body)\s*\{[^}]*font-family:\s*([^;}]+)/i
          );
          if (match) {
            originalFont = match[1].replace(/['"]/g, '').trim();
            break;
          }
        }
      }
    } catch (fontErr) {
      console.error('Failed to parse original font family:', fontErr);
    }

    // Run Readability to extract the main content
    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();

    if (!article) {
      return NextResponse.json(
        { error: 'Could not extract clean text from this page. Try reading another chapter.' },
        { status: 422 }
      );
    }

    let normalizedNextUrl = nextUrl ? normalizeUrl(nextUrl) : null;
    let normalizedPrevUrl = prevUrl ? normalizeUrl(prevUrl) : null;

    if (!normalizedPrevUrl || !normalizedNextUrl) {
      const inferred = inferPrevNextFromUrl(normalizedUrl);
      if (!normalizedPrevUrl) normalizedPrevUrl = inferred.prevUrl;
      if (!normalizedNextUrl) normalizedNextUrl = inferred.nextUrl;
    }

    // Apply replace rules
    const novelUrl = normalizeUrl(getNovelBaseUrl(normalizedUrl));
    const [globalRules, bookRules, chapterRules] = await Promise.all([
      getReplaceRules('global'),
      getReplaceRules('book', novelUrl),
      getReplaceRules('chapter', normalizedUrl),
    ]);
    const allRules = [...globalRules, ...bookRules, ...chapterRules];
    const content = allRules.length > 0 && article.content ? applyReplaceRules(article.content, allRules) : (article.content || '');

    // Save to cache database (save original content without rules applied)
    try {
      const chapterId = getUrlId(normalizedUrl);
      await sql`
        INSERT INTO chapters (id, novel_url, url, title, content, next_url, prev_url, original_font)
        VALUES (${chapterId}, ${novelUrl}, ${normalizedUrl}, ${article.title || 'Untitled'}, ${article.content}, ${normalizedNextUrl}, ${normalizedPrevUrl}, ${originalFont || null})
        ON CONFLICT (url) DO UPDATE SET
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          next_url = EXCLUDED.next_url,
          prev_url = EXCLUDED.prev_url,
          original_font = EXCLUDED.original_font,
          created_at = NOW()
      `;
    } catch (dbInsertErr) {
      console.error('Database write error:', dbInsertErr);
    }

    return NextResponse.json({
      title: article.title || 'Untitled',
      content,
      excerpt: article.excerpt || '',
      siteName: article.siteName || new URL(normalizedUrl).hostname,
      nextUrl: normalizedNextUrl,
      prevUrl: normalizedPrevUrl,
      originalUrl: normalizedUrl,
      chapters,
      originalFont,
      hasTranslation: false,
    });
  } catch (error: unknown) {
    console.error('Error in proxy read API:', error);
    const errorMsg = error instanceof Error ? error.message : 'Failed to fetch and parse the content.';
    return NextResponse.json(
      { error: errorMsg },
      { status: 500 }
    );
  }
}
