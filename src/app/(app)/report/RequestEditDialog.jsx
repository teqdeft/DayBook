'use client';
// "Request an edit" for a locked report (or a missing day after its lock): the day and a reason.
// Used on the Daily report (the day is fixed) and on My log (pick one of the locked days).
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Field from '@/components/Field';
import Select from '@/components/Select';
import Textarea from '@/components/Textarea';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { formatDayShort } from '@/lib/time';
import styles from './RequestEditDialog.module.css';

const REASON_MAX = 500;

/**
 * @param {{ open: boolean, onClose: () => void, fixedDate?: string, dates?: string[],
 *   defaultDate?: string }} props `dates` are 'YYYY-MM-DD' days that can be picked (My log)
 */
export default function RequestEditDialog({ open, onClose, fixedDate, dates = [], defaultDate }) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const [workDate, setWorkDate] = useState(fixedDate ?? defaultDate ?? dates[0] ?? '');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);
  // The list can change after a refresh (a day got a request); fall back to the first one left.
  const picked = dates.includes(workDate) ? workDate : (dates[0] ?? '');
  const day = fixedDate ?? picked;

  function close() {
    if (sending) return;
    setErrors({});
    onClose();
  }

  async function send(event) {
    event.preventDefault();
    const text = reason.trim();
    const problems = {};
    if (!day) problems.workDate = 'Pick the day of the report.';
    if (text.length < 2) problems.reason = 'Say what needs to change.';
    if (Object.keys(problems).length) {
      setErrors(problems);
      return;
    }
    setSending(true);
    try {
      await api.post('/api/report-edit-requests', { workDate: day, reason: text });
      toast({
        title: 'Edit request sent',
        body: `You'll get a notification when the report for ${formatDayShort(day)} opens.`,
      });
      setReason('');
      setErrors({});
      setSending(false);
      onClose();
      router.refresh();
    } catch (error) {
      setSending(false);
      // Field errors go under their field; with a fixed day there is no day field, so a problem
      // with the day shows under the form instead.
      const fields = error?.fields ?? {};
      const next = {};
      if (fields.reason) next.reason = fields.reason;
      if (fields.workDate) next[fixedDate ? 'form' : 'workDate'] = fields.workDate;
      if (Object.keys(next).length === 0) {
        next.form = error?.message ?? 'The request was not sent. Please try again.';
      }
      setErrors(next);
    }
  }

  const footer = (
    <>
      <Button variant="secondary" onClick={close} disabled={sending}>
        Cancel
      </Button>
      <Button type="submit" loading={sending}>
        Send request
      </Button>
    </>
  );

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Request an edit"
      description="Reports lock after their day. Your project manager (or an Admin) can open it again for 24 hours."
      footer={footer}
      onSubmit={send}
    >
      <div className={styles.fields}>
        {fixedDate ? (
          <p className={styles.day}>
            Report for <strong>{formatDayShort(fixedDate)}</strong>
          </p>
        ) : (
          <Field label="Report" htmlFor={`${id}-day`} error={errors.workDate}>
            <Select
              id={`${id}-day`}
              value={picked}
              onChange={(event) => {
                setWorkDate(event.target.value);
                setErrors((current) => ({ ...current, workDate: undefined, form: undefined }));
              }}
              options={
                dates.length
                  ? dates.map((value) => ({ value, label: formatDayShort(value) }))
                  : [{ value: '', label: 'No locked reports this month' }]
              }
              disabled={dates.length === 0}
            />
          </Field>
        )}
        <Field
          label="What needs to change?"
          htmlFor={`${id}-reason`}
          error={errors.reason}
          help={errors.reason ? undefined : 'For example: Hours for acme-store were 3, not 2.'}
        >
          <Textarea
            id={`${id}-reason`}
            value={reason}
            maxLength={REASON_MAX}
            rows={3}
            data-autofocus
            onChange={(event) => {
              setReason(event.target.value);
              setErrors((current) => ({ ...current, reason: undefined, form: undefined }));
            }}
          />
        </Field>
        {errors.form ? (
          <p className={styles.formError} role="alert">
            {errors.form}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
