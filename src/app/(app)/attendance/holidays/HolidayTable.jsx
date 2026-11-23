'use client';
// The Holidays page's table (CONTRACT 25, item 6): Date, Name, Status ("Today", "Past", "Not a
// working day") and, for HR and Admins, a menu "Actions for Guru Nanak Jayanti" with Edit and
// Delete. Empty: "No holidays in 2026", with "Add holiday" for HR and Admins. Below 1024 px the
// rows stack as cards (DataTable).
import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import Button from '@/components/Button';
import DataTable from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import Menu from '@/components/Menu';
import Tag from '@/components/Tag';
import HolidayDeleteDialog from './HolidayDeleteDialog';
import HolidayDialog from './HolidayDialog';
import styles from './page.module.css';

const ICON = { size: 14, strokeWidth: 1.8, 'aria-hidden': true };

function columnsFor({ canCorrect, setDialog }) {
  const columns = [
    {
      key: 'date',
      header: 'Date',
      width: 150,
      render: (row) => <span className={styles.date}>{row.dayLabel}</span>,
    },
    {
      key: 'name',
      header: 'Name',
      render: (row) => <span className={styles.name}>{row.name}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: 230,
      render: (row) =>
        row.statuses.length ? (
          <span className={styles.tags}>
            {row.statuses.map((tag) => (
              <Tag key={tag.label} tone={tag.tone} size="sm">
                {tag.label}
              </Tag>
            ))}
          </span>
        ) : null,
    },
  ];
  if (!canCorrect) return columns;
  columns.push({
    key: 'actions',
    header: <span className="visually-hidden">Actions</span>,
    width: 64,
    align: 'right',
    render: (row) => (
      <Menu
        label={`Actions for ${row.name}`}
        className={styles.menu}
        items={[
          {
            label: 'Edit',
            icon: <Pencil {...ICON} />,
            onSelect: () => setDialog({ type: 'edit', holiday: row }),
          },
          {
            label: 'Delete',
            tone: 'danger',
            icon: <Trash2 {...ICON} />,
            onSelect: () => setDialog({ type: 'delete', holiday: row }),
          },
        ]}
      />
    ),
  });
  return columns;
}

/**
 * @param {{ rows: object[], year: number, today: string, firstYear: number, lastYear: number,
 *   canCorrect: boolean }} props rows from holidaysData.js
 */
export default function HolidayTable({ rows, year, today, firstYear, lastYear, canCorrect }) {
  const [dialog, setDialog] = useState(null);
  const limits = { today, firstYear, lastYear };
  const empty = (
    <EmptyState
      compact
      title={`No holidays in ${year}`}
      body={
        canCorrect ? 'Add the days the office is closed.' : 'HR adds the days the office is closed.'
      }
      action={
        canCorrect ? (
          <Button variant="secondary" onClick={() => setDialog({ type: 'add', holiday: null })}>
            Add holiday
          </Button>
        ) : null
      }
    />
  );
  return (
    <>
      <DataTable
        columns={columnsFor({ canCorrect, setDialog })}
        rows={rows}
        empty={empty}
        caption={`Holidays in ${year}`}
      />
      {canCorrect ? (
        <>
          <HolidayDialog
            {...limits}
            open={dialog?.type === 'add' || dialog?.type === 'edit'}
            holiday={dialog?.type === 'edit' ? dialog.holiday : null}
            onClose={() => setDialog(null)}
          />
          <HolidayDeleteDialog
            open={dialog?.type === 'delete'}
            holiday={dialog?.type === 'delete' ? dialog.holiday : null}
            today={today}
            onClose={() => setDialog(null)}
          />
        </>
      ) : null}
    </>
  );
}
