// Project and task files (CONTRACT 27, Modules): one service object over the module's files, so
// other code imports only `projectFiles` from the index. Uploads and storage (A1) first, then
// access, downloads and management (A2). Before migration 019 every list and count reads as
// empty and every write answers UPDATE_NEEDED (503, the 1.10 code and sentence).

/**
 * @typedef {{ id: number, projectId: number, scope: 'project' | 'task', taskId: number | null,
 *   phase: string | null, visibility: 'everyone' | 'managers', name: string, ext: string,
 *   kind: string, typeLabel: string, sizeBytes: number, isPicture: boolean,
 *   thumbUrl: string | null, width: number | null, height: number | null,
 *   createdBy: { id: number, name: string }, createdAt: Date,
 *   task: { id: number, title: string, phase: string | null, assigneeId: number | null } | null,
 *   hasText: boolean, downloadUrl: string, viewUrl: string | null, canManage: boolean,
 *   linked: boolean, linkCount: number, linkedTasks: Array<{ id: number, title: string,
 *   assigneeId?: number | null, assigneeName?: string | null, assigneeManages?: boolean }>,
 *   sharedByLink: boolean }} ProjectFile
 *   phase: null = Whole project (always null on a task file); downloadUrl '/api/project-files/12';
 *   viewUrl '/api/project-files/12/view' for a picture, else null; thumbUrl '/thumb' with a
 *   thumbnail, else '/view' for a picture up to 2 MB, else null; hasText: a document holds its
 *   text (managers only, else false); linked: shown on a task through a link (CONTRACT 28);
 *   linkCount and linkedTasks: the tasks this viewer may see it on (the Files tab; managers also
 *   get each task's person); sharedByLink: a member reaches an "Only PM and Admins" file only
 *   through a link
 */

/**
 * @typedef {{ projectId: number, userId: number, active: boolean, manages: boolean,
 *   member: boolean }} FilesCtx one viewer and one project (access.js, Who sees and does what)
 */

/**
 * @typedef {{ ready: boolean, problem: 'not_set' | 'not_absolute' | 'inside_app' | 'public' |
 *   'not_empty' | 'not_writable' | null }} StorageStatus
 */

// ======================= A1: uploads and storage =======================
// Storage (storage.js), the limit and Space used (space.js), Start, Status and Cancel
// (uploads.js), pieces (receive.js), Finish (finish.js), files on tasks (attach.js), the nightly
// step and the reset wipe (cleanup.js), storeFile (store.js).

export { limits, spaceUsage, storageStatus } from './space';
export { checkStorage, resetStorageForTests } from './storage';
export { cancelUpload, setPieceBytesForTests, startUpload, uploadStatus } from './uploads';
export { receivePiece } from './receive';
export { finishUpload } from './finish';
export { attachUploads, countActiveForTask, deleteFilesOfTask, removeTaskFiles } from './attach';
export { cleanUp, wipeStorageForReset } from './cleanup';
export { storeFile } from './store';

// ================= A2: access, downloads and management =================
// The viewer's ctx, lists and counts, the file behind a text POST or a download (reads.js), the
// streamed download, view and thumb answers (download.js), rename, move, who sees and delete
// (manage.js).

export {
  countsForTasks,
  countTaskFilesForMember,
  fileForDocument,
  getForDownload,
  listForProject,
  listForTask,
  viewerContext,
} from './reads';
export { fileResponse, plainNotFound } from './download';
export { removeFile, updateFile } from './manage';

// ============ CONTRACT 28: files from the project on tasks (links) ============
// Linking, unlinking and the picker (links.js), the reads with links new in 1.13 (linkReads.js); the
// 1.12 reads above follow links too. The pure rules (canSeeLinkedOnTask, needsShareConfirm,
// isProjectManager) are in access.js, which the browser imports directly.

/**
 * @typedef {{ id: number, name: string, ext: string, kind: string, typeLabel: string,
 *   isPicture: boolean, thumbUrl: string | null, viewUrl: string | null, downloadUrl: string,
 *   sizeBytes: number }} FileChip
 */

/**
 * @typedef {ProjectFile & { onThisTask: boolean }} PickerFile
 */

export { chipsForTasks, countActiveLinks, privateLinkCounts } from './linkReads';
export { linkFiles, pickerFiles, shareConfirmFits, unlinkFile, unlinkFiles } from './links';
