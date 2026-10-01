// The Slack report text, in the team's existing format (build guide section 11). Pure and free of
// imports: the report page's Slack preview imports it in the browser, so the preview always
// matches what posts.

export const STATUS_LABELS = {
  done: 'Done',
  in_progress: 'In Progress',
  blocked: 'Blocked',
};

/** 'YYYY-MM-DD' -> 'DD-MM-YYYY'. Anything else is shown as given. */
function dateDmy(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  return match ? `${match[3]}-${match[2]}-${match[1]}` : String(value ?? '');
}

/** Minutes as hours without trailing zeros: 120 -> '2', 90 -> '1.5', 15 -> '0.25'. */
export function formatSlackHours(minutes) {
  const hours = Number(minutes) / 60;
  return Number.isFinite(hours) ? String(Number(hours.toFixed(2))) : '0';
}

/** One line of text: newlines and runs of spaces collapse to a single space. */
function oneLine(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function entryMinutes(entry) {
  if (entry.minutes !== undefined && entry.minutes !== null) return entry.minutes;
  if (entry.hours !== undefined && entry.hours !== null && entry.hours !== '')
    return Number(entry.hours) * 60;
  return 0;
}

/**
 * Builds the Slack text for a daily report:
 *
 *   Name: Vishal Saini
 *   Date: 30-09-2026
 *
 *   Project: iwilltillimwell
 *   Hours: 2
 *   Tasks
 *   • Content changes (Done)
 *
 *   Project: internal-tool
 *   ...
 *
 * Tasks with an empty title (a row still being typed) are left out.
 * @param {{ userName: string, workDate: string, entries: Array<{ projectName: string,
 *   minutes?: number, hours?: number | string, tasks?: Array<{ title: string, status: string }> }> }} report
 *   minutes per entry (hours is accepted instead, for drafts that hold hours)
 * @returns {string}
 */
export function formatReport({ userName, workDate, entries } = {}) {
  const blocks = [`Name: ${oneLine(userName)}\nDate: ${dateDmy(workDate)}`];
  for (const entry of entries ?? []) {
    const lines = [
      `Project: ${oneLine(entry.projectName)}`,
      `Hours: ${formatSlackHours(entryMinutes(entry))}`,
      'Tasks',
    ];
    for (const task of entry.tasks ?? []) {
      const title = oneLine(task.title);
      if (!title) continue;
      lines.push(`• ${title} (${STATUS_LABELS[task.status] ?? oneLine(task.status)})`);
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

/**
 * Escapes the three characters Slack treats as control characters (&, <, >), so text people typed
 * shows exactly as written. Used when the outbox sends a report; the preview shows the raw text.
 * @param {string} text
 */
export function escapeSlackText(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
