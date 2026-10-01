// Project report: everything about one project for PMs (every project) and Admin — its priority
// tasks, who worked on it, hours per person and over time, every task with its status and dates,
// and a day-by-day log of submitted reports, with an Excel download. Not on the canvas; built
// from its parts.
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Button from '@/components/Button';
import Card, { CardHeader } from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import HBarList from '@/components/HBarList';
import Kpi from '@/components/Kpi';
import ProjectSquare from '@/components/ProjectSquare';
import Segmented from '@/components/Segmented';
import TopBar from '@/components/TopBar';
import WeekBars from '@/components/WeekBars';
import { isAppError } from '@/lib/errors';
import { requirePage } from '@/lib/session';
import { dashboard } from '@/modules/dashboard';
import {
  projectIdParamSchema,
  projectReportRangeSchema,
} from '@/modules/dashboard/projectReportSchemas';
import DailyLog from './DailyLog';
import PeopleTable from './PeopleTable';
import PriorityTasks from './PriorityTasks';
import PriorityTasksSkeleton from './PriorityTasksSkeleton';
import RangeForm from './RangeForm';
import TasksCard from './TasksCard';
import styles from './page.module.css';

export const metadata = { title: 'Project report' };

const first = (value) => (Array.isArray(value) ? value[0] : value);
const UNIT_LABELS = { day: 'By day', week: 'By week', month: 'By month' };

/** The range from the URL; an invalid custom range falls back to all time with its errors. */
function readRange(query) {
  const input = { range: first(query.range), from: first(query.from), to: first(query.to) };
  const parsed = projectReportRangeSchema.safeParse(input);
  if (parsed.success) return { options: parsed.data, errors: null, input };
  const errors = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? 'from');
    errors[key] ??= issue.message;
  }
  return { options: { range: 'all' }, errors, input };
}

async function loadReport(projectId, options) {
  try {
    return await dashboard.getProjectReport({ projectId, ...options });
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
}

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

function personBars(report) {
  return report.byPerson
    .filter((row) => row.minutes > 0)
    .map((row) => ({
      key: row.user.id,
      label: row.user.name,
      href: row.user.href,
      value: row.minutes,
      color: report.project.color,
      display: (
        <>
          {row.hours}
          <span className={styles.share}>{`${Math.round(row.share)}%`}</span>
        </>
      ),
    }));
}

export default async function ProjectReportPage({ params, searchParams }) {
  const user = await requirePage('team.view');
  const id = projectIdParamSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const { options, errors, input } = readRange(await searchParams);
  const report = await loadReport(id.data, options);
  const { project, range, totals, byPeriod } = report;
  const base = `/projects/${project.id}`;
  // Dates without range=custom are a custom range too: show the form, with its errors.
  const showCustom =
    options.range === 'custom' ||
    input.range === 'custom' ||
    Boolean(errors && (input.from || input.to));
  const rangeItems = [
    { value: 'week', label: 'This week', href: `${base}?range=week` },
    { value: 'month', label: 'This month', href: `${base}?range=month` },
    { value: 'all', label: 'All time', href: base },
    {
      value: 'custom',
      label: 'Custom',
      href: `${base}?range=custom&from=${range.from}&to=${range.end < range.from ? range.from : range.end}`,
    },
  ];
  const noHours = totals.minutes === 0;
  const bars = personBars(report);
  // The chart grows with the list beside it, so the two cards end together.
  const chartHeight = Math.min(260, Math.max(150, bars.length * 31 - 50));

  return (
    <>
      <TopBar
        breadcrumb={[{ label: 'Projects', href: '/projects' }, { label: project.name }]}
        title={
          <span className={styles.title}>
            <ProjectSquare project={project} size={36} className={styles.square} />
            <span className={styles.name}>{project.name}</span>
          </span>
        }
        subtitle={<Subtitle project={project} />}
        actions={
          <>
            <Segmented
              items={rangeItems}
              value={showCustom ? 'custom' : range.key}
              label="Range"
              className={styles.range}
            />
            <Button variant="secondary" href={report.exportHref} download prefetch={false}>
              Download Excel
            </Button>
          </>
        }
      />

      {showCustom ? (
        <RangeForm
          action={base}
          from={errors ? (input.from ?? '') : range.from}
          to={errors ? (input.to ?? '') : range.to}
          errors={errors}
          max={report.today}
        />
      ) : null}

      <section className={styles.kpis} aria-label={`${project.name} in numbers`}>
        {report.kpis.map((kpi) => (
          <Kpi
            key={kpi.key}
            className={styles.kpi}
            label={kpi.label}
            value={kpi.value}
            sub={kpi.sub}
            footer={kpi.footer}
            percent={kpi.percent}
            color={kpi.color}
          />
        ))}
      </section>

      {/* Priority tasks don't depend on the range; they stream in behind their own skeleton. */}
      <Suspense fallback={<PriorityTasksSkeleton />}>
        <PriorityTasks viewer={user} project={project} today={report.today} />
      </Suspense>

      <section className={styles.charts} aria-label="Hours">
        <Card className={styles.chartCard}>
          <CardHeader
            title="Hours by person"
            subtitle={`${range.label}, ${totals.hours} in total`}
          />
          <HBarList
            rows={bars}
            labelWidth={150}
            className={styles.personBars}
            empty={
              <EmptyState
                compact
                className={styles.cardEmpty}
                title={`No hours logged ${range.when}.`}
                body="Hours show here once reports on this project are submitted."
              />
            }
          />
        </Card>

        <Card className={styles.chartCard}>
          <CardHeader
            title="Hours over time"
            subtitle={`${UNIT_LABELS[report.periodUnit]}, ${range.sub}`}
          />
          {noHours ? (
            <EmptyState
              compact
              className={styles.cardEmpty}
              title={
                range.key === 'all' ? 'Nothing to chart yet.' : 'Nothing to chart in this range.'
              }
              body={
                range.key === 'all'
                  ? 'The chart fills in as reports on this project are submitted.'
                  : 'Pick a longer range, or check back after the next report.'
              }
            />
          ) : (
            <div
              className={styles.overTime}
              style={{ '--bars': byPeriod.length }}
              // Long ranges scroll sideways; keyboard users can focus the chart to scroll it.
              {...(byPeriod.length > 8
                ? { tabIndex: 0, role: 'region', 'aria-label': 'Hours over time, scrollable' }
                : {})}
            >
              <WeekBars
                className={styles.overTimeBars}
                height={chartHeight}
                barWidth={byPeriod.length > 10 ? 26 : 34}
                days={byPeriod.map((bucket) => ({
                  label: bucket.label,
                  value: bucket.minutes,
                  display: bucket.display,
                  highlight: bucket.current,
                  color: project.color,
                }))}
              />
            </div>
          )}
        </Card>
      </section>

      <PeopleTable rows={report.byPerson} members={totals.members} people={totals.people} />

      <TasksCard
        key={`${range.from}:${range.to}`}
        tasks={report.tasks}
        rangeLabel={range.label}
        when={range.when}
      />

      <DailyLog
        key={`log:${range.from}:${range.to}`}
        projectId={project.id}
        range={{ key: range.key, from: range.from, to: range.to, when: range.when }}
        initialEntries={report.entries}
        initialPage={report.entriesPage}
      />
    </>
  );
}
