'use client';
// Add holiday and Edit holiday (CONTRACT 25, item 6): the date (empty to start, from 1 January of
// last year to 31 December of next year) and the name, with a live line when the date is today or
// has passed (late marks of that day are removed and the Admins told). Add also has "Save and add
// another": it saves, clears both fields and puts the focus back on Date. Field errors show under
// their field; anything else is toasted. Also the top bar's "Add holiday" button.
import { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Field from '@/components/Field';
import Input from '@/components/Input';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { formatDayShort } from '@/lib/time';
import styles from './page.module.css';

const FIELDS = new Set(['date', 'name']);

/** The live line under Date: today or a past day changes late marks and tells the Admins. */
export function dateLine(date, today) {
  if (!date || !today || date > today) return null;
  return date === today
    ? 'This is today. Late marks of anyone who checked in today are removed, and Admins are told.'
    : 'This day has passed. Late marks of anyone who checked in that day are removed, and Admins are told.';
}

/**
 * @param {{ open: boolean, onClose: () => void, holiday?: { id: number, date: string,
 *   name: string } | null, today: string, firstYear: number, lastYear: number }} props holiday =
 *   the one to edit (none: Add)
 */
export default function HolidayDialog({
  open,
  onClose,
  holiday = null,
  today,
  firstYear,
  lastYear,
}) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const dateRef = useRef(null);
  const editing = Boolean(holiday);
  const [form, setForm] = useState({ date: '', name: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm({ date: holiday?.date ?? '', name: holiday?.name ?? '' });
      setErrors({});
    }
  }

  function close() {
    if (!busy) onClose();
  }

  function showErrors(error) {
    const fields = Object.fromEntries(
      Object.entries(error.fields ?? {}).filter(([key]) => FIELDS.has(key)),
    );
    setErrors(fields);
    if (Object.keys(fields).length === 0) {
      toast({ title: "Couldn't save the holiday", body: error.message, tone: 'error' });
    }
  }

  async function save(another) {
    setBusy(another ? 'another' : 'save');
    setErrors({});
    try {
      const body = { date: form.date, name: form.name };
      const { data } = editing
        ? await api.patch(`/api/holidays/${holiday.id}`, body)
        : await api.post('/api/holidays', body);
      toast({
        title: editing ? 'Holiday saved' : 'Holiday added',
        body: `${data.name}, ${formatDayShort(data.date)}`,
      });
      setBusy(null);
      router.refresh();
      if (another) {
        setForm({ date: '', name: '' });
        dateRef.current?.focus();
      } else {
        onClose();
      }
    } catch (error) {
      setBusy(null);
      showErrors(error);
    }
  }

  const line = dateLine(form.date, today);
  return (
    <Dialog
      open={open}
      onClose={close}
      title={editing ? 'Edit holiday' : 'Add holiday'}
      width={480}
      onSubmit={(event) => {
        event.preventDefault();
        save(false);
      }}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={Boolean(busy)}>
            Cancel
          </Button>
          {editing ? null : (
            <Button
              variant="secondary"
              onClick={() => save(true)}
              loading={busy === 'another'}
              disabled={busy === 'save'}
            >
              Save and add another
            </Button>
          )}
          <Button type="submit" loading={busy === 'save'} disabled={busy === 'another'}>
            {editing ? 'Save' : 'Add holiday'}
          </Button>
        </>
      }
    >
      <div className={styles.fields}>
        <div className={styles.dateField}>
          <Field label="Date" htmlFor={`${id}-date`} error={errors.date}>
            <Input
              id={`${id}-date`}
              ref={dateRef}
              type="date"
              min={`${firstYear}-01-01`}
              max={`${lastYear}-12-31`}
              value={form.date}
              required
              onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
            />
          </Field>
          <p className={styles.liveLine} aria-live="polite">
            {line}
          </p>
        </div>
        <Field
          label="Name"
          htmlFor={`${id}-name`}
          error={errors.name}
          help={errors.name ? null : "Shown on Attendance and on everyone's Today."}
        >
          <Input
            id={`${id}-name`}
            value={form.name}
            maxLength={80}
            placeholder="Diwali"
            required
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/**
 * The top bar's "Add holiday" (primary, Plus), HR and Admins only.
 * @param {{ today: string, firstYear: number, lastYear: number }} props
 */
export function AddHolidayButton(props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon={<Plus size={18} strokeWidth={1.8} />} onClick={() => setOpen(true)}>
        Add holiday
      </Button>
      <HolidayDialog {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
