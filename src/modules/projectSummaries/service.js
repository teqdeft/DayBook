// AI summaries of a project's files and notes (CONTRACT 22). Documents live in documents.js; this file
// re-exports them so the module has one service object. The AI has no tools and its answer only
// passes through schemas.js and checks.js, so a document that says "move to Launch" can at most become
// a suggestion the PM has to click. Logs and audit rows never hold document or summary text. Ask
// Daybook never reads these tables.
import crypto from 'node:crypto';
import { db, parseJson, toJson } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { nowDate, workDate } from '@/lib/time';
import { ai } from '@/modules/ai';
import { audit } from '@/modules/audit';
import { projectPlan } from '@/modules/projectPlan';
import { guardPlanRead } from '@/modules/projectPlan/migrationGuard';
import { projectTasks } from '@/modules/projectTasks';
import { settings } from '@/modules/settings';
import { checkAnswer, keepTaskIds } from './checks';
import { ANSWER_SCHEMA, buildSummaryRequest, MAX_SENT_CHARACTERS } from './prompt';
import * as repo from './repo';
import { summaryTaskSchema } from './schemas';
import { guardDocumentWrite, manageableProject, parseInput, readableProject } from './shared';

export {
  addDocument,
  getDocument,
  listDocuments,
  removeDocument,
  updateDocument,
} from './documents';

/** A summary reads up to 50,000 characters, so it may take longer than the usual 30 s. */
const SUMMARY_TIMEOUT_MS = 55_000;
const MODEL_COLUMN_LENGTH = 60;
const CHANGED_MESSAGE = 'The summary changed. Reload the page.';

/**
 * The fingerprint of a project's documents: a summary is stale when it no longer matches.
 * @param {Array<{ id: number, updatedAt: Date }>} documents
 * @returns {string} sha256, 64 hex characters
 */
function sourceKey(documents) {
  const lines = documents
    .map((document) => `${document.id}:${new Date(document.updatedAt).toISOString()}`)
    .sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** How many files and notes a project has. */
function countSources(documents) {
  const files = documents.filter((document) => document.kind === 'file').length;
  return { files, notes: documents.length - files };
}

/** An action whose task has since been deleted can be added again, as in the prototype. */
async function withLiveTasks(body) {
  const ids = (body.actions ?? []).map((action) => action.taskId).filter(Boolean);
  if (ids.length === 0) return body;
  const tasks = await projectTasks.findByIds(ids);
  return {
    ...body,
    actions: body.actions.map((action) =>
      action.taskId && !tasks.has(action.taskId) ? { ...action, taskId: null } : action,
    ),
  };
}

async function readSummary(projectId) {
  const row = await repo.findSummary(projectId);
  if (!row) return null;
  const documents = await repo.listDocuments(projectId);
  return {
    body: await withLiveTasks(parseJson(row.body)),
    stale: row.sourceKey !== sourceKey(documents),
    truncated: Boolean(row.truncated),
    updatedAt: row.updatedAt,
    updatedByName: row.updatedByName ?? null,
    sources: countSources(documents),
  };
}

/**
 * A project's AI summary.
 * @param {{ user: object, projectId: number }} args
 * @returns {Promise<{ body: { overview: string, scope: object[], deadlines: object[],
 *   risks: object[], actions: object[], nextPhase: object | null }, stale: boolean,
 *   truncated: boolean, updatedAt: Date, updatedByName: string | null,
 *   sources: { files: number, notes: number } } | null>} null with no summary, and before migration
 *   015. A point has `source` ("SOW-Acme-v3.pdf, page 3"), `documentId`, `page` and `quote`; an action
 *   also has `key` and `taskId` (null until added)
 * @throws NOT_FOUND (also for anyone who can't manage the project)
 */
export async function getSummary({ user, projectId }) {
  const project = await readableProject(user, projectId);
  return guardPlanRead(
    () => readSummary(project.id),
    () => null,
  );
}

/** The documents the prompt can reach: newest first, until their lengths pass the total. */
function withinBudget(documents) {
  const picked = [];
  let used = 0;
  for (const document of documents) {
    if (used >= MAX_SENT_CHARACTERS) break;
    picked.push(document);
    used += document.charCount;
  }
  return picked;
}

/** The documents to send with their text, and the request for the AI. */
async function prepareRequest(project, documents) {
  const picked = withinBudget(documents);
  const bodies = await repo.listDocumentBodies(
    project.id,
    picked.map((document) => document.id),
  );
  const textOf = new Map(bodies.map((row) => [row.id, row.body]));
  const [plan, team, { timezone }] = await Promise.all([
    projectPlan.getPlan(project.id),
    repo.listTeam(project.id),
    settings.getAll(),
  ]);
  const request = buildSummaryRequest({
    project,
    currentPhase: plan.currentPhase,
    today: workDate(timezone),
    documents: picked
      .filter((document) => textOf.has(document.id))
      .map((document) => ({ ...document, body: textOf.get(document.id) })),
    people: [{ id: project.pmId, name: project.pmName }, ...team],
  });
  const left = documents.length > picked.length;
  return { ...request, truncated: request.truncated || left };
}

/** Asks the AI. This toast is on the project page, which says AI, never Gemini (CONTRACT 22). */
async function askAi(user, { system, prompt }) {
  try {
    const { data } = await ai.generate({
      feature: 'project_summary',
      userId: user.id,
      model: 'fast',
      system,
      prompt,
      json: ANSWER_SCHEMA,
      timeoutMs: SUMMARY_TIMEOUT_MS,
    });
    return data;
  } catch (error) {
    if (error?.code !== 'AI_BUSY') throw error;
    throw new AppError('AI_BUSY', { message: 'AI is busy. Try again in a minute.' });
  }
}

/** Saves the summary, keeping the task of each action that is still there. */
async function saveSummary({ user, projectId, checked, key, truncated, sent, ip }) {
  const at = nowDate();
  const { body, droppedCount } = checked;
  const row = {
    sourceKey: key,
    truncated,
    droppedCount,
    model: ai.modelName('fast').slice(0, MODEL_COLUMN_LENGTH),
    updatedBy: user.id,
    updatedAt: at,
  };
  await db.transaction(async (trx) => {
    const current = await repo.lockOrCreateSummary(
      { projectId, ...row, body: toJson(body), createdBy: user.id, createdAt: at },
      trx,
    );
    const actions = keepTaskIds(body.actions, parseJson(current.body)?.actions);
    await repo.updateSummary(projectId, { ...row, body: toJson({ ...body, actions }) }, trx);
    await audit.log(
      {
        actorId: user.id,
        action: 'project_summary.write',
        entityType: 'project',
        entityId: projectId,
        after: { documents: sent, truncated, droppedCount },
        ip,
      },
      trx,
    );
  });
}

/**
 * Writes or rewrites a project's summary: one AI request with the newest documents (up to 50,000
 * characters), then only what passes the checks is stored. The AI's call runs outside any
 * transaction. If a document changes during the call, the summary reads as stale afterwards.
 * @param {{ user: object, projectId: number, ip?: string | null }} args
 * @returns {Promise<object>} the summary (getSummary)
 * @throws FORBIDDEN, NOT_FOUND, NO_DOCUMENTS (409), AI_OFF (409), AI_LIMIT (429), AI_BUSY (503),
 *   AI_ERROR (502, also an answer with nothing usable; the old summary stays), PLAN_UNAVAILABLE (503)
 */
export async function writeSummary({ user, projectId, ip = null }) {
  const project = await manageableProject(user, projectId);
  if (!(await ai.isAvailable('project_summary'))) throw new AppError('AI_OFF');
  return guardDocumentWrite(async () => {
    const documents = await repo.listDocuments(project.id);
    if (documents.length === 0) {
      throw new AppError('NO_DOCUMENTS', {
        status: 409,
        message: 'Add a file or a note first.',
      });
    }
    const request = await prepareRequest(project, documents);
    const answer = await askAi(user, request);
    const finish = (text) => ai.redactContacts(ai.restoreNames(text, request.names));
    const checked = checkAnswer(answer, request.sent, { finish });
    if (!checked) throw new AppError('AI_ERROR');
    await saveSummary({
      user,
      projectId: project.id,
      checked,
      key: sourceKey(documents),
      truncated: request.truncated,
      sent: request.sent.length,
      ip,
    });
    return readSummary(project.id);
  });
}

/**
 * Adds an action item of the summary as one P2 task in the current phase, with no due date. A second
 * call for the same item adds nothing and answers the same task; once that task is deleted the item
 * can be added again.
 * @param {{ user: object, projectId: number, actionKey: string, ip?: string | null }} args
 * @returns {Promise<{ key: string, taskId: number, task: object }>}
 * @throws FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, SUMMARY_CHANGED (409, the item is gone),
 *   PROJECT_NOT_ACTIVE (409, a completed project), PLAN_UNAVAILABLE (503)
 */
export async function addActionAsTask({ user, projectId, actionKey, ip = null }) {
  const project = await manageableProject(user, projectId);
  const { actionKey: key } = parseInput(summaryTaskSchema, { actionKey });
  return guardDocumentWrite(() =>
    db.transaction(async (trx) => {
      const row = await repo.lockSummary(project.id, trx);
      const body = row ? parseJson(row.body) : null;
      const action = body?.actions?.find((item) => item.key === key);
      if (!action) throw new AppError('SUMMARY_CHANGED', { status: 409, message: CHANGED_MESSAGE });
      const existing = action.taskId ? await projectTasks.findById(action.taskId) : null;
      if (existing) return { key, taskId: existing.id, task: existing };
      const { currentPhase } = await projectPlan.getPlan(project.id);
      const task = await projectTasks.create({
        user,
        projectId: project.id,
        input: { title: action.text, priority: 'p2', phase: currentPhase, dueDate: null },
        ip,
      });
      const actions = body.actions.map((item) =>
        item.key === key ? { ...item, taskId: task.id } : item,
      );
      // updated_at keeps its value: the words of the summary didn't change.
      await repo.updateSummary(
        project.id,
        { body: toJson({ ...body, actions }), updatedAt: row.updatedAt },
        trx,
      );
      await audit.log(
        {
          actorId: user.id,
          action: 'project_summary.add_task',
          entityType: 'project',
          entityId: project.id,
          after: { taskId: task.id },
          ip,
        },
        trx,
      );
      return { key, taskId: task.id, task };
    }),
  );
}
