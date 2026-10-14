import { NextRequest, NextResponse } from 'next/server';

export const preferredRegion = 'sin1';

function isPrivateIp(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '0.0.0.0' ||
    lower === '::1' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }

  // IPv4 private ranges
  const parts = lower.split('.');
  if (parts.length === 4 && parts.every(p => /^\d+$/.test(p))) {
    const [a, b] = parts.map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }

  return false;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');
  const referer = searchParams.get('referer');

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image url parameter' }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(imageUrl);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return NextResponse.json({ error: 'Invalid URL protocol' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid image URL format' }, { status: 400 });
  }

  if (isPrivateIp(parsedUrl.hostname)) {
    return NextResponse.json({ error: 'Access to private addresses is forbidden' }, { status: 403 });
  }

  try {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
    };

    if (referer) {
      headers['Referer'] = referer;
    } else {
      headers['Referer'] = parsedUrl.origin + '/';
    }

    const upstreamResponse = await fetch(imageUrl, {
      headers,
      next: { revalidate: 86400 * 7 }, // Cache for 7 days
    });

    if (!upstreamResponse.ok) {
      return new NextResponse(null, { status: upstreamResponse.status });
    }

    const contentType = upstreamResponse.headers.get('content-type') || 'image/jpeg';
    const imageBuffer = await upstreamResponse.arrayBuffer();

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=604800, immutable',
      },
    });
  } catch (error: unknown) {
    console.error('Error proxying image:', error);
    const errorMsg = error instanceof Error ? error.message : 'Failed to fetch image';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
