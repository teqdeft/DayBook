'use client';
// "Edit dates" on the Phases tab (CONTRACT 22): a phase's planned start and end, side by side as in
// the prototype. Either may be left empty. An end before the start is caught here and by the server
// with the same words; success toasts "Dates saved." and refreshes the page.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Input from '@/components/Input';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { END_BEFORE_START } from '@/modules/projectPlan/schemas';
import styles from './PhaseSection.module.css';

/** The two dates, the error and saving them. */
function useDates({ projectId, phase, onClose }) {
  const router = useRouter();
  const toast = useToast();
  const [dates, setDates] = useState({
    start: phase.plannedStart ?? '',
    end: phase.plannedEnd ?? '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const change = (key) => (event) => {
    setDates({ ...dates, [key]: event.target.value });
    setError('');
  };

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    const { start, end } = dates;
    if (start && end && end < start) {
      setError(END_BEFORE_START);
      return;
    }
    setSaving(true);
    try {
      await api.put(`/api/projects/${projectId}/phases/${phase.key}/dates`, {
        plannedStart: start || null,
        plannedEnd: end || null,
      });
      onClose();
      toast({ title: 'Dates saved.' });
      router.refresh();
    } catch (failure) {
      setError(failure.fields?.plannedEnd ?? failure.fields?.plannedStart ?? failure.message);
    } finally {
      setSaving(false);
    }
  }

  return { dates, change, error, saving, save };
}

function DateField({ id, label, ...rest }) {
  return (
    <div className={styles.dateField}>
      <label className={styles.dateLabel} htmlFor={id}>
        {label}
      </label>
      <Input id={id} type="date" {...rest} />
    </div>
  );
}

function DatesForm({ projectId, phase, onClose }) {
  const { dates, change, error, saving, save } = useDates({ projectId, phase, onClose });
  const errorId = `phase-dates-${phase.key}-error`;
  const invalid = { error: Boolean(error), 'aria-describedby': error ? errorId : undefined };
  return (
    <Dialog
      open
      onClose={onClose}
      title={phase.label}
      onSubmit={save}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <div className={styles.datesRow}>
        <DateField
          id="phase-dates-start"
          label="Start"
          value={dates.start}
          onChange={change('start')}
          data-autofocus=""
          {...invalid}
        />
        <DateField
          id="phase-dates-end"
          label="End"
          value={dates.end}
          onChange={change('end')}
          {...invalid}
        />
      </div>
      {error ? (
        <p id={errorId} className={styles.dateError} role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

/**
 * @param {{ projectId: number, phase: { key: string, label: string, plannedStart: string | null,
 *   plannedEnd: string | null } | null, onClose: () => void }} props phase: the plan's row, or
 *   null when the dialog is closed
 */
export default function PhaseDatesDialog({ projectId, phase, onClose }) {
  if (!phase) return null;
  return <DatesForm key={phase.key} projectId={projectId} phase={phase} onClose={onClose} />;
}
