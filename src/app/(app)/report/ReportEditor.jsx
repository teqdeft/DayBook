'use client';
// The Daily report body: notices, one card per project, "Add another project", "Back to today",
// and the Slack preview on the right.
import { useEffect, useRef, useState } from 'react';
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import { formatDayShort, formatDuration, formatHours } from '@/lib/time';
import ProjectCard from './ProjectCard';
import ProjectPicker from './ProjectPicker';
import RequestProjectDialog from './RequestProjectDialog';
import SlackPreview from './SlackPreview';
import { useReport } from './ReportProvider';
import { newEntry, newKey, projectKey, serialize, totalMinutes, unlinkTasks } from './reportState';
import { clearBackup, useBackup } from './reportBackup';
import styles from './ReportEditor.module.css';

const ICONS = { warning: TriangleAlert, danger: CircleAlert, info: Info };

function Notice({ tone = 'info', children, action }) {
  const Icon = ICONS[tone] ?? Info;
  return (
    <div
      className={`${styles.notice} ${styles[tone]}`}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" className={styles.noticeIcon} />
      <div className={styles.noticeText}>{children}</div>
      {action ? <div className={styles.noticeAction}>{action}</div> : null}
    </div>
  );
}

function gapNotice(data, logged, status) {
  const present = data.presentMinutes;
  if (present === null || present === undefined || logged <= 0) return null;
  if (Math.abs(present - logged) <= data.gapWarningMinutes) return null;
  const more = logged > present;
  const step = status === 'submitted' ? 'update the report' : 'submit';
  return (
    `You logged ${formatHours(logged)} but were checked in for ${more ? 'only ' : ''}` +
    `${formatDuration(present)}. Check your hours before you ${step}.`
  );
}

function sameRows(a, b) {
  return JSON.stringify(serialize(a).body) === JSON.stringify(serialize(b).body);
}

/** Rows saved in this browser for a submitted report, when they differ from what is shown. */
function useRestorable(report, entries) {
  const backup = useBackup(
    report.status === 'submitted' && report.editable ? report.id : null,
    report.revision,
  );
  return backup && !sameRows(backup, entries) ? backup : null;
}

function Notices({ onRestore }) {
  const { data, entries, report, errors, readOnly, lockedOut, stale } = useReport();
  const restorable = useRestorable(report, entries);
  const gap = readOnly ? null : gapNotice(data, totalMinutes(entries), report.status);
  const notices = [];
  if (stale) {
    notices.push(
      <Notice key="stale" tone="danger">
        This report changed somewhere else since this page loaded, so your latest changes
        weren&apos;t saved. Copy anything you need, then reload the report.
      </Notice>,
    );
  } else if (lockedOut) {
    notices.push(
      <Notice key="locked-out" tone="danger">
        This report is locked now, so your latest changes weren&apos;t saved. Copy anything you
        need, then request an edit.
      </Notice>,
    );
  } else if (readOnly && report.status !== 'none') {
    notices.push(
      <Notice key="locked">
        {report.pendingEditRequest ? data.pendingText : data.lockedText}
      </Notice>,
    );
  }
  if (!readOnly && report.unlockedUntil && data.unlockedText) {
    notices.push(<Notice key="unlocked">{data.unlockedText}</Notice>);
  }
  if (restorable) {
    notices.push(
      <Notice
        key="restore"
        tone="warning"
        action={
          <span className={styles.noticeButtons}>
            <Button variant="text" size="compact" onClick={() => onRestore(restorable)}>
              Restore them
            </Button>
            <Button variant="text" size="compact" onClick={() => clearBackup(report.id)}>
              Discard
            </Button>
          </span>
        }
      >
        You changed this report earlier without updating it.
      </Notice>,
    );
  }
  if (gap)
    notices.push(
      <Notice key="gap" tone="warning">
        {gap}
      </Notice>,
    );
  if (errors.general.length) {
    notices.push(
      <Notice key="errors" tone="danger">
        {errors.general.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </Notice>,
    );
  }
  return notices.length ? <div className={styles.notices}>{notices}</div> : null;
}

/** A day with no report after its lock. "Request an edit" sits in the top bar. */
function MissingDay() {
  const { report } = useReport();
  const day = formatDayShort(report.workDate);
  return (
    <div className={styles.emptyCard}>
      <EmptyState
        title={`No report for ${day}`}
        body={
          report.pendingEditRequest
            ? 'You asked to add it. You will get a notification when it opens.'
            : 'This day is locked. Use Request an edit to add the report.'
        }
      />
    </div>
  );
}

export default function ReportEditor() {
  const { data, entries, report, readOnly, submitting, change, updateEntry, restore } = useReport();
  const [adding, setAdding] = useState(false);
  const [requesting, setRequesting] = useState(null);
  const addRef = useRef(null);
  const addButtonRef = useRef(null);
  const focusRequestRef = useRef(null);
  // A card added from "Request a project": its first task row takes focus once the dialog has
  // closed (closing returns focus to the button that opened it first).
  const focusAfterDialogRef = useRef(null);
  const taskInputsRef = useRef(new Map());
  const used = new Set(entries.map(projectKey).filter(Boolean));

  useEffect(() => {
    const taskKey = focusAfterDialogRef.current;
    if (requesting || !taskKey) return;
    focusAfterDialogRef.current = null;
    taskInputsRef.current.get(taskKey)?.focus();
  }, [requesting]);

  function addProject(pick, { fromDialog = false } = {}) {
    const entry = newEntry(pick);
    if (fromDialog) focusAfterDialogRef.current = entry.tasks[0].key;
    else focusRequestRef.current = entry.tasks[0].key;
    change((list) => [...list, entry]);
  }

  function onPicked(pick) {
    const target = requesting?.entryKey;
    if (target && entries.some((entry) => entry.key === target)) {
      updateEntry(target, (card) => ({
        projectId: pick.projectId ?? null,
        projectRequestId: pick.projectRequestId ?? null,
        projectName: pick.name,
        projectColor: pick.color ?? null,
        isUrgent: Boolean(pick.isUrgent),
        waitingForApproval: Boolean(pick.projectRequestId),
        // Priority task links belong to the card's old project.
        tasks: projectKey(pick) === projectKey(card) ? card.tasks : unlinkTasks(card.tasks),
      }));
    } else {
      addProject(pick, { fromDialog: true });
    }
  }

  function restoreRows(rows) {
    restore(
      rows.map((entry) => ({
        ...entry,
        key: newKey('e'),
        tasks: entry.tasks.map((task) => ({ ...task, key: newKey('t') })),
      })),
    );
  }

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <Notices onRestore={restoreRows} />
        {report.status === 'none' ? <MissingDay /> : null}
        {entries.length > 0 ? (
          <div className={styles.cards} inert={submitting || undefined}>
            {entries.map((entry) => (
              <ProjectCard
                key={entry.key}
                entry={entry}
                used={used}
                focusRequestRef={focusRequestRef}
                taskInputsRef={taskInputsRef}
                disabled={submitting}
                onRequestProject={(entryKey) => setRequesting({ entryKey })}
              />
            ))}
          </div>
        ) : null}
        {readOnly && entries.length === 0 && report.status !== 'none' ? (
          <div className={styles.emptyCard}>
            <EmptyState
              title="Nothing was reported for this day"
              body="The report was saved without any projects."
            />
          </div>
        ) : null}
        {readOnly ? null : (
          <div ref={addRef} className={styles.addWrap}>
            <button
              ref={addButtonRef}
              type="button"
              className={styles.addProject}
              aria-haspopup="dialog"
              aria-expanded={adding}
              disabled={submitting}
              onClick={() => setAdding((open) => !open)}
            >
              {entries.length ? 'Add another project' : 'Add a project'}
            </button>
            {adding ? (
              <ProjectPicker
                picker={data.picker}
                used={used}
                anchorRef={addRef}
                onPick={(pick) => {
                  setAdding(false);
                  addProject(pick);
                }}
                onClose={({ focusAnchor = true } = {}) => {
                  setAdding(false);
                  if (focusAnchor) addButtonRef.current?.focus();
                }}
                onRequestProject={() => {
                  // Focus goes back to "Add another project" before the picker closes, so the
                  // dialog returns focus there when it closes.
                  addButtonRef.current?.focus();
                  setAdding(false);
                  setRequesting({ entryKey: null });
                }}
              />
            ) : null}
          </div>
        )}
        <p className={styles.back}>
          <Button variant="text" href={data.backHref}>
            {data.backLabel}
          </Button>
        </p>
      </div>
      {report.status === 'none' ? null : (
        <aside className={styles.side}>
          <SlackPreview />
        </aside>
      )}
      <RequestProjectDialog
        open={Boolean(requesting)}
        onClose={() => setRequesting(null)}
        picker={data.picker}
        onPicked={onPicked}
      />
    </div>
  );
}
