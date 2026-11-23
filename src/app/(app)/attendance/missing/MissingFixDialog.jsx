'use client';
// "Fix selected" on Missing check-outs (CONTRACT 25, item 7): one reason for every selected row,
// each saved with the time in its row. The answer says which rows saved; the list shows the
// others' messages under their inputs.
import { useId, useState } from 'react';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Field from '@/components/Field';
import Textarea from '@/components/Textarea';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { plural } from '@/lib/text';
import { formatClock } from '@/lib/time';
import styles from './MissingFixDialog.module.css';

const SUGGESTED_REASON = "Used Daybook's suggested time.";

const keepsSuggestion = (row) => Boolean(row.suggestedClock) && row.checkOut === row.suggestedClock;

/** The toast after a save: all, some or none of the rows. */
function toastFor({ fixed, failed }) {
  const saved = `Fixed ${fixed.length} ${plural(fixed.length, 'check-out', 'check-outs')}`;
  if (failed.length === 0) return { title: saved };
  const body = `${failed.length} couldn't be saved. See the ${plural(failed.length, 'row', 'rows')}.`;
  if (fixed.length === 0) return { title: "Couldn't fix the check-outs", body, tone: 'error' };
  return { title: saved, body };
}

/** The dialog's body for one set of rows (keyed, so the reason starts fresh each time). */
function FixForm({ rows, onClose, onDone }) {
  const toast = useToast();
  const id = useId();
  const [reason, setReason] = useState(() => (rows.every(keepsSuggestion) ? SUGGESTED_REASON : ''));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const one = rows.length === 1;

  async function submit(event) {
    event.preventDefault();
    if (reason.trim().length < 2) {
      setError('Add a reason.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const items = rows.map((row) => ({ attendanceId: row.id, checkOut: row.checkOut }));
      const { data } = await api.post('/api/attendance/missing-checkouts/fix', { items, reason });
      toast(toastFor(data));
      onDone(data);
    } catch (failure) {
      if (failure.fields?.reason) setError(failure.fields.reason);
      else toast({ title: "Couldn't fix the check-outs", body: failure.message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => (busy ? null : onClose())}
      width={520}
      title={one ? `Fix ${rows[0].user.name}'s check-out` : `Fix ${rows.length} check-outs`}
      description="Each one is saved with the time in its row. The person is told."
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {one ? 'Save' : `Fix ${rows.length} check-outs`}
          </Button>
        </>
      }
    >
      <ul className={styles.list}>
        {rows.map((row) => (
          <li key={row.id}>
            {row.user.name}, {row.dayLabel}: {formatClock(row.checkOut)}
            {keepsSuggestion(row) ? <span className={styles.muted}>, suggested</span> : null}
          </li>
        ))}
      </ul>
      <Field
        label="Reason"
        htmlFor={`${id}-reason`}
        error={error}
        help={error ? null : 'Saved with each change in the audit log.'}
      >
        <Textarea
          id={`${id}-reason`}
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          data-autofocus
        />
      </Field>
    </Dialog>
  );
}

/**
 * @param {{ rows: Array<{ id: number, user: { name: string }, dayLabel: string,
 *   checkOut: string, suggestedClock: string | null }> | null, onClose: () => void,
 *   onDone: (result: { fixed: object[], failed: object[] }) => void }} props rows = the
 *   selected rows with their times ('HH:mm'); null keeps the dialog closed
 */
export default function MissingFixDialog({ rows, onClose, onDone }) {
  if (!rows || rows.length === 0) return null;
  return (
    <FixForm
      key={rows.map((row) => row.id).join(',')}
      rows={rows}
      onClose={onClose}
      onDone={onDone}
    />
  );
}
