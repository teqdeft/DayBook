'use client';
// The task window's footer for each mode (CONTRACT 27, Task window). Manage (the project's PM and
// Admins on a project page): Delete with the board's Undo, Edit (the window closes first), Mark
// done with "Marked done." and its Undo, or the green Done tag and Reopen. Today: "Open project"
// and the to-do card's own "Add to to-do" ("In to-do" when a line links the task). A member on the
// project page: "Add to to-do" through the to-do API, while today's to-do takes lines. Another PM:
// no footer. Busy buttons keep the focus (BusyButton), and the control that takes a pressed one's
// place (Reopen for Mark done, "In to-do" for Add to to-do) gets it, so focus stays in the window.
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import Button from '@/components/Button';
import Tag from '@/components/Tag';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import BusyButton from '@/app/(app)/projects/[id]/BusyButton';
import { useTaskUndo } from '@/app/(app)/projects/[id]/TaskUndoProvider';
import { useTaskEditor } from '@/app/(app)/projects/[id]/_board/TaskEditorProvider';
import { footerFor, projectTaskHref } from './taskWindowView';
import { forgetTaskDetails } from './useTaskDetails';
import styles from './TaskWindow.module.css';

const checkIcon = <Check size={16} strokeWidth={1.8} aria-hidden="true" />;

/**
 * A ref for the control drawn in place of the pressed one: when `shown` changes and the pressed
 * control took the focus with it (it fell to the page), the new one takes it.
 */
function useFocusOnSwap(shown) {
  const ref = useRef(null);
  const before = useRef(shown);
  useEffect(() => {
    if (before.current === shown) return;
    before.current = shown;
    const lost = !document.activeElement || document.activeElement === document.body;
    if (lost) ref.current?.focus({ preventScroll: true });
  }, [shown]);
  return ref;
}

function InTodo({ ref }) {
  return (
    <span ref={ref} tabIndex={-1} className={styles.inTodo}>
      <Check size={14} strokeWidth={1.8} aria-hidden="true" />
      In to-do
    </span>
  );
}

/**
 * "Add to to-do": Today's card adds the line itself; elsewhere the to-do API. A report that went
 * in meanwhile (REPORT_LOCKED) takes the button away, and focus goes to the window.
 */
function TodoButton({ task, todo }) {
  const toast = useToast();
  const [added, setAdded] = useState(false);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const inTodo = added || Boolean(todo?.has(task.id));
  const ref = useFocusOnSwap(inTodo);
  if (inTodo) return <InTodo ref={ref} />;
  if (locked || (todo && !todo.add)) return null; // the report is in: no more lines

  async function add(event) {
    if (todo) {
      todo.add(task);
      return;
    }
    const panel = event.currentTarget.closest('[role="dialog"]');
    setBusy(true);
    try {
      const { data } = await api.post('/api/me/todo/lines', {
        projectId: task.projectId,
        title: task.title,
        projectTaskId: task.id,
      });
      toast({ title: data?.added === false ? 'Already in your to-do.' : 'Added to your to-do.' });
      setAdded(true);
    } catch (error) {
      toast({ title: "Couldn't add it to your to-do", body: error.message, tone: 'error' });
      if (error.code === 'REPORT_LOCKED') {
        setLocked(true);
        requestAnimationFrame(() => panel?.focus({ preventScroll: true }));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <BusyButton
      variant="secondary"
      busy={busy}
      icon={<Plus size={16} strokeWidth={1.8} aria-hidden="true" />}
      onClick={add}
    >
      Add to to-do
    </BusyButton>
  );
}

/** Mark done (with Undo in the page's toast) and Reopen. */
function useStatus(task) {
  const router = useRouter();
  const toast = useToast();
  const offerUndo = useTaskUndo();
  const [busy, startTransition] = useTransition();

  function change(status) {
    startTransition(async () => {
      try {
        await api.post(`/api/project-tasks/${task.id}/status`, { status });
        forgetTaskDetails(task.id);
        if (status === 'done') offerUndo?.({ taskId: task.id });
        else toast({ title: 'Reopened.' });
        startTransition(() => router.refresh());
      } catch (error) {
        toast({ title: "Couldn't change the task", body: error.message, tone: 'error' });
      }
    });
  }
  return [busy, change];
}

/** Mark done, or the green Done tag and Reopen; the one drawn after a press takes the focus. */
function StatusButtons({ task, done }) {
  const [busy, change] = useStatus(task);
  const swapRef = useFocusOnSwap(done);
  if (!done) {
    return (
      <BusyButton
        ref={swapRef}
        className={styles.main}
        busy={busy}
        icon={checkIcon}
        onClick={() => change('done')}
      >
        Mark done
      </BusyButton>
    );
  }
  return (
    <>
      <Tag tone="green" size="md" className={styles.doneTag}>
        {checkIcon}
        Done
      </Tag>
      <BusyButton ref={swapRef} variant="secondary" busy={busy} onClick={() => change('open')}>
        Reopen
      </BusyButton>
    </>
  );
}

function ManageFooter({ task, done, onClose }) {
  const editor = useTaskEditor();
  return (
    <>
      <Button
        variant="danger"
        className={styles.delete}
        icon={<Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />}
        onClick={(event) => {
          editor.remove(task, { keyboard: event.detail === 0 });
          onClose();
        }}
      >
        Delete
      </Button>
      <Button
        variant="secondary"
        className={styles.edit}
        icon={<Pencil size={16} strokeWidth={1.8} aria-hidden="true" />}
        onClick={() => {
          onClose({ restore: false });
          editor.openEdit(task);
        }}
      >
        Edit
      </Button>
      <StatusButtons task={task} done={done} />
    </>
  );
}

/**
 * @param {{ task: object, mode: string, todo?: object | null, todoOpen?: boolean,
 *   onClose: (opts?: { restore?: boolean }) => void }} props todo: Today's to-do card
 *   (`{ has(taskId), add(task) | null }`, add null once the report is in), only in `today` mode;
 *   todoOpen: on the member's project page, today's to-do takes lines (`head.todoOpen`)
 * @returns {import('react').ReactNode | null} null when the mode has no footer
 */
export function useTaskWindowFooter({ task, mode, todo, todoOpen = false, onClose }) {
  const editor = useTaskEditor();
  const footer = footerFor({
    mode,
    task,
    hasEditor: Boolean(editor),
    hasTodo: Boolean(todo),
    todoOpen,
  });
  if (footer.kind === 'manage') {
    return <ManageFooter task={task} done={footer.done} onClose={onClose} />;
  }
  if (footer.kind === 'none') return null;
  const openProject =
    footer.kind === 'today' ? (
      <Button variant="text" size="compact" className={styles.left} href={projectTaskHref(task)}>
        Open project
      </Button>
    ) : null;
  if (!openProject && !footer.todo) return null;
  return (
    <>
      {openProject}
      {footer.todo ? <TodoButton task={task} todo={todo} /> : null}
    </>
  );
}
