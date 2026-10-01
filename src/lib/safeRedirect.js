// Checks the ?next= path the sign-in page returns to, so a link can't send people to another site.

// Parsed against a placeholder origin: only the path, query and hash of the result are used.
const BASE = 'http://daybook.invalid';
const MAX_LENGTH = 2048;

/**
 * A same-site path to return to after signing in, or null. Browsers drop tabs and line breaks
 * from URLs and read '\' as '/', so '/\t/evil.com' would become '//evil.com' (another host):
 * values with control characters or backslashes are refused, and the rest must resolve to a
 * path on this site. Sign-in and API paths are refused too.
 * @param {unknown} value a search param (string, string[] or undefined)
 * @returns {string | null}
 */
export function safeNextPath(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  let url;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  const { pathname } = url;
  if (pathname === '/login' || pathname.startsWith('/login/') || pathname.startsWith('/api/')) {
    return null;
  }
  return `${pathname}${url.search}${url.hash}`;
}
