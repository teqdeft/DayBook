// Shapes the "Work from home requests" card on Attendance (CONTRACT 17): the pending requests HR
// decides on, then the ones handled in the last 7 days. A pending request whose last day has
// passed is out of date (nobody decided in time): it shows as "Expired" with the handled ones, for
// 7 days after that day. Pure (no database or server modules), so the wording is unit tested;
// attendanceData.js loads the rows.
import { addDays, formatDayShort, formatTimeAmPm, workDate } from '@/lib/time';

/** Handled requests stay on the card this many days. */
export const HANDLED_DAYS = 7;

/** The first company day whose decisions the card still shows: 'YYYY-MM-DD'. */
export function handledSinceFor(today) {
  return addDays(today, -HANDLED_DAYS);
}

/** "today", "yesterday" or "on Mon, 12 Oct" for a company date. */
function onDay(date, today) {
  if (date === today) return 'today';
  if (date === addDays(today, -1)) return 'yesterday';
  return `on ${formatDayShort(date)}`;
}

/** "Sent today at 10:12", "Sent yesterday at 5:20 PM", "Sent Mon, 12 Oct at 9:15". */
export function sentLabel(createdAt, tz, today) {
  const day = workDate(tz, createdAt);
  // Morning times read without "AM", as on the Requests cards; afternoon times keep "PM".
  const time = formatTimeAmPm(createdAt, tz).replace(' AM', '');
  if (day === today) return `Sent today at ${time}`;
  if (day === addDays(today, -1)) return `Sent yesterday at ${time}`;
  return `Sent ${formatDayShort(day)} at ${time}`;
}

/** Who decides on the viewer's own request (they can't). */
export function ownRequestNote(viewer) {
  return viewer?.role === 'admin'
    ? 'Your own request. Another Admin decides.'
    : 'Your own request. Another HR person or an Admin decides.';
}

/**
 * The line under a handled request: "Approved by Neha Gupta today", "Declined by you yesterday:
 * Team offsite that day", "They cancelled it on Mon, 12 Oct" ("You cancelled it" for your own),
 * "Not decided in time" (expired).
 * @param {{ status: string, user: { id: number }, handledBy: { id: number, name: string } | null,
 *   handledAt: Date | string | null, declineReason: string | null }} request status 'expired':
 *   a pending request whose days are over
 * @param {{ viewerId: number, tz: string, today: string }} ctx
 */
export function handledLine(request, { viewerId, tz, today }) {
  if (request.status === 'expired') return 'Not decided in time';
  const when = request.handledAt ? ` ${onDay(workDate(tz, request.handledAt), today)}` : '';
  if (request.status === 'cancelled') {
    return `${request.user.id === viewerId ? 'You' : 'They'} cancelled it${when}`;
  }
  const verb = request.status === 'approved' ? 'Approved' : 'Declined';
  const handler = request.handledBy;
  const by = handler ? ` by ${handler.id === viewerId ? 'you' : handler.name}` : '';
  const line = `${verb}${by}${when}`;
  return request.status === 'declined' && request.declineReason
    ? `${line}: ${request.declineReason}`
    : line;
}

/** True when the request's days include `today` (HR decides these first). */
function coversToday(request, today) {
  return request.fromDate <= today && today <= request.toDate;
}

/** A pending request whose last day is before today: nobody decided in time. */
export function isExpired(request, today) {
  return request.status === 'pending' && request.toDate < today;
}

/**
 * The card's data, or null when there is nothing to show (no pending requests and nothing
 * handled in the last 7 days: the card is left out).
 * @param {{ items: object[], total: number }} list attendance.listWfhRequests({ handledSince })
 * @param {number} waiting attendance.countPendingWfh({ viewer }): pending ones the viewer may
 *   decide on (never their own, never expired)
 * @param {{ viewer: { id: number, role: string }, tz: string, today: string }} ctx
 * @returns {{ waiting: number, pending: object[], handled: object[], more: number } | null}
 */
export function wfhCard(list, waiting, { viewer, tz, today }) {
  if (!list || list.items.length === 0) return null;
  const person = (request) => ({
    id: request.user.id,
    name: request.user.name,
    initials: request.user.initials,
    role: request.user.role,
    status: request.user.status,
  });
  const pending = list.items
    .filter((request) => request.status === 'pending' && !isExpired(request, today))
    .map((request) => {
      const own = request.user.id === viewer.id;
      return {
        id: request.id,
        user: person(request),
        days: request.days,
        reason: request.reason,
        sent: sentLabel(request.createdAt, tz, today),
        today: coversToday(request, today),
        own,
        ownNote: own ? ownRequestNote(viewer) : null,
      };
    });
  // Expired first (the latest day first: the list has them soonest first), then the decisions.
  const expired = list.items
    .filter((request) => isExpired(request, today))
    .reverse()
    .map((request) => ({ ...request, status: 'expired' }));
  const handled = [...expired, ...list.items.filter((request) => request.status !== 'pending')].map(
    (request) => ({
      id: request.id,
      user: person(request),
      days: request.days,
      reason: request.reason,
      status: request.status,
      line: handledLine(request, { viewerId: viewer.id, tz, today }),
    }),
  );
  return {
    waiting,
    pending,
    handled,
    more: Math.max(0, list.total - list.items.length),
  };
}
