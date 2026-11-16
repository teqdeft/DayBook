// Adding lines to today's to-do (CONTRACT 24): a typed line, "Add to today" from a suggestion,
// "Add to to-do" from a priority task, and a pasted list. The first add of the day opens today's
// draft (empty), then its project card (0 minutes) and the line, through the write flow in
// todoWrite.js. Typed lines start In progress, whatever "New tasks start as" says (pasted ones
// keep the status the paste gave); a line equal to a suggestion of its project (by normalised
// title), or sent with its id, is carried from it and keeps the suggestion's status.
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { nowDate } from '@/lib/time';
import * as repo from './repo';
import { resolveCarried } from './carry';
import { checkPriorityLinks } from './links';
import { checkProjects, confirmRequests, lockStoredRows } from './save';
import { MAX_ENTRIES, MAX_TASKS_PER_ENTRY } from './schemas';
import { todoBulkSchema, todoLineCreateSchema } from './todoSchemas';
import { listCarrySuggestions } from './suggestions';
import * as todoRepo from './todoRepo';
import { getTodo } from './todoRead';
import { normalizeTitle } from './todoText';
import { lineIdIn } from './todoView';
import {
  assertTodoWritable,
  findTodayReport,
  lockTodayReport,
  openToday,
  parseTodoInput,
  retryOnDeadlock,
  withFieldNames,
} from './todoWrite';
import { lineTransaction } from './writeTx';

const keyOf = (group) => (group.projectId ? `p${group.projectId}` : `r${group.projectRequestId}`);

/**
 * The save checks' field names the to-do's way: entries.N.project -> groups.N.projectId (or
 * projectRequestId), entries.N.tasks.M.projectTaskId -> groups.N.lines.M.projectTaskId. A single
 * line names its own fields (projectId, projectTaskId).
 */
function namer(groups, single) {
  return (key) => {
    const project = /^entries\.(\d+)\.project$/.exec(key);
    if (project) {
      const field = groups[project[1]]?.projectId ? 'projectId' : 'projectRequestId';
      return single ? field : `groups.${project[1]}.${field}`;
    }
    const link = /^entries\.(\d+)\.tasks\.(\d+)\.projectTaskId$/.exec(key);
    if (link) return single ? 'projectTaskId' : `groups.${link[1]}.lines.${link[2]}.projectTaskId`;
    return key;
  };
}

function limitError(field, message) {
  return new AppError('VALIDATION_FAILED', { message, fields: { [field]: message } });
}

/**
 * Per project of the request: the entry it goes into (null: a new one), and the lines to add,
 * leaving out a line whose normalised title (or priority task) the project already has, in the
 * report or earlier in the same request. Several groups of one project merge.
 */
function planAdds({ groups, entries, tasks }) {
  const plans = new Map();
  let skipped = 0;
  groups.forEach((group, index) => {
    const key = keyOf(group);
    if (!plans.has(key)) {
      const entry = entries.find((row) => keyOf(row) === key) ?? null;
      const stored = entry ? tasks.filter((task) => task.entryId === entry.id) : [];
      plans.set(key, {
        key,
        index,
        entry,
        projectId: group.projectId ?? null,
        projectRequestId: group.projectRequestId ?? null,
        rows: stored.length,
        lastOrder: Math.max(-1, ...stored.map((task) => Number(task.sortOrder))),
        titles: new Set(stored.map((task) => normalizeTitle(task.title)).filter(Boolean)),
        links: new Set(stored.map((task) => Number(task.projectTaskId)).filter(Boolean)),
        adds: [],
      });
    }
    const plan = plans.get(key);
    for (const line of group.lines) {
      const title = normalizeTitle(line.title);
      const link = Number(line.projectTaskId) || null;
      if (plan.titles.has(title) || (link && plan.links.has(link))) {
        skipped += 1;
        continue;
      }
      plan.titles.add(title);
      if (link) plan.links.add(link);
      plan.adds.push({ ...line, normalized: title });
    }
  });
  return { plans: [...plans.values()], skipped };
}

/** @throws VALIDATION_FAILED past 20 projects in the report or 50 tasks on one */
function checkLimits({ entries, plans, single }) {
  const added = plans.filter((plan) => !plan.entry && plan.adds.length > 0).length;
  if (entries.length + added > MAX_ENTRIES) {
    throw limitError(single ? 'projectId' : 'groups', 'A report can have up to 20 projects.');
  }
  for (const plan of plans) {
    if (plan.rows + plan.adds.length > MAX_TASKS_PER_ENTRY) {
      const field = single ? 'title' : `groups.${plan.index}.lines`;
      throw limitError(field, `A project can have up to ${MAX_TASKS_PER_ENTRY} tasks.`);
    }
  }
}

/** The day's suggestions to match typed and pasted titles against ({} when none are needed). */
async function suggestionsToMatch(user, today, groups) {
  const typed = groups.some((group) => group.lines.some((line) => !line.carriedFromTaskId));
  if (!typed) return {};
  try {
    return await listCarrySuggestions({ userId: user.id, date: today });
  } catch (error) {
    logger.warn({ err: error, userId: user.id }, 'could not read the suggestions for a to-do add');
    return {};
  }
}

/**
 * Which new lines are carried, checked by resolveCarried (the report save's rules) under the
 * transaction's locks, and the status of each source (a carried line keeps it).
 */
async function carriedLines({ report, plans, suggestions, keepNotes }, trx) {
  const claims = [];
  for (const plan of plans) {
    for (const add of plan.adds) {
      const match = (suggestions[plan.key] ?? []).find(
        (task) => normalizeTitle(task.title) === add.normalized,
      );
      const sourceId = add.carriedFromTaskId ?? match?.taskId;
      if (!sourceId) continue;
      claims.push({
        key: add,
        sourceId,
        projectId: plan.projectId,
        projectRequestId: plan.projectRequestId,
        projectTaskId: add.projectTaskId ?? null,
        timerNote: null,
      });
    }
  }
  const { userId, workDate } = report;
  const carried = await resolveCarried({ userId, workDate, keepNotes, claims }, trx);
  const ids = [...carried.values()].map((link) => link.carriedFromTaskId);
  const sources = await todoRepo.listSourceLines(ids, trx);
  return { carried, statuses: new Map(sources.map((row) => [Number(row.id), row.status])) };
}

/** Inserts the planned entries (0 minutes) and lines. @returns {Promise<number>} lines added */
async function writeAdds({ report, entries, plans, carried, statuses, keepNotes }, trx) {
  const at = nowDate();
  let entryOrder = Math.max(-1, ...entries.map((entry) => Number(entry.sortOrder))) + 1;
  let added = 0;
  for (const plan of plans) {
    if (plan.adds.length === 0) continue;
    const { projectId, projectRequestId } = plan;
    const entryId =
      plan.entry?.id ??
      (await repo.insertEntry(
        {
          reportId: report.id,
          projectId,
          projectRequestId,
          minutes: 0,
          sortOrder: entryOrder++,
          createdAt: at,
          updatedAt: at,
        },
        trx,
      ));
    let taskOrder = plan.lastOrder + 1;
    for (const add of plan.adds) {
      const link = carried.get(add);
      const status = link && add.status !== 'done' ? statuses.get(link.carriedFromTaskId) : null;
      await repo.insertTask(
        {
          entryId,
          title: add.title,
          status: status ?? add.status,
          projectTaskId: link ? link.projectTaskId : (add.projectTaskId ?? null),
          ...(keepNotes ? { timerNote: link?.timerNote ?? null } : null),
          firstReportedOn: link?.firstReportedOn ?? report.workDate,
          carriedFromTaskId: link?.carriedFromTaskId ?? null,
          sortOrder: taskOrder++,
          createdAt: at,
          updatedAt: at,
        },
        trx,
      );
      added += 1;
    }
  }
  if (added > 0) await repo.updateReport(report.id, { updatedAt: at }, trx);
  return added;
}

/**
 * The shared add: groups of lines into today's report, in one transaction (READ COMMITTED,
 * writeTx.js).
 * @returns {Promise<{ added: number, skipped: number }>}
 */
function addGroups({ user, groups, single }) {
  const rename = namer(groups, single);
  return retryOnDeadlock(async () => {
    const { today, report: existing } = await findTodayReport(user);
    if (existing) assertTodoWritable(existing);
    const reportId = existing?.id ?? null;
    // Checked before the draft is created, so a refused add leaves no empty draft behind.
    await withFieldNames(
      () => checkProjects({ user, reportId, workDate: today, entries: groups }),
      rename,
    );
    const suggestions = await suggestionsToMatch(user, today, groups);
    const id = reportId ?? (await openToday(user, today));
    return lineTransaction(async (trx) => {
      const report = await lockTodayReport(id, trx);
      // Before the entry and task rows are locked, as a report save does.
      const linked = groups.map((group) => ({ ...group, tasks: group.lines }));
      await withFieldNames(
        () => checkPriorityLinks({ reportId: id, entries: linked }, trx),
        rename,
      );
      await withFieldNames(() => confirmRequests({ user, entries: groups }, trx), rename);
      const { entries, tasks } = await lockStoredRows(report, trx);
      const { plans, skipped } = planAdds({ groups, entries, tasks });
      checkLimits({ entries, plans, single });
      const keepNotes = await repo.hasTimerNote(trx);
      const links = await carriedLines({ report, plans, suggestions, keepNotes }, trx);
      const added = await writeAdds({ report, entries, plans, ...links, keepNotes }, trx);
      return { added, skipped };
    });
  });
}

/**
 * Adds one line to a project of today's to-do (the project too when it isn't there yet). A
 * title the project already has (normalised) is skipped, not an error. With
 * `carriedFromTaskId`, or a title equal to a suggestion's on the project, the line is carried
 * from that open task: it keeps the task's status and copies its first_reported_on,
 * project_task_id and timer_note (a link that fails the checks is dropped and the line is new).
 * @param {{ user: object, projectId?: number, projectRequestId?: number, title: string,
 *   projectTaskId?: number, carriedFromTaskId?: number }} input as todoLineCreateSchema
 * @returns {Promise<object>} the new to-do (getTodo) plus `added` (false for a duplicate) and
 *   `lineId` (the new line, or the line it duplicates)
 * @throws VALIDATION_FAILED (title, project, priority task, "A report can have up to 20
 *   projects.", "A project can have up to 50 tasks."), PROJECT_NOT_ACTIVE, REPORT_LOCKED
 *   ("Your report is in. Change tasks in the report." after submit)
 */
export async function addTodoLine({ user, ...input }) {
  const line = parseTodoInput(todoLineCreateSchema, input);
  const group = {
    projectId: line.projectId ?? null,
    projectRequestId: line.projectRequestId ?? null,
    lines: [
      {
        title: line.title,
        status: 'in_progress',
        projectTaskId: line.projectTaskId ?? null,
        carriedFromTaskId: line.carriedFromTaskId ?? null,
      },
    ],
  };
  const { added } = await addGroups({ user, groups: [group], single: true });
  const todo = await getTodo({ user });
  return { ...todo, added: added > 0, lineId: lineIdIn(todo, keyOf(group), line.title) };
}

/**
 * Adds a pasted list: lines per project (groups of one project merge), each In progress, Done or
 * Blocked as the paste said. Lines the project already has, or that the paste repeats, are
 * skipped and counted; a line equal to a suggestion is carried (Done when the paste said so,
 * otherwise the suggestion's status). All or nothing.
 * @param {{ user: object, groups: Array<{ projectId?: number, projectRequestId?: number,
 *   lines: Array<{ title: string, status?: 'done' | 'in_progress' | 'blocked' }> }> }} input
 * @returns {Promise<{ added: number, skipped: number, todo: object }>}
 * @throws VALIDATION_FAILED, PROJECT_NOT_ACTIVE, REPORT_LOCKED
 */
export async function addTodoLines({ user, groups }) {
  const input = parseTodoInput(todoBulkSchema, { groups });
  const planned = input.groups.map((group) => ({
    projectId: group.projectId ?? null,
    projectRequestId: group.projectRequestId ?? null,
    lines: group.lines.map((line) => ({ ...line, projectTaskId: null, carriedFromTaskId: null })),
  }));
  const { added, skipped } = await addGroups({ user, groups: planned, single: false });
  return { added, skipped, todo: await getTodo({ user }) };
}
