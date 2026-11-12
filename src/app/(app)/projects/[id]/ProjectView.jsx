// The project page's frame (CONTRACT 22): the header with the project's health, the tabs, and the
// chosen tab under its own Suspense, so only that tab loads its data.
import { Suspense } from 'react';
import ProjectSquare from '@/components/ProjectSquare';
import Tag from '@/components/Tag';
import TopBar from '@/components/TopBar';
import { healthTone } from '@/modules/projectPlan/forecast';
import HoursTab from './HoursTab';
import OverviewTab from './OverviewTab';
import PhasesTab from './PhasesTab';
import ProjectTabs, { chosenTab } from './ProjectTabs';
import { TabSkeleton } from './TabSkeletons';
import { TaskUndoProvider } from './TaskUndoProvider';
import TimelineTab from './TimelineTab';
import styles from './page.module.css';

function Subtitle({ project }) {
  const parts = [project.clientName, project.pmName ? `PM: ${project.pmName}` : null];
  return (
    <>
      {[...parts, project.statusLabel].filter(Boolean).join(' · ')}
      {project.isUrgent ? (
        <span className={styles.urgent}>
          {' · '}
          {project.urgentNote ? `Urgent: ${project.urgentNote}` : 'Urgent'}
        </span>
      ) : null}
    </>
  );
}

function ChosenTab({ tab, user, head, query }) {
  if (tab === 'hours') return <HoursTab user={user} projectId={head.project.id} query={query} />;
  if (tab === 'timeline') return <TimelineTab {...head} />;
  if (tab === 'phases') return <PhasesTab user={user} {...head} />;
  return <OverviewTab user={user} {...head} />;
}

/**
 * @param {{ user: object, head: object,
 *   query: Record<string, string|string[]|undefined> }} props head: loadProjectHead; query: the
 *   page's search params
 */
export default function ProjectView({ user, head, query }) {
  const { project, forecast } = head;
  const tab = chosenTab(query);
  return (
    <div className={styles.page}>
      <TopBar
        breadcrumb={[{ label: 'Projects', href: '/projects' }, { label: project.name }]}
        title={
          <span className={styles.title}>
            <ProjectSquare project={project} size={36} className={styles.square} />
            <span className={styles.name}>{project.name}</span>
            <Tag tone={healthTone(forecast.kind)} size="md">
              {forecast.pill}
            </Tag>
          </span>
        }
        subtitle={<Subtitle project={project} />}
      />
      <ProjectTabs projectId={project.id} tab={tab} />
      <TaskUndoProvider>
        <Suspense key={tab} fallback={<TabSkeleton tab={tab} />}>
          <ChosenTab tab={tab} user={user} head={head} query={query} />
        </Suspense>
      </TaskUndoProvider>
    </div>
  );
}
