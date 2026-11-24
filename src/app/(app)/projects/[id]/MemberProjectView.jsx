// The project page for a person on the project (CONTRACT 27, The member's project page): read
// only. The header has no health, the tabs are Board and Files, and the band sits inside the Board
// tab with "Your hours this month" and no forecast. The board shows only their own tasks and tasks
// for anyone on the project; cards open the task window read only (with "Add to to-do" while
// today's to-do takes lines: `head.todoOpen`, false once the report is in). Never on
// this page: health, forecast, AI, Summary, Timeline, Hours, other people's tasks, names on them,
// hours or report lines, attendance, leave, screen time.
import { Suspense } from 'react';
import { TaskWindowProvider } from '@/components/task/TaskWindowProvider';
import BoardTab from './BoardTab';
import FilesTab from './FilesTab';
import ProjectHeader from './ProjectHeader';
import ProjectTabs, { chosenTab } from './ProjectTabs';
import { TabSkeleton } from './TabSkeletons';
import styles from './page.module.css';

const first = (value) => (Array.isArray(value) ? value[0] : value);

/**
 * @param {{ head: object, query: Record<string, string|string[]|undefined> }} props head:
 *   loadProjectHead with access 'member' (no forecast; `hoursThisMonth`, `todoOpen`); query: the
 *   page's search params
 */
export default function MemberProjectView({ head, query }) {
  const { project } = head;
  const tab = chosenTab(query, 'member');
  return (
    <TaskWindowProvider
      mode="member"
      projectId={project.id}
      currentPhase={head.plan?.currentPhase ?? null}
      today={head.today}
      todoOpen={head.todoOpen === true}
    >
      <div className={styles.page}>
        <ProjectHeader project={project} member />
        <ProjectTabs projectId={project.id} tab={tab} access="member" />
        <Suspense key={tab} fallback={<TabSkeleton tab={tab} member />}>
          {tab === 'files' ? (
            <FilesTab head={head} place={first(query?.place)} />
          ) : (
            <BoardTab head={head} />
          )}
        </Suspense>
      </div>
    </TaskWindowProvider>
  );
}
