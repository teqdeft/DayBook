'use client';
// The attach store of a project page (CONTRACT 27, Task files): files added to saved tasks from
// the task window's "Add files" and by drops on cards. ProjectView mounts it around the tabs (PM
// view, managers only), so a batch survives the card moving to another list, a refresh and a
// closed task window; its uploads ask before leaving only on a change of page. When a batch is done
// it makes one `POST /api/project-tasks/[id]/files`, shows its own toast ("2 files added to Checkout
// fix before client demo." · "Simran Kaur is told."; no Undo) and calls router.refresh(). The rules
// live in attachStore.js.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { forgetTaskDetails } from '@/components/task/useTaskDetails';
import { createAttachStore } from './attachStore';
import { uploadingLeaveMessage, useLeaveGuard } from './leaveGuard';

const AttachContext = createContext(null);
const START = Object.freeze({ version: 0, running: 0 });

/**
 * @param {{ projectId: number, limits: { maxFileBytes: number, maxTaskFiles: number,
 *   pickMax: number }, children: import('react').ReactNode }} props limits: `head.limits`
 */
export function TaskAttachProvider({ projectId, limits, children }) {
  const router = useRouter();
  const toast = useToast();
  const [store] = useState(() => createAttachStore({ settings: { projectId, limits } }));
  useEffect(() => {
    store.configure({
      settings: { projectId, limits },
      notify: toast,
      refresh: (taskId) => {
        forgetTaskDetails(taskId);
        router.refresh();
      },
    });
  });
  const { version, running } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => START,
  );

  useEffect(() => {
    function onPageHide(event) {
      if (!event.persisted) store.leave();
    }
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      store.leave();
    };
  }, [store]);

  useLeaveGuard(running > 0, uploadingLeaveMessage(running), { scope: 'page' });

  const value = useMemo(
    () => ({
      version,
      add: store.add,
      batchFor: store.batchFor,
      retry: store.retry,
      remove: store.remove,
      watch: store.watch,
    }),
    [store, version],
  );
  return <AttachContext.Provider value={value}>{children}</AttachContext.Provider>;
}

/**
 * @returns {null | { add: (taskId: number, fileList: FileList | File[], options?: {
 *   title?: string, from?: 'drop' | 'window', existing?: object[], fileCount?: number }) =>
 *   object, batchFor: (taskId: number) => { items: object[], busy: boolean, count: number,
 *   percent: number } | null, retry: (taskId: number, id: string) => void,
 *   remove: (taskId: number, id: string) => void, watch: (taskId: number) => () => void }}
 *   null outside a TaskAttachProvider (Today, another PM, a member). add's options: the task's
 *   title for the toast, where the files came from (a paused file holds a window's batch while
 *   the window is open), the task's files for "already attached" and the 20
 */
export function useTaskAttach() {
  return useContext(AttachContext);
}

/**
 * The task window's view of its task's batch: it tells the store the window is open (a paused
 * file then holds the batch until Retry or Remove) and re-renders as the batch moves.
 * @param {number | null} taskId
 * @returns {{ items: object[], busy: boolean, count: number, percent: number } | null}
 */
export function useTaskBatch(taskId) {
  const attach = useContext(AttachContext);
  const watch = attach?.watch;
  useEffect(() => (watch && taskId ? watch(taskId) : undefined), [watch, taskId]);
  return attach && taskId ? attach.batchFor(taskId) : null;
}
