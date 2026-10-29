import { NextRequest, NextResponse } from 'next/server';
import { sql, getReplaceRules, applyReplaceRules } from '@/lib/db';
import { getUrlId, normalizeUrl, getNovelBaseUrl, inferPrevNextFromUrl, sortChaptersAscending, deduplicateParagraphs, cleanParagraphSpacing } from '@/lib/utils';
import { fetchHtmlWithBypass } from '@/lib/fetch-utils';

export const preferredRegion = 'sin1';

interface QueryableDoc {
  querySelectorAll: (selector: string) => NodeListOf<Element> | Element[];
}

function extractMangaImages(doc: QueryableDoc, pageUrl: string): { url: string; alt?: string }[] {
  const selectors = [
    '.page-chapter img',
    '.reading-detail img',
    '.reading-detail .page-chapter img',
    '.chapter-content img',
    '#chapter-content img',
    '.reading-content img',
    '.box-reading img',
    '.content-reading img',
    '.read-content img',
    'div[class*="chapter-img"] img',
  ];

  let imgElements: Element[] = [];
  for (const sel of selectors) {
    const found = Array.from(doc.querySelectorAll(sel));
    if (found.length > 0) {
      imgElements = found;
      break;
    }
  }

  // Fallback: if no container matched, check all <img> on page that look like chapter pages
  if (imgElements.length === 0) {
    const allImgs = Array.from(doc.querySelectorAll('img'));
    imgElements = allImgs.filter((img: Element) => {
      const cls = (img.getAttribute('class') || '').toLowerCase();
      const parentCls = (img.parentElement?.getAttribute('class') || '').toLowerCase();
      const id = (img.getAttribute('id') || '').toLowerCase();
      return (
        cls.includes('page') ||
        cls.includes('chapter') ||
        parentCls.includes('page') ||
        parentCls.includes('chapter') ||
        id.includes('image-') ||
        id.includes('page-')
      );
    });
  }

  const result: { url: string; alt?: string }[] = [];
  const seenUrls = new Set<string>();

  for (const img of imgElements) {
    const rawSrc =
      img.getAttribute('data-original') ||
      img.getAttribute('data-src') ||
      img.getAttribute('data-lazy-src') ||
      img.getAttribute('data-cdn') ||
      img.getAttribute('data-url') ||
      img.getAttribute('src');

    if (!rawSrc) continue;

    const lower = rawSrc.toLowerCase();
    if (
      lower.includes('logo') ||
      lower.includes('banner') ||
      lower.includes('icon') ||
      lower.includes('facebook') ||
      lower.includes('avatar') ||
      lower.includes('loading.gif') ||
      lower.endsWith('.svg')
    ) {
      continue;
    }

    try {
      const absoluteUrl = new URL(rawSrc, pageUrl).toString();
      if (!seenUrls.has(absoluteUrl)) {
        seenUrls.add(absoluteUrl);
        result.push({
          url: absoluteUrl,
          alt: img.getAttribute('alt') || '',
        });
      }
    } catch {}
  }

  return result;
}


interface NovelOverviewResult {
  chapters: { title: string; url: string }[];
  novelTitle?: string;
  author?: string;
  coverUrl?: string;
}

function deobfuscateDomContent(document: Document, htmlText: string): void {
  const classToAttr = new Map<string, string>();
  const styleElements = Array.from(document.querySelectorAll('style'));
  const ruleRegex = /\.([a-zA-Z0-9_-]+)::before\s*\{\s*content:\s*attr\(([^)]+)\);?\s*\}/g;

  for (const styleEl of styleElements as Element[]) {
    const css = styleEl.textContent || '';
    let m;
    while ((m = ruleRegex.exec(css)) !== null) {
      classToAttr.set(m[1], m[2]);
    }
  }

  // Check inline scripts for hidden shadow DOM content (e.g. metruyenhotvn var contentS = '...')
  const scriptContentMatch = htmlText.match(/var\s+contentS\s*=\s*'([^']+)'/);
  if (scriptContentMatch) {
    const contentSHtml = scriptContentMatch[1];
    const scriptStyleMatch = htmlText.match(/div\.innerHTML\s*=\s*'<style>([^<]+)<\/style>'/);
    if (scriptStyleMatch) {
      let m;
      while ((m = ruleRegex.exec(scriptStyleMatch[1])) !== null) {
        classToAttr.set(m[1], m[2]);
      }
    }

    const host =
      document.querySelector('.chapter-c') ||
      document.querySelector('#chapter-c') ||
      document.querySelector('#chapt-content') ||
      document.querySelector('#chapter-content') ||
      document.querySelector('.content_wrap') ||
      document.querySelector('.reading-content') ||
      document.body;

    if (host) {
      const pTagRegex = /<p\b([^>]*)>(.*?)<\/p>/gi;
      let pMatch;
      while ((pMatch = pTagRegex.exec(contentSHtml)) !== null) {
        const pAttrs = pMatch[1];
        let text = pMatch[2].replace(/<[^>]+>/g, '').trim();

        if (!text) {
          const clsMatch = pAttrs.match(/class\s*=\s*["']([^"']+)["']/i);
          if (clsMatch) {
            const cls = clsMatch[1].trim();
            const attrName = classToAttr.get(cls);
            if (attrName) {
              const attrValMatch = new RegExp(`${attrName}\\s*=\\s*["']([^"']+)["']`, 'i').exec(pAttrs);
              if (attrValMatch) {
                text = attrValMatch[1].trim();
              }
            }
          }
        }

        if (!text) {
          const allAttrsRegex = /([a-zA-Z0-9_-]+)\s*=\s*["']([^"']+)["']/g;
          let aMatch;
          while ((aMatch = allAttrsRegex.exec(pAttrs)) !== null) {
            const name = aMatch[1].toLowerCase();
            const val = aMatch[2].trim();
            if (!['class', 'style', 'id', 'onmousedown', 'onselectstart', 'oncopy', 'oncut'].includes(name) && val.length > 3) {
              text = val;
              break;
            }
          }
        }

        if (text) {
          const newP = document.createElement('p');
          newP.innerHTML = text;
          host.appendChild(newP);
        }
      }
    }
  }

  // De-obfuscate any <p> tags in the document that have empty textContent but text in attributes
  const allPs = Array.from(document.querySelectorAll('p'));
  for (const p of allPs as Element[]) {
    if (!p.textContent?.trim()) {
      let resolvedText = '';
      const cls = p.className || '';
      for (const singleCls of cls.split(/\s+/)) {
        const attrName = classToAttr.get(singleCls);
        if (attrName && p.hasAttribute(attrName)) {
          resolvedText = p.getAttribute(attrName)?.trim() || '';
          break;
        }
      }

      if (!resolvedText) {
        for (const a of Array.from(p.attributes) as Attr[]) {
          const name = a.name.toLowerCase();
          const val = a.value.trim();
          if (!['class', 'style', 'id', 'onmousedown', 'onselectstart', 'oncopy', 'oncut', 'data-id'].includes(name) && val.length > 3) {
            resolvedText = val;
            break;
          }
        }
      }

      if (resolvedText) {
        p.innerHTML = resolvedText;
      }
    }
  }

  // Remove noisy ads or shadow DOM containers that might interfere
  const adSelectors = ['#top_ads_chapter_story', '#aan-banner', '.ads-chapter-box', '#content-metruyenhot'];
  for (const sel of adSelectors) {
    const el = document.querySelector(sel);
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }
}

async function fetchNovelOverview(novelUrl: string, currentTargetUrl?: string): Promise<NovelOverviewResult> {
  const normNovelUrl = normalizeUrl(novelUrl);
  try {
    const novelRes = await fetchHtmlWithBypass(normNovelUrl);
    if (!novelRes.ok || !novelRes.html) {
      return { chapters: [] };
    }

    const { DOMParser } = await import('linkedom');
    const novelDoc = new DOMParser().parseFromString(novelRes.html, 'text/html');

    const novelTitle = novelDoc.querySelector('.story-details h1, h1.title, .books .title, h1')?.textContent?.trim() || undefined;
    const author = novelDoc.querySelector('.author, [itemprop="author"], .info a[href*="tac-gia"]')?.textContent?.trim() || undefined;
    const coverEl = novelDoc.querySelector('.books img, .book-info img, .info-holder img, img[itemprop="image"], .story-details img.lazyload, .story-details img');
    const rawCover = coverEl?.getAttribute('data-src') || coverEl?.getAttribute('data-original') || coverEl?.getAttribute('src') || '';
    const coverUrl = rawCover ? new URL(rawCover, normNovelUrl).toString() : undefined;

    const chapterSelector =
      '.works-chapter-item a, .works-chapter-list a, .list-chap a, .list-chap li a, .list-chapter a, .chapter-list a, .list-chapters a, div.list_chapter a, ul.list-chapters li a, .show-chapter-list a, #list-chapter a, .chapter-list-inner a';

    const extractLinks = (doc: QueryableDoc, base: string) => {
      const anchors = Array.from(doc.querySelectorAll(chapterSelector)) as HTMLAnchorElement[];
      const extracted: { title: string; url: string }[] = [];
      for (const a of anchors) {
        const title = a.textContent?.trim() || '';
        const href = a.getAttribute('href');
        if (href && title && !href.startsWith('javascript:') && href !== '#') {
          const lower = href.toLowerCase();
          if (lower.includes('/the-loai/') || lower.includes('/danh-sach/') || lower.includes('/tac-gia/')) continue;
          if (
            /(?:chuong|chap|chapter|tap)[-_]?\d+|\/\d+(?:\.html)?$/i.test(lower) ||
            /(?:chương|chap|chapter|tập)\s*\d+/i.test(title)
          ) {
            const fullUrl = new URL(href, base).toString();
            extracted.push({ title, url: normalizeUrl(fullUrl) });
          }
        }
      }
      return extracted;
    };

    const allChapters = extractLinks(novelDoc, normNovelUrl);

    // Check for chapter range links or pagination (common on metruyenhotvn and similar sites)
    const rangeLinks = Array.from(novelDoc.querySelectorAll('.chapter-ranges a, ul.pagination a, .pagination a')) as HTMLAnchorElement[];
    const pageUrls = new Set<string>();

    for (const a of rangeLinks) {
      const href = a.getAttribute('href');
      if (href && (href.includes('page=') || href.includes('/page/')) && !href.startsWith('javascript:') && href !== '#') {
        const cleanUrl = new URL(href, normNovelUrl);
        cleanUrl.hash = '';
        pageUrls.add(cleanUrl.toString());
      }
    }

    if (pageUrls.size > 0) {
      const urlsToFetch = Array.from(pageUrls).slice(0, 25);
      const pageResults = await Promise.all(
        urlsToFetch.map(async (pUrl) => {
          try {
            const pRes = await fetchHtmlWithBypass(pUrl);
            if (pRes.ok && pRes.html) {
              const pDoc = new DOMParser().parseFromString(pRes.html, 'text/html');
              return extractLinks(pDoc, normNovelUrl);
            }
          } catch {}
          return [];
        })
      );

      for (const res of pageResults) {
        allChapters.push(...res);
      }
    }

    const sortedChapters = sortChaptersAscending(allChapters);
    return {
      chapters: sortedChapters,
      novelTitle,
      author,
      coverUrl,
    };
  } catch (err) {
    console.error('Failed to resolve novel overview:', err);
    return { chapters: [] };
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');
  const mode = searchParams.get('mode') === 'translated' ? 'translated' : 'raw';
  const refresh = searchParams.get('refresh') === 'true' || searchParams.get('force') === 'true';

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
    let extraAuthor: string | undefined;
    let extraCover: string | undefined;
    let extraNovelTitle: string | undefined;
        const [globalRules, bookRules, chapterRules] = await Promise.all([
          getReplaceRules('global'),
          getReplaceRules('book', novelUrl),
          getReplaceRules('chapter', normalizedUrl),
        ]);
        const allRules = [...globalRules, ...bookRules, ...chapterRules];
        let content = allRules.length > 0 ? applyReplaceRules(row.content, allRules) : row.content;
        const isManga = content ? (content.includes('manga-viewer') || content.includes('class="manga-img')) : false;
        if (isManga && content) {
          content = content.replace(/<span class="manga-page-number">.*?<\/span>\s*/gi, '');
        }

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
          isManga,
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
  if (!refresh) {
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
    let extraAuthor: string | undefined;
    let extraCover: string | undefined;
    let extraNovelTitle: string | undefined;
      const [globalRules, bookRules, chapterRules] = await Promise.all([
        getReplaceRules('global'),
        getReplaceRules('book', novelUrl),
        getReplaceRules('chapter', normalizedUrl),
      ]);
      const allRules = [...globalRules, ...bookRules, ...chapterRules];
      let content = allRules.length > 0 ? applyReplaceRules(cached.content, allRules) : cached.content;
      const isManga = content ? (content.includes('manga-viewer') || content.includes('class="manga-img')) : false;
      if (isManga && content) {
        content = content.replace(/<span class="manga-page-number">.*?<\/span>\s*/gi, '');
      } else if (content) {
        content = cleanParagraphSpacing(deduplicateParagraphs(content));
      }

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
            const isCorrupted = list.some((c: { url?: string; title?: string }) => c.url?.endsWith('px') || c.title?.endsWith('px'));
            if (!isCorrupted && list.length > 0) {
              libraryChapters = sortChaptersAscending(list);
            }
          }
        }
        if (libraryChapters.length === 0 && novelUrl && !novelUrl.startsWith('local://')) {
          // If the book hasn't been added to the library yet, attempt to load chapters from the novel overview page
          try {
            const overview = await fetchNovelOverview(novelUrl, normalizedUrl);
            if (overview.chapters.length > 0) {
              libraryChapters = overview.chapters;
            }
          } catch (fetchErr) {
            console.error('Failed to resolve novel chapters on cache hit:', fetchErr);
          }
        }

        if (libraryChapters.length > 0) {
          const idx = libraryChapters.findIndex((c: { url: string }) => normalizeUrl(c.url) === normalizedUrl);
          if (idx !== -1) {
            if (!resolvedPrevUrl && idx > 0) resolvedPrevUrl = libraryChapters[idx - 1].url;
            if (!resolvedNextUrl && idx < libraryChapters.length - 1) resolvedNextUrl = libraryChapters[idx + 1].url;
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
        isManga,
      });
    }
  } catch (dbErr) {
    console.error('Database read error:', dbErr);
  }
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
    const novelUrl = normalizeUrl(getNovelBaseUrl(normalizedUrl));
    let extraAuthor: string | undefined;
    let extraCover: string | undefined;
    let extraNovelTitle: string | undefined;

    const fetchResult = await fetchHtmlWithBypass(normalizedUrl);
    if (!fetchResult.ok || !fetchResult.html) {
      return NextResponse.json(
        { error: fetchResult.error || `Failed to fetch external site. Status: ${fetchResult.status}` },
        { status: fetchResult.status }
      );
    }

    const htmlText = fetchResult.html;

    // Dynamically import Linkedom and Readability only on cache miss
    const { DOMParser } = await import('linkedom');
    const { Readability } = await import('@mozilla/readability');

    // Parse HTML using Linkedom
    const document = new DOMParser().parseFromString(htmlText, 'text/html');

    // Detect Previous and Next chapter links before clean up
    let nextUrl: string | null = null;
    let prevUrl: string | null = null;

    const getAbsoluteUrl = (href: string | null) => {
      if (!href || href.startsWith('javascript:') || href === '#') return null;
      try {
        const u = new URL(href, targetUrl);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        return u.toString();
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

      // Note: TruyenQQ and some sites have .prev class on both forward and backward buttons!
      // Therefore, explicit text content ("chap trước" vs "chap sau") must take precedence!
      if (
        text.includes('chap trước') ||
        text.includes('chương trước') ||
        text.includes('tập trước') ||
        text === 'trước' ||
        text === '‹ trước' ||
        text === '« trước' ||
        text === '< trước' ||
        text === 'prev' ||
        text === 'previous' ||
        text === 'previous chapter' ||
        text === '< prev' ||
        text === '‹ prev' ||
        text === '« prev'
      ) {
        if (!prevUrl) prevUrl = absoluteUrl;
        continue;
      }

      if (
        text.includes('chap sau') ||
        text.includes('chương sau') ||
        text.includes('chương tiếp') ||
        text.includes('chap tiếp') ||
        text.includes('tập sau') ||
        text.includes('tập tiếp') ||
        text === 'tiếp' ||
        text === 'sau' ||
        text === 'tiếp ›' ||
        text === 'tiếp »' ||
        text === 'tiếp >' ||
        text === 'next' ||
        text === 'next chapter' ||
        text === 'next >' ||
        text === '› next' ||
        text === '» next'
      ) {
        if (!nextUrl) nextUrl = absoluteUrl;
        continue;
      }

      // Match common prev link patterns (IDs, rel, class, titles, multilingual)
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
        ariaLabel.includes('trước');

      // Match common next link patterns (IDs, rel, class, titles, multilingual)
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
        ariaLabel.includes('tiếp');

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

        // Skip configuration dropdowns (font size like 16px, colors like #fff, font families)
        const hasCssValues = options.some((o) => {
          const val = (o.getAttribute('value') || '').trim();
          return (
            /^\d+(?:px|pt|rem|em|%)$/i.test(val) ||
            /^#|^rgb/i.test(val) ||
            /serif|sans-serif|roboto|bookerly|minion/i.test(val)
          );
        });
        if (hasCssValues) continue;

        // Ensure options actually contain URLs or chapter paths
        const hasUrlLikeValue = options.some((o) => {
          const val = (o.getAttribute('value') || '').trim().toLowerCase();
          return (
            val.startsWith('http://') ||
            val.startsWith('https://') ||
            val.startsWith('/') ||
            val.includes('.html') ||
            val.includes('chuong') ||
            val.includes('chap') ||
            val.includes('chapter')
          );
        });
        if (!hasUrlLikeValue) continue;

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

    // 3. Fallback: If novel base page has chapter list (common for manga/comic sites like TruyenQQ)
    if (chapters.length === 0) {
      const parseChapterLinksFromDoc = (doc: QueryableDoc, baseUrl: string) => {
        const links = Array.from(
          doc.querySelectorAll(
            '.works-chapter-item a, .works-chapter-list a, .list-chap a, .list-chap li a, .list-chapter a, .chapter-list a, .list-chapters a, div.list_chapter a, ul.list-chapters li a, .show-chapter-list a, #list-chapter a, .chapter-list-inner a'
          )
        ) as HTMLAnchorElement[];

        const extracted: { title: string; url: string }[] = [];
        for (const a of links) {
          const title = a.textContent?.trim() || '';
          const href = a.getAttribute('href');
          if (href && title && !href.startsWith('javascript:') && href !== '#') {
            const lower = href.toLowerCase();
            if (lower.includes('/the-loai/') || lower.includes('/danh-sach/') || lower.includes('/tac-gia/')) continue;
            if (
              /(?:chuong|chap|chapter|tap)[-_]?\d+|\/\d+(?:\.html)?$/i.test(lower) ||
              /(?:chương|chap|chapter|tập)\s*\d+/i.test(title)
            ) {
              const fullUrl = new URL(href, baseUrl).toString();
              extracted.push({ title, url: normalizeUrl(fullUrl) });
            }
          }
        }
        return extracted;
      };

      // Check if current document already has chapter links (e.g. if targetUrl itself is novel overview page)
      const currentDocChapters = parseChapterLinksFromDoc(document, normalizedUrl);
      if (currentDocChapters.length > 0) {
        chapters.push(...currentDocChapters);
      } else if (novelUrl && !novelUrl.startsWith('local://')) {
        try {
          const overview = await fetchNovelOverview(novelUrl, normalizedUrl);
          if (overview.chapters.length > 0) {
            chapters.push(...overview.chapters);
          }
          if (overview.author && !extraAuthor) extraAuthor = overview.author;
          if (overview.coverUrl && !extraCover) extraCover = overview.coverUrl;
          if (overview.novelTitle && !extraNovelTitle) extraNovelTitle = overview.novelTitle;
        } catch (novelFetchErr) {
          console.error('Failed to load chapters from novel page:', novelFetchErr);
        }
      }

      if (chapters.length > 1) {
        const sorted = sortChaptersAscending(chapters);
        chapters.splice(0, chapters.length, ...sorted);
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

    // Check for manga / comic chapters (multiple chapter images)
    const mangaImages = extractMangaImages(document, normalizedUrl);
    const isManga = mangaImages.length >= 2;

    let content = '';
    let articleTitle = '';
    let excerpt = '';
    let siteName = '';

    if (isManga) {
      // Build clean responsive manga reader HTML
      content = `
<div class="manga-viewer">
  ${mangaImages
    .map(
      (img, idx) => `
  <div class="manga-page-item" id="manga-page-${idx + 1}">
    <img
      src="/api/proxy-image?url=${encodeURIComponent(img.url)}&referer=${encodeURIComponent(normalizedUrl)}"
      alt="${img.alt || `Trang ${idx + 1}`}"
      class="manga-img"
      loading="${idx < 6 ? 'eager' : 'lazy'}"
      decoding="async"
    />
  </div>`
    )
    .join('\n')}
</div>`;

      // Extract title from H1, breadcrumb, or document title
      const rawH1 = document.querySelector('h1')?.textContent || '';
      const docTitle = document.querySelector('title')?.textContent || '';
      articleTitle = rawH1.replace(/\s+/g, ' ').trim() || docTitle.trim() || 'Untitled Manga Chapter';
      siteName = new URL(normalizedUrl).hostname;
    } else {
      // Deobfuscate anti-scraping / CSS attribute hidden text (e.g. metruyenhotvn.com)
      deobfuscateDomContent(document as unknown as Document, htmlText);

      // Run Readability to extract the main content for text novels
      const reader = new Readability(document as unknown as Document);
      const article = reader.parse();

      if (!article) {
        return NextResponse.json(
          { error: 'Could not extract clean text from this page. Try reading another chapter.' },
          { status: 422 }
        );
      }

      content = article.content || '';
      articleTitle = article.title || 'Untitled';
      excerpt = article.excerpt || '';
      siteName = article.siteName || new URL(normalizedUrl).hostname;
    }

    let normalizedNextUrl = nextUrl ? normalizeUrl(nextUrl) : null;
    let normalizedPrevUrl = prevUrl ? normalizeUrl(prevUrl) : null;

    if (!normalizedPrevUrl || !normalizedNextUrl) {
      const inferred = inferPrevNextFromUrl(normalizedUrl);
      if (!normalizedPrevUrl) normalizedPrevUrl = inferred.prevUrl;
      if (!normalizedNextUrl) normalizedNextUrl = inferred.nextUrl;
    }

    // Apply replace rules for text novels
    if (!isManga) {
      const [globalRules, bookRules, chapterRules] = await Promise.all([
        getReplaceRules('global'),
        getReplaceRules('book', novelUrl),
        getReplaceRules('chapter', normalizedUrl),
      ]);
      const allRules = [...globalRules, ...bookRules, ...chapterRules];
      if (allRules.length > 0 && content) {
        content = cleanParagraphSpacing(deduplicateParagraphs(applyReplaceRules(content, allRules)));
      } else if (content) {
        content = cleanParagraphSpacing(deduplicateParagraphs(content));
      }
    }

    // Save to cache database
    try {
      const chapterId = getUrlId(normalizedUrl);
      await sql`
        INSERT INTO chapters (id, novel_url, url, title, content, next_url, prev_url, original_font)
        VALUES (${chapterId}, ${novelUrl}, ${normalizedUrl}, ${articleTitle || 'Untitled'}, ${content}, ${normalizedNextUrl}, ${normalizedPrevUrl}, ${originalFont || null})
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
      title: articleTitle || 'Untitled',
      content,
      excerpt,
      siteName,
      nextUrl: normalizedNextUrl,
      prevUrl: normalizedPrevUrl,
      originalUrl: normalizedUrl,
      chapters,
      originalFont,
      hasTranslation: false,
      isManga,
      author: extraAuthor,
      coverUrl: extraCover,
      novelTitle: extraNovelTitle,
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
