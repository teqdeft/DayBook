'use client';
// The preview cards' actions (CONTRACT 26), sharing the bell's helpers: Open marks the item read
// and follows its link as a bell item does; Mark as read, Mark these as read and Mark all as read
// save, then tell the live store (which tells the bell, the other cards and the other tabs). The
// card has already closed: a failure puts nothing back on screen, toasts the bell's copy and has
// the bell reload its list quietly.
import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/apiClient';
import { now } from '@/lib/time';
import { followLink, itemPath, requestBellReload } from '../NotificationBell.actions';
import { useToast } from '../ToastProvider';
import { useLiveNotifications } from './LiveNotifications';

/** The most ids "Mark these as read" sends (the API's limit). */
export const MARK_MANY_MAX = 50;

/** The newest `MARK_MANY_MAX` distinct ids, newest first. */
export function newestIds(ids) {
  const unique = [...new Set((ids ?? []).map(Number).filter((id) => id > 0))];
  return unique.sort((a, b) => b - a).slice(0, MARK_MANY_MAX);
}

/**
 * @returns {{ open: (item: object, event: object) => Promise<void>,
 *   markRead: (item: object) => Promise<boolean>, markMany: (ids: number[] | null) =>
 *   Promise<boolean>, markAll: () => Promise<boolean> }} `markMany(null)` is `markAll()`; each
 *   save resolves true when it worked.
 */
export function usePreviewActions() {
  const live = useLiveNotifications();
  const router = useRouter();
  const toast = useToast();

  /** PATCH read; tells the store on success. Resolves null or the error, never rejects. */
  const saveRead = useCallback(
    async (item) => {
      try {
        const json = await api.patch(itemPath(item.id), { read: true });
        const data = json?.data ?? {};
        live?.reportRead([item.id], data.item?.readAt ?? now().toISOString(), data.unreadCount);
        return null;
      } catch (error) {
        return error;
      }
    },
    [live],
  );

  const failed = useCallback(
    (title, error) => {
      toast({ title, body: error?.message, tone: 'error' });
      requestBellReload();
    },
    [toast],
  );

  // The bell item's click: read at once, then the link (a new-tab click stays with the browser).
  const open = useCallback(
    (item, event) => {
      const saving = item.readAt ? null : saveRead(item);
      return followLink({ item, event, saving, router });
    },
    [saveRead, router],
  );

  const markRead = useCallback(
    async (item) => {
      const error = await saveRead(item);
      if (error) failed("Couldn't mark it as read", error);
      return !error;
    },
    [saveRead, failed],
  );

  const markAll = useCallback(async () => {
    try {
      await api.post('/api/notifications/read-all');
      live?.reportReadAll(now().toISOString());
      router.refresh();
      return true;
    } catch (error) {
      failed("Couldn't mark them as read", error);
      return false;
    }
  }, [live, router, failed]);

  const markMany = useCallback(
    async (ids) => {
      if (!Array.isArray(ids)) return markAll();
      const picked = newestIds(ids);
      if (picked.length === 0) return true;
      try {
        const json = await api.post('/api/notifications/read-all', { ids: picked });
        live?.reportRead(picked, now().toISOString(), json?.data?.unreadCount);
        return true;
      } catch (error) {
        failed("Couldn't mark them as read", error);
        return false;
      }
    },
    [live, markAll, failed],
  );

  return useMemo(
    () => ({ open, markRead, markMany, markAll }),
    [open, markRead, markMany, markAll],
  );
}

export default usePreviewActions;
