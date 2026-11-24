'use client';
// The task window (CONTRACT 27, Task window): a centred 640 px window (a full-screen sheet on a
// phone) over the page, with the project and phase, the title (focused on open), the facts, the
// note, the files, the latest report and the footer for each mode. It loads
// `GET /api/project-tasks/[id]` when it opens (a skeleton meanwhile; the card's title shows at
// once when the opener passed it). A task the viewer can't open, or a task of another project on
// a project page, shows "This task isn't available." with Close. Escape closes the innermost
// thing (the picture viewer first) and focus returns to what opened it.
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import Button from '@/components/Button';
import Skeleton from '@/components/Skeleton';
import { useIsClient, useModal } from '@/components/useModal';
import dialogStyles from '@/components/Dialog.module.css';
import { TaskContext, TaskFacts, TaskNote, TaskReport } from './TaskWindowParts';
import TaskWindowFiles from './TaskWindowFiles';
import { useTaskWindowFooter } from './TaskWindowFooter';
import { localDay, returnTarget, windowProblem } from './taskWindowView';
import { useTaskDetails } from './useTaskDetails';
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

/** The loaded task: header, facts, note, files, report, footer. */
function Loaded({ task, ids, props, today, onClose }) {
  const titleRef = useFocusWhenShown();
  const footer = useTaskWindowFooter({
    task,
    mode: props.mode,
    todo: props.todo,
    todoOpen: props.todoOpen,
    onClose,
  });
  return (
    <>
      <div className={dialogStyles.header}>
        <div className={styles.headText}>
          <TaskContext task={task} currentPhase={props.currentPhase} />
          <h2 ref={titleRef} id={ids.title} className={styles.title} tabIndex={-1} data-autofocus>
            {task.title}
          </h2>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <div className={dialogStyles.body} data-modal-body>
        <TaskFacts task={task} today={today} />
        <TaskNote task={task} headingId={ids.note} />
        <TaskWindowFiles
          task={task}
          mode={props.mode}
          headingId={ids.files}
          removal={props.removal}
        />
        <TaskReport task={task} today={today} headingId={ids.report} />
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
  if (task) return <Loaded task={task} ids={ids} props={props} today={today} onClose={onClose} />;
  return <Loading title={props.title} ids={ids} onClose={onClose} />;
}

/**
 * @param {{ taskId: number | null, open: boolean, onClose: () => void,
 *   mode: 'manage' | 'team' | 'member' | 'today', origin?: HTMLElement | null,
 *   returnFocus?: (() => HTMLElement | null) | null, title?: string | null,
 *   projectId?: number | null, currentPhase?: string | null, today?: string,
 *   todo?: object | null, todoOpen?: boolean, removal?: object | null }} props origin: where
 *   focus returns on close; returnFocus: where it returns when the origin has left the page;
 *   title: shown while it loads; projectId: the page's project; the rest come from
 *   TaskWindowProvider
 */
export default function TaskWindow(props) {
  const { taskId, open, onClose, origin, returnFocus } = props;
  const isClient = useIsClient();
  const panelRef = useRef(null);
  const ids = useWindowIds();
  const details = useTaskDetails(open ? taskId : null);
  const [browserDay] = useState(() => localDay(new Date()));
  const today = props.today ?? browserDay;

  /**
   * Closes; focus goes back to the opener unless the next window takes it (Edit), or to what took
   * its place when the opener left the page meanwhile (a card marked done here is drawn again).
   */
  function close({ restore = true } = {}) {
    onClose();
    if (!restore) return;
    requestAnimationFrame(() => {
      if (document.querySelector('[data-dialog-root]')) return;
      returnTarget(origin, returnFocus)?.focus();
    });
  }

  useModal({ open: open && isClient, onClose: close, panelRef });
  if (!open || !isClient) return null;

  const content = windowContent({ details, props, ids, today, onClose: close });
  return createPortal(
    <div className={dialogStyles.root} data-dialog-root>
      <div className={dialogStyles.overlay} onClick={() => close()} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ids.title}
        tabIndex={-1}
        className={`${dialogStyles.panel} ${styles.panel}`}
        style={{ '--dialog-w': '640px' }}
      >
        {content}
      </div>
    </div>,
    document.body,
  );
}
