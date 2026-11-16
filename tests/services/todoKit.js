// Shared set-up for the to-do service tests (CONTRACT 24), against the real modules: a PM, two
// people who write reports, two active projects and one on hold, and reads of today's rows.
import { db } from '@/lib/db';
import { reports } from '@/modules/reports';
import { saveReportSchema } from '@/modules/reports/schemas';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';
import { TODAY } from './timersKit.js';

const person = async (overrides) => ({ ...(await createUser(overrides)), initials: 'XX' });

/** A fresh database with the people and projects the to-do tests use. */
export async function createTodoWorld() {
  await resetDatabase();
  await setSettings({ timers_mode: 'optional' });
  const pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  const emp = await person({ name: 'Priya Sharma' });
  const colleague = await person({ name: 'Ankit Rana' });
  const acme = await createProject(pm, { name: 'Pine Tree Lane' });
  const beta = await createProject(pm, { name: 'Studio Ubique', color: 'violet' });
  const paused = await createProject(pm, { name: 'Old site', status: 'on_hold' });
  await addMembers(acme, [emp, colleague]);
  await addMembers(beta, [emp, colleague]);
  return { pm, emp, colleague, acme, beta, paused };
}

/** Empties every table a to-do test writes to. */
export async function clearTodoTables() {
  for (const table of ['reportTasks', 'reportEntries', 'reportRevisions', 'slack_outbox']) {
    await db(table).del();
  }
  for (const table of ['dailyReports', 'projectTasks', 'userPreferences', 'projectRequests']) {
    await db(table).del();
  }
}

/** The lines of a project in a to-do, and their titles. */
export const linesOf = (todo, project) =>
  todo.groups.find((group) => group.project?.id === project.id)?.lines ?? [];
export const titles = (todo, project) => linesOf(todo, project).map((line) => line.title);

/** A person's rows for today: reports, entries and tasks (in their order). */
export async function todayRows(user) {
  const reportRows = await db('dailyReports').where({ userId: user.id, workDate: TODAY });
  const entries = await db('reportEntries').whereIn(
    'reportId',
    reportRows.map((row) => row.id),
  );
  const tasks = await db('reportTasks')
    .whereIn(
      'entryId',
      entries.map((row) => row.id),
    )
    .orderBy('sortOrder');
  return { reports: reportRows, entries, tasks };
}

/** The report page's autosave of today's draft, with these minutes on each project. */
export async function saveHours(user, minutesByProject, baseVersion) {
  const view = await reports.openForDate({ user, workDate: TODAY });
  const entries = view.entries.map((entry) => ({
    id: entry.id,
    projectId: entry.projectId ?? undefined,
    projectRequestId: entry.projectRequestId ?? undefined,
    minutes: minutesByProject[entry.projectId] ?? entry.minutes,
    tasks: entry.tasks.map((task) => ({ id: task.id, title: task.title, status: task.status })),
  }));
  return reports.saveReport({
    user,
    reportId: view.id,
    entries: saveReportSchema.parse({ entries }).entries,
    baseVersion: baseVersion ?? view.version,
  });
}
