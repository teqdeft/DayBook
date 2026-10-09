// Shared set-up for the reports service tests. The reports module calls the users, projects,
// attendance and timers services; these fakes answer from the test database exactly as CONTRACT
// sections 6 and 15 describe, so the reports rules are tested on their own.
import { db, parseJson } from '@/lib/db';
import { initials } from '@/lib/text';
import { locksAtFor, minutesBetween, now } from '@/lib/time';
import { createUser } from '../helpers/db.js';

function publicUser(row) {
  return row ? { ...row, initials: initials(row.name) } : null;
}

export const fakeUsers = {
  async findById(id) {
    return publicUser(await db('users').where({ id }).first());
  },
  async findByIds(ids) {
    if (!ids.length) return [];
    return (await db('users').whereIn('id', ids)).map(publicUser);
  },
  async getReportApproverIds(userId) {
    const user = await db('users').where({ id: userId }).first();
    if (user?.reportsToId) {
      const boss = await db('users').where({ id: user.reportsToId }).first();
      if (boss && boss.role === 'pm' && boss.status === 'active') return [boss.id];
    }
    return (await db('users').where({ role: 'admin', status: 'active' })).map((row) => row.id);
  },
};

export const fakeProjects = {
  async isActive(id) {
    const row = await db('projects').where({ id }).first('status');
    return row?.status === 'active';
  },
  async findPendingRequestForUser(requestId, userId) {
    return (
      (await db('projectRequests')
        .where({ id: requestId, requestedBy: userId, status: 'pending' })
        .first()) ?? null
    );
  },
};

export const fakeAttendance = {
  listForDate(workDate) {
    return db('attendance').where({ workDate });
  },
  listForUserRange(userId, from, to) {
    return db('attendance').where({ userId }).whereBetween('workDate', [from, to]);
  },
  getForUserOnDate(userId, workDate) {
    return db('attendance').where({ userId, workDate }).first();
  },
  presentMinutes(row, at) {
    return minutesBetween(row.checkInAt, row.checkOutAt ?? at ?? now());
  },
};

// The timers service as the report module uses it (CONTRACT 15): canUse and getDaySummary. Tests
// set a day's summary with setTimerSummary(); a day without one has no time entries.
const timerSummaries = new Map();

/** Sets what timers.getDaySummary(userId, workDate) returns; projects biggest first. */
export function setTimerSummary(userId, workDate, projects) {
  timerSummaries.set(`${userId}|${workDate}`, {
    totalMinutes: projects.reduce((sum, project) => sum + (project.minutes ?? 0), 0),
    projects: projects.map((project) => ({
      projectColor: 'blue',
      isUrgent: false,
      minutes: project.roundedMinutes,
      tasks: [],
      ...project,
    })),
  });
}

export function clearTimerSummaries() {
  timerSummaries.clear();
}

export const fakeTimers = {
  canUse(user) {
    return (
      Boolean(user) &&
      user.status === 'active' &&
      Boolean(user.tracksAttendance) &&
      user.role !== 'pm'
    );
  },
  async getDaySummary(userId, workDate) {
    return timerSummaries.get(`${userId}|${workDate}`) ?? { totalMinutes: 0, projects: [] };
  },
};

let projectCounter = 0;

/** Inserts a project (active, blue, Internal client) and returns its row. */
export async function createProject(pm, overrides = {}) {
  projectCounter += 1;
  const client = await db('clients').first('id');
  const [id] = await db('projects').insert({
    name: `project-${projectCounter}`,
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

export async function createProjectRequest(user, overrides = {}) {
  const [id] = await db('projectRequests').insert({
    requestedBy: user.id,
    name: 'acme-blog',
    note: 'Monthly posts',
    status: 'pending',
    ...overrides,
  });
  return db('projectRequests').where({ id }).first();
}

/** A session-like user object for service calls. */
export function sessionUser(row) {
  return { ...row, initials: initials(row.name) };
}

export async function createPeople() {
  const admin = await createUser({ name: 'Ceo Admin', role: 'admin', tracksAttendance: false });
  const pm = await createUser({ name: 'Pat Manager', role: 'pm', slackUserId: 'UPM1' });
  const otherPm = await createUser({ name: 'Olga Manager', role: 'pm', slackUserId: 'UPM2' });
  const person = await createUser({
    name: 'Vishal Saini',
    reportsToId: pm.id,
    slackUserId: 'UVISHAL',
  });
  const colleague = await createUser({ name: 'Priya Sharma', reportsToId: otherPm.id });
  return { admin, pm, otherPm, person, colleague };
}

/**
 * Inserts a report with entries and tasks directly (for history the tests start from).
 * entries: [{ project, minutes, tasks: [{ title, status, firstReportedOn?, carriedFromTaskId? }] }]
 */
export async function insertReport(
  user,
  workDate,
  { status = 'submitted', entries = [], ...rest } = {},
) {
  const [id] = await db('dailyReports').insert({
    userId: user.id,
    workDate,
    status,
    totalMinutes: entries.reduce((sum, entry) => sum + entry.minutes, 0),
    locksAt: locksAtFor(workDate, 'next_day_12:00', 'Asia/Kolkata'),
    revision: status === 'submitted' ? 1 : 0,
    submittedAt: status === 'submitted' ? new Date(`${workDate}T13:00:00Z`) : null,
    firstSubmittedAt: status === 'submitted' ? new Date(`${workDate}T13:00:00Z`) : null,
    ...rest,
  });
  const taskIds = [];
  for (const [i, entry] of entries.entries()) {
    const [entryId] = await db('reportEntries').insert({
      reportId: id,
      projectId: entry.project?.id ?? null,
      projectRequestId: entry.request?.id ?? null,
      minutes: entry.minutes,
      sortOrder: i,
    });
    for (const [j, task] of entry.tasks.entries()) {
      const [taskId] = await db('reportTasks').insert({
        entryId,
        title: task.title,
        status: task.status,
        firstReportedOn: task.firstReportedOn ?? workDate,
        carriedFromTaskId: task.carriedFromTaskId ?? null,
        sortOrder: j,
      });
      taskIds.push(taskId);
    }
  }
  return { id, taskIds };
}

export async function outboxRows() {
  return (await db('slack_outbox').orderBy('id')).map((row) => ({
    ...row,
    payload: parseJson(row.payload),
  }));
}

export async function clearTables(...tables) {
  for (const table of tables) await db(table).delete();
}

/** Entries as the API sends them: [{ id?, projectId, hours, tasks: [{ id?, title, status }] }] */
export function entriesFrom(view) {
  return view.entries.map((entry) => ({
    id: entry.id,
    projectId: entry.projectId ?? undefined,
    projectRequestId: entry.projectRequestId ?? undefined,
    hours: entry.hours,
    tasks: entry.tasks.map((task) => ({ id: task.id, title: task.title, status: task.status })),
  }));
}
