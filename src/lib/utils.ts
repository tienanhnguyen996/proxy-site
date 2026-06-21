import crypto from 'crypto';

/**
 * Generates a simple hash (MD5) from a URL to use as a database ID.
 */
export function getUrlId(url: string): string {
  if (!url) return '';
  const normalizedUrl = url.trim().toLowerCase();
  return crypto.createHash('md5').update(normalizedUrl).digest('hex');
}
