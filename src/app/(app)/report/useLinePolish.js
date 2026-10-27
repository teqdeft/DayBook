// "Polish on each task line" (CONTRACT 21) for PolishProvider: a line's sparkle sends that one
// line to POST /api/ai/polish; a changed answer shows as a suggestion under the line, Use puts it
// in through the provider's change() (so autosave and the backup of a submitted report behave as
// they do for typing), Keep mine closes it. Lines don't wait for each other or for the top bar's
// Polish with AI. The states and their rules are in reportLinePolish.js.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/apiClient';
import {
  NO_LINE_POLISH,
  dropLineSuggestion,
  findTask,
  isLineBusy,
  removeLinePolish,
  settleLinePolish,
  startLinePolish,
  suggestionToApply,
  visibleLinePolish,
} from './reportLinePolish';
import { applySuggestions, changedSuggestions, polishLineFor, polishRequest } from './reportPolish';

/**
 * @param {{ entries: object[], enabled: boolean,
 *   change: (updater: (entries: object[]) => object[], clear?: object) => void,
 *   toast: (toast: { title: string, body?: string, tone?: string }) => void }} input enabled:
 *   line polish is offered (polishGates().lines)
 * @returns {{ states: Record<string, { phase: 'busy' | 'suggest', after?: string }>,
 *   polish: (key: string) => Promise<void>, use: (key: string) => boolean,
 *   keep: (key: string) => void, drop: (key: string) => void }} states: the lines waiting or
 *   showing a suggestion; use: applies a line's suggestion and says whether the title changed;
 *   keep: Keep mine; drop: the line was typed in
 */
export function useLinePolish({ entries, enabled, change, toast }) {
  const [lines, setLines] = useState(NO_LINE_POLISH);
  const live = useRef({ entries, enabled, mounted: false, lines: NO_LINE_POLISH, requests: 0 });

  useEffect(() => {
    live.current.entries = entries;
    live.current.enabled = enabled;
  }, [entries, enabled]);

  // An answer that arrives after the page moved on (the report changed mode) shows nothing.
  useEffect(() => {
    const state = live.current;
    state.mounted = true;
    return () => {
      state.mounted = false;
    };
  }, []);

  /** Changes the states now (handlers read them before React renders again). */
  const update = useCallback((next) => {
    const state = live.current;
    const value = next(state.lines);
    if (value === state.lines) return;
    state.lines = value;
    setLines(value);
  }, []);

  const polish = useCallback(
    async (key) => {
      const state = live.current;
      if (!state.enabled || isLineBusy(state.lines, key)) return;
      const line = polishLineFor(state.entries, key);
      if (!line) return;
      state.requests += 1;
      const id = state.requests;
      const raw = findTask(state.entries, key).title;
      update((current) => startLinePolish(current, { key, id, raw, sent: line.title }));
      let suggestion = null;
      let error = null;
      try {
        const { data: answer } = await api.post('/api/ai/polish', polishRequest([line]));
        suggestion = changedSuggestions([line], answer?.lines)[0] ?? null;
      } catch (caught) {
        error = caught ?? new Error('Polish failed');
      }
      let outcome = 'gone';
      update((current) => {
        const result = settleLinePolish(current, {
          key,
          id,
          task: findTask(state.entries, key),
          enabled: state.enabled && state.mounted,
          suggestion,
          error,
        });
        outcome = result.outcome;
        return result.lines;
      });
      if (outcome === 'unchanged') toast({ title: 'This task already reads well' });
      if (outcome === 'error') {
        toast({ title: "Couldn't polish this task", body: error?.message, tone: 'error' });
      }
    },
    [toast, update],
  );

  const use = useCallback(
    (key) => {
      const shown = live.current.lines[key];
      if (shown?.phase !== 'suggest') return false;
      let applied = 0;
      change(
        (rows) => {
          const result = applySuggestions(rows, [suggestionToApply(key, shown)]);
          applied = result.applied;
          return result.rows;
        },
        { taskKey: key },
      );
      update((current) => removeLinePolish(current, key));
      if (!applied) {
        toast({ title: 'Nothing changed', body: 'This task was edited in the meantime.' });
      }
      return applied > 0;
    },
    [change, toast, update],
  );

  const keep = useCallback((key) => update((current) => removeLinePolish(current, key)), [update]);
  const drop = useCallback(
    (key) => update((current) => dropLineSuggestion(current, key)),
    [update],
  );

  const states = useMemo(
    () => visibleLinePolish(lines, entries, enabled),
    [lines, entries, enabled],
  );
  return { states, polish, use, keep, drop };
}
