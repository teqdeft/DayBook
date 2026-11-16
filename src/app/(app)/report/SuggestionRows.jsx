'use client';
// The rows of "Still open from past reports" (CONTRACT 24), in the box and in the Still open
// dialog: the title, its status tag (In progress primary soft, Blocked red soft) and day tag
// ("From Wednesday"), then "Add to today", "Done already" and "Not needed". The rows wrap under
// the title on phones. When a row goes away after one of its buttons was pressed and focus went
// with it, focus moves to the row now in its place (or the one above), so a keyboard user stays
// in the list.
import { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import Button from '@/components/Button';
import Tag from '@/components/Tag';
import styles from './SuggestionRows.module.css';

const STATUS = {
  in_progress: { label: 'In progress', tone: 'primary' },
  blocked: { label: 'Blocked', tone: 'red' },
};

/** Whether focus is gone from the page (its element was removed). */
function focusLost() {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

/**
 * @param {{ items: Array<{ taskId: number, title: string, status: string, dayLabel?: string }>,
 *   onAdd?: (item: object, event: object) => void, closer: { busy: Set<number>,
 *   close: Function }, disabled?: boolean }} props closer comes from useSuggestionClose; onAdd
 *   also gets the click (event.detail 0 = from the keyboard)
 */
export default function SuggestionRows({ items, onAdd, closer, disabled = false }) {
  const listRef = useRef(null);
  // The row whose button was pressed: { taskId, index } until that row is gone.
  const pressed = useRef(null);

  useEffect(() => {
    const row = pressed.current;
    const list = listRef.current;
    if (!row || !list || items.some((item) => Number(item.taskId) === row.taskId)) return;
    pressed.current = null;
    if (!focusLost()) return;
    const buttons = list.querySelectorAll('[data-suggestion-add]');
    buttons[Math.min(row.index, buttons.length - 1)]?.focus();
  }, [items]);

  function add(item, index, event) {
    pressed.current = { taskId: Number(item.taskId), index };
    onAdd?.(item, event);
  }

  async function close(item, index, reason, event) {
    if (disabled || closer.busy.has(Number(item.taskId))) return;
    pressed.current = { taskId: Number(item.taskId), index };
    // A refused close keeps the row: nothing to move focus from.
    if (!(await closer.close(item, reason, event))) pressed.current = null;
  }

  return (
    <ul ref={listRef} className={styles.rows}>
      {items.map((item, index) => {
        const status = STATUS[item.status] ?? STATUS.in_progress;
        const busy = closer.busy.has(Number(item.taskId));
        return (
          <li key={item.taskId} className={styles.row}>
            <span className={styles.what}>
              <span className={styles.title}>{item.title}</span>
              <Tag tone={status.tone} padX={8}>
                {status.label}
              </Tag>
              {item.dayLabel ? (
                <Tag tone="neutral" padX={8}>
                  {item.dayLabel}
                </Tag>
              ) : null}
            </span>
            <span className={styles.actions}>
              <Button
                variant="secondary"
                size="compact"
                className={styles.action}
                aria-label={`Add to today: ${item.title}`}
                data-suggestion-add=""
                disabled={disabled}
                onClick={(event) => add(item, index, event)}
              >
                Add to today
              </Button>
              <Button
                variant="secondary"
                size="compact"
                className={styles.action}
                icon={<Check size={15} strokeWidth={1.8} className={styles.check} />}
                aria-label={`Done already: ${item.title}`}
                aria-busy={busy || undefined}
                aria-disabled={busy || undefined}
                disabled={disabled}
                onClick={(event) => close(item, index, 'done', event)}
              >
                Done already
              </Button>
              <Button
                variant="text"
                size="compact"
                className={styles.drop}
                aria-label={`Not needed: ${item.title}`}
                aria-busy={busy || undefined}
                aria-disabled={busy || undefined}
                disabled={disabled}
                onClick={(event) => close(item, index, 'dropped', event)}
              >
                Not needed
              </Button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
