'use client';
// The Working on card's start form (CONTRACT 15): a project (the report's picker, real projects
// only), an optional priority task of that project, a note ("What are you working on?") and
// Start. "Switch project" opens it over a running timer with the picker already open; starting
// then stops the running timer.
import { useCallback, useId, useRef, useState } from 'react';
import { ChevronDown, Play } from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import ProjectLabel from '@/components/ProjectLabel';
import Select from '@/components/Select';
import ProjectPicker from '../report/ProjectPicker';
import { taskOptions } from './timerData';
import styles from './TimerCard.module.css';

const NOTE_MAX = 200;
const FIELDS = new Set(['projectId', 'projectTaskId', 'note']);

/**
 * @param {{ picker: object, tasks: Record<string, object[]>, busy: boolean, starting: boolean,
 *   switching: boolean, onStart: (input: { projectId: number, projectTaskId: number | null,
 *   note: string }) => Promise<object | null>, onCancel: () => void,
 *   projectRef?: { current: HTMLElement | null } }} props
 *   onStart throws an ApiError with `fields` for errors to show under the fields
 */
export default function TimerStartForm({
  picker,
  tasks,
  busy,
  starting,
  switching,
  onStart,
  onCancel,
  projectRef,
}) {
  const id = useId();
  const [project, setProject] = useState(null);
  const [taskId, setTaskId] = useState('');
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState(switching);
  const [errors, setErrors] = useState({});
  const wrapRef = useRef(null);
  const ownButtonRef = useRef(null);
  const buttonRef = projectRef ?? ownButtonRef;
  const options = project ? taskOptions(tasks[project.projectId]) : [];

  const closePicker = useCallback(
    ({ focusAnchor = true } = {}) => {
      setPicking(false);
      if (focusAnchor) buttonRef.current?.focus();
    },
    [buttonRef],
  );

  function pick(choice) {
    setProject({ projectId: choice.projectId, name: choice.name, color: choice.color });
    setTaskId('');
    setErrors((current) => ({ ...current, projectId: null, projectTaskId: null }));
    closePicker();
  }

  async function submit(event) {
    event.preventDefault();
    if (!project) {
      setErrors({ projectId: 'Pick a project.' });
      buttonRef.current?.focus();
      return;
    }
    setErrors({});
    try {
      await onStart({
        projectId: project.projectId,
        projectTaskId: taskId ? Number(taskId) : null,
        note: note.trim(),
      });
    } catch (error) {
      const fields = error.fields ?? {};
      const other = Object.keys(fields).find((key) => !FIELDS.has(key));
      setErrors({ ...fields, _: other ? fields[other] : null });
    }
  }

  const describedBy = (key) => (errors[key] ? `${id}-${key}-error` : undefined);
  return (
    <form className={styles.form} onSubmit={submit} noValidate aria-label="Start a timer">
      <div className={styles.formRow}>
        <div ref={wrapRef} className={styles.projectField}>
          <span id={`${id}-project-label`} className="visually-hidden">
            Project
          </span>
          <button
            ref={buttonRef}
            type="button"
            className={`${styles.projectButton} ${errors.projectId ? styles.invalid : ''}`}
            aria-haspopup="dialog"
            aria-expanded={picking}
            aria-labelledby={`${id}-project-label ${id}-project-value`}
            aria-describedby={describedBy('projectId')}
            disabled={busy}
            onClick={() => setPicking((open) => !open)}
          >
            <span id={`${id}-project-value`} className={styles.projectValue}>
              {project ? (
                <ProjectLabel project={project} size="sm" />
              ) : (
                <span className={styles.placeholder}>Pick a project</span>
              )}
            </span>
            <ChevronDown
              size={18}
              strokeWidth={1.8}
              aria-hidden="true"
              className={styles.chevron}
            />
          </button>
          {picking ? (
            <ProjectPicker
              picker={picker}
              current={project ? `p${project.projectId}` : null}
              anchorRef={wrapRef}
              allowRequests={false}
              ariaLabel="Pick a project to time"
              onPick={pick}
              onClose={closePicker}
            />
          ) : null}
        </div>
        {options.length > 0 ? (
          <div className={styles.taskField}>
            <label htmlFor={`${id}-task`} className="visually-hidden">
              Priority task
            </label>
            <Select
              id={`${id}-task`}
              options={options}
              value={taskId}
              error={Boolean(errors.projectTaskId)}
              aria-describedby={describedBy('projectTaskId')}
              disabled={busy}
              onChange={(event) => setTaskId(event.target.value)}
            />
          </div>
        ) : null}
        <div className={styles.noteField}>
          <label htmlFor={`${id}-note`} className="visually-hidden">
            What are you working on?
          </label>
          <Input
            id={`${id}-note`}
            placeholder="What are you working on?"
            maxLength={NOTE_MAX}
            autoComplete="off"
            value={note}
            error={Boolean(errors.note)}
            aria-describedby={describedBy('note')}
            disabled={busy}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <div className={styles.formButtons}>
          {switching ? (
            <Button variant="secondary" onClick={onCancel} disabled={starting}>
              Cancel
            </Button>
          ) : null}
          <Button
            type="submit"
            icon={<Play size={16} strokeWidth={1.8} aria-hidden="true" />}
            loading={starting}
            disabled={busy}
          >
            Start
          </Button>
        </div>
      </div>
      {['projectId', 'projectTaskId', 'note', '_'].map((key) =>
        errors[key] ? (
          <p key={key} id={`${id}-${key}-error`} className={styles.error} role="alert">
            {errors[key]}
          </p>
        ) : null,
      )}
    </form>
  );
}
