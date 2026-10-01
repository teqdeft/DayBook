// Turns the day plans into rows for attendance, daily_reports, report_entries, report_tasks and
// report_revisions. Ids are assigned here (the tables were just emptied), so carried tasks can
// point at the task they continue and one batch insert per table is enough.
import { toJson } from '@/lib/db';
import { locksAtFor } from '@/lib/time';
import { at, clockOf, minutesOf } from './calendar.js';
import { CORRECTIONS, EDIT_REQUESTS } from './requests.js';
import { VISHAL_FRI_FIRST_VERSION } from './schedule.js';

export const OFFICE_IP = '203.0.113.24';

// What the approved edit requests changed (08 "Recently handled").
const APPROVED_CHANGES = {
  simran: { addTask: { title: 'Order emails', status: 'done' } },
  priya: { addMinutes: 120 },
};

/**
 * @param {Map<string, object[]>} plansByPerson plans with tasks assigned
 * @param {{ tz: string, reportLock: string, days: string[], users: Map<string, {id:number}>,
 *   projects: Map<string, {id:number, name:string}> }} ctx
 * @returns {{ rows: Record<string, object[]>, index: { attendance: Map<string, object>,
 *   reports: Map<string, object> } }} index keys are `${personKey}|${offset}`
 */
export function buildRows(plansByPerson, ctx) {
  const rows = { attendance: [], reports: [], entries: [], tasks: [], revisions: [] };
  const index = { attendance: new Map(), reports: new Map() };
  const seq = { attendance: 0, reports: 0, entries: 0, tasks: 0, revisions: 0 };
  let personIndex = 0;
  for (const [key, plans] of plansByPerson) {
    personIndex += 1;
    const user = ctx.users.get(key);
    for (const plan of plans) {
      if (plan.absent) continue;
      applyApprovedCorrection(key, plan);
      const attendance = attendanceRow(plan, user.id, personIndex, ctx);
      attendance.id = ++seq.attendance;
      rows.attendance.push(attendance);
      index.attendance.set(`${key}|${plan.offset}`, attendance);
      if (plan.report) {
        const report = addReport(plan, user.id, rows, seq, ctx);
        index.reports.set(`${key}|${plan.offset}`, report);
      }
    }
  }
  return { rows, index };
}

function applyApprovedCorrection(key, plan) {
  const correction = CORRECTIONS.find(
    (c) => c.key === key && c.offset === plan.offset && c.status === 'approved',
  );
  if (!correction) return;
  // Late minutes were worked out from the original check-in, so only check-out fixes are modelled.
  if (correction.type !== 'check_out') {
    throw new Error('Demo data: only check-out fixes are approved');
  }
  plan.out = correction.requested.clock;
  plan.checkoutStatus = 'corrected';
}

function attendanceRow(plan, userId, personIndex, ctx) {
  const checkInAt = at(plan.date, plan.in, ctx.tz);
  const checkOutAt = plan.out ? at(plan.date, plan.out, ctx.tz) : null;
  let ip = OFFICE_IP;
  if (plan.where === 'wfh') ip = `198.51.100.${10 + personIndex}`;
  else if (plan.unverified) ip = '198.51.100.77';
  return {
    userId,
    workDate: plan.date,
    checkInAt,
    checkOutAt,
    location: plan.where,
    officeVerified: !(plan.where === 'office' && plan.unverified),
    checkInIp: ip,
    checkOutIp: checkOutAt ? ip : null,
    note: plan.note,
    lateMinutes: plan.lateMinutes,
    isWorkingDay: true,
    checkoutStatus: plan.checkoutStatus,
    source: 'self',
    createdAt: checkInAt,
    updatedAt: checkOutAt ?? checkInAt,
  };
}

function addReport(plan, userId, rows, seq, ctx) {
  const { report } = plan;
  const edit = EDIT_REQUESTS.find(
    (r) => r.key === plan.key && r.offset === plan.offset && r.status === 'approved',
  );
  const versions = versionsOf(plan, edit, ctx);
  const finalEntries = versions.at(-1).entries;
  const createdAt = at(plan.date, clockOf(minutesOf(plan.in) + 25), ctx.tz);
  const row = {
    id: ++seq.reports,
    userId,
    workDate: plan.date,
    status: report.status,
    totalMinutes: finalEntries.reduce((sum, entry) => sum + entry.minutes, 0),
    firstSubmittedAt: report.status === 'submitted' ? versions[0].at : null,
    submittedAt: report.status === 'submitted' ? versions.at(-1).at : null,
    locksAt: locksAtFor(plan.date, ctx.reportLock, ctx.tz),
    unlockedUntil: null,
    revision: report.status === 'submitted' ? versions.length : 0,
    slackChannelId: null,
    slackTs: null,
    createdAt,
    updatedAt: report.status === 'submitted' ? versions.at(-1).at : createdAt,
  };
  rows.reports.push(row);
  addEntries(row, finalEntries, rows, seq, ctx);
  if (report.status === 'submitted') {
    versions.forEach((version, i) => {
      rows.revisions.push({
        id: ++seq.revisions,
        reportId: row.id,
        revision: i + 1,
        snapshot: toJson(snapshotOf(version.entries, ctx)),
        editedBy: userId,
        reason: i > 0 && edit ? edit.reason : null,
        createdAt: version.at,
      });
    });
  }
  return row;
}

/**
 * Every submitted version of a report, oldest first: [{ entries, at }]. The last version is what
 * the report holds now. A draft has one version and no submit time.
 */
function versionsOf(plan, edit, ctx) {
  const { report, key, offset } = plan;
  if (report.status !== 'submitted') return [{ entries: report.entries, at: null }];
  const first = { entries: report.entries, at: at(plan.date, report.submitAt, ctx.tz) };
  if (edit) {
    // Approved after the lock; the person resubmitted with the change.
    const { offset: day, clock } = edit.resubmitted;
    const entries = applyChange(report.entries, APPROVED_CHANGES[key]);
    return [first, { entries, at: at(ctx.days[day], clock, ctx.tz) }];
  }
  if (report.revisions < 2) return [first];
  if (key === 'vishal' && offset === VISHAL_FRI_FIRST_VERSION.offset) {
    // Revision 1 had the acme-store task still in progress; revision 2 marked it blocked.
    const { project, title, status } = VISHAL_FRI_FIRST_VERSION.change;
    const earlier = report.entries.map((entry) => ({
      ...entry,
      tasks: entry.tasks.map((task) =>
        entry.project === project && task.title === title ? { ...task, status } : task,
      ),
    }));
    return [
      { entries: earlier, at: first.at },
      { entries: report.entries, at: at(plan.date, '19:05', ctx.tz) },
    ];
  }
  // A self edit before the lock: the first version had 30 minutes less on the first project.
  const earlier = report.entries.map((entry, i) =>
    i === 0 && entry.minutes > 30 ? { ...entry, minutes: entry.minutes - 30 } : entry,
  );
  const secondAt = at(plan.date, clockOf(minutesOf(report.submitAt) + 40), ctx.tz);
  return [
    { entries: earlier, at: first.at },
    { entries: report.entries, at: secondAt },
  ];
}

function applyChange(entries, change) {
  return entries.map((entry, i) => {
    if (i !== 0) return entry;
    if (change.addMinutes) return { ...entry, minutes: entry.minutes + change.addMinutes };
    if (change.addTask) return { ...entry, tasks: [...entry.tasks, { ...change.addTask }] };
    return entry;
  });
}

function addEntries(report, entries, rows, seq, ctx) {
  entries.forEach((entry, sortOrder) => {
    const entryId = ++seq.entries;
    rows.entries.push({
      id: entryId,
      reportId: report.id,
      projectId: ctx.projects.get(entry.project).id,
      projectRequestId: null,
      minutes: entry.minutes,
      sortOrder,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    });
    entry.tasks.forEach((task, taskOrder) => {
      task.id ??= ++seq.tasks;
      rows.tasks.push({
        id: task.id,
        entryId,
        title: task.title,
        status: task.status,
        firstReportedOn: task.firstReportedOn ?? report.workDate,
        carriedFromTaskId: task.carriedFrom?.id ?? null,
        sortOrder: taskOrder,
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
      });
    });
  });
}

/** The report_revisions snapshot: { totalMinutes, entries: [{ ..., tasks: [{ title, status }] }] }. */
export function snapshotOf(entries, ctx) {
  return {
    totalMinutes: entries.reduce((sum, entry) => sum + entry.minutes, 0),
    entries: entries.map((entry) => {
      const project = ctx.projects.get(entry.project);
      return {
        projectId: project.id,
        projectRequestId: null,
        projectName: project.name,
        minutes: entry.minutes,
        tasks: entry.tasks.map((task) => ({ title: task.title, status: task.status })),
      };
    }),
  };
}
