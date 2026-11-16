'use client';
// One line of Today's to-do (CONTRACT 24): an 18 px tick (36 px to hit, 44 on phones) that marks
// it Done, the title (click or Enter edits it in place: Enter saves, Escape cancels, leaving the
// field saves), its tags ("From Wednesday" for a carried line, Blocked, Now while its timer runs),
// then Play (only when a timer can start on it; once it runs, focus goes from Play to the title)
// and X (removes it, with Undo). Done lines are muted and struck through. A line still on its way
// to the server can't be changed yet.
import { useEffect, useRef, useState } from 'react';
import { Play, X } from 'lucide-react';
import Tag from '@/components/Tag';
import { useToast } from '@/components/ToastProvider';
import { TODO_LIMITS } from '@/modules/reports/todoText';
import { isPendingLine } from './todoModel';
import styles from './TodoGroup.module.css';

const oneLine = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();

export const SHORT_TITLE = 'Write at least 2 characters.';

const isActive = (element) => typeof document !== 'undefined' && document.activeElement === element;

/** Whether focus fell to the page (its element was removed). */
function focusLost() {
  const active = typeof document === 'undefined' ? null : document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

/** The line's X button, or the group's "Add a task" once the line is gone. */
export function lineFocus(lineId, groupKey) {
  return () =>
    document.querySelector(`[data-todo-line="${lineId}"] [data-remove-line]`) ??
    document.querySelector(`[data-todo-group="${groupKey}"] [data-add-task]`);
}

/** "From Wednesday" (a carried line), Blocked, Now: small tags with the design's 8 px sides. */
function LineTags({ line }) {
  return (
    <>
      {line.carriedFrom?.dayLabel ? (
        <Tag tone="neutral" padX={8}>
          {line.carriedFrom.dayLabel}
        </Tag>
      ) : null}
      {line.status === 'blocked' ? (
        <Tag tone="red" padX={8}>
          Blocked
        </Tag>
      ) : null}
      {line.now ? (
        <Tag tone="green" padX={8} dot>
          Now
        </Tag>
      ) : null}
    </>
  );
}

/**
 * @param {{ line: object, group: object, groupKey: string, todo: object }} props todo: the page's
 *   to-do actions (useTodo): tick, rename, startTimer, removeLine
 */
export default function TodoLine({ line, group, groupKey, todo }) {
  const toast = useToast();
  const [draft, setDraft] = useState(null);
  const titleRef = useRef(null);
  const leaving = useRef(false);
  const refocus = useRef(false);
  const pending = isPendingLine(line);
  const playable = Boolean(line.canStart && group.project) && !pending;

  // After an edit ends from the keyboard, focus goes back to the title.
  useEffect(() => {
    if (!refocus.current || draft !== null) return;
    refocus.current = false;
    titleRef.current?.focus();
  });

  function startEdit() {
    leaving.current = false;
    setDraft(line.title);
  }

  /** Leaves the field; a blur the field may still fire as it goes is not a second save. */
  function stopEdit(keepFocus) {
    leaving.current = true;
    refocus.current = keepFocus;
    setDraft(null);
  }

  /** Ends the edit: saves a changed title (2 to 500 characters), else keeps editing. */
  function save({ keepFocus }) {
    const title = oneLine(draft);
    if (title === line.title || title === '') {
      stopEdit(keepFocus);
      return;
    }
    if (title.length < TODO_LIMITS.titleMin) {
      toast({ title: SHORT_TITLE, tone: 'error' });
      if (!keepFocus) stopEdit(false);
      return;
    }
    stopEdit(keepFocus);
    todo.rename(line, title);
  }

  function onKeyDown(event) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      save({ keepFocus: true });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      stopEdit(true);
    }
  }

  function onBlur() {
    if (leaving.current) {
      leaving.current = false;
      return;
    }
    if (draft !== null) save({ keepFocus: false });
  }

  /** Play. Once the timer runs the button goes (the line is Now): focus moves to the title. */
  async function play(event) {
    const button = event.currentTarget;
    const hadFocus = isActive(button);
    const started = await todo.startTimer(line, group);
    if (started && hadFocus && (isActive(button) || focusLost())) titleRef.current?.focus();
  }

  return (
    <li className={`${styles.line} ${line.done ? styles.done : ''}`} data-todo-line={line.id}>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={line.done}
          aria-label={`Done: ${line.title}`}
          disabled={pending}
          onChange={(event) => todo.tick(line, event.target.checked)}
        />
      </label>
      <span className={styles.what}>
        {draft === null ? (
          <>
            <button
              ref={titleRef}
              type="button"
              className={styles.title}
              aria-label={`Edit task: ${line.title}`}
              title="Edit task"
              disabled={pending}
              onClick={startEdit}
            >
              {line.title}
            </button>
            <LineTags line={line} />
          </>
        ) : (
          <input
            className={styles.editInput}
            value={draft}
            maxLength={TODO_LIMITS.titleMax}
            aria-label={`Edit task: ${line.title}`}
            autoFocus
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
          />
        )}
      </span>
      <span className={styles.lineActions}>
        {playable ? (
          <button
            type="button"
            className={styles.act}
            aria-label={`Start a timer for ${line.title}`}
            title="Start a timer"
            onClick={play}
          >
            <Play size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          className={styles.act}
          aria-label={`Remove ${line.title}`}
          title="Remove"
          data-remove-line
          disabled={pending}
          onClick={(event) =>
            todo.removeLine(line, {
              keyboard: event.detail === 0,
              returnFocus: lineFocus(line.id, groupKey),
            })
          }
        >
          <X size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </span>
    </li>
  );
}
