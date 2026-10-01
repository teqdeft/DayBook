// Projects: names, ownership, members, urgent, lists and the report picker (guide 7.4, 7.6).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { projects } from '@/modules/projects';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

// The reports module belongs to another owner; projects only reads hours from it.
vi.mock('@/modules/reports', () => ({
  reports: {
    hasEntriesForProjectRequest: vi.fn(async () => false),
    moveProjectRequestEntries: vi.fn(async () => 0),
    getMinutesByProject: vi.fn(async () => ({})),
    getLastReportDateByProject: vi.fn(async () => ({})),
  },
}));

let admin;
let pm;
let pm2;
let alice;
let bob;
let carol;
let hr;
let gone;

const T0 = '2026-09-30T05:00:00Z';

async function expectCode(promise, code) {
  await expect(promise).rejects.toMatchObject({ code });
}

async function expectField(promise, field) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(Object.keys(error.fields ?? {})).toContain(field);
  return error;
}

function newProject(overrides = {}) {
  return {
    name: 'acme-blog',
    clientName: 'Acme Retail',
    pmId: pm.id,
    memberIds: [alice.id, bob.id],
    status: 'active',
    color: 'teal',
    isUrgent: false,
    urgentNote: '',
    ...overrides,
  };
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
  setNowForTests(T0);
  admin = await createUser({ name: 'Ada Admin', role: 'admin', slackUserId: 'U0ADMIN' });
  pm = await createUser({ name: 'Paul Manager', role: 'pm', slackUserId: 'U0PM' });
  pm2 = await createUser({ name: 'Pia Manager', role: 'pm' });
  alice = await createUser({ name: 'Alice Dev', reportsToId: pm.id, slackUserId: 'U0ALICE' });
  bob = await createUser({ name: 'Bob Dev', reportsToId: pm.id });
  carol = await createUser({ name: 'Carol Dev', reportsToId: pm2.id, slackUserId: 'U0CAROL' });
  hr = await createUser({ name: 'Hana HR', role: 'hr' });
  gone = await createUser({ name: 'Gus Gone', status: 'deactivated' });
  await setSettings({ slack_enabled: true, slack_urgent_notify: true });
});

beforeEach(() => {
  setNowForTests(T0);
});

describe('create', () => {
  it('creates the project, a new client in the same transaction, members and an audit row', async () => {
    const project = await projects.create({ user: pm, input: newProject(), ip: '10.0.0.1' });
    expect(project).toMatchObject({
      name: 'acme-blog',
      clientName: 'Acme Retail',
      pmId: pm.id,
      pmName: 'Paul Manager',
      status: 'active',
      color: 'teal',
      isUrgent: false,
      urgentNote: null,
    });
    expect(project.members.map((m) => m.id)).toEqual([alice.id, bob.id]);
    const client = await db('clients').where({ name: 'Acme Retail' }).first();
    expect(client.isInternal).toBe(false);
    const members = await db('projectMembers').where({ projectId: project.id });
    expect(members).toHaveLength(2);
    expect(members.every((row) => row.addedBy === pm.id)).toBe(true);
    const [log] = await auditRows('project.create', project.id);
    expect(log).toMatchObject({ actorId: pm.id, ip: '10.0.0.1' });
    expect(log.after).toMatchObject({ name: 'acme-blog', memberIds: [alice.id, bob.id] });
  });

  it('reuses a client whatever the case, and "internal" is the Internal client', async () => {
    const one = await projects.create({
      user: pm,
      input: newProject({ name: 'acme-seo', clientName: '  acme   retail ', memberIds: [] }),
    });
    const two = await projects.create({
      user: pm,
      input: newProject({ name: 'internal-tool', clientName: 'internal', memberIds: [] }),
    });
    expect(await db('clients').where({ name: 'Acme Retail' })).toHaveLength(1);
    expect(one.clientName).toBe('Acme Retail');
    expect(two.clientIsInternal).toBe(true);
  });

  it('rejects names that match a project ignoring case, spaces, dashes and underscores', async () => {
    for (const name of ['Acme Blog', 'ACME-BLOG', 'acme_blog', 'acmeblog', ' a c m e - b l o g ']) {
      await expectCode(
        projects.create({ user: pm, input: newProject({ name }) }),
        'DUPLICATE_PROJECT',
      );
    }
    const error = await projects
      .create({ user: admin, input: newProject({ name: 'Acme Blog' }) })
      .catch((caught) => caught);
    expect(error.fields.name).toMatch(/already a project called acme-blog/);
  });

  it('rejects a name that matches a pending project request', async () => {
    const { request } = await projects.createRequest({
      user: carol,
      input: { name: 'Nova Website', note: 'Client signed.' },
    });
    await expectCode(
      projects.create({ user: pm, input: newProject({ name: 'nova-website', memberIds: [] }) }),
      'DUPLICATE_PROJECT',
    );
    await db('projectRequests').where({ id: request.id }).update({ status: 'declined' });
  });

  it('lets a PM create only projects they manage; Admin may pick any active PM or Admin', async () => {
    await expectField(
      projects.create({ user: pm, input: newProject({ name: 'p-one', pmId: pm2.id }) }),
      'pmId',
    );
    const byAdmin = await projects.create({
      user: admin,
      input: newProject({ name: 'p-two', pmId: pm2.id, memberIds: [] }),
    });
    expect(byAdmin.pmId).toBe(pm2.id);
    const note = await db('notifications')
      .where({ userId: pm2.id, type: 'project.created' })
      .first();
    expect(note.title).toBe('You are the PM of p-two');
    await expectField(
      projects.create({ user: admin, input: newProject({ name: 'p-three', pmId: alice.id }) }),
      'pmId',
    );
    await expectCode(
      projects.create({ user: alice, input: newProject({ name: 'p-four' }) }),
      'FORBIDDEN',
    );
    await expectCode(
      projects.create({ user: hr, input: newProject({ name: 'p-five' }) }),
      'FORBIDDEN',
    );
  });

  it('validates the fields with readable messages', async () => {
    await expectField(projects.create({ user: pm, input: newProject({ name: '' }) }), 'name');
    await expectField(projects.create({ user: pm, input: newProject({ name: '---' }) }), 'name');
    await expectField(
      projects.create({ user: pm, input: newProject({ name: 'x'.repeat(121) }) }),
      'name',
    );
    await expectField(
      projects.create({ user: pm, input: newProject({ name: 'p6', clientName: 'c'.repeat(161) }) }),
      'clientName',
    );
    await expectField(
      projects.create({ user: pm, input: newProject({ name: 'p7', memberIds: [gone.id] }) }),
      'memberIds',
    );
    await expectField(
      projects.create({
        user: pm,
        input: newProject({ name: 'p8', isUrgent: true, urgentNote: '' }),
      }),
      'urgentNote',
    );
    await expectField(
      projects.create({ user: pm, input: newProject({ name: 'p9', color: 'black' }) }),
      'color',
    );
  });

  it('creating an urgent project notifies the members', async () => {
    const project = await projects.create({
      user: pm,
      input: newProject({
        name: 'launch-site',
        memberIds: [alice.id],
        isUrgent: true,
        urgentNote: 'Go live Friday',
      }),
    });
    expect(project).toMatchObject({ isUrgent: true, urgentNote: 'Go live Friday' });
    const rows = await db('notifications').where({ type: 'project.urgent', userId: alice.id });
    expect(rows.map((row) => row.title)).toContain('launch-site is urgent');
  });
});

describe('update', () => {
  let project;

  beforeAll(async () => {
    project = await projects.create({
      user: pm,
      input: newProject({ name: 'studio-site', clientName: 'Internal', memberIds: [alice.id] }),
    });
  });

  it('lets only the project PM or Admin edit it', async () => {
    await expectCode(
      projects.update({ user: pm2, id: project.id, input: { color: 'pink' } }),
      'FORBIDDEN',
    );
    await expectCode(
      projects.update({ user: alice, id: project.id, input: { color: 'pink' } }),
      'FORBIDDEN',
    );
    const edited = await projects.update({ user: admin, id: project.id, input: { color: 'pink' } });
    expect(edited.color).toBe('pink');
    const own = await projects.update({
      user: pm,
      id: project.id,
      input: { name: 'Studio Site', clientName: 'Nova Labs' },
    });
    expect(own).toMatchObject({ name: 'Studio Site', clientName: 'Nova Labs' });
    const [log] = await auditRows('project.update', project.id);
    expect(log.before.color).toBe('teal');
    expect(log.after.color).toBe('pink');
    await expectCode(
      projects.update({ user: pm, id: 999999, input: { color: 'pink' } }),
      'NOT_FOUND',
    );
  });

  it('keeps names unique on rename, but allows changing only case or dashes', async () => {
    await expectCode(
      projects.update({ user: pm, id: project.id, input: { name: 'ACME blog' } }),
      'DUPLICATE_PROJECT',
    );
    const renamed = await projects.update({
      user: pm,
      id: project.id,
      input: { name: 'studio_site' },
    });
    expect(renamed.name).toBe('studio_site');
  });

  it('only Admin hands a project to another PM, and saving an unchanged PM is fine', async () => {
    await expectField(
      projects.update({ user: pm, id: project.id, input: { pmId: pm2.id } }),
      'pmId',
    );
    // Hiring on the canvas: its PM has the HR role. Saving without changing the PM works.
    const hiring = await projects.create({
      user: admin,
      input: newProject({ name: 'Hiring', clientName: 'Internal', pmId: admin.id, memberIds: [] }),
    });
    await db('projects').where({ id: hiring.id }).update({ pmId: hr.id });
    const saved = await projects.update({
      user: admin,
      id: hiring.id,
      input: { name: 'Hiring', pmId: hr.id, color: 'pink' },
    });
    expect(saved).toMatchObject({ pmId: hr.id, pmName: 'Hana HR', color: 'pink' });
    await expectField(
      projects.update({ user: admin, id: hiring.id, input: { pmId: bob.id } }),
      'pmId',
    );
  });

  it('sets completed_at when completed and clears the urgent flag off active', async () => {
    const marked = await projects.markUrgent({ user: pm, id: project.id, note: 'Fix the footer' });
    expect(marked.isUrgent).toBe(true);
    const held = await projects.update({ user: pm, id: project.id, input: { status: 'on_hold' } });
    expect(held).toMatchObject({ status: 'on_hold', isUrgent: false, urgentNote: null });
    await expectField(
      projects.update({ user: pm, id: project.id, input: { isUrgent: true, urgentNote: 'x' } }),
      'isUrgent',
    );
    setNowForTests('2026-10-02T06:00:00Z');
    const done = await projects.update({
      user: pm,
      id: project.id,
      input: { status: 'completed' },
    });
    expect(done.completedAt).toEqual(new Date('2026-10-02T06:00:00Z'));
    const back = await projects.update({ user: pm, id: project.id, input: { status: 'active' } });
    expect(back.completedAt).toBeNull();
  });
});

describe('members', () => {
  let project;

  beforeAll(async () => {
    setNowForTests(T0);
    project = await projects.create({
      user: pm,
      input: newProject({ name: 'member-test', memberIds: [alice.id, bob.id] }),
    });
  });

  it('replaces the member list and records who added whom', async () => {
    setNowForTests('2026-09-30T07:00:00Z');
    const members = await projects.setMembers({
      user: pm,
      id: project.id,
      userIds: [bob.id, carol.id],
    });
    expect(members.map((m) => m.id)).toEqual([bob.id, carol.id]);
    const carolRow = await db('projectMembers')
      .where({ projectId: project.id, userId: carol.id })
      .first();
    expect(carolRow).toMatchObject({ addedBy: pm.id });
    expect(carolRow.addedAt).toEqual(new Date('2026-09-30T07:00:00Z'));
    const bobRow = await db('projectMembers')
      .where({ projectId: project.id, userId: bob.id })
      .first();
    expect(bobRow.addedAt).toEqual(new Date(T0));
    const [log] = await auditRows('project.members', project.id);
    expect(log.before.memberIds).toEqual([alice.id, bob.id]);
    expect(log.after.memberIds).toEqual([bob.id, carol.id]);
  });

  it('accepts only active people and keeps deactivated members for history', async () => {
    await db('projectMembers').insert({
      projectId: project.id,
      userId: gone.id,
      addedAt: new Date(T0),
    });
    await expectField(
      projects.setMembers({ user: pm, id: project.id, userIds: [bob.id, gone.id] }),
      'memberIds',
    );
    const members = await projects.setMembers({ user: pm, id: project.id, userIds: [alice.id] });
    expect(members.map((m) => m.id)).toEqual([alice.id]);
    const ids = (await db('projectMembers').where({ projectId: project.id })).map((r) => r.userId);
    expect(ids.sort()).toEqual([alice.id, gone.id].sort());
  });

  it('lets only the project PM or Admin change members', async () => {
    await expectCode(projects.setMembers({ user: pm2, id: project.id, userIds: [] }), 'FORBIDDEN');
    const members = await projects.setMembers({ user: admin, id: project.id, userIds: [] });
    expect(members).toEqual([]);
  });
});

describe('urgent', () => {
  let project;

  beforeAll(async () => {
    project = await projects.create({
      user: pm,
      input: newProject({ name: 'iwilltillimwell', memberIds: [alice.id, carol.id, bob.id] }),
    });
  });

  it('requires a note of 1 to 200 characters', async () => {
    await expectField(projects.markUrgent({ user: pm, id: project.id, note: '  ' }), 'note');
    await expectField(
      projects.markUrgent({ user: pm, id: project.id, note: 'x'.repeat(201) }),
      'note',
    );
  });

  it('only the project PM or Admin marks it urgent', async () => {
    await expectCode(projects.markUrgent({ user: pm2, id: project.id, note: 'Now' }), 'FORBIDDEN');
    await expectCode(
      projects.markUrgent({ user: alice, id: project.id, note: 'Now' }),
      'FORBIDDEN',
    );
  });

  it('notifies every member in the app and by Slack DM, and is audited', async () => {
    const before = await db('slackOutbox').count({ n: '*' }).first();
    const marked = await projects.markUrgent({
      user: pm,
      id: project.id,
      note: 'Homepage <content> live today',
      ip: '10.0.0.2',
    });
    expect(marked).toMatchObject({
      isUrgent: true,
      urgentNote: 'Homepage <content> live today',
      urgentMarkedById: pm.id,
      urgentMarkedByName: 'Paul Manager',
    });
    const notes = await db('notifications').where({
      type: 'project.urgent',
      title: 'iwilltillimwell is urgent',
    });
    expect(notes.map((row) => row.userId).sort()).toEqual([alice.id, bob.id, carol.id].sort());
    expect(notes[0]).toMatchObject({ body: 'Homepage <content> live today', link: '/today' });
    const dms = await db('slackOutbox').where({
      kind: 'dm',
      relatedType: 'project',
      relatedId: project.id,
    });
    // Bob has no Slack user id: skipped, his in-app notification still arrived.
    expect(dms.map((row) => row.channel).sort()).toEqual(['U0ALICE', 'U0CAROL']);
    const text = parseJson(dms[0].payload).text;
    expect(text).toContain('*iwilltillimwell*');
    expect(text).toContain('Homepage &lt;content&gt; live today');
    expect(text).toContain('/today|');
    const after = await db('slackOutbox').count({ n: '*' }).first();
    expect(after.n - before.n).toBe(2);
    const [log] = await auditRows('project.mark_urgent', project.id);
    expect(log).toMatchObject({ actorId: pm.id, ip: '10.0.0.2' });
    expect(log.after.urgentNote).toBe('Homepage <content> live today');
  });

  it('does not DM when slack_urgent_notify is off, but still notifies in the app', async () => {
    await projects.clearUrgent({ user: pm, id: project.id });
    await setSettings({ slack_urgent_notify: false });
    const before = await db('slackOutbox').count({ n: '*' }).first();
    await projects.markUrgent({ user: admin, id: project.id, note: 'Second round' });
    const after = await db('slackOutbox').count({ n: '*' }).first();
    expect(after.n).toBe(before.n);
    const rows = await db('notifications').where({ type: 'project.urgent', body: 'Second round' });
    expect(rows).toHaveLength(3);
    await setSettings({ slack_urgent_notify: true });
  });

  it('unmarking clears the note and is audited', async () => {
    const cleared = await projects.clearUrgent({ user: pm, id: project.id, ip: '10.0.0.3' });
    expect(cleared).toMatchObject({
      isUrgent: false,
      urgentNote: null,
      urgentMarkedAt: null,
      urgentMarkedById: null,
    });
    const logs = await auditRows('project.unmark_urgent', project.id);
    expect(logs.at(-1).before.urgentNote).toBe('Second round');
    expect(logs.at(-1).after.urgentNote).toBeNull();
    // Clearing again changes nothing.
    await projects.clearUrgent({ user: pm, id: project.id });
    expect(await auditRows('project.unmark_urgent', project.id)).toHaveLength(logs.length);
  });

  it('only active projects can be urgent', async () => {
    await projects.update({ user: pm, id: project.id, input: { status: 'on_hold' } });
    await expectCode(
      projects.markUrgent({ user: pm, id: project.id, note: 'Now' }),
      'PROJECT_NOT_ACTIVE',
    );
    await projects.update({ user: pm, id: project.id, input: { status: 'active' } });
  });

  it('the edit drawer marks and unmarks urgent the same way', async () => {
    const marked = await projects.update({
      user: pm,
      id: project.id,
      input: { isUrgent: true, urgentNote: 'From the drawer' },
    });
    expect(marked.urgentNote).toBe('From the drawer');
    expect(await db('notifications').where({ body: 'From the drawer' })).toHaveLength(3);
    const cleared = await projects.update({
      user: pm,
      id: project.id,
      input: { isUrgent: false, urgentNote: 'ignored' },
    });
    expect(cleared).toMatchObject({ isUrgent: false, urgentNote: null });
  });
});

describe('reads', () => {
  let urgentOne;
  let mine;
  let other;
  let held;

  beforeAll(async () => {
    await db('projectMembers').del();
    await db('projectRequests').del();
    await db('projects').del();
    urgentOne = await projects.create({
      user: pm,
      input: newProject({
        name: 'zeta-urgent',
        memberIds: [alice.id],
        isUrgent: true,
        urgentNote: 'Today',
      }),
    });
    other = await projects.create({
      user: pm2,
      input: newProject({ name: 'beta-other', pmId: pm2.id, memberIds: [carol.id] }),
    });
    mine = await projects.create({
      user: pm,
      input: newProject({ name: 'alpha-mine', memberIds: [alice.id, bob.id] }),
    });
    held = await projects.create({
      user: pm,
      input: newProject({ name: 'gamma-held', memberIds: [alice.id], status: 'on_hold' }),
    });
    await projects.create({
      user: pm2,
      input: newProject({
        name: 'delta-urgent',
        pmId: pm2.id,
        memberIds: [carol.id],
        isUrgent: true,
        urgentNote: 'Soon',
      }),
    });
  });

  it('the report picker lists urgent, then mine, then others, then pending requests', async () => {
    const { request } = await projects.createRequest({
      user: alice,
      input: { name: 'acme-blog', note: 'Blog posts every month.' },
    });
    const picker = await projects.getPickerFor(alice.id);
    expect(picker.urgent.map((p) => p.name)).toEqual(['delta-urgent', 'zeta-urgent']);
    expect(picker.urgent.every((p) => p.isUrgent)).toBe(true);
    expect(picker.mine.map((p) => p.name)).toEqual(['alpha-mine']);
    expect(picker.others.map((p) => p.name)).toEqual(['beta-other']);
    expect(picker.requests).toEqual([{ requestId: request.id, name: 'acme-blog' }]);
    // On-hold projects can't be picked. A PM's own projects count as theirs.
    const pmPicker = await projects.getPickerFor(pm2.id);
    expect(pmPicker.mine.map((p) => p.name)).toEqual(['beta-other']);
    expect(pmPicker.requests).toEqual([]);
    expect(await projects.isActive(held.id)).toBe(false);
    expect(await projects.isActive(mine.id)).toBe(true);
  });

  it('lists urgent projects for members and for everyone, and counts active ones', async () => {
    const forAlice = await projects.listUrgentForMember(alice.id);
    expect(forAlice).toHaveLength(1);
    expect(forAlice[0]).toMatchObject({
      id: urgentOne.id,
      name: 'zeta-urgent',
      urgentNote: 'Today',
      pmName: 'Paul Manager',
      urgentMarkedByName: 'Paul Manager',
      memberCount: 1,
    });
    expect((await projects.listUrgent()).map((p) => p.name).sort()).toEqual([
      'delta-urgent',
      'zeta-urgent',
    ]);
    expect(await projects.countActive()).toEqual({ active: 4, urgent: 2 });
  });

  it('lists and counts with a search that ignores spaces and dashes', async () => {
    const { rows, total } = await projects.list({ status: 'active', q: 'alpha mine' });
    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({ id: mine.id, name: 'alpha-mine' });
    expect(rows[0].members.map((m) => m.name)).toEqual(['Alice Dev', 'Bob Dev']);
    const byClient = await projects.list({ q: 'retail' });
    expect(byClient.total).toBe(5);
    expect(await projects.countByStatus({ memberId: alice.id })).toEqual({
      active: 2,
      on_hold: 1,
      completed: 0,
    });
    const own = await projects.listForMember(alice.id);
    expect(own.map((p) => p.name)).toEqual(['zeta-urgent', 'alpha-mine', 'gamma-held']);
    expect(await projects.findById(other.id)).toMatchObject({
      name: 'beta-other',
      pmName: 'Pia Manager',
    });
    expect(await projects.findById(123456)).toBeNull();
  });

  it('?mine=1 lists the projects a person is a member or the PM of', async () => {
    const forPm = await projects.list({ mineFor: pm2.id });
    expect(forPm.rows.map((p) => p.name)).toEqual(['beta-other', 'delta-urgent']);
    const forAlice = await projects.list({ mineFor: alice.id, status: 'active' });
    expect(forAlice.rows.map((p) => p.name)).toEqual(['zeta-urgent', 'alpha-mine']);
    expect(forAlice.total).toBe(2);
  });

  it('counts only active members of an urgent project', async () => {
    // Someone who left stays in project_members for history but is not counted.
    await db('projectMembers').insert({
      projectId: urgentOne.id,
      userId: gone.id,
      addedBy: pm.id,
      addedAt: new Date(T0),
    });
    const [row] = await projects.listUrgentForMember(alice.id);
    expect(row.memberCount).toBe(1);
    const found = await projects.list({ q: 'zeta' });
    expect(found.rows[0].members.map((m) => m.name)).toEqual(['Alice Dev']);
    await db('projectMembers').where({ projectId: urgentOne.id, userId: gone.id }).del();
  });

  it('offers the right PM choices and clients', async () => {
    expect((await projects.listManagerOptions(pm)).map((p) => p.id)).toEqual([pm.id]);
    const forAdmin = (await projects.listManagerOptions(admin)).map((p) => p.name);
    expect(forAdmin).toEqual(['Ada Admin', 'Paul Manager', 'Pia Manager']);
    expect(await projects.listManagerOptions(alice)).toEqual([]);
    const clients = await projects.listClients({ q: 'ac' });
    expect(clients.map((c) => c.name)).toEqual(['Acme Retail']);
    const all = await projects.listClients({ limit: 100 });
    const second = await projects.listClients({ limit: 1, offset: 1 });
    expect(second.map((c) => c.name)).toEqual([all[1].name]);
    const people = await projects.listPeopleOptions();
    expect(people.map((p) => p.name)).not.toContain('Gus Gone');
  });
});
