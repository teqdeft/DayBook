// Daily report (artboard 02). Opening the page creates the day's draft with carry-over; the editor
// autosaves one second after the last change. /report?date=YYYY-MM-DD opens another day, which is
// read-only once locked, with "Request an edit".
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import TopBar from '@/components/TopBar';
import { homePathFor } from '@/config/navigation';
import { requirePage } from '@/lib/session';
import {
  addDays,
  dayjs,
  formatDay,
  formatDayShort,
  formatTimeAmPm,
  monthOf,
  now,
  nowDate,
  workDate,
} from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { projects } from '@/modules/projects';
import { projectTasks } from '@/modules/projectTasks';
import { reports } from '@/modules/reports';
import { isIsoDate } from '@/modules/reports/schemas';
import { settings } from '@/modules/settings';
import ReportActions from './ReportActions';
import ReportEditor from './ReportEditor';
import ReportProvider from './ReportProvider';
import styles from './page.module.css';

export const metadata = { title: 'Daily report' };

/** 'today at 9:48 AM', 'yesterday at 2:10 PM', 'on Mon, 28 Sep at 9:15 AM' */
function whenText(at, tz, today) {
  const day = workDate(tz, at);
  const time = formatTimeAmPm(at, tz);
  if (day === today) return `today at ${time}`;
  if (day === addDays(today, -1)) return `yesterday at ${time}`;
  return `on ${formatDayShort(day)} at ${time}`;
}

/** '12:00 PM on Thu, 1 Oct' */
function momentText(at, tz) {
  return `${formatTimeAmPm(at, tz)} on ${formatDayShort(workDate(tz, at))}`;
}

/** The Slack preview's subtitle before the first submit (draft) and after it (submitted). */
function slackLines(current) {
  if (!current.slackEnabled || !current.slackPostReports) {
    const off = 'Posting reports to Slack is off';
    return { draft: off, submitted: off };
  }
  if (current.slackReportChannelName) {
    const channel = `#${current.slackReportChannelName}`;
    return { draft: `Posts to ${channel} when you submit`, submitted: `Posted to ${channel}` };
  }
  if (current.slackReportChannelId) {
    return {
      draft: 'Posts to the report channel when you submit',
      submitted: 'Posted to the report channel',
    };
  }
  const later = 'Posts to Slack once an Admin picks the report channel';
  return { draft: later, submitted: later };
}

function noticeTexts(report, tz, today) {
  const locksAt = dayjs(report.locksAt);
  const until = report.unlockedUntil ? dayjs(report.unlockedUntil) : null;
  const lockedAt = until && until.isAfter(locksAt) ? until : locksAt;
  const pending = report.pendingEditRequest;
  return {
    lockedText: `This report locked at ${momentText(lockedAt, tz)}. Request an edit to change it.`,
    pendingText: pending
      ? `You asked to edit this report ${whenText(pending.createdAt, tz, today)}. You'll get a notification when it opens.`
      : null,
    unlockedText:
      until && report.editable
        ? `Your edit request was approved. You can change this report until ${momentText(until, tz)}.`
        : null,
  };
}

/**
 * The open priority tasks the person can link a task line to (CONTRACT section 13), per project:
 * for the report's projects and the person's own projects in the picker (urgent ones too). A
 * project picked from "Other projects" gets none until the page reloads. Nothing for a report
 * that can't change.
 * @returns {Promise<Record<number, Array<{ id, title, priority, forYou }>>>}
 */
async function prioritySuggestions(user, report, picker) {
  if (!report.editable) return {};
  const ids = new Set([...picker.urgent, ...picker.mine].map((project) => Number(project.id)));
  for (const entry of report.entries) if (entry.projectId) ids.add(Number(entry.projectId));
  // One query for every project; the report still opens if it fails.
  const byProject = await projectTasks
    .findOpenForPickerByProject({ userId: user.id, projectIds: [...ids] })
    .catch(() => ({}));
  return Object.fromEntries(
    Object.entries(byProject).map(([projectId, tasks]) => [
      projectId,
      tasks.map((task) => ({
        id: task.id,
        title: task.title,
        priority: task.priority,
        forYou: Number(task.assigneeId) === Number(user.id),
      })),
    ]),
  );
}

/**
 * Where "Back to ..." goes: Today for today's report, My log for other days. Someone who doesn't
 * track attendance (the CEO) has no Today screen, so their link goes to their home screen.
 */
function backLink({ user, day, today }) {
  if (day !== today) return { href: `/log?month=${monthOf(day)}`, label: 'Back to My log' };
  const home = homePathFor(user);
  if (user.tracksAttendance || home === '/today') return { href: '/today', label: 'Back to today' };
  return { href: home, label: 'Back to overview' };
}

function FutureDay({ day }) {
  return (
    <div className={styles.page}>
      <TopBar title="Daily report" subtitle={formatDay(day)} />
      <div className={styles.emptyCard}>
        <EmptyState
          title="You can't write a report for a future day"
          body="Reports open on their own day."
          action={<Button href="/report">Open today&apos;s report</Button>}
        />
      </div>
    </div>
  );
}

export default async function ReportPage({ searchParams }) {
  const user = await requirePage('report.self');
  const params = await searchParams;
  const current = await settings.getAll();
  const tz = current.timezone;
  const today = workDate(tz);
  const asked = typeof params?.date === 'string' ? params.date : null;
  const day = asked && isIsoDate(asked) ? asked : today;
  if (day > today) return <FutureDay day={day} />;

  const report = await reports.openForDate({ user, workDate: day });
  const [picker, row] = await Promise.all([
    projects.getPickerFor(user.id),
    attendance.getForUserOnDate(user.id, day),
  ]);
  const suggestions = await prioritySuggestions(user, report, picker);
  const back = backLink({ user, day, today });
  const data = {
    report,
    picker,
    suggestions,
    tz,
    isToday: day === today,
    user: { name: user.name, initials: user.initials, avatarUrl: user.avatarUrl, role: user.role },
    tracksAttendance: Boolean(user.tracksAttendance),
    presentMinutes: row ? attendance.presentMinutes(row, nowDate(), tz) : null,
    gapWarningMinutes: current.gapWarningMinutes,
    slackLines: slackLines(current),
    previewTime: formatTimeAmPm(report.submittedAt ?? now(), tz),
    backHref: back.href,
    backLabel: back.label,
    ...noticeTexts(report, tz, today),
  };
  // The editor keeps its rows in client state across router.refresh(). When the server says the
  // report changed mode (an edit request was sent, approved or it locked), start from the server's
  // copy instead: a read-only report has no local changes to keep.
  const mode = [
    report.id ?? 'none',
    day,
    report.editable ? 'open' : 'locked',
    report.pendingEditRequest?.id ?? '',
  ].join('-');

  return (
    <div className={styles.page}>
      <ReportProvider key={mode} data={data}>
        <TopBar title="Daily report" subtitle={formatDay(day)} actions={<ReportActions />} />
        <ReportEditor />
      </ReportProvider>
    </div>
  );
}
