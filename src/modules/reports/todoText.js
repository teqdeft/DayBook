// Today's to-do as text (CONTRACT 24 "Paste a list"): reads the list people already post on Slack
// ("Project: Pine Tree lane" then "* task" lines) into projects and task lines, matches a heading
// to a project, and names the day a carried line comes from. Pure and browser-safe: Today's paste
// dialog imports it in the browser (an exception to CONTRACT 2, like @/modules/slack/format), so
// it imports nothing but @/lib/time. Statuses are the report's own (reports/schemas.js
// TASK_STATUSES).
import { dayjs, formatDayMonthShort, formatWeekday } from '@/lib/time';

/**
 * The paste's limits: the report's (reports/schemas.js MAX_ENTRIES, MAX_TASKS_PER_ENTRY,
 * MAX_TASK_LENGTH; a unit test keeps them equal, they aren't imported so the browser doesn't load
 * zod) and the paste box's 20,000 characters.
 */
export const TODO_LIMITS = Object.freeze({
  projects: 20,
  tasksPerProject: 50,
  titleMin: 2,
  titleMax: 500,
  textMax: 20000,
});

/** Close matches need this many letters and digits on both sides ("Website SEO audit" vs "SEO"). */
const CLOSE_MIN_LENGTH = 4;
const DATE = 'YYYY-MM-DD';

const LINE_BREAK = /\r\n|[\r\n\u2028\u2029]/;
/** Daybook's own lines, ignored anywhere: "Tasks", "Today's to-do", the date and the hours. */
const IGNORED = [
  /^tasks:?$/i,
  /^today['’]?s to[- ]?do:?$/i,
  /^date\s*:\s*\d{1,2}-\d{1,2}-\d{4}$/i,
  /^hours\s*:\s*(?:\d+h(?:\s*\d+m)?|\d+m)$/i,
];
/** "Name: Priya Sharma", ignored only before the first heading. */
const NAME_LINE = /^name\s*:/i;
/** A bullet sign (spaces after it optional) or a number with "." or ")" and a space: "1. ". */
const BULLET = /^(?:[*•◦▪‣+·\-–—]\s*|\d+[.)]\s+)(.*)$/;
/** "Project— Pine Tree lane", "Project- Studioubique", "Project: Dotado": always a heading. */
const STRONG_HEADING = /^project\s*[—–\-:]+\s*(.+)$/i;
/** "Project Dotado": a heading only when the rest names a project exactly. */
const WEAK_HEADING = /^project\s+(.+)$/i;
/** A trailing "(Done)", "(In progress)" or "(Blocked)", any case, spaces before it allowed. */
const STATUS_SUFFIX = /\s*\(\s*(done|in[ -]?progress|blocked)\s*\)$/i;

/**
 * A task title as it is compared everywhere (duplicates on a project, a typed or pasted title
 * equal to a suggestion, a running timer's note against a line): trimmed, every run of white
 * space one space, lower case. 'Fix  the\tBuild ' -> 'fix the build'. Unlike compactName
 * (@/lib/text) it keeps the spaces between words, so 'a b' and 'ab' stay different.
 * @param {string} title
 * @returns {string}
 */
export function normalizeTitle(title) {
  return String(title ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * A project name or heading as matchProject compares it: lower case, accents and everything but
 * letters and digits removed. 'Studio Ubique' and 'Studioubique' -> 'studioubique',
 * 'Café Noir 🚀' -> 'cafenoir'. Stricter than compactName (@/lib/text), which keeps accents and
 * punctuation.
 * @param {string} name
 * @returns {string}
 */
export function normalizeName(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * The project a pasted heading names. Both sides are normalised (normalizeName). Equal = 'exact'
 * ("Studioubique" = "Studio Ubique"; when several projects normalise the same, the one written the
 * same apart from case and spaces wins, else the first). Else 'close' = exactly one project whose
 * normalised name starts with the heading's, or the heading's starts with the name's, both at
 * least 4 characters ("Riverkraft website" -> "Riverkraft"; "Website SEO audit" never picks
 * "SEO"; two candidates give none). Else 'none'.
 * @param {string} heading
 * @param {Array<{ name: string }>} projects pickable projects (and project requests); returned as
 *   given
 * @returns {{ kind: 'exact' | 'close' | 'none', project: object | null }}
 */
export function matchProject(heading, projects) {
  return matchIn(heading, indexProjects(projects));
}

/** The projects with their normalised names, worked out once per paste. */
function indexProjects(projects) {
  return (projects ?? [])
    .filter((project) => project && project.name !== null && project.name !== undefined)
    .map((project) => ({ project, key: normalizeName(project.name) }));
}

/** matchProject on indexProjects' list. */
function matchIn(heading, index) {
  const wanted = normalizeName(heading);
  if (!wanted) return { kind: 'none', project: null };
  const exact = index.filter((item) => item.key === wanted);
  if (exact.length > 0) {
    const text = normalizeTitle(heading);
    const same = exact.find((item) => normalizeTitle(item.project.name) === text);
    return { kind: 'exact', project: (same ?? exact[0]).project };
  }
  if (wanted.length < CLOSE_MIN_LENGTH) return { kind: 'none', project: null };
  const close = index.filter(
    ({ key }) =>
      key.length >= CLOSE_MIN_LENGTH && (key.startsWith(wanted) || wanted.startsWith(key)),
  );
  return close.length === 1
    ? { kind: 'close', project: close[0].project }
    : { kind: 'none', project: null };
}

/**
 * A heading's name without the colons and spaces after it: 'Dotado:' -> 'Dotado'. A loop, not a
 * regular expression, so a long run of colons can't make it slow.
 */
function headingName(text) {
  let end = text.length;
  while (end > 0 && (text[end - 1] === ':' || text[end - 1] === ' ')) end -= 1;
  return text.slice(0, end).trim();
}

/**
 * The project name a non-bullet line starts a group with, or null when the line is a task.
 * "Project" with a dash or colon is always a heading; "Project" and a space only when the rest
 * names a project exactly ("Project kickoff call with client" is a task); a line ending with ":"
 * before the first heading, or when it names a project (exactly or closely).
 */
function headingOf(line, inGroup, index) {
  const strong = STRONG_HEADING.exec(line);
  const strongName = strong ? headingName(strong[1]) : '';
  if (strongName) return strongName;
  const weak = WEAK_HEADING.exec(line);
  const weakName = weak ? headingName(weak[1]) : '';
  if (weakName && matchIn(weakName, index).kind === 'exact') return weakName;
  if (!line.endsWith(':')) return null;
  const name = headingName(line);
  if (name && (!inGroup || matchIn(name, index).kind !== 'none')) return name;
  return null;
}

/** A task's title and status from its text: 'Publish the blog (Done)' -> done. */
function taskOf(text) {
  const match = STATUS_SUFFIX.exec(text);
  if (!match) return { title: text, status: 'in_progress' };
  const word = match[1].toLowerCase();
  const status = word === 'done' ? 'done' : word === 'blocked' ? 'blocked' : 'in_progress';
  return { title: text.slice(0, match.index).trim(), status };
}

/** Whether a line is one of Daybook's own words, or a name line before the first heading. */
function ignored(line, inGroup) {
  return IGNORED.some((pattern) => pattern.test(line)) || (!inGroup && NAME_LINE.test(line));
}

/** The text the parser reads: the first 20,000 characters (not cutting an emoji in two). */
function readable(text) {
  const value = String(text ?? '');
  if (value.length <= TODO_LIMITS.textMax) return { text: value, truncated: false };
  const code = value.charCodeAt(TODO_LIMITS.textMax - 1);
  const end = code >= 0xd800 && code <= 0xdbff ? TODO_LIMITS.textMax - 1 : TODO_LIMITS.textMax;
  return { text: value.slice(0, end), truncated: true };
}

/**
 * Leaves out headings with no lines and applies the report's limits: the first 20 projects, the
 * first 50 tasks of each (and of the loose lines). What is left out counts in `skipped` and in
 * `overLimit`.
 */
function withLimits({ groups, loose, skipped, truncated }) {
  const { projects: maxProjects, tasksPerProject: maxTasks } = TODO_LIMITS;
  const kept = [];
  let overLimit = Math.max(0, loose.length - maxTasks);
  for (const group of groups) {
    if (group.lines.length === 0) continue;
    if (kept.length === maxProjects) {
      overLimit += group.lines.length;
      continue;
    }
    overLimit += Math.max(0, group.lines.length - maxTasks);
    kept.push({ heading: group.heading, lines: group.lines.slice(0, maxTasks) });
  }
  return {
    groups: kept,
    loose: loose.slice(0, maxTasks),
    skipped: skipped + overLimit,
    overLimit,
    truncated,
  };
}

/**
 * Reads a pasted to-do (CONTRACT 24 "Parser"). Lines are trimmed and their spaces (tabs too)
 * collapse; blank lines are skipped. Ignored anywhere: "Tasks", "Today's to-do", "Date: 12-11-2026"
 * and "Hours: 2h 15m" (Daybook's own formats; any other "Date: ..." line is a task); "Name: ..."
 * only before the first heading. Bullets (* • ◦ ▪ ‣ + - – — · and "1." / "1)" with a space) are
 * dropped ("1.5h keyword audit" and "1 web blog publish" keep their text). A non-bullet line is a
 * heading (headingOf) or a task; tasks before any heading are `loose`. A trailing "(Done)",
 * "(In progress)" or "(Blocked)" sets the status (else in_progress). Titles under 2 or over 500
 * characters are skipped and counted. A heading written twice gives two groups, in order, as the
 * prototype does (both match the same project, and adding them merges them by project).
 * @param {string} text the pasted text; only the first 20,000 characters are read
 * @param {{ projects?: Array<{ name: string }> }} [options] the pickable projects, for
 *   "Project Dotado" and "Dotado:" headings (without them those lines are tasks, except a ":" line
 *   before the first heading)
 * @returns {{ groups: Array<{ heading: string, lines: Array<{ title: string, status: string }> }>,
 *   loose: Array<{ title: string, status: string }>, skipped: number, overLimit: number,
 *   truncated: boolean }} `skipped` counts every task left out (length and limits), `overLimit`
 *   those left out by the 20-project and 50-task limits, `truncated` whether text was over 20,000
 */
export function parseTodoText(text, options) {
  const source = readable(text);
  const index = indexProjects(options?.projects);
  const groups = [];
  const loose = [];
  let group = null;
  let skipped = 0;
  for (const raw of source.text.split(LINE_BREAK)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || ignored(line, group !== null)) continue;
    const bullet = BULLET.exec(line);
    const heading = bullet ? null : headingOf(line, group !== null, index);
    if (heading !== null) {
      group = { heading, lines: [] };
      groups.push(group);
      continue;
    }
    const task = taskOf((bullet ? bullet[1] : line).trim());
    if (task.title.length < TODO_LIMITS.titleMin || task.title.length > TODO_LIMITS.titleMax) {
      skipped += 1;
      continue;
    }
    (group ? group.lines : loose).push(task);
  }
  return withLimits({ groups, loose, skipped, truncated: source.truncated });
}

/** A real calendar date 'YYYY-MM-DD'. */
function isDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    dayjs(value, DATE, true).isValid()
  );
}

/**
 * The tag of a line carried from an earlier day, counted in calendar days back from `today`:
 * 'From yesterday' (1), 'From Wednesday' (2 to 6), 'From 2 Nov' (7 or more).
 * @param {string} workDate 'YYYY-MM-DD', the day of the report the line comes from
 * @param {string} today 'YYYY-MM-DD', the day of the to-do or report it is shown in
 * @returns {string | null} null when workDate isn't before today or a date isn't valid
 */
export function dayLabel(workDate, today) {
  if (!isDate(workDate) || !isDate(today)) return null;
  const back = dayjs(today, DATE).diff(dayjs(workDate, DATE), 'day');
  if (back < 1) return null;
  if (back === 1) return 'From yesterday';
  if (back < 7) return `From ${formatWeekday(workDate)}`;
  return `From ${formatDayMonthShort(workDate)}`;
}
