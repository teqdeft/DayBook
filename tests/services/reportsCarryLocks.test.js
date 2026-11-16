// Locks of the writes that insert report lines (CONTRACT 24, "Write flow"): two people saving a
// carried line at the same moment never deadlock (the writes run at READ COMMITTED, writeTx.js),
// six people adding a suggestion to Today at once all get it, a burst of to-do adds on a project
// request doesn't wait on its own pool connections, and lineTransaction itself (it reads the
// latest commit; a server that can't log READ COMMITTED falls back to the default level).
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { reports } from '@/modules/reports';
import { saveReportSchema } from '@/modules/reports/schemas';
import { lineTransaction, setReadCommittedForTests } from '@/modules/reports/writeTx';
import { createUser } from '../helpers/db.js';
import { addMembers, createProjectRequest } from './dashboardKit.js';
import { insertReport } from './reportsTestKit.js';
import { setClock, TODAY, YESTERDAY } from './timersKit.js';
import { clearTodoTables, createTodoWorld, todayRows } from './todoKit.js';

let world;
let people;

beforeAll(async () => {
  world = await createTodoWorld();
  people = [world.emp, world.colleague];
  for (let i = 0; i < 4; i += 1) {
    people.push({ ...(await createUser({ name: `Extra ${i}` })), initials: 'EX' });
  }
  await addMembers(world.acme, people.slice(2));
  await addMembers(world.beta, people.slice(2));
});

beforeEach(async () => {
  setClock('09:30');
  await clearTodoTables();
});

afterEach(() => {
  setReadCommittedForTests(true);
});

const outcome = (result) =>
  result.status === 'fulfilled' ? 'ok' : `${result.reason?.code}/${result.reason?.errno}`;

/** Older lines carried from older lines, so the carried_from_task_id index isn't empty. */
async function addHistory(user) {
  const tasks = [
    { title: 'Old a', status: 'in_progress' },
    { title: 'Old b', status: 'in_progress' },
  ];
  const old = await insertReport(user, '2026-09-25', {
    entries: [{ project: world.acme, minutes: 60, tasks }],
  });
  await insertReport(user, '2026-09-26', {
    entries: [
      {
        project: world.acme,
        minutes: 60,
        tasks: tasks.map((task, i) => ({ ...task, carriedFromTaskId: old.taskIds[i] })),
      },
    ],
  });
}

/** Yesterday's open line on acme and today's draft (one line on beta); returns the open line. */
async function openTaskAndDraft(user, title) {
  const { taskIds } = await insertReport(user, YESTERDAY, {
    entries: [{ project: world.acme, minutes: 60, tasks: [{ title, status: 'blocked' }] }],
  });
  await reports.addTodoLine({ user, projectId: world.beta.id, title: `${title} other` });
  return taskIds[0];
}

/** The report page's save adding acme with a line carried from `source` and a plain one. */
async function saveCarried(user, source, title) {
  const view = await reports.openForDate({ user, workDate: TODAY });
  const entries = view.entries.map((entry) => ({
    id: entry.id,
    projectId: entry.projectId,
    minutes: 0,
    tasks: entry.tasks.map((task) => ({ id: task.id, title: task.title, status: task.status })),
  }));
  entries.push({
    projectId: world.acme.id,
    minutes: 0,
    tasks: [
      { title, status: 'blocked', carriedFromTaskId: source },
      { title: `${title} plain`, status: 'in_progress' },
    ],
  });
  return reports.saveReport({
    user,
    reportId: view.id,
    entries: saveReportSchema.parse({ entries }).entries,
    baseVersion: view.version,
  });
}

describe('carrying at the same moment', () => {
  it('saves both reports when two people save a carried line at once', async () => {
    const outcomes = [];
    for (let round = 0; round < 8; round += 1) {
      await clearTodoTables();
      if (round % 2 === 1) for (const user of people.slice(0, 2)) await addHistory(user);
      const a = await openTaskAndDraft(world.emp, `A${round}`);
      const b = await openTaskAndDraft(world.colleague, `B${round}`);
      const results = await Promise.allSettled([
        saveCarried(world.emp, a, `A${round}`),
        saveCarried(world.colleague, b, `B${round}`),
      ]);
      const carried = await db('reportTasks').whereIn('carriedFromTaskId', [a, b]);
      outcomes.push(`${results.map(outcome).join(',')}:${carried.length}`);
    }
    expect(outcomes).toEqual(Array(8).fill('ok,ok:2'));
  });

  it('adds every line when six people add a suggestion to Today at once', async () => {
    const outcomes = [];
    for (let round = 0; round < 4; round += 1) {
      await clearTodoTables();
      await addHistory(people[0]);
      const sources = [];
      for (const [i, user] of people.entries()) {
        sources.push(await openTaskAndDraft(user, `T${i}`));
      }
      const results = await Promise.allSettled(
        people.map((user, i) =>
          reports.addTodoLine({
            user,
            projectId: world.acme.id,
            title: `T${i}`,
            carriedFromTaskId: sources[i],
          }),
        ),
      );
      const carried = await db('reportTasks').whereIn('carriedFromTaskId', sources);
      outcomes.push(`${results.filter((r) => r.status === 'rejected').length}:${carried.length}`);
    }
    expect(outcomes).toEqual(Array(4).fill('0:6'));
  });
});

describe('a burst of to-do adds on a project request', () => {
  it('adds every line without waiting for the lock timeout', { timeout: 45_000 }, async () => {
    const request = await createProjectRequest(world.emp, { name: 'Blue Harbour' });
    await reports.addTodoLine({ user: world.emp, projectRequestId: request.id, title: 'First' });
    // One more than the pool: each add holds the report row while it checks the request.
    const count = (db.client.pool?.max ?? 10) + 1;
    const started = Date.now();
    const results = await Promise.allSettled(
      Array.from({ length: count }, (_, i) =>
        reports.addTodoLine({
          user: world.emp,
          projectRequestId: request.id,
          title: `Line ${i}`,
        }),
      ),
    );
    expect(results.map(outcome)).toEqual(Array(count).fill('ok'));
    expect(Date.now() - started).toBeLessThan(20_000);
    const { reports: rows, entries, tasks } = await todayRows(world.emp);
    expect([rows.length, entries.length, tasks.length]).toEqual([1, 1, count + 1]);
  });

  it('still refuses a request that was handled meanwhile', async () => {
    const request = await createProjectRequest(world.emp, { name: 'Blue Harbour' });
    await reports.addTodoLine({ user: world.emp, projectRequestId: request.id, title: 'First' });
    await db('projectRequests').where({ id: request.id }).update({ status: 'declined' });
    const view = await reports.openForDate({ user: world.emp, workDate: TODAY });
    const entries = view.entries.map((entry) => ({
      id: entry.id,
      projectRequestId: entry.projectRequestId,
      minutes: 30,
      tasks: entry.tasks.map((task) => ({ id: task.id, title: task.title, status: task.status })),
    }));
    const error = await reports
      .saveReport({
        user: world.emp,
        reportId: view.id,
        entries: saveReportSchema.parse({ entries }).entries,
        baseVersion: view.version,
      })
      .catch((caught) => caught);
    expect(error).toMatchObject({
      code: 'PROJECT_NOT_ACTIVE',
      message: 'That project request was already handled. Reload the page to see it.',
    });
  });
});

describe('lineTransaction', () => {
  const nameOf = (trx) => trx('users').where({ id: world.pm.id }).first('name');
  const rename = (name) => db('users').where({ id: world.pm.id }).update({ name });

  /** The name read in a transaction before and after another connection renames the PM. */
  async function readsAroundCommit() {
    const seen = [];
    await lineTransaction(async (trx) => {
      seen.push((await nameOf(trx)).name);
      await rename('Pat Renamed');
      seen.push((await nameOf(trx)).name);
    });
    await rename('Pat Manager');
    return seen;
  }

  it('reads what another connection committed meanwhile (READ COMMITTED)', async () => {
    expect(await readsAroundCommit()).toEqual(['Pat Manager', 'Pat Renamed']);
  });

  it('falls back to the default level once the binary log refuses READ COMMITTED', async () => {
    let calls = 0;
    const value = await lineTransaction(async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('binlog'), { errno: 1665 });
      return 'saved';
    });
    expect([value, calls]).toEqual(['saved', 2]);
    // Later writes run at the server's default (REPEATABLE READ): the first read's snapshot stays.
    expect(await readsAroundCommit()).toEqual(['Pat Manager', 'Pat Manager']);
  });
});
