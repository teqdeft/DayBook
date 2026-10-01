// Dev-only gallery of the shell components with data from the artboards, for comparing against
// docs/design side by side. Not available in production.
import { notFound, redirect } from 'next/navigation';
import AppFrame from '@/components/AppFrame';
import Button from '@/components/Button';
import Card, { CardHeader } from '@/components/Card';
import DataTable from '@/components/DataTable';
import DayBar from '@/components/DayBar';
import Donut from '@/components/Donut';
import HBarList from '@/components/HBarList';
import Legend from '@/components/Legend';
import MonthCalendar from '@/components/MonthCalendar';
import ProjectLabel from '@/components/ProjectLabel';
import Segmented from '@/components/Segmented';
import StatusCell from '@/components/StatusCell';
import Tag from '@/components/Tag';
import Sidebar from '@/components/Sidebar';
import TopBar from '@/components/TopBar';
import { navigationFor } from '@/config/navigation';
import WeekBars from '@/components/WeekBars';
import { env } from '@/lib/env';
import { getSessionUser } from '@/lib/session';
import {
  ATTENDANCE_TODAY,
  ATTENDANCE_WEEK,
  CHECK_IN,
  DEPARTMENTS,
  HOURS_BY_PROJECT,
  HOURS_COMPANY,
  HOURS_PERSON,
  MY_TASKS,
  NOW,
  REPORT_HISTORY,
  SEPTEMBER,
  TZ,
  WEEK,
} from './demoData';
import AppError from '../../(app)/error';
import Loading from '../../(app)/team/loading';
import DevSignIn from '../../(auth)/login/DevSignIn';
import OverlayDemo from './OverlayDemo';
import TeamBoardDemo from './TeamBoardDemo';
import styles from './page.module.css';

export const metadata = { title: 'Shell gallery' };

const WEEK_MONTH = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

// The login page's development sign-in with people in it (users.listActive() is a stub today).
const DEMO_PEOPLE = [
  {
    id: 1,
    name: '[CEO name]',
    email: 'ceo@company.com',
    initials: 'CE',
    role: 'admin',
    roleLabel: 'Admin',
    designation: 'CEO',
  },
  {
    id: 10,
    name: '[PM name]',
    email: 'pm@company.com',
    initials: 'PM',
    role: 'pm',
    roleLabel: 'Project manager',
    designation: 'Project manager',
  },
  {
    id: 12,
    name: 'Neha Gupta',
    email: 'neha@company.com',
    initials: 'NG',
    role: 'hr',
    roleLabel: 'HR',
    designation: 'HR executive',
  },
  {
    id: 2,
    name: 'Vishal Saini',
    email: 'vishal@company.com',
    initials: 'VS',
    role: 'employee',
    roleLabel: 'Employee',
    designation: 'Frontend developer',
  },
];

const RANGES = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom' },
];

const TASK_COLUMNS = [
  { key: 'title', header: 'Task', width: 271 },
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
    render: (row) => <span className={styles.mutedText}>{row.updated}</span>,
  },
];

const HISTORY_COLUMNS = [
  {
    key: 'date',
    header: 'Date',
    width: 172,
    render: (row) => <span className={styles.strong}>{row.date}</span>,
  },
  { key: 'where', header: 'Where', width: 124, render: (row) => <StatusCell status={row.where} /> },
  { key: 'in', header: 'In', width: 99, render: (row) => <span className="num">{row.in}</span> },
  {
    key: 'out',
    header: 'Out',
    width: 100,
    render: (row) => <span className="num">{row.out}</span>,
  },
  { key: 'present', header: 'Present', width: 112 },
  { key: 'logged', header: 'Logged', width: 100 },
  {
    key: 'projects',
    header: 'Projects',
    render: (row) => (
      <span className={styles.labels}>
        {row.projects.map((p) => (
          <ProjectLabel key={p.name} project={p} />
        ))}
      </span>
    ),
  },
  {
    key: 'report',
    header: 'Report',
    width: 152,
    render: (row) => <StatusCell status={row.report} />,
  },
];

export default async function ShellGalleryPage({ searchParams }) {
  if (env.isProduction) notFound();
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/dev/shell');
  const { drawer, view, top } = await searchParams;
  // ?top=overview and ?top=detail render the top bar the way artboards 11 and 06 set it up.
  const search =
    top === 'overview'
      ? { placeholder: 'Search', width: 240 }
      : { placeholder: 'Search people and projects' };
  const topBar =
    top === 'detail' ? (
      <TopBar
        breadcrumb={[{ label: 'Team', href: '/team' }, { label: 'Vishal Saini' }]}
        title="Vishal Saini"
        subtitle="Frontend developer, reports to [PM name]"
        actions={
          <>
            <Segmented items={RANGES} value="month" label="Range" />
            <Button variant="secondary">Download Excel</Button>
          </>
        }
      />
    ) : (
      <TopBar
        title="Shell gallery"
        subtitle="Wednesday, 30 September, 6:52 PM"
        search={search}
        bell
        avatar
      />
    );

  // ?view=loading and ?view=error preview a loading skeleton (the Team dashboard's; every screen
  // has its own) and the app's error state.
  if (view === 'loading' || view === 'error') {
    return (
      <AppFrame user={user}>
        {view === 'loading' ? <Loading /> : <AppError error={{ digest: 'demo-1234' }} />}
      </AppFrame>
    );
  }

  return (
    <AppFrame user={user}>
      {topBar}

      <section className={styles.rowToday} aria-label="Today">
        <Card>
          <CardHeader
            title="Your day"
            actions={
              <Tag tone="marigold" size="lg">
                Report due in 3h 20m
              </Tag>
            }
          />
          <DayBar
            checkInAt={CHECK_IN}
            now={NOW}
            start="09:30"
            end="18:30"
            tz={TZ}
            className={styles.dayBar}
          />
        </Card>
        <Card>
          <CardHeader title="This week" subtitle="22h 8m logged so far" />
          <WeekBars days={WEEK} max={9} className={styles.weekBars} />
        </Card>
      </section>

      <section className={styles.rowTasks} aria-label="Today, tasks">
        <Card tone="urgent" className={styles.urgentDemo}>
          <p className={styles.mutedText}>Urgent card (ui-kit), for spacing only</p>
        </Card>
        <Card padding="none">
          <CardHeader title="My tasks this week" actions="From your daily reports" divider />
          <DataTable columns={TASK_COLUMNS} rows={MY_TASKS} dense caption="My tasks this week" />
        </Card>
      </section>

      <section className={styles.rowTeam} aria-label="Team dashboard">
        <Card>
          <CardHeader
            title="Hours logged by project"
            subtitle="This week, whole team"
            actions={<Segmented items={WEEK_MONTH} value="week" label="Range" />}
          />
          <HBarList rows={HOURS_BY_PROJECT} barHeight={14} className={styles.bars} />
        </Card>
        <Card>
          <CardHeader title="Attendance today" />
          <div className={styles.donut}>
            <Donut segments={ATTENDANCE_TODAY} centerValue={26} centerLabel="people" />
          </div>
          <Legend
            items={ATTENDANCE_TODAY.map((s) => ({
              label: s.label,
              color: s.color,
              value: s.value,
            }))}
          />
        </Card>
        <Card>
          <CardHeader title="Overlays" subtitle="Drawer, dialog, toast and menu" />
          <OverlayDemo openDrawer={drawer === '1'} />
        </Card>
      </section>

      <Card padding="none">
        <TeamBoardDemo />
      </Card>

      <section className={styles.rowDetail} aria-label="Employee detail">
        <Card>
          <CardHeader title="Attendance, September" />
          <MonthCalendar weeks={SEPTEMBER} className={styles.calendar} />
        </Card>
        <Card>
          <CardHeader title="Hours by project" subtitle="September, 142h in total" />
          <HBarList rows={HOURS_PERSON} labelWidth={133} className={styles.bars} />
        </Card>
      </section>

      <Card padding="none">
        <CardHeader
          title="Report history"
          subtitle="Open a day to see its tasks and edit history"
          divider
        />
        <DataTable columns={HISTORY_COLUMNS} rows={REPORT_HISTORY} caption="Report history" />
      </Card>

      <section className={styles.rowToday} aria-label="Company overview">
        <Card>
          <CardHeader
            title="Hours by project"
            subtitle="This week, whole company"
            actions={<Segmented items={WEEK_MONTH} value="week" label="Range" />}
          />
          <HBarList rows={HOURS_COMPANY} className={styles.bars} />
        </Card>
        <Card>
          <CardHeader title="Attendance this week" />
          <WeekBars days={ATTENDANCE_WEEK} height={150} barWidth={44} className={styles.weekBars} />
          <Legend
            className={styles.legend}
            items={ATTENDANCE_TODAY.map((s) => ({ label: s.label, color: s.color }))}
          />
        </Card>
      </section>

      <section className={styles.rowFour} aria-label="Team by department">
        <Card>
          <CardHeader title="Team by department" />
          <HBarList rows={DEPARTMENTS} labelWidth={113} className={styles.bars} />
        </Card>
        <Card>
          <CardHeader title="Empty table" />
          <DataTable
            columns={[{ key: 'name', header: 'Name' }]}
            rows={[]}
            empty={<p className={styles.muted}>No reports yet this month.</p>}
          />
        </Card>
        <Card>
          <CardHeader title="Sidebar with badges" />
          <div className={styles.sidebarPreview}>
            <Sidebar
              items={navigationFor(
                { role: 'pm', status: 'active', tracksAttendance: true },
                { requests: 3, corrections: 2 },
              )}
              companyName="[Company name]"
              user={{ name: '[PM name]', designation: 'Project manager', initials: 'PM' }}
            />
          </div>
        </Card>
        <div className={styles.devSignIn}>
          <DevSignIn people={DEMO_PEOPLE} next="/dev/shell" />
        </div>
        <Card>
          <CardHeader title="Day bar states" />
          <div className={styles.stack}>
            <DayBar now={NOW} tz={TZ} />
            <DayBar
              checkInAt={CHECK_IN}
              checkOutAt="2026-09-30T13:04:00Z"
              now="2026-09-30T13:30:00Z"
              tz={TZ}
            />
          </div>
        </Card>
      </section>
    </AppFrame>
  );
}
