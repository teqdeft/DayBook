'use client';
// A report card's part in CONTRACT 24: the "Still open from past reports" box for the card's
// project (shown once the project is picked, from "Add another project" or by changing the card's
// project, while it has suggestions) and the planned-project note under the card's head.
import { Info } from 'lucide-react';
import { useToast } from '@/components/ToastProvider';
import CarrySuggestions from './CarrySuggestions';
import { useReport } from './ReportProvider';
import { carriedTask, withCarriedTasks } from './reportCarry';
import { projectKey } from './reportState';
import styles from './CardCarry.module.css';

const NO_ITEMS = [];

/** "Added to today." or "Added 3 tasks to today." (the prototype's toasts). */
export function addedText(count) {
  return count === 1 ? 'Added to today.' : `Added ${count} tasks to today.`;
}

/** Under the head of a planned project (0 minutes, no Done line), instead of an hours error. */
export function PlannedNote() {
  return (
    <p className={styles.planned}>
      <Info size={16} strokeWidth={1.8} aria-hidden="true" />
      Not worked on today. Its tasks stay open.
    </p>
  );
}

/**
 * @param {{ entry: object, focusRequestRef: { current: string | null }, disabled?: boolean }}
 *   props "Add to today" puts the new line where focus goes next (focusRequestRef)
 */
export default function CardSuggestions({ entry, focusRequestRef, disabled = false }) {
  const { carry, readOnly, updateEntry } = useReport();
  const toast = useToast();
  const key = projectKey(entry);
  const items = (!readOnly && key && carry.suggestions[key]) || NO_ITEMS;

  function add(list) {
    const added = list.map(carriedTask);
    if (added.length === 0) return;
    focusRequestRef.current = added[0].key;
    updateEntry(entry.key, (card) => ({ tasks: withCarriedTasks(card.tasks, added) }), {
      entryKey: entry.key,
      field: 'tasks',
    });
    toast({ title: addedText(added.length) });
  }

  // Always rendered (an empty box draws nothing), so a pending Undo toast survives the last row.
  return (
    <div className={items.length ? styles.wrap : undefined}>
      <CarrySuggestions
        items={items}
        disabled={disabled}
        onAdd={(item) => add([item])}
        onAddAll={add}
        onClosed={carry.onClosed}
        onRestored={(item) => carry.onRestored(item, key)}
      />
    </div>
  );
}
