'use client';
// The timer form's note, "What are you working on?" (CONTRACT 15). CONTRACT 24: once a project is
// picked, the field offers that project's to-do lines that aren't done ("Your to-do on Studio
// Ubique", the listbox of the report's priority-task suggestions, filtered by the words typed);
// picking one starts the timer on that line. Without lines it is a plain field.
import { useId, useState } from 'react';
import Input from '@/components/Input';
import { matchSuggestions } from '../report/reportState';
import styles from './TimerCard.module.css';

const NONE = [];

/**
 * @param {{ id: string, value: string, onChange: (value: string) => void, maxLength: number,
 *   error?: boolean, describedBy?: string, disabled?: boolean, lines?: Array<{ id: number,
 *   title: string }>, projectName?: string, onPick: (line: object) => void }} props lines: the
 *   picked project's to-do lines on offer (timerData.todoOffers)
 */
export default function TimerNoteField({
  id,
  value,
  onChange,
  maxLength,
  error = false,
  describedBy,
  disabled = false,
  lines = NONE,
  projectName = '',
  onPick,
}) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const combobox = lines.length > 0;
  const items = combobox ? matchSuggestions(lines, value) : NONE;
  const open = focused && !dismissed && !disabled && items.length > 0;
  const activeItem = open && active >= 0 ? items[Math.min(active, items.length - 1)] : null;

  function pick(line) {
    setActive(-1);
    setDismissed(true);
    onPick(line);
  }

  function onKeyDown(event) {
    if (event.nativeEvent.isComposing) return;
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && items.length) {
      event.preventDefault();
      setDismissed(false);
      const current = activeItem ? items.indexOf(activeItem) : -1;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + items.length) % items.length);
    } else if (event.key === 'Enter' && activeItem) {
      // Enter on an offered line starts it; otherwise the form submits with the typed note.
      event.preventDefault();
      pick(activeItem);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setDismissed(true);
      setActive(-1);
    }
  }

  return (
    <div className={styles.noteField}>
      <label htmlFor={id} className="visually-hidden">
        What are you working on?
      </label>
      <Input
        id={id}
        placeholder="What are you working on?"
        maxLength={maxLength}
        autoComplete="off"
        value={value}
        error={error}
        aria-describedby={describedBy}
        disabled={disabled}
        role={combobox ? 'combobox' : undefined}
        aria-autocomplete={combobox ? 'list' : undefined}
        aria-expanded={combobox ? open : undefined}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeItem ? `${listId}-${activeItem.id}` : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          setDismissed(false);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setDismissed(false);
          setActive(-1);
        }}
      />
      {open ? (
        <div className={styles.offers}>
          <p className={styles.offersHead} aria-hidden="true">
            Your to-do on {projectName}
          </p>
          <ul id={listId} role="listbox" aria-label={`Your to-do on ${projectName}`}>
            {items.map((line) => (
              <li
                key={line.id}
                id={`${listId}-${line.id}`}
                role="option"
                aria-selected={line === activeItem}
                className={`${styles.offer} ${line === activeItem ? styles.offerActive : ''}`}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => pick(line)}
              >
                {line.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
