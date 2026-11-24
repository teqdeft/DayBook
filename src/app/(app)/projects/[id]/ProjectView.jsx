// The project page's PM view (CONTRACT 27): the header with the project's health, the tabs Board,
// Summary, Files, Timeline and Hours, and the chosen tab under its own Suspense, so only that tab
// loads its data. For the project's PM and Admins the New task window and the attach store sit
// around the whole page ("+ New task", the Board and the task window share them), and files
// dropped where nothing takes them are swallowed on every tab (FileDropGuard); the task window
// opens over any tab (`?task=`). Another PM gets the same page, read only.
import { Suspense } from 'react';
import { TaskAttachProvider } from '@/components/files/TaskAttachProvider';
import { TaskWindowProvider } from '@/components/task/TaskWindowProvider';
import { TaskEditorProvider } from './_board/TaskEditorProvider';
import BoardTab from './BoardTab';
import FileDropGuard from './FileDropGuard';
import FilesTab from './FilesTab';
import HoursTab from './HoursTab';
import NewTaskButton from './NewTaskButton';
import ProjectHeader from './ProjectHeader';
import ProjectTabs, { chosenTab } from './ProjectTabs';
import SummaryTab from './SummaryTab';
import { TabSkeleton } from './TabSkeletons';
import { TaskUndoProvider } from './TaskUndoProvider';
import TimelineTab from './TimelineTab';
import styles from './page.module.css';

const first = (value) => (Array.isArray(value) ? value[0] : value);

function ChosenTab({ tab, user, head, query }) {
  if (tab === 'hours') return <HoursTab user={user} projectId={head.project.id} query={query} />;
  if (tab === 'timeline') return <TimelineTab {...head} />;
  if (tab === 'summary') return <SummaryTab head={head} user={user} />;
  if (tab === 'files') return <FilesTab head={head} place={first(query?.place)} />;
  return <BoardTab head={head} />;
}

/**
 * The New task window, the attach store and the page-wide file drop guard, for the project's PM
 * and Admins only.
 */
function ManagerParts({ head, user, children }) {
  if (head.access !== 'manage') return children;
  const projectId = head.project.id;
  return (
    <TaskEditorProvider
      projectId={projectId}
      options={head.options ?? []}
      plan={head.plan}
      limits={head.limits}
      storageReady={head.storageReady !== false}
      viewerId={user?.id ?? null}
    >
      <TaskAttachProvider projectId={projectId} limits={head.limits}>
        <FileDropGuard />
        {children}
      </TaskAttachProvider>
    </TaskEditorProvider>
  );
}

/**
 * @param {{ user: object, head: object,
 *   query: Record<string, string|string[]|undefined> }} props head: loadProjectHead with access
 *   'manage' or 'team'; query: the page's search params
 */
export default function ProjectView({ user, head, query }) {
  const { project, plan, forecast, access } = head;
  const tab = chosenTab(query, access);
  const canAdd = access === 'manage' && project.status !== 'completed';
  return (
    <TaskUndoProvider>
      <ManagerParts head={head} user={user}>
        <TaskWindowProvider
          mode={access}
          projectId={project.id}
          currentPhase={plan.currentPhase}
          today={head.today}
        >
          <div className={styles.page}>
            <ProjectHeader
              project={project}
              forecast={forecast}
              actions={canAdd ? <NewTaskButton currentPhase={plan.currentPhase} /> : undefined}
            />
            <ProjectTabs projectId={project.id} tab={tab} access={access} />
            <Suspense key={tab} fallback={<TabSkeleton tab={tab} />}>
              <ChosenTab tab={tab} user={user} head={head} query={query} />
            </Suspense>
          </div>
        </TaskWindowProvider>
      </ManagerParts>
    </TaskUndoProvider>
  );
}
