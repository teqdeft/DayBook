// Where the client IP comes from (guide 15.1: X-Forwarded-For is trusted only when TRUST_PROXY is
// true). Pure helpers shared by src/proxy.js and src/lib/route.js; no Next.js or database imports.
//
// Behind our own proxy (TRUST_PROXY=true) the right-most X-Forwarded-For entry is the address that
// proxy saw, so it is the client. Without a proxy (TRUST_PROXY=false) Next.js puts the socket
// address in X-Forwarded-For, but only when the request has no such header, so a client could pick
// its own IP. src/proxy.js therefore drops any X-Forwarded-For the client sent before Next.js fills
// it in, and clientIpFrom() accepts nothing but that single socket address.
import { isIP } from 'node:net';

export const FORWARDED_FOR = 'x-forwarded-for';

/**
 * '::ffff:10.0.0.5' -> '10.0.0.5'. Anything that isn't an IP address (an empty or forged value)
 * becomes null, so it never reaches the office-network check, a session row or a log line.
 * @param {unknown} value
 * @returns {string | null}
 */
export function cleanIp(value) {
  let ip = String(value ?? '').trim();
  if (ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return isIP(ip) ? ip : null;
}

/**
 * The client IP from request headers.
 * @param {{ get(name: string): string | null }} headers
 * @param {{ trustProxy: boolean }} options
 * @returns {string | null}
 */
export function clientIpFrom(headers, { trustProxy }) {
  const forwarded = headers.get(FORWARDED_FOR);
  if (!forwarded) return null;
  const parts = forwarded
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  // Without a proxy the header holds exactly the socket address; a list can only be client-made.
  if (!trustProxy && parts.length > 1) return null;
  return cleanIp(parts[parts.length - 1]);
}

/**
 * For src/proxy.js: the request headers to pass on, or null to keep them as they are. Without a
 * trusted proxy, an X-Forwarded-For header can only have come from the client, so it is removed
 * and Next.js fills it in from the socket.
 * @param {Headers} headers
 * @param {{ trustProxy: boolean }} options
 * @returns {Headers | null}
 */
export function headersWithoutClientForwardedFor(headers, { trustProxy }) {
  if (trustProxy || !headers.has(FORWARDED_FOR)) return null;
  const next = new Headers(headers);
  next.delete(FORWARDED_FOR);
  return next;
}
