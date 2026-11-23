// Attendance, Month (CONTRACT 25, item 4): everyone's payroll month for HR and Admins (a PM gets
// /no-access): the Day / Month switch, the payroll month's DateSwitcher, the month Excel, five
// number cards and the table with its filters. No AutoRefresh: a month changes slowly.
import { Info } from 'lucide-react';
import Button from '@/components/Button';
import Card from '@/components/Card';
import DateSwitcher from '@/components/DateSwitcher';
import Kpi from '@/components/Kpi';
import Segmented from '@/components/Segmented';
import TopBar from '@/components/TopBar';
import { requirePage } from '@/lib/session';
import { loadMonth } from './monthData';
import MonthTable from './MonthTable';
import { UPDATE_NOTICE } from './monthWords';
import styles from './page.module.css';

export const metadata = { title: 'Attendance month' };

const VIEWS = [
  { value: 'day', label: 'Day', href: '/attendance' },
  { value: 'month', label: 'Month', href: '/attendance/month' },
];

const text = (value) => (typeof value === 'string' ? value : undefined);

function Actions({ data }) {
  const { switcher } = data;
  return (
    <>
      <Segmented items={VIEWS} value="month" label="View" />
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

export default async function AttendanceMonthPage({ searchParams }) {
  const user = await requirePage('attendance.correct');
  const params = await searchParams;
  const data = await loadMonth({ user, month: text(params?.month), filter: text(params?.filter) });

  return (
    <div className={styles.page}>
      <TopBar title="Attendance" subtitle={data.subtitle} actions={<Actions data={data} />} />

      <section className={styles.kpis} aria-label="Numbers">
        {data.kpis.map((kpi) => (
          <Kpi key={kpi.label} {...kpi} />
        ))}
      </section>

      {data.needsUpdate ? (
        <Card padding="compact" role="status" className={styles.notice}>
          <Info size={18} strokeWidth={1.8} aria-hidden="true" className={styles.noticeIcon} />
          <p className={styles.noticeText}>{UPDATE_NOTICE}</p>
        </Card>
      ) : null}

      <MonthTable data={data} />
    </div>
  );
}
