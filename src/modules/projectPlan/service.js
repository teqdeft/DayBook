// A project's plan (CONTRACT 22): its current phase, deadline and the dates of each phase. Only the
// project's PM or Admin changes it. Every change locks the plan row first, so changes that arrive
// together run one after the other, and is audited in the same transaction with ids and values only.
// Other code imports phases.js, forecast.js and weeks.js directly: they are safe in the browser.
import { db } from '@/lib/db';
import { AppError, validationError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { nowDate, workDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { projects } from '@/modules/projects';
import { settings } from '@/modules/settings';
import { guardPlanRead, guardPlanWrite } from './migrationGuard';
import { PROJECT_PHASES, phaseIndex } from './phases';
import * as repo from './repo';
import {
  PHASE_CHANGED,
  phaseDatesSchema,
  projectDeadlineSchema,
  projectPhaseSchema,
} from './schemas';

function toId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parseInput(schema, value) {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) fields[path] = issue.message;
  }
  throw validationError(fields, Object.values(fields)[0]);
}

function forbidden() {
  return new AppError('FORBIDDEN', { message: 'Only the project manager or Admin can do that.' });
}

/** The project, when the user may manage it. @throws FORBIDDEN, NOT_FOUND */
async function manageableProject(user, projectId) {
  if (!can(user, 'project.manage')) throw forbidden();
  const id = toId(projectId);
  const project = id ? await projects.findById(id) : null;
  if (!project) throw new AppError('NOT_FOUND', { message: "We couldn't find that project." });
  if (!projects.canManage(user, project)) throw forbidden();
  return project;
}

/** A plan row and its phase rows as the contract's plan: always 6 phases, in order. */
function toPlan(plan, rows) {
  const byPhase = new Map(rows.map((row) => [row.phase, row]));
  return {
    currentPhase: plan?.currentPhase ?? null,
    deadline: plan?.deadline ?? null,
    phases: PROJECT_PHASES.map(({ key, label }) => {
      const row = byPhase.get(key);
      return {
        key,
        label,
        plannedStart: row?.plannedStart ?? null,
        plannedEnd: row?.plannedEnd ?? null,
        actualStart: row?.actualStart ?? null,
        actualEnd: row?.actualEnd ?? null,
      };
    }),
  };
}

async function readPlan(projectId, trx = db) {
  const plan = await repo.findPlan(projectId, trx);
  return toPlan(plan, await repo.listPhasePlans(projectId, trx));
}

/**
 * Runs a change with the project's plan row locked, in one transaction.
 * @param {number} projectId
 * @param {(plan: { currentPhase: string | null, deadline: string | null }, trx: object, at: Date)
 *   => Promise<void>} change
 * @returns {Promise<object>} the plan after the change
 * @throws PLAN_UNAVAILABLE (503, migration 015 hasn't run)
 */
function changePlan(projectId, change) {
  return guardPlanWrite(() =>
    db.transaction(async (trx) => {
      const at = nowDate();
      await change(await repo.lockPlan(projectId, at, trx), trx, at);
      return readPlan(projectId, trx);
    }),
  );
}

/**
 * The plan of one project. No access check: the page has already asked for team.view. Before
 * migration 015 it is Not set with no deadline and no dates.
 * @param {number} projectId
 * @returns {Promise<{ currentPhase: string | null, deadline: string | null, phases: Array<{ key,
 *   label, plannedStart, plannedEnd, actualStart, actualEnd }> }>} always 6 phases, in order; dates
 *   are 'YYYY-MM-DD' or null
 */
export async function getPlan(projectId) {
  const id = toId(projectId);
  if (!id) return toPlan(null, []);
  return guardPlanRead(
    () => readPlan(id),
    () => toPlan(null, []),
  );
}

/**
 * The current phase and deadline of several projects, in one query. No access check. Before
 * migration 015 every project is Not set with no deadline.
 * @param {number[]} projectIds
 * @returns {Promise<Record<number, { currentPhase: string | null, deadline: string | null }>>}
 *   every project asked for, with nulls when it has no plan
 */
export async function listPlans(projectIds) {
  const ids = [...new Set((projectIds ?? []).map(toId).filter(Boolean))];
  const plans = {};
  for (const id of ids) plans[id] = { currentPhase: null, deadline: null };
  if (ids.length === 0) return plans;
  const rows = await guardPlanRead(
    () => repo.listPlans(ids),
    () => [],
  );
  for (const row of rows) {
    plans[row.projectId] = {
      currentPhase: row.currentPhase ?? null,
      deadline: row.deadline ?? null,
    };
  }
  return plans;
}

/**
 * The actual dates of a move. Forward: the old phase ends today and the new one starts today;
 * phases jumped over stay empty (shown as "Skipped"). Back: later phases lose both dates and the
 * target is open again, starting today only when it had no start.
 */
async function writeActualDates({ projectId, from, to, today, userId, at }, trx) {
  const save = (phase, changes) =>
    repo.savePhasePlan({ projectId, phase, changes: { ...changes, updatedBy: userId }, at }, trx);
  if (phaseIndex(to) > phaseIndex(from)) {
    if (from) await save(from, { actualEnd: today });
    await save(to, { actualStart: today, actualEnd: null });
    return;
  }
  const later = PROJECT_PHASES.slice(phaseIndex(to) + 1).map((phase) => phase.key);
  await repo.clearActualDates({ projectId, phases: later, updatedBy: userId, at }, trx);
  const rows = await repo.listPhasePlans(projectId, trx);
  const started = rows.find((row) => row.phase === to)?.actualStart;
  await save(to, { actualStart: started ?? today, actualEnd: null });
}

/**
 * Moves a project to a phase, forward, back or jumping over phases. Moving to the current phase
 * changes nothing. It blocks nothing and doesn't touch the project's status.
 * @param {{ user: object, projectId: number, phase: string, from?: string | null,
 *   ip?: string | null }} args from: the phase the page showed (null for Not set); when given, the
 *   move is refused if the project is in another phase by the time the plan row is locked
 * @returns {Promise<object>} the plan (getPlan)
 * @throws FORBIDDEN (not the project's PM or Admin), NOT_FOUND, VALIDATION_FAILED (not on the
 *   list), CONFLICT (409, the phase changed since the page loaded), PLAN_UNAVAILABLE (503,
 *   migration 015 hasn't run)
 */
export async function movePhase({ user, projectId, phase, from: shown, ip = null }) {
  const project = await manageableProject(user, projectId);
  const { phase: to, from: seen } = parseInput(projectPhaseSchema, { phase, from: shown });
  const { timezone } = await settings.getAll();
  return changePlan(project.id, async (plan, trx, at) => {
    const from = plan.currentPhase ?? null;
    if (from === to) return;
    if (seen !== undefined && seen !== from) {
      throw new AppError('CONFLICT', { message: PHASE_CHANGED });
    }
    const today = workDate(timezone);
    await writeActualDates({ projectId: project.id, from, to, today, userId: user.id, at }, trx);
    await repo.updatePlan(project.id, { currentPhase: to, updatedBy: user.id, updatedAt: at }, trx);
    await audit.log(
      {
        actorId: user.id,
        action: 'project.phase',
        entityType: 'project',
        entityId: project.id,
        before: { phase: from },
        after: { phase: to },
        ip,
      },
      trx,
    );
  });
}

/**
 * Sets or clears a project's deadline. The same deadline again changes nothing.
 * @param {{ user: object, projectId: number, deadline: string | null, ip?: string | null }} args
 *   deadline 'YYYY-MM-DD'; null clears it
 * @returns {Promise<object>} the plan (getPlan)
 * @throws FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, PLAN_UNAVAILABLE (503)
 */
export async function setDeadline({ user, projectId, deadline, ip = null }) {
  const project = await manageableProject(user, projectId);
  const values = parseInput(projectDeadlineSchema, { deadline });
  return changePlan(project.id, async (plan, trx, at) => {
    const before = plan.deadline ?? null;
    if (before === values.deadline) return;
    await repo.updatePlan(
      project.id,
      { deadline: values.deadline, updatedBy: user.id, updatedAt: at },
      trx,
    );
    await audit.log(
      {
        actorId: user.id,
        action: 'project.deadline',
        entityType: 'project',
        entityId: project.id,
        before: { deadline: before },
        after: { deadline: values.deadline },
        ip,
      },
      trx,
    );
  });
}

/**
 * Sets a phase's planned dates; its actual dates stay. The same dates again change nothing.
 * @param {{ user: object, projectId: number, phase: string, plannedStart: string | null,
 *   plannedEnd: string | null, ip?: string | null }} args dates 'YYYY-MM-DD'; null empties one
 * @returns {Promise<object>} the plan (getPlan)
 * @throws FORBIDDEN, NOT_FOUND, VALIDATION_FAILED (also "The end date can't be before the start
 *   date."), PLAN_UNAVAILABLE (503)
 */
export async function setPhaseDates({
  user,
  projectId,
  phase,
  plannedStart,
  plannedEnd,
  ip = null,
}) {
  const project = await manageableProject(user, projectId);
  const { phase: key } = parseInput(projectPhaseSchema, { phase });
  const dates = parseInput(phaseDatesSchema, { plannedStart, plannedEnd });
  return changePlan(project.id, async (_plan, trx, at) => {
    const rows = await repo.listPhasePlans(project.id, trx);
    const row = rows.find((candidate) => candidate.phase === key);
    const before = {
      plannedStart: row?.plannedStart ?? null,
      plannedEnd: row?.plannedEnd ?? null,
    };
    if (before.plannedStart === dates.plannedStart && before.plannedEnd === dates.plannedEnd)
      return;
    const changes = { ...dates, updatedBy: user.id };
    await repo.savePhasePlan({ projectId: project.id, phase: key, changes, at }, trx);
    await repo.updatePlan(project.id, { updatedBy: user.id, updatedAt: at }, trx);
    await audit.log(
      {
        actorId: user.id,
        action: 'project.phase_dates',
        entityType: 'project',
        entityId: project.id,
        before: { phase: key, ...before },
        after: { phase: key, ...dates },
        ip,
      },
      trx,
    );
  });
}
