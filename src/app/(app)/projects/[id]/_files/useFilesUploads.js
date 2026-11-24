'use client';
// The Files tab's uploads (CONTRACT 27, Files tab): one uploader for the tab (useUploads, files kept
// Ready until "Upload 3 files"), the Upload files window's own picks, and the batches it starts.
// Each batch goes with the window's place and who can see it (always sent). As files finish they
// join the list (a refresh at most every 2 s while a batch runs, and one at its end); when every
// file of a batch has finished or failed (one stopped by a 401 waits for its Retry) one toast
// says "3 files added to Design.", and each finished PDF, Word, .txt or .md file goes to the AI
// reader. Leaving the tab cancels what runs.
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { useUploads } from '@/components/files/useUploads';
import { RUNNING } from '@/components/files/uploadItems';
import { plural } from '@/lib/text';
import { phaseLabel } from '@/modules/projectPlan/phases';

const REFRESH_GAP_MS = 2000;

/** "3 files added to Design.", "1 file added to Whole project." */
export function addedToText(count, phase) {
  const where = phase ? phaseLabel(phase) : 'Whole project';
  return `${count} ${plural(count, 'file')} added to ${where}.`;
}

/** A refresh now and then: at most one every 2 s, and one at once when asked. */
function useRefresher() {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const timer = useRef(null);
  const last = useRef(-Infinity);
  const run = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    last.current = performance.now();
    startRefresh(() => router.refresh());
  }, [router]);
  const soon = useCallback(() => {
    if (timer.current) return;
    const wait = Math.max(0, REFRESH_GAP_MS - (performance.now() - last.current));
    timer.current = setTimeout(run, wait);
  }, [run]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return useMemo(() => ({ now: run, soon }), [run, soon]);
}

/**
 * Whether every file of a batch has finished, failed for good or gone. A file stopped by a 401
 * ("Sign in again, then press Retry.") waits for its Retry as a Paused one does, so the batch's
 * toast and refresh still come when Retry brings it in.
 * @param {string[]} ids the batch's item ids
 * @param {Map<string, { state: string, canRetry?: boolean }>} byId the uploader's items
 */
export function batchSettled(ids, byId) {
  return ids.every((id) => {
    const item = byId.get(id);
    return !item || item.state === 'done' || (item.state === 'error' && !item.canRetry);
  });
}

/** Follows the started batches: their finished files, their end, the toast. */
function useBatches({ uploads, onFinished }) {
  const toast = useToast();
  const refresh = useRefresher();
  const batches = useRef([]); // { ids: string[], phase, done: Set<string> }
  const { items, remove } = uploads;

  useEffect(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    let finished = false;
    for (const batch of batches.current) {
      for (const id of batch.ids) {
        const item = byId.get(id);
        if (item?.state !== 'done' || batch.done.has(id)) continue;
        batch.done.add(id);
        finished = true;
        onFinished(item);
      }
      if (!batchSettled(batch.ids, byId)) continue;
      batch.ended = true;
      if (batch.done.size > 0) toast({ title: addedToText(batch.done.size, batch.phase) });
      batch.done.forEach((id) => remove(id, { quiet: true }));
    }
    const ended = batches.current.some((batch) => batch.ended);
    batches.current = batches.current.filter((batch) => !batch.ended);
    if (ended) refresh.now();
    else if (finished) refresh.soon();
  }, [items, remove, onFinished, toast, refresh]);

  return useCallback((ids, phase) => {
    if (ids.length) batches.current.push({ ids, phase, done: new Set() });
  }, []);
}

/**
 * @param {{ projectId: number, limits: object, onFinished: (item: object) => void }} options
 *   onFinished: a file of a batch finished (the AI reader takes it)
 * @returns {{ uploads: object, card: { active: object[], failed: object[] }, running: number,
 *   dialog: null | { uploads: object, ready: number }, open: (files?: FileList | File[]) => void,
 *   close: () => void, upload: (choice: { phase: string | null,
 *   visibility: 'everyone' | 'managers' }) => number }} dialog: the window's narrowed uploader
 *   (only its own picks; UploadField reads it)
 */
export function useFilesUploads({ projectId, limits, onFinished }) {
  // Fails closed: every start sends the window's choice anyway.
  const uploads = useUploads({
    projectId,
    target: 'project',
    phase: null,
    visibility: 'managers',
    limits,
    autoStart: false,
  });
  const [picked, setPicked] = useState(null); // the window's item ids, or null when it's closed
  const track = useBatches({ uploads, onFinished });
  const { items, add, remove, start } = uploads;

  const open = useCallback(
    (files) => {
      const ids = files?.length ? add(files).ids : [];
      setPicked(ids);
    },
    [add],
  );

  const close = useCallback(() => {
    picked?.forEach((id) => remove(id, { quiet: true }));
    setPicked(null);
  }, [picked, remove]);

  const upload = useCallback(
    ({ phase, visibility }) => {
      const mine = items.filter((item) => picked?.includes(item.id));
      const ready = mine.filter((item) => item.state === 'ready').map((item) => item.id);
      const count = start({ phase, visibility });
      mine
        .filter((item) => item.state === 'error')
        .forEach((item) => remove(item.id, { quiet: true }));
      track(ready, phase);
      setPicked(null);
      return count;
    },
    [items, picked, start, remove, track],
  );

  const dialog = useMemo(() => {
    if (!picked) return null;
    const own = items.filter((item) => picked.includes(item.id));
    return {
      uploads: {
        ...uploads,
        items: own,
        announcement: '',
        add: (files, options) => {
          const result = add(files, options);
          setPicked((ids) => [...(ids ?? []), ...result.ids]);
          return result;
        },
      },
      ready: own.filter((item) => item.state === 'ready').length,
    };
  }, [picked, items, uploads, add]);

  const outside = items.filter((item) => !picked?.includes(item.id));
  const active = outside.filter((item) => [...RUNNING, 'paused'].includes(item.state));
  const failed = outside.filter((item) => item.state === 'error');
  const running = outside.filter((item) => RUNNING.includes(item.state)).length;
  return { uploads, card: { active, failed }, running, dialog, open, close, upload };
}
