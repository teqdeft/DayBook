'use client';
// Today's to-do (CONTRACT 24): what the person will work on today, by project, written in the
// morning and found again in the evening report (its lines are today's report lines). Empty:
// "Plan your day" with Add project and Paste a list. Then one group per project (TodoGroup), the
// dashed "Add project" (the report's picker: no requests for a missing project here, projects
// already in the list greyed "In your to-do", "2 still open" beside those with suggestions) and
// the reminder line "Still open from past reports:", which opens the Still open dialog. After
// submit the card is just its header. The state is the page's (TodoProvider).
import { useId, useMemo, useRef, useState } from 'react';
import { ClipboardPaste, ListChecks, Plus } from 'lucide-react';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ProjectPicker from '../report/ProjectPicker';
import StillOpenDialog from '../report/StillOpenDialog';
import { pickerIndex, reminderItems, suggestionGroups } from '../report/reportCarry';
import { useCarrySuggestions } from '../report/useCarrySuggestions';
import TodoGroup from './TodoGroup';
import TodoHeader from './TodoHeader';
import TodoPasteDialog from './TodoPasteDialog';
import { useTodo } from './TodoProvider';
import { addedToTodayText, carryEntries, groupKey, headOfPick, isLocked } from './todoModel';
import styles from './TodoCard.module.css';

const NO_PRIORITY = {};

/** "Still open from past reports: Acme booking app (2)", opening the Still open dialog. */
function Reminder({ items, onOpen }) {
  if (!items.length) return null;
  return (
    <p className={styles.reminder}>
      Still open from past reports:
      {items.map((item) => (
        <Button
          key={item.key}
          variant="text"
          size="small"
          className={styles.reminderButton}
          aria-haspopup="dialog"
          onClick={onOpen}
        >
          {item.label}
        </Button>
      ))}
    </p>
  );
}

/** "Plan your day": the empty to-do, with its two buttons and the reminder line. */
function Empty({ addButton, onPaste, reminder }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon} aria-hidden="true">
        <ListChecks size={22} strokeWidth={1.8} />
      </span>
      <h3 className={styles.emptyTitle}>Plan your day</h3>
      <p className={styles.emptyBody}>
        Add what you&apos;ll work on today, by project. Your PM sees it, and it fills your report.
      </p>
      <div className={styles.emptyButtons}>
        {addButton}
        <Button
          variant="secondary"
          icon={<ClipboardPaste size={18} strokeWidth={1.8} aria-hidden="true" />}
          onClick={onPaste}
        >
          Paste a list
        </Button>
      </div>
      {reminder}
    </div>
  );
}

/**
 * @param {{ picker: object, priority?: Record<string, object[]>, tz: string,
 *   className?: string }} props picker: projects.getPickerFor (requests too); priority: open
 *   priority tasks by project id, offered while a task is typed
 */
export default function TodoCard({ picker, priority = NO_PRIORITY, tz, className = '' }) {
  const todo = useTodo();
  const view = todo.todo;
  const titleId = useId();
  const addProjectId = useId();
  const [picking, setPicking] = useState(false);
  const [stillOpen, setStillOpen] = useState(false);
  const [paste, setPaste] = useState(null);
  const anchorRef = useRef(null);
  const addRef = useRef(null);
  const focusRef = useRef(null);
  const locked = isLocked(view);
  const entries = useMemo(() => carryEntries(view.groups), [view.groups]);
  const carry = useCarrySuggestions(view.suggestions, entries);
  const index = useMemo(() => pickerIndex(picker), [picker]);
  const openGroups = suggestionGroups(carry.suggestions, index);
  const reminder = locked ? [] : reminderItems(openGroups, entries);
  const empty = view.groups.length === 0;

  /** The paste dialog, with text pasted into a group's "Add a task" (its key: the lines' project). */
  function openPaste(text = '', key = null) {
    setPicking(false);
    setPaste((current) => ({ text, key, round: (current?.round ?? 0) + 1 }));
  }

  function addFromDialog(key, item) {
    const group = openGroups.find((candidate) => candidate.key === key);
    if (!group) return;
    todo.addLine(group.project ? { project: group.project } : { request: group.request }, {
      title: item.title,
      status: item.status,
      carriedFromTaskId: item.taskId,
      carriedFrom: { workDate: item.workDate, dayLabel: item.dayLabel },
      added: addedToTodayText(1),
    });
  }

  const pickerPopup = picking ? (
    <ProjectPicker
      picker={picker}
      used={todo.usedKeys}
      usedLabel="In your to-do"
      openCounts={carry.counts}
      showOpenCounts
      anchorRef={anchorRef}
      className={empty ? styles.pickerCentered : ''}
      onPick={(pick) => {
        const head = headOfPick(pick);
        focusRef.current = groupKey(head);
        setPicking(false);
        todo.pick(head);
      }}
      onClose={({ focusAnchor = true } = {}) => {
        setPicking(false);
        if (focusAnchor) addRef.current?.focus();
      }}
    />
  ) : null;
  const addButtonProps = {
    ref: addRef,
    id: addProjectId,
    'aria-haspopup': 'dialog',
    'aria-expanded': picking,
    onClick: () => setPicking((open) => !open),
  };
  const reminderLine = <Reminder items={reminder} onOpen={() => setStillOpen(true)} />;

  return (
    <Card
      as="section"
      id="todo"
      padding="none"
      aria-labelledby={titleId}
      className={`${styles.card} ${className}`}
    >
      <TodoHeader
        titleId={titleId}
        todo={view}
        locked={locked}
        posting={todo.posting}
        tz={tz}
        showPaste={!empty}
        onPaste={() => openPaste()}
        onPost={todo.post}
      />
      {locked ? null : empty ? (
        <Empty
          addButton={
            <span ref={anchorRef} className={styles.pickAnchor}>
              <Button
                variant="secondary"
                icon={<Plus size={18} strokeWidth={1.8} aria-hidden="true" />}
                {...addButtonProps}
              >
                Add project
              </Button>
              {pickerPopup}
            </span>
          }
          onPaste={() => openPaste()}
          reminder={reminderLine}
        />
      ) : (
        <>
          {view.groups.map((group, position) => (
            <TodoGroup
              key={groupKey(group)}
              group={group}
              first={position === 0}
              todo={todo}
              suggestions={carry.suggestions[groupKey(group)]}
              priority={group.project ? priority[group.project.id] : undefined}
              focusRef={focusRef}
              carry={carry}
              addProjectId={addProjectId}
              onPaste={openPaste}
            />
          ))}
          <div className={styles.footer}>
            <div ref={anchorRef} className={styles.addWrap}>
              <button type="button" className={styles.addProject} {...addButtonProps}>
                <Plus size={18} strokeWidth={1.8} aria-hidden="true" />
                Add project
              </button>
              {pickerPopup}
            </div>
            {reminderLine}
          </div>
        </>
      )}
      <StillOpenDialog
        open={stillOpen && !locked}
        onClose={() => setStillOpen(false)}
        groups={openGroups}
        onAdd={addFromDialog}
        onClosed={carry.onClosed}
        onRestored={carry.onRestored}
      />
      {paste ? (
        <TodoPasteDialog
          key={paste.round}
          initialText={paste.text}
          initialKey={paste.key}
          picker={picker}
          groups={view.groups}
          suggestions={carry.suggestions}
          onAdd={todo.addLines}
          onClose={() => setPaste(null)}
        />
      ) : null}
    </Card>
  );
}
