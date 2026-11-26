'use client';
// "+ Add task" under a column (CONTRACT 27 and 28, Quick add), named "Add task to Testing": it turns
// into one title field. Enter or Add makes a P2 task for anyone on the project, with no date, in
// that phase; the field stays open and empty for the next one (the new card makes its entrance
// once the refresh draws it). "More options" opens the New task window with the typed title and
// the column's phase. Escape or X closes it and focus goes back to "+ Add task".
import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { api } from '@/lib/apiClient';
import { addTaskId } from './boardView';
import { TITLE_ERROR } from './taskFormModel';
import styles from './QuickAdd.module.css';

const HELP = 'Anyone, P2, no date. More options for a person, a date or files.';

/**
 * The field's title, its error and Add: a title of 2 characters or more makes the task, then the
 * field empties for the next one; the focus stays in it either way.
 */
function useQuickAddForm({ projectId, column, onAdded }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function add() {
    if (saving) return;
    if (title.trim().length < 2) {
      setError(TITLE_ERROR);
      inputRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const body = { title: title.trim(), phase: column.key, priority: 'p2', assigneeId: null };
      const { data } = await api.post(`/api/projects/${projectId}/tasks`, body);
      setTitle('');
      setError('');
      onAdded(data, column);
    } catch (failure) {
      setError(failure.fields?.title ?? failure.message);
    } finally {
      setSaving(false);
      inputRef.current?.focus();
    }
  }

  function change(event) {
    setTitle(event.target.value);
    if (error) setError('');
  }

  return { title, error, saving, inputRef, add, change };
}

/** Add, More options and X, under the field. */
function QuickAddButtons({ saving, onAdd, onMore, onClose }) {
  return (
    <div className={styles.quickRow}>
      <Button variant="secondary" size="small" loading={saving} onClick={onAdd}>
        Add
      </Button>
      <Button variant="text" size="compact" onClick={onMore}>
        More options
      </Button>
      <button type="button" className={styles.quickClose} aria-label="Close" onClick={onClose}>
        <X size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Escape anywhere in the open field closes it (and goes no further, so no window closes). */
const closeOnEscape = (onClose) => (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  onClose();
};

function QuickAddForm({ projectId, column, onClose, onAdded, onMore }) {
  const { title, error, saving, inputRef, add, change } = useQuickAddForm({
    projectId,
    column,
    onAdded,
  });
  const ids = { input: `${addTaskId(column.key)}-input`, help: `${addTaskId(column.key)}-help` };
  return (
    <div className={styles.quick} onKeyDown={closeOnEscape(onClose)}>
      <label className="visually-hidden" htmlFor={ids.input}>
        Task title for {column.label}
      </label>
      <Input
        id={ids.input}
        ref={inputRef}
        compact
        className={styles.quickInput}
        value={title}
        maxLength={200}
        autoComplete="off"
        placeholder="Task title, then press Enter"
        error={Boolean(error)}
        aria-describedby={error ? `${ids.help}-error ${ids.help}` : ids.help}
        onChange={change}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          add();
        }}
      />
      {error ? (
        <p id={`${ids.help}-error`} className={styles.quickError} role="alert">
          {error}
        </p>
      ) : null}
      <p id={ids.help} className={styles.quickHelp}>
        {HELP}
      </p>
      <QuickAddButtons
        saving={saving}
        onAdd={add}
        onMore={() => onMore(title.trim(), column)}
        onClose={onClose}
      />
    </div>
  );
}

/**
 * @param {{ projectId: number, column: { key: string, label: string }, open: boolean,
 *   onOpen: () => void, onClose: () => void, onAdded: (task: object, column: object) => void,
 *   onMore: (title: string, column: object) => void }} props open: this column's field is the
 *   one open (one at a time on the board)
 */
export default function QuickAdd({ open, onOpen, ...rest }) {
  if (open) return <QuickAddForm {...rest} />;
  return (
    <button
      type="button"
      id={addTaskId(rest.column.key)}
      className={styles.addTask}
      onClick={onOpen}
    >
      <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
      Add task
      <span className="visually-hidden"> to {rest.column.label}</span>
    </button>
  );
}
