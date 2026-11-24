// The files an uploader holds, without React (CONTRACT 27, Upload states and every message): the
// early checks on every picked or dropped file (in this order: empty, too big, already in the
// list; then the 21st file of a task and more than 50 at once), the chip's state line, and an
// upload's snapshot turned into the item a chip draws. The server checks again with the same
// rules; these words come from fileMessages.js, with the browser's own copy of the name.
import * as messages from '@/modules/projectFiles/fileMessages';
import { formatSize, isPictureExt, typeLabel } from '@/modules/projectFiles/kinds';
import { cleanFileName, extOf } from '@/modules/projectFiles/names';

/** A local preview is made only for these types (a `blob:` SVG opened as a page would run). */
const PREVIEW_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
/** "Big files take a few minutes." joins the help once a picked file is over 100 MB. */
export const BIG_FILE_BYTES = 100 * 1024 * 1024;
export const RUNNING = Object.freeze(['waiting', 'uploading', 'retrying']);

/**
 * Whether a picked file may show a local preview: a picture extension AND a picture type.
 * @param {{ name: string, type?: string }} file
 */
export function canPreview(file) {
  return isPictureExt(extOf(file?.name)) && PREVIEW_TYPES.has(file?.type);
}

/**
 * The early checks of one pick or drop.
 * @param {ArrayLike<File>} fileList
 * @param {{ existing?: { name: string, size?: number, sizeBytes?: number }[],
 *   limits: { maxFileBytes: number, maxTaskFiles: number, pickMax: number },
 *   task?: boolean }} options existing: the files already in the list or on the task (and not
 *   failed), for "already" and the 20 of a task; task: a task uploader ("already attached", 20)
 * @returns {{ results: { file: File, name: string, size: number, message: string | null }[],
 *   notices: string[] }} results: in the order picked, `message` set on a file that failed a
 *   check (an Error chip); files past a task's 20 aren't in it; notices: the lines under the
 *   box (pick max, a task's 20)
 */
export function checkPicked(fileList, { existing = [], limits, task = false }) {
  const notices = [];
  let files = Array.from(fileList ?? []);
  if (files.length > limits.pickMax) {
    files = files.slice(0, limits.pickMax);
    notices.push(messages.pickMax({ pickMax: limits.pickMax }));
  }
  const seen = new Set(existing.map((f) => `${f.name}\u0000${f.size ?? f.sizeBytes}`));
  let count = existing.length;
  let full = false;
  const results = [];
  for (const file of files) {
    const name = cleanFileName(file.name);
    const size = file.size;
    const twin = `${name}\u0000${size}`;
    let message = null;
    if (size <= 0) message = messages.empty(name);
    else if (size > limits.maxFileBytes) {
      message = messages.tooBig({ name, size, maxBytes: limits.maxFileBytes });
    } else if (seen.has(twin)) {
      message = task ? messages.alreadyAttached(name) : messages.alreadyInList(name);
    } else if (task && count >= limits.maxTaskFiles) {
      full = true;
      continue;
    }
    if (!message) {
      seen.add(twin);
      count += 1;
    }
    results.push({ file, name, size, message });
  }
  if (full) notices.push(messages.taskFull({ maxTaskFiles: limits.maxTaskFiles }));
  return { results, notices };
}

/** "PDF · 340 KB" */
export function typeAndSize(name, size) {
  return `${typeLabel(extOf(name))} · ${formatSize(size)}`;
}

/**
 * The words of a failure, with the file's name.
 * @param {{ code: string, message?: string | null, reason?: string,
 *   fields?: Record<string, string> }} failure
 * @param {string} name
 */
export function failureText(failure, name) {
  if (!failure) return messages.paused(name);
  const fieldMessage =
    failure.code === 'VALIDATION_FAILED' && Object.values(failure.fields ?? {})[0];
  if (fieldMessage) return fieldMessage;
  return messages.forCode(failure.code, {
    name,
    message: failure.message ?? undefined,
    uploadStatus: failure.reason,
  });
}

/**
 * A new item for a picked file.
 * @param {{ id: string, file: File, name: string, size: number, state: string,
 *   message?: string | null }} parts
 */
export function newItem({ id, file, name, size, state, message = null }) {
  return {
    id,
    name,
    size,
    ext: extOf(name),
    source: file,
    previewUrl: null,
    state,
    percent: 0,
    message,
    canRetry: false,
    key: null,
    file: null,
  };
}

/**
 * The item after an upload's snapshot (uploadClient.js). A cancelled upload returns null (the
 * item goes).
 * @param {object} item
 * @param {import('./uploadClient').UploadSnapshot} snapshot
 */
export function itemAfter(item, snapshot) {
  const { phase, percent, key, failure, result } = snapshot;
  if (phase === 'cancelled') return null;
  const next = { ...item, state: phase, percent, key: key ?? item.key };
  if (phase === 'error') {
    next.message = failureText(failure, item.name);
    next.canRetry = Boolean(failure?.canRetry);
  } else if (phase === 'paused') {
    next.message = messages.paused(item.name);
    next.canRetry = true;
  } else {
    next.message = null;
    next.canRetry = false;
  }
  // A project file comes back as a ProjectFile, a task file as its held upload `{ key, ... }`.
  if (phase === 'done' && result) {
    if (result.downloadUrl) next.file = result;
    else next.key = result.key ?? next.key;
  }
  return next;
}

/**
 * The chip's state line (the progress bar and the percent are drawn by the chip). A row the
 * Files tab adds while it reads a file's text for the AI (`state: 'reading'`) shows its message.
 * @param {object} item
 * @param {{ removed?: boolean }} [options] removed: an attached file marked on the Edit window
 */
export function stateLine(item, { removed = false } = {}) {
  if (removed) return 'Removed when you save';
  switch (item.state) {
    case 'waiting':
      return 'Waiting…';
    case 'uploading':
      return 'Uploading…';
    case 'retrying':
      return 'Connection lost. Trying again…';
    case 'paused':
    case 'error':
      return item.message ?? messages.paused(item.name);
    case 'reading':
      return item.message ?? '';
    default:
      return typeAndSize(item.name, item.size);
  }
}
