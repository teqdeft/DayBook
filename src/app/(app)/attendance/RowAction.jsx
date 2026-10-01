'use client';
// HR's row actions on Attendance: Edit (and Fix for a missing check-out), Confirm an unverified
// office check-in, and Add a row for someone who forgot. Every change asks for a reason, which is
// saved in the audit log. Errors show under the field that caused them.
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
import styles from './RowAction.module.css';

const PLACES = [
  { value: 'office', label: 'Office' },
  { value: 'wfh', label: 'Working from home' },
];

const COPY = {
  edit: { button: 'Edit', title: 'Edit attendance', submit: 'Save', done: 'Attendance saved' },
  fix: { button: 'Fix', title: 'Fix missing check-out', submit: 'Save', done: 'Check-out saved' },
  confirm: {
    button: 'Confirm',
    title: 'Confirm office check-in',
    submit: 'Confirm',
    done: 'Office check-in confirmed',
  },
  add: { button: 'Add', title: 'Add attendance', submit: 'Add', done: 'Attendance added' },
};

function startForm(row) {
  return {
    checkIn: row.checkIn ?? '',
    checkOut: row.checkOut ?? '',
    location: row.location ?? 'office',
    reason: '',
  };
}

/** What to send: only the fields that changed (edit) or the whole row (add). */
function requestFor(kind, row, form) {
  if (kind === 'confirm') {
    return ['post', `/api/attendance/${row.attendanceId}/confirm-office`, { reason: form.reason }];
  }
  if (kind === 'add') {
    return [
      'post',
      '/api/attendance',
      {
        userId: row.userId,
        workDate: row.workDate,
        checkIn: form.checkIn || undefined,
        checkOut: form.checkOut || null,
        location: form.location,
        reason: form.reason,
      },
    ];
  }
  const body = { reason: form.reason };
  if (form.checkIn && form.checkIn !== row.checkIn) body.checkIn = form.checkIn;
  if (form.checkOut && form.checkOut !== row.checkOut) body.checkOut = form.checkOut;
  if (form.location !== row.location) body.location = form.location;
  return ['patch', `/api/attendance/${row.attendanceId}`, body];
}

/**
 * @param {{ kind: 'edit' | 'fix' | 'confirm' | 'add', row: { attendanceId?: number,
 *   userId: number, name: string, workDate: string, dayLabel: string, checkIn?: string | null,
 *   checkOut?: string | null, location?: 'office' | 'wfh', note?: string | null,
 *   checkInText?: string | null, isToday: boolean } }} props clocks are 'HH:mm' company time
 */
export default function RowAction({ kind, row }) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const copy = COPY[kind];
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => startForm(row));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  function show() {
    setForm(startForm(row));
    setErrors({});
    setOpen(true);
  }

  /** Edit and Fix need a change; say where before asking the server. */
  function missingChange(body) {
    if (kind !== 'edit' && kind !== 'fix') return null;
    if (body.checkIn || body.checkOut || body.location) return null;
    const found =
      kind === 'fix'
        ? { checkOut: 'Enter the time they left.' }
        : { _: 'Change the check-in, the check-out or the place.' };
    return form.reason.trim() ? found : { ...found, reason: 'Add a reason.' };
  }

  async function submit(event) {
    event.preventDefault();
    const [method, path, body] = requestFor(kind, row, form);
    const problem = missingChange(body);
    if (problem) {
      setErrors(problem);
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await api[method](path, body);
      setOpen(false);
      toast({ title: copy.done, body: `${row.name}, ${row.dayLabel}` });
      router.refresh();
    } catch (error) {
      const fields = error.fields ?? {};
      const known = ['checkIn', 'checkOut', 'location', 'reason'];
      const other = Object.entries(fields).find(([key]) => !known.includes(key));
      setErrors({
        ...fields,
        _: other?.[1] ?? (Object.keys(fields).length ? null : error.message),
      });
    } finally {
      setBusy(false);
    }
  }

  const times = kind !== 'confirm';
  const description =
    kind === 'confirm'
      ? `${row.name} checked in at the office at ${row.checkInText} without the office network.`
      : `${row.name}, ${row.dayLabel}`;
  return (
    <>
      <Button
        variant={kind === 'fix' ? 'secondary' : 'text'}
        size={kind === 'fix' ? 'small' : 'default'}
        onClick={show}
        className={kind === 'fix' ? styles.fix : styles.action}
        aria-label={`${copy.button}: ${row.name}, ${row.dayLabel}`}
      >
        {copy.button}
      </Button>
      <Dialog
        open={open}
        onClose={() => (busy ? null : setOpen(false))}
        title={copy.title}
        description={description}
        onSubmit={submit}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              {copy.submit}
            </Button>
          </>
        }
      >
        <div className={styles.fields}>
          {kind === 'confirm' && row.note ? (
            <p className={styles.note}>
              <span className={styles.noteLabel}>Their note</span>
              {row.note}
            </p>
          ) : null}
          {times ? (
            <div className={styles.row}>
              <Field label="Check-in" htmlFor={`${id}-in`} error={errors.checkIn}>
                <Input
                  id={`${id}-in`}
                  type="time"
                  value={form.checkIn}
                  onChange={set('checkIn')}
                  required={kind === 'add'}
                />
              </Field>
              <Field
                label={kind === 'add' && row.isToday ? 'Check-out (optional)' : 'Check-out'}
                htmlFor={`${id}-out`}
                error={errors.checkOut}
              >
                <Input
                  id={`${id}-out`}
                  type="time"
                  value={form.checkOut}
                  onChange={set('checkOut')}
                  data-autofocus={kind === 'fix' ? true : undefined}
                />
              </Field>
              <Field label="Where" htmlFor={`${id}-where`} error={errors.location}>
                <Select
                  id={`${id}-where`}
                  options={PLACES}
                  value={form.location}
                  onChange={set('location')}
                />
              </Field>
            </div>
          ) : null}
          <Field
            label="Reason"
            htmlFor={`${id}-reason`}
            error={errors.reason}
            help={errors.reason ? null : 'Saved with the change in the audit log.'}
          >
            <Textarea
              id={`${id}-reason`}
              rows={3}
              maxLength={500}
              value={form.reason}
              onChange={set('reason')}
              placeholder="For example: confirmed with their PM"
              required
              data-autofocus={kind === 'confirm' ? true : undefined}
            />
          </Field>
          {errors._ ? (
            <p className={styles.formError} role="alert">
              {errors._}
            </p>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
