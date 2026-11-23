'use client';
// Today's timer entries on the Working on card (CONTRACT 15): time range, project, task or note,
// duration and a menu (Edit, Delete), with "Add time" under the list. Edit and Add open
// TimerEntryDialog; Delete asks first. Time removed from a timer sits in the list in time order
// as a muted row with Put back (TimerRemovedRow, CONTRACT 25 A).
import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Menu from '@/components/Menu';
import PriorityTag from '@/components/PriorityTag';
import ProjectLabel from '@/components/ProjectLabel';
import { liveEntryMinutes } from '@/components/TimerChip.clock';
import { entryRange, shortDuration, timeline } from './timerData';
import TimerEntryDialog from './TimerEntryDialog';
import TimerRemovedRow from './TimerRemovedRow';
import styles from './TimerEntries.module.css';

/**
 * What an entry was about: its priority task (with the P1-P3 tag) and its note; `empty` when it
 * has neither. The task is what's being timed, so a long note gives way first (phones put the
 * note under it); either one cut short shows in full on hover.
 */
export function EntryText({ entry, empty = null, className = '' }) {
  const hasTask = Boolean(entry.projectTaskId && entry.projectTaskTitle);
  if (!hasTask && !entry.note) {
    return empty ? <span className={`${styles.none} ${className}`}>{empty}</span> : null;
  }
  return (
    <span className={`${styles.text} ${className}`}>
      {hasTask ? (
        <span className={styles.taskPart}>
          <PriorityTag priority={entry.priority} />
          <span className={styles.task} title={entry.projectTaskTitle}>
            {entry.projectTaskTitle}
          </span>
        </span>
      ) : null}
      {hasTask && entry.note ? (
        <span className={styles.dot} aria-hidden="true">
          ·
        </span>
      ) : null}
      {entry.note ? (
        <span className={styles.note} title={entry.note}>
          {entry.note}
        </span>
      ) : null}
    </span>
  );
}

/** One entry's row: range, project, task or note, minutes and its menu. */
function EntryRow({ entry, serverMs, busy, onEdit, onRemove }) {
  const range = entryRange(entry);
  return (
    <li className={styles.row}>
      <span className={styles.range}>{range}</span>
      <span className={styles.project}>
        <ProjectLabel project={{ name: entry.projectName, color: entry.projectColor }} />
      </span>
      <EntryText entry={entry} className={styles.what} />
      <span className={styles.minutes}>{shortDuration(liveEntryMinutes(entry, serverMs))}</span>
      <Menu
        label={`Change ${entry.projectName} ${range}`}
        className={styles.menu}
        width={160}
        items={[
          { label: 'Edit', onSelect: () => onEdit(entry), disabled: busy },
          { label: 'Delete', tone: 'danger', onSelect: () => onRemove(entry), disabled: busy },
        ]}
      />
    </li>
  );
}

/**
 * @param {{ entries: object[], removed?: object[], serverMs: number, busy: boolean,
 *   deleting: boolean, puttingBack?: number | null, picker: object,
 *   tasks: Record<string, object[]>, addDefaults: () => object,
 *   onSave: (entry: object | null, body: object) => Promise<object | null>,
 *   onDelete: (entry: object) => Promise<object | null>,
 *   onPutBack?: (item: object) => Promise<object | null> }} props
 *   addDefaults: the From/To an Add time dialog starts with; removed: today's away breaks
 *   (state.removed); puttingBack: the break id being put back
 */
export default function TimerEntries({
  entries,
  removed = [],
  serverMs,
  busy,
  deleting,
  puttingBack = null,
  picker,
  tasks,
  addDefaults,
  onSave,
  onDelete,
  onPutBack,
}) {
  // null, { entry: null } (Add time) or { entry } (Edit).
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const addRef = useRef(null);

  async function confirmDelete() {
    const done = await onDelete(removing);
    if (!done) return;
    setRemoving(null);
    // The row (and its menu button) is gone: focus moves to Add time.
    requestAnimationFrame(() => addRef.current?.focus());
  }

  async function putBack(item) {
    const done = await onPutBack?.(item);
    // The row (and its button) is gone: focus moves to Add time.
    if (done) requestAnimationFrame(() => addRef.current?.focus());
  }

  const rows = timeline(entries, removed);

  return (
    <div className={styles.entries}>
      <h3 className={styles.heading}>Today&apos;s time</h3>
      {rows.length === 0 ? (
        <p className={styles.empty}>No time tracked yet today.</p>
      ) : (
        <ul className={styles.list} aria-label="Today's time">
          {rows.map((row) =>
            row.kind === 'removed' ? (
              <TimerRemovedRow
                key={`removed-${row.item.breakId}`}
                item={row.item}
                busy={busy}
                loading={puttingBack === row.item.breakId}
                onPutBack={putBack}
              />
            ) : (
              <EntryRow
                key={row.entry.id}
                entry={row.entry}
                serverMs={serverMs}
                busy={busy}
                onEdit={(entry) => setEditing({ entry })}
                onRemove={setRemoving}
              />
            ),
          )}
        </ul>
      )}
      <div className={styles.footer}>
        <Button
          ref={addRef}
          variant="text"
          size="compact"
          icon={<Plus size={18} strokeWidth={1.8} aria-hidden="true" />}
          onClick={() => setEditing({ entry: null })}
          disabled={busy}
        >
          Add time
        </Button>
      </div>
      {editing ? (
        <TimerEntryDialog
          key={editing.entry?.id ?? 'new'}
          entry={editing.entry}
          picker={picker}
          tasks={tasks}
          defaults={editing.entry ? null : addDefaults()}
          onClose={() => setEditing(null)}
          onSave={onSave}
        />
      ) : null}
      <Dialog
        open={Boolean(removing)}
        onClose={() => (deleting ? null : setRemoving(null))}
        title="Delete this time?"
        description={
          removing
            ? `${removing.projectName}, ${entryRange(removing)} (${shortDuration(
                liveEntryMinutes(removing, serverMs),
              )}). It comes off today's timers.`
            : null
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setRemoving(null)}
              disabled={deleting}
              data-autofocus
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} loading={deleting}>
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}
