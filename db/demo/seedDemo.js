// Fills the development database with the people, projects, attendance, reports and requests shown
// on the design canvas, so every screen looks like its artboard, plus three project plans (an off
// track, an at risk and an on track project, projectPlans.js) for the project management screens,
// a to-do with unfinished tasks to suggest (todo.js) for Today's to-do, and the 1.10 HR tools'
// holiday, leave, breaks, missing check-outs and marks (hrTools.js, hrTimers.js).
//
//   npm run seed:demo                 evening state (the dashboards, 6:52 PM on the canvas)
//   npm run seed:demo -- --midday     Vishal still checked in with a draft report (01 and 02)
//
// It empties every table (except the migration tables), runs the four base seeds, then inserts the
// demo data. Safe to run again at any time; it refuses to run in production.
import { db, parseJson, toJson } from '@/lib/db';
import { env } from '@/lib/env';
import { workDate } from '@/lib/time';
import { seed as seedDepartments } from '../seeds/01_departments.js';
import { seed as seedClients } from '../seeds/02_clients.js';
import { seed as seedSettings } from '../seeds/03_settings.js';
import { seed as seedAdmin } from '../seeds/04_admin.js';
import { anchorDate, at, dateAtOffset, workingDaysBack } from './calendar.js';
import { insertClients, insertPeople, insertProjects } from './base.js';
import { planAllDays } from './plan.js';
import { assignTasks } from './tasks.js';
import { addTodoLines } from './todo.js';
import { buildRows } from './rows.js';
import { buildActivitySegments } from './activity.js';
import {
  buildAuditLogs,
  buildCorrections,
  buildNotifications,
  buildOfficeNetworks,
  buildRequests,
} from './extras.js';
import { checkDesignNumbers } from './checks.js';
import { buildHrRows, planHrTools } from './hrTools.js';
import { buildTimerDays } from './hrTimers.js';
import { PEOPLE } from './people.js';
import { buildProjectPlanRows } from './projectPlanRows.js';
import { COMPLETED_PROJECTS, PROJECTS } from './projects.js';
import {
  buildPriorityNotifications,
  buildPriorityTasks,
  checkPriorityTasks,
  linkReportLines,
} from './priority.js';

const KEEP_TABLES = new Set(['knex_migrations', 'knex_migrations_lock']);
const DEMO_SETTINGS = {
  slack_report_channel_id: 'C0DAILYREP',
  slack_report_channel_name: 'daily-reports',
};
const SLACK_CHANNEL_KEYS = [
  'slack_report_channel_id',
  'slack_report_channel_name',
  'slack_todo_channel_id',
  'slack_todo_channel_name',
];

function refuseUnsafeDatabase() {
  const name = String(env.DB_NAME);
  if (env.isProduction || /prod/i.test(name)) {
    throw new Error(`Refusing to load demo data into "${name}" (production).`);
  }
}

/** Empties every table except the migration bookkeeping. One connection, so the FK switch holds. */
async function wipe() {
  const [tables] = await db.raw(
    'SELECT table_name AS name FROM information_schema.tables ' +
      "WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
  );
  const names = tables.map((row) => row.name).filter((name) => !KEEP_TABLES.has(name));
  await db.transaction(async (trx) => {
    await trx.raw('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const name of names) await trx.raw('TRUNCATE TABLE ??', [name]);
    } finally {
      await trx.raw('SET FOREIGN_KEY_CHECKS = 1');
    }
  });
  return names.length;
}

/**
 * A real Slack channel picked in Settings survives a demo reset; the demo placeholder only fills
 * the report channel's slot when nothing real was saved (so re-seeding never breaks a connected
 * Slack). The to-do channel (CONTRACT 24) has no placeholder: one picked in Settings is kept.
 */
async function readSavedSlackChannel() {
  const kept = {};
  try {
    const rows = await db('settings').whereIn('key', SLACK_CHANNEL_KEYS).select('key', 'value');
    const saved = Object.fromEntries(rows.map((row) => [row.key, parseJson(row.value)]));
    const id = saved.slack_report_channel_id;
    if (id && id !== DEMO_SETTINGS.slack_report_channel_id) {
      kept.slack_report_channel_id = id;
      kept.slack_report_channel_name = saved.slack_report_channel_name ?? null;
    }
    if (saved.slack_todo_channel_id) {
      kept.slack_todo_channel_id = saved.slack_todo_channel_id;
      kept.slack_todo_channel_name = saved.slack_todo_channel_name ?? null;
    }
  } catch {
    // A fresh database has no settings table yet.
  }
  return kept;
}

async function runBaseSeeds() {
  await seedDepartments(db);
  await seedClients(db);
  await seedSettings(db);
  await seedAdmin(db);
}

async function readSettings() {
  const rows = await db('settings').select('key', 'value');
  const values = Object.fromEntries(rows.map((row) => [row.key, parseJson(row.value)]));
  return {
    tz: values.timezone || env.DEFAULT_TIMEZONE,
    workingDays: values.working_days,
    lateAfter: values.late_after,
    reportLock: values.report_lock,
    payrollStartDay: values.payroll_month_start_day ?? 1,
  };
}

async function insertMany(trx, table, rows, size = 400) {
  for (let i = 0; i < rows.length; i += size) await trx(table).insert(rows.slice(i, i + size));
}

async function insertDemo(trx, { settings, anchor, days, midday, slackChannel }) {
  const { tz, workingDays } = settings;
  const dateOf = (offset) => days[offset] ?? dateAtOffset(anchor, offset, workingDays);
  const when = (offset, clock) => at(dateOf(offset), clock, tz);
  for (const [key, value] of Object.entries({ ...DEMO_SETTINGS, ...slackChannel })) {
    await trx('settings')
      .where({ key })
      .update({ value: toJson(value) });
  }
  const ceoEmail = (env.SEED_ADMIN_EMAIL || 'ceo@company.com').trim().toLowerCase();
  const users = await insertPeople(trx, { tz, ceoEmail });
  const clients = await insertClients(trx);
  const projects = await insertProjects(trx, { when, midday, users, clients });

  const planCtx = { days, lateAfter: settings.lateAfter, midday, projects };
  const plans = planAllDays(planCtx);
  assignTasks(plans);
  addTodoLines(plans);
  planHrTools(plans, { anchor: days[0], ...settings });
  const { rows, index } = buildRows(plans, { ...settings, days, users, projects });
  const hrCtx = { ...settings, today: days[0], users, projects, index, when, dateOf };
  // Before the attendance insert: it sets the entered-by columns of a self-entered check-out.
  const hrRows = buildHrRows(hrCtx);
  // Priority tasks go in before the report lines that link to them.
  const priorityTasks = buildPriorityTasks({ when, dateOf, users, projects });
  const linkedLines = linkReportLines(rows, priorityTasks);
  // Three projects get a plan; it files some priority tasks into phases, so it goes in first.
  const planRows = buildProjectPlanRows(
    { tz, today: workDate(tz), anchor: days[0], users, projects },
    priorityTasks.map(({ row }) => row),
  );
  await insertMany(trx, 'projectTasks', [
    ...priorityTasks.map(({ row }) => row),
    ...planRows.tasks,
  ]);
  await insertProjectPlans(trx, planRows);
  await insertMany(trx, 'attendance', rows.attendance);
  await insertMany(trx, 'dailyReports', rows.reports);
  await insertMany(trx, 'reportEntries', rows.entries);
  await insertMany(trx, 'reportTasks', rows.tasks);
  await insertMany(trx, 'reportRevisions', rows.revisions);
  // Screen time follows the same days (after buildRows applied the approved corrections).
  const activitySegments = buildActivitySegments(plans, { tz, today: days[0], midday, users });
  await insertMany(trx, 'activitySegments', activitySegments);

  const extrasCtx = { when, dateOf, users, projects, index, midday };
  const { editRequests, projectRequests } = buildRequests(extrasCtx);
  await insertMany(trx, 'projectRequests', projectRequests);
  await insertMany(trx, 'reportEditRequests', editRequests);
  await insertMany(trx, 'attendanceCorrections', buildCorrections(extrasCtx));
  await insertMany(trx, 'officeNetworks', buildOfficeNetworks(extrasCtx));
  await insertMany(trx, 'notifications', buildNotifications(extrasCtx));
  await insertMany(
    trx,
    'notifications',
    buildPriorityNotifications(priorityTasks, { when, users, projects }),
  );
  await insertMany(trx, 'auditLogs', buildAuditLogs(extrasCtx));
  const timerDays = await insertHrTools(trx, hrRows, buildTimerDays(hrCtx));
  return {
    users: users.size,
    projects: projects.size,
    ...countRows(rows),
    activitySegments: activitySegments.length,
    projectTasks: priorityTasks.length + planRows.tasks.length,
    linkedReportLines: linkedLines,
    projectPlans: planRows.plans.length,
    projectDocuments: planRows.documents.length,
    holidays: hrRows.holidays.length,
    leaveEntries: hrRows.leave.length,
    timeEntries: timerDays.entries.length,
    breaks: timerDays.breaks.length,
  };
}

/** The 1.10 rows (CONTRACT 25): the calendar, today's timers and breaks, reminders, bell, audit. */
async function insertHrTools(trx, hrRows, timerDays) {
  await insertMany(trx, 'holidays', hrRows.holidays);
  await insertMany(trx, 'leaveEntries', hrRows.leave);
  await insertMany(trx, 'timeEntries', timerDays.entries);
  await insertMany(trx, 'attendanceBreaks', timerDays.breaks);
  await insertMany(trx, 'attendanceReminders', hrRows.reminders);
  await insertMany(trx, 'notifications', hrRows.notifications);
  await insertMany(trx, 'auditLogs', hrRows.audit);
  return timerDays;
}

/** The plans, their phases' dates, the files and notes and the summaries (CONTRACT 22). */
async function insertProjectPlans(trx, planRows) {
  await insertMany(trx, 'projectPlans', planRows.plans);
  await insertMany(trx, 'projectPhasePlans', planRows.phases);
  await insertMany(trx, 'projectDocuments', planRows.documents);
  await insertMany(trx, 'projectSummaries', planRows.summaries);
}

function countRows(rows) {
  return Object.fromEntries(Object.entries(rows).map(([name, list]) => [name, list.length]));
}

async function main() {
  const midday = process.argv.slice(2).includes('--midday');
  refuseUnsafeDatabase();
  checkDesignNumbers();
  checkPriorityTasks({ projects: [...PROJECTS, ...COMPLETED_PROJECTS], people: PEOPLE });
  const slackChannel = await readSavedSlackChannel();
  const emptied = await wipe();
  await runBaseSeeds();
  const settings = await readSettings();
  const anchor = anchorDate(settings.tz, settings.workingDays);
  const days = workingDaysBack(anchor, settings.workingDays);
  const counts = await db.transaction((trx) =>
    insertDemo(trx, { settings, anchor, days, midday, slackChannel }),
  );
  console.log(`Emptied ${emptied} tables and ran the base seeds.`);
  console.log(
    `Demo data for ${anchor} (${midday ? 'midday' : 'evening'} state), ${days.length} working days:`,
  );
  console.log(
    `  ${Object.entries(counts)
      .map(([name, count]) => `${name} ${count}`)
      .join(', ')}`,
  );
}

main()
  .catch((error) => {
    console.error(error.message);
    if (!(error.message ?? '').startsWith('Refusing')) console.error(error.stack);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
