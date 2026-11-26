// Time from timers per task (CONTRACT 28): timers.minutesByTask sums the finished time entries on
// each task (seconds summed, then rounded down to whole minutes), leaves a running one out, filters
// by `userId` when given, and never counts other tasks or entries without a task.
import { beforeAll, describe, expect, it } from 'vitest';
import { setNowForTests } from '@/lib/time';
import { timers } from '@/modules/timers';
import { createUser, resetDatabase } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';
import { addTask, insertEntry } from './timersKit.js';

let pm;
let vishal;
let simran;
let project;
let fix; // two people's entries
let pay; // one entry and a running one
let other; // not asked for

beforeAll(async () => {
  await resetDatabase();
  setNowForTests('2026-09-30T12:00:00Z');
  pm = await createUser({ name: 'Riya Kapoor', role: 'pm', tracksAttendance: false });
  vishal = await createUser({ name: 'Vishal Saini' });
  simran = await createUser({ name: 'Simran Kaur' });
  project = await createProject(pm, { name: 'acme-store' });
  await addMembers(project, [vishal, simran]);
  fix = await addTask(project, pm, { title: 'Fix the login page' });
  pay = await addTask(project, pm, { title: 'Payment settings page' });
  other = await addTask(project, pm, { title: 'Order emails' });
  await insertEntry(vishal, project, { from: '09:30', to: '11:00', projectTaskId: fix }); // 90
  await insertEntry(vishal, project, { from: '11:00', to: '11:20', projectTaskId: fix }); // 20
  await insertEntry(simran, project, { from: '10:00', to: '10:45', projectTaskId: fix }); // 45
  await insertEntry(simran, project, { from: '09:00', to: '09:30', projectTaskId: pay }); // 30
  await insertEntry(simran, project, { from: '12:00', projectTaskId: pay }); // running
  await insertEntry(vishal, project, { from: '14:00', to: '15:00', projectTaskId: other }); // 60
  await insertEntry(vishal, project, { from: '16:00', to: '17:00' }); // no task
  // 59 seconds and 61 seconds: 2 minutes in all, rounded down after the sum
  await insertEntry(simran, project, {
    from: '13:00',
    projectTaskId: pay,
    startedAt: new Date('2026-09-30T08:00:00Z'),
    endedAt: new Date('2026-09-30T08:00:59Z'),
  });
  await insertEntry(simran, project, {
    from: '13:00',
    projectTaskId: pay,
    startedAt: new Date('2026-09-30T08:10:00Z'),
    endedAt: new Date('2026-09-30T08:11:01Z'),
  });
});

describe('minutesByTask', () => {
  it("sums everyone's finished entries per task and leaves a running one out", async () => {
    expect(await timers.minutesByTask({ taskIds: [fix, pay] })).toEqual({
      [fix]: 155,
      [pay]: 32,
    });
  });

  it("filters by one person's entries", async () => {
    expect(await timers.minutesByTask({ taskIds: [fix, pay], userId: vishal.id })).toEqual({
      [fix]: 110,
    });
    expect(await timers.minutesByTask({ taskIds: [fix, pay], userId: simran.id })).toEqual({
      [fix]: 45,
      [pay]: 32,
    });
    expect(await timers.minutesByTask({ taskIds: [fix], userId: pm.id })).toEqual({});
  });

  it('never counts other tasks, and answers {} for nothing to read', async () => {
    expect(await timers.minutesByTask({ taskIds: [pay, pay, 'x', -1] })).toEqual({ [pay]: 32 });
    expect(await timers.minutesByTask({ taskIds: [] })).toEqual({});
    expect(await timers.minutesByTask({ taskIds: undefined })).toEqual({});
  });
});
