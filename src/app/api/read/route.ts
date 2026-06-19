import { NextRequest, NextResponse } from 'next/server';
import { JSDOM } from 'jsdom';
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

    // Parse HTML using JSDOM
    const dom = new JSDOM(htmlText, { url: targetUrl });
    const { document } = dom.window;

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

    const links = Array.from(document.querySelectorAll('a'));
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

    // Run Readability to extract the main content
    const reader = new Readability(document);
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
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'An error occurred while fetching/parsing the novel.' },
      { status: 500 }
    );
  }
}
