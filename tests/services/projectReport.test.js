// Project report (CONTRACT section 12): totals and per-person minutes against hand-computed
// fixtures, range filters, carry-over chains, members without hours, drafts left out, paging of
// the daily log, the Excel workbook and the query schemas.
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { xlsxResponse } from '@/lib/excel';
import { setNowForTests } from '@/lib/time';
import { dashboard } from '@/modules/dashboard';
import { projectReportBuckets } from '@/modules/dashboard/projectReportPeriods';
import {
  projectIdParamSchema,
  projectReportQuerySchema,
  projectReportRangeSchema,
} from '@/modules/dashboard/projectReportSchemas';
import { taskChains } from '@/modules/dashboard/projectReportTasks';
import { safeText } from '@/modules/dashboard/projectReportWorkbook';
import { createUser, resetDatabase } from '../helpers/db.js';
import {
  NOW,
  addMembers,
  createProject,
  createProjectRequest,
  createReport,
} from './dashboardKit.js';

let pm;
let anu;
let ben;
let cara;
let dev;
let orion;
let other;
let empty;

const names = (rows) => rows.map((row) => row.user.name);

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(NOW); // Wednesday 30 September 2026, 6:52 PM in Kolkata
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  anu = await createUser({ name: 'Anu', designation: 'Backend developer' });
  ben = await createUser({ name: 'Ben', designation: 'QA engineer' });
  cara = await createUser({ name: 'Cara', designation: 'Designer' });
  dev = await createUser({ name: 'Dev', designation: 'Frontend developer' });
  const gone = await createUser({ name: 'Gone', status: 'deactivated' });
  orion = await createProject(pm, {
    name: '=orion',
    color: 'teal',
    isUrgent: true,
    urgentNote: 'Launch on Friday',
  });
  other = await createProject(pm, { name: 'other' });
  empty = await createProject(pm, {
    name: 'empty',
    createdAt: new Date('2026-09-10T05:00:00Z'),
  });
  await addMembers(orion, [anu, ben, dev, gone]);
  await addMembers(empty, [dev]);
  const request = await createProjectRequest(anu, { name: 'side-thing' });

  const p = orion.id;
  await createReport(anu, '2026-08-28', {
    entries: [{ projectId: p, minutes: 120, tasks: [{ title: 'Set up repo', status: 'done' }] }],
  });
  const day1 = await createReport(anu, '2026-09-01', {
    entries: [
      { projectId: p, minutes: 240, tasks: [{ title: 'Build login', status: 'in_progress' }] },
      { projectId: other.id, minutes: 60, tasks: [{ title: 'Other work', status: 'done' }] },
    ],
  });
  const day2 = await createReport(anu, '2026-09-02', {
    entries: [
      {
        projectId: p,
        minutes: 180,
        tasks: [
          {
            title: 'Build login',
            status: 'in_progress',
            firstReportedOn: '2026-09-01',
            carriedFromTaskId: day1.taskIds[0],
          },
          { title: 'Write docs', status: 'done' },
        ],
      },
      { projectRequestId: request.id, minutes: 30, tasks: [{ title: 'Side', status: 'done' }] },
    ],
  });
  await createReport(anu, '2026-09-03', {
    entries: [
      {
        projectId: p,
        minutes: 120,
        tasks: [
          {
            title: 'Build login (OAuth)',
            status: 'done',
            firstReportedOn: '2026-09-01',
            carriedFromTaskId: day2.taskIds[0],
          },
        ],
      },
    ],
  });
  const ben1 = await createReport(ben, '2026-09-29', {
    entries: [{ projectId: p, minutes: 300, tasks: [{ title: 'Fix bug', status: 'blocked' }] }],
  });
  await createReport(ben, '2026-09-30', {
    entries: [
      {
        projectId: p,
        minutes: 150,
        tasks: [
          {
            title: 'Fix bug',
            status: 'blocked',
            firstReportedOn: '2026-09-29',
            carriedFromTaskId: ben1.taskIds[0],
          },
        ],
      },
      { projectId: other.id, minutes: 90 },
    ],
  });
  await createReport(cara, '2026-09-28', {
    entries: [{ projectId: p, minutes: 90, tasks: [{ title: '+Review PR', status: 'done' }] }],
  });
  // Carried from a day whose task is gone: no link left, but the first day is kept.
  await createReport(cara, '2026-09-29', {
    entries: [
      {
        projectId: p,
        minutes: 60,
        tasks: [{ title: 'Deploy', status: 'in_progress', firstReportedOn: '2026-09-25' }],
      },
    ],
  });
  // A draft never counts.
  await createReport(cara, '2026-09-30', {
    status: 'draft',
    entries: [{ projectId: p, minutes: 240, tasks: [{ title: 'Draft task', status: 'done' }] }],
  });
});

describe('getProjectReport, all time', () => {
  let report;
  beforeAll(async () => {
    report = await dashboard.getProjectReport({ projectId: orion.id });
  });

  it('describes the project and starts at its first report', () => {
    expect(report.project).toMatchObject({
      id: orion.id,
      name: '=orion',
      color: 'teal',
      pmName: 'Pat Manager',
      statusLabel: 'Active',
      isUrgent: true,
      urgentNote: 'Launch on Friday',
    });
    expect(report.range).toMatchObject({
      key: 'all',
      from: '2026-08-28',
      to: '2026-09-30',
      label: 'All time',
      sub: 'since 28 Aug',
    });
  });

  it('adds up submitted minutes only (drafts, other projects and requests left out)', () => {
    // anu 120 + 240 + 180 + 120, ben 300 + 150, cara 90 + 60
    expect(report.totals).toMatchObject({
      minutes: 1260,
      hours: '21h',
      people: 3,
      members: 3,
      days: 7,
      tasks: 6,
      tasksDone: 4,
      tasksInProgress: 1,
      tasksBlocked: 1,
      firstReportOn: '2026-08-28',
      lastReportOn: '2026-09-30',
    });
  });

  it('lists everyone with hours, then members without any (active members only)', () => {
    expect(names(report.byPerson)).toEqual(['Anu', 'Ben', 'Cara', 'Dev']);
    const [a, b, c, d] = report.byPerson;
    expect(a).toMatchObject({
      minutes: 660,
      days: 4,
      firstOn: '2026-08-28',
      lastOn: '2026-09-03',
      isMember: true,
      noHours: false,
      tasksDone: 3,
      tasksInProgress: 0,
      tasksBlocked: 0,
      share: 52.4,
    });
    expect(a.user).toMatchObject({ id: anu.id, designation: 'Backend developer' });
    expect(a.user.href).toBe(`/team/${anu.id}`);
    expect(b).toMatchObject({ minutes: 450, days: 2, tasksBlocked: 1, isMember: true });
    expect(c).toMatchObject({
      minutes: 150,
      days: 2,
      isMember: false,
      tasksDone: 1,
      tasksInProgress: 1,
    });
    expect(d).toMatchObject({ minutes: 0, days: 0, noHours: true, isMember: true, firstOn: null });
  });

  it('collapses carried-over tasks into one row with the latest title and status', () => {
    const login = report.tasks.find((task) => task.title === 'Build login (OAuth)');
    expect(login).toMatchObject({
      status: 'done',
      firstReportedOn: '2026-09-01',
      lastReportedOn: '2026-09-03',
      daysReported: 3,
      minutesOnDays: 540,
      carried: true,
    });
    expect(login.user.name).toBe('Anu');
    expect(report.tasks.filter((task) => task.title.startsWith('Build login'))).toHaveLength(1);
    const bug = report.tasks.find((task) => task.title === 'Fix bug');
    expect(bug).toMatchObject({ status: 'blocked', daysReported: 2, minutesOnDays: 450 });
    const deploy = report.tasks.find((task) => task.title === 'Deploy');
    expect(deploy).toMatchObject({ firstReportedOn: '2026-09-25', carried: true });
    expect(report.tasks.map((task) => task.title)).not.toContain('Draft task');
    // Newest last report first; on the same day blocked, then in progress, then done.
    expect(report.tasks[0].title).toBe('Fix bug');
  });

  it('says who updated it last, from submitted reports', () => {
    expect(report.lastUpdate).toMatchObject({
      workDate: '2026-09-30',
      ago: 'today',
      user: { id: ben.id, name: 'Ben' },
      others: 0,
    });
    const kpis = Object.fromEntries(report.kpis.map((kpi) => [kpi.key, kpi]));
    expect(kpis.hours).toMatchObject({ value: '21h', sub: 'since 28 Aug' });
    expect(kpis.people).toMatchObject({ value: '3', footer: '3 members on the project' });
    expect(kpis.done).toMatchObject({ value: '4', sub: 'of 6 tasks' });
    expect(kpis.open).toMatchObject({ value: '2', sub: '1 blocked', percent: 50 });
    expect(kpis.lastUpdate).toMatchObject({ value: '30 Sep', footer: 'by Ben' });
  });

  it('pages the daily log, one row per person per day, newest first', async () => {
    expect(report.entriesPage).toEqual({ limit: 20, offset: 0, total: 8 });
    expect(report.entries.map((row) => [row.workDate, row.user.name, row.minutes])).toEqual([
      ['2026-09-30', 'Ben', 150],
      ['2026-09-29', 'Ben', 300],
      ['2026-09-29', 'Cara', 60],
      ['2026-09-28', 'Cara', 90],
      ['2026-09-03', 'Anu', 120],
      ['2026-09-02', 'Anu', 180],
      ['2026-09-01', 'Anu', 240],
      ['2026-08-28', 'Anu', 120],
    ]);
    expect(report.entries[5].tasks.map((task) => [task.title, task.status])).toEqual([
      ['Build login', 'in_progress'],
      ['Write docs', 'done'],
    ]);
    const next = await dashboard.getProjectReportEntries({
      projectId: orion.id,
      limit: 3,
      offset: 3,
    });
    expect(next.entriesPage).toEqual({ limit: 3, offset: 3, total: 8 });
    expect(next.entries.map((row) => [row.workDate, row.user.name])).toEqual([
      ['2026-09-28', 'Cara'],
      ['2026-09-03', 'Anu'],
      ['2026-09-02', 'Anu'],
    ]);
  });

  it('charts by week for a long range', () => {
    expect(report.periodUnit).toBe('week');
    expect(report.byPeriod.map((b) => [b.label, b.from, b.to, b.minutes])).toEqual([
      ['28 Aug', '2026-08-28', '2026-08-30', 120],
      ['31 Aug', '2026-08-31', '2026-09-06', 540],
      ['7 Sep', '2026-09-07', '2026-09-13', 0],
      ['14 Sep', '2026-09-14', '2026-09-20', 0],
      ['21 Sep', '2026-09-21', '2026-09-27', 0],
      ['28 Sep', '2026-09-28', '2026-09-30', 600],
    ]);
    expect(report.byPeriod.at(-1).current).toBe(true);
  });
});

describe('getProjectReport, ranges', () => {
  it('this week: Monday to Sunday by day, members without hours marked', async () => {
    const report = await dashboard.getProjectReport({ projectId: orion.id, range: 'week' });
    expect(report.range).toMatchObject({ from: '2026-09-28', to: '2026-10-04', end: '2026-09-30' });
    expect(report.totals).toMatchObject({ minutes: 600, people: 2, tasks: 3, tasksBlocked: 1 });
    expect(report.byPerson.map((row) => [row.user.name, row.minutes, row.noHours])).toEqual([
      ['Ben', 450, false],
      ['Cara', 150, false],
      ['Anu', 0, true],
      ['Dev', 0, true],
    ]);
    expect(report.periodUnit).toBe('day');
    expect(report.byPeriod.map((b) => [b.label, b.minutes, b.current, b.future])).toEqual([
      ['Mon', 90, false, false],
      ['Tue', 360, false, false],
      ['Wed', 150, true, false],
      ['Thu', 0, false, true],
      ['Fri', 0, false, true],
      ['Sat', 0, false, true],
      ['Sun', 0, false, true],
    ]);
    expect(report.exportHref).toBe(`/api/projects/${orion.id}/report/export?range=week`);
  });

  it('this month: September only', async () => {
    const report = await dashboard.getProjectReport({ projectId: orion.id, range: 'month' });
    expect(report.range).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(report.totals.minutes).toBe(1140);
    expect(report.byPeriod.map((b) => b.minutes)).toEqual([540, 0, 0, 0, 600]);
  });

  it('custom: a chain that started before the range still shows its first day', async () => {
    const report = await dashboard.getProjectReport({
      projectId: orion.id,
      range: 'custom',
      from: '2026-09-02',
      to: '2026-09-29',
    });
    expect(report.range).toMatchObject({ key: 'custom', label: '2 Sep to 29 Sep' });
    expect(report.totals.minutes).toBe(750);
    const login = report.tasks.find((task) => task.title === 'Build login (OAuth)');
    expect(login).toMatchObject({ firstReportedOn: '2026-09-01', daysReported: 2 });
    expect(report.tasks.filter((task) => task.title.startsWith('Build login'))).toHaveLength(1);
    expect(report.exportHref).toBe(
      `/api/projects/${orion.id}/report/export?range=custom&from=2026-09-02&to=2026-09-29`,
    );
  });

  it('a project without reports: zeros, its members, empty lists', async () => {
    const report = await dashboard.getProjectReport({ projectId: empty.id });
    expect(report.range).toMatchObject({ key: 'all', from: '2026-09-10', sub: 'all time' });
    expect(report.totals).toMatchObject({ minutes: 0, people: 0, members: 1, tasks: 0 });
    expect(report.byPerson.map((row) => [row.user.name, row.noHours])).toEqual([['Dev', true]]);
    expect(report.tasks).toEqual([]);
    expect(report.entries).toEqual([]);
    expect(report.lastUpdate).toBeNull();
    expect(report.kpis.find((kpi) => kpi.key === 'lastUpdate').value).toBe('—');
  });

  it('an unknown project is NOT_FOUND', async () => {
    await expect(dashboard.getProjectReport({ projectId: 999999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    await expect(dashboard.getProjectReportEntries({ projectId: 0 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('members, the contract call and the company day', () => {
  let vega;
  let nova;

  beforeAll(async () => {
    const ceo = await createUser({ name: 'Chief', role: 'admin', tracksAttendance: false });
    const left = await createUser({ name: 'Left', designation: 'Designer' });
    vega = await createProject(pm, { name: 'vega' });
    // 1:30 AM on 10 September in Kolkata, still the 9th in UTC.
    nova = await createProject(pm, { name: 'nova', createdAt: new Date('2026-09-09T20:00:00Z') });
    await addMembers(vega, [pm, ceo, left, dev]);
    await createReport(left, '2026-09-29', {
      entries: [
        { projectId: vega.id, minutes: 120, tasks: [{ title: 'Moodboard', status: 'done' }] },
      ],
    });
    await db('users').where({ id: left.id }).update({ status: 'deactivated' });
  });

  afterAll(() => setNowForTests(NOW));

  it('lists members who log hours; a PM or an untracked Admin on the team is left out', async () => {
    const report = await dashboard.getProjectReport({ projectId: vega.id });
    expect(report.byPerson.map((row) => [row.user.name, row.isMember, row.noHours])).toEqual([
      ['Left', true, false],
      ['Dev', true, true],
    ]);
    expect(report.byPerson[0].user.status).toBe('deactivated');
    expect(report.totals).toMatchObject({ members: 1, people: 1, minutes: 120 });
  });

  it('takes from and to without a range as a custom range (the contract signature)', async () => {
    const options = { projectId: orion.id, from: '2026-09-28', to: '2026-09-29' };
    const report = await dashboard.getProjectReport(options);
    expect(report.range).toMatchObject({ key: 'custom', from: '2026-09-28', to: '2026-09-29' });
    expect(report.totals.minutes).toBe(90 + 300 + 60);
    const log = await dashboard.getProjectReportEntries(options);
    expect(log.entriesPage.total).toBe(3);
  });

  it('counts days in the company time zone', async () => {
    const created = await dashboard.getProjectReport({ projectId: nova.id });
    expect(created.range).toMatchObject({ key: 'all', from: '2026-09-10' });

    setNowForTests('2026-09-30T18:29:00Z'); // 11:59 PM on Wednesday 30 September in Kolkata
    const lastDay = await dashboard.getProjectReport({ projectId: orion.id, range: 'month' });
    expect(lastDay.range).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(lastDay.totals.minutes).toBe(1140);

    setNowForTests('2026-09-30T19:00:00Z'); // 12:30 AM on Thursday 1 October
    const month = await dashboard.getProjectReport({ projectId: orion.id, range: 'month' });
    expect(month.range).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(month.totals.minutes).toBe(0);
    expect(month.lastUpdate).toMatchObject({ workDate: '2026-09-30', ago: 'yesterday' });
    const week = await dashboard.getProjectReport({ projectId: orion.id, range: 'week' });
    expect(week.range).toMatchObject({ from: '2026-09-28', end: '2026-10-01' });
    expect(week.totals.minutes).toBe(600);
    const all = await dashboard.getProjectReport({ projectId: orion.id });
    expect(all.range.to).toBe('2026-10-01');
  });
});

describe('carry-over chains', () => {
  it('joins versions by link and by the kept first day, and keeps different tasks apart', () => {
    const row = (id, extra) => ({
      id,
      userId: 1,
      entryId: id,
      title: 'Task',
      firstReportedOn: '2026-09-01',
      carriedFromTaskId: null,
      workDate: '2026-09-01',
      ...extra,
    });
    const chains = taskChains([
      row(1),
      row(2, { title: 'Renamed', carriedFromTaskId: 1, workDate: '2026-09-02' }),
      row(3, { title: ' task ', workDate: '2026-09-03' }),
      row(4, { title: 'Task', firstReportedOn: '2026-09-04', workDate: '2026-09-04' }),
      row(5, { userId: 2 }),
    ]);
    expect(chains.map((chain) => chain.map((version) => version.id))).toEqual([
      [1, 2, 3],
      [4],
      [5],
    ]);
  });

  it('buckets a long range by month', () => {
    const { unit, buckets } = projectReportBuckets(
      { key: 'custom', from: '2025-10-15', to: '2026-02-10' },
      [
        { workDate: '2025-11-20', minutes: 60 },
        { workDate: '2026-01-05', minutes: 30 },
      ],
      '2026-09-30',
    );
    expect(unit).toBe('month');
    expect(buckets.map((b) => [b.label, b.from, b.to, b.minutes])).toEqual([
      ["Oct '25", '2025-10-15', '2025-10-31', 0],
      ["Nov '25", '2025-11-01', '2025-11-30', 60],
      ["Dec '25", '2025-12-01', '2025-12-31', 0],
      ["Jan '26", '2026-01-01', '2026-01-31', 30],
      ["Feb '26", '2026-02-01', '2026-02-10', 0],
    ]);
  });
});

describe('project report workbook', () => {
  it('has Summary, People, Tasks and Daily log with dates, numbers and safe text', async () => {
    const spec = await dashboard.buildProjectReportExport({ projectId: orion.id });
    expect(spec.filename).toBe('daybook-project-orion-2026-08-28-to-2026-09-30.xlsx');
    expect(spec.sheets.map((sheet) => sheet.name)).toEqual([
      'Summary',
      'People',
      'Tasks',
      'Daily log',
    ]);
    const [summary, people, tasks, log] = spec.sheets;
    expect(summary.rows[0]).toEqual({ label: 'Project', value: "'=orion" });
    expect(summary.rows.find((row) => row.label === 'Hours logged').value).toBe(21);
    expect(people.rows.map((row) => [row.person, row.hours, row.member])).toEqual([
      ['Anu', 11, 'Yes'],
      ['Ben', 7.5, 'Yes'],
      ['Cara', 2.5, 'No'],
      ['Dev', 0, 'Yes'],
    ]);
    expect(tasks.rows.find((row) => row.task === "'+Review PR")).toMatchObject({
      status: 'Done',
      days: 1,
      hours: 1.5,
    });
    // Every row of the daily log, not just the first page.
    expect(log.rows).toHaveLength(8);
    expect(log.rows[0].date).toBeInstanceOf(Date);
    expect(log.rows[0].date.toISOString()).toBe('2026-09-30T00:00:00.000Z');

    const response = await xlsxResponse(spec);
    expect(response.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual([
      'Summary',
      'People',
      'Tasks',
      'Daily log',
    ]);
    const sheet = book.getWorksheet('Daily log');
    expect(sheet.rowCount).toBe(9);
    expect(sheet.getCell('A2').value).toBeInstanceOf(Date);
    expect(sheet.getCell('C2').value).toBe(2.5);
    expect(book.getWorksheet('People').getCell('A2').value).toBe('Anu');
  });

  it('guards text a spreadsheet would run as a formula', () => {
    expect(safeText('=HYPERLINK("x")')).toBe('\'=HYPERLINK("x")');
    expect(safeText('-1')).toBe("'-1");
    expect(safeText('@cmd')).toBe("'@cmd");
    expect(safeText('Plain task')).toBe('Plain task');
    expect(safeText(null)).toBe('');
  });
});

describe('project report query schemas', () => {
  it('defaults to all time, and dates alone mean custom', () => {
    expect(projectReportRangeSchema.parse({})).toMatchObject({ range: 'all' });
    expect(projectReportRangeSchema.parse({ from: '2026-09-01', to: '2026-09-10' })).toMatchObject({
      range: 'custom',
    });
    expect(projectReportQuerySchema.parse({ range: 'week' })).toMatchObject({
      range: 'week',
      limit: 20,
      offset: 0,
      section: 'all',
    });
  });

  it('takes plain digit project ids only', () => {
    expect(projectIdParamSchema.safeParse('12').data).toBe(12);
    expect(projectIdParamSchema.safeParse(12).data).toBe(12);
    for (const bad of ['0x2', '2e0', ' 2', '0', '-1', '1.5', '', '99999999999999999']) {
      expect(projectIdParamSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('rejects bad ranges and page sizes', () => {
    expect(
      projectReportRangeSchema.safeParse({ range: 'custom', from: '2026-09-01' }).success,
    ).toBe(false);
    expect(
      projectReportRangeSchema.safeParse({ from: '2026-09-10', to: '2026-09-01' }).success,
    ).toBe(false);
    expect(projectReportRangeSchema.safeParse({ range: 'year' }).success).toBe(false);
    expect(
      projectReportRangeSchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success,
    ).toBe(false);
    expect(projectReportQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(projectReportQuerySchema.safeParse({ offset: '-1' }).success).toBe(false);
  });
});

describe('data stays read-only', () => {
  it('the report writes nothing', async () => {
    const before = await db('dailyReports').count('* as count').first();
    await dashboard.getProjectReport({ projectId: orion.id });
    const after = await db('dailyReports').count('* as count').first();
    expect(after.count).toBe(before.count);
  });
});
