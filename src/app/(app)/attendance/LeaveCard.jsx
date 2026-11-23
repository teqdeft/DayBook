'use client';
// The "Leave and holidays" side card on Attendance (CONTRACT 25, item 9), last in the side
// column, for everyone with attendance.view_all: who is on leave that day (the part, for HR and
// Admins also the type and pay, and "Checked in" when they did), for HR and Admins the leave
// coming up in the next 7 days, the next holiday within 60 days, and the buttons Mark leave (HR,
// Admin), All leave (HR, Admin) and Holidays. PMs never see the type or pay (they aren't in data).
import { useState } from 'react';
import { Info } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import Card, { CardHeader } from '@/components/Card';
import { formatDayShort } from '@/lib/time';
import { LEAVE_TYPE_LABELS, PART_LABELS } from '@/modules/attendance/calendar';
import LeaveDialog from './LeaveDialog';
import { leaveDaysLabel } from './leaveForm';
import styles from './LeaveCard.module.css';

/** "Full day · Sick, paid · Checked in" (the type and pay only when the data has them). */
function subLine(item) {
  const parts = [PART_LABELS[item.part] ?? PART_LABELS.full];
  if (item.leaveType) {
    const type = LEAVE_TYPE_LABELS[item.leaveType] ?? LEAVE_TYPE_LABELS.other;
    parts.push(`${type}, ${item.paid === false ? 'unpaid' : 'paid'}`);
  }
  if (item.checkedIn) parts.push('Checked in');
  return parts.join(' · ');
}

function OnLeaveList({ items }) {
  if (items.length === 0) return <p className={styles.empty}>Nobody is on leave.</p>;
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item.user.id} className={styles.item}>
          <Avatar user={item.user} size={30} />
          <span className={styles.text}>
            <span className={styles.name}>{item.user.name}</span>
            <span className={styles.sub}>{subLine(item)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function ComingUp({ upcoming }) {
  if (upcoming.length === 0) return null;
  return (
    <>
      <p className={styles.heading}>Coming up</p>
      <ul className={styles.lines}>
        {upcoming.map((item) => (
          <li key={`${item.user.id}-${item.fromDate}`}>
            {item.user.name}, {leaveDaysLabel(item)}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * @param {{ data: { date: string, isToday: boolean, title: string, items: object[],
 *   upcoming: object[], nextHoliday: { date: string, name: string } | null,
 *   canCorrect: boolean, available: boolean } }} props items = listOnLeave(), upcoming =
 *   listUpcomingLeave() (HR and Admins only); available is false before migration 018
 */
export default function LeaveCard({ data }) {
  const [marking, setMarking] = useState(false);
  if (!data) return null;
  return (
    <Card>
      <CardHeader title={data.title} />
      {data.available ? (
        <>
          <OnLeaveList items={data.items ?? []} />
          {data.canCorrect ? <ComingUp upcoming={data.upcoming ?? []} /> : null}
          {data.nextHoliday ? (
            <p className={styles.muted}>
              Next holiday: {data.nextHoliday.name}, {formatDayShort(data.nextHoliday.date)}
            </p>
          ) : null}
          <div className={styles.buttons}>
            {data.canCorrect ? (
              <>
                <Button variant="text" size="compact" onClick={() => setMarking(true)}>
                  Mark leave
                </Button>
                <Button variant="text" size="compact" href="/attendance/leave">
                  All leave
                </Button>
              </>
            ) : null}
            <Button variant="text" size="compact" href="/attendance/holidays">
              Holidays
            </Button>
          </div>
        </>
      ) : (
        <p className={styles.unavailable}>
          <Info size={16} strokeWidth={1.8} aria-hidden="true" className={styles.icon} />
          This needs the latest database update. Ask an Admin.
        </p>
      )}
      {data.canCorrect ? <LeaveDialog open={marking} onClose={() => setMarking(false)} /> : null}
    </Card>
  );
}
