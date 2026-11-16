// The demo's to-do and open lines (db/demo/todo.js, CONTRACT 24): on any day of the week, the lines
// left open on purpose are suggestions by the contract's rule (open, submitted, in the last 30
// days, carried on by no line, no later line of the same title on the project), Ankit's draft
// today is a to-do with a ticked line, a line carried from yesterday and a planned project at 0
// minutes, and Karan has nothing suggested on acme-app (checkin-report.spec.js picks it by its
// exact name).
import { afterEach, describe, expect, it } from 'vitest';
import { addDays, localToUtc, setNowForTests } from '@/lib/time';
import { normalizeTitle } from '@/modules/reports/todoText';
import { anchorDate, workingDaysBack } from '../../db/demo/calendar.js';
import { PEOPLE } from '../../db/demo/people.js';
import { planAllDays } from '../../db/demo/plan.js';
import { COMPLETED_PROJECTS, PROJECTS } from '../../db/demo/projects.js';
import { buildRows } from '../../db/demo/rows.js';
import { assignTasks } from '../../db/demo/tasks.js';
import { OPEN_LINES, TODO_TODAY, addTodoLines } from '../../db/demo/todo.js';
import { DEFAULT_SETTINGS } from '../../db/seeds/03_settings.js';

const TZ = DEFAULT_SETTINGS.timezone;
const WORKING_DAYS = DEFAULT_SETTINGS.working_days;
// A Monday, a Wednesday, a Friday and a Sunday (anchored to the Friday before).
const DAYS = ['2026-11-09', '2026-11-11', '2026-11-13', '2026-11-15'];

/** The seed's plans and rows on a day (as seedDemo.js builds them), without a database. */
function demoRows(day) {
  setNowForTests(localToUtc(day, '12:00', TZ).toISOString());
  const anchor = anchorDate(TZ, WORKING_DAYS);
  const days = workingDaysBack(anchor, WORKING_DAYS);
  const projects = new Map(
    [...PROJECTS, ...COMPLETED_PROJECTS].map((project, i) => [
      project.key,
      { ...project, id: i + 1 },
    ]),
  );
  const users = new Map(PEOPLE.map((person, i) => [person.key, { id: i + 2 }]));
  const plans = planAllDays({
    days,
    lateAfter: DEFAULT_SETTINGS.late_after,
    midday: false,
    projects,
  });
  assignTasks(plans);
  addTodoLines(plans);
  const { rows } = buildRows(plans, {
    tz: TZ,
    reportLock: DEFAULT_SETTINGS.report_lock,
    days,
    users,
    projects,
  });
  return { rows, anchor, days, users, projects };
}

/** Every report line of a person, with its report and project: newest day first. */
function linesOf({ rows, users }, key) {
  const userId = users.get(key).id;
  const reports = new Map(rows.reports.map((report) => [report.id, report]));
  const entries = new Map(rows.entries.map((entry) => [entry.id, entry]));
  return rows.tasks
    .map((task) => {
      const entry = entries.get(task.entryId);
      const report = reports.get(entry.reportId);
      return { ...task, entry, report, projectId: entry.projectId };
    })
    .filter((line) => line.report.userId === userId)
    .sort((a, b) => b.report.workDate.localeCompare(a.report.workDate));
}

/** The person's suggestions by project id: [title], by CONTRACT 24's rule. */
function suggestionsOf(demo, key) {
  const lines = linesOf(demo, key);
  const from = addDays(demo.anchor, -30);
  const carried = new Set(lines.map((line) => line.carriedFromTaskId).filter(Boolean));
  const titleOf = (line) => `${line.projectId}|${normalizeTitle(line.title)}`;
  const byProject = new Map();
  for (const line of lines) {
    const open =
      line.report.status === 'submitted' &&
      ['in_progress', 'blocked'].includes(line.status) &&
      line.report.workDate >= from &&
      line.report.workDate < demo.anchor &&
      !carried.has(line.id);
    const later = lines.some(
      (other) => titleOf(other) === titleOf(line) && other.report.workDate > line.report.workDate,
    );
    if (!open || later) continue;
    byProject.set(line.projectId, [...(byProject.get(line.projectId) ?? []), line.title]);
  }
  return byProject;
}

afterEach(() => setNowForTests(null));

describe.each(DAYS)('the demo to-do on %s', (day) => {
  it('suggests every line left open on purpose, except the one Ankit carried today', () => {
    const demo = demoRows(day);
    for (const line of OPEN_LINES) {
      const projectId = demo.projects.get(line.project).id;
      const titles = suggestionsOf(demo, line.key).get(projectId) ?? [];
      const carriedToday = TODO_TODAY.lines.some(
        (todo) => todo.carried && todo.title === line.title && line.key === TODO_TODAY.key,
      );
      if (carriedToday) expect(titles).not.toContain(line.title);
      else expect(titles).toContain(line.title);
    }
  });

  it("gives Ankit's draft today a ticked line, a carried line and a planned project", () => {
    const demo = demoRows(day);
    const today = linesOf(demo, 'ankit').filter((line) => line.report.workDate === demo.anchor);
    expect(new Set(today.map((line) => line.report.status))).toEqual(new Set(['draft']));
    const byTitle = new Map(today.map((line) => [line.title, line]));

    expect(byTitle.get('Meta titles for the category pages').status).toBe('done');

    const carried = byTitle.get('Internal links for the blog');
    const source = demo.rows.tasks.find((task) => task.id === carried.carriedFromTaskId);
    expect(source).toMatchObject({ title: carried.title, status: 'in_progress' });
    expect(carried).toMatchObject({ status: 'in_progress', firstReportedOn: demo.days[1] });

    const planned = byTitle.get('Backlink list for the gym pages');
    expect(planned.entry).toMatchObject({
      projectId: demo.projects.get('urbanfit').id,
      minutes: 0,
    });
    expect(planned.status).toBe('in_progress');
  });

  it('suggests nothing to Karan on acme-app', () => {
    const demo = demoRows(day);
    expect(suggestionsOf(demo, 'karan').get(demo.projects.get('app').id)).toBeUndefined();
  });
});
