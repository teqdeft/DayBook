// The report page's unfinished-task suggestions (CONTRACT 24) as they stand on this page: the
// page's list without the ones a line carries, a line repeats or this page closed ("Done
// already", "Not needed"); Undo puts one back, even after the page was read again without it.
import { useCallback, useMemo, useState } from 'react';
import { openCounts, openSuggestions, withRestored } from './reportCarry';

const NO_IDS = new Set();
const NONE = {};

/**
 * @param {Record<string, object[]> | undefined} pageSuggestions data.carrySuggestions
 * @param {object[]} entries the editor rows
 * @returns {{ all: Record<string, object[]>, closed: Set<number>,
 *   suggestions: Record<string, object[]>, counts: Record<string, number>,
 *   onClosed: (taskId: number) => void, onRestored: (item: object, key?: string) => void }}
 *   `all` is every suggestion of the page (typed titles match against it), `suggestions` what
 *   still shows
 */
export function useCarrySuggestions(pageSuggestions, entries) {
  const [closed, setClosed] = useState(NO_IDS);
  const [restored, setRestored] = useState(NONE);
  const all = useMemo(
    () => withRestored(pageSuggestions ?? NONE, restored),
    [pageSuggestions, restored],
  );
  const suggestions = useMemo(() => openSuggestions(all, entries, closed), [all, entries, closed]);
  const counts = useMemo(() => openCounts(suggestions), [suggestions]);

  const onClosed = useCallback((taskId) => {
    setClosed((current) => new Set(current).add(Number(taskId)));
  }, []);

  const onRestored = useCallback((item, key) => {
    setClosed((current) => {
      const next = new Set(current);
      next.delete(Number(item.taskId));
      return next;
    });
    if (!key) return;
    setRestored((current) => ({ ...current, [key]: [...(current[key] ?? []), item] }));
  }, []);

  return { all, closed, suggestions, counts, onClosed, onRestored };
}
