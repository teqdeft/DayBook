'use client';
// The New task and Edit task window for the whole project page (CONTRACT 27, Board tab; CONTRACT
// 28, New task and Edit task), mounted by ProjectView for the project's PM and Admins around every
// tab, so the toolbar's "Add task", a column's "+", the header's "+ New task", the cards and the
// task window all open the same one. `useTaskEditor()` also hands out the people a task can be for
// (`options`) and who is signed in (`viewerId`). It holds Delete with Undo for tasks ("Task
// deleted."): the card hides at once and the DELETE goes after the toast. After a save it toasts
// who was told, refreshes the page and tells the Board which card was saved.
import { createContext, useContext, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { DUR } from '@/lib/motion/tokens';
import { useUndoDelete } from '../useUndoDelete';
import { cardTitleId } from './boardView';
import TaskFormDialog from './TaskFormDialog';

const EditorContext = createContext(null);
const SavedContext = createContext(null);

/**
 * @returns {null | { openNew: (preset?: { phase?: string, title?: string }) => void,
 *   openEdit: (taskOrId: object | number) => void,
 *   remove: (task: object, opts?: { keyboard?: boolean,
 *     returnFocus?: () => HTMLElement | null }) => void,
 *   isHidden: (taskId: number) => boolean, options: object[], viewerId: number | null }} null
 *   outside a TaskEditorProvider (another PM, a member); options: `head.options`
 *   (AssigneeOption[]); viewerId: who is signed in
 */
export function useTaskEditor() {
  return useContext(EditorContext);
}

/**
 * The task saved last, for the Board's highlight and focus.
 * @returns {null | { id: number, key: number, edited: boolean }}
 */
export function useSavedTask() {
  return useContext(SavedContext);
}

const taskKey = (taskId) => `task:${taskId}`;
const EMPTY = [];

/**
 * The editor the context hands out (useTaskEditor), and the Undo toast of its deletes.
 * @param {(form: object | null) => void} setForm opens the window (a fresh key each time)
 * @param {{ current: number }} counterRef the provider's one counter, for the keys
 */
function useEditor(setForm, counterRef, { options, viewerId }) {
  const { remove: removeLater, isHidden: hiddenKey, toast: undoToast } = useUndoDelete();
  const editor = useMemo(() => {
    const next = () => {
      counterRef.current += 1;
      return counterRef.current;
    };
    return {
      openNew(preset = {}) {
        setForm({ key: next(), mode: 'new', preset, open: true });
      },
      openEdit(taskOrId) {
        const task = taskOrId && typeof taskOrId === 'object' ? taskOrId : null;
        const taskId = Number(task?.id ?? taskOrId);
        setForm({ key: next(), mode: 'edit', taskId, task, open: true });
      },
      remove(task, { keyboard = false, returnFocus } = {}) {
        removeLater({
          key: taskKey(task.id),
          url: `/api/project-tasks/${task.id}`,
          label: 'Task deleted.',
          failTitle: "Couldn't delete the task",
          keyboard,
          returnFocus: returnFocus ?? (() => document.getElementById(cardTitleId(task.id))),
        });
      },
      isHidden: (taskId) => hiddenKey(taskKey(taskId)),
      options,
      viewerId,
    };
  }, [removeLater, hiddenKey, setForm, counterRef, options, viewerId]);
  return { editor, undoToast };
}

/**
 * After a save: the toast, the task to highlight (a fresh key each time) and a page refresh.
 * @param {{ current: number }} counterRef the provider's one counter, for the keys
 */
function useSaved(counterRef) {
  const router = useRouter();
  const toast = useToast();
  const [, startRefresh] = useTransition();
  const [saved, setSaved] = useState(null);
  function onSaved({ id, edited, toast: words }) {
    toast(words);
    counterRef.current += 1;
    setSaved({ id, key: counterRef.current, edited });
    startRefresh(() => router.refresh());
  }
  return { saved, onSaved };
}

/** The open window (`open` false while its exit plays, then gone unless another one opened). */
function useFormState() {
  const [form, setForm] = useState(null);
  const closeForm = () => {
    setForm((now) => (now ? { ...now, open: false } : now));
    setTimeout(() => setForm((now) => (now && !now.open ? null : now)), DUR.out + 60);
  };
  return [form, setForm, closeForm];
}

/**
 * The project's PM for the share confirm: the `project` given, else read from the options (the
 * PM's row, else the viewer's own when the viewer is the PM).
 */
export function projectOf(project, { projectId, options = [], viewerId = null }) {
  if (project?.pmId !== undefined && project?.pmId !== null) return project;
  const pm = options.find((option) => option.kind === 'pm');
  const me = options.find(
    (option) => option.kind === 'me' || Number(option.id) === Number(viewerId),
  );
  const pmId = pm?.id ?? (me?.role === 'pm' ? me.id : null);
  return { id: Number(project?.id ?? projectId), pmId: pmId === null ? null : Number(pmId) };
}

/**
 * @param {{ projectId: number, options: object[], plan: object,
 *   limits: { maxFileBytes: number, maxTaskFiles: number, pickMax: number },
 *   viewerId?: number | null, storageReady?: boolean,
 *   project?: { id: number, pmId: number | null }, children: import('react').ReactNode }}
 *   props options: `head.options` (listAssigneeOptions, AssigneeOption[]); limits:
 *   `head.limits`; viewerId: the signed-in person, listed as "Me (Riya Kapoor)"; storageReady:
 *   `head.storageReady` (the Files field's "File storage isn't set up yet."); project: the
 *   project's id and PM (`head.project.pmId`), for the share confirm
 */
export function TaskEditorProvider({
  projectId,
  options,
  plan,
  limits,
  viewerId,
  storageReady = true,
  project,
  children,
}) {
  const [form, setForm, closeForm] = useFormState();
  const counterRef = useRef(0);
  const people = options ?? EMPTY;
  const { editor, undoToast } = useEditor(setForm, counterRef, {
    options: people,
    viewerId: viewerId ?? null,
  });
  const where = projectOf(project, { projectId, options: people, viewerId: viewerId ?? null });
  const { saved, onSaved } = useSaved(counterRef);
  return (
    <EditorContext.Provider value={editor}>
      <SavedContext.Provider value={saved}>
        {children}
        {form ? (
          <TaskFormDialog
            key={form.key}
            form={form}
            projectId={projectId}
            plan={plan}
            options={people}
            limits={limits}
            storageReady={storageReady}
            viewerId={viewerId ?? null}
            project={where}
            onClose={closeForm}
            onSaved={onSaved}
            onDelete={(task, opts) => {
              closeForm();
              editor.remove(task, opts);
            }}
          />
        ) : null}
        {undoToast}
      </SavedContext.Provider>
    </EditorContext.Provider>
  );
}
