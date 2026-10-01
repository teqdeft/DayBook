// PM and Admin view of /projects (artboard 07): search, status tabs and the projects table with
// the New project / Edit drawer. PMs see every project but manage only their own.
import Link from 'next/link';
import { AvatarStack } from '@/components/Avatar';
import Button from '@/components/Button';
import Card from '@/components/Card';
import DataTable from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import FilterPills from '@/components/FilterPills';
import { ProjectSquare } from '@/components/ProjectLabel';
import StatusCell from '@/components/StatusCell';
import TopBar from '@/components/TopBar';
import { logger } from '@/lib/logger';
import { plural } from '@/lib/text';
import { formatHours, weekRange, workDate } from '@/lib/time';
import { projects } from '@/modules/projects';
import { reports } from '@/modules/reports';
import { settings } from '@/modules/settings';
import NewProjectButton from './NewProjectButton';
import { displayStatus } from './ProjectCard';
import ProjectEditorProvider from './ProjectEditorProvider';
import ProjectRowMenu from './ProjectRowMenu';
import ProjectSearch from './ProjectSearch';
import ProjectsPager from './ProjectsPager';
import styles from './ManageProjectsView.module.css';

const PAGE_SIZE = 100;
const STATUSES = ['active', 'on_hold', 'completed'];
const TAB_LABELS = { active: 'Active', on_hold: 'On hold', completed: 'Completed' };

function hrefFor({ status, q, page }) {
  const search = new URLSearchParams();
  if (status !== 'active') search.set('status', status);
  if (q) search.set('q', q);
  if (page > 1) search.set('page', String(page));
  const query = search.toString();
  return query ? `/projects?${query}` : '/projects';
}

async function weeklyMinutes(userId) {
  try {
    const { timezone } = await settings.getAll();
    const week = weekRange(workDate(timezone));
    return (await reports.getMinutesByProject({ from: week.from, to: week.to })) ?? {};
  } catch (error) {
    logger.warn({ err: error, userId }, 'projects: could not load hours this week');
    return {};
  }
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

// Widths from artboard 07 at 1440 px (table 1134 px). Team and the row menu get their smallest
// content width (4 avatars and "+N"; the menu button) so the other columns keep the canvas widths.
// From 1024 to 1279 px the table must fit a 718-973 px card, so the columns' smallest widths are
// kept low (see the CSS module): the urgent note and long client or manager names give way first,
// Team shows 2 avatars, two headers shorten, and the status block never drops below its word.
function columns({ user, minutes }) {
  return [
    {
      key: 'project',
      header: 'Project',
      width: '27.75%',
      render: (project) => (
        <div className={styles.project}>
          <ProjectSquare project={project} size={34} className={styles.square} />
          <div className={styles.projectText}>
            <Link href={`/projects/${project.id}`} className={styles.projectName}>
              {project.name}
            </Link>
            {project.isUrgent && project.urgentNote ? (
              <span className={styles.urgentNote} title={project.urgentNote}>
                {project.urgentNote}
              </span>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: 'client',
      header: 'Client',
      width: '14.52%',
      render: (project) => <span className={styles.text}>{project.clientName}</span>,
    },
    {
      key: 'pm',
      header: <Header full="Project manager" short="Manager" />,
      label: 'Project manager',
      width: '15.7%',
      render: (project) => <span className={styles.text}>{project.pmName ?? '—'}</span>,
    },
    {
      key: 'team',
      header: 'Team',
      width: '13.29%',
      render: (project) =>
        project.members.length > 0 ? (
          <>
            <AvatarStack
              users={project.members}
              max={4}
              size={30}
              className={`${styles.team} ${styles.teamFull}`}
            />
            <AvatarStack
              users={project.members}
              max={2}
              size={30}
              className={`${styles.team} ${styles.teamShort}`}
            />
          </>
        ) : (
          <span className={styles.muted}>No one yet</span>
        ),
    },
    {
      key: 'hours',
      header: <Header full="Hours this week" short="This week" />,
      label: 'Hours this week',
      width: '11.46%',
      render: (project) => (
        <span className={styles.hours}>{formatHours(Number(minutes[project.id] ?? 0))}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '11.64%',
      render: (project) => (
        <div className={styles.status}>
          <StatusCell status={displayStatus(project)} />
        </div>
      ),
    },
    {
      key: 'menu',
      header: <span className="visually-hidden">Actions</span>,
      label: 'Actions',
      width: '5.64%',
      align: 'right',
      className: styles.menuCell,
      render: (project) =>
        projects.canManage(user, project) ? <ProjectRowMenu project={editable(project)} /> : null,
    },
  ];
}

export default async function ManageProjectsView({ user, params }) {
  const q = typeof params?.q === 'string' ? params.q.trim().slice(0, 120) : '';
  const page = Math.max(1, Math.trunc(Number(params?.page)) || 1);
  const [counts, overall, managers, people, minutes] = await Promise.all([
    projects.countByStatus({ q }),
    q ? projects.countByStatus({}) : null,
    projects.listManagerOptions(user),
    projects.listPeopleOptions(),
    weeklyMinutes(user.id),
  ]);
  const activeTotal = (overall ?? counts).active;
  // A search from the top bar opens the first tab that has a match.
  const status = STATUSES.includes(params?.status)
    ? params.status
    : q && counts.active === 0
      ? (STATUSES.find((key) => counts[key] > 0) ?? 'active')
      : 'active';
  const { rows, total } = await projects.list({
    status,
    q,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  return (
    <ProjectEditorProvider
      managers={managers}
      people={people}
      viewer={{ id: user.id, isAdmin: user.role === 'admin' }}
    >
      <TopBar
        title="Projects"
        subtitle={`${activeTotal} active ${plural(activeTotal, 'project')}`}
        actions={
          <>
            <ProjectSearch initialQuery={q} className={styles.search} />
            <NewProjectButton />
          </>
        }
      />
      <FilterPills
        label="Project status"
        value={status}
        items={STATUSES.map((key) => ({
          value: key,
          label: `${TAB_LABELS[key]} (${counts[key]})`,
          href: hrefFor({ status: key, q, page: 1 }),
        }))}
      />
      <Card padding="none" className={styles.tableCard}>
        <DataTable
          caption={`${TAB_LABELS[status]} projects`}
          columns={columns({ user, minutes })}
          rows={rows}
          empty={
            q ? (
              <EmptyState
                title="No projects match your search"
                body={`Nothing in ${TAB_LABELS[status].toLowerCase()} matches "${q}".`}
                action={
                  <Button variant="secondary" href={hrefFor({ status, q: '', page: 1 })}>
                    Clear search
                  </Button>
                }
              />
            ) : status === 'active' ? (
              <EmptyState
                title="No active projects yet"
                body="Create the first project so people can log hours to it."
                action={<NewProjectButton />}
              />
            ) : (
              <EmptyState
                title={`No ${TAB_LABELS[status].toLowerCase()} projects`}
                body="Projects show here when their status changes."
                action={
                  <Button variant="secondary" href="/projects">
                    See active projects
                  </Button>
                }
              />
            )
          }
        />
      </Card>
      {total > PAGE_SIZE ? (
        <ProjectsPager
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          prevHref={page > 1 ? hrefFor({ status, q, page: page - 1 }) : null}
          nextHref={page * PAGE_SIZE < total ? hrefFor({ status, q, page: page + 1 }) : null}
        />
      ) : null}
    </ProjectEditorProvider>
  );
}
