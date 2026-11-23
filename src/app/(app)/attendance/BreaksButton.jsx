'use client';
// The Present cell as a button (CONTRACT 25, item 2): once the row has a break, the whole cell
// opens the break list. Its name is the visible text plus a visually hidden " See breaks".
// Everyone who sees Attendance can open it (PMs read only). Inside a BreakListHost (the Everyone
// card, whose filtered rows can go away after a save) the host shows the list. Owner: builder B.
import { useState } from 'react';
import BreakListDialog from './BreakListDialog';
import { useBreakListHost } from './BreakListHost';
import styles from './BreakListDialog.module.css';

/**
 * @param {{ row: { attendanceId: number, user: { name: string }, presentTitle?: string | null },
 *   children: import('react').ReactNode }} props children: the cell's lines
 */
export default function BreaksButton({ row, children }) {
  const host = useBreakListHost();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={styles.cellButton}
        title={row.presentTitle ?? undefined}
        aria-haspopup="dialog"
        onClick={() => (host ? host.show(row) : setOpen(true))}
      >
        {children}
        <span className="visually-hidden"> See breaks</span>
      </button>
      {open ? (
        <BreakListDialog
          attendanceId={row.attendanceId}
          personName={row.user?.name}
          open
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
