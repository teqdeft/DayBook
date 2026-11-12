'use client';
// The inline add and edit row of the Phases tab (CONTRACT 22): title, owner, due date and priority,
// as in the prototype. Editing leaves the details alone and only sends what changed. In "No phase
// yet" the row also picks a phase, so a task from before phases can be filed. A saved row closes
// together with the page refresh, so the new task never blinks in late.
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import { api } from '@/lib/apiClient';
import { PROJECT_PHASES } from '@/modules/projectPlan/phases';
import { NO_PHASE_LABEL } from './phasesView';
import styles from './PhaseTasks.module.css';

const PRIORITY_OPTIONS = [
  { value: 'p1', label: 'P1 critical' },
  { value: 'p2', label: 'P2' },
  { value: 'p3', label: 'P3' },
];

const PHASE_OPTIONS = [
  { value: '', label: NO_PHASE_LABEL },
  ...PROJECT_PHASES.map(({ key, label }) => ({ value: key, label })),
];

const FIELDS = ['title', 'assigneeId', 'dueDate', 'priority', 'phase'];

/**
 * Who the task can be for, plus its current owner when they can't be picked any more (off the
 * project or deactivated): they can stay, but not be picked again once changed.
 */
export function ownerOptions(owners, task) {
  const options = [
    { value: '', label: 'Anyone on the project' },
    ...owners.map((owner) => ({ value: String(owner.id), label: owner.name })),
  ];
  const current = task?.assignee;
  if (current && !owners.some((owner) => owner.id === current.id)) {
    const why = current.away ? ` (${current.away.toLowerCase()})` : '';
    options.push({ value: String(current.id), label: `${current.name}${why}` });
  }
  return options;
}

/** The row's values as the API takes them. */
function valuesOf({ title, owner, dueDate, priority, phase }) {
  return {
    title,
    assigneeId: owner ? Number(owner) : null,
    dueDate: dueDate || null,
    priority,
    phase: phase || null,
  };
}

/** For an edit: only what changed. */
function changesOf(values, task) {
  const before = {
    title: task.title,
    assigneeId: task.assignee?.id ?? null,
    dueDate: task.dueDate,
    priority: task.priority,
    phase: task.phase,
  };
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== before[key]));
}

/** The API's error as the row shows it: the first field it names, or its message. */
function errorOf(failure) {
  const field = FIELDS.find((key) => failure.fields?.[key]);
  return { field: field ?? null, message: field ? failure.fields[field] : failure.message };
}

/** The request a saved row sends: everything for a new task, only what changed for an edit. */
function requestFor({ form, task, phase, choosePhase, projectId }) {
  const values = valuesOf(form);
  if (!choosePhase) values.phase = task ? task.phase : phase;
  if (!task) return { path: `/api/projects/${projectId}/tasks`, method: 'post', body: values };
  return { path: `/api/project-tasks/${task.id}`, method: 'patch', body: changesOf(values, task) };
}

/** The row's values, its error and saving. */
function useTaskRow({ projectId, phase, task, choosePhase, onClose }) {
  const router = useRouter();
  const titleRef = useRef(null);
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    title: task?.title ?? '',
    owner: task?.assignee ? String(task.assignee.id) : '',
    dueDate: task?.dueDate ?? '',
    priority: task?.priority ?? 'p2',
    phase: task ? (task.phase ?? '') : (phase ?? ''),
  });
  // field: the API's name for it, so its error clears once it changes
  const set =
    (key, field = key) =>
    (event) => {
      setForm({ ...form, [key]: event.target.value });
      if (error && (error.field === field || error.field === null)) setError(null);
    };

  function save(event) {
    event.preventDefault();
    if (saving) return;
    if (!form.title.trim()) {
      setError({ field: 'title', message: 'Add a task title.' });
      titleRef.current?.focus();
      return;
    }
    const { path, method, body } = requestFor({ form, task, phase, choosePhase, projectId });
    if (Object.keys(body).length === 0) return onClose(false);
    startSaving(async () => {
      try {
        await api[method](path, body);
        startSaving(() => {
          onClose(true);
          router.refresh();
        });
      } catch (failure) {
        setError(errorOf(failure));
      }
    });
  }

  return { form, set, error, saving, save, titleRef };
}

/** Title, owner, due date, priority and, in No phase yet, the phase. */
function RowFields({ row, owners, task, choosePhase }) {
  const { form, set, error, titleRef } = row;
  const field = (key, extra) => ({
    compact: true,
    className: `${styles.formField} ${extra}`,
    value: form[key === 'assigneeId' ? 'owner' : key],
    error: error?.field === key,
  });
  return (
    <>
      <Input
        {...field('title', styles.titleField)}
        ref={titleRef}
        aria-label="Task title"
        placeholder="Task title"
        maxLength={200}
        autoComplete="off"
        autoFocus
        onChange={set('title')}
      />
      <Select
        {...field('assigneeId', styles.ownerField)}
        aria-label="Owner"
        options={ownerOptions(owners, task)}
        onChange={set('owner', 'assigneeId')}
      />
      <Input
        {...field('dueDate', styles.dueField)}
        type="date"
        aria-label="Due date"
        onChange={set('dueDate')}
      />
      <Select
        {...field('priority', styles.priorityField)}
        aria-label="Priority"
        options={PRIORITY_OPTIONS}
        onChange={set('priority')}
      />
      {choosePhase ? (
        <Select
          {...field('phase', styles.ownerField)}
          aria-label="Phase"
          options={PHASE_OPTIONS}
          onChange={set('phase')}
        />
      ) : null}
    </>
  );
}

/**
 * @param {{ projectId: number, phase: string | null, task?: object | null,
 *   owners: Array<{ id: number, name: string }>, choosePhase?: boolean,
 *   onClose: (saved: boolean) => void }} props phase: the section's (null for No phase yet);
 *   task: the one being edited (a board row), none to add; choosePhase: also pick the phase
 */
export default function PhaseTaskForm(props) {
  const { task, owners, choosePhase, onClose } = props;
  const row = useTaskRow(props);
  return (
    <form
      className={styles.form}
      onSubmit={row.save}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose(false);
        }
      }}
    >
      <RowFields row={row} owners={owners} task={task} choosePhase={choosePhase} />
      <span className={styles.formButtons}>
        <Button type="submit" size="compact" className={styles.formButton} loading={row.saving}>
          {task ? 'Save' : 'Add'}
        </Button>
        <Button
          variant="secondary"
          size="compact"
          className={styles.formButton}
          onClick={() => onClose(false)}
        >
          Cancel
        </Button>
      </span>
      {row.error ? (
        <p className={styles.formError} role="alert">
          {row.error.message}
        </p>
      ) : null}
    </form>
  );
}
