// Rows for the demo project plans (projectPlans.js): each plan and its phases' dates, the new tasks,
// a phase and due date for the priority tasks already there, and acme-store's file, note and
// summary. Before anything is written, the real forecast must give each project the health the
// data is meant to show, and the real summary checks must find every quote in its document.
import crypto from 'node:crypto';
import { toJson } from '@/lib/db';
import { addDays, weekRange, workDate } from '@/lib/time';
import { forecastProject } from '@/modules/projectPlan/forecast';
import { isPhase, PHASE_KEYS } from '@/modules/projectPlan/phases';
import { lastFullWeeks } from '@/modules/projectPlan/weeks';
import { checkAnswer } from '@/modules/projectSummaries/checks';
import { at } from './calendar.js';
import { PROJECT_PLANS } from './projectPlans.js';

const CREATED_CLOCK = '10:00';
const DONE_CLOCK = '17:30';

/**
 * @typedef {object} PlanContext
 * @property {string} tz the company time zone
 * @property {string} today the company's date now, which the forecast reads
 * @property {string} anchor the demo's day ('today' in projectPlans.js)
 * @property {Map<string, { id: number, status: string }>} users person key -> user
 * @property {Map<string, { id: number, pm: string, members: string[], status: string,
 *   createdAt: Date }>} projects project key -> project
 */

function fail(message) {
  throw new Error(`Demo project plans: ${message}`);
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** '-1 Fri' -> 'YYYY-MM-DD' (weeks from the week of the company's today); 'today' is the anchor. */
function dayOf(ctx, value) {
  if (value === 'today') return ctx.anchor;
  const [, week, weekday] = /^(-?\d+) (\w{3})$/.exec(String(value)) ?? [];
  const index = WEEKDAYS.indexOf(weekday);
  if (week === undefined || index === -1) fail(`bad date ${value}`);
  return addDays(weekRange(ctx.today).from, Number(week) * 7 + index);
}

const dayOrNull = (ctx, value) => (value ? dayOf(ctx, value) : null);

/** The project, its PM's id and an owner key -> user id lookup that allows members and the PM. */
function projectOf(ctx, plan) {
  const project = ctx.projects.get(plan.project);
  if (!project) fail(`unknown project ${plan.project}`);
  const pmId = ctx.users.get(project.pm).id;
  const ownerId = (key) => {
    const person = key === 'pm' ? project.pm : key;
    const allowed = key === 'pm' || project.members.includes(person);
    if (!allowed || ctx.users.get(person)?.status !== 'active') {
      fail(`${key} can't own a task on ${project.name}`);
    }
    if (person === 'vishal') fail(`a new task for Vishal on ${project.name} changes his canvas`);
    return ctx.users.get(person).id;
  };
  return { project, pmId, ownerId };
}

/** project_plans and project_phase_plans rows. */
function planRows(ctx, plan, { project, pmId }) {
  const current = plan.phases[plan.currentPhase];
  const currentIndex = PHASE_KEYS.indexOf(plan.currentPhase);
  // As phase moves leave them: earlier phases started and ended, later ones not started.
  PHASE_KEYS.forEach((key, index) => {
    const [start, end] = plan.phases[key]?.actual ?? [];
    const right =
      index < currentIndex ? start && end : index > currentIndex ? !start && !end : true;
    if (!right) fail(`${project.name}'s ${key} has the wrong actual dates`);
  });
  if (!current?.actual?.[0] || current.actual[1]) fail(`${project.name}'s current phase is wrong`);
  const firstStart = plan.phases[PHASE_KEYS[0]].actual[0];
  const phases = PHASE_KEYS.filter((key) => plan.phases[key]).map((key) => {
    const { planned = [], actual = [] } = plan.phases[key];
    const changedOn = dayOf(ctx, actual[1] ?? actual[0] ?? firstStart);
    return {
      projectId: project.id,
      phase: key,
      plannedStart: dayOrNull(ctx, planned[0]),
      plannedEnd: dayOrNull(ctx, planned[1]),
      actualStart: dayOrNull(ctx, actual[0]),
      actualEnd: dayOrNull(ctx, actual[1]),
      updatedBy: pmId,
      createdAt: at(dayOf(ctx, firstStart), CREATED_CLOCK, ctx.tz),
      updatedAt: at(changedOn, CREATED_CLOCK, ctx.tz),
    };
  });
  const row = {
    projectId: project.id,
    currentPhase: plan.currentPhase,
    deadline: dayOf(ctx, plan.deadline),
    updatedBy: pmId,
    createdAt: at(dayOf(ctx, firstStart), CREATED_CLOCK, ctx.tz),
    updatedAt: at(dayOf(ctx, current.actual[0]), CREATED_CLOCK, ctx.tz),
  };
  return { row, phases };
}

/**
 * The plan's new tasks. A task is added when its phase was planned to start, at the latest a week
 * ago (the PM plans later phases ahead), and never after it was ticked.
 */
function taskRows(ctx, plan, { project, pmId, ownerId }, firstId) {
  const lastWeek = dayOf(ctx, '-1 Mon');
  const rows = [];
  for (const [phase, tasks] of Object.entries(plan.tasks)) {
    if (!isPhase(phase)) fail(`unknown phase ${phase}`);
    const start = dayOf(ctx, plan.phases[phase].planned[0]);
    for (const task of tasks) {
      const doneOn = dayOrNull(ctx, task.done);
      const createdOn = [start, lastWeek, doneOn].filter(Boolean).sort()[0];
      const createdAt = at(createdOn, CREATED_CLOCK, ctx.tz);
      const doneAt = doneOn ? at(doneOn, DONE_CLOCK, ctx.tz) : null;
      rows.push({
        id: firstId + rows.length,
        projectId: project.id,
        title: task.title,
        details: task.details,
        priority: task.priority,
        assigneeId: ownerId(task.owner),
        status: doneAt ? 'done' : 'open',
        doneAt,
        doneBy: doneAt ? pmId : null,
        createdBy: pmId,
        updatedBy: pmId,
        createdAt,
        updatedAt: doneAt ?? createdAt,
        phase,
        dueDate: dayOf(ctx, task.due),
      });
    }
  }
  return rows;
}

/** Files a project's priority tasks (priority.js) into a phase, with a due date. */
function placeExisting(ctx, plan, { project }, priorityRows) {
  for (const [title, [phase, due]] of Object.entries(plan.existing)) {
    const row = priorityRows.find((task) => task.projectId === project.id && task.title === title);
    if (!row) fail(`no priority task "${title}" on ${project.name}`);
    row.phase = phase;
    row.dueDate = dayOf(ctx, due);
  }
}

/**
 * The fingerprint projectSummaries' service compares with (its sourceKey): the summary reads as
 * up to date while the documents are the ones it was written from.
 */
function sourceKey(documents) {
  const lines = documents.map((row) => `${row.id}:${row.updatedAt.toISOString()}`).sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** project_documents rows and the project_summaries row written from them. */
function documentRows(ctx, plan, { project, pmId }, firstId) {
  const documents = (plan.documents ?? []).map((document, i) => {
    const [day, clock] = document.added;
    const addedAt = at(dayOf(ctx, day), clock, ctx.tz);
    const body = document.pages.join('\f');
    const pages = document.kind === 'file' ? document.pages.length : null;
    return {
      ref: document.ref,
      row: {
        id: firstId + i,
        projectId: project.id,
        phase: document.phase,
        kind: document.kind,
        title: document.title,
        body,
        pages,
        pagesTotal: pages,
        charCount: body.length,
        createdBy: pmId,
        updatedBy: pmId,
        createdAt: addedAt,
        updatedAt: addedAt,
      },
    };
  });
  if (!plan.summary) return { documents: documents.map(({ row }) => row), summary: null };
  const sent = documents.map(({ ref, row }) => ({ ...row, ref, text: row.body }));
  const checked = checkAnswer(plan.summary.answer, sent);
  if (!checked || checked.droppedCount > 0) fail(`a quote of ${project.name}'s summary is wrong`);
  const [day, clock] = plan.summary.written;
  const writtenAt = at(dayOf(ctx, day), clock, ctx.tz);
  const rows = documents.map(({ row }) => row);
  const summary = {
    projectId: project.id,
    body: toJson(checked.body),
    sourceKey: sourceKey(rows),
    truncated: false,
    droppedCount: 0,
    model: null, // written by hand for the demo
    createdBy: pmId,
    updatedBy: pmId,
    createdAt: writtenAt,
    updatedAt: writtenAt,
  };
  return { documents: rows, summary };
}

/** The health the Projects list and the project page will show, from the rows about to go in. */
function healthOf(ctx, project, deadline, tasks) {
  const weeks = lastFullWeeks(ctx.today, ctx.tz);
  const done = tasks.filter((task) => task.status === 'done');
  return forecastProject({
    status: project.status,
    total: tasks.length,
    done: done.length,
    doneByWeek: weeks.map(
      ({ from, to }) => done.filter((task) => task.doneAt >= from && task.doneAt < to).length,
    ),
    deadline,
    today: ctx.today,
    createdOn: workDate(ctx.tz, project.createdAt),
  }).kind;
}

/**
 * Every row of the demo plans. Sets `phase` and `dueDate` on the priority task rows, in place.
 * @param {PlanContext} ctx
 * @param {object[]} priorityRows project_tasks rows from buildPriorityTasks (ids 1..n)
 * @returns {{ plans: object[], phases: object[], tasks: object[], documents: object[],
 *   summaries: object[] }} tasks: the new project_tasks rows, ids after the priority tasks
 * @throws when a project wouldn't show its intended health or a summary quote isn't found
 */
export function buildProjectPlanRows(ctx, priorityRows) {
  for (const row of priorityRows) Object.assign(row, { phase: null, dueDate: null });
  const out = { plans: [], phases: [], tasks: [], documents: [], summaries: [] };
  for (const plan of PROJECT_PLANS) {
    const owner = projectOf(ctx, plan);
    placeExisting(ctx, plan, owner, priorityRows);
    const { row, phases } = planRows(ctx, plan, owner);
    const tasks = taskRows(ctx, plan, owner, priorityRows.length + out.tasks.length + 1);
    const { documents, summary } = documentRows(ctx, plan, owner, out.documents.length + 1);
    const all = [...priorityRows.filter((task) => task.projectId === owner.project.id), ...tasks];
    const health = healthOf(ctx, owner.project, row.deadline, all);
    if (health !== plan.health) {
      fail(`${owner.project.name} would read "${health}", not "${plan.health}"`);
    }
    out.plans.push(row);
    out.phases.push(...phases);
    out.tasks.push(...tasks);
    out.documents.push(...documents);
    if (summary) out.summaries.push(summary);
  }
  return out;
}
