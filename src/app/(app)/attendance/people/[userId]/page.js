// One person's attendance month for HR and Admins (CONTRACT 25, item 8; a PM gets /no-access):
// the profile card with six numbers, each day of the payroll month, the calendar and the changes
// with their reasons. An Admin's month is 404 for anyone but an Admin; the person's own month is
// viewable without actions.
import { notFound } from 'next/navigation';
import { Info } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import Card, { CardHeader } from '@/components/Card';
import DateSwitcher from '@/components/DateSwitcher';
import EmptyState from '@/components/EmptyState';
import MonthCalendar from '@/components/MonthCalendar';
import TopBar from '@/components/TopBar';
import { requirePage } from '@/lib/session';
import { personMonthQuerySchema, userIdParamSchema } from '@/modules/attendance/monthSchemas';
import { UPDATE_NOTICE } from '../../month/monthWords';
import PersonChanges from './PersonChanges';
import PersonDays from './PersonDays';
import { loadPersonMonth } from './personMonthData';
import styles from './page.module.css';

export const metadata = { title: 'Attendance month' };

function Actions({ data }) {
  const { switcher } = data;
  return (
    <>
      <DateSwitcher
        label={switcher.label}
        prevHref={switcher.prevHref}
        prevLabel={switcher.prevLabel}
        nextHref={switcher.nextHref}
        nextLabel={switcher.nextLabel}
      />
      <Button
        variant="secondary"
        href={data.exportHref}
        download={data.exportName}
        prefetch={false}
      >
        Download Excel
      </Button>
    </>
  );
}

function Profile({ data }) {
  const { person, profile } = data;
  return (
    <Card as="section" className={styles.profile} aria-label={person.name}>
      <div className={styles.who}>
        <Avatar user={person} size={64} />
        <p className={styles.whoText}>
          {profile.role ? <strong>{profile.role}</strong> : null}
          <span>{profile.shift}</span>
          {profile.since ? <span>{profile.since}</span> : null}
        </p>
      </div>
      <dl className={styles.stats}>
        {data.stats.map((stat) => (
          <div key={stat.key} className={styles.stat}>
            <dt className={styles.statLabel}>{stat.label}</dt>
            <dd className={styles.statValue}>
              {stat.value}
              {stat.small ? <small>{stat.small}</small> : null}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function CalendarCard({ data }) {
  return (
    <Card className={styles.calendar}>
      <CardHeader title="Calendar" subtitle={data.calendarSubtitle} />
      <MonthCalendar
        weeks={data.calendar.weeks}
        weekdays={data.calendar.weekdays}
        legendItems={data.calendar.legend}
        label={`Calendar, ${data.calendarSubtitle}`}
        className={styles.calendarGrid}
      />
    </Card>
  );
}

const text = (value) => (typeof value === 'string' ? value : undefined);

export default async function PersonMonthPage({ params, searchParams }) {
  const viewer = await requirePage('attendance.correct');
  const id = userIdParamSchema.safeParse((await params).userId);
  if (!id.success) notFound();
  const query = personMonthQuerySchema.safeParse({ month: text((await searchParams)?.month) });
  const month = query.success ? query.data.month : undefined;
  const data = await loadPersonMonth({ viewer, userId: id.data, month });

  return (
    <div className={styles.page}>
      <TopBar
        breadcrumb={data.breadcrumb}
        title={data.person.name}
        subtitle={data.subtitle}
        actions={<Actions data={data} />}
      />
      <Profile data={data} />
      {data.needsUpdate ? (
        <Card padding="compact" role="status" className={styles.notice}>
          <Info size={18} strokeWidth={1.8} aria-hidden="true" className={styles.noticeIcon} />
          <p className={styles.noticeText}>{UPDATE_NOTICE}</p>
        </Card>
      ) : null}
      {data.untracked ? (
        <Card>
          <EmptyState compact title="Their attendance isn't tracked." />
        </Card>
      ) : (
        <div className={styles.grid}>
          <PersonDays rows={data.days} canChange={data.canChange} className={styles.days} />
          <div className={styles.right}>
            <CalendarCard data={data} />
            <PersonChanges changes={data.changes} more={data.changesMore} />
          </div>
        </div>
      )}
    </div>
  );
}
