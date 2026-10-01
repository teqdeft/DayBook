'use client';
// One task line of a project card: the title, with the project's open priority tasks suggested
// while it is typed (CONTRACT section 13), the linked priority task's tag, remove, and the
// status select. Picking a suggestion fills the title and links the line; the × on the tag
// unlinks it, and so does clearing the title.
import { useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import PriorityTag, { PRIORITY_LABELS } from '@/components/PriorityTag';
import StatusCell from '@/components/StatusCell';
import { NO_LINK, matchSuggestions } from './reportState';
import styles from './TaskLine.module.css';

const STATUS_OPTIONS = [
  { value: 'done', label: 'Done' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
];

/** "P1 task Fix login timeout" for labels. */
function linkName(task) {
  const label = PRIORITY_LABELS[task.priority] ?? 'Priority';
  return task.projectTaskTitle ? `${label} task ${task.projectTaskTitle}` : `${label} task`;
}

function Suggestions({ id, projectName, items, active, onPick }) {
  return (
    <div className={styles.suggest}>
      <p className={styles.suggestHead} aria-hidden="true">
        Priority tasks on {projectName}
      </p>
      <ul id={id} role="listbox" aria-label={`Priority tasks on ${projectName}`}>
        {items.map((item, i) => (
          <li
            key={item.id}
            id={`${id}-${item.id}`}
            role="option"
            aria-selected={i === active}
            className={`${styles.option} ${i === active ? styles.active : ''}`}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onPick(item)}
          >
            <PriorityTag priority={item.priority} />
            <span className={styles.optionTitle}>{item.title}</span>
            <span className={styles.optionFor}>
              {item.forYou ? 'For you' : 'Anyone on the project'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * @param {{ task: object, index: number, projectName: string, suggestions: object[],
 *   taken: Set<number>, readOnly: boolean, disabled: boolean, error?: string, errorId: string,
 *   inputRef: (element: HTMLInputElement | null) => void, onUpdate: (patch: object) => void,
 *   onEnter: () => void, onRemove: () => void }} props suggestions: the project's open priority
 *   tasks for this person; taken: the ones other lines of the card already link to
 */
export default function TaskLine({
  task,
  index,
  projectName,
  suggestions,
  taken,
  readOnly,
  disabled,
  error,
  errorId,
  inputRef,
  onUpdate,
  onEnter,
  onRemove,
}) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const label = `Task ${index + 1} for ${projectName}`;
  const linked = Boolean(task.projectTaskId);
  const inputElement = useRef(null);
  // The line is a combobox only when it has priority tasks to suggest; otherwise a plain field.
  const combobox = !readOnly && !linked && matchSuggestions(suggestions, '', taken).length > 0;
  const items = combobox && !disabled ? matchSuggestions(suggestions, task.title, taken) : [];
  const open = focused && !dismissed && items.length > 0;
  const activeItem = open && active >= 0 ? items[Math.min(active, items.length - 1)] : null;

  function pick(item) {
    onUpdate({
      title: item.title,
      projectTaskId: item.id,
      priority: item.priority,
      projectTaskTitle: item.title,
    });
    setActive(-1);
  }

  function onKeyDown(event) {
    if (readOnly || event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!items.length) return;
      event.preventDefault();
      setDismissed(false);
      const count = items.length;
      const current = activeItem ? items.indexOf(activeItem) : -1;
      if (event.key === 'ArrowDown') setActive((current + 1) % count);
      else setActive(current <= 0 ? count - 1 : current - 1);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setDismissed(true);
      setActive(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeItem) pick(activeItem);
      else onEnter();
    }
  }

  function onTitle(event) {
    const title = event.target.value;
    // An emptied line no longer says which priority task it worked on.
    const unlink = linked && !title.trim() ? NO_LINK : null;
    onUpdate({ title, ...unlink });
    setDismissed(false);
    setActive(-1);
  }

  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <div className={styles.titleCell}>
          {linked ? (
            <span className={styles.link}>
              <PriorityTag priority={task.priority} />
              {readOnly ? null : (
                <button
                  type="button"
                  className={styles.unlink}
                  aria-label={`Unlink from the ${linkName(task)}`}
                  title="Unlink from this priority task"
                  disabled={disabled}
                  onClick={() => {
                    onUpdate(NO_LINK);
                    // The button goes away with the link: keep focus on the line.
                    inputElement.current?.focus();
                  }}
                >
                  <X size={11} strokeWidth={2.2} aria-hidden="true" />
                </button>
              )}
            </span>
          ) : null}
          <input
            ref={(element) => {
              inputElement.current = element;
              inputRef(element);
            }}
            className={styles.taskInput}
            value={task.title}
            maxLength={500}
            placeholder={readOnly ? '' : 'What did you work on?'}
            readOnly={readOnly || disabled}
            role={combobox ? 'combobox' : undefined}
            aria-autocomplete={combobox ? 'list' : undefined}
            aria-expanded={combobox ? open : undefined}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={activeItem ? `${listId}-${activeItem.id}` : undefined}
            aria-label={linked ? `${label}, linked to the ${linkName(task)}` : label}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={onTitle}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              setDismissed(false);
              setActive(-1);
            }}
          />
        </div>
        {readOnly ? null : (
          <button
            type="button"
            className={styles.removeTask}
            aria-label={`Remove task ${index + 1} for ${projectName}`}
            disabled={disabled}
            onClick={onRemove}
          >
            <X size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        )}
        <div className={styles.status}>
          <StatusCell
            status={task.status}
            size="cellLarge"
            chevron={!readOnly}
            aria-hidden={readOnly ? undefined : true}
          />
          {readOnly ? null : (
            <select
              className={styles.statusSelect}
              value={task.status}
              disabled={disabled}
              aria-label={`Status of task ${index + 1} for ${projectName}`}
              onChange={(event) => onUpdate({ status: event.target.value }, false)}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      {open ? (
        <Suggestions
          id={listId}
          projectName={projectName}
          items={items}
          active={activeItem ? items.indexOf(activeItem) : -1}
          onPick={pick}
        />
      ) : null}
      {error ? (
        <p id={errorId} className={styles.taskError} role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
