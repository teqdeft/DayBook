// One project on My projects (artboard 04): label, client and status, the person's hours this
// month and last update, their open priority tasks (not on the canvas), the PM and the team.
import { cache } from 'react';
import { Flag } from 'lucide-react';
import { AvatarStack } from '@/components/Avatar';
import Card from '@/components/Card';
import { ProjectSquare } from '@/components/ProjectLabel';
import StatusCell from '@/components/StatusCell';
import { logger } from '@/lib/logger';
import { getSessionUser } from '@/lib/session';
import { plural } from '@/lib/text';
import { formatHours, formatRelativeDay } from '@/lib/time';
import { projectTasks } from '@/modules/projectTasks';
import styles from './ProjectCard.module.css';

/**
 * The signed-in person's open priority tasks per project, read once per request for all the
 * cards. The cards still render if it fails.
 */
const openPriorityCounts = cache(async () => {
  const user = await getSessionUser();
  if (!user) return {};
  try {
    return await projectTasks.countOpenByProjectForUser(user.id);
  } catch (error) {
    logger.warn({ err: error, userId: user.id }, 'my projects: could not load priority tasks');
    return {};
  }
});

/** "2 priority tasks · 1 P1": open tasks for the person or for anyone on the project. */
function PriorityLine({ counts }) {
  if (!counts?.total) return null;
  return (
    <p className={styles.priority}>
      <Flag
        size={15}
        strokeWidth={1.8}
        aria-hidden="true"
        className={counts.p1 ? styles.flagP1 : styles.flag}
      />
      <span>{`${counts.total} priority ${plural(counts.total, 'task')}`}</span>
      {counts.p1 ? (
        <>
          <span aria-hidden="true">·</span>
          <span className={styles.p1}>{`${counts.p1} P1`}</span>
        </>
      ) : null}
    </p>
  );
}

/** Urgent shows instead of Active. */
export function displayStatus(project) {
  return project.isUrgent && project.status === 'active' ? 'urgent' : project.status;
}

/**
 * @param {{ project: object, minutes: number, lastDate: string | null, today: string,
 *   priority?: { total: number, p1: number } | null }} props priority: the open priority task
 *   counts; read for the signed-in person when not passed
 */
export default async function ProjectCard({ project, minutes, lastDate, today, priority }) {
  const lastUpdate = lastDate ? formatRelativeDay(lastDate, today) : 'Not yet';
  const counts = priority === undefined ? (await openPriorityCounts())[project.id] : priority;
  return (
    <Card as="article" className={styles.card} aria-labelledby={`project-${project.id}`}>
      <div className={styles.head}>
        <ProjectSquare project={project} size={42} />
        <div className={styles.titles}>
          <h2 id={`project-${project.id}`} className={styles.name}>
            {project.name}
          </h2>
          <p className={styles.client}>{project.clientName}</p>
        </div>
        <StatusCell status={displayStatus(project)} size="pill" className={styles.status} />
      </div>
      <dl className={styles.stats}>
        <div className={styles.stat}>
          <dt className={styles.label}>Your hours this month</dt>
          <dd className={styles.hours}>{formatHours(minutes)}</dd>
        </div>
        <div className={styles.stat}>
          <dt className={styles.label}>Your last update</dt>
          <dd className={styles.update}>{lastUpdate}</dd>
        </div>
      </dl>
      <PriorityLine counts={counts} />
      <div className={styles.foot}>
        <p className={styles.pm}>PM: {project.pmName ?? 'Not set'}</p>
        <AvatarStack users={project.members} max={4} size={30} className={styles.team} />
      </div>
    </Card>
  );
}
