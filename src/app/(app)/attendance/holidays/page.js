// Holidays (CONTRACT 25, item 6): the company's holidays of a year, from last year to next year.
// Everyone with attendance.view_all sees them; HR and Admins (attendance.correct) add, edit and
// delete them. Before migration 018 a muted notice stands in for the table and the button.
import Card, { CardHeader } from '@/components/Card';
import DateSwitcher from '@/components/DateSwitcher';
import TopBar from '@/components/TopBar';
import { requirePage } from '@/lib/session';
import { UpdateNeededNotice } from '../DayNotice';
import { AddHolidayButton } from './HolidayDialog';
import HolidayTable from './HolidayTable';
import { loadHolidays } from './holidaysData';
import styles from './page.module.css';

export const metadata = { title: 'Holidays' };

const SUBTITLE =
  'Days the office is closed. Nobody is expected in, so there are no late marks or reminders.';

function Actions({ data }) {
  return (
    <>
      <DateSwitcher
        label={String(data.year)}
        prevHref={data.prev.href}
        prevLabel={data.prev.label}
        nextHref={data.next.href}
        nextLabel={data.next.label}
      />
      {data.canCorrect && data.available ? (
        <AddHolidayButton today={data.today} firstYear={data.firstYear} lastYear={data.lastYear} />
      ) : null}
    </>
  );
}

export default async function HolidaysPage({ searchParams }) {
  const user = await requirePage('attendance.view_all');
  const params = await searchParams;
  const data = await loadHolidays({
    user,
    year: typeof params?.year === 'string' ? params.year : undefined,
  });

  return (
    <div className={styles.page}>
      <TopBar
        title="Holidays"
        subtitle={SUBTITLE}
        breadcrumb={[{ label: 'Attendance', href: '/attendance' }, { label: 'Holidays' }]}
        actions={<Actions data={data} />}
      />
      {data.available ? (
        <Card padding="none">
          <CardHeader title={String(data.year)} subtitle={data.subtitle} divider />
          <HolidayTable
            rows={data.rows}
            year={data.year}
            today={data.today}
            firstYear={data.firstYear}
            lastYear={data.lastYear}
            canCorrect={data.canCorrect}
          />
        </Card>
      ) : (
        <UpdateNeededNotice />
      )}
    </div>
  );
}
