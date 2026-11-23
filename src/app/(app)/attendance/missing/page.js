// Missing check-outs (CONTRACT 25, item 7): every check-out still to fix, behind the "Missing
// check-out" number on Attendance. Everyone with attendance.view_all sees the list; HR and Admins
// also get the suggested time, a time input per row, Fix and Remind, and the bulk bar (Remind
// selected, Fix selected). PMs see Person, Day and Check-in only.
import Link from 'next/link';
import { CalendarDays, Info } from 'lucide-react';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import TopBar from '@/components/TopBar';
import { requirePage } from '@/lib/session';
import { loadMissing } from './missingData';
import MissingTable from './MissingTable';
import styles from './page.module.css';

export const metadata = { title: 'Missing check-outs' };

/** "Showing 1 to 50 of 72" with Previous and Next (a muted span when there is none). */
function Pager({ pager }) {
  const link = (href, label) =>
    href ? (
      <Link href={href} className={styles.pagerLink}>
        {label}
      </Link>
    ) : (
      <span className={styles.pagerOff} aria-disabled="true">
        {label}
      </span>
    );
  return (
    <nav className={styles.pager} aria-label="Pages">
      <span>
        Showing {pager.first} to {pager.last} of {pager.total}
      </span>
      <span className={styles.pagerLinks}>
        {link(pager.prevHref, 'Previous')}
        {link(pager.nextHref, 'Next')}
      </span>
    </nav>
  );
}

export default async function MissingCheckoutsPage({ searchParams }) {
  const user = await requirePage('attendance.view_all');
  const params = await searchParams;
  const data = await loadMissing({
    user,
    page: typeof params?.page === 'string' ? params.page : undefined,
  });

  return (
    <div className={styles.page}>
      <TopBar
        title="Missing check-outs"
        subtitle={data.total ? `${data.total} to fix, newest first` : 'Nothing to fix'}
        breadcrumb={[{ label: 'Attendance', href: '/attendance' }, { label: 'Missing check-outs' }]}
      />

      {data.canCorrect ? (
        <Card padding="compact" className={styles.notice} role="note">
          <Info size={18} strokeWidth={1.8} aria-hidden="true" className={styles.noticeIcon} />
          <p className={styles.noticeText}>
            Suggested times come from the last time Daybook saw each person working. Check before
            you save.
          </p>
        </Card>
      ) : null}

      <Card padding="none" className={styles.list} aria-label="Still to fix">
        {data.total ? (
          <>
            <MissingTable rows={data.rows} canCorrect={data.canCorrect} />
            <Pager pager={data.pager} />
          </>
        ) : (
          <EmptyState
            icon={<CalendarDays size={20} strokeWidth={1.8} />}
            title="No missing check-outs"
            body="Everyone's check-outs are in."
          />
        )}
      </Card>
    </div>
  );
}
