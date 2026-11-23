'use client';
// The Leave page's table (CONTRACT 25, item 9): Person, Days (", first half"), Working days in
// this payroll month ("of 5" when the entry has more outside it, "1 day checked in"), Type, Pay,
// Note (one line, the full text in its title, "—" for the viewer's own entry), Marked by, and a
// menu with Edit and Delete. 50 a page with the pager. Also the top bar's "Mark leave".
import { useState } from 'react';
import Link from 'next/link';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import DataTable from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import Menu from '@/components/Menu';
import Tag from '@/components/Tag';
import { trimNumber } from '@/lib/time';
import LeaveDeleteDialog from '../LeaveDeleteDialog';
import LeaveDialog from '../LeaveDialog';
import styles from './page.module.css';

const ICON = { size: 14, strokeWidth: 1.8, 'aria-hidden': true };
/** "2 days", "1 day", "0.5 day", "0 days". */
const daysText = (days) => `${trimNumber(days)} ${days === 1 || days === 0.5 ? 'day' : 'days'}`;

function PersonCell({ user }) {
  return (
    <span className={styles.person}>
      <Avatar user={user} size={34} />
      <span className={styles.personText}>
        <span className={styles.personName}>{user.name}</span>
        {user.designation ? <span className={styles.personRole}>{user.designation}</span> : null}
      </span>
    </span>
  );
}

function WorkingDaysCell({ row }) {
  return (
    <span className={styles.stack}>
      <span className={styles.number}>{daysText(row.workingDays)}</span>
      {row.entryWorkingDays > row.workingDays ? (
        <span className={styles.mline}>of {trimNumber(row.entryWorkingDays)}</span>
      ) : null}
      {row.checkedInDays > 0 ? (
        <span className={styles.mline}>{daysText(row.checkedInDays)} checked in</span>
      ) : null}
    </span>
  );
}

function columnsFor({ viewerId, setDialog }) {
  return [
    {
      key: 'person',
      header: 'Person',
      width: 200,
      render: (row) => <PersonCell user={row.user} />,
    },
    {
      key: 'days',
      header: 'Days',
      width: 196,
      render: (row) => (
        <span className={styles.days}>
          {row.days}
          {row.part === 'full' ? null : (
            <span className={styles.part}>, {row.partLabel.toLowerCase()}</span>
          )}
        </span>
      ),
    },
    {
      key: 'working',
      header: 'Working days',
      width: 118,
      render: (row) => <WorkingDaysCell row={row} />,
    },
    { key: 'type', header: 'Type', width: 78, render: (row) => row.typeLabel },
    {
      key: 'pay',
      header: 'Pay',
      width: 84,
      render: (row) =>
        row.paid ? (
          <Tag tone="green" size="sm">
            Paid
          </Tag>
        ) : (
          <Tag tone="neutral" size="sm">
            Unpaid
          </Tag>
        ),
    },
    {
      key: 'note',
      header: 'Note',
      render: (row) =>
        row.note ? (
          <span className={styles.note} title={row.note}>
            {row.note}
          </span>
        ) : (
          <span className={styles.dash}>—</span>
        ),
    },
    {
      key: 'marked',
      header: 'Marked by',
      width: 150,
      render: (row) => <span className={styles.marked}>{row.markedBy}</span>,
    },
    {
      key: 'actions',
      header: <span className="visually-hidden">Actions</span>,
      width: 60,
      align: 'right',
      render: (row) =>
        row.user.id === viewerId ? null : (
          <Menu
            label={`Actions for ${row.user.name}'s leave`}
            className={styles.menu}
            items={[
              {
                label: 'Edit',
                icon: <Pencil {...ICON} />,
                onSelect: () => setDialog({ type: 'edit', entry: row }),
              },
              {
                label: 'Delete',
                tone: 'danger',
                icon: <Trash2 {...ICON} />,
                onSelect: () => setDialog({ type: 'delete', entry: row }),
              },
            ]}
          />
        ),
    },
  ];
}

/** "Showing 1 to 50 of 72" with Previous and Next (?page=2), when there is more than a page. */
function Pager({ total, page, pageSize, hrefFor }) {
  if (total <= pageSize) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const hasNext = last < total;
  return (
    <div className={styles.pager}>
      <span>
        Showing {first} to {last} of {total}
      </span>
      <span className={styles.pagerLinks}>
        {page > 1 ? <Link href={hrefFor(page - 1)}>Previous</Link> : null}
        {hasNext ? <Link href={hrefFor(page + 1)}>Next</Link> : null}
      </span>
    </div>
  );
}

/**
 * @param {{ rows: object[], total: number, page: number, pageSize: number, monthName: string,
 *   month: string, userId: number | null, viewerId: number, today: string,
 *   markable: Array<{ id: number, name: string }> }} props
 */
export default function LeaveTable(props) {
  const { rows, total, page, pageSize, monthName, month, userId, viewerId, today, markable } =
    props;
  const [dialog, setDialog] = useState(null);
  const hrefFor = (number) => {
    const query = new URLSearchParams({ month, page: String(number) });
    if (userId) query.set('userId', String(userId));
    return `/attendance/leave?${query}`;
  };
  const empty = (
    <EmptyState
      compact
      title={`No leave in ${monthName}`}
      body="Mark leave when someone tells HR they'll be away."
      action={
        <Button variant="secondary" onClick={() => setDialog({ type: 'mark' })}>
          Mark leave
        </Button>
      }
    />
  );
  return (
    <>
      <DataTable
        columns={columnsFor({ viewerId, setDialog })}
        rows={rows}
        empty={empty}
        caption={`Leave in ${monthName}`}
        className={styles.table}
      />
      <Pager total={total} page={page} pageSize={pageSize} hrefFor={hrefFor} />
      <LeaveDialog
        open={dialog?.type === 'mark' || dialog?.type === 'edit'}
        onClose={() => setDialog(null)}
        entry={dialog?.type === 'edit' ? dialog.entry : null}
        people={markable}
        today={today}
      />
      {dialog?.type === 'delete' ? (
        <LeaveDeleteDialog
          open
          entry={dialog.entry}
          onCancel={() => setDialog(null)}
          onDeleted={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}

/**
 * The top bar's "Mark leave" (primary, Plus).
 * @param {{ today: string, markable: Array<{ id: number, name: string }> }} props
 */
export function MarkLeaveButton({ today, markable }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon={<Plus size={18} strokeWidth={1.8} />} onClick={() => setOpen(true)}>
        Mark leave
      </Button>
      <LeaveDialog open={open} onClose={() => setOpen(false)} people={markable} today={today} />
    </>
  );
}
