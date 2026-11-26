// The Files tab's items (CONTRACT 27, Files tab, and CONTRACT 28, Files tab): each file, note and
// text-only document once, and each link once (only listed under its task in On tasks), from the
// server's lists for this viewer. Pure and safe in the browser; filesTabView.js re-exports it.

const timeOf = (value) => (value ? new Date(value).getTime() : 0);

/** One linked file under its task ("On tasks"): the project file as the server gave it. */
function linkItem(file, link) {
  return {
    key: `link:${link.taskId}-${file.id}`,
    type: 'link',
    id: file.id,
    name: file.name,
    phase: file.phase ?? null, // the file's own place ("From Design")
    size: Number(file.sizeBytes) || 0,
    at: timeOf(file.createdAt),
    addedOn: file.addedOn ?? null,
    by: file.createdBy?.name ?? '',
    visibility: file.visibility ?? 'managers',
    shared: Boolean(file.sharedByLink),
    file,
    task: { id: link.taskId, title: link.taskTitle, phase: link.taskPhase ?? null },
    text: null,
  };
}

/** One file of the tab (a project file, or a task's own file). */
function fileItem(file, texts) {
  const onTask = file.scope === 'task';
  return {
    key: `file:${file.id}`,
    type: onTask ? 'task' : 'file',
    id: file.id,
    name: file.name,
    phase: (onTask ? file.task.phase : file.phase) ?? null,
    size: Number(file.sizeBytes) || 0,
    at: timeOf(file.createdAt),
    addedOn: file.addedOn ?? null,
    by: file.createdBy?.name ?? '',
    visibility: onTask ? null : (file.visibility ?? 'managers'),
    shared: !onTask && Boolean(file.sharedByLink),
    file,
    task: onTask ? file.task : null,
    text: onTask ? null : (texts.get(Number(file.id)) ?? null),
  };
}

/**
 * The tab's items: each file, note and text-only document once, and each link once (`type
 * 'link'`, only in On tasks). A project file gets the document holding its text (`text`), when the
 * viewer may see it; `shared` marks a file the viewer reaches only through a link.
 * @param {{ files?: object[], documents?: object[], links?: object[] }} data files: ProjectFile[]
 *   with `addedOn` (the company date); documents: listDocumentsFor's rows with `addedOn` and
 *   `createdByName`; links: listForProject's `links` (`{ fileId, taskId, taskTitle, taskPhase }`)
 * @returns {Array<{ key: string, type: 'file' | 'task' | 'link' | 'note' | 'text', id: number,
 *   name: string, phase: string | null, size: number, at: number, addedOn: string, by: string,
 *   visibility: 'everyone' | 'managers' | null, shared?: boolean, file?: object,
 *   task?: object | null, text?: object | null, document?: object }>} phase: a task file's is its
 *   task's, a link's its file's place; size -1 for notes and texts
 */
export function filesItems({ files = [], documents = [], links = [] } = {}) {
  const texts = new Map();
  for (const document of documents) {
    if (document.fileId !== null && document.fileId !== undefined) {
      texts.set(Number(document.fileId), document);
    }
  }
  const items = [];
  const projectFiles = new Map();
  for (const file of files) {
    if (file.scope === 'task' && !file.task) continue;
    if (file.scope !== 'task') projectFiles.set(Number(file.id), file);
    items.push(fileItem(file, texts));
  }
  for (const link of links) {
    const file = projectFiles.get(Number(link.fileId));
    if (file) items.push(linkItem(file, link));
  }
  for (const document of documents) {
    if (document.fileId !== null && document.fileId !== undefined) continue;
    items.push({
      key: `doc:${document.id}`,
      type: document.kind === 'note' ? 'note' : 'text',
      id: document.id,
      name: document.title,
      phase: document.phase ?? null,
      size: -1,
      at: timeOf(document.createdAt),
      addedOn: document.addedOn ?? null,
      by: document.createdByName ?? '',
      visibility: document.visibility ?? 'managers',
      document,
    });
  }
  return items;
}
