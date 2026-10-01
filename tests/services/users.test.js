import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { auth } from '@/modules/auth';
import { users } from '@/modules/users';
import { setSlackClientForTests } from '@/modules/slack/client';
import { createUser, resetDatabase } from '../helpers/db.js';

let admin;
let hr;
let pm;
let employee;
let departments;

/** The session-like user object services receive. */
const actor = (row) => ({ id: row.id, role: row.role, status: row.status ?? 'active' });

async function expectAppError(promise, code) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error, `expected ${code}`).not.toBeNull();
  expect(error.code).toBe(code);
  return error;
}

function auditRows(action, entityId) {
  return db('audit_logs').where({ action, entityId }).orderBy('id');
}

function newPerson(overrides = {}) {
  return {
    name: 'Riya Kapoor',
    email: 'riya@example.com',
    designation: 'Frontend developer',
    departmentId: departments.Development,
    reportsToId: pm.id,
    joinedOn: '2026-10-01',
    ...overrides,
  };
}

beforeAll(async () => {
  await resetDatabase();
  setNowForTests('2026-09-30T04:00:00Z');
  departments = Object.fromEntries(
    (await db('departments').select('id', 'name')).map((row) => [row.name, row.id]),
  );
  admin = await createUser({ name: 'Admin One', email: 'admin@example.com', role: 'admin' });
  hr = await createUser({ name: 'Neha Gupta', email: 'neha@example.com', role: 'hr' });
  pm = await createUser({ name: 'Pat Manager', email: 'pm@example.com', role: 'pm' });
  employee = await createUser({ name: 'Vishal Saini', email: 'vishal@example.com' });
});

afterEach(() => {
  setSlackClientForTests(null);
});

describe('users.add', () => {
  it('adds a person with a lowercase, trimmed email as an employee and audits it', async () => {
    const person = await users.add({
      user: actor(hr),
      input: newPerson({ email: '  Riya.Kapoor@Example.COM ', name: '  Riya Kapoor ' }),
      ip: '10.0.0.5',
    });
    expect(person).toMatchObject({
      name: 'Riya Kapoor',
      email: 'riya.kapoor@example.com',
      role: 'employee',
      roleLabel: 'Employee',
      departmentName: 'Development',
      reportsToId: pm.id,
      reportsToName: 'Pat Manager',
      joinedOn: '2026-10-01',
      shiftStart: null,
      shiftEnd: null,
      tracksAttendance: true,
      status: 'active',
      initials: 'RK',
    });
    const [log] = await auditRows('user.create', person.id);
    expect(log.actorId).toBe(hr.id);
    expect(log.ip).toBe('10.0.0.5');
    expect(parseJson(log.after)).toMatchObject({
      email: 'riya.kapoor@example.com',
      role: 'employee',
    });
  });

  it('refuses an email that is already in Daybook, whatever its case', async () => {
    const error = await expectAppError(
      users.add({ user: actor(hr), input: newPerson({ email: 'RIYA.KAPOOR@example.com' }) }),
      'DUPLICATE_EMAIL',
    );
    expect(error.status).toBe(409);
    expect(error.fields.email).toMatch(/already in Daybook/);
  });

  it('does not let HR set a role, but Admin can', async () => {
    const error = await expectAppError(
      users.add({ user: actor(hr), input: newPerson({ email: 'x1@example.com', role: 'pm' }) }),
      'FORBIDDEN',
    );
    expect(error.fields.role).toBe('Only Admin can change roles.');
    expect(await db('users').where({ email: 'x1@example.com' }).first()).toBeUndefined();

    const person = await users.add({
      user: actor(admin),
      input: newPerson({ email: 'x2@example.com', role: 'pm' }),
    });
    expect(person.role).toBe('pm');
    expect(person.tracksAttendance).toBe(false);
  });

  it('never tracks PMs and starts tracking again when a PM becomes an employee', async () => {
    const person = await users.add({
      user: actor(admin),
      input: newPerson({ email: 'x3@example.com', role: 'pm', tracksAttendance: true }),
    });
    expect(person.tracksAttendance).toBe(false);
    await expectAppError(
      users.update({ user: actor(admin), id: person.id, input: { tracksAttendance: true } }),
      'VALIDATION_FAILED',
    );
    const back = await users.changeRole({ user: actor(admin), id: person.id, role: 'employee' });
    expect(back.tracksAttendance).toBe(true);
  });

  it('needs people.manage', async () => {
    await expectAppError(
      users.add({ user: actor(employee), input: newPerson({ email: 'x3@example.com' }) }),
      'FORBIDDEN',
    );
    await expectAppError(
      users.add({ user: actor(pm), input: newPerson({ email: 'x3@example.com' }) }),
      'FORBIDDEN',
    );
  });

  it('validates the fields with readable messages', async () => {
    const error = await expectAppError(
      users.add({
        user: actor(hr),
        input: { name: '', email: 'not-an-email', designation: '', departmentId: '' },
      }),
      'VALIDATION_FAILED',
    );
    expect(error.fields).toMatchObject({
      name: 'Enter their full name.',
      email: 'Enter a valid email, like name@company.com.',
      designation: 'Enter their designation.',
      departmentId: 'Pick a department.',
    });
    const long = await expectAppError(
      users.add({
        user: actor(hr),
        input: newPerson({ email: 'x4@example.com', name: 'a'.repeat(121) }),
      }),
      'VALIDATION_FAILED',
    );
    expect(long.fields.name).toMatch(/120 characters/);
    const date = await expectAppError(
      users.add({
        user: actor(hr),
        input: newPerson({ email: 'x4@example.com', joinedOn: '2026-02-30' }),
      }),
      'VALIDATION_FAILED',
    );
    expect(date.fields.joinedOn).toBeTruthy();
  });

  it('needs a real department', async () => {
    const error = await expectAppError(
      users.add({
        user: actor(hr),
        input: newPerson({ email: 'x5@example.com', departmentId: 9999 }),
      }),
      'VALIDATION_FAILED',
    );
    expect(error.fields.departmentId).toBe('Pick a department from the list.');
    expect(error.message).toBe('Pick a department from the list.');
  });

  it('only lets people report to an active PM or Admin', async () => {
    const toEmployee = await expectAppError(
      users.add({
        user: actor(hr),
        input: newPerson({ email: 'x6@example.com', reportsToId: employee.id }),
      }),
      'VALIDATION_FAILED',
    );
    expect(toEmployee.fields.reportsToId).toBe('Pick an active project manager or Admin.');
    expect(toEmployee.message).toBe('Pick an active project manager or Admin.');
    const gone = await createUser({ name: 'Old PM', role: 'pm', status: 'deactivated' });
    await expectAppError(
      users.add({
        user: actor(hr),
        input: newPerson({ email: 'x6@example.com', reportsToId: gone.id }),
      }),
      'VALIDATION_FAILED',
    );
    const toAdmin = await users.add({
      user: actor(hr),
      input: newPerson({ email: 'x6@example.com', reportsToId: admin.id }),
    });
    expect(toAdmin.reportsToName).toBe('Admin One');
    const toNobody = await users.add({
      user: actor(hr),
      input: newPerson({ email: 'x7@example.com', reportsToId: '' }),
    });
    expect(toNobody.reportsToId).toBeNull();
  });

  it('saves a custom shift only as a pair that ends after it starts', async () => {
    const person = await users.add({
      user: actor(hr),
      input: newPerson({ email: 'shift@example.com', shiftStart: '10:00', shiftEnd: '19:00' }),
    });
    expect(person).toMatchObject({ shiftStart: '10:00', shiftEnd: '19:00' });
    const half = await expectAppError(
      users.add({
        user: actor(hr),
        input: newPerson({ email: 'x8@example.com', shiftStart: '10:00' }),
      }),
      'VALIDATION_FAILED',
    );
    expect(half.fields.shiftEnd).toBeTruthy();
    const backwards = await expectAppError(
      users.add({
        user: actor(hr),
        input: newPerson({ email: 'x8@example.com', shiftStart: '18:00', shiftEnd: '09:00' }),
      }),
      'VALIDATION_FAILED',
    );
    expect(backwards.fields.shiftEnd).toBe('The shift must end after it starts.');
  });
});

describe('users.update', () => {
  it('changes profile fields, never the role, and audits only what changed', async () => {
    const person = await users.add({
      user: actor(hr),
      input: newPerson({ email: 'edit@example.com' }),
    });
    const updated = await users.update({
      user: actor(hr),
      id: person.id,
      input: { designation: 'Senior frontend developer', role: 'admin', name: 'Riya Kapoor' },
    });
    expect(updated.designation).toBe('Senior frontend developer');
    expect(updated.role).toBe('employee');
    const [log] = await auditRows('user.update', person.id);
    expect(parseJson(log.before)).toEqual({ designation: 'Frontend developer' });
    expect(parseJson(log.after)).toEqual({ designation: 'Senior frontend developer' });

    await users.update({ user: actor(hr), id: person.id, input: { name: 'Riya Kapoor' } });
    expect(await auditRows('user.update', person.id)).toHaveLength(1);
  });

  it('clears the Slack user ID when the email changes and refuses a taken email', async () => {
    const person = await createUser({
      name: 'Mail Change',
      email: 'mail@example.com',
      slackUserId: 'U111',
    });
    const updated = await users.update({
      user: actor(hr),
      id: person.id,
      input: { email: 'New.Mail@Example.com' },
    });
    expect(updated).toMatchObject({ email: 'new.mail@example.com', slackUserId: null });
    await expectAppError(
      users.update({ user: actor(hr), id: person.id, input: { email: 'VISHAL@example.com' } }),
      'DUPLICATE_EMAIL',
    );
  });

  it('keeps a manager who is not a PM when that field is not changed', async () => {
    const lead = await createUser({ name: 'Anjali Bose', role: 'hr' });
    const person = await createUser({ name: 'Report To HR', reportsToId: lead.id });
    const updated = await users.update({
      user: actor(hr),
      id: person.id,
      input: { reportsToId: lead.id, designation: 'HR executive' },
    });
    expect(updated).toMatchObject({ reportsToId: lead.id, designation: 'HR executive' });
    await expectAppError(
      users.update({ user: actor(hr), id: person.id, input: { reportsToId: employee.id } }),
      'VALIDATION_FAILED',
    );
    const self = await expectAppError(
      users.update({ user: actor(hr), id: person.id, input: { reportsToId: person.id } }),
      'VALIDATION_FAILED',
    );
    expect(self.fields.reportsToId).toMatch(/themselves/);
  });

  it("does not let HR change an Admin's account", async () => {
    await expectAppError(
      users.update({ user: actor(hr), id: admin.id, input: { email: 'hr-owned@example.com' } }),
      'FORBIDDEN',
    );
    const updated = await users.update({
      user: actor(admin),
      id: admin.id,
      input: { designation: 'CEO' },
    });
    expect(updated.designation).toBe('CEO');
  });

  it('lets only an Admin change the email of a PM or HR account, which decides who signs in', async () => {
    const lead = await createUser({
      name: 'Lead Manager',
      email: 'lead@example.com',
      role: 'pm',
      tracksAttendance: false,
      slackUserId: 'U222',
    });
    const otherHr = await createUser({
      name: 'Other HR',
      email: 'other.hr@example.com',
      role: 'hr',
    });

    // The takeover: HR moves a PM's email onto their own Slack address.
    const toPm = await expectAppError(
      users.update({ user: actor(hr), id: lead.id, input: { email: 'hr-alt@example.com' } }),
      'FORBIDDEN',
    );
    expect(toPm.fields.email).toMatch(/Only an Admin can change a project manager's email/);
    const toHr = await expectAppError(
      users.update({ user: actor(hr), id: otherHr.id, input: { email: 'hr-alt@example.com' } }),
      'FORBIDDEN',
    );
    expect(toHr.fields.email).toMatch(/an HR person's email/);
    expect(await db('users').where({ id: lead.id }).first()).toMatchObject({
      email: 'lead@example.com',
      slackUserId: 'U222',
    });

    // The Edit drawer sends every field back: an unchanged email (any case) is not a change.
    const edited = await users.update({
      user: actor(hr),
      id: lead.id,
      input: { email: ' LEAD@example.com ', designation: 'Delivery lead' },
    });
    expect(edited).toMatchObject({ email: 'lead@example.com', designation: 'Delivery lead' });

    const moved = await users.update({
      user: actor(admin),
      id: lead.id,
      input: { email: 'lead.new@example.com' },
    });
    expect(moved).toMatchObject({ email: 'lead.new@example.com', slackUserId: null });
  });

  it('does not let HR change their own email, manager, joining date, shift or tracking', async () => {
    const self = await createUser({
      name: 'Self HR',
      email: 'self.hr@example.com',
      role: 'hr',
      reportsToId: pm.id,
      joinedOn: '2024-01-15',
    });
    const locked = {
      email: 'self.hr.new@example.com',
      reportsToId: null,
      joinedOn: '2026-09-01',
      shiftStart: '11:00',
      tracksAttendance: false,
    };
    for (const [key, value] of Object.entries(locked)) {
      const input =
        key === 'shiftStart' ? { shiftStart: '11:00', shiftEnd: '20:00' } : { [key]: value };
      const error = await expectAppError(
        users.update({ user: actor(self), id: self.id, input }),
        'FORBIDDEN',
      );
      expect(error.fields[key], key).toMatch(/^Only (another HR person or )?an Admin can change/);
    }
    expect(await auditRows('user.update', self.id)).toHaveLength(0);

    // Their name and designation are theirs to fix, and unchanged values ride along.
    const renamed = await users.update({
      user: actor(self),
      id: self.id,
      input: {
        name: 'Self HR Person',
        designation: 'HR executive',
        email: 'self.hr@example.com',
        reportsToId: pm.id,
        joinedOn: '2024-01-15',
        shiftStart: null,
        shiftEnd: null,
        tracksAttendance: true,
      },
    });
    expect(renamed).toMatchObject({ name: 'Self HR Person', designation: 'HR executive' });

    // Another HR person (or an Admin) makes those changes for them.
    const shifted = await users.update({
      user: actor(hr),
      id: self.id,
      input: { shiftStart: '11:00', shiftEnd: '20:00', joinedOn: '2026-09-01' },
    });
    expect(shifted).toMatchObject({
      shiftStart: '11:00',
      shiftEnd: '20:00',
      joinedOn: '2026-09-01',
    });

    // Nobody ranks above an Admin, so Admins edit their own account (check-in is optional).
    const own = await users.update({
      user: actor(admin),
      id: admin.id,
      input: { tracksAttendance: false, shiftStart: '10:00', shiftEnd: '19:00' },
    });
    expect(own).toMatchObject({ tracksAttendance: false, shiftStart: '10:00' });
  });

  it('answers NOT_FOUND for an unknown person', async () => {
    await expectAppError(users.update({ user: actor(hr), id: 99999, input: {} }), 'NOT_FOUND');
  });
});

describe('users.deactivate and users.reactivate', () => {
  it('ends their sessions, keeps their history and stops sign-in', async () => {
    const person = await createUser({ name: 'Leaving Person', email: 'leaving@example.com' });
    await auth.createSession({ userId: person.id, ip: '10.0.0.1', userAgent: 'test' });
    await auth.createSession({ userId: person.id, ip: '10.0.0.2', userAgent: 'test' });
    await db('attendance').insert({
      userId: person.id,
      workDate: '2026-09-29',
      checkInAt: new Date('2026-09-29T04:00:00Z'),
      location: 'office',
    });

    const result = await users.deactivate({ user: actor(hr), id: person.id, ip: '10.0.0.9' });
    expect(result.status).toBe('deactivated');
    expect(result.deactivatedAt).toEqual(new Date('2026-09-30T04:00:00Z'));
    expect(await db('sessions').where({ userId: person.id })).toHaveLength(0);
    expect(await db('attendance').where({ userId: person.id })).toHaveLength(1);
    expect(await auditRows('user.deactivate', person.id)).toHaveLength(1);
    await expectAppError(auth.devSignIn({ email: 'leaving@example.com' }), 'ACCOUNT_DEACTIVATED');
    expect((await users.listActive()).some((u) => u.id === person.id)).toBe(false);

    // Deactivating again changes nothing.
    await users.deactivate({ user: actor(hr), id: person.id });
    expect(await auditRows('user.deactivate', person.id)).toHaveLength(1);

    const back = await users.reactivate({ user: actor(hr), id: person.id });
    expect(back).toMatchObject({ status: 'active', deactivatedAt: null });
    expect(await auditRows('user.reactivate', person.id)).toHaveLength(1);
    await expect(auth.devSignIn({ email: 'leaving@example.com' })).resolves.toEqual({
      userId: person.id,
    });
  });

  it('refuses to deactivate yourself', async () => {
    const error = await expectAppError(
      users.deactivate({ user: actor(hr), id: hr.id }),
      'CANNOT_DEACTIVATE_SELF',
    );
    expect(error.status).toBe(409);
  });

  it('never deactivates the last active Admin', async () => {
    // HR can't touch Admin accounts at all.
    await expectAppError(users.deactivate({ user: actor(hr), id: admin.id }), 'FORBIDDEN');
    // An Admin acting through a session that no longer counts (just demoted elsewhere) still
    // can't remove the last active Admin.
    const ghost = { id: 424242, role: 'admin', status: 'active' };
    await expectAppError(users.deactivate({ user: ghost, id: admin.id }), 'LAST_ADMIN');
    expect((await db('users').where({ id: admin.id }).first()).status).toBe('active');

    const second = await createUser({ name: 'Admin Two', role: 'admin' });
    await users.deactivate({ user: actor(admin), id: second.id });
    expect((await db('users').where({ id: second.id }).first()).status).toBe('deactivated');
  });

  it('needs people.manage', async () => {
    await expectAppError(users.deactivate({ user: actor(pm), id: employee.id }), 'FORBIDDEN');
    await expectAppError(users.reactivate({ user: actor(employee), id: employee.id }), 'FORBIDDEN');
  });
});

describe('users.changeRole', () => {
  it('lets only Admin change roles and audits before and after', async () => {
    const person = await createUser({ name: 'Role Change' });
    await expectAppError(
      users.changeRole({ user: actor(hr), id: person.id, role: 'pm' }),
      'FORBIDDEN',
    );
    const updated = await users.changeRole({
      user: actor(admin),
      id: person.id,
      role: 'pm',
      ip: '1.2.3.4',
    });
    expect(updated).toMatchObject({ role: 'pm', roleLabel: 'Project manager' });
    const [log] = await auditRows('user.role_change', person.id);
    expect(parseJson(log.before)).toEqual({ role: 'employee', tracksAttendance: true });
    // PMs don't check in or write reports, so moving to PM stops tracking.
    expect(parseJson(log.after)).toEqual({ role: 'pm', tracksAttendance: false });
    expect(updated.tracksAttendance).toBe(false);
    expect(log.actorId).toBe(admin.id);

    // The same role again is a no-op.
    await users.changeRole({ user: actor(admin), id: person.id, role: 'pm' });
    expect(await auditRows('user.role_change', person.id)).toHaveLength(1);
  });

  it('rejects an unknown role', async () => {
    const error = await expectAppError(
      users.changeRole({ user: actor(admin), id: employee.id, role: 'boss' }),
      'VALIDATION_FAILED',
    );
    expect(error.fields.role).toBe('Pick a role.');
  });

  it('keeps at least one active Admin', async () => {
    const admins = await db('users').where({ role: 'admin', status: 'active' });
    expect(admins.map((row) => row.id)).toEqual([admin.id]);
    const error = await expectAppError(
      users.changeRole({ user: actor(admin), id: admin.id, role: 'employee' }),
      'LAST_ADMIN',
    );
    expect(error.status).toBe(409);
    expect((await db('users').where({ id: admin.id }).first()).role).toBe('admin');

    const second = await createUser({ name: 'Admin Three', role: 'admin' });
    await users.changeRole({ user: actor(admin), id: second.id, role: 'hr' });
    expect((await db('users').where({ id: second.id }).first()).role).toBe('hr');
  });
});

describe('users.getReportApproverIds', () => {
  it('sends edit requests to an active PM they report to, otherwise to every Admin', async () => {
    const underPm = await createUser({ name: 'Under PM', reportsToId: pm.id });
    expect(await users.getReportApproverIds(underPm.id)).toEqual([pm.id]);

    const underHr = await createUser({ name: 'Under HR', reportsToId: hr.id });
    expect(await users.getReportApproverIds(underHr.id)).toEqual([admin.id]);

    const oldPm = await createUser({ name: 'Former PM', role: 'pm', status: 'deactivated' });
    const orphan = await createUser({ name: 'Orphan', reportsToId: oldPm.id });
    expect(await users.getReportApproverIds(orphan.id)).toEqual([admin.id]);

    const nobody = await createUser({ name: 'No Manager' });
    expect(await users.getReportApproverIds(nobody.id)).toEqual([admin.id]);

    // An Admin's own requests go to the other Admins; the only Admin approves their own.
    expect(await users.getReportApproverIds(admin.id)).toEqual([admin.id]);
    const other = await createUser({ name: 'Admin Four', role: 'admin', reportsToId: admin.id });
    expect(await users.getReportApproverIds(other.id)).toEqual([admin.id]);
    expect(await users.getReportApproverIds(admin.id)).toEqual([other.id]);
    await db('users').where({ id: other.id }).update({ status: 'deactivated' });

    expect(await users.getReportApproverIds(987654)).toEqual([]);
  });
});

describe('users.list and counts', () => {
  beforeAll(async () => {
    await createUser({
      name: 'Zed Seo',
      email: 'zed@example.com',
      department: 'SEO',
      designation: 'SEO executive',
    });
    await createUser({
      name: 'Old Seo',
      email: 'oldseo@example.com',
      department: 'SEO',
      status: 'deactivated',
    });
    await createUser({ name: '50% Person', email: 'pct@example.com', department: 'Sales' });
  });

  it('filters by department (id or name), status and search, active first', async () => {
    const seo = await users.list({ user: actor(hr), department: 'SEO', limit: 100 });
    expect(seo.rows.map((row) => row.name)).toEqual(['Zed Seo', 'Old Seo']);
    expect(seo.total).toBe(2);
    const byId = await users.list({
      user: actor(hr),
      department: String(departments.SEO),
      status: 'active',
    });
    expect(byId.rows.map((row) => row.name)).toEqual(['Zed Seo']);
    const byNumber = await users.list({ user: actor(hr), department: departments.SEO });
    expect(byNumber.total).toBe(2);
    const gone = await users.list({ user: actor(hr), status: 'deactivated', q: 'seo' });
    expect(gone.rows.map((row) => row.name)).toEqual(['Old Seo']);
    // Emails match from their start, so the shared domain doesn't match everyone.
    expect((await users.list({ user: actor(hr), q: 'zed@exa' })).rows.map((r) => r.name)).toEqual([
      'Zed Seo',
    ]);
    expect((await users.list({ user: actor(hr), q: 'xample.com' })).total).toBe(0);
    const byDesignation = await users.list({ user: actor(hr), q: 'SEO executive' });
    expect(byDesignation.rows.map((row) => row.name)).toEqual(['Zed Seo']);
    const literal = await users.list({ user: actor(hr), q: '50%' });
    expect(literal.rows.map((row) => row.name)).toEqual(['50% Person']);
    const unknown = await users.list({ user: actor(hr), department: 'Marketing' });
    expect(unknown).toMatchObject({ rows: [], total: 0 });
  });

  it('pages with limit and offset and reports the total', async () => {
    const all = await users.list({ user: actor(hr), status: 'all', limit: 100 });
    const page = await users.list({ user: actor(hr), status: 'all', limit: 3, offset: 3 });
    expect(page.rows.map((row) => row.id)).toEqual(all.rows.slice(3, 6).map((row) => row.id));
    expect(page.total).toBe(all.total);
    const lastActive = all.rows.findLastIndex((row) => row.status === 'active');
    const firstGone = all.rows.findIndex((row) => row.status === 'deactivated');
    expect(lastActive).toBeLessThan(firstGone);
    await expectAppError(users.list({ user: actor(hr), limit: 101 }), 'VALIDATION_FAILED');
  });

  it('shows team.view callers active people only and refuses everyone else', async () => {
    const forPm = await users.list({ user: actor(pm), status: 'deactivated', limit: 100 });
    expect(forPm.rows.length).toBeGreaterThan(0);
    expect(forPm.rows.every((row) => row.status === 'active')).toBe(true);
    await expectAppError(users.list({ user: actor(employee) }), 'FORBIDDEN');
  });

  it('counts people per department, status and role', async () => {
    const list = await users.listDepartments();
    expect(list.map((row) => row.name)).toEqual([
      'Development',
      'SEO',
      'Delivery',
      'HR',
      'Sales',
      'Leadership',
    ]);
    const seo = list.find((row) => row.name === 'SEO');
    expect(seo.activeCount).toBe(1);
    const active = await db('users').where({ status: 'active' }).count({ n: '*' }).first();
    expect(list.reduce((sum, row) => sum + row.activeCount, 0)).toBe(Number(active.n));

    const statuses = await users.countByStatus();
    expect(statuses.active).toBe(Number(active.n));
    const roles = await users.countActiveByRole();
    expect(roles.admin + roles.pm + roles.hr + roles.employee).toBe(Number(active.n));
    expect(roles.admin).toBe(1);
  });

  it('reads people by id, list and role', async () => {
    expect(await users.findById(employee.id)).toMatchObject({
      name: 'Vishal Saini',
      roleLabel: 'Employee',
    });
    expect(await users.findById('nope')).toBeNull();
    const found = await users.findByIds([employee.id, pm.id, pm.id, 'x']);
    expect(found.map((row) => row.name)).toEqual(['Pat Manager', 'Vishal Saini']);
    expect((await users.listByRole('hr')).every((row) => row.role === 'hr')).toBe(true);
    expect(await users.listByRole('boss')).toEqual([]);
    await db('users').where({ id: hr.id }).update({ tracksAttendance: false });
    const tracked = await users.listActive({ tracksAttendance: true });
    expect(tracked.some((row) => row.id === hr.id)).toBe(false);
    await db('users').where({ id: hr.id }).update({ tracksAttendance: true });
  });
});

describe('users.syncSlackUserIds', () => {
  it('saves Slack user ids found by email and skips the rest', async () => {
    await db('users')
      .update({ slackUserId: 'U-TAKEN-' + 0 })
      .where({ id: admin.id });
    await db('users').whereNot({ id: admin.id }).update({ slackUserId: null });
    const known = { 'vishal@example.com': 'UVISHAL', 'pm@example.com': 'U-TAKEN-0' };
    setSlackClientForTests({
      users: {
        async lookupByEmail({ email }) {
          if (known[email]) return { ok: true, user: { id: known[email] } };
          const error = new Error('An API error occurred: users_not_found');
          error.data = { ok: false, error: 'users_not_found' };
          throw error;
        },
      },
    });
    const result = await users.syncSlackUserIds();
    expect(result).toEqual({ updated: 1 });
    expect((await db('users').where({ id: employee.id }).first()).slackUserId).toBe('UVISHAL');
    expect((await db('users').where({ id: pm.id }).first()).slackUserId).toBeNull();
    expect(await users.syncSlackUserIds()).toEqual({ updated: 0 });
  });
});

describe('users: changes that race each other', () => {
  it('lets only one of two Admins demote the other at the same moment', async () => {
    await db('users').where({ role: 'admin' }).update({ status: 'deactivated' });
    const first = await createUser({ name: 'Race Admin A', role: 'admin' });
    const second = await createUser({ name: 'Race Admin B', role: 'admin' });

    const results = await Promise.allSettled([
      users.changeRole({ user: actor(first), id: second.id, role: 'employee' }),
      users.changeRole({ user: actor(second), id: first.id, role: 'employee' }),
    ]);
    const failed = results.filter((result) => result.status === 'rejected');
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason.code).toBe('LAST_ADMIN');
    expect(await db('users').where({ role: 'admin', status: 'active' })).toHaveLength(1);

    // Deactivating and demoting at once can't leave Daybook without an Admin either.
    const third = await createUser({ name: 'Race Admin C', role: 'admin' });
    const [remaining] = await db('users').where({ role: 'admin', status: 'active' }).whereNot({
      id: third.id,
    });
    const mixed = await Promise.allSettled([
      users.deactivate({ user: actor(remaining), id: third.id }),
      users.changeRole({ user: actor(third), id: remaining.id, role: 'hr' }),
    ]);
    expect(mixed.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db('users').where({ role: 'admin', status: 'active' })).toHaveLength(1);

    await db('users').where({ id: admin.id }).update({ status: 'active', role: 'admin' });
  });

  it('adds one person when the same email is sent twice at once', async () => {
    const input = newPerson({ email: 'twice@example.com' });
    const results = await Promise.allSettled([
      users.add({ user: actor(hr), input }),
      users.add({ user: actor(hr), input: { ...input, email: 'TWICE@example.com' } }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const [failed] = results.filter((result) => result.status === 'rejected');
    expect(failed.reason.code).toBe('DUPLICATE_EMAIL');
    expect(await db('users').where({ email: 'twice@example.com' })).toHaveLength(1);
  });
});
