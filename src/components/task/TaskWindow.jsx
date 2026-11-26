'use client';
// The task window (CONTRACT 27 and 28, Task window): a centred 720 px window, at most 90% high with
// its own scroll (a full-screen sheet on a phone), over the page: "#8", the project and phase over
// the title (focused on open); then two columns, the note, Files, Updates and Latest report at the
// left and the rail of facts at the right (one column with the facts first below a 720 px window);
// then the footer for each mode. It loads `GET /api/project-tasks/[id]` when it opens (a skeleton
// meanwhile; the card's title shows at once when the opener passed it). A task the viewer can't
// open, or a task of another project on a project page, shows "This task isn't available." with
// Close. Escape closes the innermost thing (the picture viewer, the picker, a menu first) and focus
// returns to what opened it. It plays the windows' entrance and exit as Dialog does (CONTRACT 28,
// Motion: Dialog.module.css's keyframes, `windowMarks`); one opened by `?task=` (`instant`) shows
// without its entrance.
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import Button from '@/components/Button';
import Skeleton from '@/components/Skeleton';
import { useIsClient, useModal } from '@/components/useModal';
import dialogStyles from '@/components/Dialog.module.css';
import { usePresence, windowMarks } from '@/lib/motion/presence';
import { DUR } from '@/lib/motion/tokens';
import { useTaskEditor } from '@/app/(app)/projects/[id]/_board/TaskEditorProvider';
import { TaskContext, TaskNote } from './TaskWindowParts';
import TaskWindowFiles from './TaskWindowFiles';
import { useTaskWindowFooter } from './TaskWindowFooter';
import TaskWindowRail from './TaskWindowRail';
import { TaskLatest, TaskUpdates } from './TaskUpdates';
import { localDay, railFacts, returnTarget, windowProblem } from './taskWindowView';
import { useTaskDetails } from './useTaskDetails';
import { useWindowActions } from './useWindowActions';
import styles from './TaskWindow.module.css';

function CloseButton({ onClose }) {
  return (
    <button
      type="button"
      className={`${dialogStyles.close} ${styles.close}`}
      onClick={() => onClose()}
      aria-label="Close"
    >
      <X size={18} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

/**
 * Focus for a part that replaces the loading one: the title, or Close on a problem. Only when the
 * loading part took the focus with it (it fell back to the page); the window's first focus goes
 * through `data-autofocus`, after useModal has noted the opener.
 */
function useFocusWhenShown() {
  const ref = useRef(null);
  useEffect(() => {
    const lost = !document.activeElement || document.activeElement === document.body;
    if (ref.current && lost) ref.current.focus({ preventScroll: true });
  }, []);
  return ref;
}

/** "#8", the project and phase, the title (focused) and Close. */
function Header({ task, ids, currentPhase, onClose }) {
  const titleRef = useFocusWhenShown();
  return (
    <div className={dialogStyles.header}>
      <div className={styles.headText}>
        <TaskContext task={task} currentPhase={currentPhase} />
        <h2 ref={titleRef} id={ids.title} className={styles.title} tabIndex={-1} data-autofocus>
          {task.title}
        </h2>
      </div>
      <CloseButton onClose={onClose} />
    </div>
  );
}

/** The loaded task: header, the two columns, footer. */
function Loaded({ task: loaded, ids, props, today, onClose }) {
  const editor = useTaskEditor();
  const act = useWindowActions(loaded, { loading: props.loading });
  const task = act.task;
  const viewerId = props.viewerId ?? editor?.viewerId ?? null;
  const facts = railFacts(task, { mode: props.mode, viewerId, canAct: act.canAct });
  const footer = useTaskWindowFooter({
    task,
    mode: props.mode,
    todo: props.todo,
    todoOpen: props.todoOpen,
    onClose,
  });
  return (
    <>
      <Header task={task} ids={ids} currentPhase={props.currentPhase} onClose={onClose} />
      <div className={dialogStyles.body} data-modal-body>
        <div className={styles.columns}>
          <div className={styles.mainColumn}>
            <TaskNote task={task} headingId={ids.note} />
            <TaskWindowFiles
              task={task}
              mode={props.mode}
              headingId={ids.files}
              removal={props.removal}
              onCloseWindow={onClose}
            />
            <TaskUpdates task={task} headingId={ids.updates} />
            <TaskLatest task={task} headingId={ids.report} />
          </div>
          <TaskWindowRail
            task={task}
            facts={facts}
            today={today}
            faceRef={act.faceRef}
            onPeople={act.people}
            onTake={act.take}
            onMove={act.move}
          />
        </div>
      </div>
      {footer ? <div className={dialogStyles.footer}>{footer}</div> : null}
    </>
  );
}

/** While it loads: the title when the opener knew it, then three lines. */
function Loading({ title, ids, onClose }) {
  return (
    <>
      <div className={dialogStyles.header}>
        <div className={styles.headText}>
          <h2 id={ids.title} className={styles.title} tabIndex={-1} data-autofocus>
            {title ?? <Skeleton width={260} height={22} />}
            {title ? null : <span className="visually-hidden">Task</span>}
          </h2>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <div className={dialogStyles.body} data-modal-body aria-busy="true">
        <div className={styles.loading}>
          <Skeleton width="70%" height={16} />
          <Skeleton width="90%" height={16} />
          <Skeleton width="55%" height={16} />
        </div>
      </div>
    </>
  );
}

/** "This task isn't available." (or the API's words, with Try again) and Close. */
function Problem({ problem, ids, onClose, onRetry }) {
  const closeRef = useFocusWhenShown();
  return (
    <>
      <div className={dialogStyles.header}>
        <span />
        <CloseButton onClose={onClose} />
      </div>
      <div className={dialogStyles.body} data-modal-body>
        <p id={ids.title} className={styles.problem}>
          {problem.message}
        </p>
      </div>
      <div className={dialogStyles.footer}>
        {problem.retry ? (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
        <Button ref={closeRef} variant="secondary" data-autofocus onClick={() => onClose()}>
          Close
        </Button>
      </div>
    </>
  );
}

/** The ids the window's parts label themselves with. */
function useWindowIds() {
  const base = useId();
  return {
    title: `${base}-title`,
    note: `${base}-note`,
    files: `${base}-files`,
    updates: `${base}-updates`,
    report: `${base}-report`,
  };
}

/** The part for where the load stands: a problem, the loaded task, or the loading one. */
function windowContent({ details, props, ids, today, onClose }) {
  const { task, error } = details;
  const problem = windowProblem({ error, task, projectId: props.projectId });
  if (problem) {
    return <Problem problem={problem} ids={ids} onClose={onClose} onRetry={details.reload} />;
  }
  if (task) {
    const shown = { ...props, loading: details.loading };
    return <Loaded task={task} ids={ids} props={shown} today={today} onClose={onClose} />;
  }
  return <Loading title={props.title} ids={ids} onClose={onClose} />;
}

/**
 * Closes; focus goes back to the opener unless the next window takes it (Edit), or to what took
 * its place when the opener left the page meanwhile (a card marked done here is drawn again).
 */
function useClose({ onClose, origin, returnFocus }) {
  return function close({ restore = true } = {}) {
    onClose();
    if (!restore) return;
    requestAnimationFrame(() => {
      if (document.querySelector('[data-dialog-root]:not([data-closing])')) return;
      returnTarget(origin, returnFocus)?.focus();
    });
  };
}

/**
 * @param {{ taskId: number | null, open: boolean, onClose: () => void,
 *   mode: 'manage' | 'team' | 'member' | 'today' | 'mine', origin?: HTMLElement | null,
 *   returnFocus?: (() => HTMLElement | null) | null, title?: string | null,
 *   projectId?: number | null, currentPhase?: string | null, today?: string,
 *   todo?: object | null, todoOpen?: boolean, removal?: object | null,
 *   viewerId?: number | null, instant?: boolean }} props origin: where focus returns on close;
 *   returnFocus: where it returns when the origin has left the page; title: shown while it
 *   loads; projectId: the page's project; viewerId: the signed-in person ("(you)", Assign to me);
 *   instant: opened by a link (`?task=`), so no entrance; the rest come from TaskWindowProvider.
 *   Kept rendered with `open` false while its exit plays.
 */
export default function TaskWindow(props) {
  const { taskId, open, origin, returnFocus } = props;
  const isClient = useIsClient();
  const panelRef = useRef(null);
  const ids = useWindowIds();
  const presence = usePresence(open && isClient, DUR.out);
  const details = useTaskDetails(presence.rendered ? taskId : null);
  const [browserDay] = useState(() => localDay(new Date()));
  const today = props.today ?? browserDay;
  const close = useClose({ onClose: props.onClose, origin, returnFocus });

  useModal({ open: open && isClient, onClose: close, panelRef });
  if (!presence.rendered || !isClient) return null;

  const content = windowContent({ details, props, ids, today, onClose: close });
  return createPortal(
    <div
      className={dialogStyles.root}
      data-dialog-root
      {...windowMarks(presence.closing, Boolean(props.instant))}
    >
      <div className={dialogStyles.overlay} onClick={() => close()} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ids.title}
        tabIndex={-1}
        className={`${dialogStyles.panel} ${styles.panel}`}
        style={{ '--dialog-w': '720px' }}
        onAnimationEnd={presence.onAnimationEnd}
      >
        {content}
      </div>
    </div>,
    document.body,
  );
}
