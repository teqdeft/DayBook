// PM and Admin view of /projects (CONTRACT 22): search, status tabs, the hours range and the projects
// table with each project's health, phase, progress and deadline, and the New project / Edit drawer.
// PMs see every project but manage only their own.
import Card from '@/components/Card';
import DataTable from '@/components/DataTable';
import FilterPills from '@/components/FilterPills';
import Segmented from '@/components/Segmented';
import TopBar from '@/components/TopBar';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { workDate } from '@/lib/time';
import { dashboard } from '@/modules/dashboard';
import { projects } from '@/modules/projects';
import { reports } from '@/modules/reports';
import { settings } from '@/modules/settings';
import RangeForm from './[id]/RangeForm';
import NewProjectButton from './NewProjectButton';
import ProjectEditorProvider from './ProjectEditorProvider';
import ProjectSearch from './ProjectSearch';
import ProjectsPager from './ProjectsPager';
import { projectsSubtitle, withHealth } from './projectsHealth';
import { HOURS_HEADERS, filterParams, projectsHref, rangeItems, readRange } from './projectsRange';
import { ProjectsEmpty, projectColumns } from './projectsTable';
import styles from './ManageProjectsView.module.css';

const PAGE_SIZE = 100;
const STATUSES = ['active', 'on_hold', 'completed'];
const TAB_LABELS = { active: 'Active', on_hold: 'On hold', completed: 'Completed' };

// "All time" starts before any report could exist, so one query covers every project.
const ALL_TIME_FROM = '2000-01-01';

/**
 * Today at the company and its time zone. If the settings can't be read the default time zone stands
 * in, so the table still renders.
 * @returns {Promise<{ today: string, timezone: string }>} today is 'YYYY-MM-DD'
 */
async function companyClock(userId) {
  try {
    const { timezone } = await settings.getAll();
    return { today: workDate(timezone), timezone };
  } catch (error) {
    logger.warn({ err: error, userId }, 'projects: could not load the time zone');
    return { today: workDate(env.DEFAULT_TIMEZONE), timezone: env.DEFAULT_TIMEZONE };
  }
}

/**
 * Submitted report minutes per project: in the range on screen and all time up to today. The
 * all-time total sits under the range, so a quiet Monday doesn't read as a project with no hours.
 * The table still renders if it fails.
 * @returns {Promise<{ inRange: Record<number, number>, total: Record<number, number> }>}
 */
async function projectMinutes(userId, period, today) {
  try {
    const allTime = () => reports.getMinutesByProject({ from: ALL_TIME_FROM, to: today });
    if (period.key === 'all') {
      const total = (await allTime()) ?? {};
      return { inRange: total, total };
    }
    const [inRange, total] = await Promise.all([
      reports.getMinutesByProject({ from: period.from, to: period.to }),
      allTime(),
    ]);
    return { inRange: inRange ?? {}, total: total ?? {} };
  } catch (error) {
    logger.warn({ err: error, userId }, 'projects: could not load project hours');
    return { inRange: {}, total: {} };
  }
}

/** The status tabs and the hours range, with the custom range's form under them when it's open. */
function ProjectFilters({ status, q, counts, period, today, range, link }) {
  const { errors, input, showCustom } = range;
  return (
    <>
      <div className={styles.filters}>
        <FilterPills
          label="Project status"
          value={status}
          items={STATUSES.map((key) => ({
            value: key,
            label: `${TAB_LABELS[key]} (${counts[key]})`,
            href: link({ status: key }),
          }))}
        />
        <Segmented
          label="Hours range"
          items={rangeItems({ status, q, period, today })}
          value={showCustom ? 'custom' : period.key}
          className={styles.range}
        />
      </div>
      {showCustom ? (
        <RangeForm
          action="/projects"
          from={errors ? (input.from ?? '') : period.from}
          to={errors ? (input.to ?? '') : period.to}
          errors={errors}
          max={today}
          keep={filterParams({ status, q })}
        />
      ) : null}
    </>
  );
}

export default async function ManageProjectsView({ user, params }) {
  const q = typeof params?.q === 'string' ? params.q.trim().slice(0, 120) : '';
  const page = Math.max(1, Math.trunc(Number(params?.page)) || 1);
  const { today, timezone } = await companyClock(user.id);
  const range = readRange(params, 'week');
  const period = dashboard.projectReportPeriod(range.options, { today, firstOn: ALL_TIME_FROM });
  const [counts, overall, managers, people, minutes] = await Promise.all([
    projects.countByStatus({ q }),
    q ? projects.countByStatus({}) : null,
    projects.listManagerOptions(user),
    projects.listPeopleOptions(),
    projectMinutes(user.id, period, today),
  ]);
  const activeTotal = (overall ?? counts).active;
  // A search from the top bar opens the first tab that has a match.
  const status = STATUSES.includes(params?.status)
    ? params.status
    : q && counts.active === 0
      ? (STATUSES.find((key) => counts[key] > 0) ?? 'active')
      : 'active';
  const { rows: listed, total } = await projects.list({
    status,
    q,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const rows = await withHealth(listed, { today, timezone, userId: user.id });
  // The subtitle's counts need every active project, so not on a search or another tab, and not when
  // the tab has more than one page.
  const countable = status === 'active' && !q && total <= PAGE_SIZE;
  // Every link here keeps the filters it doesn't change, and the range.
  const link = (changes) => projectsHref({ status, q, range: period, ...changes });

  return (
    <ProjectEditorProvider
      managers={managers}
      people={people}
      viewer={{ id: user.id, isAdmin: user.role === 'admin' }}
    >
      <TopBar
        title="Projects"
        subtitle={projectsSubtitle(activeTotal, countable ? rows : [])}
        actions={
          <>
            <ProjectSearch initialQuery={q} className={styles.search} />
            <NewProjectButton />
          </>
        }
      />
      <ProjectFilters
        status={status}
        q={q}
        counts={counts}
        period={period}
        today={today}
        range={range}
        link={link}
      />
      <Card padding="none" className={styles.tableCard}>
        <DataTable
          caption={`${TAB_LABELS[status]} projects`}
          columns={projectColumns({ user, minutes, hoursHeader: HOURS_HEADERS[period.key] })}
          rows={rows}
          empty={<ProjectsEmpty status={status} tab={TAB_LABELS[status]} q={q} link={link} />}
        />
      </Card>
      {total > PAGE_SIZE ? (
        <ProjectsPager
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          prevHref={page > 1 ? link({ page: page - 1 }) : null}
          nextHref={page * PAGE_SIZE < total ? link({ page: page + 1 }) : null}
        />
      ) : null}
    </ProjectEditorProvider>
  );
}
