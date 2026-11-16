// Planned projects (CONTRACT 24, company rule of 12 Nov 2026), pure. A project in a report at 0
// minutes with no Done line is "planned": it may be submitted at 0 hours alongside worked
// projects, it is saved with the report so its tasks stay open and are suggested next time, and
// it is left out of the Slack text, the hour totals and anything that reads as worked. A 0-hour
// project with no task written is dropped on submit, like empty task rows.

/** The task lines with something written (blank rows are ignored everywhere). */
export function writtenTasks(entry) {
  return (entry?.tasks ?? []).filter((task) => String(task.title ?? '').trim());
}

/**
 * Whether an entry is a planned project: 0 minutes and no Done line (a blank row doesn't count).
 * An entry without tasks counts too (it is dropped on submit, see isEmptyEntry).
 * @param {{ minutes?: number, tasks?: Array<{ title?: string, status: string }> }} entry
 * @returns {boolean}
 */
export function isPlannedEntry(entry) {
  if ((Number(entry?.minutes) || 0) > 0) return false;
  return !writtenTasks(entry).some((task) => task.status === 'done');
}

/**
 * Whether an entry has 0 minutes and no task written: submit drops it.
 * @param {{ minutes?: number, tasks?: Array<{ title?: string }> }} entry
 * @returns {boolean}
 */
export function isEmptyEntry(entry) {
  return (Number(entry?.minutes) || 0) <= 0 && writtenTasks(entry).length === 0;
}
