// Attendance (artboard 09): who was in, when and where for one day, the five numbers, HR's
// corrections and missing check-outs. PMs see it read-only; HR and Admin can change rows.
import Button from '@/components/Button';
import DateSwitcher from '@/components/DateSwitcher';
import Kpi from '@/components/Kpi';
import TopBar from '@/components/TopBar';
import { requirePage } from '@/lib/session';
import { addDays, formatDay, formatDayShort, formatTimeAmPm, now } from '@/lib/time';
import AutoRefresh from '../today/AutoRefresh';
import { CorrectionsCard, EveryoneCard, MissingCard } from './AttendanceCards';
import { loadAttendance } from './attendanceData';
import styles from './page.module.css';

export const metadata = { title: 'Attendance' };

function dayName(date, today) {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  return formatDayShort(date);
}

/** '/attendance?date=2026-09-29&filter=late' (today and "all" are left out). */
function hrefFor({ date, today, filter }) {
  const params = new URLSearchParams();
  if (date && date !== today) params.set('date', date);
  if (filter && filter !== 'all') params.set('filter', filter);
  const query = params.toString();
  return query ? `/attendance?${query}` : '/attendance';
}

function pillsFor(data) {
  const { summary, date, today } = data;
  const counts = {
    all: summary.tracked,
    late: summary.late,
    wfh: summary.wfh,
    not_checked_in: summary.notCheckedIn,
    unverified: summary.unverified,
  };
  const labels = {
    all: 'All',
    late: 'Late',
    wfh: 'WFH',
    not_checked_in: 'Not checked in',
    unverified: 'Unverified',
  };
  return Object.keys(labels).map((value) => ({
    value,
    label: `${labels[value]} (${counts[value]})`,
    href: hrefFor({ date, today, filter: value }),
  }));
}

export default async function AttendancePage({ searchParams }) {
  const user = await requirePage('attendance.view_all');
  const params = await searchParams;
  const data = await loadAttendance({
    user,
    date: typeof params?.date === 'string' ? params.date : undefined,
    filter: typeof params?.filter === 'string' ? params.filter : undefined,
  });
  const { date, today, tz, filter } = data;
  const isToday = date === today;
  const subtitle = isToday ? `${formatDay(date)}, ${formatTimeAmPm(now(), tz)}` : formatDay(date);

  return (
    <div className={styles.page}>
      {isToday ? <AutoRefresh /> : null}
      <TopBar
        title="Attendance"
        subtitle={subtitle}
        actions={
          <>
            <DateSwitcher
              label={dayName(date, today)}
              prevHref={hrefFor({ date: data.prevDate, today, filter })}
              prevLabel={formatDay(data.prevDate)}
              nextHref={data.nextDate ? hrefFor({ date: data.nextDate, today, filter }) : undefined}
              nextLabel={data.nextDate ? formatDay(data.nextDate) : 'No later days'}
            />
            <Button
              variant="secondary"
              href={`/api/attendance/export?date=${date}`}
              download={`attendance-${date}.xlsx`}
              prefetch={false}
            >
              Download Excel
            </Button>
          </>
        }
      />

      <section className={styles.kpis} aria-label="Numbers">
        {data.kpis.map((kpi) => (
          <Kpi key={kpi.label} {...kpi} />
        ))}
      </section>

      <div className={styles.main}>
        <EveryoneCard
          data={data}
          pills={pillsFor(data)}
          title={isToday ? 'Everyone today' : `Everyone, ${formatDayShort(date)}`}
        />
        <div className={styles.side}>
          {data.corrections ? <CorrectionsCard corrections={data.corrections} /> : null}
          <MissingCard missing={data.missing} />
        </div>
      </div>
    </div>
  );
}
