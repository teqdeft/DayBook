'use client';
// "From project files" in the task window (CONTRACT 28, "From project files" picker, What Attach
// does): the picked project files go at once with `POST /api/project-tasks/[id]/files
// { linkFileIds, shareConfirmed, shareWith }`; the toast "2 files attached." says who was told (from
// the answer), the window loads the task's files again and the page refreshes (the card's count
// and chips). A refusal of the share confirm (`fields.shareConfirmed`: the task is someone else's
// now, or a private link changed meanwhile) reads the task again and the picker asks again naming
// its current person; any other failure keeps the picker open with an error toast.
import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { plural } from '@/lib/text';
import { toldBody } from '@/app/(app)/projects/[id]/_board/taskFormToasts';
import { forgetTaskDetails } from './useTaskDetails';

/** "2 files attached." and who gets a notification. */
export function attachedToast(count, answer) {
  const title = `${count} ${plural(count, 'file')} attached.`;
  const body = toldBody({ told: answer?.told ?? null, toldName: answer?.toldName ?? null });
  return body ? { title, body } : { title };
}

/** The body the picker's files go with. */
export function attachBody(files, { shareConfirmed = false, shareWith = '' } = {}) {
  const body = { linkFileIds: files.map((file) => Number(file.id)) };
  return shareConfirmed ? { ...body, shareConfirmed: true, shareWith } : body;
}

/**
 * @param {{ task: object }} args TaskDetails
 * @returns {{ open: boolean, show: () => void, hide: () => void,
 *   attach: (files: object[], options: { shareConfirmed: boolean, shareWith: number | '' }) =>
 *     Promise<void | { ask: true, assignee: object | null }> }}
 */
export function useLinkAttach({ task }) {
  const router = useRouter();
  const toast = useToast();
  const [, startRefresh] = useTransition();
  const [open, setOpen] = useState(false);

  const attach = useCallback(
    async (files, options) => {
      try {
        const answer = await api.post(
          `/api/project-tasks/${task.id}/files`,
          attachBody(files, options),
        );
        setOpen(false);
        toast(attachedToast(files.length, answer?.data));
        forgetTaskDetails(task.id);
        startRefresh(() => router.refresh());
        return undefined;
      } catch (failure) {
        if (failure?.fields?.shareConfirmed) {
          const fresh = await api.get(`/api/project-tasks/${task.id}`).catch(() => null);
          forgetTaskDetails(task.id);
          return { ask: true, assignee: fresh?.data?.assignee ?? task.assignee ?? null };
        }
        toast({ title: failure?.message ?? "Couldn't attach the files", tone: 'error' });
        return undefined;
      }
    },
    [task, toast, router],
  );

  return {
    open,
    show: useCallback(() => setOpen(true), []),
    hide: useCallback(() => setOpen(false), []),
    attach,
  };
}
