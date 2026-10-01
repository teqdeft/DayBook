// My log (artboard 03): the person's month of reports, hours and attendance. ?month=YYYY-MM
// picks the month; Download Excel gets the same month as a workbook.
import Button from '@/components/Button';
import Card, { CardHeader } from '@/components/Card';
import DateSwitcher from '@/components/DateSwitcher';
import HBarList from '@/components/HBarList';
import Kpi from '@/components/Kpi';
import Legend from '@/components/Legend';
import StatusCell from '@/components/StatusCell';
import TopBar from '@/components/TopBar';
import { requirePage } from '@/lib/session';
import { dayjs, formatHours, formatMonth, monthOf } from '@/lib/time';
import { reports } from '@/modules/reports';
import ScreenTimeCard from '../screen-time/ScreenTimeCard';
import DailyReports from './DailyReports';
import RequestEditButton from './RequestEditButton';
import { attendanceItems, dayRows, editRequestItems, kpiCards } from './logView';
import { loadMyScreenTime } from './screenTime';
import styles from './page.module.css';

export const metadata = { title: 'My log' };

const monthHref = (month) => `/log?month=${month}`;

function EditRequests({ items, dates }) {
  return (
    <Card as="section" className={styles.requests} aria-label="Edit requests">
      <CardHeader title="Edit requests" />
      {items.length ? (
        <ul className={styles.requestList}>
          {items.map((item) => (
            <li key={item.id} className={styles.request}>
              <p className={styles.requestTitle}>{item.title}</p>
              <p className={styles.requestReason}>{item.reason}</p>
              {item.declineReason ? (
                <p className={styles.requestReason}>
                  {item.handledBy ? `${item.handledBy}: ` : ''}
                  {item.declineReason}
                </p>
              ) : null}
              <div className={styles.requestMeta}>
                <StatusCell status={item.status} size="pill" className={styles.requestStatus} />
                <span>{item.when}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.requestEmpty}>
          No edit requests this month. Reports lock after their day; ask here to change one.
        </p>
      )}
      <RequestEditButton dates={dates} className={styles.requestButton} />
    </Card>
  );
}

export default async function LogPage({ searchParams }) {
  const user = await requirePage('report.self');
  const params = await searchParams;
  const asked = typeof params?.month === 'string' ? params.month : undefined;
  const valid = asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : undefined;
  const log = await reports.getMonthLog({ user, month: valid });
  const firstMonth = user.joinedOn ? monthOf(user.joinedOn) : null;
  const prevHref = !firstMonth || log.prevMonth >= firstMonth ? monthHref(log.prevMonth) : null;
  const monthName = dayjs(`${log.month}-01`).format('MMMM');
  const rows = dayRows(log);
  const isThisMonth = log.month === monthOf(log.today);
  const screenTime = await loadMyScreenTime({ user, month: log.month, today: log.today });

  return (
    <>
      <TopBar
        title="My log"
        subtitle="Your reports, hours and attendance"
        actions={
          <>
            <DateSwitcher
              label={formatMonth(log.month)}
              prevHref={prevHref}
              prevLabel={prevHref ? formatMonth(log.prevMonth) : 'No earlier months'}
              nextHref={log.nextMonth ? monthHref(log.nextMonth) : null}
              nextLabel={log.nextMonth ? formatMonth(log.nextMonth) : 'No later months'}
            />
            <Button
              variant="secondary"
              href={`/api/me/log?month=${log.month}&format=xlsx`}
              download={`daybook-my-log-${log.month}.xlsx`}
              prefetch={false}
            >
              Download Excel
            </Button>
          </>
        }
      />

      <section className={styles.kpis} aria-label="This month in numbers">
        {kpiCards(log).map((kpi) => (
          <Kpi
            key={kpi.key}
            label={kpi.label}
            value={kpi.value}
            sub={kpi.sub}
            percent={kpi.percent}
            color={kpi.color}
          />
        ))}
      </section>

      <div className={styles.layout}>
        <Card as="section" padding="none" className={styles.reports} aria-label="Daily reports">
          <CardHeader title="Daily reports" divider actions={<span>{log.lockText}</span>} />
          <DailyReports
            key={log.month}
            rows={rows}
            emptyText={
              isThisMonth ? 'No working days yet this month.' : 'No working days in this month.'
            }
            emptyAction={
              isThisMonth
                ? { href: '/report', label: "Open today's report" }
                : { href: '/log', label: 'Go to this month' }
            }
          />
        </Card>

        <div className={styles.side}>
          <Card as="section" className={styles.hours} aria-label="Hours by project">
            <CardHeader title="Hours by project" subtitle={monthName} />
            <HBarList
              className={styles.bars}
              labelWidth={123}
              rows={log.hoursByProject.map((project) => ({
                key: project.projectId,
                label: project.name,
                value: project.minutes,
                display: formatHours(project.minutes, 1),
                color: project.color,
              }))}
              empty={
                <p className={styles.muted}>
                  No submitted hours in {monthName}
                  {isThisMonth ? ' yet' : ''}.
                </p>
              }
            />
          </Card>

          <EditRequests items={editRequestItems(log)} dates={log.requestableDays} />

          <Card as="section" className={styles.attendance} aria-label="Attendance">
            <CardHeader title="Attendance" />
            <Legend className={styles.legend} items={attendanceItems(log)} />
          </Card>

          {screenTime ? <ScreenTimeCard {...screenTime} className={styles.screenTime} /> : null}
        </div>
      </div>
    </>
  );
}
