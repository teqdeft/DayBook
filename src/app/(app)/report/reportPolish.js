// Pure helpers for "Polish my tasks" on the daily report (CONTRACT 20, browser side): which task
// lines go to POST /api/ai/polish, which lines "Fill report from timers" just wrote (they are
// polished on their own), whether Gemini's answer may still be offered, the dialog's before →
// after rows, and applying the ticked ones. A task line's own sparkle (CONTRACT 21) sends one line
// (polishLineFor) and uses the same answer and apply rules (reportLinePolish.js).

/** The API takes at most this many lines, each up to this many characters. */
export const MAX_POLISH_LINES = 60;
export const MAX_POLISH_TITLE = 500;

/**
 * The report's stage for an offer: its status and submit time. An offer the person didn't ask
 * for (after Fill report from timers) is dropped when this changed while Gemini was writing.
 * @param {{ status?: string, submittedAt?: string | null } | null | undefined} report
 * @returns {string}
 */
export function reportStage(report) {
  return `${report?.status ?? ''}:${report?.submittedAt ?? ''}`;
}

/**
 * Whether Gemini's answer may still open "Suggested wording": the report can still change, and
 * for an automatic offer it is at the stage it was when the request went out (not submitted in
 * the meantime).
 * @param {{ auto: boolean, available: boolean, stageAtStart: string, stageNow: string }} input
 * @returns {boolean}
 */
export function mayOffer({ auto, available, stageAtStart, stageNow }) {
  if (!available) return false;
  return !auto || stageAtStart === stageNow;
}

/** One line for the polish request and the dialog. */
function polishLine(entry, task) {
  return {
    key: task.key,
    title: task.title.trim(),
    projectName: entry.projectName ?? '',
    projectColor: entry.projectColor ?? null,
  };
}

/** Whether a task line can be polished: it has text (1–MAX_POLISH_TITLE characters, trimmed). */
export function canPolish(task) {
  const title = String(task?.title ?? '').trim();
  return title.length > 0 && title.length <= MAX_POLISH_TITLE;
}

/**
 * The report's task lines that can be polished: written (not empty) and not too long, in page
 * order, at most MAX_POLISH_LINES.
 * @param {object[]} entries editor rows (reportState.js)
 * @returns {Array<{ key: string, title: string, projectName: string, projectColor: string | null }>}
 */
export function polishableLines(entries) {
  const lines = [];
  for (const entry of entries ?? []) {
    for (const task of entry.tasks ?? []) {
      if (canPolish(task)) lines.push(polishLine(entry, task));
    }
  }
  return lines.slice(0, MAX_POLISH_LINES);
}

/**
 * One task line to polish on its own (its sparkle), like polishableLines gives it; null when the
 * report has no such line or it can't be polished (empty or too long).
 * @param {object[]} entries editor rows
 * @param {string} key the task line's key
 * @returns {{ key: string, title: string, projectName: string, projectColor: string | null } | null}
 */
export function polishLineFor(entries, key) {
  for (const entry of entries ?? []) {
    const task = (entry.tasks ?? []).find((item) => item.key === key);
    if (task) return canPolish(task) ? polishLine(entry, task) : null;
  }
  return null;
}

/**
 * The lines a fill wrote: new task lines, and empty lines that got text (a card's lone empty
 * line takes the first timer line). Lines that were already written aren't included.
 * @param {object[]} before editor rows before the fill
 * @param {object[]} after editor rows after it
 * @returns {Array<{ key, title, projectName, projectColor }>} like polishableLines
 */
export function filledLines(before, after) {
  const titles = new Map();
  for (const entry of before ?? []) {
    for (const task of entry.tasks ?? []) titles.set(task.key, String(task.title ?? '').trim());
  }
  const lines = [];
  for (const entry of after ?? []) {
    for (const task of entry.tasks ?? []) {
      const was = titles.get(task.key);
      if ((was === undefined || was === '') && canPolish(task)) {
        lines.push(polishLine(entry, task));
      }
    }
  }
  return lines.slice(0, MAX_POLISH_LINES);
}

/** The request body for POST /api/ai/polish. */
export function polishRequest(lines) {
  return {
    lines: lines.map(({ key, title, projectName }) => ({ key, title, projectName })),
  };
}

/**
 * The dialog's rows: each sent line the answer changed, as { key, projectName, projectColor,
 * before, after }, in the order sent. Keys that weren't sent, repeats and lines that came back
 * the same (or empty) are left out.
 * @param {Array<{ key, title, projectName, projectColor }>} sent
 * @param {Array<{ key: string, title: string }> | undefined} answer the API's `lines`
 */
export function changedSuggestions(sent, answer) {
  const answers = new Map();
  for (const line of answer ?? []) {
    if (typeof line?.key === 'string' && !answers.has(line.key)) answers.set(line.key, line.title);
  }
  const rows = [];
  for (const line of sent ?? []) {
    const after = typeof answers.get(line.key) === 'string' ? answers.get(line.key).trim() : '';
    if (!after || after === line.title) continue;
    rows.push({
      key: line.key,
      projectName: line.projectName,
      projectColor: line.projectColor ?? null,
      before: line.title,
      after,
    });
  }
  return rows;
}

/**
 * The editor rows with the picked suggestions applied: only the title changes (status and
 * priority links stay), and only on lines that still say what was polished (a line changed or
 * removed since then is left alone).
 * @param {object[]} entries editor rows
 * @param {Array<{ key: string, before: string, after: string }>} picked
 * @returns {{ rows: object[], applied: number }} rows is `entries` itself when nothing applies
 */
export function applySuggestions(entries, picked) {
  const byKey = new Map((picked ?? []).map((item) => [item.key, item]));
  let applied = 0;
  const rows = entries.map((entry) => {
    let changed = false;
    const tasks = entry.tasks.map((task) => {
      const item = byKey.get(task.key);
      if (!item || String(task.title ?? '').trim() !== item.before) return task;
      changed = true;
      applied += 1;
      return { ...task, title: item.after };
    });
    return changed ? { ...entry, tasks } : entry;
  });
  return { rows: applied ? rows : entries, applied };
}
