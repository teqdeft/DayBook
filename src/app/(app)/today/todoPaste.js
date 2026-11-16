// "Paste your to-do" (CONTRACT 24), pure: the pasted text read by parseTodoText, each heading
// matched to a project (exact, close or none) or set by the person, what each line will do (added,
// "Already in your to-do", carried from a suggestion, Done or Blocked), the summary, the button and
// the body of POST /api/me/todo/lines/bulk. Tasks before any heading form a group of their own; it
// starts on the project whose "Add a task" the text was pasted into.
import { plural } from '@/lib/text';
import {
  TODO_LIMITS,
  matchProject,
  normalizeName,
  normalizeTitle,
  parseTodoText,
} from '@/modules/reports/todoText';
import { groupKey } from './todoModel';

export const SKIP = 'skip';

/** '1 task', '5 tasks'. */
const counted = (count, word) => `${count} ${plural(count, word)}`;

/** What a line shows beside its title. */
function lineTag({ dup, suggestion, status }) {
  if (dup) return { text: 'Already in your to-do', tone: 'neutral' };
  if (suggestion) return { text: suggestion.dayLabel, tone: 'neutral' };
  if (status === 'done') return { text: 'Done', tone: 'green' };
  if (status === 'blocked') return { text: 'Blocked', tone: 'red' };
  return null;
}

/** The muted or red note beside a group's Select. */
function groupNote({ heading, match, chose, skip, target, field }) {
  if (skip) return { text: 'These tasks will be skipped.', tone: 'muted' };
  if (!heading && !(field && target)) return { text: 'These tasks have no project.', tone: 'red' };
  if (!target) return { text: `No project called “${heading}”.`, tone: 'red' };
  if (match.kind === 'close' && !chose) return { text: `Matched from “${heading}”`, tone: 'muted' };
  return null;
}

/** The lines left out: too short or too long, over the report's limits, text cut at 20,000. */
function notes(parsed) {
  const out = [];
  const short = parsed.skipped - parsed.overLimit;
  if (short > 0) {
    out.push(
      `${short === 1 ? '1 line was' : `${short} lines were`} too short or too long and left out.`,
    );
  }
  if (parsed.overLimit > 0) {
    const tasks = parsed.overLimit === 1 ? '1 task was' : `${parsed.overLimit} tasks were`;
    out.push(
      `${tasks} left out. A report can have up to ${TODO_LIMITS.projects} projects, each with up to ${TODO_LIMITS.tasksPerProject} tasks.`,
    );
  }
  if (parsed.truncated) out.push('Only the first 20,000 characters were read.');
  return out;
}

/**
 * Where a group's tasks go: its heading's match (or, for the tasks before any heading pasted into
 * a project's "Add a task", that project), unless the person picked another one or Skip.
 */
function groupPick(source, index, { pickables, byKey, choices, fieldKey }) {
  const field = !source.heading && byKey.has(fieldKey);
  let match = { kind: 'none', project: null };
  if (source.heading) match = matchProject(source.heading, pickables);
  else if (field) match = { kind: 'exact', project: byKey.get(fieldKey) };
  const chose = choices[index] !== undefined;
  const choice = chose ? choices[index] : (match.project?.key ?? '');
  const skip = choice === SKIP;
  return { match, chose, choice, skip, field, target: skip ? null : (byKey.get(choice) ?? null) };
}

/** The suggestion with this normalised title, or null. */
const suggestionFor = (items, title) =>
  (items ?? []).find((item) => normalizeTitle(item.title) === title) ?? null;

/**
 * A group's lines as the dialog shows them, counted in `tally`: `fresh` lines go into the plan;
 * `waiting` ones would once their group has a project (the button counts both, as the design does).
 */
function lineViews(source, pick, { seen, suggestions, tally }) {
  const { target, skip } = pick;
  const titles = target ? (seen.get(target.key) ?? new Set()) : new Set();
  if (target) seen.set(target.key, titles);
  return source.lines.map((line) => {
    tally.tasks += 1;
    const title = normalizeTitle(line.title);
    const dup = titles.has(title);
    titles.add(title);
    const suggestion = target && !dup ? suggestionFor(suggestions[target.key], title) : null;
    if (target && !dup) {
      tally.fresh += 1;
      const entry = tally.plan.get(target.key) ?? { target, lines: [] };
      entry.lines.push({
        title: line.title,
        status: suggestion && line.status !== 'done' ? suggestion.status : line.status,
        carriedFrom: suggestion
          ? { workDate: suggestion.workDate, dayLabel: suggestion.dayLabel }
          : null,
      });
      tally.plan.set(target.key, entry);
    } else if (!dup && !skip) {
      tally.waiting += 1;
    }
    const tag = skip ? null : lineTag({ dup, suggestion, status: line.status });
    return { title: line.title, dup, skip, tag };
  });
}

/** One group as the dialog shows it. */
function groupView(source, index, pick, { changing, lines }) {
  const exactView = pick.match.kind === 'exact' && !pick.chose && !changing[index];
  return {
    index,
    heading: source.heading,
    kind: pick.match.kind,
    choice: pick.choice,
    target: pick.target,
    skip: pick.skip,
    exactView,
    bad: !pick.skip && !pick.target,
    note: exactView ? null : groupNote({ heading: source.heading, ...pick }),
    lines,
  };
}

/**
 * The dialog's picture of the paste.
 * @param {{ text: string, choices?: Record<number, string>, changing?: Record<number, boolean>,
 *   pickables: Array<{ key: string, name: string, project?: object, request?: object }>,
 *   groups: object[], suggestions?: Record<string, object[]>, fieldKey?: string | null }} input
 *   choices: group index -> the Select's value (a project key or 'skip'); changing: groups whose
 *   exact match was opened with "Change"; groups: the to-do's groups (their lines are "Already in
 *   your to-do"); suggestions: the open suggestions by project key; fieldKey: the project whose
 *   "Add a task" the text was pasted into (the tasks before any heading go to it)
 * @returns {{ hasText: boolean, summary: string, groups: object[], notes: string[], fresh: number,
 *   unresolved: boolean, button: string, disabled: boolean, plan: Array<{ target: object,
 *   lines: Array<{ title, status, carriedFrom }> }> }}
 */
export function pasteModel({
  text,
  choices = {},
  changing = {},
  pickables,
  groups,
  suggestions = {},
  fieldKey = null,
}) {
  const parsed = parseTodoText(text, { projects: pickables });
  const byKey = new Map(pickables.map((item) => [item.key, item]));
  const seen = new Map(
    groups.map((group) => [
      groupKey(group),
      new Set(group.lines.map((line) => normalizeTitle(line.title))),
    ]),
  );
  const tally = { fresh: 0, waiting: 0, tasks: 0, plan: new Map() };
  const projects = new Set();
  const sources = [
    ...(parsed.loose.length ? [{ heading: null, lines: parsed.loose }] : []),
    ...parsed.groups,
  ];
  const shown = sources.map((source, index) => {
    const pick = groupPick(source, index, { pickables, byKey, choices, fieldKey });
    if (source.heading) projects.add(pick.target?.key ?? `h:${normalizeName(source.heading)}`);
    else if (pick.field && pick.target) projects.add(pick.target.key);
    const lines = lineViews(source, pick, { seen, suggestions, tally });
    return groupView(source, index, pick, { changing, lines });
  });
  const unresolved = shown.some((group) => group.bad);
  const count = tally.fresh + tally.waiting;
  return {
    hasText: String(text ?? '').trim().length > 0,
    summary:
      tally.tasks === 0
        ? 'No tasks yet. Start each task with * or •.'
        : `We found ${counted(projects.size, 'project')} and ${counted(tally.tasks, 'task')}.`,
    groups: shown,
    notes: notes(parsed),
    fresh: tally.fresh,
    unresolved,
    button: count > 0 ? `Add ${counted(count, 'task')}` : 'Add tasks',
    disabled: tally.fresh === 0 || unresolved,
    plan: [...tally.plan.values()],
  };
}

/** "Added 5 tasks." once the paste is in. */
export function pastedText(count) {
  return `Added ${counted(count, 'task')}.`;
}
