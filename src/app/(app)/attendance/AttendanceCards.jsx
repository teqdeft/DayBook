// Attendance page blocks (artboard 09): the "Everyone today" table (its cells are in DayCells.jsx,
// CONTRACT 25) and the correction requests. Server Components; row actions are small client
// components. The On leave and On break pills show only above 0 (dayRows.pillsFor), and for HR on
// today the Not checked in and On break filters get D's "Remind all".
import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Badge from '@/components/Badge';
import Card, { CardHeader } from '@/components/Card';
import DataTable from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import FilterPills from '@/components/FilterPills';
import BreakListHost from './BreakListHost';
import CorrectionActions from './CorrectionActions';
import {
  ActionCell,
  CheckInCell,
  NoteCell,
  OutCell,
  PersonCell,
  PresentCell,
  WhereCell,
} from './DayCells';
import RemindAllButton from './RemindAllButton';
import styles from './page.module.css';

function columns(canCorrect) {
  const list = [
    { key: 'person', header: 'Person', width: 189.67, render: (row) => <PersonCell row={row} /> },
    { key: 'where', header: 'Where', width: 105.67, render: (row) => <WhereCell row={row} /> },
    {
      key: 'checkIn',
      header: 'Check-in',
      width: 89.33,
      render: (row) => <CheckInCell row={row} />,
    },
    { key: 'out', header: 'Out', width: 72.67, render: (row) => <OutCell row={row} /> },
    { key: 'present', header: 'Present', width: 81, render: (row) => <PresentCell row={row} /> },
    // The note takes what is left (142 px on the artboard; at least 96 px beside HR's wider
    // action column), so a narrower table never squeezes HR's action out of view.
    { key: 'note', header: 'Note', render: (row) => <NoteCell row={row} /> },
  ];
  if (canCorrect) {
    list.push({
      key: 'action',
      header: <span className="visually-hidden">Action</span>,
      label: 'Action',
      // RowAction and the row's "..." menu on one line (CONTRACT 25: 95.66 px became 120 px).
      width: 120,
      render: (row) => <ActionCell row={row} />,
    });
  }
  return list;
}

const EMPTY = {
  all: ['Nobody tracks attendance yet', 'People who check in show up here.'],
  late: ['Nobody was late', 'Everyone checked in on time.'],
  wfh: ['Nobody worked from home', 'Everyone who checked in was at the office.'],
  not_checked_in: ['Everyone checked in', 'Nobody is missing.'],
  on_leave: ['Nobody is on leave', 'Leave HR marks shows here.'],
  unverified: ['Nothing to confirm', 'Every office check-in came from the office network.'],
  on_break: ['Nobody is on a break', 'People on a break show up here.'],
};

// The title takes the focus when a break fix takes the row whose list was open out of the filter.
const EVERYONE_TITLE = 'everyone-title';

export function EveryoneCard({ data, title }) {
  const [emptyTitle, emptyBody] = EMPTY[data.filter] ?? EMPTY.all;
  const pills = data.pills;
  return (
    <Card padding="none" className={styles.everyone}>
      <div className={styles.everyoneHead}>
        <h2 id={EVERYONE_TITLE} tabIndex={-1} className={styles.cardTitle}>
          {title}
        </h2>
        <div className={styles.headTools}>
          <FilterPills items={pills} value={data.filter} label="Show" className={styles.pills} />
          {data.remindAll && data.remindAll.users.length > 0 ? (
            <RemindAllButton kind={data.remindAll.kind} users={data.remindAll.users} />
          ) : null}
        </div>
      </div>
      <BreakListHost returnTo={EVERYONE_TITLE}>
        <DataTable
          className={styles.table}
          columns={columns(data.canCorrect)}
          rows={data.rows}
          caption={title}
          empty={
            <EmptyState
              compact
              icon={<CalendarDays size={20} strokeWidth={1.8} />}
              title={emptyTitle}
              body={emptyBody}
              action={
                data.filter === 'all' ? null : (
                  <Link href={pills[0].href} className={styles.emptyLink} scroll={false}>
                    Show everyone
                  </Link>
                )
              }
            />
          }
        />
      </BreakListHost>
    </Card>
  );
}

export function CorrectionsCard({ corrections }) {
  const { items, total } = corrections;
  return (
    <Card className={styles.corrections}>
      <CardHeader
        title="Correction requests"
        actions={total > 0 ? <Badge label={`${total} waiting`}>{total}</Badge> : null}
      />
      {items.length === 0 ? (
        <p className={styles.sideEmpty}>No requests waiting. People ask from their Today page.</p>
      ) : (
        <ul className={styles.correctionList}>
          {items.map((item) => (
            <li key={item.id} className={styles.correction}>
              <span className={styles.correctionPerson}>
                <Avatar user={item.user} size={30} />
                <span className={styles.correctionName}>{item.user.name}</span>
              </span>
              <p className={styles.correctionTitle} title={item.reason}>
                {item.reason}
              </p>
              <p className={styles.correctionText}>{item.summary}</p>
              {item.own ? (
                <p className={styles.correctionOwn}>
                  Your own request. Another HR person or an Admin decides.
                </p>
              ) : (
                <CorrectionActions id={item.id} name={item.user.name} title={item.reason} />
              )}
            </li>
          ))}
        </ul>
      )}
      {total > items.length ? (
        <p className={styles.sideMore}>{total - items.length} more after these.</p>
      ) : null}
      <p className={styles.sideFoot}>Your reason is saved with every correction.</p>
    </Card>
  );
}
