'use client';
// Mark leave and Edit leave (CONTRACT 25, item 9), shared by the Leave page, the Attendance row
// menu and the "Leave and holidays" card: the person, the first and last day (Last day follows
// First day until picked), the part of the day (halves only for one day), type, pay, an optional
// note only HR and Admins see, and when editing a reason and "Delete leave". A live preview counts
// the working days. Field errors show under their field; other errors are toasted.
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import LeaveDeleteDialog from './LeaveDeleteDialog';
import LeaveFields from './LeaveFields';
import {
  LEAVE_FIELDS,
  initialLeaveForm,
  leaveBody,
  partHelp,
  previewLines,
  previewQuery,
  withFromDate,
} from './leaveForm';
import styles from './LeaveDialog.module.css';
import { useLeaveContext, useLeavePreview } from './useLeavePreview';

/**
 * @param {{ open: boolean, onClose: () => void, entry?: object | null,
 *   person?: { id: number, name: string } | null, date?: string | null,
 *   people?: Array<{ id: number, name: string }> | null, today?: string | null }} props
 *   entry = a LeaveEntry to edit; person = preset from an Attendance row (with `date`, the row's
 *   day); people and today from the Leave page (the card leaves them out: the dialog asks
 *   GET /api/leave/people)
 */
export default function LeaveDialog({
  open,
  onClose,
  entry = null,
  person = null,
  date,
  people,
  today,
}) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const editing = Boolean(entry);
  const preset = editing ? entry.user : person;
  const context = useLeaveContext({ open, needed: !preset && !people });
  const startDay = date ?? today ?? context.today ?? '';
  const [form, setForm] = useState(() =>
    initialLeaveForm({ entry, userId: preset?.id, date: startDay }),
  );
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [seeded, setSeeded] = useState(Boolean(startDay));
  // Each opening starts fresh (the page refreshes every minute, so today can move on).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(initialLeaveForm({ entry, userId: preset?.id, date: startDay }));
      setErrors({});
      setDeleting(false);
      setSeeded(Boolean(startDay) || editing);
    }
  }
  // From the card, today arrives a moment after the dialog opens: both days start there.
  if (open && !seeded && startDay) {
    setSeeded(true);
    setForm((current) => (current.fromDate ? current : withFromDate(current, startDay)));
  }

  const choices = preset ? [preset] : (people ?? context.people ?? []);
  const personName = choices.find((item) => String(item.id) === form.userId)?.name ?? '';
  const query = open && !deleting ? previewQuery(form, { excludeId: entry?.id }) : null;
  const { status, preview, split } = useLeavePreview({ query, userId: form.userId });
  const { lines, blocked } = previewLines({ status, preview, form, personName });
  const help = partHelp(form, split);

  function close() {
    if (!busy) onClose();
  }

  function update(change) {
    setForm((current) => change(current));
  }

  function showErrors(error) {
    const fields = Object.fromEntries(
      Object.entries(error.fields ?? {}).filter(([key]) => LEAVE_FIELDS.has(key)),
    );
    setErrors(fields);
    if (Object.keys(fields).length === 0) {
      toast({ title: "Couldn't save the leave", body: error.message, tone: 'error' });
    }
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const body = leaveBody(form, { editing });
      const { data } = editing
        ? await api.patch(`/api/leave/${entry.id}`, body)
        : await api.post('/api/leave', body);
      toast({ title: 'Leave saved', body: `${data.user.name}, ${data.days}` });
      setBusy(false);
      onClose();
      router.refresh();
    } catch (error) {
      setBusy(false);
      showErrors(error);
    }
  }

  const footer = (
    <>
      {editing ? (
        <span className={styles.footStart}>
          <Button
            variant="text"
            size="compact"
            className={styles.danger}
            onClick={() => setDeleting(true)}
            disabled={busy}
          >
            Delete leave
          </Button>
        </span>
      ) : null}
      <Button variant="secondary" onClick={close} disabled={busy}>
        Cancel
      </Button>
      <Button type="submit" loading={busy} disabled={blocked}>
        {editing ? 'Save' : 'Mark leave'}
      </Button>
    </>
  );

  return (
    <>
      <Dialog
        open={open && !deleting}
        onClose={close}
        title={editing ? 'Edit leave' : 'Mark leave'}
        description={editing ? entry.user.name : undefined}
        width={520}
        onSubmit={submit}
        footer={footer}
      >
        <LeaveFields
          id={id}
          form={form}
          update={update}
          errors={errors}
          choices={choices}
          preset={Boolean(preset)}
          editing={editing}
          help={help}
          lines={lines}
        />
      </Dialog>
      {editing ? (
        <LeaveDeleteDialog
          open={open && deleting}
          entry={entry}
          onCancel={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            onClose();
          }}
        />
      ) : null}
    </>
  );
}
