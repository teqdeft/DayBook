'use client';
// The Attendance row's "..." menu (CONTRACT 25, items 5 and 9), HR and Admins, rows other than
// their own: D's remind item first, then "Mark leave" (person and day preset) or "Edit leave"
// when the person has leave that day. Before migration 018 the leave items are left out, and with
// nothing in it there is no menu at all, so the Action column keeps one line.
import { useState } from 'react';
import { CalendarPlus, Pencil } from 'lucide-react';
import Menu from '@/components/Menu';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import LeaveDialog from './LeaveDialog';
import { remindMenuItem } from './remindItem';
import styles from './RowMenu.module.css';
import { useRemind } from './useRemind';

const ICON = { size: 14, strokeWidth: 1.8, 'aria-hidden': true };

/**
 * @param {{ person: { id: number, name: string }, date: string,
 *   leave: { id: number, part: string } | null,
 *   remind: { kind: string, user: { id: number, name: string } } | null,
 *   canMarkLeave: boolean }} props date = the row's day; leave = the person's leave that day;
 *   canMarkLeave is false before migration 018
 */
export default function RowMenu({ person, date, leave, remind, canMarkLeave }) {
  const toast = useToast();
  const { send } = useRemind();
  const [dialog, setDialog] = useState(null);

  /** Edit leave needs the whole entry (note included): the one covering the row's day. */
  async function openEdit() {
    try {
      const query = new URLSearchParams({ userId: String(person.id), from: date, to: date });
      const { data } = await api.get(`/api/leave?${query}`);
      const entry = (data ?? []).find((item) => item.id === leave.id) ?? data?.[0];
      if (!entry) throw new Error('That leave no longer exists.');
      setDialog({ entry });
    } catch (error) {
      toast({ title: "Couldn't open the leave", body: error.message, tone: 'error' });
    }
  }

  const items = [];
  const remindItem = remind ? remindMenuItem({ kind: remind.kind, user: remind.user, send }) : null;
  if (remindItem) items.push(remindItem);
  if (canMarkLeave) {
    items.push(
      leave
        ? { label: 'Edit leave', icon: <Pencil {...ICON} />, onSelect: openEdit }
        : {
            label: 'Mark leave',
            icon: <CalendarPlus {...ICON} />,
            onSelect: () => setDialog({ entry: null }),
          },
    );
  }
  if (items.length === 0) return null;

  return (
    <>
      <Menu label={`More for ${person.name}`} items={items} width={220} className={styles.menu} />
      <LeaveDialog
        open={Boolean(dialog)}
        onClose={() => setDialog(null)}
        entry={dialog?.entry ?? null}
        person={person}
        date={date}
      />
    </>
  );
}
