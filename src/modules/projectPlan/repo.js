// Every Knex query of the projectPlan module: project_plans and project_phase_plans.
import { db } from '@/lib/db';

const PHASE_COLUMNS = ['phase', 'plannedStart', 'plannedEnd', 'actualStart', 'actualEnd'];

export function findPlan(projectId, trx = db) {
  return trx('projectPlans').where({ projectId }).first('currentPhase', 'deadline');
}

/** The plans of several projects in one query. Projects without a row are left out. */
export function listPlans(projectIds, trx = db) {
  return trx('projectPlans')
    .whereIn('projectId', projectIds)
    .select('projectId', 'currentPhase', 'deadline');
}

/** The dates of a project's phases. Phases without a row are left out. */
export function listPhasePlans(projectId, trx = db) {
  return trx('projectPhasePlans').where({ projectId }).select(PHASE_COLUMNS);
}

/**
 * Creates the project's plan row if it has none and locks it for the rest of the transaction, so
 * every change to a project's plan waits its turn. The upsert takes the exclusive lock straight
 * away, with or without a row: locking a missing row, or INSERT IGNORE then FOR UPDATE, deadlocks
 * two changes that arrive together.
 * @returns {Promise<{ currentPhase: string | null, deadline: string | null }>}
 */
export async function lockPlan(projectId, at, trx) {
  await trx('projectPlans')
    .insert({ projectId, createdAt: at, updatedAt: at })
    .onConflict('projectId')
    .merge({ projectId });
  return trx('projectPlans').where({ projectId }).forUpdate().first('currentPhase', 'deadline');
}

export function updatePlan(projectId, changes, trx) {
  return trx('projectPlans').where({ projectId }).update(changes);
}

/**
 * Writes the given columns of one phase's row, creating the row when it has none. Columns not in
 * `changes` keep their values.
 * @param {{ projectId: number, phase: string, changes: Record<string, unknown>, at: Date }} input
 */
export function savePhasePlan({ projectId, phase, changes, at }, trx) {
  const row = { ...changes, updatedAt: at };
  return trx('projectPhasePlans')
    .insert({ projectId, phase, ...row, createdAt: at })
    .onConflict(['projectId', 'phase'])
    .merge(row);
}

/** Empties the actual dates of these phases; their planned dates stay. */
export function clearActualDates({ projectId, phases, updatedBy, at }, trx) {
  if (phases.length === 0) return Promise.resolve(0);
  return trx('projectPhasePlans')
    .where({ projectId })
    .whereIn('phase', phases)
    .update({ actualStart: null, actualEnd: null, updatedBy, updatedAt: at });
}
