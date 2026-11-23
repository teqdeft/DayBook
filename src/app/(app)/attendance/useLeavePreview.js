'use client';
// The Mark leave dialog's live preview (CONTRACT 25, item 9): GET /api/leave/preview 300 ms after
// the last change of the person, the days or the part; an older answer never replaces a newer
// one. While a query waits for its answer the status is 'waiting'; an error is 'error' (the
// dialog then says saving checks the dates again, and Save stays enabled). The person's split is
// kept from their last answer, so the "First half: until 2:00." help doesn't flicker. Also the
// people and today's date when the dialog opens from the card (useLeaveContext).
import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';

const DEBOUNCE_MS = 300;
const IDLE = { status: 'idle', preview: null };

/**
 * @param {{ query: string | null, userId: string }} input query from previewQuery() (null: the
 *   form can't be previewed yet); userId = the form's person
 * @returns {{ status: 'idle' | 'waiting' | 'ready' | 'error', preview: object | null,
 *   split: string | null }}
 */
export function useLeavePreview({ query, userId }) {
  const [answer, setAnswer] = useState({ query: null, status: 'idle', preview: null });
  const [splits, setSplits] = useState({});

  useEffect(() => {
    if (!query) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get(`/api/leave/preview?${query}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setAnswer({ query, status: 'ready', preview: data });
        if (data?.split) setSplits((known) => ({ ...known, [userId]: data.split }));
      } catch {
        if (controller.signal.aborted) return;
        setAnswer({ query, status: 'error', preview: null });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, userId]);

  const split = splits[userId] ?? null;
  if (!query) return { ...IDLE, split };
  if (answer.query !== query) return { status: 'waiting', preview: null, split };
  return { status: answer.status, preview: answer.preview, split };
}

/**
 * The people the viewer may mark leave for and today's company date, asked from
 * GET /api/leave/people each time the dialog opens without them (from the "Leave and holidays"
 * card). An error leaves the list empty: saving still names the problem.
 * @param {{ open: boolean, needed: boolean }} input
 * @returns {{ people: Array<{ id: number, name: string }> | null, today: string | null }}
 */
export function useLeaveContext({ open, needed }) {
  const [context, setContext] = useState({ people: null, today: null });
  useEffect(() => {
    if (!open || !needed) return undefined;
    let live = true;
    api
      .get('/api/leave/people')
      .then(({ data }) => {
        if (live) setContext({ people: data?.people ?? [], today: data?.today ?? null });
      })
      .catch(() => {
        if (live) setContext({ people: [], today: null });
      });
    return () => {
      live = false;
    };
  }, [open, needed]);
  return context;
}
