// The share confirm's rules and words for the task form and the picker (CONTRACT 28, Linking and
// the share confirm; "From project files" picker): which picked or kept files are "Only PM and
// Admins", whether saving them with this person needs the confirm, the person the confirm names
// (`shareWith`) and the sentence it says. The people window has its own words (C3's peopleView).
// Pure and safe in the browser: the server uses the same `needsShareConfirm` rule and refuses a
// save without the confirm.
import { isProjectManager, needsShareConfirm } from '@/modules/projectFiles/access';

export const SHARE_ANYONE = 'Everyone on the project';
export const ATTACH_AND_SHARE = 'Attach and share';
export const ADD_AND_SHARE = 'Add task and share';
export const SAVE_AND_SHARE = 'Save and share';

/**
 * The share confirm's sentence: "acme-store-contract-signed.pdf is only for PM and Admins. Vishal
 * Saini will be able to open it from this task." / "2 files are only for PM and Admins. Vishal
 * Saini will be able to open them from this task." (Everyone on the project for Anyone).
 * @param {{ files: Array<{ name: string }>, personName?: string | null, anyone?: boolean }} args
 * @returns {string}
 */
export function shareText({ files, personName = null, anyone = false }) {
  const who = anyone || !personName ? SHARE_ANYONE : personName;
  const list = files ?? [];
  if (list.length === 1) {
    return `${list[0].name} is only for PM and Admins. ${who} will be able to open it from this task.`;
  }
  return `${list.length} files are only for PM and Admins. ${who} will be able to open them from this task.`;
}

/**
 * The sentence when only the count is known (a reassign the server refused, before the window has
 * the task's files): "This task has a file only for PM and Admins. Vishal Saini will be able to
 * open it from this task." / "This task has 2 files only for PM and Admins. …open them…" (the
 * people window's words).
 * @param {{ count: number, personName?: string | null, anyone?: boolean }} args
 */
export function taskShareText({ count, personName = null, anyone = false }) {
  const who = anyone || !personName ? SHARE_ANYONE : personName;
  if (count === 1) {
    return `This task has a file only for PM and Admins. ${who} will be able to open it from this task.`;
  }
  return `This task has ${count} files only for PM and Admins. ${who} will be able to open them from this task.`;
}

/**
 * A person as the access rules take them: `{ id, role, status }`, or null for anyone on the
 * project. Takes an AssigneeOption, a BoardTask's or TaskDetails' `assignee`, or null.
 * @param {{ id: number, role?: string, status?: string } | null | undefined} person
 * @returns {{ id: number, role: string | null, status: string } | null}
 */
export function personOf(person) {
  if (!person) return null;
  return { id: Number(person.id), role: person.role ?? null, status: person.status ?? 'active' };
}

/** The `shareWith` a confirmed save sends: the person's id, or '' for anyone on the project. */
export const shareWithOf = (person) => (person ? Number(person.id) : '');

/** The files of a list that are "Only PM and Admins". */
export const privateFiles = (files) => (files ?? []).filter((f) => f.visibility === 'managers');

/**
 * The files a save would let this person open through the task though they are "Only PM and
 * Admins": none when the person manages the project (its PM or an active Admin, the viewer
 * included).
 * @param {Array<{ visibility?: string }>} files
 * @param {{ id: number, role: string | null, status: string } | null} person null = anyone
 * @param {{ id: number, pmId: number | null }} project
 */
export function filesToShare(files, person, project) {
  return (files ?? []).filter((file) => needsShareConfirm(file, person, project));
}

/** True when the person is the project's PM or an active Admin (no confirm for them). */
export const managesProject = (person, project) => isProjectManager(person, project);
