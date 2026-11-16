'use client';
// "Add a task" under a to-do group (CONTRACT 24): a borderless row. Enter adds the line and keeps
// focus for the next one; Escape clears it; "Add" does the same as Enter. While a task is typed,
// the project's open priority tasks that hold every word show (the report's matchSuggestions,
// "Priority tasks on Studio Ubique"); picking one adds a line linked to it. Pasting more than one
// line opens the paste dialog with the text instead.
import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import Button from '@/components/Button';
import PriorityTag from '@/components/PriorityTag';
import { TODO_LIMITS } from '@/modules/reports/todoText';
import { matchSuggestions } from '../report/reportState';
import styles from './TodoGroup.module.css';

const NONE = [];

/** Whether pasted text holds more than one line with something on it. */
export function isMultiLine(text) {
  return (
    String(text ?? '')
      .split(/\r\n|[\r\n\u2028\u2029]/)
      .filter((line) => line.trim()).length > 1
  );
}

/**
 * @param {{ name: string, groupKey: string, priority?: Array<{ id: number, title: string,
 *   priority: string, forYou: boolean }>, taken: Set<number>, inputRef: { current: any },
 *   onAdd: (text: string) => Promise<unknown> | boolean, onPick: (item: object) => void,
 *   onPaste: (text: string) => void }} props priority: the project's open priority tasks;
 *   taken: the ones the group's lines already link; onAdd: false keeps the text (too short),
 *   a promise resolving to null puts it back (the add failed)
 */
export default function TodoAddInput({
  name,
  groupKey,
  priority = NONE,
  taken,
  inputRef,
  onAdd,
  onPick,
  onPaste,
}) {
  const listId = useId();
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const combobox = matchSuggestions(priority, '', taken).length > 0;
  const items = combobox && value.trim() ? matchSuggestions(priority, value, taken) : NONE;
  const open = focused && items.length > 0;
  const activeItem = open && active >= 0 ? items[Math.min(active, items.length - 1)] : null;

  async function submit() {
    const text = value;
    const result = onAdd(text);
    if (result === false) return;
    setValue('');
    setActive(-1);
    // A failed add puts the text back, unless something new was typed meanwhile.
    if ((await result) === null) setValue((current) => current || text);
  }

  function pick(item) {
    setValue('');
    setActive(-1);
    onPick(item);
  }

  function onKeyDown(event) {
    if (event.nativeEvent.isComposing) return;
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && items.length) {
      event.preventDefault();
      const current = activeItem ? items.indexOf(activeItem) : -1;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + items.length) % items.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeItem) pick(activeItem);
      else if (value.trim()) submit();
    } else if (event.key === 'Escape' && value) {
      event.preventDefault();
      setValue('');
      setActive(-1);
    }
  }

  function onPasteText(event) {
    const text = event.clipboardData?.getData('text') ?? '';
    if (!isMultiLine(text)) return;
    event.preventDefault();
    onPaste(text);
  }

  return (
    <div className={styles.addRow}>
      <span className={styles.addIcon} aria-hidden="true">
        <Plus size={18} strokeWidth={1.8} />
      </span>
      <input
        ref={inputRef}
        className={styles.addInput}
        value={value}
        placeholder="Add a task"
        maxLength={TODO_LIMITS.titleMax}
        autoComplete="off"
        aria-label={`Add a task to ${name}`}
        data-add-task={groupKey}
        role={combobox ? 'combobox' : undefined}
        aria-autocomplete={combobox ? 'list' : undefined}
        aria-expanded={combobox ? open : undefined}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeItem ? `${listId}-${activeItem.id}` : undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPasteText}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setActive(-1);
        }}
      />
      {value.trim() ? (
        <Button variant="secondary" size="compact" className={styles.addButton} onClick={submit}>
          Add
        </Button>
      ) : null}
      {open ? (
        <div className={styles.suggest}>
          <p className={styles.suggestHead} aria-hidden="true">
            Priority tasks on {name}
          </p>
          <ul id={listId} role="listbox" aria-label={`Priority tasks on ${name}`}>
            {items.map((item) => (
              <li
                key={item.id}
                id={`${listId}-${item.id}`}
                role="option"
                aria-selected={item === activeItem}
                className={`${styles.option} ${item === activeItem ? styles.optionActive : ''}`}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => pick(item)}
              >
                <PriorityTag priority={item.priority} />
                <span className={styles.optionTitle}>{item.title}</span>
                <span className={styles.optionNote}>
                  {item.forYou ? 'For you' : 'Anyone on the project'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
