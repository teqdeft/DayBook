// The Company overview's "Pending requests" card (CONTRACT 23): what waits for the viewer, and the
// screen that handles it. Pure: getOverview (overview.js) does the counting.
import { can } from '@/lib/permissions';
import { plural } from '@/lib/text';
import { percent } from './shared';

const WAITING = [
  ['edits', 'edit', 'edits'],
  ['projects', 'new project', 'new projects'],
  ['corrections', 'fix', 'fixes'],
];

/**
 * The card's sub text: what is waiting, zeros left out.
 * @param {{ edits: number, projects: number, corrections: number }} counts
 * @returns {string} '2 edits, 1 new project, 1 fix', '3 fixes' or 'Nothing waiting'
 */
export function requestsSub(counts) {
  const parts = WAITING.filter(([key]) => counts[key] > 0).map(
    ([key, one, many]) => `${counts[key]} ${plural(counts[key], one, many)}`,
  );
  return parts.length ? parts.join(', ') : 'Nothing waiting';
}

/**
 * Where the card goes: '/attendance' when only attendance fixes wait (they are handled there),
 * otherwise '/requests', also when nothing waits. Undefined when the viewer may not handle what
 * is on that screen, so the card is not a link.
 * @param {{ edits: number, projects: number, corrections: number }} counts
 * @param {object} viewer the signed-in person
 * @returns {'/requests' | '/attendance' | undefined}
 */
export function requestsHref(counts, viewer) {
  if (counts.edits + counts.projects === 0 && counts.corrections > 0) {
    return can(viewer, 'attendance.correct') ? '/attendance' : undefined;
  }
  return can(viewer, 'project_request.handle') ? '/requests' : undefined;
}

/**
 * "Pending requests": report edits, project requests and attendance fixes waiting for this
 * viewer. The bar is the share still waiting of those plus the ones created this month and
 * already handled, counted in the same scope.
 * @param {{ edits: number, projects: number, corrections: number, editsHandled?: number,
 *   projectsHandled?: number, correctionsHandled?: number }} counts
 * @param {object} viewer the signed-in person
 * @returns {{ key: 'requests', label: string, value: string, sub: string, percent: number,
 *   color: 'violet', href?: string }} `href` only when the card is a link
 */
export function requestsKpi(counts, viewer) {
  const sum = (keys) => keys.reduce((total, key) => total + (counts[key] ?? 0), 0);
  const pending = sum(['edits', 'projects', 'corrections']);
  const handled = sum(['editsHandled', 'projectsHandled', 'correctionsHandled']);
  const href = requestsHref(counts, viewer);
  return {
    key: 'requests',
    label: 'Pending requests',
    value: String(pending),
    sub: requestsSub(counts),
    percent: percent(pending, pending + handled),
    color: 'violet',
    ...(href ? { href } : {}),
  };
}
