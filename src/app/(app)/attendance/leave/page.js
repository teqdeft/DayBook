// Leave (CONTRACT 25, item 9): the leave HR has marked in a payroll month, for HR and Admins only
// (attendance.correct: the type and the note are theirs). A Person filter, the table and Mark
// leave; an entry shows in every month it touches. Before migration 018 a muted notice stands in
// for the table and the button.
import Card, { CardHeader } from '@/components/Card';
import DateSwitcher from '@/components/DateSwitcher';
import TopBar from '@/components/TopBar';
import { requirePage } from '@/lib/session';
import { UpdateNeededNotice } from '../DayNotice';
import LeaveFilter from './LeaveFilter';
import LeaveTable, { MarkLeaveButton } from './LeaveTable';
import { loadLeave } from './leaveData';
import styles from './page.module.css';

export const metadata = { title: 'Leave' };

const SUBTITLE = "Leave HR has marked. People on leave aren't counted absent or reminded.";

const param = (value) => (typeof value === 'string' ? value : undefined);

export default async function LeavePage({ searchParams }) {
  const user = await requirePage('attendance.correct');
  const params = await searchParams;
  const data = await loadLeave({
    user,
    month: param(params?.month),
    userId: param(params?.userId),
    page: param(params?.page),
  });

  return (
    <div className={styles.page}>
      <TopBar
        title="Leave"
        subtitle={data.rangeLabel ? `${SUBTITLE} ${data.rangeLabel}` : SUBTITLE}
        breadcrumb={[{ label: 'Attendance', href: '/attendance' }, { label: 'Leave' }]}
        actions={
          <>
            <DateSwitcher {...data.switcher} />
            {data.available ? (
              <MarkLeaveButton today={data.today} markable={data.markable} />
            ) : null}
          </>
        }
      />
      {data.available ? (
        <>
          <LeaveFilter people={data.people} userId={data.userId} month={data.month} />
          <Card padding="none">
            <CardHeader title={data.title} subtitle={data.subtitle} divider />
            <LeaveTable
              rows={data.rows}
              total={data.total}
              page={data.page}
              pageSize={data.pageSize}
              monthName={data.monthName}
              month={data.month}
              userId={data.userId}
              viewerId={data.viewerId}
              today={data.today}
              markable={data.markable}
            />
          </Card>
        </>
      ) : (
        <UpdateNeededNotice />
      )}
    </div>
  );
}
