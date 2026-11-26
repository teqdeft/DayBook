'use client';
// Removing a file with Undo (CONTRACT 27, "Soft delete for Undo"; CONTRACT 28, Task window), over
// the project page's useUndoDelete: the file hides at once and a 6 s toast offers Undo. An own task
// file ("File removed." in the task window, "File deleted." in the Files tab) goes with
// `DELETE /api/project-files/[id]`; a linked project file leaves only that task ("Removed from this
// task. It stays in Files.") with `DELETE /api/project-tasks/[id]/links/[fileId]`. The request goes
// when the toast ends, when another delete takes the toast, when the component goes away or on
// pagehide (with keepalive). Undo never reaches the server. The task's details are dropped from
// memory so the next task window loads its files again.
import { useCallback, useMemo } from 'react';
import { useUndoDelete } from '@/app/(app)/projects/[id]/useUndoDelete';
import { forgetTaskDetails } from '@/components/task/useTaskDetails';

export const UNLINKED_LABEL = 'Removed from this task. It stays in Files.';

const keyOf = (id) => `file:${id}`;
const linkKeyOf = (taskId, fileId) => `link:${taskId}:${fileId}`;

/**
 * @returns {{ remove: (file: { id: number, taskId?: number | null }, opts?: { label?: string,
 *   keyboard?: boolean, returnFocus?: () => HTMLElement | null }) => void,
 *   unlink: (file: { id: number }, task: { id: number }, opts?: { keyboard?: boolean,
 *   returnFocus?: () => HTMLElement | null }) => void,
 *   isHidden: (id: number) => boolean, isLinkHidden: (taskId: number, fileId: number) => boolean,
 *   toast: import('react').ReactElement }} render `toast` once in the component; label: the
 *   toast's words ('File removed.' by default); keyboard: the X was pressed from the keyboard,
 *   so the toast takes focus; returnFocus: where focus goes after Undo, Tab or Escape
 */
export function useFileRemoval() {
  const { remove: hold, isHidden: hidden, toast } = useUndoDelete();

  const remove = useCallback(
    (file, { label = 'File removed.', keyboard = false, returnFocus } = {}) => {
      if (file.taskId) forgetTaskDetails(file.taskId);
      hold({
        key: keyOf(file.id),
        url: `/api/project-files/${file.id}`,
        label,
        failTitle: "Couldn't remove the file",
        keyboard,
        returnFocus,
      });
    },
    [hold],
  );

  const unlink = useCallback(
    (file, task, { keyboard = false, returnFocus } = {}) => {
      forgetTaskDetails(task.id);
      hold({
        key: linkKeyOf(task.id, file.id),
        url: `/api/project-tasks/${task.id}/links/${file.id}`,
        label: UNLINKED_LABEL,
        failTitle: "Couldn't remove the file",
        keyboard,
        returnFocus,
      });
    },
    [hold],
  );

  const isHidden = useCallback((id) => hidden(keyOf(id)), [hidden]);
  const isLinkHidden = useCallback((taskId, fileId) => hidden(linkKeyOf(taskId, fileId)), [hidden]);

  return useMemo(
    () => ({ remove, unlink, isHidden, isLinkHidden, toast }),
    [remove, unlink, isHidden, isLinkHidden, toast],
  );
}
