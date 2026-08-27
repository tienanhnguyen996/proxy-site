/**
 * Isomorphic replace-rule matching utilities (works on both server and client).
 * Supports case sensitivity and flexible Vietnamese diacritic placement.
 */

export interface MatchOptions {
  caseSensitive: boolean;
  ignoreAccents: boolean;
}

/**
 * Normalize Vietnamese text by removing diacritics so that diacritic placement
 * (e.g. "Tùy" vs "Tuỳ") no longer matters for matching.
 */
const VIETNAMESE_MAP: Record<string, string> = {
  'à': 'a', 'á': 'a', 'ả': 'a', 'ã': 'a', 'ạ': 'a',
  'ă': 'a', 'ằ': 'a', 'ắ': 'a', 'ẳ': 'a', 'ẵ': 'a', 'ặ': 'a',
  'â': 'a', 'ầ': 'a', 'ấ': 'a', 'ẩ': 'a', 'ẫ': 'a', 'ậ': 'a',
  'đ': 'd',
  'è': 'e', 'é': 'e', 'ẻ': 'e', 'ẽ': 'e', 'ẹ': 'e',
  'ê': 'e', 'ề': 'e', 'ế': 'e', 'ể': 'e', 'ễ': 'e', 'ệ': 'e',
  'ì': 'i', 'í': 'i', 'ỉ': 'i', 'ĩ': 'i', 'ị': 'i',
  'ò': 'o', 'ó': 'o', 'ỏ': 'o', 'õ': 'o', 'ọ': 'o',
  'ô': 'o', 'ồ': 'o', 'ố': 'o', 'ổ': 'o', 'ỗ': 'o', 'ộ': 'o',
  'ơ': 'o', 'ờ': 'o', 'ớ': 'o', 'ở': 'o', 'ỡ': 'o', 'ợ': 'o',
  'ù': 'u', 'ú': 'u', 'ủ': 'u', 'ũ': 'u', 'ụ': 'u',
  'ư': 'u', 'ừ': 'u', 'ứ': 'u', 'ử': 'u', 'ữ': 'u', 'ự': 'u',
  'ỳ': 'y', 'ý': 'y', 'ỷ': 'y', 'ỹ': 'y', 'ỵ': 'y',
};

function stripVietnamese(str: string): string {
  let out = '';
  for (const ch of str) {
    const lower = ch.toLowerCase();
    out += VIETNAMESE_MAP[lower] || ch;
  }
  return out;
}

/**
 * Normalize input based on options for matching.
 * If ignoreAccents, strips Vietnamese diacritics.
 * If !caseSensitive, lowercases.
 */
export function normalizeForMatch(
  input: string,
  options: MatchOptions
): string {
  let result = input;
  if (options.ignoreAccents) {
    result = stripVietnamese(result);
  }
  if (!options.caseSensitive) {
    result = result.toLowerCase();
  }
  return result;
}

/**
 * Apply a list of text rules to an input string.
 * Rules are objects with find_text, replace_with, is_regex, and matching options.
 */
export function applyTextRules(
  content: string,
  rules: {
    find_text: string;
    replace_with: string;
    is_regex: boolean;
    case_sensitive?: boolean;
    ignore_accents?: boolean;
  }[]
): string {
  let result = content;
  for (const rule of rules) {
    try {
      const caseSensitive = !!rule.case_sensitive;
      const ignoreAccents = !!rule.ignore_accents;

      if (rule.is_regex) {
        const flags = caseSensitive ? 'g' : 'gi';
        result = result.replace(new RegExp(rule.find_text, flags), rule.replace_with);
      } else {
        if (ignoreAccents) {
          result = replaceIgnoringAccents(
            result,
            rule.find_text,
            rule.replace_with,
            caseSensitive
          );
        } else {
          const escaped = rule.find_text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const flags = caseSensitive ? 'g' : 'gi';
          result = result.replace(new RegExp(escaped, flags), rule.replace_with);
        }
      }
    } catch (e) {
      console.error(`Failed to apply replace rule "${rule.find_text}":`, e);
    }
  }
  return result;
}

/**
 * Replace occurrences of findText in content ignoring Vietnamese accents.
 * The replacement output preserves the original (non-normalized) text of what was
 * matched, so accents remain intact in the result unless replaceText replaces them.
 */
function replaceIgnoringAccents(
  content: string,
  findText: string,
  replaceText: string,
  caseSensitive: boolean
): string {
  if (!findText) return content;

  const opts: MatchOptions = { caseSensitive, ignoreAccents: true };
  const normContent = normalizeForMatch(content, opts);
  const normFind = normalizeForMatch(findText, opts);
  if (!normFind) return content;

  const results: string[] = [];
  let searchIndex = 0;
  let searchPos = 0;

  // We need to search in the normalized content but slice from the original content.
  // Build an index that maps normalized char positions to original content char positions.
  const normalizedChars = normContent.split('');

  let lastIdx = 0;
  const lowerFind = normFind;
  while (true) {
    const normPos = normContent.indexOf(lowerFind, searchIndex);
    if (normPos === -1) break;

    // The normalized substring from lastIdx..normPos corresponds to original content chars.
    // Since normalization is 1:1 (each char -> one char), positions align 1:1.
    results.push(content.slice(lastIdx, normPos));
    results.push(replaceText);
    lastIdx = normPos + normFind.length;
    searchIndex = normPos + normFind.length;
  }

  if (lastIdx === 0) return content;
  results.push(content.slice(lastIdx));
  return results.join('');
}
