'use client';
// Removing a file with Undo (CONTRACT 27, "Soft delete for Undo"), over the project page's
// useUndoDelete: the file hides at once and a 6 s toast offers Undo ("File removed." in the task
// window, "File deleted." in the Files tab); the `DELETE /api/project-files/[id]` goes when the
// toast ends, when another delete takes the toast, when the component goes away or on pagehide
// (with keepalive). Undo never reaches the server. The task's details are dropped from memory so
// the next task window loads its files again.
import { useCallback, useMemo } from 'react';
import { useUndoDelete } from '@/app/(app)/projects/[id]/useUndoDelete';
import { forgetTaskDetails } from '@/components/task/useTaskDetails';

const keyOf = (id) => `file:${id}`;

/**
 * @returns {{ remove: (file: { id: number, taskId?: number | null }, opts?: { label?: string,
 *   keyboard?: boolean, returnFocus?: () => HTMLElement | null }) => void,
 *   isHidden: (id: number) => boolean, toast: import('react').ReactElement }} render `toast`
 *   once in the component; label: the toast's words ('File removed.' by default); keyboard: the
 *   X was pressed from the keyboard, so the toast takes focus; returnFocus: where focus goes after
 *   Undo, Tab or Escape
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

  const isHidden = useCallback((id) => hidden(keyOf(id)), [hidden]);

  return useMemo(() => ({ remove, isHidden, toast }), [remove, isHidden, toast]);
}
