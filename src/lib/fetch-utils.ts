/**
 * Isomorphic and robust fetch utility with Cloudflare WAF bypass fallback.
 * Attempts direct fetch with modern browser headers first.
 * If the target blocks serverless/datacenter IPs with HTTP 403/503/429/timeout,
 * seamlessly falls back to the headless browser reader engine (r.jina.ai).
 */

export interface FetchHtmlResult {
  ok: boolean;
  status: number;
  html: string;
  source?: 'direct' | 'bypass';
  error?: string;
}

export async function fetchHtmlWithBypass(
  targetUrl: string,
  options?: { timeoutMs?: number; customReferer?: string }
): Promise<FetchHtmlResult> {
  const timeoutMs = options?.timeoutMs || 9000;
  
  let referer = options?.customReferer;
  if (!referer) {
    try {
      referer = new URL(targetUrl).origin + '/';
    } catch {
      referer = 'https://www.google.com/';
    }
  }

  const browserHeaders: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
    'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
    Referer: referer,
  };

  let directStatus = 0;

  // 1. Direct fetch attempt
  try {
    const directRes = await fetch(targetUrl, {
      headers: browserHeaders,
      signal: AbortSignal.timeout(timeoutMs),
      next: { revalidate: 3600 },
    });
    directStatus = directRes.status;

    if (directRes.ok) {
      const html = await directRes.text();
      if (html && html.length > 200) {
        return { ok: true, status: directRes.status, html, source: 'direct' };
      }
    }
    console.warn(`[DIRECT FETCH] ${targetUrl} returned HTTP ${directRes.status}. Initiating bypass...`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[DIRECT FETCH ERROR] ${targetUrl}: ${msg}. Initiating bypass...`);
  }

  // 2. Bypass Cloudflare 403 / 503 / WAF via Jina Reader engine
  try {
    const bypassRes = await fetch(`https://r.jina.ai/${targetUrl}`, {
      headers: {
        'X-Return-Format': 'html',
        'X-No-Cache': 'true',
      },
      signal: AbortSignal.timeout(18000),
    });

    if (bypassRes.ok) {
      const html = await bypassRes.text();
      if (html && html.length > 500) {
        console.log(`[BYPASS SUCCESS] Fetched ${targetUrl} via Jina Reader (${html.length} bytes)`);
        return { ok: true, status: 200, html, source: 'bypass' };
      }
    }
    console.warn(`[BYPASS FAIL] Jina Reader returned HTTP ${bypassRes.status}`);
  } catch (bypassErr: unknown) {
    const msg = bypassErr instanceof Error ? bypassErr.message : String(bypassErr);
    console.error(`[BYPASS ERROR] Failed bypass for ${targetUrl}: ${msg}`);
  }

  return {
    ok: false,
    status: directStatus || 502,
    html: '',
    error: `Failed to fetch external site. Status: ${directStatus || 502}`,
  };
}
