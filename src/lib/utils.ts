import crypto from 'crypto';
import { normalizeUrl } from './novel-utils';

export { normalizeUrl, getNovelBaseUrl, inferPrevNextFromUrl } from './novel-utils';

/**
 * Generates a simple hash (MD5) from a URL to use as a database ID.
 */
export function getUrlId(url: string): string {
  if (!url) return '';
  const normalizedUrl = normalizeUrl(url).toLowerCase();
  return crypto.createHash('md5').update(normalizedUrl).digest('hex');
}
