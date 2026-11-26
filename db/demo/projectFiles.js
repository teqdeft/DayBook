// acme-store's real files for the demo (CONTRACT 27): a PNG and a PDF on the PM's checkout task for
// Simran, a Word file on the Anyone task, and two Whole project files, one for everyone on the
// project and one "Only PM and Admins". They go in through projectFiles.storeFile (the same steps
// as a browser upload), after the demo rows are in, so the bytes land in the files folder with
// their rows. The bytes are the small harmless files in db/demo/files/ (make-files.mjs writes
// them). The Whole project note is a document like the others (projectDocuments.js). From 1.13
// (CONTRACT 28) the brand guide is also linked to the checkout task, through projectFiles.linkFiles
// as a PM's save does; the managers-only contract stays unlinked (the e2e links it).
import { readFile } from 'node:fs/promises';
import { db } from '@/lib/db';
import { projectFiles } from '@/modules/projectFiles';

const CHECKOUT_TASK = 'Checkout fix before client demo';
const ANYONE_TASK = 'Product image zoom';

/** What goes on acme-store: a task's file names its task, a project file its place and who sees it. */
export const STORE_FILES = [
  { name: 'card-payment-error.png', task: CHECKOUT_TASK },
  { name: 'checkout-error-steps.pdf', task: CHECKOUT_TASK },
  { name: 'zoom-notes.docx', task: ANYONE_TASK },
  { name: 'acme-brand-guide.pdf', phase: null, visibility: 'everyone' },
  { name: 'acme-store-contract-signed.pdf', phase: null, visibility: 'managers' },
];

/** Project files linked to a task (CONTRACT 28): the file by name, the task by title. */
export const STORE_LINKS = [{ name: 'acme-brand-guide.pdf', task: CHECKOUT_TASK }];

/** A file's bytes in db/demo/files/. */
export const demoFileBytes = (name) => readFile(new URL(`./files/${name}`, import.meta.url));

/**
 * Links the STORE_LINKS, each in its own transaction that locks the task row first (the order of
 * every link save). The files are for everyone, so no share confirm is needed.
 * @returns {Promise<number>} how many links were made
 */
async function linkStoreFiles({ pm, project, taskIds, fileIds }) {
  let made = 0;
  for (const link of STORE_LINKS) {
    const taskId = taskIds.get(link.task);
    const fileId = fileIds.get(link.name);
    if (!taskId || !fileId) throw new Error(`acme-store can't link ${link.name} to "${link.task}"`);
    made += await db.transaction(async (trx) => {
      const task = await trx('projectTasks').where({ id: taskId }).forUpdate().first();
      const linked = await projectFiles.linkFiles(
        { user: pm, project, task, fileIds: [fileId] },
        trx,
      );
      return linked.length;
    });
  }
  return made;
}

/**
 * Stores acme-store's files, then links the STORE_LINKS. Without file storage (FILES_DIR not set
 * up) it adds none and says why, so the rest of the demo still loads.
 * @param {{ projectId: number }} args acme-store's id
 * @returns {Promise<{ files: number, links: number, problem: string | null }>}
 */
export async function addStoreFiles({ projectId }) {
  const storage = await projectFiles.storageStatus();
  if (!storage.ready) return { files: 0, links: 0, problem: storage.problem };
  const project = await db('projects').where({ id: projectId }).first('id', 'pmId');
  const pm = await db('users').where({ id: project.pmId }).first();
  const taskIds = new Map(
    (await db('projectTasks').where({ projectId }).select('id', 'title')).map((task) => [
      task.title,
      task.id,
    ]),
  );
  const fileIds = new Map();
  for (const file of STORE_FILES) {
    const stored = { user: pm, projectId, name: file.name, bytes: await demoFileBytes(file.name) };
    if (file.task) {
      const taskId = taskIds.get(file.task);
      if (!taskId) throw new Error(`acme-store has no task "${file.task}" for ${file.name}`);
      await projectFiles.storeFile({ ...stored, target: 'task', taskId });
    } else {
      const { phase, visibility } = file;
      const saved = await projectFiles.storeFile({
        ...stored,
        target: 'project',
        phase,
        visibility,
      });
      fileIds.set(file.name, saved.id);
    }
  }
  const links = await linkStoreFiles({ pm, project, taskIds, fileIds });
  return { files: STORE_FILES.length, links, problem: null };
}
