// What the New task and Edit task window says after a save (CONTRACT 28, Every message: Toasts and
// Told bodies): who the save told, from the answer's `told`, `toldName` and `toldEarlierName`, and
// the toast after adding a task or saving changes (files added and removed count uploads and
// project files together). Pure and safe in the browser (taskFormModel.js re-exports it).
import { plural } from '@/lib/text';
import { isPhase, phaseLabel } from '@/modules/projectPlan/phases';
import { NO_PHASE_LABEL } from '../phasesView';

const EVERYONE = 'Everyone on the project';

/** Who a save told, in 1.12's words: the person's name, "Everyone on the project", or null. */
export function toldWho(told, toldName) {
  if (told === 'person') return toldName || null;
  if (told === 'members') return EVERYONE;
  return null;
}

/**
 * The told body of a person change: "Vishal Saini and Simran Kaur get a notification.", "Vishal
 * Saini gets a notification.", "Simran Kaur gets a notification." (the earlier person only),
 * "Everyone on the project gets a notification." ("Everyone on the project and Riya Kapoor get a
 * notification." when an earlier person who isn't a member was told too), or null (nobody).
 * @param {{ told?: string | null, toldName?: string | null, toldEarlierName?: string | null }} args
 */
export function toldBody({ told, toldName, toldEarlierName }) {
  const earlier = toldEarlierName || null;
  if (told === 'members') {
    return earlier
      ? `${EVERYONE} and ${earlier} get a notification.`
      : `${EVERYONE} gets a notification.`;
  }
  const names = [told === 'person' ? toldName : null, earlier].filter(Boolean);
  const unique = names.filter((name, at) => names.indexOf(name) === at);
  if (unique.length === 0) return null;
  if (unique.length === 1) return `${unique[0]} gets a notification.`;
  return `${unique[0]} and ${unique[1]} get a notification.`;
}

/**
 * The toast after adding a task: "Task added to Testing." and who gets a notification (with the
 * file names when files went with it; uploads and project files count together).
 * @param {{ phase: string | null, told?: string | null, toldName?: string | null,
 *   files?: number }} args
 */
export function addedToast({ phase, told, toldName, files = 0 }) {
  const title = `Task added to ${isPhase(phase) ? phaseLabel(phase) : NO_PHASE_LABEL}.`;
  const who = toldWho(told, toldName);
  if (!who) return { title };
  const names = files > 0 ? ` with the ${files === 1 ? 'file name' : `${files} file names`}` : '';
  return { title, body: `${who} gets a notification${names}.` };
}

/** "2 files added.", "2 files added and 1 removed.", "1 file removed.", or null. */
function filesLine(added, removed) {
  if (added && removed) return `${added} ${plural(added, 'file')} added and ${removed} removed.`;
  if (added) return `${added} ${plural(added, 'file')} added.`;
  if (removed) return `${removed} ${plural(removed, 'file')} removed.`;
  return null;
}

/**
 * The toast after an edit: "Changes saved." with what happened to the files and, after a person
 * change, who gets a notification ("2 files added. Vishal Saini and Simran Kaur get a
 * notification."); without one, 1.12's "Simran Kaur is told." after files were added.
 * @param {{ told?: string | null, toldName?: string | null, toldEarlierName?: string | null,
 *   added?: number, removed?: number, personChanged?: boolean }} args
 */
export function savedToast({
  told,
  toldName,
  toldEarlierName,
  added = 0,
  removed = 0,
  personChanged = false,
}) {
  const files = filesLine(added, removed);
  let body;
  if (personChanged) {
    body = [files, toldBody({ told, toldName, toldEarlierName })].filter(Boolean).join(' ');
  } else {
    const who = toldWho(told, toldName);
    body = files && added && who ? `${files} ${who} is told.` : files;
  }
  return body ? { title: 'Changes saved.', body } : { title: 'Changes saved.' };
}
