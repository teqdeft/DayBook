// Employee detailed view (artboard 06): a person's numbers for a range, their month calendar,
// hours by project, tasks to watch and report history. PM and Admin.
import { notFound } from 'next/navigation';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import Card, { CardHeader } from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import HBarList from '@/components/HBarList';
import MonthCalendar from '@/components/MonthCalendar';
import ProjectLabel from '@/components/ProjectLabel';
import Segmented from '@/components/Segmented';
import Tag from '@/components/Tag';
import TopBar from '@/components/TopBar';
import { isAppError } from '@/lib/errors';
import { requirePage } from '@/lib/session';
import { dashboard } from '@/modules/dashboard';
import { employeeDetailQuerySchema, userIdParamSchema } from '@/modules/dashboard/schemas';
import ScreenTimeCard from '../../screen-time/ScreenTimeCard';
import CustomRange from './CustomRange';
import ReportHistory from './ReportHistory';
import { loadScreenTimeCard } from './screenTime';
import styles from './page.module.css';

export const metadata = { title: 'Team member' };

const first = (value) => (Array.isArray(value) ? value[0] : value);

/** The range from the URL; an invalid custom range falls back to this month with its errors. */
function readRange(query) {
  const input = { range: first(query.range), from: first(query.from), to: first(query.to) };
  const parsed = employeeDetailQuerySchema.safeParse(input);
  if (parsed.success) return { options: parsed.data, errors: null, input };
  const errors = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? 'from');
    errors[key] ??= issue.message;
  }
  return { options: { range: 'month' }, errors, input };
}

async function loadDetail(userId, options) {
  try {
    return await dashboard.getEmployeeDetail({ userId, ...options });
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
}

/** The profile card's numbers; someone who doesn't check in gets logged hours and a note. */
function stats(detail) {
  const { stats: s, attendanceNote: note } = detail;
  const logged = { key: 'logged', value: s.logged, label: s.loggedLabel };
  if (note) return [logged, { key: 'note', value: note.title, label: note.body, note: true }];
  return [
    logged,
    { key: 'average', value: s.averageCheckIn, label: 'Average check-in' },
    { key: 'late', value: String(s.lateDays), label: s.lateDays === 1 ? 'Late day' : 'Late days' },
    { key: 'wfh', value: String(s.wfhDays), label: s.wfhDays === 1 ? 'WFH day' : 'WFH days' },
    {
      key: 'reports',
      value: `${s.reportsSubmitted} of ${s.reportsExpected}`,
      label: 'Reports submitted',
    },
  ];
}

export default async function EmployeePage({ params, searchParams }) {
  const viewer = await requirePage('team.view');
  const id = userIdParamSchema.safeParse((await params).userId);
  if (!id.success) notFound();
  const { options, errors, input } = readRange(await searchParams);
  const detail = await loadDetail(id.data, options);
  const { person, period, calendar, hours, tasks } = detail;
  const screenTime = await loadScreenTimeCard({ viewer, person, period, today: detail.date });
  const base = `/team/${person.id}`;
  const showCustom = options.range === 'custom' || input.range === 'custom';
  const rangeItems = [
    { value: 'week', label: 'This week', href: `${base}?range=week` },
    { value: 'month', label: 'This month', href: base },
    {
      value: 'custom',
      label: 'Custom',
      href: `${base}?range=custom&from=${period.from}&to=${period.end < period.from ? period.from : period.end}`,
    },
  ];

  return (
    <>
      <TopBar
        breadcrumb={[{ label: 'Team', href: '/team' }, { label: person.name }]}
        title={person.name}
        subtitle={person.subtitle}
        actions={
          <>
            <Segmented
              items={rangeItems}
              value={showCustom ? 'custom' : period.key}
              label="Range"
              className={styles.range}
            />
            <Button variant="secondary" href={detail.exportHref} download prefetch={false}>
              Download Excel
            </Button>
          </>
        }
      />

      {showCustom ? (
        <CustomRange
          action={base}
          from={errors ? (input.from ?? '') : period.from}
          to={errors ? (input.to ?? '') : period.to}
          errors={errors}
          max={detail.date}
        />
      ) : null}

      <Card className={styles.profile}>
        <div className={styles.identity}>
          <Avatar user={person} size={64} />
          <div className={styles.identityText}>
            <p className={styles.email}>{person.email}</p>
            {person.joined ? <p className={styles.meta}>{person.joined}</p> : null}
            {person.shift ? <p className={styles.meta}>{person.shift}</p> : null}
          </div>
        </div>
        <ul className={styles.stats} aria-label={`Numbers for ${period.label.toLowerCase()}`}>
          {stats(detail).map((stat) => (
            <li key={stat.key} className={`${styles.stat} ${stat.note ? styles.statNote : ''}`}>
              <span className={styles.statValue}>{stat.value}</span>
              <span className={styles.statLabel}>{stat.label}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div className={styles.grid}>
        <div className={styles.main}>
          <Card className={styles.calendarCard}>
            <CardHeader title={calendar.title} />
            {calendar.empty ? (
              <EmptyState
                title={calendar.empty.title}
                body={calendar.empty.body}
                className={styles.calendarEmpty}
              />
            ) : (
              <div className={styles.calendar} style={{ '--cal-cols': calendar.weekdays.length }}>
                <MonthCalendar
                  weeks={calendar.weeks}
                  weekdays={calendar.weekdays}
                  label={calendar.title}
                />
              </div>
            )}
          </Card>

          {screenTime ? <ScreenTimeCard {...screenTime} className={styles.screenTimeCard} /> : null}
        </div>

        <div className={styles.side}>
          <Card className={styles.hoursCard}>
            <CardHeader title="Hours by project" subtitle={hours.subtitle} />
            <HBarList
              rows={hours.bars}
              labelWidth={133}
              className={styles.bars}
              empty={<p className={styles.emptyLine}>No hours logged in this range.</p>}
            />
          </Card>

          <Card className={styles.tasksCard}>
            <CardHeader title="Tasks to watch" subtitle={tasks.subtitle} />
            {tasks.items.length ? (
              <ul className={styles.tasks}>
                {tasks.items.map((task) => (
                  <li key={task.id} className={styles.task}>
                    <div className={styles.taskText}>
                      <ProjectLabel project={task.project} />
                      <p className={styles.taskTitle}>{task.title}</p>
                    </div>
                    <Tag
                      tone={task.stuck ? 'marigold' : 'neutral'}
                      size="lg"
                      className={styles.taskTag}
                    >
                      {task.label}
                    </Tag>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact title="Nothing to watch." body={tasks.emptyText} />
            )}
          </Card>
        </div>
      </div>

      <Card padding="none" className={styles.historyCard}>
        <CardHeader
          title="Report history"
          actions="Open a day to see its tasks and edit history"
          divider
        />
        <ReportHistory
          key={`${period.from}:${period.end}`}
          rows={detail.history}
          emptyText={detail.historyEmptyText}
        />
      </Card>
    </>
  );
}
