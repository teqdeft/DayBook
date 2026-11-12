'use client';
// What the AI summary card's buttons ask the API (CONTRACT 22): write or update the summary, and add
// an action item as a task. Errors toast the API's message and change nothing. The buttons keep
// keyboard focus while they work (BusyButton); when a finished one goes away, its focus moves to what
// took its place.
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { phaseLabel } from '@/modules/projectPlan/phases';

/** The id of an action item's "Added", which takes the focus of its Add to tasks button. */
export const addedId = (key) => `summary-added-${key}`;

/** The element focused now, unless it is the page itself. */
const focused = () => (document.activeElement === document.body ? null : document.activeElement);

/**
 * POST /summary: its state, the toast and the refresh. The button goes away with the new summary,
 * so when it still had focus then, the card's title takes it.
 * @param {number} projectId
 * @param {boolean} exists a summary is there already ("Summary updated.")
 * @param {{ current: HTMLElement | null }} heading the card's title, focusable (tabIndex -1)
 * @returns {{ working: boolean, write: (event?: import('react').MouseEvent) => Promise<void> }}
 */
export function useWriteSummary(projectId, exists, heading) {
  const router = useRouter();
  const toast = useToast();
  const [writing, setWriting] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const refocus = useRef(false);

  useEffect(() => {
    if (refreshing || !refocus.current) return;
    refocus.current = false;
    if (!focused()) heading.current?.focus();
  }, [refreshing, heading]);

  async function write(event) {
    if (writing) return;
    const button = event?.currentTarget ?? null;
    setWriting(true);
    try {
      await api.post(`/api/ai/projects/${projectId}/summary`);
      refocus.current = button !== null && focused() === button;
      toast({ title: exists ? 'Summary updated.' : 'Summary written.' });
      startRefresh(() => router.refresh());
    } catch (error) {
      toast({ title: error.message, tone: 'error' });
    } finally {
      setWriting(false);
    }
  }

  return { working: writing || refreshing, write };
}

/**
 * POST /summary/tasks: adds an action item once. "Added" takes the button's place, and its focus
 * when the button still had it.
 * @param {number} projectId
 * @param {string | null} currentPhase for the toast ("Added to Design.")
 * @returns {{ adding: string | null, added: string[],
 *   add: (action: { key: string }, button: HTMLElement | null) => Promise<void> }}
 */
export function useAddAction(projectId, currentPhase) {
  const router = useRouter();
  const toast = useToast();
  const [adding, setAdding] = useState(null);
  const [added, setAdded] = useState([]);

  async function add(action, button) {
    if (adding) return;
    setAdding(action.key);
    try {
      await api.post(`/api/ai/projects/${projectId}/summary/tasks`, { actionKey: action.key });
      const keepFocus = button !== null && focused() === button;
      setAdded((keys) => [...keys, action.key]);
      if (keepFocus) {
        requestAnimationFrame(() => document.getElementById(addedId(action.key))?.focus());
      }
      toast({ title: currentPhase ? `Added to ${phaseLabel(currentPhase)}.` : 'Added to tasks.' });
      router.refresh();
    } catch (error) {
      toast({ title: error.message, tone: 'error' });
    } finally {
      setAdding(null);
    }
  }

  return { adding, added, add };
}
