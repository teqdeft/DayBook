// Pure helpers for desktop pushes: the message a notification becomes, the endpoint hash, and how
// a push service's reply is read. No database, no network (unit-tested in tests/unit/push.test.js).
import crypto from 'node:crypto';

export const TITLE_MAX = 120;
export const BODY_MAX = 300;

/** sha256 of the endpoint URL as 64 hex characters (the unique key; endpoints are too long). */
export function endpointHash(endpoint) {
  return crypto.createHash('sha256').update(String(endpoint), 'utf8').digest('hex');
}

function clip(value, max) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * The address a notification opens: APP_URL + its link for in-app paths ('/requests'),
 * otherwise APP_URL + '/'. Other sites and protocol-relative links ('//x') are never used.
 * @param {string | null | undefined} link
 * @param {string} appUrl for example 'https://daybook.example.com'
 */
export function notificationUrl(link, appUrl) {
  const origin = new URL(appUrl).origin;
  const path = typeof link === 'string' ? link.trim() : '';
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return `${origin}/`;
  const url = new URL(path, origin);
  return url.origin === origin ? url.href : `${origin}/`;
}

/**
 * The JSON a notification is pushed as: { id, userId, title, body, url }, plus mustShow: true for
 * an Apple endpoint (CONTRACT 26: public/sw.js then always shows the system notification). Kept
 * small (push services take about 4 KB) with the title and body clipped; no type and no other
 * personal data.
 * @param {{ id: number, userId: number, title: string, body?: string | null,
 *   link?: string | null }} notification
 * @param {string} appUrl
 * @param {{ mustShow?: boolean }} [options]
 * @returns {string}
 */
export function buildPayload(notification, appUrl, { mustShow = false } = {}) {
  const userId = Number(notification.userId);
  return JSON.stringify({
    id: Number(notification.id),
    userId: Number.isSafeInteger(userId) && userId > 0 ? userId : null,
    title: clip(notification.title, TITLE_MAX) || 'Daybook',
    body: clip(notification.body, BODY_MAX),
    url: notificationUrl(notification.link, appUrl),
    ...(mustShow === true ? { mustShow: true } : {}),
  });
}

/**
 * True for Safari's push service (web.push.apple.com): the host is push.apple.com or ends with
 * .push.apple.com. Safari revokes a subscription after a few pushes without a system notification,
 * so these always show one (CONTRACT 26).
 * @param {string | null | undefined} endpoint
 * @returns {boolean} false for anything that isn't a URL
 */
export function isApplePush(endpoint) {
  try {
    const host = new URL(String(endpoint ?? '')).hostname.toLowerCase();
    return host === 'push.apple.com' || host.endsWith('.push.apple.com');
  } catch {
    return false;
  }
}

/**
 * What a failed send means: 'gone' (404/410: the browser unsubscribed or the subscription
 * expired, so delete it) or 'retry' (anything else: count the failure and try again).
 * @param {{ statusCode?: number } | null | undefined} error
 * @returns {'gone' | 'retry'}
 */
export function classifyFailure(error) {
  const status = Number(error?.statusCode);
  return status === 404 || status === 410 ? 'gone' : 'retry';
}

/** A log-safe description of a send error: the HTTP status or the network error code only. */
export function describeFailure(error) {
  const status = Number(error?.statusCode);
  if (Number.isInteger(status) && status > 0) return { statusCode: status };
  const code = typeof error?.code === 'string' ? error.code.slice(0, 40) : 'error';
  return { errorCode: code };
}
