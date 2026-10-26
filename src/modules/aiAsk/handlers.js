// Ask Daybook's tools (CONTRACT 20): each one checks the viewer may use it ({ error: 'not
// allowed' } otherwise), resolves names only among what the viewer may see, keeps every read to
// the viewer's projects and people, and answers with short rows: durations as "2h 15m" (`time`)
// next to the minutes, never e-mails, Slack ids or IPs. At most 200 rows.
import { ROLE_LABELS } from '@/lib/permissions';
import { formatDuration, workDate } from '@/lib/time';
import * as repo from './repo';
import { capRows, MAX_ROWS, optionalText, parseRange } from './schemas';
import { resolveName } from './scope';

export const NOT_ALLOWED = Object.freeze({ error: 'not allowed' });

const PROJECT_STATUS = { active: 'Active', on_hold: 'On hold', completed: 'Completed' };
const TASK_STATUS = { done: 'Done', in_progress: 'In progress', blocked: 'Blocked' };
const PRIORITY = { p1: 'P1', p2: 'P2', p3: 'P3' };
const PM_NOTE = 'Only projects you manage, and the people on them.';

/** The viewer's projects to read: one named project, or all of them (null = every project). */
function projectFilter(args, scope) {
  const name = optionalText(args?.projectName);
  if (!name) return { projectIds: scope.projectIds, named: null };
  const found = resolveName(scope.projects, name, 'project');
  if (found.error) return found;
  return { projectIds: [found.item.id], named: found.item.name };
}

/**
 * One named person among the viewer's people, or everyone (null: the projects already keep a PM
 * to the hours and tasks on their own projects).
 */
function personFilter(args, scope) {
  const name = optionalText(args?.personName);
  if (!name) return { userIds: null, named: null };
  const found = resolveName(scope.workPeople, name, 'person');
  if (found.error) return found;
  return { userIds: [found.item.id], named: found.item.name };
}

/** Range, project and person of a work tool, or the first problem as { error }. */
function workFilters(args, scope, { person = false } = {}) {
  const range = parseRange(args);
  if (range.error) return range;
  const project = projectFilter(args, scope);
  if (project.error) return project;
  const who = person ? personFilter(args, scope) : { userIds: null, named: null };
  if (who.error) return who;
  return {
    ...range,
    projectIds: project.projectIds,
    userIds: who.userIds,
    // Hours on pending project requests: only for an Admin's company-wide view.
    withRequests: scope.kind === 'admin' && !project.named,
    project: project.named,
    person: who.named,
  };
}

const timeOf = (minutes) => ({ minutes, time: formatDuration(minutes) });
const sum = (rows) => rows.reduce((total, row) => total + row.minutes, 0);
const scoped = (scope) => (scope.kind === 'admin' ? {} : { scope: PM_NOTE });
const requestedName = (row) => (row.requested ? `${row.name} (requested project)` : row.name);

export function listProjects(args, { scope }) {
  if (!scope.work) return NOT_ALLOWED;
  const status = PROJECT_STATUS[args?.status] ? args.status : null;
  const rows = scope.projects
    .filter((project) => !status || project.status === status)
    .map((project) => ({
      project: project.name,
      client: project.clientName,
      projectManager: project.pmName,
      status: PROJECT_STATUS[project.status] ?? project.status,
      urgent: Boolean(project.isUrgent),
    }));
  const { rows: projects, truncated } = capRows(rows);
  return { ...scoped(scope), count: rows.length, projects, ...(truncated ? { truncated } : {}) };
}

export function listPeople(args, { scope }) {
  if (!scope.work && !scope.attendance) return NOT_ALLOWED;
  const rows = scope.people.map((person) => ({
    name: person.name,
    role: ROLE_LABELS[person.role] ?? person.role,
    designation: person.designation || null,
    department: person.departmentName,
    ...(person.status === 'active' ? {} : { deactivated: true }),
  }));
  const { rows: people, truncated } = capRows(rows);
  return { count: rows.length, people, ...(truncated ? { truncated } : {}) };
}

export async function hoursByProject(args, { scope }) {
  if (!scope.work) return NOT_ALLOWED;
  const filters = workFilters(args, scope);
  if (filters.error) return filters;
  const rows = await repo.hoursByProject(filters);
  const { rows: shown, truncated } = capRows(rows);
  return {
    from: filters.from,
    to: filters.to,
    source: 'Submitted daily reports',
    ...scoped(scope),
    projects: shown.map((row) => ({
      project: requestedName(row),
      ...timeOf(row.minutes),
      people: row.people,
      days: row.days,
    })),
    total: timeOf(sum(rows)),
    ...(truncated ? { truncated } : {}),
    ...(rows.length === 0 ? { note: 'No submitted hours in this range.' } : {}),
  };
}

/** Person groups with their project lines, at most MAX_ROWS lines in all. */
function groupByPerson(rows) {
  const groups = new Map();
  for (const row of rows) {
    const group = groups.get(row.userId) ?? { person: row.userName, lines: [] };
    group.lines.push(row);
    groups.set(row.userId, group);
  }
  let budget = MAX_ROWS;
  const people = [];
  for (const group of groups.values()) {
    if (budget <= 0) break;
    const lines = group.lines.slice(0, budget);
    budget -= lines.length;
    people.push({
      person: group.person,
      total: timeOf(sum(group.lines)),
      projects: lines.map((row) => ({
        project: requestedName({ name: row.projectName, requested: row.requested }),
        ...timeOf(row.minutes),
        days: row.days,
      })),
    });
  }
  const truncated = rows.length > MAX_ROWS ? { shown: MAX_ROWS, total: rows.length } : null;
  return { people, truncated };
}

export async function hoursByPerson(args, { scope }) {
  if (!scope.work) return NOT_ALLOWED;
  const filters = workFilters(args, scope, { person: true });
  if (filters.error) return filters;
  const rows = await repo.hoursByPerson(filters);
  const { people, truncated } = groupByPerson(rows);
  return {
    from: filters.from,
    to: filters.to,
    source: 'Submitted daily reports',
    ...scoped(scope),
    people,
    total: timeOf(sum(rows)),
    ...(truncated ? { truncated } : {}),
    ...(rows.length === 0 ? { note: 'No submitted hours for this.' } : {}),
  };
}

/** The latest line of each carry-over chain (a task carried to a later day shows once). */
function latestOfChains(lines) {
  const carried = new Set(lines.map((line) => line.carriedFromTaskId).filter(Boolean));
  return lines.filter((line) => !carried.has(line.id));
}

export async function reportTasks(args, { scope }) {
  if (!scope.work) return NOT_ALLOWED;
  const filters = workFilters(args, scope, { person: true });
  if (filters.error) return filters;
  const status = TASK_STATUS[args?.status] ? args.status : null;
  const read = await repo.listReportTasks(filters);
  const lines = latestOfChains(read.slice(0, repo.MAX_TASK_LINES)).filter(
    (line) => !status || line.status === status,
  );
  const counts = { done: 0, inProgress: 0, blocked: 0 };
  for (const line of lines) {
    counts[line.status === 'in_progress' ? 'inProgress' : line.status] += 1;
  }
  const { rows, truncated } = capRows(lines);
  return {
    from: filters.from,
    to: filters.to,
    source: 'Submitted daily reports (latest status of each task)',
    ...scoped(scope),
    counts,
    tasks: rows.map((line) => ({
      date: line.workDate,
      person: line.userName,
      project: line.projectName ?? `${line.requestName} (requested project)`,
      task: line.title,
      status: TASK_STATUS[line.status] ?? line.status,
      firstReported: line.firstReportedOn,
      ...(line.priority ? { priority: PRIORITY[line.priority] } : {}),
    })),
    ...(truncated ? { truncated } : {}),
    ...(read.length > repo.MAX_TASK_LINES
      ? { note: 'Only the newest task lines were read. Ask about a shorter period for older ones.' }
      : {}),
  };
}

export async function priorityTasks(args, { scope, tz }) {
  if (!scope.work) return NOT_ALLOWED;
  const project = projectFilter(args, scope);
  if (project.error) return project;
  const status = args?.status === 'open' || args?.status === 'done' ? args.status : undefined;
  const rows = await repo.listPriorityTasks({
    projectIds: project.projectIds,
    status,
    limit: MAX_ROWS + 1,
  });
  return {
    ...scoped(scope),
    tasks: rows.slice(0, MAX_ROWS).map((row) => ({
      task: row.title,
      project: row.projectName,
      priority: PRIORITY[row.priority] ?? row.priority,
      status: row.status === 'done' ? 'Done' : 'Open',
      assignedTo: row.assigneeName ?? 'Anyone on the project',
      added: workDate(tz, row.createdAt),
      ...(row.doneAt ? { done: workDate(tz, row.doneAt) } : {}),
    })),
    ...(rows.length > MAX_ROWS
      ? { truncated: { shown: MAX_ROWS, total: `more than ${MAX_ROWS}` } }
      : {}),
    ...(rows.length === 0 ? { note: 'No priority tasks for this.' } : {}),
  };
}
