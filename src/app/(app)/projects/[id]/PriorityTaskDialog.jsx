'use client';
// The Add / Edit priority task dialog (title, details, P1-P3, who it is for) and the Delete
// confirmation. Errors show under their fields; success toasts and refreshes the page.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Field from '@/components/Field';
import Input from '@/components/Input';
import PriorityTag, { PRIORITY_LABELS } from '@/components/PriorityTag';
import Segmented from '@/components/Segmented';
import Select from '@/components/Select';
import Textarea from '@/components/Textarea';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import styles from './PriorityTasksCard.module.css';

const PRIORITY_ITEMS = ['p1', 'p2', 'p3'].map((value) => ({
  value,
  label: PRIORITY_LABELS[value],
}));

const PRIORITY_HELP = {
  p1: 'P1 is the most important: do it first.',
  p2: 'P2 comes after the P1 tasks.',
  p3: 'P3 is for when the rest is done.',
};

const ANYONE = '';

/** Runs a request: saving state, field errors, a toast and a page refresh on success. */
function useSave(onClose) {
  const router = useRouter();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');

  async function run(request, success) {
    if (saving) return;
    setSaving(true);
    setErrors({});
    setFormError('');
    try {
      await request();
      toast(success);
      onClose();
      router.refresh();
    } catch (error) {
      const fields = error.fields ?? {};
      setErrors(fields);
      const known = ['title', 'details', 'priority', 'assigneeId'];
      if (!Object.keys(fields).some((key) => known.includes(key))) setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  return { saving, errors, formError, run };
}

function FormError({ message }) {
  return message ? (
    <p className={styles.formError} role="alert">
      {message}
    </p>
  ) : null;
}

/**
 * Members to pick from, plus the current assignee when they aren't in that list (removed from the
 * team or deactivated: they can stay, but can't be picked again once changed).
 */
function assigneeOptions(members, task) {
  const options = [
    { value: ANYONE, label: 'Anyone on the project' },
    ...members.map((member) => ({ value: String(member.id), label: member.name })),
  ];
  const current = task?.assignee;
  if (current && !members.some((member) => member.id === current.id)) {
    const why = current.away ? ` (${current.away.toLowerCase()})` : '';
    options.push({ value: String(current.id), label: `${current.name}${why}` });
  }
  return options;
}

/**
 * Add (no `task`) or edit a priority task.
 * @param {{ project: { id, name }, task?: object, members: Array<{ id, name }>,
 *   onClose: () => void }} props
 */
export function PriorityTaskDialog({ project, task, members, onClose }) {
  const editing = Boolean(task);
  const [title, setTitle] = useState(task?.title ?? '');
  const [details, setDetails] = useState(task?.details ?? '');
  const [priority, setPriority] = useState(task?.priority ?? 'p2');
  const [assigneeId, setAssigneeId] = useState(task?.assignee ? String(task.assignee.id) : ANYONE);
  const { saving, errors, formError, run } = useSave(onClose);

  function submit(event) {
    event.preventDefault();
    const body = {
      title,
      details: details.trim() ? details : null,
      priority,
      assigneeId: assigneeId === ANYONE ? null : Number(assigneeId),
    };
    const label = `${PRIORITY_LABELS[priority]} · ${title.trim()}`;
    if (editing) {
      run(() => api.patch(`/api/project-tasks/${task.id}`, body), {
        title: 'Priority task saved',
        body: label,
      });
    } else {
      run(() => api.post(`/api/projects/${project.id}/tasks`, body), {
        title: 'Priority task added',
        body: assigneeId === ANYONE ? `${label}. Everyone on the project sees it.` : label,
      });
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      width={520}
      title={editing ? 'Edit priority task' : 'Add priority task'}
      description={
        editing
          ? `On ${project.name}.`
          : `On ${project.name}. The person it is for sees it on Today and gets a notification.`
      }
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {editing ? 'Save changes' : 'Add task'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <Field label="Task" htmlFor="priority-task-title" error={errors.title}>
          <Input
            id="priority-task-title"
            value={title}
            maxLength={200}
            autoComplete="off"
            placeholder="For example: Fix login timeout"
            error={Boolean(errors.title)}
            onChange={(event) => setTitle(event.target.value)}
            data-autofocus
          />
        </Field>
        <Field
          label="Details"
          htmlFor="priority-task-details"
          help="Optional. Up to 1000 characters."
          error={errors.details}
        >
          <Textarea
            id="priority-task-details"
            rows={3}
            value={details}
            maxLength={1000}
            placeholder="What done looks like, links, deadlines"
            error={Boolean(errors.details)}
            onChange={(event) => setDetails(event.target.value)}
          />
        </Field>
        <div className={styles.group} role="group" aria-labelledby="priority-task-priority">
          <p id="priority-task-priority" className={styles.groupLabel}>
            Priority
          </p>
          <Segmented
            label="Priority"
            items={PRIORITY_ITEMS}
            value={priority}
            onChange={setPriority}
            className={styles.segmented}
          />
          <p className={styles.groupHelp}>{PRIORITY_HELP[priority]}</p>
          {errors.priority ? (
            <p className={styles.fieldError} role="alert">
              {errors.priority}
            </p>
          ) : null}
        </div>
        <Field
          label="For"
          htmlFor="priority-task-assignee"
          help="People on the project who write daily reports."
          error={errors.assigneeId}
        >
          <Select
            id="priority-task-assignee"
            value={assigneeId}
            error={Boolean(errors.assigneeId)}
            options={assigneeOptions(members, task)}
            onChange={(event) => setAssigneeId(event.target.value)}
          />
        </Field>
        <FormError message={formError} />
      </div>
    </Dialog>
  );
}

/** Asks before deleting a task. */
export function DeletePriorityTaskDialog({ task, onClose }) {
  const { saving, formError, run } = useSave(onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Delete this priority task?"
      description="It is removed for everyone. Report lines linked to it keep their text."
      onSubmit={(event) => {
        event.preventDefault();
        run(() => api.delete(`/api/project-tasks/${task.id}`), {
          title: 'Priority task deleted',
          body: task.title,
        });
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} data-autofocus>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={saving}>
            Delete task
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <p className={styles.confirmTitle}>
          <PriorityTag priority={task.priority} />
          <span className={styles.confirmText}>{task.title}</span>
        </p>
        <FormError message={formError} />
      </div>
    </Dialog>
  );
}
