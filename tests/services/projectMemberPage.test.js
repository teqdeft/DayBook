// Who opens the project page and with what (CONTRACT 27 and 28, The project page: access, frame and
// tabs), against the real modules: loadProjectHead gives the project's PM and Admins the PM view with
// every right, the uploaders' limits and the people list (the viewer first as "Me"), and every
// viewer their id and name; another PM the read-only PM view, with a
// member's file rights only when they are on the project; a person on the project (an employee or
// HR) the member view, with no forecast, their own hours this company month and whether today's
// to-do still takes lines (the task window's "Add to to-do"); and null (the
// page's 404) to HR who isn't on the project, another PM's employee, a member taken off the project,
// a deactivated member and a project that doesn't exist.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, createProject, createReport } from './dashboardKit.js';

const { loadProjectHead } = await import('@/app/(app)/projects/[id]/projectHead.js');

const NOW = '2026-11-23T06:30:00Z'; // Monday 23 November 2026, noon in Kolkata

let admin;
let pm;
let otherPm;
let memberPm;
let vishal;
let simran;
let hrOn;
let hrOff;
let outsider;
let takenOff;
let gone;
let project;
let otherProject;

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(NOW);
  await setSettings({ timezone: 'Asia/Kolkata' });
  admin = await createUser({ name: 'The CEO', role: 'admin', tracksAttendance: false });
  pm = await createUser({ name: 'Riya Kapoor', role: 'pm', tracksAttendance: false });
  otherPm = await createUser({ name: 'Vikram Sethi', role: 'pm', tracksAttendance: false });
  memberPm = await createUser({ name: 'Arjun Mehta', role: 'pm', tracksAttendance: false });
  vishal = await createUser({ name: 'Vishal Saini' });
  simran = await createUser({ name: 'Simran Kaur' });
  hrOn = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  hrOff = await createUser({ name: 'Hana HR', role: 'hr' });
  outsider = await createUser({ name: 'Rohit Verma' });
  takenOff = await createUser({ name: 'Kiran Rao' });
  gone = await createUser({ name: 'Old Hand' });
  project = await createProject(pm, { name: 'acme-store', isUrgent: true });
  otherProject = await createProject(otherPm, { name: 'vega' });
  await addMembers(project, [vishal, simran, hrOn, memberPm, takenOff, gone]);
  await addMembers(otherProject, [outsider, vishal]);
  // Taken off the project; deactivated people keep their row and get nothing.
  await db('projectMembers').where({ projectId: project.id, userId: takenOff.id }).del();
  await db('users').where({ id: gone.id }).update({ status: 'deactivated' });
  gone = await db('users').where({ id: gone.id }).first();

  // Vishal's hours: this month on acme-store 90 + 60 minutes; not last month's, not another
  // project's, not a draft.
  const entry = (minutes, on = project) => ({ projectId: on.id, minutes });
  await createReport(vishal, '2026-10-30', { entries: [entry(120)] });
  await createReport(vishal, '2026-11-10', { entries: [entry(90)] });
  await createReport(vishal, '2026-11-20', { entries: [entry(60), entry(30, otherProject)] });
  await createReport(vishal, '2026-11-21', { status: 'draft', entries: [entry(45)] });
});

describe('the PM view', () => {
  it('gives the project’s PM every right, the limits and the people list', async () => {
    const head = await loadProjectHead(project.id, pm);
    expect(head.access).toBe('manage');
    expect(head.canManage).toBe(true);
    expect(head.filesAccess).toBe('manage');
    expect(head.forecast).toMatchObject({ kind: expect.any(String), pill: expect.any(String) });
    expect(head.limits).toEqual({ maxFileBytes: 524288000, maxTaskFiles: 20, pickMax: 50 });
    expect(typeof head.storageReady).toBe('boolean'); // the task form's storage line
    expect(head.options.map((person) => person.name)).toEqual(
      expect.arrayContaining(['Riya Kapoor', 'Vishal Saini', 'Simran Kaur']),
    );
    expect(head.project).toMatchObject({
      id: project.id,
      name: 'acme-store',
      statusLabel: 'Active',
    });
    expect(head.today).toBe('2026-11-23');
    expect(head).not.toHaveProperty('hoursThisMonth');
    // the viewer's id and name (the board's Mine, "Me" and "(you)"), and the PM first as "Me"
    expect(head).toMatchObject({ viewerId: pm.id, viewerName: pm.name });
    expect(head.options[0]).toMatchObject({ id: pm.id, kind: 'me', status: 'active' });
  });

  it('gives an Admin the same', async () => {
    const head = await loadProjectHead(project.id, admin);
    expect(head).toMatchObject({ viewerId: admin.id, viewerName: admin.name });
    expect(head.options[0]).toMatchObject({ id: admin.id, kind: 'me' });
    expect(head.access).toBe('manage');
    expect(head.filesAccess).toBe('manage');
    expect(head.limits.maxTaskFiles).toBe(20);
  });

  it('gives another PM the read-only view and no file rights', async () => {
    const head = await loadProjectHead(project.id, otherPm);
    expect(head.access).toBe('team');
    expect(head.canManage).toBe(false);
    expect(head.filesAccess).toBe('none');
    expect(head.forecast).toBeTruthy();
    expect(head).not.toHaveProperty('limits');
    expect(head).not.toHaveProperty('options');
    expect(head.viewerId).toBe(otherPm.id);
  });

  it('gives a PM who is a member the read-only view with a member’s file rights', async () => {
    const head = await loadProjectHead(project.id, memberPm);
    expect(head.access).toBe('team');
    expect(head.filesAccess).toBe('member');
    expect(head.forecast).toBeTruthy();
  });

  it('answers null for a project that doesn’t exist', async () => {
    expect(await loadProjectHead(999999, pm)).toBeNull();
  });
});

describe('the member view', () => {
  it('gives an employee on the project the member view with no forecast', async () => {
    const head = await loadProjectHead(project.id, vishal);
    expect(head.access).toBe('member');
    expect(head.canManage).toBe(false);
    expect(head.filesAccess).toBe('member');
    expect(head).not.toHaveProperty('forecast');
    expect(head).not.toHaveProperty('limits');
    expect(head).not.toHaveProperty('options');
    expect(head).not.toHaveProperty('storageReady');
    expect(head.plan.phases).toHaveLength(6);
  });

  it('adds their own submitted minutes on this project this company month', async () => {
    expect((await loadProjectHead(project.id, vishal)).hoursThisMonth).toBe(150);
    expect((await loadProjectHead(otherProject.id, vishal)).hoursThisMonth).toBe(30);
  });

  it('reads 0 for a member who logged nothing here this month', async () => {
    expect((await loadProjectHead(project.id, simran)).hoursThisMonth).toBe(0);
  });

  it('gives HR on the project the member view', async () => {
    const head = await loadProjectHead(project.id, hrOn);
    expect(head.access).toBe('member');
    expect(head.filesAccess).toBe('member');
    expect(head).not.toHaveProperty('forecast');
    expect(head.hoursThisMonth).toBe(0);
  });

  it('offers "Add to to-do" until today’s report is in, as Today does', async () => {
    // No report yet today, and a draft: the to-do takes lines.
    expect((await loadProjectHead(project.id, vishal)).todoOpen).toBe(true);
    await createReport(hrOn, '2026-11-23', { status: 'draft' });
    expect((await loadProjectHead(project.id, hrOn)).todoOpen).toBe(true);
    // Submitted: POST /api/me/todo/lines would answer REPORT_LOCKED, so no button.
    await createReport(simran, '2026-11-23', { status: 'submitted' });
    expect((await loadProjectHead(project.id, simran)).todoOpen).toBe(false);
    // The PM view never carries it.
    expect(await loadProjectHead(project.id, memberPm)).not.toHaveProperty('todoOpen');
    expect(await loadProjectHead(project.id, pm)).not.toHaveProperty('todoOpen');
  });
});

describe('nobody else', () => {
  it.each([
    ['HR who isn’t on the project', () => hrOff],
    ['another PM’s employee who isn’t on the project', () => outsider],
    ['a member taken off the project', () => takenOff],
    ['a deactivated member', () => gone],
  ])('answers null for %s', async (_, who) => {
    expect(await loadProjectHead(project.id, who())).toBeNull();
  });

  it('answers null for an employee asking for a project that doesn’t exist', async () => {
    expect(await loadProjectHead(999999, vishal)).toBeNull();
  });
});
