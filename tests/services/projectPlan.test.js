// A project's plan (CONTRACT 22): moves both ways, jumps, moving to the current phase, moves at the
// same time, phase dates, the deadline, who may change them, the audit rows, and the three routes.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { createUser, resetDatabase } from '../helpers/db.js';
import { createProject } from './dashboardKit.js';

const jar = new Map();
const store = {
  get: (name) => (jar.has(name) ? { name, value: jar.get(name).value } : undefined),
  set: (name, value, options) => jar.set(name, { value, options }),
  delete: ({ name }) => jar.delete(name),
};
let sessionUser = null;

vi.mock('next/headers', () => ({ cookies: async () => store, headers: async () => new Headers() }));
vi.mock('@/modules/auth', () => ({ auth: { resolveSession: async () => sessionUser } }));
// The reports module belongs to another owner; the projects module imports it for requests.
vi.mock('@/modules/reports', () => ({ reports: {} }));

const { encodeSessionCookie } = await import('@/lib/session');
const { env } = await import('@/lib/env');
const { projectPlan } = await import('@/modules/projectPlan');
const phaseRoute = await import('@/app/api/projects/[id]/phase/route.js');
const deadlineRoute = await import('@/app/api/projects/[id]/deadline/route.js');
const datesRoute = await import('@/app/api/projects/[id]/phases/[phase]/dates/route.js');

// Friday 30 October 2026, 11:30 AM in Kolkata.
const OCT_30 = '2026-10-30T06:00:00Z';
const NOV_2 = '2026-11-02T06:00:00Z';
const NOV_9 = '2026-11-09T06:00:00Z';
const EXPIRES = new Date('2026-11-26T04:00:00Z');

let admin;
let pm;
let otherPm;
let hr;
let employee;
let projectCount = 0;

const newProject = (overrides) => {
  projectCount += 1;
  return createProject(pm, { name: `plan-${projectCount}`, ...overrides });
};

const move = (project, phase, user = pm) =>
  projectPlan.movePhase({ user, projectId: project.id, phase, ip: '10.0.0.1' });

async function expectCode(promise, code) {
  await expect(promise).rejects.toMatchObject({ code });
}

/** { key: [actualStart, actualEnd] } for the phases that have an actual date. */
function actuals(plan) {
  return Object.fromEntries(
    plan.phases
      .filter((phase) => phase.actualStart || phase.actualEnd)
      .map((phase) => [phase.key, [phase.actualStart, phase.actualEnd]]),
  );
}

async function auditRows(action, entityId) {
  const rows = await db('auditLogs').where({ action, entityId }).orderBy('id');
  return rows.map((row) => ({
    ...row,
    before: parseJson(row.before),
    after: parseJson(row.after),
  }));
}

beforeAll(async () => {
  await resetDatabase();
  admin = await createUser({ name: 'Ada Admin', role: 'admin', tracksAttendance: false });
  pm = await createUser({ name: 'Riya Kapoor', role: 'pm', tracksAttendance: false });
  otherPm = await createUser({ name: 'Other PM', role: 'pm', tracksAttendance: false });
  hr = await createUser({ name: 'Hana HR', role: 'hr' });
  employee = await createUser({ name: 'Neha Dev' });
});

beforeEach(() => {
  setNowForTests(OCT_30);
});

describe('reading a plan', () => {
  it('is Not set with six empty phases when the project has no row', async () => {
    const project = await newProject();
    const plan = await projectPlan.getPlan(project.id);
    expect(plan).toMatchObject({ currentPhase: null, deadline: null });
    expect(plan.phases.map((phase) => [phase.key, phase.label])).toEqual([
      ['requirement_gathering', 'Requirement gathering'],
      ['design', 'Design'],
      ['development', 'Development'],
      ['testing', 'Testing'],
      ['launch', 'Launch'],
      ['support', 'Support'],
    ]);
    expect(plan.phases[0]).toEqual({
      key: 'requirement_gathering',
      label: 'Requirement gathering',
      plannedStart: null,
      plannedEnd: null,
      actualStart: null,
      actualEnd: null,
    });
  });

  it('answers Not set for an id that is no project or no id', async () => {
    expect((await projectPlan.getPlan(999999)).currentPhase).toBeNull();
    expect((await projectPlan.getPlan('x')).phases).toHaveLength(6);
  });

  it('lists every project asked for in one query, with nulls when it has no plan', async () => {
    const planned = await newProject();
    const bare = await newProject();
    await move(planned, 'design');
    await projectPlan.setDeadline({ user: pm, projectId: planned.id, deadline: '2026-12-15' });

    const queries = [];
    const count = (query) => queries.push(query.sql);
    db.on('query', count);
    const plans = await projectPlan.listPlans([planned.id, bare.id, planned.id, 'x']);
    db.removeListener('query', count);

    expect(plans).toEqual({
      [planned.id]: { currentPhase: 'design', deadline: '2026-12-15' },
      [bare.id]: { currentPhase: null, deadline: null },
    });
    expect(queries).toHaveLength(1);
    expect(await projectPlan.listPlans([])).toEqual({});
  });
});

describe('moving forward', () => {
  it('from Not set starts the phase today, in company time', async () => {
    const project = await newProject();
    // 7:00 PM UTC on the 30th is already the 31st in Kolkata.
    setNowForTests('2026-10-30T19:00:00Z');
    const plan = await move(project, 'requirement_gathering');
    expect(plan.currentPhase).toBe('requirement_gathering');
    expect(actuals(plan)).toEqual({ requirement_gathering: ['2026-10-31', null] });
  });

  it('ends the old phase and starts the new one', async () => {
    const project = await newProject();
    await move(project, 'requirement_gathering');
    setNowForTests(NOV_2);
    const plan = await move(project, 'design');
    expect(plan.currentPhase).toBe('design');
    expect(actuals(plan)).toEqual({
      requirement_gathering: ['2026-10-30', '2026-11-02'],
      design: ['2026-11-02', null],
    });
  });

  it('leaves the phases it jumps over empty', async () => {
    const project = await newProject();
    await move(project, 'requirement_gathering');
    setNowForTests(NOV_2);
    const plan = await move(project, 'testing');
    expect(plan.currentPhase).toBe('testing');
    expect(actuals(plan)).toEqual({
      requirement_gathering: ['2026-10-30', '2026-11-02'],
      testing: ['2026-11-02', null],
    });
  });

  it('can jump from Not set straight to a later phase', async () => {
    const project = await newProject();
    const plan = await move(project, 'launch');
    expect(actuals(plan)).toEqual({ launch: ['2026-10-30', null] });
  });

  it('keeps the planned dates of the phases it touches', async () => {
    const project = await newProject();
    await projectPlan.setPhaseDates({
      user: pm,
      projectId: project.id,
      phase: 'design',
      plannedStart: '2026-11-01',
      plannedEnd: '2026-11-20',
    });
    const plan = await move(project, 'design');
    expect(plan.phases[1]).toMatchObject({
      plannedStart: '2026-11-01',
      plannedEnd: '2026-11-20',
      actualStart: '2026-10-30',
      actualEnd: null,
    });
  });
});

describe('moving back', () => {
  it('empties later phases and opens the target, keeping its start', async () => {
    const project = await newProject();
    await move(project, 'requirement_gathering');
    setNowForTests(NOV_2);
    await move(project, 'design');
    setNowForTests(NOV_9);
    await move(project, 'development');
    setNowForTests('2026-11-16T06:00:00Z');
    const plan = await move(project, 'design');
    expect(plan.currentPhase).toBe('design');
    expect(actuals(plan)).toEqual({
      requirement_gathering: ['2026-10-30', '2026-11-02'],
      design: ['2026-11-02', null],
    });
  });

  it('starts the target today when it was skipped', async () => {
    const project = await newProject();
    await move(project, 'requirement_gathering');
    setNowForTests(NOV_2);
    await move(project, 'testing');
    setNowForTests(NOV_9);
    const plan = await move(project, 'design');
    expect(plan.currentPhase).toBe('design');
    expect(actuals(plan)).toEqual({
      requirement_gathering: ['2026-10-30', '2026-11-02'],
      design: ['2026-11-09', null],
    });
  });

  it('keeps the planned dates of the later phases it empties', async () => {
    const project = await newProject();
    await projectPlan.setPhaseDates({
      user: pm,
      projectId: project.id,
      phase: 'testing',
      plannedStart: '2026-12-01',
      plannedEnd: '2026-12-10',
    });
    await move(project, 'testing');
    const plan = await move(project, 'design');
    expect(plan.phases[3]).toMatchObject({
      plannedStart: '2026-12-01',
      plannedEnd: '2026-12-10',
      actualStart: null,
      actualEnd: null,
    });
  });

  it('can go forward again after going back', async () => {
    const project = await newProject();
    await move(project, 'design');
    setNowForTests(NOV_2);
    await move(project, 'development');
    setNowForTests(NOV_9);
    await move(project, 'design');
    const plan = await move(project, 'development');
    expect(actuals(plan)).toEqual({
      design: ['2026-10-30', '2026-11-09'],
      development: ['2026-11-09', null],
    });
  });
});

describe('a move from a page that is out of date', () => {
  it('is refused once the project moved since, and changes nothing', async () => {
    const project = await newProject();
    await move(project, 'design');
    // The PM's page shows Design; then the Admin moves the project on to Testing.
    setNowForTests(NOV_9);
    await move(project, 'testing', admin);
    const stale = projectPlan.movePhase({
      user: pm,
      projectId: project.id,
      phase: 'development',
      from: 'design',
    });
    await expect(stale).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      message: 'The phase changed. Reload the page.',
    });
    const plan = await projectPlan.getPlan(project.id);
    expect(plan.currentPhase).toBe('testing');
    expect(actuals(plan)).toEqual({
      design: ['2026-10-30', '2026-11-09'],
      testing: ['2026-11-09', null],
    });
    expect(await auditRows('project.phase', project.id)).toHaveLength(2);
  });

  it('goes ahead when the page shows the current phase, Not set included', async () => {
    const project = await newProject();
    const started = await projectPlan.movePhase({
      user: pm,
      projectId: project.id,
      phase: 'requirement_gathering',
      from: null,
    });
    expect(started.currentPhase).toBe('requirement_gathering');
    const back = { user: pm, projectId: project.id, phase: 'design', from: null };
    await expectCode(projectPlan.movePhase(back), 'CONFLICT');
    const moved = await projectPlan.movePhase({ ...back, from: 'requirement_gathering' });
    expect(moved.currentPhase).toBe('design');
  });

  it('changes nothing, without an error, when the project is already in the phase asked for', async () => {
    const project = await newProject();
    await move(project, 'design');
    await move(project, 'development', admin);
    const plan = await projectPlan.movePhase({
      user: pm,
      projectId: project.id,
      phase: 'development',
      from: 'design',
    });
    expect(plan.currentPhase).toBe('development');
    expect(await auditRows('project.phase', project.id)).toHaveLength(2);
  });
});

describe('moving to the current phase', () => {
  it('changes nothing and writes no audit row', async () => {
    const project = await newProject();
    await move(project, 'design');
    setNowForTests(NOV_2);
    const plan = await move(project, 'design');
    expect(plan.currentPhase).toBe('design');
    expect(actuals(plan)).toEqual({ design: ['2026-10-30', null] });
    expect(await auditRows('project.phase', project.id)).toHaveLength(1);
  });
});

describe('a phase is separate from the status', () => {
  it('moves on hold and completed projects and leaves their status alone', async () => {
    const held = await newProject({ status: 'on_hold' });
    const finished = await newProject({ status: 'completed' });
    await move(held, 'design');
    await move(finished, 'support');
    expect((await db('projects').where({ id: held.id }).first()).status).toBe('on_hold');
    expect((await db('projects').where({ id: finished.id }).first()).status).toBe('completed');
  });
});

describe('two moves at the same time', () => {
  /** Each audit row must start where the one before it ended: no move read a stale phase. */
  async function expectOneAfterTheOther(project, count) {
    const rows = await auditRows('project.phase', project.id);
    expect(rows).toHaveLength(count);
    rows.reduce((previous, row) => {
      expect(row.before.phase).toBe(previous);
      return row.after.phase;
    }, null);
    return rows;
  }

  /** The dates must fit the current phase: open, with nothing after it. */
  function expectConsistent(plan) {
    const current = plan.phases.findIndex((phase) => phase.key === plan.currentPhase);
    expect(plan.phases[current].actualStart).not.toBeNull();
    expect(plan.phases[current].actualEnd).toBeNull();
    for (const phase of plan.phases.slice(current + 1)) {
      expect([phase.actualStart, phase.actualEnd]).toEqual([null, null]);
    }
  }

  it('run one after the other on a project without a plan row', async () => {
    const project = await newProject();
    const results = await Promise.allSettled([move(project, 'design'), move(project, 'testing')]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const rows = await expectOneAfterTheOther(project, 2);
    const plan = await projectPlan.getPlan(project.id);
    expect(plan.currentPhase).toBe(rows.at(-1).after.phase);
    expectConsistent(plan);
  });

  it('run one after the other with several at once, in both directions', async () => {
    const project = await newProject();
    await move(project, 'development');
    const results = await Promise.allSettled(
      ['design', 'launch', 'requirement_gathering', 'support', 'testing'].map((phase) =>
        move(project, phase),
      ),
    );
    expect(results.filter((result) => result.status === 'rejected')).toEqual([]);
    const rows = await expectOneAfterTheOther(project, 6);
    const plan = await projectPlan.getPlan(project.id);
    expect(plan.currentPhase).toBe(rows.at(-1).after.phase);
    expectConsistent(plan);
  });

  it('keep a deadline and dates set at the same moment', async () => {
    const project = await newProject();
    await Promise.all([
      move(project, 'design'),
      projectPlan.setDeadline({ user: pm, projectId: project.id, deadline: '2026-12-15' }),
      projectPlan.setPhaseDates({
        user: pm,
        projectId: project.id,
        phase: 'design',
        plannedStart: '2026-11-01',
        plannedEnd: '2026-11-20',
      }),
    ]);
    const plan = await projectPlan.getPlan(project.id);
    expect(plan).toMatchObject({ currentPhase: 'design', deadline: '2026-12-15' });
    expect(plan.phases[1]).toMatchObject({
      plannedStart: '2026-11-01',
      plannedEnd: '2026-11-20',
      actualStart: '2026-10-30',
    });
  });
});

describe('the deadline', () => {
  it('sets, changes and clears it', async () => {
    const project = await newProject();
    const set = (deadline) =>
      projectPlan.setDeadline({ user: pm, projectId: project.id, deadline });
    expect((await set('2026-12-15')).deadline).toBe('2026-12-15');
    expect((await set('2027-01-10')).deadline).toBe('2027-01-10');
    expect((await set(null)).deadline).toBeNull();
    expect((await projectPlan.getPlan(project.id)).deadline).toBeNull();
  });

  it('can be in the past: projects run late', async () => {
    const project = await newProject();
    const plan = await projectPlan.setDeadline({
      user: pm,
      projectId: project.id,
      deadline: '2026-10-01',
    });
    expect(plan.deadline).toBe('2026-10-01');
  });

  it('leaves the phase alone, and a move leaves it alone', async () => {
    const project = await newProject();
    await move(project, 'design');
    await projectPlan.setDeadline({ user: pm, projectId: project.id, deadline: '2026-12-15' });
    const plan = await move(project, 'testing');
    expect(plan).toMatchObject({ currentPhase: 'testing', deadline: '2026-12-15' });
  });

  it('refuses a date that is not real, naming the field', async () => {
    const project = await newProject();
    const error = await projectPlan
      .setDeadline({ user: pm, projectId: project.id, deadline: '2026-02-30' })
      .catch((caught) => caught);
    expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(Object.keys(error.fields)).toEqual(['deadline']);
  });
});

describe('phase dates', () => {
  const setDates = (project, phase, plannedStart, plannedEnd, user = pm) =>
    projectPlan.setPhaseDates({ user, projectId: project.id, phase, plannedStart, plannedEnd });

  it('sets, changes and empties them, and leaves the actual dates alone', async () => {
    const project = await newProject();
    await move(project, 'design');
    let plan = await setDates(project, 'design', '2026-10-20', '2026-11-20');
    expect(plan.phases[1]).toMatchObject({
      plannedStart: '2026-10-20',
      plannedEnd: '2026-11-20',
      actualStart: '2026-10-30',
      actualEnd: null,
    });
    plan = await setDates(project, 'design', null, '2026-11-25');
    expect(plan.phases[1]).toMatchObject({ plannedStart: null, plannedEnd: '2026-11-25' });
    plan = await setDates(project, 'design', null, null);
    expect(plan.phases[1]).toMatchObject({
      plannedStart: null,
      plannedEnd: null,
      actualStart: '2026-10-30',
    });
  });

  it("works on a phase that isn't current and doesn't change the current one", async () => {
    const project = await newProject();
    const plan = await setDates(project, 'launch', '2027-01-01', '2027-01-15');
    expect(plan.currentPhase).toBeNull();
    expect(plan.phases[4]).toMatchObject({ plannedStart: '2027-01-01', plannedEnd: '2027-01-15' });
  });

  it('takes an end on the same day as the start', async () => {
    const project = await newProject();
    const plan = await setDates(project, 'design', '2026-11-01', '2026-11-01');
    expect(plan.phases[1].plannedEnd).toBe('2026-11-01');
  });

  it('refuses an end before the start with the agreed words', async () => {
    const project = await newProject();
    const error = await setDates(project, 'design', '2026-11-02', '2026-11-01').catch(
      (caught) => caught,
    );
    expect(error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: "The end date can't be before the start date.",
      fields: { plannedEnd: "The end date can't be before the start date." },
    });
    expect((await projectPlan.getPlan(project.id)).phases[1].plannedStart).toBeNull();
  });

  it('refuses a phase that is not on the list', async () => {
    const project = await newProject();
    await expectCode(setDates(project, 'nonsense', null, null), 'VALIDATION_FAILED');
  });
});

describe('who may change a plan', () => {
  it('lets the PM and Admin', async () => {
    const project = await newProject();
    expect((await move(project, 'design', pm)).currentPhase).toBe('design');
    expect((await move(project, 'testing', admin)).currentPhase).toBe('testing');
  });

  it.each([
    ['the PM of another project', () => otherPm],
    ['HR', () => hr],
    ['an employee', () => employee],
  ])('answers FORBIDDEN to %s, and changes nothing', async (_name, who) => {
    const project = await newProject();
    const user = who();
    await expectCode(move(project, 'design', user), 'FORBIDDEN');
    await expectCode(
      projectPlan.setDeadline({ user, projectId: project.id, deadline: '2026-12-15' }),
      'FORBIDDEN',
    );
    await expectCode(
      projectPlan.setPhaseDates({
        user,
        projectId: project.id,
        phase: 'design',
        plannedStart: null,
        plannedEnd: null,
      }),
      'FORBIDDEN',
    );
    expect(await db('projectPlans').where({ projectId: project.id })).toEqual([]);
    expect(await db('auditLogs').where({ entityType: 'project', entityId: project.id })).toEqual(
      [],
    );
  });

  it('answers FORBIDDEN before looking at the values', async () => {
    const project = await newProject();
    await expectCode(move(project, 'nonsense', otherPm), 'FORBIDDEN');
  });

  it('answers NOT_FOUND for a project that does not exist', async () => {
    await expectCode(move({ id: 999999 }, 'design'), 'NOT_FOUND');
    await expectCode(move({ id: 'x' }, 'design'), 'NOT_FOUND');
  });

  it('refuses a phase that is not on the list, and null: a project never goes back to Not set', async () => {
    const project = await newProject();
    await expectCode(move(project, 'nonsense'), 'VALIDATION_FAILED');
    await expectCode(move(project, null), 'VALIDATION_FAILED');
  });
});

describe('the audit rows', () => {
  const SECRET_FREE_KEYS = ['before', 'after'];

  it('keep ids and values only: a move', async () => {
    const project = await newProject();
    await move(project, 'design');
    await move(project, 'testing');
    const rows = await auditRows('project.phase', project.id);
    expect(rows.map((row) => [row.before, row.after])).toEqual([
      [{ phase: null }, { phase: 'design' }],
      [{ phase: 'design' }, { phase: 'testing' }],
    ]);
    expect(rows[0]).toMatchObject({ actorId: pm.id, entityType: 'project', ip: '10.0.0.1' });
  });

  it('keep ids and values only: a deadline', async () => {
    const project = await newProject();
    const set = (deadline) =>
      projectPlan.setDeadline({ user: pm, projectId: project.id, deadline });
    await set('2026-12-15');
    await set('2026-12-15'); // the same again: no row
    await set(null);
    const rows = await auditRows('project.deadline', project.id);
    expect(rows.map((row) => [row.before, row.after])).toEqual([
      [{ deadline: null }, { deadline: '2026-12-15' }],
      [{ deadline: '2026-12-15' }, { deadline: null }],
    ]);
  });

  it('keep ids and values only: phase dates', async () => {
    const project = await newProject();
    const dates = { plannedStart: '2026-11-01', plannedEnd: '2026-11-20' };
    await projectPlan.setPhaseDates({ user: pm, projectId: project.id, phase: 'design', ...dates });
    await projectPlan.setPhaseDates({ user: pm, projectId: project.id, phase: 'design', ...dates });
    const rows = await auditRows('project.phase_dates', project.id);
    expect(rows.map((row) => [row.before, row.after])).toEqual([
      [
        { phase: 'design', plannedStart: null, plannedEnd: null },
        { phase: 'design', ...dates },
      ],
    ]);
  });

  it('hold no project text', async () => {
    const project = await newProject({ name: 'secret-client-name' });
    await move(project, 'design');
    const rows = await db('auditLogs').where({ entityType: 'project', entityId: project.id });
    for (const row of rows) {
      for (const key of SECRET_FREE_KEYS) expect(String(row[key])).not.toContain('secret-client');
      expect(row.reason ?? null).toBeNull();
    }
  });

  it('stores who changed the plan', async () => {
    const project = await newProject();
    await move(project, 'design', admin);
    const row = await db('projectPlans').where({ projectId: project.id }).first();
    expect(row.updatedBy).toBe(admin.id);
    const phase = await db('projectPhasePlans')
      .where({ projectId: project.id, phase: 'design' })
      .first();
    expect(phase.updatedBy).toBe(admin.id);
  });
});

describe('deleting a project', () => {
  it('takes its plan with it', async () => {
    const project = await newProject();
    await move(project, 'design');
    await db('projects').where({ id: project.id }).del();
    expect(await db('projectPlans').where({ projectId: project.id })).toEqual([]);
    expect(await db('projectPhasePlans').where({ projectId: project.id })).toEqual([]);
  });
});

describe('the routes', () => {
  function signInAs(user) {
    sessionUser = user && { ...user, status: user.status ?? 'active', sessionExpiresAt: EXPIRES };
    jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
  }

  async function put(handler, { path, params, body }) {
    const request = new Request(`${env.appOrigin}${path}`, {
      method: 'PUT',
      headers: { origin: env.appOrigin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const response = await handler(request, { params: Promise.resolve(params) });
    return { status: response.status, json: await response.json() };
  }

  const putPhase = (id, body) =>
    put(phaseRoute.PUT, { path: `/api/projects/${id}/phase`, params: { id: String(id) }, body });
  const putDeadline = (id, body) =>
    put(deadlineRoute.PUT, {
      path: `/api/projects/${id}/deadline`,
      params: { id: String(id) },
      body,
    });
  const putDates = (id, phase, body) =>
    put(datesRoute.PUT, {
      path: `/api/projects/${id}/phases/${phase}/dates`,
      params: { id: String(id), phase },
      body,
    });

  it('PUT phase returns the plan', async () => {
    const project = await newProject();
    signInAs(pm);
    const { status, json } = await putPhase(project.id, { phase: 'design' });
    expect(status).toBe(200);
    expect(json.data.currentPhase).toBe('design');
    expect(json.data.phases).toHaveLength(6);
    const rows = await auditRows('project.phase', project.id);
    expect(rows[0].after).toEqual({ phase: 'design' });
  });

  it('PUT phase answers 409 when the phase the page showed is no longer current', async () => {
    const project = await newProject();
    signInAs(pm);
    await putPhase(project.id, { phase: 'design', from: null });
    const stale = await putPhase(project.id, { phase: 'testing', from: null });
    expect(stale.status).toBe(409);
    expect(stale.json.error.message).toBe('The phase changed. Reload the page.');
    const fresh = await putPhase(project.id, { phase: 'testing', from: 'design' });
    expect(fresh.status).toBe(200);
    expect(fresh.json.data.currentPhase).toBe('testing');
  });

  it('PUT deadline sets it and null clears it', async () => {
    const project = await newProject();
    signInAs(pm);
    const set = await putDeadline(project.id, { deadline: '2026-12-15' });
    expect(set.json.data.deadline).toBe('2026-12-15');
    const cleared = await putDeadline(project.id, { deadline: null });
    expect(cleared.status).toBe(200);
    expect(cleared.json.data.deadline).toBeNull();
  });

  it('PUT dates sets both, nullable', async () => {
    const project = await newProject();
    signInAs(pm);
    const { status, json } = await putDates(project.id, 'design', {
      plannedStart: '2026-11-01',
      plannedEnd: null,
    });
    expect(status).toBe(200);
    expect(json.data.phases[1]).toMatchObject({ plannedStart: '2026-11-01', plannedEnd: null });
  });

  it('answers 400 with the field for bad values', async () => {
    const project = await newProject();
    signInAs(pm);
    const phase = await putPhase(project.id, { phase: 'nonsense' });
    expect(phase.status).toBe(400);
    expect(phase.json.error.fields).toHaveProperty('phase');
    const missing = await putDeadline(project.id, {});
    expect(missing.status).toBe(400);
    expect(missing.json.error.fields).toHaveProperty('deadline');
    const backwards = await putDates(project.id, 'design', {
      plannedStart: '2026-11-02',
      plannedEnd: '2026-11-01',
    });
    expect(backwards.status).toBe(400);
    expect(backwards.json.error.message).toBe("The end date can't be before the start date.");
  });

  it('answers 403 to an employee and to the PM of another project', async () => {
    const project = await newProject();
    signInAs(employee);
    expect((await putPhase(project.id, { phase: 'design' })).status).toBe(403);
    signInAs(otherPm);
    expect((await putPhase(project.id, { phase: 'design' })).status).toBe(403);
    expect((await putDeadline(project.id, { deadline: null })).status).toBe(403);
    expect(
      (await putDates(project.id, 'design', { plannedStart: null, plannedEnd: null })).status,
    ).toBe(403);
  });

  it('answers 404 for a bad id, an unknown project and a phase not on the list', async () => {
    const project = await newProject();
    signInAs(pm);
    expect((await putPhase('abc', { phase: 'design' })).status).toBe(404);
    expect((await putPhase(999999, { phase: 'design' })).status).toBe(404);
    const dates = { plannedStart: null, plannedEnd: null };
    expect((await putDates(project.id, 'nonsense', dates)).status).toBe(404);
  });
});
