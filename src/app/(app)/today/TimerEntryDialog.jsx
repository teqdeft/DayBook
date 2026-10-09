'use client';
// Add time / Edit time on Today's Working on card (CONTRACT 15): project, optional priority task,
// note and From / To clocks on today. POST or PATCH /api/timers/entries; the server's field
// errors (startClock, endClock, projectTaskId, ...) show under their fields. A running entry can
// change everything but its end.
import { useId, useState } from 'react';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Field from '@/components/Field';
import Input from '@/components/Input';
import Select from '@/components/Select';
import { findProject, taskOptions } from './timerData';
import styles from './TimerEntries.module.css';

const NOTE_MAX = 200;
const FIELDS = ['projectId', 'projectTaskId', 'note', 'startClock', 'endClock'];
const GROUPS = [
  ['urgent', 'Urgent'],
  ['mine', 'Your projects'],
  ['others', 'Other projects'],
];

function initialForm(entry, defaults) {
  if (!entry) {
    return {
      projectId: '',
      taskId: '',
      note: '',
      startClock: defaults?.startClock ?? '',
      endClock: defaults?.endClock ?? '',
    };
  }
  return {
    projectId: String(entry.projectId),
    taskId: entry.projectTaskId ? String(entry.projectTaskId) : '',
    note: entry.note ?? '',
    startClock: entry.startClock ?? '',
    endClock: entry.endClock ?? '',
  };
}

/** Errors the form can see before asking the server. */
function localErrors(form, running) {
  const errors = {};
  if (!form.projectId) errors.projectId = 'Pick a project.';
  if (!form.startClock) errors.startClock = 'Enter the start time, like 09:30.';
  if (!running && !form.endClock) errors.endClock = 'Enter the end time, like 10:15.';
  return errors;
}

/**
 * @param {{ entry: object | null, picker: object, tasks: Record<string, object[]>,
 *   defaults: { startClock: string, endClock: string } | null, onClose: () => void,
 *   onSave: (entry: object | null, body: object) => Promise<object | null> }} props
 *   entry null = Add time; onSave throws an ApiError with `fields` for field errors
 */
export default function TimerEntryDialog({ entry, picker, tasks, defaults, onClose, onSave }) {
  const id = useId();
  const running = Boolean(entry && !entry.endedAt);
  const [form, setForm] = useState(() => initialForm(entry, defaults));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  // The entry's project stays selectable even when it is no longer in the picker.
  const missing = entry && !findProject(picker, entry.projectId);
  const sameProject = entry && String(entry.projectId) === form.projectId;
  const options = form.projectId
    ? taskOptions(tasks[form.projectId], sameProject ? entry : null)
    : [];

  function close() {
    if (!busy) onClose();
  }

  async function submit(event) {
    event.preventDefault();
    const local = localErrors(form, running);
    if (Object.keys(local).length > 0) {
      setErrors(local);
      return;
    }
    const body = {
      projectId: Number(form.projectId),
      projectTaskId: form.taskId ? Number(form.taskId) : null,
      note: form.note.trim(),
      startClock: form.startClock,
      ...(running ? {} : { endClock: form.endClock }),
    };
    setErrors({});
    setBusy(true);
    try {
      const saved = await onSave(entry, body);
      setBusy(false);
      if (saved) onClose();
    } catch (error) {
      setBusy(false);
      const fields = error.fields ?? {};
      const other = Object.keys(fields).find((key) => !FIELDS.includes(key));
      setErrors({ ...fields, _: other ? fields[other] : null });
    }
  }

  return (
    <Dialog
      open
      onClose={close}
      title={entry ? 'Edit time' : 'Add time'}
      description={
        running
          ? 'This timer is still running: you can change its start, not its end.'
          : entry
            ? null
            : 'Time you worked on a project today without a timer.'
      }
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {entry ? 'Save' : 'Add time'}
          </Button>
        </>
      }
    >
      <div className={styles.fields}>
        <Field label="Project" htmlFor={`${id}-project`} error={errors.projectId}>
          <Select
            id={`${id}-project`}
            value={form.projectId}
            error={Boolean(errors.projectId)}
            onChange={(event) =>
              setForm((current) => ({ ...current, projectId: event.target.value, taskId: '' }))
            }
            required
          >
            <option value="" disabled>
              Pick a project
            </option>
            {missing ? <option value={String(entry.projectId)}>{entry.projectName}</option> : null}
            {GROUPS.map(([key, label]) =>
              picker[key]?.length ? (
                <optgroup key={key} label={label}>
                  {picker[key].map((project) => (
                    <option key={project.id} value={String(project.id)}>
                      {project.name}
                    </option>
                  ))}
                </optgroup>
              ) : null,
            )}
          </Select>
        </Field>
        {options.length > 0 ? (
          <Field label="Priority task" htmlFor={`${id}-task`} error={errors.projectTaskId}>
            <Select
              id={`${id}-task`}
              options={options}
              value={form.taskId}
              error={Boolean(errors.projectTaskId)}
              onChange={set('taskId')}
            />
          </Field>
        ) : null}
        <Field label="Note" htmlFor={`${id}-note`} error={errors.note}>
          <Input
            id={`${id}-note`}
            maxLength={NOTE_MAX}
            autoComplete="off"
            placeholder="What did you work on?"
            value={form.note}
            error={Boolean(errors.note)}
            onChange={set('note')}
          />
        </Field>
        <div className={styles.times}>
          <Field label="From" htmlFor={`${id}-from`} error={errors.startClock}>
            <Input
              id={`${id}-from`}
              type="time"
              value={form.startClock}
              error={Boolean(errors.startClock)}
              onChange={set('startClock')}
              required
            />
          </Field>
          <Field
            label="To"
            htmlFor={`${id}-to`}
            error={errors.endClock}
            help={running ? 'Still running' : null}
          >
            <Input
              id={`${id}-to`}
              type="time"
              value={running ? '' : form.endClock}
              error={Boolean(errors.endClock)}
              onChange={set('endClock')}
              disabled={running}
              required={!running}
            />
          </Field>
        </div>
        {errors._ ? (
          <p className={styles.formError} role="alert">
            {errors._}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
