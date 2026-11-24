// One project on My projects (artboard 04): label, client and status, the person's hours this
// month and last update, their open priority tasks (not on the canvas), the PM and the team.
// CONTRACT 27: the name links to the project page and the whole card is clickable (a stretched
// link); under the client a mini band of the six phases and "Development · 66% · Deadline 16 Dec";
// the priority line adds the files on their own and Anyone tasks ("3 files").
import { cache } from 'react';
import Link from 'next/link';
import { Flag, Paperclip } from 'lucide-react';
import { AvatarStack } from '@/components/Avatar';
import Card from '@/components/Card';
import { ProjectSquare } from '@/components/ProjectLabel';
import StatusCell from '@/components/StatusCell';
import { logger } from '@/lib/logger';
import { getSessionUser } from '@/lib/session';
import { plural } from '@/lib/text';
import { formatHours, formatRelativeDay } from '@/lib/time';
import { projectTasks } from '@/modules/projectTasks';
import { miniBand, phaseLine } from './projectCardView';
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

/** "3 files" with its paperclip: the files on the person's own and Anyone tasks. */
function Files({ count, first }) {
  return (
    <>
      {first ? null : <span aria-hidden="true">·</span>}
      <Paperclip size={14} strokeWidth={1.8} aria-hidden="true" className={styles.flag} />
      <span>{`${count} ${plural(count, 'file')}`}</span>
    </>
  );
}

/** "2 priority tasks · 1 P1 · 3 files": open tasks for the person or for anyone on the project. */
function PriorityLine({ counts, fileCount = 0 }) {
  const total = counts?.total ?? 0;
  if (!total && !(fileCount > 0)) return null;
  return (
    <p className={styles.priority}>
      {total ? (
        <>
          <Flag
            size={15}
            strokeWidth={1.8}
            aria-hidden="true"
            className={counts.p1 ? styles.flagP1 : styles.flag}
          />
          <span>{`${total} priority ${plural(total, 'task')}`}</span>
        </>
      ) : null}
      {total && counts.p1 ? (
        <>
          <span aria-hidden="true">·</span>
          <span className={styles.p1}>{`${counts.p1} P1`}</span>
        </>
      ) : null}
      {fileCount > 0 ? <Files count={fileCount} first={!total} /> : null}
    </p>
  );
}

/** The six phases as a 6 px band (decorative: the line under it says the same in words). */
function MiniBand({ plan, progress }) {
  return (
    <span className={styles.band} aria-hidden="true">
      {miniBand({ plan, progress }).map((part) => (
        <span
          key={part.key}
          className={`${styles.part} ${styles[part.state]}`}
          style={part.state === 'current' ? { '--fill': `${part.fill}%` } : undefined}
        />
      ))}
    </span>
  );
}

/** Urgent shows instead of Active. */
export function displayStatus(project) {
  return project.isUrgent && project.status === 'active' ? 'urgent' : project.status;
}

/**
 * @param {{ project: object, minutes: number, lastDate: string | null, today: string,
 *   priority?: { total: number, p1: number } | null,
 *   plan?: { currentPhase: string | null, deadline: string | null } | null,
 *   progress?: { total: number, done: number } | null, fileCount?: number }} props priority: the
 *   open priority task counts, read for the signed-in person when not passed; plan and progress:
 *   projectPlan.listPlans and projectTasks.progressByProject; fileCount: the files on the person's
 *   own and Anyone tasks (projectFiles.countTaskFilesForMember)
 */
export default async function ProjectCard({
  project,
  minutes,
  lastDate,
  today,
  priority,
  plan = null,
  progress = null,
  fileCount = 0,
}) {
  const lastUpdate = lastDate ? formatRelativeDay(lastDate, today) : 'Not yet';
  const counts = priority === undefined ? (await openPriorityCounts())[project.id] : priority;
  return (
    <Card as="article" className={styles.card} aria-labelledby={`project-${project.id}`}>
      <div className={styles.top}>
        <div className={styles.head}>
          <ProjectSquare project={project} size={42} />
          <div className={styles.titles}>
            <h2 id={`project-${project.id}`} className={styles.name}>
              <Link href={`/projects/${project.id}`} prefetch={false} className={styles.link}>
                {project.name}
              </Link>
            </h2>
            <p className={styles.client}>{project.clientName}</p>
          </div>
          <StatusCell status={displayStatus(project)} size="pill" className={styles.status} />
        </div>
        <MiniBand plan={plan} progress={progress} />
        <p className={styles.phaseLine}>{phaseLine({ plan, progress })}</p>
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
      <PriorityLine counts={counts} fileCount={fileCount} />
      <div className={styles.foot}>
        <p className={styles.pm}>PM: {project.pmName ?? 'Not set'}</p>
        <AvatarStack users={project.members} max={4} size={30} className={styles.team} />
      </div>
    </Card>
  );
}
