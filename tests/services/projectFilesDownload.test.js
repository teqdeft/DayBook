// Downloads and reads (CONTRACT 27, Who sees and does what and Downloads): every viewer row of the
// permission table through the routes and the reads (lists and counts), the linked rows of
// CONTRACT 28, the download headers,
// `/view` only for magic-checked pictures, `/thumb`, Range, If-Range, If-None-Match, and a missing
// disk file. Files are made through storeFile (projectFilesKit.js) in the test files folder.
import fsp from 'node:fs/promises';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { createUser, resetDatabase } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';
import {
  createTask,
  emptyFilesDir,
  jpegBytes,
  linkFile,
  pdfBytes,
  pngBytes,
  projectFile,
  storedFilePath,
  taskFile,
} from './projectFilesKit.js';

const jar = new Map();
const store = {
  get: (name) => (jar.has(name) ? { name, value: jar.get(name).value } : undefined),
  set: (name, value, options) => jar.set(name, { value, options }),
  delete: ({ name }) => jar.delete(name),
};
let sessionUser = null;
vi.mock('next/headers', () => ({ cookies: async () => store, headers: async () => new Headers() }));
vi.mock('@/modules/auth', () => ({ auth: { resolveSession: async () => sessionUser } }));
vi.mock('@/modules/reports', () => ({ reports: {} }));

const { encodeSessionCookie } = await import('@/lib/session');
const { env } = await import('@/lib/env');
const { resetRateLimitsForTests } = await import('@/lib/route');
const { projectFiles } = await import('@/modules/projectFiles');
const { filesAccess } = await import('@/modules/projectFiles/access');
const fileRoute = await import('@/app/api/project-files/[id]/route.js');
const viewRoute = await import('@/app/api/project-files/[id]/view/route.js');
const thumbRoute = await import('@/app/api/project-files/[id]/thumb/route.js');

const T0 = '2026-11-23T06:00:00Z';
const EXPIRES = new Date('2026-12-30T04:00:00Z');
const NOT_FOUND = "We couldn't find that file.";
const NOT_SHOWN = "This file can't be shown here. Download it instead.";

const people = {};
let project;
let files;
let tasks;

function signInAs(user) {
  sessionUser = user && { ...user, status: user.status ?? 'active', sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

/** GET of a file route as the browser sends it. */
async function get(route, id, headers = {}) {
  const request = new Request(`${env.appOrigin}/api/project-files/${id}`, { headers });
  return route.GET(request, { params: Promise.resolve({ id: String(id) }) });
}

const bytesOf = async (response) => Buffer.from(await response.arrayBuffer());

beforeAll(async () => {
  setNowForTests(T0);
  await resetDatabase();
  await emptyFilesDir();
  const user = (name, role = 'employee') => createUser({ name, role, tracksAttendance: false });
  people.admin = await user('Ada Admin', 'admin');
  people.pm = await user('Riya Kapoor', 'pm');
  people.person = await user('Simran Kaur');
  people.other = await user('Vishal Saini');
  people.hrMember = await user('Neha Kapoor', 'hr');
  people.hrOutside = await user('Hari Outside', 'hr');
  people.otherPm = await user('Omar Other', 'pm');
  people.otherPmMember = await user('Pia Member', 'pm');
  people.takenOff = await user('Tom Taken');
  people.earlier = await user('Esha Earlier');
  people.deactivated = await user('Dev Gone');
  project = await createProject(people.pm, { name: 'acme-store' });
  await addMembers(project, [
    people.person,
    people.other,
    people.hrMember,
    people.otherPmMember,
    people.takenOff,
    people.earlier,
    people.deactivated,
  ]);
  tasks = {
    forPerson: await createTask(project, { assigneeId: people.earlier.id, phase: 'development' }),
    anyone: await createTask(project, { title: 'Write the release notes', phase: 'testing' }),
  };
  const pm = people.pm;
  files = {
    everyone: await projectFile({ user: pm, projectId: project.id, phase: 'design' }),
    managers: await projectFile({
      user: pm,
      projectId: project.id,
      visibility: 'managers',
      name: 'contract.pdf',
    }),
    forPerson: await taskFile({
      user: pm,
      projectId: project.id,
      taskId: tasks.forPerson.id,
      name: 'login-steps.pdf',
    }),
    anyone: await taskFile({
      user: pm,
      projectId: project.id,
      taskId: tasks.anyone.id,
      name: 'notes.txt',
      bytes: Buffer.from('Release notes for the team.\n'),
    }),
  };
  // The task moves from its earlier person to Simran; Tom leaves the project; Dev is deactivated.
  await db('projectTasks')
    .where({ id: tasks.forPerson.id })
    .update({ assigneeId: people.person.id });
  await db('projectMembers').where({ projectId: project.id, userId: people.takenOff.id }).del();
  await db('users').where({ id: people.deactivated.id }).update({ status: 'deactivated' });
  people.deactivated = { ...people.deactivated, status: 'deactivated' };
});

beforeEach(() => {
  setNowForTests(T0);
  resetRateLimitsForTests();
});

afterEach(() => {
  sessionUser = null;
  jar.clear();
});

const Y = true;
const N = false;
// [viewer, Everyone project file, Only PM and Admins file, task file for the person, Anyone task
//  file, filesAccess] as in the CONTRACT 27 table.
const TABLE = [
  ['pm', Y, Y, Y, Y, 'manage'],
  ['admin', Y, Y, Y, Y, 'manage'],
  ['person', Y, N, Y, Y, 'member'],
  ['other', Y, N, N, Y, 'member'],
  ['hrMember', Y, N, N, Y, 'member'],
  ['hrOutside', N, N, N, N, 'none'],
  ['otherPm', N, N, N, N, 'none'],
  ['otherPmMember', Y, N, N, Y, 'member'],
  ['takenOff', N, N, N, N, 'none'],
  ['earlier', Y, N, N, Y, 'member'],
  ['deactivated', N, N, N, N, 'none'],
];
const KINDS = ['everyone', 'managers', 'forPerson', 'anyone'];

describe('the permission table through the download route and the reads', () => {
  for (const [who, ...row] of TABLE) {
    const access = row.pop();
    it(`${who}: downloads, lists and counts only what the table allows`, async () => {
      const viewer = people[who];
      signInAs(viewer);
      for (const [index, kind] of KINDS.entries()) {
        const response = await get(fileRoute, files[kind].id);
        if (row[index]) {
          expect([kind, response.status]).toEqual([kind, 200]);
          await response.arrayBuffer();
        } else {
          expect([kind, response.status]).toEqual([kind, 404]);
          expect((await response.json()).error.message).toBe(NOT_FOUND);
        }
      }
      const allowed = KINDS.filter((kind, index) => row[index]).map((kind) => files[kind].id);
      const list = await projectFiles.listForProject({ viewer, projectId: project.id });
      expect(list.files.map((file) => file.id).sort()).toEqual([...allowed].sort());
      expect(list.canSee).toBe(access !== 'none');
      expect(list.canManage).toBe(access === 'manage');
      const counts = await projectFiles.countsForTasks({
        viewer,
        tasks: [tasks.forPerson, tasks.anyone],
      });
      const expected = {};
      if (row[2]) expected[tasks.forPerson.id] = 1;
      if (row[3]) expected[tasks.anyone.id] = 1;
      expect(counts).toEqual(expected);
      const ctx = await projectFiles.viewerContext({ viewer, project });
      expect(filesAccess(ctx)).toBe(access);
    });
  }

  it('listForTask follows the task rule, from the task row (a move takes effect at once)', async () => {
    const forPerson = { id: tasks.forPerson.id, projectId: project.id };
    const names = async (viewer) =>
      (await projectFiles.listForTask({ viewer, task: forPerson })).map((file) => file.name);
    expect(await names(people.person)).toEqual(['login-steps.pdf']);
    expect(await names(people.earlier)).toEqual([]);
    expect(await names(people.otherPm)).toEqual([]);
    expect(await names(people.pm)).toEqual(['login-steps.pdf']);
    // A caller's stale copy of the task never widens what is shown.
    const stale = { ...forPerson, assigneeId: people.earlier.id };
    expect(await projectFiles.listForTask({ viewer: people.earlier, task: stale })).toEqual([]);
  });

  it('countTaskFilesForMember counts files on their own and Anyone tasks, members only', async () => {
    const counts = (user) =>
      projectFiles.countTaskFilesForMember({ userId: user.id, projectIds: [project.id] });
    expect(await counts(people.person)).toEqual({ [project.id]: 2 });
    expect(await counts(people.other)).toEqual({ [project.id]: 1 });
    expect(await counts(people.takenOff)).toEqual({});
    expect(await counts(people.otherPm)).toEqual({});
    expect(await counts(people.deactivated)).toEqual({});
    expect(
      await projectFiles.countTaskFilesForMember({ userId: people.person.id, projectIds: [] }),
    ).toEqual({});
  });

  it('countsForTasks builds one ctx per project when the tasks span projects (Today)', async () => {
    const second = await createProject(people.otherPm, { name: 'lyra' });
    await addMembers(second, [people.person]);
    const task = await createTask(second, { assigneeId: people.person.id });
    await taskFile({ user: people.otherPm, projectId: second.id, taskId: task.id });
    const all = [tasks.forPerson, tasks.anyone, task];
    expect(await projectFiles.countsForTasks({ viewer: people.person, tasks: all })).toEqual({
      [tasks.forPerson.id]: 1,
      [tasks.anyone.id]: 1,
      [task.id]: 1,
    });
    // Omar manages lyra only: nothing of acme-store, where he isn't on the project.
    expect(await projectFiles.countsForTasks({ viewer: people.otherPm, tasks: all })).toEqual({
      [task.id]: 1,
    });
    expect(await projectFiles.countsForTasks({ viewer: people.person, tasks: [] })).toEqual({});
  });

  it('a PM who is a member sees only the Everyone files and their own and Anyone tasks', async () => {
    const ctx = await projectFiles.viewerContext({ viewer: people.otherPmMember, project });
    expect(ctx).toEqual({
      projectId: project.id,
      userId: people.otherPmMember.id,
      active: true,
      manages: false,
      member: true,
    });
  });

  it('an unknown or malformed id is the same 404', async () => {
    signInAs(people.pm);
    for (const id of ['999999', 'abc', '0', '1.5']) {
      const response = await get(fileRoute, id);
      expect([id, response.status]).toEqual([id, 404]);
      expect((await response.json()).error.message).toBe(NOT_FOUND);
    }
  });

  it('a signed-out person gets 401', async () => {
    const response = await get(fileRoute, files.everyone.id);
    expect(response.status).toBe(401);
  });
});

describe('the download answer', () => {
  it('sends any file as an attachment that can never run as a page', async () => {
    signInAs(people.person);
    const response = await get(fileRoute, files.everyone.id);
    expect(response.status).toBe(200);
    const headers = Object.fromEntries(response.headers);
    expect(headers['content-type']).toBe('application/octet-stream');
    expect(headers['content-disposition']).toBe(
      `attachment; filename="brief.pdf"; filename*=UTF-8''brief.pdf`,
    );
    expect(headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(headers['cache-control']).toBe('private, no-cache, no-transform');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['accept-ranges']).toBe('bytes');
    const createdAt = new Date(files.everyone.createdAt).getTime();
    expect(headers.etag).toBe(`"f${files.everyone.id}-${files.everyone.sizeBytes}-${createdAt}"`);
    const body = await bytesOf(response);
    expect(body.equals(pdfBytes())).toBe(true);
    expect(headers['content-length']).toBe(String(body.length));
  });

  it('answers one Range with 206, out of bounds with 416, and honours If-Range', async () => {
    signInAs(people.pm);
    const size = files.everyone.sizeBytes;
    const etag = (await get(fileRoute, files.everyone.id)).headers.get('etag');
    const part = await get(fileRoute, files.everyone.id, { range: 'bytes=0-9' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 0-9/${size}`);
    expect(part.headers.get('content-length')).toBe('10');
    expect((await bytesOf(part)).equals(pdfBytes().subarray(0, 10))).toBe(true);

    const tail = await get(fileRoute, files.everyone.id, { range: 'bytes=-5' });
    expect(tail.status).toBe(206);
    expect((await bytesOf(tail)).equals(pdfBytes().subarray(size - 5))).toBe(true);

    const beyond = await get(fileRoute, files.everyone.id, { range: `bytes=${size}-` });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get('content-range')).toBe(`bytes */${size}`);

    const several = await get(fileRoute, files.everyone.id, { range: 'bytes=0-1,4-5' });
    expect(several.status).toBe(200);
    expect((await bytesOf(several)).length).toBe(size);

    const changed = await get(fileRoute, files.everyone.id, {
      range: 'bytes=0-9',
      'if-range': '"f1-1-1"',
    });
    expect(changed.status).toBe(200);
    expect((await bytesOf(changed)).length).toBe(size);
    const same = await get(fileRoute, files.everyone.id, { range: 'bytes=0-9', 'if-range': etag });
    expect(same.status).toBe(206);
    await same.arrayBuffer();
  });

  it('answers HEAD (Next runs the GET handler) with the headers and no body', async () => {
    signInAs(people.pm);
    const request = new Request(`${env.appOrigin}/api/project-files/${files.everyone.id}`, {
      method: 'HEAD',
    });
    const response = await fileRoute.GET(request, {
      params: Promise.resolve({ id: String(files.everyone.id) }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(String(files.everyone.sizeBytes));
    expect(response.body).toBeNull();
  });

  it('answers 304 to If-None-Match with the ETag, after the file rule', async () => {
    signInAs(people.pm);
    const etag = (await get(fileRoute, files.managers.id)).headers.get('etag');
    const cached = await get(fileRoute, files.managers.id, { 'if-none-match': etag });
    expect(cached.status).toBe(304);
    expect(cached.headers.get('etag')).toBe(etag);
    expect(await cached.text()).toBe('');
    const other = await get(fileRoute, files.managers.id, { 'if-none-match': '"f0-0-0"' });
    expect(other.status).toBe(200);
    await other.arrayBuffer();
    // A member never learns the ETag of a file they may not see.
    signInAs(people.person);
    const refused = await get(fileRoute, files.managers.id, { 'if-none-match': etag });
    expect(refused.status).toBe(404);
  });

  it('a missing disk file is FILE_MISSING, as plain text when opened as a page', async () => {
    const file = await projectFile({ user: people.pm, projectId: project.id, name: 'gone.pdf' });
    const row = await db('projectFiles').where({ id: file.id }).first();
    await fsp.rm(storedFilePath(row.storageKey));
    signInAs(people.pm);
    const json = await get(fileRoute, file.id);
    expect(json.status).toBe(404);
    expect((await json.json()).error).toMatchObject({
      code: 'FILE_MISSING',
      message: 'This file is missing. Ask your PM to add it again.',
    });
    const page = await get(fileRoute, file.id, { accept: 'text/html,application/xhtml+xml' });
    expect(page.status).toBe(404);
    expect(page.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(page.headers.get('content-security-policy')).toBe('sandbox');
    expect(await page.text()).toBe('This file is missing. Ask your PM to add it again.');
    const unknown = await get(fileRoute, 999999, { accept: 'text/html' });
    expect(await unknown.text()).toBe(NOT_FOUND);
  });
});

// CONTRACT 28: the "Only PM and Admins" file linked to the person's task (Simran's) and to the
// Anyone task, row by row: the person and every member through the Anyone task, never anyone else;
// after the Anyone link goes, only the person (and the earlier person never).
const LINKED = [
  ['pm', Y, Y],
  ['admin', Y, Y],
  ['person', Y, Y],
  ['other', Y, N],
  ['hrMember', Y, N],
  ['hrOutside', N, N],
  ['otherPm', N, N],
  ['otherPmMember', Y, N],
  ['takenOff', N, N],
  ['earlier', Y, N],
  ['deactivated', N, N],
];

describe('the linked rows of the permission table (CONTRACT 28)', () => {
  it('serves a linked "Only PM and Admins" file through the task only, and stops at once', async () => {
    const pm = people.pm;
    const both = { user: pm, project, fileIds: files.managers.id, shareConfirmed: true };
    await linkFile({ ...both, task: tasks.forPerson, shareWith: people.person.id });
    await linkFile({ ...both, task: tasks.anyone, shareWith: '' });
    for (const [who, withAnyone] of LINKED) {
      signInAs(people[who]);
      const response = await get(fileRoute, files.managers.id);
      await response.arrayBuffer();
      expect([who, response.status]).toEqual([who, withAnyone ? 200 : 404]);
    }
    await db.transaction((trx) =>
      projectFiles.unlinkFiles({ user: pm, task: tasks.anyone, fileIds: [files.managers.id] }, trx),
    );
    for (const [who, , onlyPerson] of LINKED) {
      signInAs(people[who]);
      const response = await get(fileRoute, files.managers.id);
      await response.arrayBuffer();
      expect([who, response.status]).toEqual([who, onlyPerson ? 200 : 404]);
    }
    await db.transaction((trx) =>
      projectFiles.unlinkFiles(
        { user: pm, task: tasks.forPerson, fileIds: [files.managers.id] },
        trx,
      ),
    );
    signInAs(people.person);
    expect((await get(fileRoute, files.managers.id)).status).toBe(404);
  });
});

describe('/view and /thumb', () => {
  let picture;
  let withThumb;

  beforeAll(async () => {
    picture = await projectFile({
      user: people.pm,
      projectId: project.id,
      name: 'logo.png',
      bytes: pngBytes(40, 30),
    });
    withThumb = await projectFile({
      user: people.pm,
      projectId: project.id,
      name: 'photo.png',
      bytes: pngBytes(800, 600),
      thumb: jpegBytes(400, 300),
    });
  });

  it('shows a PNG inline with its own type and the picture CSP', async () => {
    signInAs(people.person);
    expect(picture).toMatchObject({
      isPicture: true,
      width: 40,
      height: 30,
      viewUrl: `/api/project-files/${picture.id}/view`,
      thumbUrl: `/api/project-files/${picture.id}/view`,
    });
    const response = await get(viewRoute, picture.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-disposition')).toBe(
      `inline; filename="logo.png"; filename*=UTF-8''logo.png`,
    );
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    );
    expect((await bytesOf(response)).equals(pngBytes(40, 30))).toBe(true);
  });

  it('never shows SVG, HTML or a text file named .png; they only download', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="3"/></svg>',
    );
    const html = Buffer.from('<!doctype html><title>Test</title><p>Test page</p>');
    const made = [
      ['drawing.svg', svg],
      ['page.html', html],
      ['wrong-bytes.png', Buffer.from('just some notes, not a picture\n')],
    ];
    signInAs(people.pm);
    for (const [name, bytes] of made) {
      const file = await projectFile({ user: people.pm, projectId: project.id, name, bytes });
      expect([name, file.isPicture, file.viewUrl, file.thumbUrl]).toEqual([
        name,
        false,
        null,
        null,
      ]);
      const view = await get(viewRoute, file.id);
      expect([name, view.status]).toEqual([name, 404]);
      expect((await view.json()).error.message).toBe(NOT_SHOWN);
      const download = await get(fileRoute, file.id);
      expect(download.headers.get('content-type')).toBe('application/octet-stream');
      expect(download.headers.get('content-disposition')).toMatch(/^attachment; /);
      await download.arrayBuffer();
    }
  });

  it("/view of a file the viewer can't see says only that it wasn't found", async () => {
    const hidden = await projectFile({
      user: people.pm,
      projectId: project.id,
      visibility: 'managers',
      name: 'secret.png',
      bytes: pngBytes(10, 10),
    });
    signInAs(people.person);
    const view = await get(viewRoute, hidden.id);
    expect(view.status).toBe(404);
    expect((await view.json()).error.message).toBe(NOT_FOUND);
    const thumb = await get(thumbRoute, hidden.id);
    expect((await thumb.json()).error.message).toBe(NOT_FOUND);
  });

  it('a renamed PNG still answers image/png (the extension is kept)', async () => {
    const file = await projectFile({
      user: people.pm,
      projectId: project.id,
      name: 'mark.png',
      bytes: pngBytes(12, 12),
    });
    const renamed = await projectFiles.updateFile({
      user: people.pm,
      id: file.id,
      input: { name: 'b.svg' },
    });
    expect(renamed.name).toBe('b.svg.png');
    signInAs(people.pm);
    const view = await get(viewRoute, file.id);
    expect(view.headers.get('content-type')).toBe('image/png');
    expect(view.headers.get('content-disposition')).toContain('filename="b.svg.png"');
    await view.arrayBuffer();
  });

  it('/thumb answers the browser-made JPEG, and 404 without one', async () => {
    expect(withThumb.thumbUrl).toBe(`/api/project-files/${withThumb.id}/thumb`);
    signInAs(people.other);
    const thumb = await get(thumbRoute, withThumb.id);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('content-type')).toBe('image/jpeg');
    expect(thumb.headers.get('content-disposition')).toMatch(/^inline; filename="photo.png"/);
    expect((await bytesOf(thumb)).equals(jpegBytes(400, 300))).toBe(true);
    const none = await get(thumbRoute, picture.id);
    expect(none.status).toBe(404);
    expect((await none.json()).error.message).toBe(NOT_FOUND);
  });
});
