// Today (artboard 01): check in, the day so far, this week, the urgent project, this week's tasks,
// the person's priority tasks (when there are any) and the report strip. Before check-in the
// "Your day" card is the check-in card. CONTRACT 15 adds Start break / End break beside Check out
// and the Working on card (project timers) under Your day while timers aren't off. CONTRACT 17:
// Office from any network and HR-approved work from home on the check-in card, and the "Ask HR"
// line under the correction links. CONTRACT 19: "Checked out automatically at 6:12" after an auto
// check-out, and a "Still working?" line under the top bar after office hours.
import { headers } from 'next/headers';
import { Info } from 'lucide-react';
import Card from '@/components/Card';
import Tag from '@/components/Tag';
import TopBar from '@/components/TopBar';
import { clientIp } from '@/lib/route';
import { requirePage } from '@/lib/session';
import {
  addDays,
  formatClock,
  formatClockShort,
  formatDay,
  formatTime,
  greeting,
} from '@/lib/time';
import { attendance } from '@/modules/attendance';
import AutoRefresh from './AutoRefresh';
import BreakButton from './BreakButton';
import CheckInCard from './CheckInCard';
import CheckOutButton from './CheckOutButton';
import CorrectionLinks from './CorrectionLinks';
import PriorityCard from './PriorityCard';
import TimerCard from './TimerCard';
import { loadToday } from './todayData';
import { ReportStrip, TasksCard, UrgentCard, WeekCard, YourDayCard } from './TodayCards';
import WfhLinks from './WfhLinks';
import { firstName } from './wfhOptions';
import styles from './page.module.css';

export const metadata = { title: 'Today' };

/** @param {{ data: object, tracksAttendance: boolean }} props */
function TopActions({ data, tracksAttendance }) {
  const { row, pill } = data;
  const open = Boolean(row) && !row.checkOutAt && row.checkoutStatus === 'open';
  // Breaks are for people who check in: attendance.startBreak refuses anyone else (FORBIDDEN).
  // A break that is already open can always end, so End break stays.
  const breaks = open && (tracksAttendance || data.onBreak);
  return (
    <>
      {pill ? (
        <Tag tone={pill.tone} size="xxl" dot>
          {pill.text}
        </Tag>
      ) : null}
      {breaks ? <BreakButton onBreak={data.onBreak} /> : null}
      {open ? (
        <CheckOutButton
          reportSubmitted={data.reportStatus === 'submitted'}
          dueText={formatClock(data.settings.reportReminderAt)}
          tz={data.tz}
        />
      ) : null}
    </>
  );
}

export default async function TodayPage() {
  const user = await requirePage('attendance.self');
  const ip = clientIp({ headers: await headers() });
  const data = await loadToday({ user, ip });
  const { row, settings: current, tz, today } = data;
  const hasUrgent = data.urgent.length > 0;

  return (
    <div className={styles.page}>
      <AutoRefresh />
      <TopBar
        title={`${greeting(tz)}, ${firstName(user.name)}`}
        subtitle={formatDay(today)}
        actions={<TopActions data={data} tracksAttendance={Boolean(user.tracksAttendance)} />}
        bell
      />

      {data.stillWorking ? (
        <Card padding="compact" className={styles.notice} role="status">
          <Info size={18} strokeWidth={1.8} aria-hidden="true" className={styles.noticeIcon} />
          <p className={styles.noticeText}>{data.stillWorking}</p>
        </Card>
      ) : null}

      <section className={styles.rowDay} aria-label="Your day">
        {row ? (
          <YourDayCard data={data} />
        ) : (
          <CheckInCard
            onOfficeNetwork={data.onOfficeNetwork}
            allowUnverifiedOffice={current.allowUnverifiedOffice}
            officeAnywhere={data.officeAnywhere}
            wfh={data.wfh}
            today={today}
            lateAfter={formatClockShort(
              attendance.lateMarkFor({ shiftStart: user.shiftStart, settings: current }),
            )}
            officeHours={`${formatClockShort(current.officeStart)} to ${formatClockShort(current.officeEnd)}`}
            tz={tz}
          />
        )}
        <WeekCard week={data.week} />
      </section>

      {data.timer ? <TimerCard {...data.timer} /> : null}

      <section
        className={`${styles.rowTasks} ${hasUrgent ? '' : styles.rowTasksSolo}`}
        aria-label="Urgent work and tasks"
      >
        {hasUrgent ? <UrgentCard urgent={data.urgent} tz={tz} today={today} /> : null}
        <TasksCard tasks={data.tasks} />
      </section>

      {data.priority.rows.length > 0 ? <PriorityCard priority={data.priority} /> : null}

      <ReportStrip data={data} />

      <div className={styles.help}>
        <CorrectionLinks
          today={today}
          yesterday={addDays(today, -1)}
          checkInClock={row ? formatTime(row.checkInAt, tz) : null}
          canSayEarlier={Boolean(row) && !data.hasPendingEarlier}
          pending={data.pending}
        />
        {data.wfhLinks ? <WfhLinks today={today} {...data.wfhLinks} /> : null}
      </div>
    </div>
  );
}
