// The projects table's columns (CONTRACT 22) and what it says with no rows. Server only: the rows
// are withHealth's and the row menu gets just what it needs to edit a project.
import Link from 'next/link';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import ProgressBar from '@/components/ProgressBar';
import { ProjectSquare } from '@/components/ProjectLabel';
import Tag from '@/components/Tag';
import { formatHours } from '@/lib/time';
import { healthTone } from '@/modules/projectPlan/forecast';
import { phaseLabel } from '@/modules/projectPlan/phases';
import { projects } from '@/modules/projects';
import { longDate } from './[id]/planFormat';
import NewProjectButton from './NewProjectButton';
import ProjectRowMenu from './ProjectRowMenu';
import styles from './ManageProjectsView.module.css';

/** The square, the name with its urgent tag (the note on hover), and the client under them. */
function ProjectCell({ project }) {
  return (
    <div className={styles.project}>
      <ProjectSquare project={project} size={34} className={styles.square} />
      <div className={styles.projectText}>
        <div className={styles.projectTitle}>
          <Link href={`/projects/${project.id}`} className={styles.projectName}>
            {project.name}
          </Link>
          {project.isUrgent ? (
            <Tag tone="marigold" title={project.urgentNote ?? undefined}>
              Urgent
            </Tag>
          ) : null}
        </div>
        <span className={styles.client}>{project.clientName}</span>
      </div>
    </div>
  );
}

/** A thin bar and the percent, or "No tasks yet". */
function ProgressCell({ health }) {
  if (health.total === 0) return <span className={styles.mutedText}>No tasks yet</span>;
  return (
    <div className={styles.progress}>
      <ProgressBar percent={health.pct} height={6} className={styles.progressBar} />
      <span className={styles.percent}>{health.pct}%</span>
    </div>
  );
}

/** '15 Dec 2026', or a muted "No deadline". */
function DeadlineCell({ deadline }) {
  if (!deadline) return <span className={styles.mutedText}>No deadline</span>;
  return <span className={styles.deadline}>{longDate(deadline)}</span>;
}

/** "1h 45m" in the range, with the all-time total under it when it adds something. */
function HoursCell({ hours, total }) {
  return (
    <div className={styles.hoursCell}>
      <span className={styles.hours}>{formatHours(hours)}</span>
      {total > 0 && total !== hours ? (
        <span className={styles.hoursTotal}>{formatHours(total)} total</span>
      ) : null}
    </div>
  );
}

/** The data a row menu needs to edit the project (plain, serialisable). */
function editable(project) {
  return {
    id: project.id,
    name: project.name,
    clientName: project.clientName,
    pmId: project.pmId,
    pmName: project.pmName,
    status: project.status,
    color: project.color,
    isUrgent: project.isUrgent,
    urgentNote: project.urgentNote,
    members: project.members,
  };
}

/** A header that shortens to `short` on narrow tables; screen readers always hear `full`. */
function Header({ full, short }) {
  return (
    <>
      <span className={styles.headFull}>{full}</span>
      <span className={styles.headShort} aria-hidden="true">
        {short}
      </span>
    </>
  );
}

/**
 * The prototype's column widths at 1440 px (table 1134 px), plus the row menu it doesn't draw. From
 * 1024 to 1279 px the table must fit a 718-973 px card, so the columns' smallest widths are kept low
 * (see the CSS module): the project name and client give way first, a phase or manager wraps, the
 * hours header shortens and the total under the hours wraps. Below 1140 px the square goes too.
 * @param {{ user: object, minutes: { inRange: Record<number, number>, total: Record<number, number> },
 *   hoursHeader: { full: string, short: string } }} options
 * @returns {object[]} DataTable columns
 */
export function projectColumns({ user, minutes, hoursHeader }) {
  return [
    {
      key: 'project',
      header: 'Project',
      width: '26.28%',
      render: (project) => <ProjectCell project={project} />,
    },
    {
      key: 'health',
      header: 'Health',
      width: '10.58%',
      render: ({ health }) => (
        <Tag tone={healthTone(health.kind)} size="md">
          {health.pill}
        </Tag>
      ),
    },
    {
      key: 'phase',
      header: 'Phase',
      width: '14.64%',
      render: ({ phase }) => (
        <span className={phase ? styles.text : styles.mutedText}>{phaseLabel(phase)}</span>
      ),
    },
    {
      key: 'progress',
      header: 'Progress',
      width: '11.99%',
      render: ({ health }) => <ProgressCell health={health} />,
    },
    {
      key: 'deadline',
      header: 'Deadline',
      width: '9.52%',
      render: ({ deadline }) => <DeadlineCell deadline={deadline} />,
    },
    {
      key: 'manager',
      header: 'Manager',
      width: '10.23%',
      render: ({ pmName }) => (
        <span className={pmName ? styles.text : styles.mutedText}>{pmName ?? 'Not set'}</span>
      ),
    },
    {
      key: 'hours',
      header: <Header full={hoursHeader.full} short={hoursHeader.short} />,
      label: hoursHeader.full,
      width: '11.11%',
      render: (project) => (
        <HoursCell
          hours={Number(minutes.inRange[project.id] ?? 0)}
          total={Number(minutes.total[project.id] ?? 0)}
        />
      ),
    },
    {
      key: 'menu',
      header: <span className="visually-hidden">Actions</span>,
      label: 'Actions',
      width: '5.65%',
      align: 'right',
      className: styles.menuCell,
      render: (project) =>
        projects.canManage(user, project) ? <ProjectRowMenu project={editable(project)} /> : null,
    },
  ];
}

/**
 * What the table says with no rows: about the search if there is one, otherwise about the tab.
 * @param {{ status: string, tab: string, q: string, link: (changes: object) => string }} props tab:
 *   the status tab's name; link: a link keeping the filters it doesn't change, and the range
 */
export function ProjectsEmpty({ status, tab, q, link }) {
  if (q) {
    return (
      <EmptyState
        title="No projects match your search"
        body={`Nothing in ${tab.toLowerCase()} matches "${q}".`}
        action={
          <Button variant="secondary" href={link({ q: '' })}>
            Clear search
          </Button>
        }
      />
    );
  }
  if (status === 'active') {
    return (
      <EmptyState
        title="No active projects yet"
        body="Create the first project so people can log hours to it."
        action={<NewProjectButton />}
      />
    );
  }
  return (
    <EmptyState
      title={`No ${tab.toLowerCase()} projects`}
      body="Projects show here when their status changes."
      action={
        <Button variant="secondary" href={link({ status: 'active', q: '' })}>
          See active projects
        </Button>
      }
    />
  );
}
