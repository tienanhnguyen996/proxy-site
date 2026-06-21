import crypto from 'crypto';

/**
 * Normalizes a URL by trimming whitespace and removing trailing slashes.
 */
export function normalizeUrl(url: string): string {
  if (!url) return '';
  let normalized = url.trim();
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Generates a simple hash (MD5) from a URL to use as a database ID.
 */
export function getUrlId(url: string): string {
  if (!url) return '';
  const normalizedUrl = normalizeUrl(url).toLowerCase();
  return crypto.createHash('md5').update(normalizedUrl).digest('hex');
}

