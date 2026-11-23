'use client';
// "Delete this leave?" (CONTRACT 25, item 9), opened from Edit leave and the Leave page's row
// menu: the person and the days, a required reason, then DELETE /api/leave/:id. The days count as
// working days again (the server works their late marks out again).
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Field from '@/components/Field';
import Textarea from '@/components/Textarea';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { REASON_MAX } from './leaveForm';

/**
 * @param {{ open: boolean, entry: { id: number, user: { name: string }, days: string },
 *   onCancel: () => void, onDeleted: () => void }} props onCancel = back to where it was opened
 *   from; onDeleted = after the delete (the dialog refreshes the page itself)
 */
export default function LeaveDeleteDialog({ open, entry, onCancel, onDeleted }) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setReason('');
      setError(null);
    }
  }

  function cancel() {
    if (!busy) onCancel();
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/api/leave/${entry.id}`, { body: { reason } });
      toast({ title: 'Leave deleted', body: `${entry.user.name}, ${entry.days}` });
      setBusy(false);
      onDeleted();
      router.refresh();
    } catch (failure) {
      setBusy(false);
      if (failure.fields?.reason) setError(failure.fields.reason);
      else toast({ title: "Couldn't delete the leave", body: failure.message, tone: 'error' });
    }
  }

  return (
    <Dialog
      open={open}
      onClose={cancel}
      title="Delete this leave?"
      description={`${entry.user.name}, ${entry.days}. These days count as working days again.`}
      width={440}
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={busy}>
            Delete
          </Button>
        </>
      }
    >
      <Field label="Reason" htmlFor={`${id}-reason`} error={error}>
        <Textarea
          id={`${id}-reason`}
          rows={2}
          maxLength={REASON_MAX}
          value={reason}
          required
          data-autofocus
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}
