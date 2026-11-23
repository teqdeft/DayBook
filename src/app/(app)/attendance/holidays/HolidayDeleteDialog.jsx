'use client';
// "Delete Guru Nanak Jayanti?" (CONTRACT 25, item 6): the day becomes a working day again and the
// late marks of anyone who checked in that day are worked out again; for today or an earlier day
// the Admins are told. Then DELETE /api/holidays/:id.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { formatDayShort } from '@/lib/time';

/** The dialog's description. */
export function deleteDescription(holiday, today) {
  const text = `${formatDayShort(holiday.date)} becomes a working day again. Late marks of anyone who checked in that day are worked out again.`;
  return holiday.date <= today ? `${text} Admins are told.` : text;
}

/**
 * @param {{ open: boolean, onClose: () => void, holiday: { id: number, date: string,
 *   name: string } | null, today: string }} props
 */
export default function HolidayDeleteDialog({ open, onClose, holiday, today }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  function close() {
    if (!busy) onClose();
  }

  async function remove() {
    setBusy(true);
    try {
      await api.delete(`/api/holidays/${holiday.id}`);
      toast({ title: 'Holiday deleted' });
      setBusy(false);
      onClose();
      router.refresh();
    } catch (error) {
      setBusy(false);
      toast({ title: "Couldn't delete the holiday", body: error.message, tone: 'error' });
    }
  }

  if (!holiday) return null;
  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Delete ${holiday.name}?`}
      description={deleteDescription(holiday, today)}
      width={440}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={remove} loading={busy}>
            Delete
          </Button>
        </>
      }
    />
  );
}
