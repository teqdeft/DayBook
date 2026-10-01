'use client';
// Asks HR to fix attendance (guide 7.2.7 and 7.8): "I came earlier" for today's check-in, or a
// correction for any day up to today: a forgotten check-out, a wrong check-in time or a whole
// missing day. Errors show under the field that caused them.
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Field from '@/components/Field';
import Input from '@/components/Input';
import Select from '@/components/Select';
import Textarea from '@/components/Textarea';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import styles from './CorrectionDialog.module.css';

const TYPES = [
  { value: 'check_out', label: 'I forgot to check out' },
  { value: 'check_in', label: 'My check-in time is wrong' },
  { value: 'missing_day', label: 'I missed a whole day' },
];

const PLACES = [
  { value: 'office', label: 'Office' },
  { value: 'wfh', label: 'Working from home' },
];

function initialForm({ earlier, today, yesterday }) {
  return {
    type: earlier ? 'check_in' : 'check_out',
    workDate: earlier ? today : yesterday,
    checkIn: '',
    checkOut: '',
    location: 'office',
    reason: '',
  };
}

/**
 * @param {{ open: boolean, onClose: () => void, earlier?: boolean, today: string,
 *   yesterday: string, checkInClock?: string | null }} props
 *   earlier: the "I came earlier" version (today's check-in time only)
 */
export default function CorrectionDialog({
  open,
  onClose,
  earlier = false,
  today,
  yesterday,
  checkInClock,
}) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const [form, setForm] = useState(() => initialForm({ earlier, today, yesterday }));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  function reset() {
    setForm(initialForm({ earlier, today, yesterday }));
    setErrors({});
  }

  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  /** Errors for fields this form doesn't show go to the line under the form. */
  function showErrors(error) {
    const fields = error.fields ?? {};
    const visible = new Set(['reason']);
    if (!earlier) ['type', 'workDate'].forEach((key) => visible.add(key));
    if (form.type !== 'check_out') visible.add('checkIn');
    if (form.type !== 'check_in') visible.add('checkOut');
    if (form.type === 'missing_day') visible.add('location');
    const hidden = Object.entries(fields).find(([key]) => !visible.has(key));
    const general = hidden?.[1] ?? (Object.keys(fields).length ? null : error.message);
    setErrors({ ...fields, _: general });
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    const body = { type: form.type, workDate: form.workDate, reason: form.reason };
    if (form.type !== 'check_out') body.checkIn = form.checkIn || undefined;
    if (form.type !== 'check_in') body.checkOut = form.checkOut || undefined;
    if (form.type === 'missing_day') body.location = form.location;
    try {
      await api.post('/api/attendance-corrections', body);
      toast({ title: 'Sent to HR', body: "You'll get a notification when they decide." });
      setBusy(false);
      reset();
      onClose();
      router.refresh();
    } catch (error) {
      setBusy(false);
      showErrors(error);
    }
  }

  const showIn = form.type !== 'check_out';
  const showOut = form.type !== 'check_in';
  return (
    <Dialog
      open={open}
      onClose={close}
      title={earlier ? 'I came earlier' : 'Request a correction'}
      description={
        earlier
          ? `You checked in at ${checkInClock}. Tell HR when you really arrived and they'll fix it.`
          : 'HR checks it and fixes your attendance. You hear back either way.'
      }
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Send to HR
          </Button>
        </>
      }
    >
      <div className={styles.fields}>
        {earlier ? null : (
          <div className={styles.row}>
            <Field label="What needs fixing?" htmlFor={`${id}-type`} error={errors.type}>
              <Select id={`${id}-type`} options={TYPES} value={form.type} onChange={set('type')} />
            </Field>
            <Field label="Day" htmlFor={`${id}-date`} error={errors.workDate}>
              <Input
                id={`${id}-date`}
                type="date"
                max={today}
                value={form.workDate}
                onChange={set('workDate')}
                required
              />
            </Field>
          </div>
        )}
        <div className={styles.row}>
          {showIn ? (
            <Field label="Arrived at" htmlFor={`${id}-in`} error={errors.checkIn}>
              <Input
                id={`${id}-in`}
                type="time"
                value={form.checkIn}
                onChange={set('checkIn')}
                required
                data-autofocus={earlier ? true : undefined}
              />
            </Field>
          ) : null}
          {showOut ? (
            <Field label="Left at" htmlFor={`${id}-out`} error={errors.checkOut}>
              <Input
                id={`${id}-out`}
                type="time"
                value={form.checkOut}
                onChange={set('checkOut')}
                required
              />
            </Field>
          ) : null}
          {form.type === 'missing_day' ? (
            <Field label="Where" htmlFor={`${id}-where`} error={errors.location}>
              <Select
                id={`${id}-where`}
                options={PLACES}
                value={form.location}
                onChange={set('location')}
              />
            </Field>
          ) : null}
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
            maxLength={500}
            value={form.reason}
            onChange={set('reason')}
            placeholder={
              earlier
                ? 'For example: the app was down when I arrived'
                : 'For example: forgot to check out, left at 6:40 PM'
            }
            required
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
