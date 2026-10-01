// Company overview (artboard 11, Admin): five numbers, hours by project, attendance this week,
// "Needs attention", team by department and urgent projects.
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Card, { CardHeader } from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import HBarList from '@/components/HBarList';
import Kpi from '@/components/Kpi';
import Legend from '@/components/Legend';
import TopBar from '@/components/TopBar';
import WeekBars from '@/components/WeekBars';
import { requirePage } from '@/lib/session';
import { plural } from '@/lib/text';
import { dashboard } from '@/modules/dashboard';
import { overviewQuerySchema } from '@/modules/dashboard/schemas';
import HoursCard from '../team/HoursCard';
import UrgentList from '../team/UrgentList';
import NeedsAttention from './NeedsAttention';
import styles from './page.module.css';

export const metadata = { title: 'Company overview' };

const first = (value) => (Array.isArray(value) ? value[0] : value);

// Leadership's bar is navy on the canvas; the page swaps in a lighter token in the dark theme.
const departmentRows = (rows) =>
  rows.map((row) => (row.color === 'navy' ? { ...row, color: 'var(--department-navy)' } : row));

const WEEK_LEGEND = [
  { key: 'office', label: 'Office', color: 'primary' },
  { key: 'wfh', label: 'Working from home', color: 'violet' },
  { key: 'missing', label: 'Not checked in', color: 'red' },
];

export default async function OverviewPage({ searchParams }) {
  await requirePage('overview.view');
  const query = await searchParams;
  const range = overviewQuerySchema.safeParse({ range: first(query.range) }).data?.range ?? 'week';
  const overview = await dashboard.getOverview({ range });
  const { hours, attendanceWeek, urgent } = overview;

  return (
    <>
      <TopBar
        title="Company overview"
        subtitle={overview.subtitle}
        search={{ placeholder: 'Search', width: 240 }}
        bell
        avatar
      />

      <section className={styles.kpis} aria-label="Company in numbers">
        {overview.kpis.map((kpi) => (
          <Kpi
            key={kpi.key}
            label={kpi.label}
            value={kpi.value}
            sub={kpi.sub}
            footer={kpi.footer}
            percent={kpi.percent}
            color={kpi.color}
          />
        ))}
      </section>

      <section className={styles.rowCharts} aria-label="Hours and attendance">
        <HoursCard
          title="Hours by project"
          subtitle={hours.subtitle}
          range={hours.range}
          hrefs={{ week: '/overview', month: '/overview?range=month' }}
          bars={hours.bars}
          className={styles.hours}
        />

        <Card className={styles.week}>
          <CardHeader title="Attendance this week" />
          <WeekBars
            days={attendanceWeek.days}
            max={attendanceWeek.max}
            height={150}
            barWidth={44}
            showValues={false}
            className={styles.weekBars}
          />
          <Legend items={WEEK_LEGEND} className={styles.weekLegend} />
        </Card>
      </section>

      <section className={styles.rowLists} aria-label="Needs attention, team and urgent projects">
        <Card className={styles.attention}>
          <CardHeader title="Needs attention" />
          <NeedsAttention
            items={overview.needsAttention}
            empty={
              <EmptyState
                compact
                className={styles.cardEmpty}
                title="Nothing needs attention."
                body="Missing reports, requests and check-outs show here."
                action={
                  <Button variant="text" size="compact" href="/team">
                    Open the team dashboard
                  </Button>
                }
              />
            }
          />
        </Card>

        <Card className={styles.departments}>
          <CardHeader title="Team by department" />
          <HBarList
            rows={departmentRows(overview.departments)}
            labelWidth={113}
            className={styles.departmentBars}
            empty={
              <EmptyState
                compact
                className={styles.cardEmpty}
                title="Nobody here yet."
                body="People appear here once HR adds them."
                action={
                  <Button variant="text" size="compact" href="/people">
                    Open people
                  </Button>
                }
              />
            }
          />
        </Card>

        <Card className={styles.urgent}>
          <CardHeader
            title="Urgent projects"
            className={styles.urgentHeader}
            actions={
              urgent.length ? (
                <Badge label={`${urgent.length} urgent ${plural(urgent.length, 'project')}`}>
                  {urgent.length}
                </Badge>
              ) : null
            }
          />
          <UrgentList
            items={urgent}
            className={styles.urgentList}
            empty={
              <EmptyState
                compact
                className={styles.cardEmpty}
                title="Nothing urgent."
                body="Projects marked urgent show here."
                action={
                  <Button variant="text" size="compact" href="/projects">
                    Open projects
                  </Button>
                }
              />
            }
          />
        </Card>
      </section>
    </>
  );
}
