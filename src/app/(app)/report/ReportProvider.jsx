'use client';
// Holds the report editor's state for the whole page (the top bar's totals and button, the
// project cards and the Slack preview): autosave one second after the last change while the
// report is a draft (autosave.js), submit, and what happens on a lock, a validation error or a
// report that changed somewhere else (each save sends the version this page last saw).
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { createAutosave } from './autosave';
import {
  NO_ERRORS,
  applySavedIds,
  clearError,
  entriesFromView,
  firstHoursError,
  mapFieldErrors,
  parseHours,
  serialize,
} from './reportState';
import { clearBackup, writeBackup } from './reportBackup';
import { useTimerFill } from './useTimerFill';

const ReportContext = createContext(null);

/** The editor state and actions; only inside <ReportProvider>. */
export function useReport() {
  const value = useContext(ReportContext);
  if (!value) throw new Error('useReport() needs <ReportProvider>');
  return value;
}

function reportMeta(view) {
  return {
    id: view.id,
    workDate: view.workDate,
    status: view.status,
    revision: view.revision,
    editable: view.editable,
    locksAt: view.locksAt,
    unlockedUntil: view.unlockedUntil,
    submittedAt: view.submittedAt,
    pendingEditRequest: view.pendingEditRequest,
  };
}

const isNetworkError = (error) =>
  error?.code === 'NETWORK' || error?.status === 0 || error?.status >= 500;

/** 'locked' (the report locked while open), 'stale' (it changed elsewhere) or null. */
function blockReason(error) {
  if (error?.code === 'REPORT_LOCKED') return 'locked';
  if (error?.code === 'CONFLICT') return 'stale';
  return null;
}

/**
 * @param {{ data: object, children: import('react').ReactNode }} props `data` comes from the page:
 *   { report, picker, user, presentMinutes, workedMinutes, timers, gapWarningMinutes, slackLines,
 *   previewTime, ... }. The context's `timers` is the newest copy of data.timers (useTimerFill).
 */
export default function ReportProvider({ data, children }) {
  const router = useRouter();
  const toast = useToast();
  const [entries, setEntries] = useState(() => entriesFromView(data.report));
  const [report, setReport] = useState(() => reportMeta(data.report));
  const [errors, setErrors] = useState(NO_ERRORS);
  // idle | waiting | saving | saved | failed | offline | unsaved
  const [saveState, setSaveState] = useState('idle');
  const [blocked, setBlocked] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Required timer mode: takes the timers' hours as they are now, before a submit (useTimerFill).
  const timerSync = useRef(null);
  const live = useRef({
    entries,
    reportId: data.report.id,
    status: data.report.status,
    revision: data.report.revision,
    version: data.report.version ?? null,
    // unsent changes to a submitted report (drafts: the autosave loop knows)
    pending: false,
    blocked: null,
    submitting: false,
    lastSave: 'idle',
    changes: 0,
  });

  const block = useCallback((error) => {
    const reason = blockReason(error);
    if (!reason) return false;
    live.current.blocked = reason;
    setBlocked(reason);
    setSaveState('failed');
    return true;
  }, []);

  /** One autosave PUT of the latest rows; says how it went, for the autosave loop. */
  const saveDraftRows = useCallback(async () => {
    const state = live.current;
    if (state.status !== 'draft' || state.blocked || !state.reportId) return 'stopped';
    const { body, keys } = serialize(state.entries);
    try {
      const { data: view } = await api.put(`/api/reports/${state.reportId}`, {
        entries: body,
        baseVersion: state.version ?? undefined,
      });
      state.version = view.version;
      const next = applySavedIds(state.entries, keys, view);
      if (next !== state.entries) {
        state.entries = next;
        setEntries(next);
      }
      return 'saved';
    } catch (error) {
      if (block(error)) return 'stopped';
      if (isNetworkError(error)) return 'offline';
      setErrors(mapFieldErrors(error?.fields, keys, error?.message));
      return 'failed';
    }
  }, [block]);

  // The autosave loop (created with the page's leave handlers below).
  const autosaveRef = useRef(null);

  /** Shows a report as the server has it (after a submit, or a newer copy found on return). */
  const adopt = useCallback((view) => {
    const state = live.current;
    const next = entriesFromView(view);
    Object.assign(state, {
      entries: next,
      status: view.status,
      revision: view.revision,
      version: view.version ?? null,
      pending: false,
    });
    setEntries(next);
    setReport(reportMeta(view));
    setErrors(NO_ERRORS);
    setSaveState('idle');
  }, []);

  /** Called after every change: autosave for drafts, a local backup for submitted reports. */
  const change = useCallback((updater, clear) => {
    const state = live.current;
    const next = updater(state.entries);
    if (next === state.entries) return;
    state.entries = next;
    state.changes += 1;
    setEntries(next);
    if (clear) setErrors((current) => clearError(current, clear));
    if (state.blocked) return;
    if (state.status === 'draft') {
      autosaveRef.current?.changed();
    } else {
      state.pending = true;
      setSaveState('unsaved');
      writeBackup(state.reportId, state.revision, next);
    }
  }, []);

  const updateEntry = useCallback(
    (entryKey, patch, clear) =>
      change(
        (list) =>
          list.map((entry) => {
            if (entry.key !== entryKey) return entry;
            const updated = { ...entry, ...(typeof patch === 'function' ? patch(entry) : patch) };
            const parsed = parseHours(updated.hours);
            return 'value' in parsed ? { ...updated, savedHours: parsed.value } : updated;
          }),
        clear,
      ),
    [change],
  );

  const submit = useCallback(async () => {
    const state = live.current;
    if (state.submitting || state.blocked || !state.reportId) return;
    const wasSubmitted = state.status === 'submitted';
    const notSent = wasSubmitted ? "Your report wasn't updated" : "Your report wasn't submitted";
    // What is on screen is what gets submitted: a wrong hours value stops it here.
    const wrongHours = firstHoursError(state.entries);
    if (wrongHours) {
      toast({ title: notSent, body: wrongHours.message, tone: 'error' });
      return;
    }
    const autosave = autosaveRef.current;
    if (!autosave) return;
    state.submitting = true;
    setSubmitting(true);
    try {
      // Required timer mode: a running timer moved on since the page loaded, and the server
      // checks the hours against the timers as they are now.
      await timerSync.current?.();
      autosave.pause();
      // A save still running finishes first: it returns the version this submit builds on.
      await autosave.idle();
      if (state.blocked) return;
      const { body, keys } = serialize(state.entries);
      try {
        const { data: view } = await api.post(`/api/reports/${state.reportId}/submit`, {
          entries: body,
          baseVersion: state.version ?? undefined,
        });
        autosave.markSaved();
        clearBackup(state.reportId);
        adopt(view);
        toast({ title: wasSubmitted ? 'Report updated' : 'Report submitted' });
        router.refresh();
      } catch (error) {
        if (block(error)) autosave.stop();
        else {
          setErrors(mapFieldErrors(error?.fields, keys, error?.message));
          // A refused submit changes nothing on the server: save the draft now, so nothing typed
          // is lost and new rows get their ids.
          if (state.status === 'draft') autosave.saveNow();
        }
        toast({ title: notSent, body: error?.message, tone: 'error' });
      }
    } finally {
      state.submitting = false;
      setSubmitting(false);
    }
  }, [adopt, block, router, toast]);

  /** Puts back rows kept in this browser (unsent changes to a submitted report). */
  const restore = useCallback(
    (saved) => {
      change(() => saved);
    },
    [change],
  );

  /**
   * Coming back to the page (browser back/forward, another tab, a wake from sleep) may show an
   * older copy than the server has. With no local changes in between, show the server's copy;
   * otherwise the next save is refused as stale and the page asks for a reload.
   */
  const showLatest = useCallback(async () => {
    const state = live.current;
    if (!state.reportId || state.blocked || state.submitting) return;
    const { version, changes } = state;
    let view;
    try {
      ({ data: view } = await api.get(`/api/reports/${state.reportId}`));
    } catch {
      return;
    }
    const autosave = autosaveRef.current;
    const busy =
      state.submitting ||
      state.blocked ||
      state.pending ||
      !autosave ||
      autosave.hasPending() ||
      autosave.isSaving() ||
      state.version !== version ||
      state.changes !== changes;
    if (!view?.version || view.version === state.version || busy) return;
    adopt(view);
    router.refresh();
  }, [adopt, router]);

  // The autosave loop, and the changes still waiting when the person leaves: sent with keepalive
  // so they arrive.
  useEffect(() => {
    const state = live.current;
    const autosave = createAutosave({
      save: saveDraftRows,
      onStatus(status) {
        state.lastSave = status;
        setSaveState(status);
      },
    });
    autosaveRef.current = autosave;
    function sendPending() {
      if (state.status !== 'draft' || state.blocked || !state.reportId) return;
      if (!autosave.takePending()) return;
      const base = state.version;
      // A field still wrong keeps its last valid hours here, so the rest of the draft is saved.
      const { body, keys } = serialize(state.entries, { keepLastValid: true });
      fetch(`/api/reports/${state.reportId}`, {
        method: 'PUT',
        keepalive: true,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: body, baseVersion: base ?? undefined }),
      })
        .then(async (response) => {
          // This only shows when the page comes back (the browser's back/forward cache).
          const json = await response.json().catch(() => null);
          if (response.ok && json?.data) {
            if (state.version !== base) return;
            state.version = json.data.version;
            const next = applySavedIds(state.entries, keys, json.data);
            if (next !== state.entries) {
              state.entries = next;
              setEntries(next);
            }
          } else if (!block(json?.error)) {
            setErrors(mapFieldErrors(json?.error?.fields, keys, json?.error?.message));
            setSaveState('failed');
          }
        })
        .catch(() => {});
    }
    // A submitted report only changes with "Update report", a save may still be running, or the
    // last save didn't go through (the status says "Not saved" or "Offline").
    function warnUnsaved(event) {
      const unsent =
        (state.status === 'submitted' && state.pending) ||
        autosave.isSaving() ||
        (autosave.hasPending() && ['failed', 'offline'].includes(state.lastSave));
      if (!unsent || state.blocked) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('pagehide', sendPending);
    window.addEventListener('beforeunload', warnUnsaved);
    return () => {
      window.removeEventListener('pagehide', sendPending);
      window.removeEventListener('beforeunload', warnUnsaved);
      autosave.pause();
      // Leaving inside the app: a running save finishes first, so the last changes go out with
      // the version it returns.
      if (autosave.isSaving()) autosave.idle().then(sendPending);
      else sendPending();
    };
  }, [block, saveDraftRows]);

  // The day's timers and Fill report from timers; in required mode a draft's hours follow the
  // timers (after the autosave loop above exists, so that change saves like typing).
  const { timers, applyTimers } = useTimerFill({
    timers: data.timers ?? null,
    reportId: report.id,
    status: report.status,
    editable: Boolean(report.editable) && report.status !== 'none',
    isToday: Boolean(data.isToday),
    change,
    setErrors,
    syncRef: timerSync,
  });

  useEffect(() => {
    showLatest();
    function onVisible() {
      if (document.visibilityState === 'visible') showLatest();
    }
    function onPageShow(event) {
      if (event.persisted) showLatest();
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [showLatest]);

  const value = {
    data,
    entries,
    report,
    errors,
    saveState,
    blocked,
    lockedOut: blocked === 'locked',
    stale: blocked === 'stale',
    submitting,
    readOnly: !report.editable || Boolean(blocked) || report.status === 'none',
    change,
    updateEntry,
    submit,
    restore,
    setErrors,
    timers,
    applyTimers,
  };
  return <ReportContext.Provider value={value}>{children}</ReportContext.Provider>;
}
