// Screen time (docs/CONTRACT.md section 11; no artboard, built from the canvas components): one
// day for every tracked person, whether they are active, idle or have the screen locked, with a
// day timeline. PM and Admin. ?date=YYYY-MM-DD picks the day; today refreshes every minute.
import Link from 'next/link';
import { Info } from 'lucide-react';
import Button from '@/components/Button';
import Card from '@/components/Card';
import DateSwitcher from '@/components/DateSwitcher';
import Kpi from '@/components/Kpi';
import TopBar from '@/components/TopBar';
import { requirePage } from '@/lib/session';
import { addDays, formatDay, formatDayShort } from '@/lib/time';
import AutoRefresh from '../today/AutoRefresh';
import ScreenTimeBoard from './ScreenTimeBoard';
import { loadScreenTime } from './screenTimeData';
import styles from './page.module.css';

export const metadata = { title: 'Screen time' };

function dayName(date, today) {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  return formatDayShort(date);
}

/** '/screen-time?date=2026-09-29' (today is left out). */
function hrefFor(date, today) {
  return date && date !== today ? `/screen-time?date=${date}` : '/screen-time';
}

function TrackingOff({ canManageSettings }) {
  return (
    <Card padding="compact" className={styles.notice} role="status">
      <Info size={18} strokeWidth={1.8} aria-hidden="true" className={styles.noticeIcon} />
      <p className={styles.noticeText}>
        Screen time is turned off, so nothing new is recorded. Earlier days still show here.
        {canManageSettings ? (
          <>
            {' '}
            <Link href="/settings">Open settings</Link>
          </>
        ) : null}
      </p>
    </Card>
  );
}

export default async function ScreenTimePage({ searchParams }) {
  const user = await requirePage('activity.view_all');
  const params = await searchParams;
  const data = await loadScreenTime({
    user,
    date: typeof params?.date === 'string' ? params.date : undefined,
  });
  const { date, today, isToday } = data;

  return (
    <div className={styles.page}>
      {isToday ? <AutoRefresh /> : null}
      <TopBar
        title="Screen time"
        subtitle={data.subtitle}
        actions={
          <>
            <DateSwitcher
              label={dayName(date, today)}
              prevHref={data.prevDate ? hrefFor(data.prevDate, today) : null}
              prevLabel={data.prevDate ? formatDay(data.prevDate) : 'No earlier days'}
              nextHref={data.nextDate ? hrefFor(data.nextDate, today) : null}
              nextLabel={data.nextDate ? formatDay(data.nextDate) : 'No later days'}
            />
            <Button
              variant="secondary"
              href={`/api/activity/export?date=${date}`}
              download={`screen-time-${date}.xlsx`}
              prefetch={false}
            >
              Download Excel
            </Button>
          </>
        }
      />

      {data.trackingOff ? <TrackingOff canManageSettings={data.canManageSettings} /> : null}

      <section className={styles.kpis} aria-label="The day in numbers">
        {data.kpis.map((kpi) => (
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

      <ScreenTimeBoard
        key={date}
        title={isToday ? 'Everyone today' : `Everyone, ${formatDayShort(date)}`}
        isToday={isToday}
        rows={data.rows}
        counts={data.counts}
        ticks={data.ticks}
        measured={data.measured}
      />
    </div>
  );
}
