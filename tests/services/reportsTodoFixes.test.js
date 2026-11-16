// Two to-do rules that cross into the report (CONTRACT 24): Play's timer note is part of the
// report's version, so a report tab opened before Play can't save the line without it (and Fill
// still merges into the line); renaming a to-do line to a suggestion's title carries the line,
// as typing that title does.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { entriesFromView, serialize } from '@/app/(app)/report/reportState';
import { mergeTimerSummary } from '@/app/(app)/report/reportTimers';
import { db } from '@/lib/db';
import { preferences } from '@/modules/preferences';
import { reports } from '@/modules/reports';
import { saveReportSchema } from '@/modules/reports/schemas';
import { contentVersion } from '@/modules/reports/view';
import { checkIn } from './dashboardKit.js';
import { insertReport } from './reportsTestKit.js';
import { addTask, caught, setClock, TODAY, YESTERDAY } from './timersKit.js';
import { clearTodoTables, createTodoWorld, linesOf } from './todoKit.js';

let pm;
let emp;
let acme;
let beta;

beforeAll(async () => {
  ({ pm, emp, acme, beta } = await createTodoWorld());
});

beforeEach(async () => {
  setClock('09:30');
  await clearTodoTables();
  for (const table of ['timeEntries', 'attendanceBreaks', 'attendance']) await db(table).del();
  await preferences.update({ user: emp, values: { carryOver: true } });
});

const add = (title, project = acme) =>
  reports.addTodoLine({ user: emp, projectId: project.id, title });
const rowOf = (id) => db('reportTasks').where({ id }).first();

describe('Play and a report tab opened before it', () => {
  /** The report page's autosave of rows it holds, as the browser sends them. */
  function saveFromTab(tab, rows) {
    return reports.saveReport({
      user: emp,
      reportId: tab.id,
      entries: saveReportSchema.parse({ entries: serialize(rows).body }).entries,
      baseVersion: tab.version,
    });
  }

  const reworded = (view) =>
    entriesFromView(view).map((entry) => ({
      ...entry,
      hours: '1h',
      savedMinutes: 60,
      tasks: entry.tasks.map((task) => ({ ...task, title: 'Fixed the login redirect bug' })),
    }));

  it('refuses the old tab, keeps the note, and Fill still merges into the line', async () => {
    await checkIn(emp, TODAY, { in: '09:00' });
    const { lineId } = await add('Fix login bug');
    const tab = await reports.openForDate({ user: emp, workDate: TODAY });
    setClock('10:00');
    await reports.startTodoTimer({ user: emp, id: lineId });
    const fresh = await reports.openForDate({ user: emp, workDate: TODAY });
    // The version changed, so the tab re-reads when it becomes visible (showLatest).
    expect(fresh.version).not.toBe(tab.version);

    setClock('11:00');
    expect(await caught(saveFromTab(tab, reworded(tab)))).toMatchObject({ code: 'CONFLICT' });
    expect((await rowOf(lineId)).timerNote).toBe('Fix login bug');

    // The re-read page saves the reword and keeps the note; Fill adds no second line.
    await saveFromTab(fresh, reworded(fresh));
    expect(await rowOf(lineId)).toMatchObject({
      title: 'Fixed the login redirect bug',
      timerNote: 'Fix login bug',
    });
    setClock('12:00');
    const view = await reports.openForDate({ user: emp, workDate: TODAY });
    const { summary } = await reports.getTimersForReport({ user: emp, reportId: view.id });
    const filled = mergeTimerSummary(entriesFromView(view), summary);
    expect(filled[0].tasks.map((task) => task.title)).toEqual(['Fixed the login redirect bug']);
  });

  it('hashes a line without a note as before, and a note changes the version', () => {
    const entry = (task) => [{ id: 1, projectId: 2, minutes: 60, tasks: [task] }];
    const line = { id: 3, title: 'Write the brief', status: 'in_progress' };
    expect(contentVersion('draft', entry({ ...line, timerNote: null }))).toBe(
      contentVersion('draft', entry(line)),
    );
    expect(contentVersion('draft', entry({ ...line, timerNote: 'Brief' }))).not.toBe(
      contentVersion('draft', entry(line)),
    );
  });
});

describe('renaming a to-do line to a suggestion title', () => {
  /** Yesterday's open line on acme (first reported on 20 Sep), with a priority task and a note. */
  async function openTask(status = 'blocked') {
    const priority = await addTask(acme, pm, { title: 'Redirect map' });
    const { taskIds } = await insertReport(emp, YESTERDAY, {
      entries: [
        {
          project: acme,
          minutes: 60,
          tasks: [{ title: 'Fix the redirects', status, firstReportedOn: '2026-09-20' }],
        },
      ],
    });
    await db('reportTasks')
      .where({ id: taskIds[0] })
      .update({ projectTaskId: priority, timerNote: 'Redirects' });
    return { source: taskIds[0], priority };
  }

  it('carries the line from that open task and the suggestion goes away', async () => {
    const { source, priority } = await openTask();
    const { lineId, suggestions } = await add('Fix it');
    expect(suggestions[`p${acme.id}`]).toHaveLength(1);

    const todo = await reports.updateTodoLine({
      user: emp,
      id: lineId,
      title: 'fix the  Redirects',
    });
    expect(await rowOf(lineId)).toMatchObject({
      title: 'fix the Redirects',
      carriedFromTaskId: source,
      firstReportedOn: '2026-09-20',
      status: 'blocked',
      projectTaskId: priority,
      timerNote: 'Redirects',
    });
    expect(linesOf(todo, acme)[0]).toMatchObject({
      id: lineId,
      carriedFrom: { workDate: YESTERDAY, dayLabel: 'From yesterday' },
    });
    expect(todo.suggestions).toEqual({});
  });

  it('keeps a Done line Done, and a line that already continues a task keeps its link', async () => {
    const { source } = await openTask('in_progress');
    const { lineId } = await add('Fix it');
    await reports.updateTodoLine({ user: emp, id: lineId, done: true });
    await reports.updateTodoLine({ user: emp, id: lineId, title: 'Fix the redirects' });
    expect(await rowOf(lineId)).toMatchObject({ carriedFromTaskId: source, status: 'done' });

    // Renamed again, to anything: the link stays, nothing else is carried.
    await reports.updateTodoLine({ user: emp, id: lineId, title: 'Redirects for the blog' });
    expect(await rowOf(lineId)).toMatchObject({ carriedFromTaskId: source, status: 'done' });
  });

  it("doesn't carry with carry forward off or from another project's task", async () => {
    await openTask();
    const { lineId: other } = await add('Fix it', beta);
    await reports.updateTodoLine({ user: emp, id: other, title: 'Fix the redirects' });
    expect(await rowOf(other)).toMatchObject({ carriedFromTaskId: null, status: 'in_progress' });

    await preferences.update({ user: emp, values: { carryOver: false } });
    const { lineId } = await add('Fix it');
    await reports.updateTodoLine({ user: emp, id: lineId, title: 'Fix the redirects' });
    expect(await rowOf(lineId)).toMatchObject({
      carriedFromTaskId: null,
      firstReportedOn: TODAY,
      status: 'in_progress',
    });
  });
});
