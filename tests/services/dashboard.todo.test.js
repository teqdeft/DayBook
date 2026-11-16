// Dashboards and today's to-do (CONTRACT 24): the board row's to-do with its counts, tags and the
// "Now" line, the no-todo filter, Slack post info only while posting is on, the Employee detail's
// to-do, lines closed from the suggestions left out of Tasks to watch, planned projects (0 hours)
// never shown or counted as worked, HR still forbidden, and the reads before migration 017.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { localToUtc, setNowForTests } from '@/lib/time';
import { isNowLine, todoPostingOn } from '@/modules/dashboard/todo';
import { setSlackClientForTests } from '@/modules/slack/client';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import {
  TODAY,
  TZ,
  checkIn,
  createProject,
  createProjectRequest,
  createReport,
} from './dashboardKit.js';
import { down as todoDown, up as todoUp } from '../../db/migrations/017_todo.js';

// A cookie jar standing in for next/headers, and the session the auth module "finds".
const jar = new Map();
const store = {
  get: (name) => (jar.has(name) ? { name, value: jar.get(name).value } : undefined),
  set: (name, value, options) => jar.set(name, { value, options }),
  delete: ({ name }) => jar.delete(name),
};
let sessionUser = null;

vi.mock('next/headers', () => ({ cookies: async () => store, headers: async () => new Headers() }));
vi.mock('@/modules/auth', () => ({ auth: { resolveSession: async () => sessionUser } }));

const { encodeSessionCookie } = await import('@/lib/session');
const { env } = await import('@/lib/env');
const { dashboard } = await import('@/modules/dashboard');
const { GET: getTeamToday } = await import('@/app/api/team/today/route.js');
const { GET: getEmployee } = await import('@/app/api/team/[userId]/route.js');

/** Wednesday 30 September 2026, 10:30 AM in Kolkata: before the report time. */
const MORNING = '2026-09-30T05:00:00Z';
const EXPIRES = new Date('2026-10-26T04:00:00Z');
const people = {};
const projects = {};
const lines = {};

function signInAs(user) {
  sessionUser = user && { ...user, sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

function get(handler, path, params = {}) {
  return handler(new Request(`http://localhost:3000/api${path}`), {
    params: Promise.resolve(params),
  });
}

const rowsOf = (team) => team.groups.flatMap((group) => group.rows);
const byName = (team) => Object.fromEntries(rowsOf(team).map((row) => [row.name, row]));
const local = (clock, date = TODAY) => localToUtc(date, clock, TZ).toDate();
const titles = (todo) => todo.groups.map((group) => group.lines.map((line) => line.title));

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(MORNING);
  people.pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  people.hr = await createUser({ name: 'Hana', role: 'hr', tracksAttendance: false });
  people.ceo = await createUser({ name: 'Chief', role: 'admin', tracksAttendance: false });
  for (const name of ['Priya Sharma', 'Vishal', 'Aman', 'Neha', 'Karan', 'Kiran']) {
    people[name.split(' ')[0].toLowerCase()] = await createUser({ name });
  }
  const { pm, priya, vishal, aman, neha, kiran } = people;
  projects.alpha = await createProject(pm, { name: 'Alpha', color: 'blue' });
  projects.beta = await createProject(pm, { name: 'Beta', color: 'green' });
  projects.request = await createProjectRequest(priya, { name: 'New site' });
  const { alpha, beta, request } = projects;

  await checkIn(priya, TODAY, { in: '09:32' });
  await checkIn(vishal, TODAY, { in: '09:30' });
  await checkIn(aman, TODAY, { in: '10:08', lateMinutes: 38 });
  await checkIn(neha, TODAY, { in: '09:41', location: 'wfh' });

  // Earlier days: the lines today's to-do was carried from, and open lines for Tasks to watch.
  const monday = await createReport(priya, '2026-09-28', {
    entries: [
      {
        projectId: alpha.id,
        minutes: 120,
        tasks: [{ title: 'Monitoring google ads campaign', status: 'in_progress' }],
      },
    ],
  });
  const tuesday = await createReport(priya, '2026-09-29', {
    entries: [
      {
        projectId: beta.id,
        minutes: 60,
        tasks: [{ title: 'Old beta task', status: 'in_progress' }],
      },
    ],
  });
  const old = await createReport(priya, '2026-09-21', {
    entries: [
      {
        projectId: alpha.id,
        minutes: 90,
        tasks: [
          { title: 'Audit backlinks', status: 'in_progress', firstReportedOn: '2026-09-14' },
          { title: 'Fix redirects', status: 'in_progress', firstReportedOn: '2026-09-14' },
        ],
      },
    ],
  });
  [lines.audit, lines.redirects] = old.taskIds;
  const kiranOld = await createReport(kiran, '2026-09-21', {
    entries: [
      {
        projectId: alpha.id,
        minutes: 60,
        tasks: [{ title: 'Old alpha task', status: 'in_progress' }],
      },
    ],
  });

  // Today: Priya's to-do (a draft) on two projects and a project request.
  const today = await createReport(priya, TODAY, {
    status: 'draft',
    entries: [
      {
        projectId: alpha.id,
        minutes: 0,
        tasks: [
          {
            title: 'Monitoring google ads campaign',
            status: 'in_progress',
            firstReportedOn: '2026-09-28',
            carriedFromTaskId: monday.taskIds[0],
          },
          { title: '1 web blog publish', status: 'done' },
          { title: 'Fix the sitemap', status: 'blocked' },
        ],
      },
      {
        projectRequestId: request.id,
        minutes: 0,
        tasks: [{ title: 'Kickoff notes', status: 'in_progress' }],
      },
      {
        projectId: beta.id,
        minutes: 0,
        tasks: [
          { title: 'Deploy the build', status: 'in_progress' },
          { title: 'Old beta task', status: 'in_progress', carriedFromTaskId: tuesday.taskIds[0] },
        ],
      },
    ],
  });
  people.priya.reportId = today.id;
  // Started from the line's Play button: the line keeps the timer's note, then was reworded.
  await db('reportTasks').where({ id: today.taskIds[4] }).update({ timerNote: 'Deploy build' });
  await db('timeEntries').insert({
    userId: priya.id,
    workDate: TODAY,
    projectId: beta.id,
    note: 'deploy   BUILD',
    startedAt: local('10:05'),
    source: 'timer',
  });
  // Vishal opened his report but has no lines; Aman has no report at all.
  await createReport(vishal, TODAY, {
    status: 'draft',
    entries: [{ projectId: alpha.id, minutes: 0 }],
  });
  // Neha submitted: Alpha with hours, Beta planned (0 hours, its task stays open).
  await createReport(neha, TODAY, {
    entries: [
      { projectId: alpha.id, minutes: 240, tasks: [{ title: 'Write the brief', status: 'done' }] },
      { projectId: beta.id, minutes: 0, tasks: [{ title: 'Plan beta', status: 'in_progress' }] },
    ],
  });
  // Kiran wrote a to-do before checking in.
  await createReport(kiran, TODAY, {
    status: 'draft',
    entries: [
      {
        projectId: alpha.id,
        minutes: 0,
        tasks: [
          {
            title: 'Old alpha task',
            status: 'in_progress',
            carriedFromTaskId: kiranOld.taskIds[0],
          },
        ],
      },
    ],
  });
});

beforeEach(() => {
  setNowForTests(MORNING);
  jar.clear();
  sessionUser = null;
});

afterAll(() => vi.restoreAllMocks());

describe('the board row to-do', () => {
  it("gives each person today's report lines by project in report order, with counts and tags", async () => {
    const row = byName(await dashboard.getTeamToday({ viewer: people.pm }))['Priya Sharma'];
    const { alpha, beta, request } = projects;
    expect(row.todo).toMatchObject({ total: 6, done: 1, post: null });
    expect(row.todo.groups.map((group) => group.project ?? group.request)).toEqual([
      { id: alpha.id, name: 'Alpha', color: 'blue' },
      { id: request.id, name: 'New site' },
      { id: beta.id, name: 'Beta', color: 'green' },
    ]);
    expect(titles(row.todo)).toEqual([
      ['Monitoring google ads campaign', '1 web blog publish', 'Fix the sitemap'],
      ['Kickoff notes'],
      ['Deploy the build', 'Old beta task'],
    ]);
    const [first, done, blocked] = row.todo.groups[0].lines;
    expect(first).toEqual({
      id: expect.any(Number),
      title: 'Monitoring google ads campaign',
      status: 'in_progress',
      done: false,
      now: false,
      carriedFrom: { workDate: '2026-09-28', dayLabel: 'From Monday' },
    });
    expect(done).toMatchObject({ status: 'done', done: true, carriedFrom: null });
    expect(blocked).toMatchObject({ status: 'blocked', done: false });
    expect(row.todo.groups[2].lines[1].carriedFrom).toEqual({
      workDate: '2026-09-29',
      dayLabel: 'From yesterday',
    });
    const kiran = byName(await dashboard.getTeamToday())['Kiran'];
    expect(kiran.todo.groups[0].lines[0].carriedFrom.dayLabel).toBe('From 21 Sep');
  });

  it('marks the line the running timer is on as Now, by its timer note or its title', async () => {
    const row = byName(await dashboard.getTeamToday())['Priya Sharma'];
    const nowLines = row.todo.groups.flatMap((group) => group.lines).filter((line) => line.now);
    expect(nowLines.map((line) => line.title)).toEqual(['Deploy the build']);

    const timer = { projectId: 7, note: '  Fix  the SITEMAP ' };
    expect(isNowLine({ title: 'Fix the sitemap' }, 7, timer)).toBe(true);
    expect(isNowLine({ title: 'Reworded', timerNote: 'fix the sitemap' }, 7, timer)).toBe(true);
    expect(isNowLine({ title: 'Fix the sitemap' }, 8, timer)).toBe(false);
    expect(isNowLine({ title: 'Fix the sitemap' }, null, timer)).toBe(false);
    expect(isNowLine({ title: 'Fix the sitemap' }, 7, { projectId: 7, note: null })).toBe(false);
    expect(isNowLine({ title: 'Fix the sitemap' }, 7, null)).toBe(false);
  });

  it('shows only the timer project before submit, and only projects with hours after it', async () => {
    const rows = byName(await dashboard.getTeamToday());
    expect(rows['Priya Sharma']).toMatchObject({
      report: 'draft',
      projects: [],
      workingOn: { name: 'Beta', color: 'green', note: 'deploy   BUILD' },
    });
    // Neha's Beta was planned (0 hours): it is in her to-do but never a label.
    expect(rows.Neha.projects).toEqual([{ name: 'Alpha', color: 'blue' }]);
    expect(rows.Neha.todo).toMatchObject({ total: 2, done: 1 });
    expect(titles(rows.Neha.todo)).toEqual([['Write the brief'], ['Plan beta']]);
  });

  it('says "No to-do yet" only for someone checked in whose report is not in and has no lines', async () => {
    const team = await dashboard.getTeamToday();
    const rows = byName(team);
    const flags = ({ todo, noTodo }) => ({ todo: Boolean(todo), noTodo });
    expect(flags(rows.Vishal)).toEqual({ todo: false, noTodo: true });
    expect(flags(rows.Aman)).toEqual({ todo: false, noTodo: true });
    expect(flags(rows.Neha)).toEqual({ todo: true, noTodo: false });
    expect(flags(rows.Karan)).toEqual({ todo: false, noTodo: false });
    expect(flags(rows.Kiran)).toEqual({ todo: true, noTodo: false });
    expect(team.counts.noTodo).toBe(2);

    const filtered = await dashboard.getTeamToday({ filter: 'no-todo' });
    expect(filtered.filter).toBe('no-todo');
    expect(rowsOf(filtered).map((row) => row.name)).toEqual(['Vishal', 'Aman']);
    expect(filtered.counts).toEqual(team.counts);
  });

  it('gives the Slack post only while to-dos are posted (Slack on, a bot token and a to-do channel)', async () => {
    expect(todoPostingOn({ slackEnabled: true, slackTodoChannelId: null }, true)).toBe(false);
    expect(todoPostingOn({ slackEnabled: false, slackTodoChannelId: 'C1' }, true)).toBe(false);
    expect(todoPostingOn({ slackEnabled: true, slackTodoChannelId: 'C1' }, false)).toBe(false);
    expect(todoPostingOn({ slackEnabled: true, slackTodoChannelId: 'C1' }, true)).toBe(true);
    await db('dailyReports')
      .where({ id: people.priya.reportId })
      .update({ todoPostedAt: new Date('2026-09-30T04:11:00Z') });
    try {
      expect(byName(await dashboard.getTeamToday())['Priya Sharma'].todo.post).toBeNull();
      await setSettings({ slack_todo_channel_id: 'C0TODO', slack_todo_channel_name: 'to-do' });
      // No bot token: nobody can post (Today has no button), so the board says nothing of Slack.
      expect(byName(await dashboard.getTeamToday())['Priya Sharma'].todo.post).toBeNull();
      const detail = await dashboard.getEmployeeDetail({ userId: people.priya.id });
      expect(detail.todoToday.post).toBeNull();
      setSlackClientForTests({});
      const rows = byName(await dashboard.getTeamToday());
      expect(rows['Priya Sharma'].todo.post).toEqual({
        postedAt: '2026-09-30T04:11:00.000Z',
        at: '9:41 AM',
      });
      expect(rows.Neha.todo.post).toEqual({ postedAt: null, at: null });
      await setSettings({ slack_enabled: false });
      expect(byName(await dashboard.getTeamToday())['Priya Sharma'].todo.post).toBeNull();
    } finally {
      setSlackClientForTests(null);
      await setSettings({
        slack_enabled: true,
        slack_todo_channel_id: null,
        slack_todo_channel_name: null,
      });
    }
  });
});

describe('the Employee detail', () => {
  it("shows today's to-do as on the board; empty for someone without lines; none for a PM", async () => {
    const board = byName(await dashboard.getTeamToday())['Priya Sharma'];
    const priya = await dashboard.getEmployeeDetail({ userId: people.priya.id, viewer: people.pm });
    expect(priya.todoToday).toEqual(board.todo);
    const vishal = await dashboard.getEmployeeDetail({ userId: people.vishal.id });
    expect(vishal.todoToday).toEqual({ total: 0, done: 0, post: null, groups: [] });
    const pm = await dashboard.getEmployeeDetail({ userId: people.pm.id });
    expect(pm.todoToday).toBeNull();
  });

  it('leaves lines closed from the suggestions out of Tasks to watch and the stuck count', async () => {
    const detail = () => dashboard.getEmployeeDetail({ userId: people.priya.id });
    const before = (await detail()).tasks;
    expect(before.items.map((task) => task.title)).toEqual(
      expect.arrayContaining(['Audit backlinks', 'Fix redirects']),
    );
    expect(before.stuckCount).toBe(2);
    await db('reportTasks')
      .where({ id: lines.audit })
      .update({ carryClosedAt: new Date('2026-09-30T04:30:00Z'), carryClosedReason: 'dropped' });
    await db('reportTasks')
      .where({ id: lines.redirects })
      .update({ carryClosedAt: new Date('2026-09-29T12:00:00Z'), carryClosedReason: 'done' });
    const after = await detail();
    expect(after.tasks.items.map((task) => task.title)).not.toContain('Audit backlinks');
    expect(after.tasks.items.map((task) => task.title)).not.toContain('Fix redirects');
    expect(after.tasks.stuckCount).toBe(0);
    // Report history says so under the old lines; the old report itself is unchanged.
    const day = after.history.find((row) => row.date === '2026-09-21');
    expect(day.entries[0].tasks.map((task) => [task.title, task.status, task.closedNote])).toEqual([
      ['Audit backlinks', 'in_progress', 'Marked not needed on Wed, 30 Sep'],
      ['Fix redirects', 'in_progress', 'Marked done on Tue, 29 Sep'],
    ]);
    const monday = after.history.find((row) => row.date === '2026-09-28');
    expect(monday.entries[0].tasks[0].closedNote).toBeNull();
  });
});

describe('a planned project (0 hours) is never shown or counted as worked', () => {
  it('stays out of the history projects, hours, the export summary and the project report', async () => {
    const neha = await dashboard.getEmployeeDetail({ userId: people.neha.id });
    const today = neha.history.find((row) => row.date === TODAY);
    expect(today.projects).toEqual([{ name: 'Alpha', color: 'blue' }]);
    expect(today.entries.flatMap((entry) => entry.tasks.map((task) => task.title))).toContain(
      'Plan beta',
    );
    expect(neha.hours.rows.map((row) => row.name)).toEqual(['Alpha']);
    expect(neha.stats.logged).toBe('4h');

    const hours = await dashboard.getHoursByProject({ from: TODAY, to: TODAY });
    expect(hours.rows.map((row) => [row.name, row.minutes])).toEqual([['Alpha', 240]]);

    const book = await dashboard.buildHoursExport({ from: TODAY, to: TODAY });
    const summary = book.sheets[1].rows.map((row) => [row.person, row.project, row.hours]);
    expect(summary).toEqual([['Neha', 'Alpha', 4]]);

    const report = await dashboard.getProjectReport({ projectId: projects.beta.id });
    expect(report.totals).toMatchObject({ minutes: 60, days: 1, people: 1 });
    expect(report.lastUpdate).toMatchObject({ workDate: '2026-09-29' });
    expect(report.lastUpdate.user.name).toBe('Priya Sharma');
    expect(report.entries.map((entry) => entry.workDate)).not.toContain(TODAY);
    expect(report.tasks.map((task) => task.title)).toEqual(['Old beta task']);
  });
});

describe('who sees it', () => {
  it('gives PMs the to-do through the routes, and HR still gets FORBIDDEN', async () => {
    signInAs(people.pm);
    const team = await get(getTeamToday, '/team/today?filter=no-todo');
    expect(team.status).toBe(200);
    expect(rowsOf((await team.json()).data).map((row) => row.name)).toEqual(['Vishal', 'Aman']);
    const all = (await (await get(getTeamToday, '/team/today')).json()).data;
    expect(byName(all)['Priya Sharma'].todo.total).toBe(6);
    const params = { userId: String(people.priya.id) };
    const detail = await get(getEmployee, `/team/${people.priya.id}`, params);
    expect((await detail.json()).data.todoToday.total).toBe(6);

    signInAs(people.hr);
    for (const response of [
      await get(getTeamToday, '/team/today'),
      await get(getEmployee, `/team/${people.priya.id}`, params),
    ]) {
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe('FORBIDDEN');
    }
  });
});

describe('before migration 017', () => {
  it('still reads the board and the Employee detail, without post info or closed lines', async () => {
    const warn = vi.spyOn(logger, 'warn');
    await setSettings({ slack_todo_channel_id: 'C0TODO' });
    setSlackClientForTests({});
    await todoDown(db);
    try {
      const rows = byName(await dashboard.getTeamToday());
      expect(rows['Priya Sharma'].todo).toMatchObject({ total: 6, done: 1 });
      expect(rows['Priya Sharma'].todo.post).toEqual({ postedAt: null, at: null });
      const detail = await dashboard.getEmployeeDetail({ userId: people.priya.id });
      expect(detail.todoToday.total).toBe(6);
      // Closed lines read as open again, as before 1.09.
      expect(detail.tasks.items.map((task) => task.title)).toContain('Audit backlinks');
      const day = detail.history.find((row) => row.date === '2026-09-21');
      expect(day.entries[0].tasks[0].closedNote).toBeNull();
      const todoWarnings = warn.mock.calls.filter(([text]) => /to-do columns/.test(String(text)));
      expect(todoWarnings).toHaveLength(1);
    } finally {
      await todoUp(db);
      setSlackClientForTests(null);
      await setSettings({ slack_todo_channel_id: null });
      warn.mockRestore();
    }
  });
});
