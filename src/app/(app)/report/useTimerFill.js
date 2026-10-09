// The day's timers on the daily report (CONTRACT 15): "Fill report from timers" and the
// required-mode hours, for ReportProvider. The page's data.timers is a snapshot of when it
// rendered, but a running timer moves on and time can be added on Today, so the hook reads
// GET /api/reports/:id/timers before a fill, before a submit in required mode, when the page comes
// back into view and every minute while today's report is open. Merges go through the provider's
// change(), so autosave, the local backup of a submitted report and the stale-save check behave
// exactly as they do for typing.
// Required mode: a draft's read-only hours follow the timers (on load and whenever newer timers
// arrive). A submitted report never changes on its own: that would mark it unsaved and overwrite
// the browser's backup of unsent edits. The editor says when its timers moved on instead, and
// "Update report" takes the timers' hours.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { clearTimerErrors, hoursComeFromTimers, mergeTimerSummary } from './reportTimers';

export const TIMERS_REFRESH_MS = 60_000;

/**
 * @param {{ timers: { mode: string, required: boolean, summary: object } | null,
 *   reportId: number | null, status: string, editable: boolean, isToday: boolean,
 *   change: (updater: (entries: object[]) => object[]) => void,
 *   setErrors: (updater: (errors: object) => object) => void,
 *   syncRef: { current: null | (() => Promise<void>) } }} input timers is the page's data.timers
 *   (null when timers are off, the person can't use them or the report can't change); status is
 *   the report's current status; syncRef receives the step submit runs first
 * @returns {{ timers: object | null, applyTimers: () => Promise<void> }} timers: the newest copy
 *   (the page's, or a fresher one read since); applyTimers: the "Fill report from timers" button
 */
export function useTimerFill({
  timers: rendered,
  reportId,
  status,
  editable,
  isToday,
  change,
  setErrors,
  syncRef,
}) {
  const toast = useToast();
  // A copy read from the API counts until the page renders again (router.refresh after a timer
  // change brings newer timers of its own).
  const [fetched, setFetched] = useState(null);
  const timers = fetched && fetched.base === rendered ? fetched.value : rendered;
  const hasTimers = Boolean(rendered);
  const filling = useRef(false);

  /** The timers as they are now; undefined when they couldn't be read (keep what is shown). */
  const refresh = useCallback(async () => {
    if (!hasTimers || !reportId) return undefined;
    try {
      const { data: value } = await api.get(`/api/reports/${reportId}/timers`);
      setFetched({ base: rendered, value: value ?? null });
      return value ?? null;
    } catch {
      return undefined;
    }
  }, [hasTimers, reportId, rendered]);

  const applyTimers = useCallback(async () => {
    if (filling.current) return;
    filling.current = true;
    try {
      const fresh = await refresh();
      const latest = fresh === undefined ? timers : fresh;
      if (!latest?.summary) return;
      let changed = false;
      change((entries) => {
        const next = mergeTimerSummary(entries, latest.summary);
        changed = next !== entries;
        return next;
      });
      if (!changed) {
        toast({ title: 'Your report already matches your timers' });
        return;
      }
      setErrors(clearTimerErrors);
      toast({ title: 'Report filled from your timers' });
    } finally {
      filling.current = false;
    }
  }, [refresh, timers, change, setErrors, toast]);

  // Before a submit in required mode: the hours become the timers' hours as they are now (the
  // server checks the timers at that moment).
  const syncHours = useCallback(async () => {
    if (!hoursComeFromTimers(timers)) return;
    const fresh = await refresh();
    const latest = fresh === undefined ? timers : fresh;
    if (!hoursComeFromTimers(latest)) return;
    change((entries) => mergeTimerSummary(entries, latest.summary, { hoursOnly: true }));
  }, [timers, refresh, change]);

  useEffect(() => {
    syncRef.current = syncHours;
  }, [syncRef, syncHours]);

  // Required mode, drafts only: read-only hours follow the timers (no change when they match).
  const followTimers = editable && status === 'draft' && hoursComeFromTimers(timers);
  useEffect(() => {
    if (!followTimers) return;
    change((entries) => mergeTimerSummary(entries, timers.summary, { hoursOnly: true }));
  }, [followTimers, timers, change]);

  // Today's timers keep moving: read them every minute while the page is in view, and when it
  // comes back into view (time added in another tab).
  useEffect(() => {
    if (!hasTimers || !isToday || !editable) return undefined;
    function update() {
      if (document.visibilityState === 'visible') refresh();
    }
    const timer = window.setInterval(update, TIMERS_REFRESH_MS);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [hasTimers, isToday, editable, refresh]);

  return { timers, applyTimers };
}
