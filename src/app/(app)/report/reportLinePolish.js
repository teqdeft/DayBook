// Pure helpers for "Polish on each task line" (CONTRACT 21, browser side): each line's polish
// state, keyed by the line's key, and the rules that keep it honest. A line is either waiting for
// Gemini ('busy': presses are ignored, the line stays editable) or showing a suggestion
// ('suggest'). A suggestion goes stale when the line is typed in or removed, or the report can no
// longer change; an answer that arrives for a line changed in the meantime is dropped quietly.
// Every line has its own state, so several may be waiting at once.

/** No line is waiting or showing a suggestion. */
export const NO_LINE_POLISH = Object.freeze({});

/** The task line with this key, or null. */
export function findTask(entries, key) {
  for (const entry of entries ?? []) {
    const task = (entry.tasks ?? []).find((item) => item.key === key);
    if (task) return task;
  }
  return null;
}

/** Whether the line is waiting for Gemini. */
export function isLineBusy(lines, key) {
  return lines?.[key]?.phase === 'busy';
}

/**
 * A press of the line's sparkle: the line waits for Gemini. Ignored (the same object back) while
 * it is already waiting; a suggestion still shown is replaced.
 * @param {object} lines the current states
 * @param {{ key: string, id: number, raw: string, sent: string }} press id tells this request's
 *   answer from an older one; raw is the line's text as typed, sent the trimmed text sent
 * @returns {object}
 */
export function startLinePolish(lines, { key, id, raw, sent }) {
  if (isLineBusy(lines, key)) return lines;
  return { ...lines, [key]: { phase: 'busy', id, raw, sent } };
}

/** The states without this line's. */
export function removeLinePolish(lines, key) {
  if (!lines?.[key]) return lines;
  const next = { ...lines };
  delete next[key];
  return Object.keys(next).length ? next : NO_LINE_POLISH;
}

/** Typing in the line: its suggestion goes (a line still waiting keeps waiting). */
export function dropLineSuggestion(lines, key) {
  return lines?.[key]?.phase === 'suggest' ? removeLinePolish(lines, key) : lines;
}

/**
 * Gemini's answer (or error) for a line. The outcome says what the person sees:
 * - 'gone': the answer is no longer awaited (a newer press, or the state was cleared): nothing;
 * - 'stale': the line was removed, the report can't change any more or (unless it failed) the line
 *   no longer says what was sent: the state goes, quietly;
 * - 'error': the state goes, a toast says why;
 * - 'unchanged': Gemini kept the wording: the state goes, a toast says so;
 * - 'suggest': the line shows `suggestion.after`.
 * @param {object} lines the current states
 * @param {{ key: string, id: number, task: object | null, enabled: boolean,
 *   suggestion: { after: string } | null, error?: unknown }} answer task is the line as it is now
 *   (findTask), enabled whether line polish is still offered, suggestion the line's row from
 *   changedSuggestions (null when unchanged)
 * @returns {{ lines: object, outcome: 'gone' | 'stale' | 'error' | 'unchanged' | 'suggest' }}
 */
export function settleLinePolish(lines, { key, id, task, enabled, suggestion, error }) {
  const state = lines?.[key];
  if (!state || state.phase !== 'busy' || state.id !== id) return { lines, outcome: 'gone' };
  const rest = removeLinePolish(lines, key);
  if (!enabled || !task) return { lines: rest, outcome: 'stale' };
  if (error) return { lines: rest, outcome: 'error' };
  if (task.title !== state.raw) return { lines: rest, outcome: 'stale' };
  if (!suggestion?.after) return { lines: rest, outcome: 'unchanged' };
  return {
    lines: { ...lines, [key]: { ...state, phase: 'suggest', after: suggestion.after } },
    outcome: 'suggest',
  };
}

/**
 * The states to show: none while line polish isn't offered (AI off, the person's switch off, or
 * the report can't change); none for lines that are gone; a suggestion only while its line still
 * says what was sent. A line waiting for Gemini shows its spinner even after an edit (its answer
 * is then dropped).
 * @param {object} lines
 * @param {object[]} entries editor rows
 * @param {boolean} enabled
 * @returns {object} `lines` itself when every state shows
 */
export function visibleLinePolish(lines, entries, enabled) {
  const keys = Object.keys(lines ?? {});
  if (keys.length === 0) return NO_LINE_POLISH;
  if (!enabled) return NO_LINE_POLISH;
  const tasks = new Map();
  for (const entry of entries ?? []) {
    for (const task of entry.tasks ?? []) tasks.set(task.key, task);
  }
  const shown = keys.filter((key) => {
    const task = tasks.get(key);
    if (!task) return false;
    return lines[key].phase === 'busy' || task.title === lines[key].raw;
  });
  if (shown.length === keys.length) return lines;
  return shown.length ? Object.fromEntries(shown.map((key) => [key, lines[key]])) : NO_LINE_POLISH;
}

/**
 * A shown suggestion as reportPolish.applySuggestions takes it: the title changes only while the
 * line still says what was sent.
 * @param {string} key
 * @param {{ sent: string, after: string }} state
 */
export function suggestionToApply(key, state) {
  return { key, before: state.sent, after: state.after };
}
