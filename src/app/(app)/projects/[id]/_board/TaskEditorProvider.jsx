'use client';
// The New task and Edit task window for the whole project page (CONTRACT 27, Board tab), mounted by
// ProjectView for the project's PM and Admins around every tab, so "+ New task" in the header, the
// Board's cards and the task window all open the same one. It also holds Delete with Undo for tasks
// ("Task deleted."): the card hides at once and the DELETE goes after the toast. After a save it
// toasts who was told, refreshes the page and tells the Board which card to highlight.
import { createContext, useContext, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
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
 *   isHidden: (taskId: number) => boolean }} null outside a TaskEditorProvider (another PM, a
 *   member)
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

/**
 * The editor the context hands out (useTaskEditor), and the Undo toast of its deletes.
 * @param {(form: object | null) => void} setForm opens the window (a fresh key each time)
 * @param {{ current: number }} counterRef the provider's one counter, for the keys
 */
function useEditor(setForm, counterRef) {
  const { remove: removeLater, isHidden: hiddenKey, toast: undoToast } = useUndoDelete();
  const editor = useMemo(() => {
    const next = () => {
      counterRef.current += 1;
      return counterRef.current;
    };
    return {
      openNew(preset = {}) {
        setForm({ key: next(), mode: 'new', preset });
      },
      openEdit(taskOrId) {
        const task = taskOrId && typeof taskOrId === 'object' ? taskOrId : null;
        setForm({ key: next(), mode: 'edit', taskId: Number(task?.id ?? taskOrId), task });
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
    };
  }, [removeLater, hiddenKey, setForm, counterRef]);
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

/**
 * @param {{ projectId: number, options: object[], plan: object,
 *   limits: { maxFileBytes: number, maxTaskFiles: number, pickMax: number },
 *   viewerId?: number | null, storageReady?: boolean, children: import('react').ReactNode }}
 *   props options: `head.options` (listAssigneeOptions); limits: `head.limits`; viewerId: the
 *   signed-in person, listed as "Riya Kapoor (you)"; storageReady: `head.storageReady` (the
 *   Files field's "File storage isn't set up yet.")
 */
export function TaskEditorProvider({
  projectId,
  options,
  plan,
  limits,
  viewerId,
  storageReady = true,
  children,
}) {
  const [form, setForm] = useState(null);
  const counterRef = useRef(0);
  const { editor, undoToast } = useEditor(setForm, counterRef);
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
            options={options}
            limits={limits}
            storageReady={storageReady}
            viewerId={viewerId ?? null}
            onClose={() => setForm(null)}
            onSaved={onSaved}
            onDelete={(task, opts) => {
              setForm(null);
              editor.remove(task, opts);
            }}
          />
        ) : null}
        {undoToast}
      </SavedContext.Provider>
    </EditorContext.Provider>
  );
}
