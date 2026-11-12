// The Hours tab (CONTRACT 12 and 22): who spent the time on a project, hours per person and over
// time, every task with its status and dates, and a day-by-day log of submitted reports, with an
// Excel download. The range stays in the URL, next to tab=hours. Not on the canvas; built from its
// parts.
import { notFound } from 'next/navigation';
import Button from '@/components/Button';
import Card, { CardHeader } from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import HBarList from '@/components/HBarList';
import Kpi from '@/components/Kpi';
import Segmented from '@/components/Segmented';
import WeekBars from '@/components/WeekBars';
import { isAppError } from '@/lib/errors';
import { dashboard } from '@/modules/dashboard';
import { readRange } from '../projectsRange';
import DailyLog from './DailyLog';
import PeopleTable from './PeopleTable';
import RangeForm from './RangeForm';
import TasksCard from './TasksCard';
import styles from './HoursTab.module.css';

const UNIT_LABELS = { day: 'By day', week: 'By week', month: 'By month' };

async function loadReport(projectId, options, viewer) {
  try {
    return await dashboard.getProjectReport({ projectId, ...options, viewer });
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
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

/** The range control's links, each staying on this tab. */
function rangeLinks(projectId, range) {
  const hours = `/projects/${projectId}?tab=hours`;
  const to = range.end < range.from ? range.from : range.end;
  return [
    { value: 'week', label: 'This week', href: `${hours}&range=week` },
    { value: 'month', label: 'This month', href: `${hours}&range=month` },
    { value: 'all', label: 'All time', href: hours },
    {
      value: 'custom',
      label: 'Custom',
      href: `${hours}&range=custom&from=${range.from}&to=${to}`,
    },
  ];
}

function HoursByPerson({ report, bars }) {
  const { range, totals } = report;
  return (
    <Card className={styles.chartCard}>
      <CardHeader title="Hours by person" subtitle={`${range.label}, ${totals.hours} in total`} />
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
  );
}

function HoursOverTime({ report, height }) {
  const { project, range, totals, byPeriod } = report;
  return (
    <Card className={styles.chartCard}>
      <CardHeader
        title="Hours over time"
        subtitle={`${UNIT_LABELS[report.periodUnit]}, ${range.sub}`}
      />
      {totals.minutes === 0 ? (
        <EmptyState
          compact
          className={styles.cardEmpty}
          title={range.key === 'all' ? 'Nothing to chart yet.' : 'Nothing to chart in this range.'}
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
            height={height}
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
  );
}

/** The range control, Download Excel and, for a custom range, its form. */
function RangeControls({ report, showCustom, errors, input }) {
  const { project, range } = report;
  return (
    <>
      <div className={styles.actions}>
        <Segmented
          items={rangeLinks(project.id, range)}
          value={showCustom ? 'custom' : range.key}
          label="Range"
          className={styles.range}
        />
        <Button variant="secondary" href={report.exportHref} download prefetch={false}>
          Download Excel
        </Button>
      </div>

      {showCustom ? (
        <RangeForm
          action={`/projects/${project.id}`}
          from={errors ? (input.from ?? '') : range.from}
          to={errors ? (input.to ?? '') : range.to}
          errors={errors}
          max={report.today}
          keep={{ tab: 'hours' }}
        />
      ) : null}
    </>
  );
}

/**
 * @param {{ user: object, projectId: number,
 *   query: Record<string, string|string[]|undefined> }} props query: the page's search params
 */
export default async function HoursTab({ user, projectId, query }) {
  const { options, errors, input, showCustom } = readRange(query);
  const report = await loadReport(projectId, options, user);
  const { project, range, totals } = report;
  const bars = personBars(report);
  // The chart grows with the list beside it, so the two cards end together.
  const chartHeight = Math.min(260, Math.max(150, bars.length * 31 - 50));
  return (
    <div className={styles.hours}>
      <RangeControls report={report} showCustom={showCustom} errors={errors} input={input} />

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

      <section className={styles.charts} aria-label="Hours">
        <HoursByPerson report={report} bars={bars} />
        <HoursOverTime report={report} height={chartHeight} />
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
    </div>
  );
}
