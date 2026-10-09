// Team dashboard (artboard 05): today's numbers, hours by project, the attendance donut, urgent
// projects and the team board. PM and Admin. Refreshes every minute so check-ins, breaks and
// running timers stay live.
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Card, { CardHeader } from '@/components/Card';
import Donut from '@/components/Donut';
import EmptyState from '@/components/EmptyState';
import Kpi from '@/components/Kpi';
import Legend from '@/components/Legend';
import TopBar from '@/components/TopBar';
import { requirePage } from '@/lib/session';
import { plural } from '@/lib/text';
import { dashboard } from '@/modules/dashboard';
import { teamTodayQuerySchema, weekMonthQuerySchema } from '@/modules/dashboard/schemas';
import AutoRefresh from '../today/AutoRefresh';
import HoursCard from './HoursCard';
import TeamBoard from './TeamBoard';
import UrgentList from './UrgentList';
import styles from './page.module.css';

export const metadata = { title: 'Team dashboard' };

function hrefFor({ range, filter }) {
  const params = new URLSearchParams();
  if (range !== 'week') params.set('range', range);
  if (filter !== 'everyone') params.set('filter', filter);
  const query = params.toString();
  return query ? `/team?${query}` : '/team';
}

export default async function TeamPage({ searchParams }) {
  await requirePage('team.view');
  const query = await searchParams;
  const range = weekMonthQuerySchema.safeParse({ range: query.range }).data?.range ?? 'week';
  const filter =
    teamTodayQuerySchema.safeParse({ filter: query.filter }).data?.filter ?? 'everyone';
  const [today, hours] = await Promise.all([
    dashboard.getTeamToday({ filter }),
    dashboard.getHoursCard({ range, scope: 'team' }),
  ]);
  const { attendance, counts, urgent } = today;

  return (
    <>
      <AutoRefresh />
      <TopBar
        title="Team dashboard"
        subtitle={today.subtitle}
        search={{ placeholder: 'Search people and projects' }}
        bell
        avatar
      />

      <section className={styles.kpis} aria-label="Today in numbers">
        {today.kpis.map((kpi) => (
          <Kpi
            key={kpi.key}
            label={kpi.label}
            value={kpi.value}
            sub={kpi.sub}
            percent={kpi.percent}
            color={kpi.color}
            className={styles.kpi}
          />
        ))}
      </section>

      <section className={styles.row} aria-label="Hours and attendance">
        <HoursCard
          title="Hours logged by project"
          subtitle={hours.subtitle}
          range={hours.range}
          hrefs={{
            week: hrefFor({ range: 'week', filter }),
            month: hrefFor({ range: 'month', filter }),
          }}
          bars={hours.bars}
          barHeight={14}
          className={styles.hours}
        />

        <Card className={styles.attendance}>
          <CardHeader title="Attendance today" />
          <div className={styles.donut}>
            <Donut
              segments={attendance.segments}
              centerValue={attendance.total}
              centerLabel={plural(attendance.total, 'person', 'people')}
            />
          </div>
          <Legend
            className={styles.legend}
            items={attendance.segments.map((segment) => ({
              key: segment.key,
              label: segment.label,
              color: segment.color,
              value: segment.value,
            }))}
          />
        </Card>

        <Card className={styles.urgent}>
          <CardHeader
            title="Urgent now"
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
                className={styles.urgentEmpty}
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

      <Card padding="none" className={styles.boardCard}>
        <TeamBoard
          // A new filter starts with every group open and shortened again.
          key={today.filter}
          groups={today.groups}
          filter={today.filter}
          filterItems={[
            { value: 'everyone', label: 'Everyone', href: hrefFor({ range, filter: 'everyone' }) },
            {
              value: 'missing',
              label: `Report missing (${counts.missing})`,
              href: hrefFor({ range, filter: 'missing' }),
            },
            {
              value: 'late',
              label: `Late (${counts.late})`,
              href: hrefFor({ range, filter: 'late' }),
            },
          ]}
          day={{
            label: today.dayLabel,
            now: today.now,
            start: today.dayStart,
            end: today.dayEnd,
            tz: today.timezone,
          }}
          // "Download Excel" exports the same range as the hours card: this week (Monday to
          // today) by default, this month when Month is picked. Everyone, every report entry.
          exportHref={`/api/exports/hours?from=${hours.from}&to=${hours.to}`}
          everyoneHref={hrefFor({ range, filter: 'everyone' })}
        />
      </Card>
    </>
  );
}
