// The Files tab (CONTRACT 27, Files tab), a server component: by `head.filesAccess`, the managers'
// tab (the project's PM and Admins), the members' tab (people on the project, a PM who is a member
// included: no Upload, no menus), or for anyone else one lock card with nothing about the files
// loaded. It loads the files and the links to tasks this viewer may see (projectFiles.listForProject,
// CONTRACT 28) and the notes and texts (projectSummaries.listDocumentsFor), with the company date
// each was added.
// Before migration 019 it shows only the update card.
import { Info, Lock } from 'lucide-react';
import Card from '@/components/Card';
import { getSessionUser } from '@/lib/session';
import { workDate } from '@/lib/time';
import { projectFiles } from '@/modules/projectFiles';
import { projectSummaries } from '@/modules/projectSummaries';
import { settings } from '@/modules/settings';
import FilesView from './_files/FilesView';
import { placeOf } from './_files/filesTabView';
import styles from './_files/FilesTab.module.css';

const UPDATE_LINE = 'Files need the latest database update. Ask an Admin.';

/** For another PM who isn't on the project: who files are for, nothing else. */
function LockCard({ pmName }) {
  const who = pmName ? `${pmName}, Admins` : 'the PM, Admins';
  return (
    <Card tone="muted">
      <p className={styles.lock}>
        <Lock size={18} strokeWidth={1.8} aria-hidden="true" />
        Files are only for {who} and people on the project.
      </p>
    </Card>
  );
}

function UpdateCard() {
  return (
    <Card tone="muted">
      <p className={styles.lock}>
        <Info size={18} strokeWidth={1.8} aria-hidden="true" />
        {UPDATE_LINE}
      </p>
    </Card>
  );
}

/** The files and documents with `addedOn`, the company date each was added. */
async function loadFiles(viewer, projectId, canManage) {
  const [ready, list, documents, storage, { timezone }] = await Promise.all([
    projectSummaries.filesReady(),
    projectFiles.listForProject({ viewer, projectId }),
    projectSummaries.listDocumentsFor({ viewer, projectId }),
    canManage ? projectFiles.storageStatus() : { ready: true },
    settings.getAll(),
  ]);
  const addedOn = (row) => ({ ...row, addedOn: workDate(timezone, row.createdAt) });
  return {
    ready,
    files: list.files.map(addedOn),
    links: list.links ?? [],
    documents: documents.map(addedOn),
    storageReady: Boolean(storage?.ready),
  };
}

/**
 * @param {{ head: object, place: string | undefined }} props head: loadProjectHead (`project`,
 *   `plan`, `filesAccess`, `limits` for managers); place: the `?place=` value
 */
export default async function FilesTab({ head, place }) {
  const { project, filesAccess } = head;
  if (filesAccess !== 'manage' && filesAccess !== 'member') {
    return <LockCard pmName={project.pmName} />;
  }
  const canManage = filesAccess === 'manage';
  // The page already asked for the session (requirePage); this is the same cached user.
  const viewer = await getSessionUser();
  const data = await loadFiles(viewer, project.id, canManage);
  if (!data.ready) return <UpdateCard />;
  return (
    <FilesView
      projectId={project.id}
      canManage={canManage}
      place={placeOf(place)}
      currentPhase={head.plan?.currentPhase ?? null}
      pmName={project.pmName ?? null}
      files={data.files}
      links={data.links}
      documents={data.documents}
      limits={canManage ? head.limits : undefined}
      storageReady={data.storageReady}
    />
  );
}
