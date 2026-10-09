// The Today page's cards (artboard 01): Your day, This week, the urgent card, My tasks this week
// and the report strip (Priority tasks is in PriorityCard.jsx). Server Components; they receive
// ready-to-show data from todayData.js.
import Button from '@/components/Button';
import Card, { CardHeader } from '@/components/Card';
import DataTable from '@/components/DataTable';
import DayBar from '@/components/DayBar';
import EmptyState from '@/components/EmptyState';
import ProjectLabel from '@/components/ProjectLabel';
import StatTile from '@/components/StatTile';
import StatusCell from '@/components/StatusCell';
import Tag from '@/components/Tag';
import WeekBars from '@/components/WeekBars';
import { formatClockShort, formatDayShort, formatTime, workDate as localDate } from '@/lib/time';
import styles from './page.module.css';

export function YourDayCard({ data }) {
  const { row, settings: current, tz } = data;
  return (
    <Card className={styles.yourDay}>
      <CardHeader
        title="Your day"
        actions={
          <>
            {data.screenTime ? (
              <span className={`${styles.screenTime} ${styles.screenTimeHead}`}>
                {data.screenTime}
              </span>
            ) : null}
            <Tag tone={data.reportTag.tone} size="xl">
              {data.reportTag.text}
            </Tag>
          </>
        }
      />
      {[false, true].map((phone) => (
        <DayBar
          key={phone ? 'phone' : 'wide'}
          className={`${styles.dayBar} ${phone ? styles.phoneOnly : styles.wideOnly}`}
          checkInAt={row.checkInAt}
          checkOutAt={row.checkOutAt}
          now={data.now}
          start={current.officeStart}
          end={current.reportReminderAt}
          reportAt={current.reportReminderAt}
          tz={tz}
          labels={phone ? data.phoneLabels : true}
        />
      ))}
      <div className={styles.tiles}>
        <StatTile value={formatTime(row.checkInAt, tz)} label="Checked in" />
        <StatTile value={data.worked.value} label={data.worked.label} />
        <StatTile value={String(data.projectsToday)} label="Projects today" />
      </div>
      {/* A narrow card has no room beside the title: the line moves under the tiles. */}
      {data.screenTime ? (
        <p className={`${styles.screenTime} ${styles.screenTimeFoot}`}>{data.screenTime}</p>
      ) : null}
    </Card>
  );
}

export function WeekCard({ week }) {
  return (
    <Card className={styles.week}>
      <CardHeader title="This week" subtitle={week.subtitle} />
      <WeekBars days={week.days} max={week.max} className={styles.weekBars} />
    </Card>
  );
}

function markedWhen(project, tz, today) {
  if (!project.urgentMarkedAt) return null;
  const day = localDate(tz, project.urgentMarkedAt);
  const time = formatTime(project.urgentMarkedAt, tz);
  return day === today ? `at ${time}` : `on ${formatDayShort(day)}`;
}

export function UrgentCard({ urgent, tz, today }) {
  const [first, ...others] = urgent;
  const when = markedWhen(first, tz, today);
  const from = first.urgentMarkedByName ?? first.pmName;
  return (
    <Card tone="urgent" className={styles.urgent} aria-label="Urgent project">
      <div className={styles.urgentHead}>
        <Tag tone="marigold" size="lg" solid padX={12}>
          Urgent
        </Tag>
        {from ? (
          <span className={styles.urgentFrom}>
            From {from}
            {when ? ` ${when}` : ''}
          </span>
        ) : null}
      </div>
      <div className={styles.urgentLabel}>
        <ProjectLabel project={first} />
      </div>
      <p className={styles.urgentNote}>{first.urgentNote || `${first.name} is urgent.`}</p>
      <p className={styles.urgentHint}>It&apos;s at the top of today&apos;s report.</p>
      {others.length > 0 ? (
        <p className={styles.urgentMore}>
          Also urgent:{' '}
          {others.map((project) => (
            <ProjectLabel key={project.id} project={project} size="sm" />
          ))}
        </p>
      ) : null}
    </Card>
  );
}

const TASK_COLUMNS = [
  {
    key: 'title',
    header: 'Task',
    width: 271,
    render: (row) => <span className={styles.taskTitle}>{row.title}</span>,
  },
  {
    key: 'project',
    header: 'Project',
    width: 173,
    render: (row) => <ProjectLabel project={row.project} />,
  },
  {
    key: 'status',
    header: 'Status',
    width: 149,
    align: 'center',
    render: (row) => <StatusCell status={row.status} />,
  },
  {
    key: 'updated',
    header: 'Updated',
    render: (row) => <span className={styles.muted}>{row.updated}</span>,
  },
];

export function TasksCard({ tasks }) {
  return (
    <Card padding="none" className={styles.tasks}>
      <CardHeader
        title="My tasks this week"
        actions="From your daily reports"
        divider
        className={styles.tasksHead}
      />
      <DataTable
        columns={TASK_COLUMNS}
        rows={tasks}
        dense
        caption="My tasks this week"
        empty={
          <EmptyState
            compact
            title="No tasks yet this week"
            body="Tasks from your daily reports show up here."
            action={
              <Button variant="secondary" size="compact" href="/report">
                Write today&apos;s report
              </Button>
            }
          />
        }
      />
    </Card>
  );
}

export function ReportStrip({ data }) {
  const current = data.settings;
  const channel =
    current.slackEnabled && current.slackPostReports && current.slackReportChannelName
      ? `#${current.slackReportChannelName.replace(/^#/, '')}`
      : null;
  const submitted = data.reportStatus === 'submitted';
  const title = submitted
    ? 'Your report is in'
    : `Your report is due at ${formatClockShort(current.reportReminderAt)}`;
  const body = submitted
    ? `You can still change it until ${data.locksText}.${channel ? ` Changes update the same message in ${channel}.` : ''}`
    : channel
      ? `It posts to ${channel} on Slack in the usual format.`
      : 'Your PM sees it here as soon as you submit it.';
  return (
    <Card tone="dark" className={styles.strip}>
      <div className={styles.stripText}>
        <h2 className={styles.stripTitle}>{title}</h2>
        <p className={styles.stripBody}>{body}</p>
      </div>
      {submitted ? (
        <Button variant="secondary" size="xl" href="/report" className={styles.stripButton}>
          Edit report
        </Button>
      ) : (
        <Button variant="marigold" size="xl" href="/report" className={styles.stripButton}>
          Write today&apos;s report
        </Button>
      )}
    </Card>
  );
}
