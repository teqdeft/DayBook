'use client';
// The Still open dialog (CONTRACT 24), opened from the reminder line on Today or in the report:
// every unfinished-task suggestion, grouped by project (a ProjectLabel heading, then the rows of
// the box), footer "Close". "Add to today" only calls the parent, which adds the project's group
// or card and the line; Done already and Not needed never add a project. 560 px, a bottom sheet
// at 520 px and below (Dialog). Its help is 14 px, as the design draws it (one line at 560 px).
import { useEffect, useRef } from 'react';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import ProjectLabel from '@/components/ProjectLabel';
import { BOX_HELP, BOX_TITLE } from './CarrySuggestions';
import SuggestionRows from './SuggestionRows';
import { useSuggestionClose } from './useSuggestionClose';
import styles from './StillOpenDialog.module.css';

const NO_GROUPS = [];

/** The first button of the rows, else the dialog's Close: where focus goes when its row left. */
function focusTarget(body, close) {
  return body?.querySelector('[data-suggestion-add]:not([disabled])') ?? close;
}

/**
 * @param {{ open: boolean, onClose: () => void, groups?: Array<{ key: string,
 *   project?: { id: number, name: string, color?: string | null },
 *   request?: { id: number, name: string }, items: object[] }>,
 *   onAdd?: (groupKey: string, item: object) => void, onClosed?: (taskId: number) => void,
 *   onRestored?: (item: object, groupKey: string) => void }} props groups as they should show
 *   now (the parent drops closed and added suggestions; a group with no items is left out)
 */
export default function StillOpenDialog({
  open,
  onClose,
  groups = NO_GROUPS,
  onAdd,
  onClosed,
  onRestored,
}) {
  const bodyRef = useRef(null);
  const closeRef = useRef(null);
  const shown = groups.filter((group) => group.items?.length);
  const closer = useSuggestionClose({
    onClosed,
    // The item carries its group's key while it waits for Undo, so the parent knows where it goes.
    onRestored: ({ groupKey, ...item }) => onRestored?.(item, groupKey),
    onLeave: () => focusTarget(bodyRef.current, closeRef.current)?.focus(),
  });

  // A group's last row going away takes focus with it: keep it in the dialog.
  useEffect(() => {
    if (!open || !bodyRef.current) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    focusTarget(bodyRef.current, closeRef.current)?.focus();
  });

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        width={560}
        title={BOX_TITLE}
        description={<span className={styles.help}>{BOX_HELP}</span>}
        footer={
          <Button ref={closeRef} variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <div ref={bodyRef} className={styles.groups}>
          {shown.length === 0 ? <p className={styles.empty}>Nothing is still open. Nice.</p> : null}
          {shown.map((group) => (
            <section
              key={group.key}
              className={styles.group}
              aria-label={(group.project ?? group.request).name}
            >
              <ProjectLabel project={group.project ?? { ...group.request, color: null }} />
              <SuggestionRows
                items={group.items}
                onAdd={(item) => onAdd?.(group.key, item)}
                closer={{
                  busy: closer.busy,
                  close: (item, reason, event) =>
                    closer.close({ ...item, groupKey: group.key }, reason, event),
                }}
              />
            </section>
          ))}
        </div>
      </Dialog>
      {closer.toast}
    </>
  );
}
