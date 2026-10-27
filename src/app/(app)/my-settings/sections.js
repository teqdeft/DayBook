// My settings (CONTRACT 21): which sections a person sees, in page order, and the choices of each
// Segmented row. Pure (no server imports), so the page decides with it and the client renders it.
import { can } from '@/lib/permissions';

/** Every section in page order; the section list on the left uses the same labels. */
export const SECTIONS = Object.freeze([
  { id: 'report', label: 'Daily report' },
  { id: 'ai', label: 'AI' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'appearance', label: 'Appearance' },
]);

/**
 * Whether someone writes daily reports: `report.self`, except an Admin who doesn't track
 * attendance, whose sidebar has no Today or My log either (navigationFor).
 * @param {{ role: string, status?: string, tracksAttendance?: boolean }} user the session user
 * @returns {boolean}
 */
export function writesReports(user) {
  if (!can(user, 'report.self')) return false;
  return !(user.role === 'admin' && !user.tracksAttendance);
}

/**
 * The sections that apply to someone: Daily report for people who write reports, AI for them
 * while the company's polish is available, Notifications and Appearance for everyone. A section
 * left out loses its anchor too.
 * @param {{ writesReports: boolean, polishAvailable: boolean }} who writesReports: see
 *   writesReports(user); polishAvailable: `ai.isAvailable('polish')`
 * @returns {{ id: string, label: string }[]}
 */
export function sectionsFor({ writesReports, polishAvailable }) {
  return SECTIONS.filter(({ id }) => {
    if (id === 'report') return writesReports === true;
    if (id === 'ai') return writesReports === true && polishAvailable === true;
    return true;
  });
}

/** "Submit buttons": which of the report's submit buttons show. */
export const SUBMIT_BUTTON_CHOICES = Object.freeze([
  { value: 'both', label: 'Both' },
  { value: 'checkout', label: 'Submit and check out' },
  { value: 'submit', label: 'Submit report' },
]);

/** "New tasks start as": the status of a task line added by hand. */
export const NEW_TASK_CHOICES = Object.freeze([
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
]);

/** "Theme": 'system' follows the computer's light or dark setting. */
export const THEME_CHOICES = Object.freeze([
  { value: 'system', label: 'Match my computer' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]);
