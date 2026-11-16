// Planned projects in the report editor (CONTRACT 24, browser side, pure). A card at 0 minutes
// with no Done line is "planned": the person meant to work on it, so it may be submitted at 0
// hours next to a worked project, its tasks stay open and are suggested next time, and the Slack
// preview leaves it out. The same rule as the server's `isPlannedEntry` (reports/planned.js), on
// the editor's rows: their minutes come from the hours box (entryMinutes).
import { entryMinutes } from './reportHours';

/** The card's lines with something written (a blank row being typed doesn't count). */
export function writtenLines(entry) {
  return (entry?.tasks ?? []).filter((task) => String(task.title ?? '').trim());
}

/**
 * Whether a card is a planned project: 0 minutes and no Done line. A card with nothing written
 * counts too, as on the server (it is dropped on submit), so the Slack preview leaves it out.
 * @param {object} entry an editor row
 * @returns {boolean}
 */
export function isPlannedRow(entry) {
  if (entryMinutes(entry) > 0) return false;
  return !writtenLines(entry).some((task) => task.status === 'done');
}

/** "Not worked on today. Its tasks stay open." under the card's head: planned, with a line. */
export function showsPlannedNote(entry) {
  return isPlannedRow(entry) && writtenLines(entry).length > 0;
}

/**
 * The notice above the cards ("Add the hours for each project and check each status."): while
 * the report is a draft that has a line and a project at 0 minutes, as when it was planned on
 * Today.
 * @param {object[]} entries the editor rows
 * @param {string} status the report's status
 */
export function showsHoursNotice(entries, status) {
  if (status !== 'draft') return false;
  const hasLine = entries.some((entry) => writtenLines(entry).length > 0);
  return hasLine && entries.some((entry) => entryMinutes(entry) <= 0);
}
