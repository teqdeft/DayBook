// Unfinished-task suggestions (CONTRACT 24, Request 4): a person's open tasks from past reports,
// shown when their project is picked on Today or in the report, and "Done already" / "Not needed"
// on one of them. Carrying a suggestion into a report is checked in carry.js.
//
// Open task = a line In progress or Blocked in a submitted report that no later line was carried
// from and that isn't closed. Suggestion = an open task from the last 30 days before the day, on a
// project still active (or a project request still pending), with no later line of the person
// on the same project with the same normalised title (any status, drafts included). A draft that
// locked unsubmitted (a missed day) never became a report, so its lines count for none of this.
import { AppError } from '@/lib/errors';
import { addDays, now, nowDate, workDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { preferences } from '@/modules/preferences';
import { projects } from '@/modules/projects';
import { settings } from '@/modules/settings';
import * as carryRepo from './carryRepo';
import { dayLabel, normalizeTitle } from './todoText';
import { isEditable } from './view';
import { lineTransaction } from './writeTx';

export const SUGGESTION_DAYS = 30;
export const SUGGESTIONS_PER_PROJECT = 10;
export const SUGGESTION_PROJECTS = 20;
/** The task statuses a line can be open in (the rest of TASK_STATUSES is Done). */
export const OPEN_STATUSES = new Set(['in_progress', 'blocked']);
export const CLOSE_REASONS = ['done', 'dropped'];

/** 'p12' for a project, 'r4' for a project request (the report page's projectKey). */
export function projectKeyOf(line) {
  return line.projectId ? `p${line.projectId}` : `r${line.projectRequestId}`;
}

/**
 * A draft that locked without being submitted (a missed day) and that no approved edit request
 * keeps open. Its lines never become open tasks, so they neither carry a task on nor hide it from
 * the suggestions: the task is suggested again, can be closed and can be carried again.
 * @param {{ reportStatus: string, locksAt: Date, unlockedUntil?: Date | null }} row a line with
 *   its report's status and lock times (listLinesSince, listCarriers)
 * @param {import('dayjs').Dayjs} [at]
 */
export function isLapsedDraft(row, at = now()) {
  return row.reportStatus !== 'submitted' && !isEditable(row, at);
}

/** A line that can be suggested on its own: open, submitted, inside the window. */
function isCandidate(line, { from, date }) {
  return (
    line.reportStatus === 'submitted' &&
    OPEN_STATUSES.has(line.status) &&
    line.workDate >= from &&
    line.workDate < date &&
    !line.carryClosedAt
  );
}

/**
 * The open tasks to suggest per project, from listLinesSince() rows (pure). Each project's tasks
 * are newest first, at most SUGGESTIONS_PER_PROJECT; projects come in the order of their newest
 * task. A task carried by any line, closed, or with a later line of the same project and
 * normalised title is left out; of equal titles the newest wins. Lines marked `lapsed` (a draft
 * that locked unsubmitted, isLapsedDraft) are left out first, as if never written.
 * @param {Array<{ id, title, status, carriedFromTaskId, carryClosedAt?, workDate, reportStatus,
 *   projectId, projectRequestId, lapsed? }>} allLines newest day first
 * @param {{ from: string, date: string }} window sources from `from` up to the day before `date`
 * @returns {Map<string, { projectId: number | null, projectRequestId: number | null,
 *   tasks: object[] }>} projectKey -> the project and its lines
 */
export function openTasksByProject(allLines, { from, date }) {
  const lines = allLines.filter((line) => !line.lapsed);
  const carried = new Set(lines.map((line) => Number(line.carriedFromTaskId)).filter(Boolean));
  const lastDay = new Map();
  for (const line of lines) {
    const id = `${projectKeyOf(line)}|${normalizeTitle(line.title)}`;
    if (!lastDay.has(id) || line.workDate > lastDay.get(id)) lastDay.set(id, line.workDate);
  }
  const groups = new Map();
  const seen = new Set();
  for (const line of lines) {
    const title = normalizeTitle(line.title);
    const key = projectKeyOf(line);
    const id = `${key}|${title}`;
    if (!title || !isCandidate(line, { from, date }) || carried.has(Number(line.id))) continue;
    if (seen.has(id) || lastDay.get(id) > line.workDate) continue;
    seen.add(id);
    if (!groups.has(key)) {
      groups.set(key, {
        projectId: line.projectId ?? null,
        projectRequestId: line.projectRequestId ?? null,
        tasks: [],
      });
    }
    const group = groups.get(key);
    if (group.tasks.length < SUGGESTIONS_PER_PROJECT) group.tasks.push(line);
  }
  return groups;
}

/** Whether a project is still active, or a project request still the person's pending one. */
async function stillOpen(group, userId) {
  if (group.projectId) return projects.isActive(group.projectId);
  return Boolean(await projects.findPendingRequestForUser(group.projectRequestId, userId));
}

/** The keys of the groups whose project is still open, at most SUGGESTION_PROJECTS of them. */
async function openKeys(groups, userId) {
  const keys = [...groups.keys()];
  const open = new Set();
  for (let i = 0; i < keys.length && open.size < SUGGESTION_PROJECTS; i += SUGGESTION_PROJECTS) {
    const batch = keys.slice(i, i + SUGGESTION_PROJECTS);
    const answers = await Promise.all(batch.map((key) => stillOpen(groups.get(key), userId)));
    batch.forEach((key, index) => {
      if (answers[index]) open.add(key);
    });
  }
  return open;
}

/**
 * A person's unfinished tasks to suggest for a day, by project (see the file header): newest
 * first, at most 10 per project and 20 projects. Empty while their carry forward preference
 * (`carryOver`, My settings) is off. One query for the lines, then the projects service for the
 * active check. Before migration 017 closed tasks can't be told apart and are not left out (one
 * warning in the log).
 * @param {{ userId: number, date?: string }} input date 'YYYY-MM-DD', the day of the to-do or
 *   report (default today in the company time zone)
 * @returns {Promise<Record<string, Array<{ taskId: number, title: string,
 *   status: 'in_progress' | 'blocked', workDate: string, dayLabel: string }>>>} projectKey ('p12'
 *   or 'r4') -> tasks, projects in the order of their newest task
 */
export async function listCarrySuggestions({ userId, date }) {
  const { carryOver } = await preferences.getFor(userId);
  if (!carryOver) return {};
  const day = date ?? workDate((await settings.getAll()).timezone);
  const from = addDays(day, -SUGGESTION_DAYS);
  const at = now();
  const lines = await carryRepo.withClosedColumns((withClosed) =>
    carryRepo.listLinesSince(userId, from, { withClosed }),
  );
  const marked = lines.map((line) => ({ ...line, lapsed: isLapsedDraft(line, at) }));
  const groups = openTasksByProject(marked, { from, date: day });
  const open = await openKeys(groups, userId);
  const result = {};
  for (const [key, group] of groups) {
    if (!open.has(key) || Object.keys(result).length >= SUGGESTION_PROJECTS) continue;
    result[key] = group.tasks.map((line) => ({
      taskId: Number(line.id),
      title: line.title,
      status: line.status,
      workDate: line.workDate,
      dayLabel: dayLabel(line.workDate, day),
    }));
  }
  return result;
}

function taskNotFound() {
  return new AppError('NOT_FOUND', {
    message: "We couldn't find that open task. Reload the page to see the latest.",
  });
}

function todoUnavailable() {
  return new AppError('TODO_UNAVAILABLE', {
    status: 503,
    message: 'This needs the latest database update. Ask an Admin.',
  });
}

/** The person's own line, In progress or Blocked, in a submitted report. */
function isOwnOpenLine(line, user) {
  return (
    Boolean(line) &&
    Number(line.userId) === Number(user.id) &&
    line.reportStatus === 'submitted' &&
    OPEN_STATUSES.has(line.status)
  );
}

/** Inside the transaction, with the line locked: closes it, or opens it again (undo). */
async function writeClosed({ user, line, reason, undo, ip }, trx) {
  if (undo) {
    // A second Undo (or one for a line that was never closed) changes nothing.
    if (!line.carryClosedAt) return;
    await carryRepo.setClosed(line.id, { carryClosedAt: null, carryClosedReason: null }, trx);
  } else {
    if (line.carryClosedAt) throw taskNotFound();
    const carriers = await carryRepo.listCarriers([line.id], trx);
    if (carriers.some((row) => !isLapsedDraft(row))) throw taskNotFound();
    await carryRepo.setClosed(
      line.id,
      { carryClosedAt: nowDate(), carryClosedReason: reason },
      trx,
    );
  }
  await audit.log(
    {
      actorId: user.id,
      action: undo ? 'report.carry_reopen' : 'report.carry_close',
      entityType: 'report_task',
      entityId: line.id,
      before: { reason: line.carryClosedReason ?? null },
      after: { reason: undo ? null : reason },
      ip,
    },
    trx,
  );
}

/**
 * "Done already" (reason 'done') or "Not needed" ('dropped') on a suggestion: closes the person's
 * open line without bringing it into today. Only the old line changes (carry_closed_at and
 * carry_closed_reason): no new revision, no Slack update, the report's version stays. With
 * `undo` it opens a line the person closed again (nothing happens when it isn't closed).
 * @param {{ user: { id: number }, taskId: number, reason: 'done' | 'dropped', undo?: boolean,
 *   ip?: string | null }} input
 * @returns {Promise<{ taskId: number, closed: boolean, reason: 'done' | 'dropped' | null }>}
 * @throws NOT_FOUND (a line that isn't the person's own, or isn't open: never FORBIDDEN),
 *   TODO_UNAVAILABLE (503, migration 017 hasn't run)
 */
export async function closeSuggestion({ user, taskId, reason, undo = false, ip = null }) {
  const id = Number(taskId);
  if (!Number.isSafeInteger(id) || id <= 0) throw taskNotFound();
  if (!undo && !CLOSE_REASONS.includes(reason)) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Pick Done already or Not needed.',
      fields: { reason: 'Pick Done already or Not needed.' },
    });
  }
  try {
    // READ COMMITTED (writeTx.js): the carriers read after the lock sees the latest commit.
    await lineTransaction(async (trx) => {
      const [line] = await carryRepo.lockLines([id], { withClosed: true }, trx);
      if (!isOwnOpenLine(line, user)) throw taskNotFound();
      await writeClosed({ user, line, reason, undo, ip }, trx);
    });
  } catch (error) {
    if (carryRepo.isClosedMissing(error)) throw todoUnavailable();
    throw error;
  }
  return { taskId: id, closed: !undo, reason: undo ? null : reason };
}
