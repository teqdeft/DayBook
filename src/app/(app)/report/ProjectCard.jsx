'use client';
// One project in the daily report: collapse chevron, project picker, Urgent / Waiting for approval
// / Carried over label, hours, and the task lines (TaskLine.jsx) with their status select.
import { useCallback, useId, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import ProjectLabel from '@/components/ProjectLabel';
import Tag from '@/components/Tag';
import HoursField from './HoursField';
import ProjectPicker from './ProjectPicker';
import TaskLine from './TaskLine';
import { useReport } from './ReportProvider';
import { newTask, parseHours, projectKey, unlinkTasks } from './reportState';
import { timerHoursFor } from './reportTimers';
import styles from './ProjectCard.module.css';

const NO_SUGGESTIONS = [];

const COLORS = new Set(['blue', 'green', 'violet', 'orange', 'teal', 'pink']);

function colorVars(color) {
  const name = COLORS.has(color) ? color : 'blue';
  return {
    '--project-strong': `var(--label-${name})`,
    '--project-text': `var(--label-${name}-text)`,
  };
}

function CardTag({ entry }) {
  if (entry.isUrgent) {
    return (
      <Tag tone="marigold" size="md" solid>
        Urgent
      </Tag>
    );
  }
  if (entry.waitingForApproval) {
    return (
      <Tag tone="marigold" size="md">
        Waiting for approval
      </Tag>
    );
  }
  if (entry.tasks.some((task) => task.carried)) {
    return (
      <Tag tone="neutral" size="md">
        Carried over
      </Tag>
    );
  }
  return null;
}

/**
 * @param {{ entry: object, used: Set<string>, onRequestProject: (entryKey: string) => void,
 *   focusRequestRef: { current: string | null }, taskInputsRef?: { current: Map<string,
 *   HTMLInputElement> }, disabled?: boolean, hoursFromTimers?: boolean }} props focusRequestRef
 *   holds the key of a task row to focus once it renders (a row just added); taskInputsRef
 *   collects the task inputs by key; hoursFromTimers (required timer mode, real projects) makes
 *   the hours read-only with a "From timers" hint
 */
export default function ProjectCard({
  entry,
  used,
  onRequestProject,
  focusRequestRef,
  taskInputsRef = null,
  disabled = false,
  hoursFromTimers = false,
}) {
  const { data, errors, readOnly, change, updateEntry, timers } = useReport();
  const [picking, setPicking] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const labelRef = useRef(null);
  const wrapRef = useRef(null);
  const id = useId();
  const name = entry.projectName || 'this project';
  const entryErrors = errors.entries[entry.key] ?? {};
  const localHours = parseHours(entry.hours);
  const hoursError = entryErrors.hours ?? localHours.error;
  const current = projectKey(entry);
  const otherKeys = new Set([...used].filter((key) => key !== current));
  // A collapsed card opens again when the server finds a problem in its tasks, so it shows.
  const taskProblem =
    Boolean(entryErrors.tasks) || entry.tasks.some((task) => Boolean(errors.tasks[task.key]));
  const showTasks = !collapsed || taskProblem;

  const closePicker = useCallback(({ focusAnchor = true } = {}) => {
    setPicking(false);
    if (focusAnchor) labelRef.current?.focus();
  }, []);

  function setTasks(updater, clear) {
    updateEntry(entry.key, (current) => ({ tasks: updater(current.tasks) }), clear);
  }

  function addTaskAfter(index) {
    const task = newTask();
    focusRequestRef.current = task.key;
    setTasks((tasks) => [...tasks.slice(0, index + 1), task, ...tasks.slice(index + 1)], {
      entryKey: entry.key,
      field: 'tasks',
    });
  }

  function removeTask(taskKey) {
    setTasks((tasks) => tasks.filter((task) => task.key !== taskKey), { taskKey });
  }

  function pickProject(pick) {
    const moved = projectKey(pick) !== current;
    updateEntry(
      entry.key,
      (card) => ({
        projectId: pick.projectId ?? null,
        projectRequestId: pick.projectRequestId ?? null,
        projectName: pick.name,
        projectColor: pick.color ?? null,
        isUrgent: Boolean(pick.isUrgent),
        waitingForApproval: Boolean(pick.projectRequestId),
        // Priority tasks belong to a project: lines moved to another one lose their links.
        tasks: moved ? unlinkTasks(card.tasks) : card.tasks,
        // Required timer mode: the hours are the new project's timer hours.
        ...(moved ? timerHoursFor(timers, pick) : null),
      }),
      { entryKey: entry.key, field: 'project' },
    );
    closePicker();
  }

  function removeProject() {
    setPicking(false);
    change((list) => list.filter((item) => item.key !== entry.key));
  }

  const taskInputRef = (taskKey) => (element) => {
    if (element) taskInputsRef?.current.set(taskKey, element);
    else taskInputsRef?.current.delete(taskKey);
    if (element && focusRequestRef.current === taskKey) {
      focusRequestRef.current = null;
      element.focus();
    }
  };

  const project = { name: entry.projectName, color: entry.projectColor };
  // The project's open priority tasks for this person, suggested while a line is typed.
  const suggestions = (entry.projectId && data.suggestions?.[entry.projectId]) || NO_SUGGESTIONS;
  /** Priority tasks linked on the card's other lines (not suggested again). */
  const linkedOn = (taskKey) =>
    new Set(
      entry.tasks
        .filter((task) => task.key !== taskKey && task.projectTaskId)
        .map((task) => task.projectTaskId),
    );

  return (
    <section className={styles.card} style={colorVars(entry.projectColor)} aria-label={name}>
      <div className={styles.head}>
        <button
          type="button"
          className={styles.collapse}
          aria-expanded={showTasks}
          aria-controls={`${id}-tasks`}
          aria-label={showTasks ? `Hide tasks for ${name}` : `Show tasks for ${name}`}
          onClick={() => setCollapsed(showTasks)}
        >
          <ChevronDown
            size={20}
            strokeWidth={1.8}
            aria-hidden="true"
            className={showTasks ? styles.chevron : styles.chevronClosed}
          />
        </button>
        <div ref={wrapRef} className={styles.pickerWrap}>
          {readOnly ? (
            <ProjectLabel project={project} size="lg" className={styles.label} />
          ) : (
            <ProjectLabel
              ref={labelRef}
              project={project}
              size="lg"
              as="button"
              chevron
              className={styles.label}
              aria-haspopup="dialog"
              aria-expanded={picking}
              aria-label={`Project: ${name}. Change the project`}
              disabled={disabled}
              onClick={() => setPicking((open) => !open)}
            />
          )}
          {picking ? (
            <ProjectPicker
              picker={data.picker}
              used={otherKeys}
              current={current}
              anchorRef={wrapRef}
              onPick={pickProject}
              onClose={closePicker}
              onRemove={removeProject}
              onRequestProject={() => {
                // Back on the project label first, so the dialog returns focus there.
                labelRef.current?.focus();
                setPicking(false);
                onRequestProject(entry.key);
              }}
            />
          ) : null}
        </div>
        <CardTag entry={entry} />
        <HoursField
          name={name}
          value={entry.hours}
          readOnly={readOnly || disabled}
          fromTimers={hoursFromTimers}
          errorId={hoursError ? `${id}-hours-error` : null}
          hintId={`${id}-hours-hint`}
          onChange={(hours) =>
            updateEntry(entry.key, { hours }, { entryKey: entry.key, field: 'hours' })
          }
        />
      </div>
      {entryErrors.project || hoursError ? (
        <div className={styles.headErrors}>
          {entryErrors.project ? (
            <p className={styles.error} role="alert">
              {entryErrors.project}
            </p>
          ) : null}
          {hoursError ? (
            <p
              id={`${id}-hours-error`}
              className={`${styles.error} ${styles.hoursError}`}
              role="alert"
            >
              {hoursError}
            </p>
          ) : null}
        </div>
      ) : null}
      {showTasks ? (
        <div id={`${id}-tasks`} className={styles.tasks}>
          <div className={styles.thead} aria-hidden="true">
            <span>Task</span>
            <span className={styles.statusHead}>Status</span>
          </div>
          <ul className={styles.rows}>
            {entry.tasks.map((task, index) => (
              <TaskLine
                key={task.key}
                task={task}
                index={index}
                projectName={name}
                suggestions={suggestions}
                taken={linkedOn(task.key)}
                readOnly={readOnly}
                disabled={disabled}
                error={errors.tasks[task.key]}
                errorId={`${id}-${task.key}-error`}
                inputRef={taskInputRef(task.key)}
                onUpdate={(patch, clear = true) =>
                  setTasks(
                    (tasks) =>
                      tasks.map((item) => (item.key === task.key ? { ...item, ...patch } : item)),
                    clear ? { taskKey: task.key } : undefined,
                  )
                }
                onEnter={() => addTaskAfter(index)}
                onRemove={() => removeTask(task.key)}
              />
            ))}
          </ul>
          {entryErrors.tasks ? (
            <p className={`${styles.error} ${styles.tasksError}`} role="alert">
              {entryErrors.tasks}
            </p>
          ) : null}
          {readOnly ? null : (
            <div className={styles.addRow}>
              <button
                type="button"
                className={styles.addTask}
                disabled={disabled}
                onClick={() => addTaskAfter(entry.tasks.length - 1)}
              >
                <Plus size={16} strokeWidth={2} aria-hidden="true" />
                Add task
              </button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
