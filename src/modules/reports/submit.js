// Submitting a report (build guide 7.4.5-7.4.7): validation, revision, snapshot and the Slack post.
import { db, toJson } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { emit } from '@/lib/events';
import { logger } from '@/lib/logger';
import { nowDate } from '@/lib/time';
import { slack } from '@/modules/slack';
import * as repo from './repo';
import { MAX_TASK_LENGTH } from './schemas';
import { assertEditable, getOwnReport } from './drafts';
import { checkPriorityLinks } from './links';
import { checkProjects, confirmRequests, lockStoredRows, saveDraft, writeEntries } from './save';
import { loadEntriesFor, loadReportView, snapshotOf } from './view';

export const MAX_DAY_MINUTES = 16 * 60;

/**
 * The submit rules: at least one project; each project with hours above 0 in 0.25-hour steps and
 * at least one task; tasks 2 to 500 characters; no project twice; 16 hours or less in total.
 * Empty task rows (nothing typed) are ignored. Field keys follow the order sent, for example
 * 'entries.0.hours' or 'entries.1.tasks.0.title'.
 * @param {Array<{ projectId?: number|null, projectRequestId?: number|null, minutes: number,
 *   tasks: Array<{ title: string }> }>} entries
 * @returns {AppError | null} a VALIDATION_FAILED error, or null when the report can be submitted
 */
export function submitProblems(entries) {
  const fields = {};
  const add = (key, message) => {
    if (!fields[key]) fields[key] = message;
  };
  if (entries.length === 0) add('entries', 'Add at least one project before you submit.');
  const seen = new Set();
  let total = 0;
  entries.forEach((entry, i) => {
    const minutes = Number(entry.minutes) || 0;
    total += minutes;
    if (minutes <= 0) add(`entries.${i}.hours`, 'Hours must be above 0.');
    else if (minutes % 15 !== 0) add(`entries.${i}.hours`, 'Use steps of 0.25 hours.');
    const key = entry.projectId ? `p${entry.projectId}` : `r${entry.projectRequestId}`;
    if (seen.has(key)) add(`entries.${i}.project`, 'This project is already in the report.');
    seen.add(key);
    let written = 0;
    entry.tasks.forEach((task, j) => {
      const title = String(task.title ?? '').trim();
      if (!title) return;
      written += 1;
      if (title.length < 2) add(`entries.${i}.tasks.${j}.title`, 'Write at least 2 characters.');
      if (title.length > MAX_TASK_LENGTH) {
        add(`entries.${i}.tasks.${j}.title`, `Keep the task under ${MAX_TASK_LENGTH} characters.`);
      }
    });
    if (written === 0) add(`entries.${i}.tasks`, 'Add at least one task.');
  });
  if (total > MAX_DAY_MINUTES) add('total', 'A day can have at most 16 hours.');
  const messages = Object.values(fields);
  if (messages.length === 0) return null;
  return new AppError('VALIDATION_FAILED', { message: messages[0], fields });
}

function inputForCheck(entries) {
  return entries.map((entry) => ({
    projectId: entry.projectId,
    projectRequestId: entry.projectRequestId,
    minutes: Math.round(entry.hours * 60),
    tasks: entry.tasks,
  }));
}

/** Inside the submit transaction: new revision, snapshot, Slack post. Returns nothing. */
async function recordSubmit({ user, locked, stored }, trx) {
  const blankTaskIds = stored.flatMap((entry) =>
    entry.tasks.filter((task) => !task.title.trim()).map((task) => task.id),
  );
  await repo.deleteTasks(blankTaskIds, trx);
  const clean = stored.map((entry) => ({
    ...entry,
    tasks: entry.tasks.filter((task) => task.title.trim()),
  }));
  const snapshot = snapshotOf(clean);
  const at = nowDate();
  const revision = (Number(locked.revision) || 0) + 1;
  // A save after the lock comes from an approved edit request; its reason explains the revision.
  const approved = locked.unlockedUntil
    ? await repo.findLatestApprovedRequest(locked.id, trx)
    : null;
  await repo.updateReport(
    locked.id,
    {
      status: 'submitted',
      revision,
      totalMinutes: snapshot.totalMinutes,
      firstSubmittedAt: locked.firstSubmittedAt ?? at,
      submittedAt: at,
      unlockedUntil: null,
      updatedAt: at,
    },
    trx,
  );
  await repo.insertRevision(
    {
      reportId: locked.id,
      revision,
      snapshot: toJson(snapshot),
      editedBy: user.id,
      reason: approved?.reason ?? null,
      createdAt: at,
    },
    trx,
  );
  await slack.queueReportPost(
    {
      report: {
        id: locked.id,
        workDate: locked.workDate,
        slackTs: locked.slackTs,
        slackChannelId: locked.slackChannelId,
      },
      userName: user.name,
      userSlackUserId: user.slackUserId ?? null,
      avatarUrl: user.avatarUrl ?? null,
      entries: snapshot.entries,
    },
    trx,
  );
  return revision;
}

/**
 * Submits (or resubmits) the person's report. With `entries`, the latest changes are saved in
 * the same step. On success: revision + 1, first_submitted_at / submitted_at, a snapshot in
 * report_revisions, unlocked_until cleared and the Slack post queued (the first submit posts,
 * later ones update the same message), all in one transaction. When the rules fail nothing is
 * submitted; a caller without `baseVersion` still gets a draft's changes saved so nothing typed
 * is lost (the report page sends a version and saves its draft itself, to learn the new version).
 * @param {{ user: object, reportId: number, entries?: object[], baseVersion?: string }} input
 *   baseVersion is the report version the page last saw; a newer stored report is refused.
 *   Task lines may carry `projectTaskId` (checked with checkPriorityLinks); the revision snapshot
 *   keeps it, the Slack text doesn't show it.
 * @returns {Promise<object>} the submitted report view
 * @throws NOT_FOUND, FORBIDDEN, REPORT_LOCKED, PROJECT_NOT_ACTIVE, CONFLICT, VALIDATION_FAILED
 */
export async function submitReport({ user, reportId, entries, baseVersion }) {
  const report = await getOwnReport(user, reportId);
  assertEditable(report);
  if (entries) {
    await checkProjects({ user, reportId, entries });
    await checkPriorityLinks({ reportId, entries });
    const problem = submitProblems(inputForCheck(entries));
    if (problem) {
      if (report.status === 'draft' && baseVersion === undefined) {
        await saveDraft({ user, reportId, entries }).catch((error) =>
          logger.warn({ err: error, reportId }, 'saving a draft after a refused submit failed'),
        );
      }
      throw problem;
    }
  }
  let revision;
  await db.transaction(async (trx) => {
    const locked = await repo.findByIdForUpdate(reportId, trx);
    assertEditable(locked);
    if (entries) {
      // Again under share locks, so a task deleted or marked done meanwhile can't slip in.
      await checkPriorityLinks({ reportId, entries }, trx);
      await confirmRequests({ user, entries }, trx);
      await writeEntries(locked, entries, trx, { baseVersion });
    } else {
      await lockStoredRows(locked, trx, { baseVersion });
    }
    const stored = (await loadEntriesFor([reportId], trx)).get(reportId) ?? [];
    const problem = submitProblems(stored);
    if (problem) throw problem;
    revision = await recordSubmit({ user, locked, stored }, trx);
  });
  await emit('report.submitted', {
    reportId,
    userId: user.id,
    workDate: report.workDate,
    revision,
  });
  return loadReportView(await repo.findById(reportId));
}

/**
 * PUT /api/reports/:id. Drafts autosave; after the first submit every save is a new revision
 * (build guide 7.4.7), so saving a submitted report submits it again.
 * @param {{ user: object, reportId: number, entries: object[], baseVersion?: string }} input
 * @throws NOT_FOUND, FORBIDDEN, REPORT_LOCKED, PROJECT_NOT_ACTIVE, CONFLICT, VALIDATION_FAILED
 */
export async function saveReport({ user, reportId, entries, baseVersion }) {
  const report = await getOwnReport(user, reportId);
  if (report.status === 'submitted') {
    return submitReport({ user, reportId, entries, baseVersion });
  }
  return saveDraft({ user, reportId, entries, baseVersion });
}
