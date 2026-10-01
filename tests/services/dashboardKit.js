// Shared set-up for the dashboard service tests: small inserts for attendance, reports, projects
// and requests. Dashboards only read, so the rows go straight into the test database.
import { db, toJson } from '@/lib/db';
import { localToUtc } from '@/lib/time';

export const TZ = 'Asia/Kolkata';
/** Wednesday 30 September 2026, 6:52 PM in Kolkata (the dashboards' canvas moment). */
export const NOW = '2026-09-30T13:22:00Z';
export const TODAY = '2026-09-30';

const at = (date, clock) => (clock ? localToUtc(date, clock, TZ).toDate() : null);

/** One attendance row; times are local clocks ('09:32'). */
export async function checkIn(user, date, { in: inAt = '09:30', out = null, ...rest } = {}) {
  const [id] = await db('attendance').insert({
    userId: user.id,
    workDate: date,
    checkInAt: at(date, inAt),
    checkOutAt: at(date, out),
    location: 'office',
    officeVerified: true,
    lateMinutes: 0,
    isWorkingDay: true,
    checkoutStatus: out ? 'checked_out' : 'open',
    ...rest,
  });
  return id;
}

let projectCount = 0;

export async function createProject(pm, overrides = {}) {
  projectCount += 1;
  const client = await db('clients').first('id');
  const [id] = await db('projects').insert({
    name: `project-${projectCount}`,
    clientId: client.id,
    pmId: pm.id,
    status: 'active',
    color: 'blue',
    isUrgent: false,
    createdBy: pm.id,
    ...overrides,
  });
  return db('projects').where({ id }).first();
}

export async function addMembers(project, users) {
  await db('projectMembers').insert(
    users.map((user) => ({ projectId: project.id, userId: user.id })),
  );
}

export async function createProjectRequest(user, overrides = {}) {
  const [id] = await db('projectRequests').insert({
    requestedBy: user.id,
    name: 'Requested project',
    note: '',
    status: 'pending',
    ...overrides,
  });
  return db('projectRequests').where({ id }).first();
}

/**
 * A daily report with its entries and tasks, plus one revision row per submit.
 * entries: [{ projectId? | projectRequestId?, minutes, tasks?: [{ title, status, firstReportedOn?,
 * carriedFromTaskId? }] }]. Returns { id, taskIds } (task ids in insertion order).
 */
export async function createReport(user, date, options = {}) {
  const { status = 'submitted', revision = status === 'submitted' ? 1 : 0, entries = [] } = options;
  const totalMinutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);
  const [id] = await db('dailyReports').insert({
    userId: user.id,
    workDate: date,
    status,
    totalMinutes,
    revision,
    submittedAt: status === 'submitted' ? at(date, '18:20') : null,
    firstSubmittedAt: status === 'submitted' ? at(date, '18:20') : null,
    locksAt: at(date, '23:59'),
  });
  const taskIds = [];
  for (const [index, entry] of entries.entries()) {
    const [entryId] = await db('reportEntries').insert({
      reportId: id,
      projectId: entry.projectId ?? null,
      projectRequestId: entry.projectRequestId ?? null,
      minutes: entry.minutes,
      sortOrder: index,
    });
    for (const [taskIndex, task] of (entry.tasks ?? []).entries()) {
      const [taskId] = await db('reportTasks').insert({
        entryId,
        title: task.title,
        status: task.status ?? 'done',
        firstReportedOn: task.firstReportedOn ?? date,
        carriedFromTaskId: task.carriedFromTaskId ?? null,
        sortOrder: taskIndex,
      });
      taskIds.push(taskId);
    }
  }
  for (let number = 1; number <= revision; number += 1) {
    await db('reportRevisions').insert({
      reportId: id,
      revision: number,
      snapshot: toJson({ totalMinutes: number === revision ? totalMinutes : totalMinutes - 30 }),
      editedBy: number > 1 ? (options.editedBy ?? user).id : user.id,
      reason: number > 1 ? (options.reason ?? 'Fixed the hours') : null,
      createdAt: at(date, number === 1 ? '18:20' : '18:40'),
    });
  }
  return { id, taskIds };
}

export async function createEditRequest(user, date, overrides = {}) {
  const [id] = await db('reportEditRequests').insert({
    workDate: date,
    requestedBy: user.id,
    reason: 'Forgot a task',
    status: 'pending',
    ...overrides,
  });
  return id;
}

export async function createCorrection(user, date, overrides = {}) {
  const [id] = await db('attendanceCorrections').insert({
    userId: user.id,
    workDate: date,
    type: 'check_in',
    requestedTime: at(date, '09:30'),
    reason: 'Wrong check-in time',
    status: 'pending',
    ...overrides,
  });
  return id;
}
