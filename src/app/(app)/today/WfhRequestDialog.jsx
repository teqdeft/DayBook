'use client';
// Asks HR to work from home on a day or a few days (CONTRACT 17): From and To (To follows From
// until the person picks their own), a reason, Send request. The server checks the days (today or
// later, To not before From, 14 days at most) and the reason; its errors show under the field
// that caused them.
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Field from '@/components/Field';
import Input from '@/components/Input';
import Textarea from '@/components/Textarea';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { MAX_WFH_DAYS, followFrom, lastToDate } from './wfhOptions';
import styles from './WfhRequestDialog.module.css';

const REASON_MAX = 500;
const FIELDS = new Set(['fromDate', 'toDate', 'reason']);

function initialForm(fromDate) {
  return { fromDate, toDate: fromDate, toTouched: false, reason: '' };
}

/**
 * @param {{ open: boolean, onClose: () => void, today: string, fromDate: string,
 *   onSent?: () => void }} props today: the earliest day that can be asked for; fromDate: the
 *   From the dialog opens with (today from the check-in card, the next working day from "another
 *   day"); onSent: after the request is sent, in place of the dialog's own page refresh (the
 *   caller refreshes, and can put the focus back once the page has changed)
 */
export default function WfhRequestDialog({ open, onClose, today, fromDate, onSent }) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const [form, setForm] = useState(() => initialForm(fromDate));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  // Each opening starts fresh from the From it is given (the page refreshes every minute, so
  // today can move on while the dialog is closed).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(initialForm(fromDate));
      setErrors({});
    }
  }

  function close() {
    if (!busy) onClose();
  }

  function setFrom(event) {
    const value = event.target.value;
    setForm((current) => ({ ...current, fromDate: value, toDate: followFrom(current, value) }));
  }

  function setTo(event) {
    const value = event.target.value;
    setForm((current) => ({ ...current, toDate: value, toTouched: true }));
  }

  /** Errors for the three fields go under them; anything else goes to the line under the form. */
  function showErrors(error) {
    const fields = Object.fromEntries(
      Object.entries(error.fields ?? {}).filter(([key]) => FIELDS.has(key)),
    );
    const general = Object.keys(fields).length ? null : error.message;
    setErrors({ ...fields, _: general });
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api.post('/api/wfh-requests', {
        fromDate: form.fromDate,
        toDate: form.toDate || form.fromDate,
        reason: form.reason,
      });
      toast({ title: 'Request sent to HR', body: "You'll get a notification when they decide." });
      setBusy(false);
      onClose();
      if (onSent) onSent();
      else router.refresh();
    } catch (error) {
      setBusy(false);
      showErrors(error);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Ask to work from home"
      description="HR approves or declines it, and you get a notification either way."
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Send request
          </Button>
        </>
      }
    >
      <div className={styles.fields}>
        <div className={styles.row}>
          <Field label="From" htmlFor={`${id}-from`} error={errors.fromDate}>
            <Input
              id={`${id}-from`}
              type="date"
              min={today}
              value={form.fromDate}
              onChange={setFrom}
              required
            />
          </Field>
          <Field
            label="To"
            htmlFor={`${id}-to`}
            error={errors.toDate}
            help={errors.toDate ? null : `Up to ${MAX_WFH_DAYS} days`}
          >
            <Input
              id={`${id}-to`}
              type="date"
              min={form.fromDate || today}
              max={lastToDate(form.fromDate) || undefined}
              value={form.toDate}
              onChange={setTo}
              required
            />
          </Field>
        </div>
        <Field
          label="Reason"
          htmlFor={`${id}-reason`}
          error={errors.reason}
          help={errors.reason ? null : 'HR sees this with your request.'}
        >
          <Textarea
            id={`${id}-reason`}
            rows={3}
            maxLength={REASON_MAX}
            value={form.reason}
            onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
            placeholder="For example: waiting in for a repair at home"
            required
            data-autofocus
          />
        </Field>
        {errors._ ? (
          <p className={styles.formError} role="alert">
            {errors._}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
