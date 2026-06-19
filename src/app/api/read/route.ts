import { NextRequest, NextResponse } from 'next/server';
import { DOMParser } from 'linkedom';
import { Readability } from '@mozilla/readability';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return NextResponse.json(
      { error: 'Missing target URL parameter' },
      { status: 400 }
    );
  }

  try {
    // Basic validation of URL
    new URL(targetUrl);
  } catch {
    return NextResponse.json(
      { error: 'Invalid target URL format' },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(targetUrl, {
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

    const links = Array.from(document.querySelectorAll('a')) as any[];
    for (const link of links) {
      const text = link.textContent?.trim().toLowerCase() || '';
      const id = link.getAttribute('id')?.toLowerCase() || '';
      const href = link.getAttribute('href');
      const title = link.getAttribute('title')?.toLowerCase() || '';
      if (!href) continue;

      const absoluteUrl = getAbsoluteUrl(href);
      if (!absoluteUrl) continue;

      // Match common prev link patterns (IDs, text, titles, multilingual)
      const isPrev = 
        id === 'prev_chap' || 
        id === 'prev-chap' || 
        id === 'prevchap' ||
        id === 'prev' ||
        title.includes('previous') ||
        title.includes('chương trước') ||
        text === 'prev' ||
        text === 'previous' ||
        text === 'previous chapter' ||
        text === '< prev' ||
        text === '‹ prev' ||
        text === '« prev' ||
        text.includes('prev chapter') ||
        text === 'back' ||
        text.includes('chương trước') ||
        text.includes('chap trước') ||
        text === 'trước' ||
        text === '‹ trước' ||
        text === '« trước' ||
        text === '< trước';

      // Match common next link patterns (IDs, text, titles, multilingual)
      const isNext = 
        id === 'next_chap' || 
        id === 'next-chap' || 
        id === 'nextchap' ||
        id === 'next' ||
        title.includes('next') ||
        title.includes('chương sau') ||
        title.includes('chương tiếp') ||
        text === 'next' ||
        text === 'next chapter' ||
        text === 'next >' ||
        text === '› next' ||
        text === '» next' ||
        text.includes('next chapter') ||
        text === 'forward' ||
        text.includes('chương sau') ||
        text.includes('chương tiếp') ||
        text.includes('chap sau') ||
        text.includes('chap tiếp') ||
        text === 'tiếp' ||
        text === 'tiếp ›' ||
        text === 'tiếp »' ||
        text === 'tiếp >';

      if (isPrev && !prevUrl) {
        prevUrl = absoluteUrl;
      }
      if (isNext && !nextUrl) {
        nextUrl = absoluteUrl;
      }
    }

    // Detect Chapter List
    const chapters: { title: string; url: string }[] = [];

    // 1. Try AJAX chapter option retrieval (e.g. truyenfull.today)
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
          const options = Array.from(ajaxDoc.querySelectorAll('option')) as any[];

          for (const option of options) {
            const title = option.textContent?.trim() || '';
            const value = option.getAttribute('value') || '';
            if (value && title) {
              const absoluteUrl = getAbsoluteChapterUrl(value);
              if (absoluteUrl) {
                chapters.push({ title, url: absoluteUrl });
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
      const selectElements = Array.from(document.querySelectorAll('select')) as any[];
      let bestSelectElement = null;
      let maxChapterScore = 0;

      for (const select of selectElements) {
        const options = Array.from(select.querySelectorAll('option')) as any[];
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
        const options = Array.from(bestSelectElement.querySelectorAll('option')) as any[];
        for (const option of options) {
          const title = option.textContent?.trim() || '';
          const value = option.getAttribute('value') || '';
          if (value && title) {
            const absoluteUrl = getAbsoluteChapterUrl(value);
            if (absoluteUrl) {
              chapters.push({ title, url: absoluteUrl });
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
      for (const wrapper of Array.from(wrappers) as any[]) {
        const style = wrapper.getAttribute('style') || '';
        const match = style.match(/font-family:\s*([^;]+)/i);
        if (match) {
          originalFont = match[1].replace(/['"]/g, '').trim();
          break;
        }
      }

      if (!originalFont) {
        const styles = document.querySelectorAll('style');
        for (const styleEl of Array.from(styles) as any[]) {
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
    const reader = new Readability(document as any);
    const article = reader.parse();

    if (!article) {
      return NextResponse.json(
        { error: 'Could not extract clean text from this page. Try reading another chapter.' },
        { status: 422 }
      );
    }

    return NextResponse.json({
      title: article.title || 'Untitled',
      content: article.content,
      excerpt: article.excerpt || '',
      siteName: article.siteName || new URL(targetUrl).hostname,
      nextUrl,
      prevUrl,
      originalUrl: targetUrl,
      chapters,
      originalFont,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'An error occurred while fetching/parsing the novel.' },
      { status: 500 }
    );
  }
}
