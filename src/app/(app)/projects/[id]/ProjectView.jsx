// The project page's PM view (CONTRACT 27 and 28): the header with the project's health, the tabs
// Board, Summary, Files, Timeline and Hours, and the chosen tab under its own Suspense, so only that
// tab loads its data. For the project's PM and Admins the task actions (the people window, Assign to
// me, Move to phase…), the New task window and the attach store sit around the whole page (the
// header's "+ New task", the Board, the Table and the task window share them), and files dropped
// where nothing takes them are swallowed on every tab (FileDropGuard); the task window opens over
// any tab (`?task=`). The header's button is on every tab but the Board (whose toolbar has "Add
// task"): "+ New task", or "Reopen project" on a Completed project; the project's status as shown
// (Reopen changes it at once) is shared by the header and the board. Another PM gets the same page,
// read only.
import { Suspense } from 'react';
import { TaskAttachProvider } from '@/components/files/TaskAttachProvider';
import { TaskWindowProvider } from '@/components/task/TaskWindowProvider';
import { ProjectStatusProvider } from './_board/ReopenProject';
import { TaskActionsProvider } from './_board/TaskActionsProvider';
import { TaskEditorProvider } from './_board/TaskEditorProvider';
import BoardTab from './BoardTab';
import FileDropGuard from './FileDropGuard';
import FilesTab from './FilesTab';
import HoursTab from './HoursTab';
import { HeaderAction } from './NewTaskButton';
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
  return <BoardTab head={head} query={query} />;
}

/**
 * The task actions, the New task window, the attach store and the page-wide file drop guard, for
 * the project's PM and Admins only. The task actions are outermost, so the New and Edit task
 * windows and the task window can reach the board through them.
 */
function ManagerParts({ head, user, children }) {
  if (head.access !== 'manage') return children;
  const { project } = head;
  const viewerId = head.viewerId ?? user?.id ?? null;
  return (
    <TaskActionsProvider
      projectId={project.id}
      project={{ id: project.id, pmId: project.pmId ?? null }}
      status={project.status}
      options={head.options ?? []}
      viewerId={viewerId}
      viewerName={head.viewerName ?? user?.name ?? null}
    >
      <TaskEditorProvider
        projectId={project.id}
        options={head.options ?? []}
        plan={head.plan}
        limits={head.limits}
        storageReady={head.storageReady !== false}
        viewerId={viewerId}
      >
        <TaskAttachProvider projectId={project.id} limits={head.limits}>
          <FileDropGuard />
          {children}
        </TaskAttachProvider>
      </TaskEditorProvider>
    </TaskActionsProvider>
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
  const action =
    access === 'manage' && tab !== 'board' ? (
      <HeaderAction project={project} currentPhase={plan.currentPhase} />
    ) : undefined;
  return (
    <TaskUndoProvider>
      <ProjectStatusProvider projectId={project.id} status={project.status}>
        <ManagerParts head={head} user={user}>
          <TaskWindowProvider
            mode={access}
            projectId={project.id}
            currentPhase={plan.currentPhase}
            today={head.today}
            viewerId={head.viewerId}
          >
            <div className={styles.page}>
              <ProjectHeader project={project} forecast={forecast} actions={action} />
              <ProjectTabs projectId={project.id} tab={tab} access={access} />
              <Suspense key={tab} fallback={<TabSkeleton tab={tab} />}>
                <ChosenTab tab={tab} user={user} head={head} query={query} />
              </Suspense>
            </div>
          </TaskWindowProvider>
        </ManagerParts>
      </ProjectStatusProvider>
    </TaskUndoProvider>
  );
}
