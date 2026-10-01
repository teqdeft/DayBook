// Project requests (guide 7.7): similar names, notifications, approve and decline.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { projects } from '@/modules/projects';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

// The reports module belongs to another owner. These fakes move report_entries rows the way the
// contract describes, inside the transaction they are given.
const { reportsFake } = vi.hoisted(() => ({
  reportsFake: {
    hasEntriesForProjectRequest: null,
    moveProjectRequestEntries: null,
    getMinutesByProject: async () => ({}),
    getLastReportDateByProject: async () => ({}),
  },
}));
vi.mock('@/modules/reports', () => ({ reports: reportsFake }));

let admin;
let pm;
let pm2;
let priya;
let rohit;
let hr;
let store;

const T0 = '2026-09-29T11:50:00Z';

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
}

let reportDay = 20;

/** A report for the person (on a new day each time) with one entry logged to a pending request. */
async function logHoursToRequest(userId, requestId, minutes = 120) {
  reportDay += 1;
  const [reportId] = await db('dailyReports').insert({
    userId,
    workDate: `2026-09-${reportDay}`,
    status: 'draft',
    totalMinutes: minutes,
    locksAt: new Date('2026-09-30T06:30:00Z'),
  });
  const [entryId] = await db('reportEntries').insert({
    reportId,
    projectRequestId: requestId,
    minutes,
  });
  return entryId;
}

function projectFields(overrides = {}) {
  return {
    name: 'acme-blog',
    clientName: 'Acme Retail',
    pmId: pm.id,
    memberIds: [],
    status: 'active',
    color: 'violet',
    isUrgent: false,
    urgentNote: '',
    ...overrides,
  };
}

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(T0);
  admin = await createUser({ name: 'Ada Admin', role: 'admin', slackUserId: 'U0ADMIN' });
  pm = await createUser({ name: 'Paul Manager', role: 'pm', slackUserId: 'U0PM' });
  pm2 = await createUser({ name: 'Pia Manager', role: 'pm', slackUserId: 'U0PM2' });
  priya = await createUser({ name: 'Priya Sharma', reportsToId: pm.id, slackUserId: 'U0PRIYA' });
  hr = await createUser({ name: 'Hana HR', role: 'hr' });
  // Reports to HR, not a PM: requests go to the Admins.
  rohit = await createUser({ name: 'Rohit Verma', reportsToId: hr.id });
  await setSettings({ slack_enabled: true, slack_requests_notify: true });
  store = await projects.create({
    user: pm,
    input: projectFields({ name: 'acme-store', memberIds: [priya.id] }),
  });
});

beforeEach(() => {
  setNowForTests(T0);
  reportsFake.hasEntriesForProjectRequest = vi.fn(async (requestId) => {
    const row = await db('reportEntries').where({ projectRequestId: requestId }).first();
    return Boolean(row);
  });
  reportsFake.moveProjectRequestEntries = vi.fn(async ({ projectRequestId, projectId }, trx) =>
    trx('reportEntries').where({ projectRequestId }).update({ projectId, projectRequestId: null }),
  );
});

describe('createRequest', () => {
  it('suggests a similar project instead of saving, until sent anyway', async () => {
    const first = await projects.createRequest({
      user: priya,
      input: { name: 'Acme Store', note: 'For the new shop.' },
    });
    expect(first.request).toBeNull();
    expect(first.similarProject).toMatchObject({
      kind: 'project',
      id: store.id,
      name: 'acme-store',
      clientName: 'Acme Retail',
    });
    expect(await db('projectRequests')).toHaveLength(0);

    const sent = await projects.createRequest({
      user: priya,
      input: { name: 'Acme Store', note: 'For the new shop.', sendAnyway: true },
    });
    expect(sent.request).toMatchObject({ name: 'Acme Store', status: 'pending' });
    expect(sent.similarProject.name).toBe('acme-store');
    await db('projectRequests').where({ id: sent.request.id }).update({ status: 'declined' });
  });

  it('saves the request, notifies and DMs only the reports_to PM', async () => {
    setNowForTests('2026-09-29T11:51:00Z');
    const { request, similarProject } = await projects.createRequest({
      user: priya,
      input: { name: 'acme-blog', note: 'Client wants <monthly> blog posts.' },
      ip: '10.0.0.9',
    });
    expect(similarProject).toBeNull();
    expect(request).toMatchObject({
      name: 'acme-blog',
      note: 'Client wants <monthly> blog posts.',
      status: 'pending',
      requestedBy: priya.id,
      requester: { id: priya.id, name: 'Priya Sharma' },
    });
    const notes = await db('notifications').where({
      type: 'project_request.created',
      title: 'Priya Sharma asked for a project: acme-blog',
    });
    expect(notes.map((row) => row.userId)).toEqual([pm.id]);
    expect(notes[0]).toMatchObject({
      title: 'Priya Sharma asked for a project: acme-blog',
      link: '/requests',
    });
    const dms = await db('slackOutbox').where({
      relatedType: 'project_request',
      relatedId: request.id,
    });
    expect(dms.map((row) => row.channel)).toEqual(['U0PM']);
    const text = parseJson(dms[0].payload).text;
    expect(text).toContain('Priya Sharma asked for a new project: *acme-blog*');
    expect(text).toContain('Client wants &lt;monthly&gt; blog posts.');
    expect(text).toContain('/requests|');
    const log = await db('auditLogs')
      .where({ action: 'project_request.create', entityId: request.id })
      .first();
    expect(log).toMatchObject({ actorId: priya.id, entityId: request.id, ip: '10.0.0.9' });
  });

  it('suggests a pending request by someone else, and refuses a second one by the same person', async () => {
    const other = await projects.createRequest({
      user: rohit,
      input: { name: 'ACME blog', note: 'Same thing.' },
    });
    expect(other.request).toBeNull();
    expect(other.similarProject).toMatchObject({
      kind: 'request',
      requestedByName: 'Priya Sharma',
    });
    await expectCode(
      projects.createRequest({ user: priya, input: { name: 'acme_blog', note: 'Again' } }),
      'REQUEST_ALREADY_PENDING',
    );
  });

  it('goes to Admins when the person does not report to a PM', async () => {
    const { request } = await projects.createRequest({
      user: rohit,
      input: { name: 'hr-portal', note: 'Leave tracking.' },
    });
    const dms = await db('slackOutbox').where({
      relatedType: 'project_request',
      relatedId: request.id,
    });
    expect(dms.map((row) => row.channel)).toEqual(['U0ADMIN']);
    const notes = await db('notifications').where({
      type: 'project_request.created',
      title: 'Rohit Verma asked for a project: hr-portal',
    });
    expect(notes.map((row) => row.userId)).toEqual([admin.id]);
    await db('projectRequests').where({ id: request.id }).update({ status: 'declined' });
  });

  it('saves a double submit only once', async () => {
    const input = { name: 'twice-sent', note: 'Clicked twice.' };
    const results = await Promise.allSettled([
      projects.createRequest({ user: rohit, input }),
      projects.createRequest({ user: rohit, input }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(results.find((r) => r.status === 'rejected').reason).toMatchObject({
      code: 'REQUEST_ALREADY_PENDING',
    });
    const rows = await db('projectRequests').where({ name: 'twice-sent' });
    expect(rows).toHaveLength(1);
    await db('projectRequests').where({ name: 'twice-sent' }).update({ status: 'declined' });
  });

  it('validates the name and note', async () => {
    await expectField(
      projects.createRequest({ user: priya, input: { name: '', note: 'x' } }),
      'name',
    );
    await expectField(
      projects.createRequest({ user: priya, input: { name: 'n'.repeat(121), note: 'x' } }),
      'name',
    );
    await expectField(
      projects.createRequest({ user: priya, input: { name: 'abc', note: '' } }),
      'note',
    );
    await expectField(
      projects.createRequest({ user: priya, input: { name: 'abc', note: 'n'.repeat(501) } }),
      'note',
    );
  });
});

describe('lists', () => {
  it('shows pending requests to PMs and Admins only, newest first', async () => {
    const pending = await projects.listPendingRequestsFor(pm2);
    expect(pending.map((row) => row.name)).toEqual(['acme-blog']);
    expect(pending[0]).toMatchObject({ hasEntries: false, requester: { name: 'Priya Sharma' } });
    expect(await projects.countPendingRequestsFor(pm2)).toBe(1);
    expect(await projects.countPendingRequestsFor(admin)).toBe(1);
    expect(await projects.countPendingRequestsFor(priya)).toBe(0);
    expect(await projects.listPendingRequestsFor(hr)).toEqual([]);
    const own = await projects.findPendingRequestForUser(pending[0].id, priya.id);
    expect(own).toMatchObject({ name: 'acme-blog', status: 'pending' });
    expect(await projects.findPendingRequestForUser(pending[0].id, rohit.id)).toBeNull();
  });
});

describe('approveRequest', () => {
  let request;

  beforeAll(async () => {
    request = (await db('projectRequests').where({ name: 'acme-blog' }).first()) ?? null;
  });

  it('only PMs and Admins handle requests, and a PM creates projects they manage', async () => {
    await expectCode(
      projects.approveRequest({ user: priya, id: request.id, input: projectFields() }),
      'FORBIDDEN',
    );
    await expectField(
      projects.approveRequest({ user: pm2, id: request.id, input: projectFields({ pmId: pm.id }) }),
      'pmId',
    );
  });

  it('creates the project, adds the requester, moves the entries and marks the request approved', async () => {
    const entryId = await logHoursToRequest(priya.id, request.id);
    setNowForTests('2026-09-30T10:45:00Z');
    const { project, request: handled } = await projects.approveRequest({
      user: pm2,
      id: request.id,
      input: projectFields({ pmId: pm2.id, memberIds: [rohit.id] }),
      ip: '10.0.0.7',
    });
    expect(project).toMatchObject({ name: 'acme-blog', pmId: pm2.id, clientName: 'Acme Retail' });
    expect(project.members.map((m) => m.id)).toEqual([rohit.id, priya.id]);
    expect(handled).toMatchObject({
      status: 'approved',
      projectId: project.id,
      handledBy: { id: pm2.id, name: 'Pia Manager' },
    });
    expect(handled.handledAt).toEqual(new Date('2026-09-30T10:45:00Z'));
    expect(reportsFake.moveProjectRequestEntries).toHaveBeenCalledTimes(1);
    expect(reportsFake.moveProjectRequestEntries.mock.calls[0][0]).toEqual({
      projectRequestId: request.id,
      projectId: project.id,
    });
    const entry = await db('reportEntries').where({ id: entryId }).first();
    expect(entry).toMatchObject({ projectId: project.id, projectRequestId: null });
    const note = await db('notifications')
      .where({ userId: priya.id, type: 'project_request.approved' })
      .first();
    expect(note).toMatchObject({
      title: 'Your project request was approved',
      body: 'acme-blog is ready. You can log hours to it.',
    });
    const dm = await db('slackOutbox')
      .where({ channel: 'U0PRIYA', relatedType: 'project_request', relatedId: request.id })
      .first();
    expect(parseJson(dm.payload).text).toContain('was approved');
    const log = await db('auditLogs').where({ action: 'project_request.approve' }).first();
    expect(parseJson(log.after)).toMatchObject({ projectId: project.id, movedEntries: 1 });
    expect(await projects.countPendingRequestsFor(pm)).toBe(0);
  });

  it('cannot be handled twice', async () => {
    await expectCode(
      projects.approveRequest({ user: pm, id: request.id, input: projectFields({ name: 'x1' }) }),
      'REQUEST_ALREADY_HANDLED',
    );
    await expectCode(
      projects.declineRequest({ user: pm, id: request.id, input: { reason: 'No' } }),
      'REQUEST_ALREADY_HANDLED',
    );
    await expectCode(
      projects.approveRequest({ user: pm, id: 999999, input: projectFields({ name: 'x2' }) }),
      'NOT_FOUND',
    );
  });

  it('rolls everything back when the project name is taken', async () => {
    const { request: again } = await projects.createRequest({
      user: priya,
      input: { name: 'nova-site', note: 'New client.' },
    });
    await expectCode(
      projects.approveRequest({
        user: pm,
        id: again.id,
        input: projectFields({ name: 'acme store' }),
      }),
      'DUPLICATE_PROJECT',
    );
    const row = await db('projectRequests').where({ id: again.id }).first();
    expect(row.status).toBe('pending');
    const created = await projects.approveRequest({
      user: admin,
      id: again.id,
      input: projectFields({ name: 'nova-site', pmId: pm.id }),
    });
    expect(created.project.pmId).toBe(pm.id);
    const pmNote = await db('notifications')
      .where({ userId: pm.id, type: 'project.created' })
      .first();
    expect(pmNote).toMatchObject({
      title: 'You are the PM of nova-site',
      body: "Created from Priya Sharma's project request.",
    });
  });
});

describe('approveRequest with a second request for the same name', () => {
  it('approves one of them; the other can then be declined into the new project', async () => {
    const { request: first } = await projects.createRequest({
      user: priya,
      input: { name: 'medlink-app', note: 'New client.' },
    });
    const { request: second } = await projects.createRequest({
      user: rohit,
      input: { name: 'Medlink App', note: 'Same client.', sendAnyway: true },
    });
    expect(second).toMatchObject({ status: 'pending' });
    // A New project with that name is still refused while the requests wait.
    await expectCode(
      projects.create({ user: pm, input: projectFields({ name: 'medlink_app' }) }),
      'DUPLICATE_PROJECT',
    );
    const { project } = await projects.approveRequest({
      user: pm,
      id: first.id,
      input: projectFields({ name: 'medlink-app' }),
    });
    expect(project.name).toBe('medlink-app');
    await expectCode(
      projects.approveRequest({
        user: pm,
        id: second.id,
        input: projectFields({ name: 'Medlink App' }),
      }),
      'DUPLICATE_PROJECT',
    );
    const entryId = await logHoursToRequest(rohit.id, second.id, 60);
    await projects.declineRequest({
      user: pm,
      id: second.id,
      input: { reason: 'Priya asked first.', moveEntriesToProjectId: project.id },
    });
    const entry = await db('reportEntries').where({ id: entryId }).first();
    expect(entry).toMatchObject({ projectId: project.id, projectRequestId: null });
  });

  it('still refuses a different name that another pending request holds', async () => {
    const { request: mine } = await projects.createRequest({
      user: priya,
      input: { name: 'bright-idea', note: 'x' },
    });
    await projects.createRequest({ user: rohit, input: { name: 'other-idea', note: 'y' } });
    await expectCode(
      projects.approveRequest({
        user: pm,
        id: mine.id,
        input: projectFields({ name: 'Other Idea' }),
      }),
      'DUPLICATE_PROJECT',
    );
    await db('projectRequests')
      .whereIn('name', ['bright-idea', 'other-idea'])
      .update({ status: 'declined', handledAt: new Date('2026-09-01T00:00:00Z') });
  });
});

describe('declineRequest', () => {
  it('needs a reason', async () => {
    const { request } = await projects.createRequest({
      user: priya,
      input: { name: 'side-quest', note: 'Idea.' },
    });
    await expectField(
      projects.declineRequest({ user: pm, id: request.id, input: { reason: ' ' } }),
      'reason',
    );
    await expectField(
      projects.declineRequest({ user: pm, id: request.id, input: { reason: 'r'.repeat(301) } }),
      'reason',
    );
    const { request: declined } = await projects.declineRequest({
      user: pm,
      id: request.id,
      input: { reason: 'Use acme-store for this.' },
    });
    expect(declined).toMatchObject({
      status: 'declined',
      declineReason: 'Use acme-store for this.',
    });
    const note = await db('notifications')
      .where({ userId: priya.id, type: 'project_request.declined' })
      .first();
    expect(note).toMatchObject({
      title: 'Your project request was declined',
      body: 'side-quest: Use acme-store for this.',
    });
    const log = await db('auditLogs')
      .where({ action: 'project_request.decline', entityId: request.id })
      .first();
    expect(log.reason).toBe('Use acme-store for this.');
  });

  it('asks for an active project to move logged hours to, then moves them', async () => {
    const { request } = await projects.createRequest({
      user: priya,
      input: { name: 'blog-refresh', note: 'Old blog.' },
    });
    const entryId = await logHoursToRequest(priya.id, request.id, 90);
    await expectField(
      projects.declineRequest({
        user: pm,
        id: request.id,
        input: { reason: 'Part of acme-store' },
      }),
      'moveEntriesToProjectId',
    );
    const held = await projects.create({
      user: pm,
      input: projectFields({ name: 'on-hold-one', status: 'on_hold' }),
    });
    await expectField(
      projects.declineRequest({
        user: pm,
        id: request.id,
        input: { reason: 'Part of acme-store', moveEntriesToProjectId: held.id },
      }),
      'moveEntriesToProjectId',
    );
    const { movedEntries } = await projects.declineRequest({
      user: pm,
      id: request.id,
      input: { reason: 'Part of acme-store', moveEntriesToProjectId: store.id },
    });
    expect(movedEntries).toBe(1);
    const entry = await db('reportEntries').where({ id: entryId }).first();
    expect(entry).toMatchObject({ projectId: store.id, projectRequestId: null });
    const row = await db('projectRequests').where({ id: request.id }).first();
    expect(row.status).toBe('declined');
  });

  it('lists the latest decisions, most recent first', async () => {
    const handled = await projects.listHandledRequestsFor(pm2, { limit: 10 });
    expect(handled.map((row) => row.status)).toEqual(
      handled.map((row) => (row.projectId ? 'approved' : 'declined')),
    );
    const times = handled.map((row) => new Date(row.handledAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(await projects.listHandledRequestsFor(priya)).toEqual([]);
    const page = await projects.listRequests({ user: admin, status: 'declined', limit: 1 });
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBeGreaterThanOrEqual(3);
  });
});

describe('listActiveOptions', () => {
  it('offers every active project by name, past the 100-row page of list()', async () => {
    const base = { clientId: store.clientId, pmId: pm.id, createdBy: pm.id };
    const bulk = Array.from({ length: 105 }, (_, index) => ({
      ...base,
      name: `zz-bulk-${String(index).padStart(3, '0')}`,
    }));
    await db('projects').insert(bulk);
    // Created last (highest id) but first by name: list() sorted by id would never reach it.
    await db('projects').insert({ ...base, name: 'aaa-newest' });
    await db('projects').insert({ ...base, name: 'aab-paused', status: 'on_hold' });
    await db('projects').insert({ ...base, name: 'aac-finished', status: 'completed' });

    const options = await projects.listActiveOptions();
    const active = await db('projects').where({ status: 'active' }).count({ total: '*' }).first();
    expect(options).toHaveLength(Number(active.total));
    expect(options.length).toBeGreaterThan(100);
    expect(options[0]).toEqual({ id: expect.any(Number), name: 'aaa-newest' });
    const names = options.map((option) => option.name);
    expect(names).toContain('acme-store');
    expect(names).toContain('zz-bulk-104');
    expect(names).not.toContain('aab-paused');
    expect(names).not.toContain('aac-finished');
    expect([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))).toEqual(
      names,
    );
  });
});
