'use client';
// Sending a remind from Attendance (CONTRACT 25, item 5): the row menu's item, Remind all, Remind
// selected and the Missing check-outs list's Remind go through send(). One POST
// /api/attendance/reminders per click; the toast says what happened (remindToast), an API error
// (UPDATE_NEEDED included) reads "Couldn't send the reminder" with its message, and the page
// refreshes either way so the menu and the "Reminded" lines catch up.
import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { remindToast } from './remindItem';

const NOTHING = { sent: [], skipped: [] };

/**
 * @returns {{ send: (kind: 'check_in' | 'break' | 'check_out' | 'missing_checkout',
 *   users: Array<{ id: number, name: string }>) => Promise<{ sent: object[],
 *   skipped: object[] }>, busy: boolean }} send answers the API's { sent, skipped } (nothing on
 *   an error or while a send is still running)
 */
export function useRemind() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const send = useCallback(
    async (kind, users) => {
      const people = users ?? [];
      if (people.length === 0 || running.current) return NOTHING;
      running.current = true;
      setBusy(true);
      try {
        const userIds = people.map((person) => person.id);
        const { data } = await api.post('/api/attendance/reminders', { kind, userIds });
        toast(remindToast(data ?? NOTHING, people.length));
        return data ?? NOTHING;
      } catch (error) {
        toast({ title: "Couldn't send the reminder", body: error.message, tone: 'error' });
        return NOTHING;
      } finally {
        running.current = false;
        setBusy(false);
        router.refresh();
      }
    },
    [router, toast],
  );

  return { send, busy };
}

export default useRemind;
