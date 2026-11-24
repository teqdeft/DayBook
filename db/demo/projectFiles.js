// acme-store's real files for the demo (CONTRACT 27): a PNG and a PDF on the PM's checkout task for
// Simran, a Word file on the Anyone task, and two Whole project files, one for everyone on the
// project and one "Only PM and Admins". They go in through projectFiles.storeFile (the same steps
// as a browser upload), after the demo rows are in, so the bytes land in the files folder with
// their rows. The bytes are the small harmless files in db/demo/files/ (make-files.mjs writes
// them). The Whole project note is a document like the others (projectDocuments.js).
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

/** A file's bytes in db/demo/files/. */
export const demoFileBytes = (name) => readFile(new URL(`./files/${name}`, import.meta.url));

/**
 * Stores acme-store's files. Without file storage (FILES_DIR not set up) it adds none and says why,
 * so the rest of the demo still loads.
 * @param {{ projectId: number }} args acme-store's id
 * @returns {Promise<{ files: number, problem: string | null }>}
 */
export async function addStoreFiles({ projectId }) {
  const storage = await projectFiles.storageStatus();
  if (!storage.ready) return { files: 0, problem: storage.problem };
  const project = await db('projects').where({ id: projectId }).first('id', 'pmId');
  const pm = await db('users').where({ id: project.pmId }).first();
  const taskIds = new Map(
    (await db('projectTasks').where({ projectId }).select('id', 'title')).map((task) => [
      task.title,
      task.id,
    ]),
  );
  for (const file of STORE_FILES) {
    const stored = { user: pm, projectId, name: file.name, bytes: await demoFileBytes(file.name) };
    if (file.task) {
      const taskId = taskIds.get(file.task);
      if (!taskId) throw new Error(`acme-store has no task "${file.task}" for ${file.name}`);
      await projectFiles.storeFile({ ...stored, target: 'task', taskId });
    } else {
      const { phase, visibility } = file;
      await projectFiles.storeFile({ ...stored, target: 'project', phase, visibility });
    }
  }
  return { files: STORE_FILES.length, problem: null };
}
