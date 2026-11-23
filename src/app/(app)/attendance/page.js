// Attendance (artboard 09): who was in, when and where for one day, the five numbers, HR's
// corrections and missing check-outs. PMs see it read-only; HR and Admin can change rows and
// decide on work-from-home requests (CONTRACT 17), above the day table. CONTRACT 25 puts the
// 1.10 pieces together here: the Day / Month switch (HR, Admin), the "Missing check-out" card as
// a link to the full list, the holiday notice, the new cells and the side column split in two
// (.sideAct before the table, .sideInfo after it below 1440 px).
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import Button from '@/components/Button';
import DateSwitcher from '@/components/DateSwitcher';
import Kpi from '@/components/Kpi';
import Segmented from '@/components/Segmented';
import TopBar from '@/components/TopBar';
import { requirePage } from '@/lib/session';
import { addDays, formatDay, formatDayShort, formatTimeAmPm, now } from '@/lib/time';
import AutoRefresh from '../today/AutoRefresh';
import { CorrectionsCard, EveryoneCard } from './AttendanceCards';
import { loadAttendance } from './attendanceData';
import DayNotice from './DayNotice';
import { hrefFor } from './dayRows';
import LeaveCard from './LeaveCard';
import MissingCard from './MissingCard';
import NeedsLookCard from './NeedsLookCard';
import WfhRequestsCard from './WfhRequestsCard';
import styles from './page.module.css';

export const metadata = { title: 'Attendance' };

const VIEWS = [
  { value: 'day', label: 'Day', href: '/attendance' },
  { value: 'month', label: 'Month', href: '/attendance/month' },
];

function dayName(date, today) {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  return formatDayShort(date);
}

/** A number card with `href` ("Missing check-out") is a link: the whole card, with a chevron. */
function linkProps(href) {
  if (!href) return {};
  return {
    as: Link,
    href,
    className: styles.kpiLink,
    trailing: <ChevronRight size={18} strokeWidth={1.8} className={styles.kpiChevron} />,
  };
}

function Actions({ data }) {
  const { date, today, prevDate, nextDate } = data;
  // The day switcher keeps the filter, except On break (today only).
  const filter = data.filter === 'on_break' ? 'all' : data.filter;
  return (
    <>
      {data.canCorrect ? <Segmented items={VIEWS} value="day" label="View" /> : null}
      <DateSwitcher
        label={dayName(date, today)}
        prevHref={hrefFor({ date: prevDate, today, filter })}
        prevLabel={formatDay(prevDate)}
        nextHref={nextDate ? hrefFor({ date: nextDate, today, filter }) : undefined}
        nextLabel={nextDate ? formatDay(nextDate) : 'No later days'}
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
  );
}

export default async function AttendancePage({ searchParams }) {
  const user = await requirePage('attendance.view_all');
  const params = await searchParams;
  const data = await loadAttendance({
    user,
    date: typeof params?.date === 'string' ? params.date : undefined,
    filter: typeof params?.filter === 'string' ? params.filter : undefined,
  });
  const { date, today, tz } = data;
  const isToday = date === today;
  const subtitle = isToday ? `${formatDay(date)}, ${formatTimeAmPm(now(), tz)}` : formatDay(date);

  return (
    <div className={styles.page}>
      {isToday ? <AutoRefresh /> : null}
      <TopBar title="Attendance" subtitle={subtitle} actions={<Actions data={data} />} />

      <section className={styles.kpis} aria-label="Numbers">
        {data.kpis.map(({ href, ...kpi }) => (
          <Kpi key={kpi.label} {...kpi} {...linkProps(href)} />
        ))}
      </section>

      {data.day.isWorkingDay ? null : <DayNotice day={data.day} />}

      {data.wfh ? <WfhRequestsCard wfh={data.wfh} /> : null}

      <div className={styles.main}>
        <EveryoneCard
          data={data}
          title={isToday ? 'Everyone today' : `Everyone, ${formatDayShort(date)}`}
        />
        <div className={styles.side}>
          <div className={styles.sideAct}>
            {data.corrections ? <CorrectionsCard corrections={data.corrections} /> : null}
            <MissingCard missing={data.missing} />
          </div>
          <div className={styles.sideInfo}>
            {data.canCorrect ? <NeedsLookCard data={data.needsLook} /> : null}
            <LeaveCard data={data.leave} />
          </div>
        </div>
      </div>
    </div>
  );
}
