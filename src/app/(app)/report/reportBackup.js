'use client';
// A browser-only copy of unsent changes to a submitted report (those only reach the server with
// "Update report"), so leaving the page by mistake doesn't lose them. Storage can be missing or
// blocked; every access is wrapped and the page works without it.
import { useSyncExternalStore } from 'react';

const PREFIX = 'daybook:report-changes:';
const listeners = new Set();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

export function writeBackup(reportId, revision, entries) {
  if (!reportId) return;
  try {
    window.localStorage.setItem(`${PREFIX}${reportId}`, JSON.stringify({ revision, entries }));
    notify();
  } catch {
    // Storage is full or blocked: the in-page state still holds the changes.
  }
}

export function clearBackup(reportId) {
  if (!reportId) return;
  try {
    window.localStorage.removeItem(`${PREFIX}${reportId}`);
    notify();
  } catch {
    // Nothing to clear.
  }
}

function readRaw(reportId) {
  try {
    return window.localStorage.getItem(`${PREFIX}${reportId}`);
  } catch {
    return null;
  }
}

/**
 * The saved rows for this report and revision, or null (always null while rendering on the
 * server, so hydration matches).
 * @returns {object[] | null}
 */
export function useBackup(reportId, revision) {
  const raw = useSyncExternalStore(
    subscribe,
    () => (reportId ? readRaw(reportId) : null),
    () => null,
  );
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    return saved?.revision === revision && Array.isArray(saved.entries) ? saved.entries : null;
  } catch {
    return null;
  }
}
