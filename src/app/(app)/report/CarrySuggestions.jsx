'use client';
// "Still open from past reports" (CONTRACT 24): the person's unfinished tasks from past reports on
// one project, in a report card once its project is picked and under a to-do group on Today. The
// Add buttons only call the parent ("Add to today" = a carried line keeping its status, "Add all to
// today" with two or more rows); "Done already" and "Not needed" close the old line here, with an
// Undo toast, and tell the parent (onClosed, onRestored). The box goes away when it is empty, but
// the component stays for its Undo toast: render it even with no items.
import { useId, useRef } from 'react';
import { RotateCcw } from 'lucide-react';
import Button from '@/components/Button';
import SuggestionRows from './SuggestionRows';
import { useSuggestionClose } from './useSuggestionClose';
import styles from './CarrySuggestions.module.css';

export const BOX_TITLE = 'Still open from past reports';
export const BOX_HELP = "Add the ones you'll work on today. Mark the rest done or not needed.";

const NO_ITEMS = [];

/**
 * @param {{ items?: Array<{ taskId: number, title: string, status: 'in_progress' | 'blocked',
 *   workDate: string, dayLabel: string }>, onAdd?: (item: object, event: object) => void,
 *   onAddAll?: (items: object[], event: object) => void, onClosed?: (taskId: number) => void,
 *   onRestored?: (item: object) => void, disabled?: boolean, className?: string }} props
 *   items: one project's suggestions, as they should show now (the parent drops closed and added
 *   ones); disabled: every button off (the report is submitting); the Add callbacks also get the
 *   click (event.detail 0 = from the keyboard)
 */
export default function CarrySuggestions({
  items = NO_ITEMS,
  onAdd,
  onAddAll,
  onClosed,
  onRestored,
  disabled = false,
  className = '',
}) {
  const titleId = useId();
  const boxRef = useRef(null);
  const anchorRef = useRef(null);
  // After Undo's Tab or Escape, focus goes back to the box, or where it was once it is empty.
  const closer = useSuggestionClose({
    onClosed,
    onRestored,
    onLeave: () => {
      const first = boxRef.current?.querySelector('button:not([disabled])');
      (first ?? anchorRef.current)?.focus();
    },
  });

  return (
    <>
      {items.length ? (
        <div
          ref={boxRef}
          role="region"
          aria-labelledby={titleId}
          className={`${styles.box} ${className}`}
        >
          <div className={styles.head}>
            <div className={styles.heading}>
              <p id={titleId} className={styles.title}>
                <RotateCcw size={16} strokeWidth={1.8} aria-hidden="true" />
                {BOX_TITLE}
              </p>
              <p className={styles.help}>{BOX_HELP}</p>
            </div>
            {items.length > 1 ? (
              <Button
                variant="text"
                size="compact"
                className={styles.addAll}
                disabled={disabled}
                onClick={(event) => onAddAll?.(items, event)}
              >
                Add all to today
              </Button>
            ) : null}
          </div>
          <SuggestionRows items={items} onAdd={onAdd} closer={closer} disabled={disabled} />
        </div>
      ) : null}
      {!items.length && closer.pending ? (
        <span ref={anchorRef} tabIndex={-1} className={styles.anchor} />
      ) : null}
      {closer.toast}
    </>
  );
}
