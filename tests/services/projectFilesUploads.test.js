// Uploads (CONTRACT 27, Uploads): Start, pieces, Finish and Cancel through the service and the
// routes. Small pieces (64 KiB, setPieceBytesForTests), the test files folder under the system
// temp folder, the app clock pinned. Disk errors are faked by wrapping disk.js, never by filling
// a disk.
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';
import {
  TEST_PIECE_BYTES as PIECE,
  createTask,
  emptyFilesDir,
  expectCode,
  fileRow,
  heldUpload,
  jpegBytes,
  onDisk,
  partFilePath,
  patternBytes,
  pdfBytes,
  pngBytes,
  projectFile,
  storedFilePath,
  taskFile,
  uploadRow,
} from './projectFilesKit.js';

const disk = vi.hoisted(() => ({}));
vi.mock('@/modules/projectFiles/disk', async (importOriginal) => {
  const real = await importOriginal();
  disk.writeAt = vi.fn(real.writeAt);
  disk.withReader = vi.fn(real.withReader);
  disk.freeBytes = vi.fn(real.freeBytes);
  return { ...real, writeAt: disk.writeAt, withReader: disk.withReader, freeBytes: disk.freeBytes };
});

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
const startRoute = await import('@/app/api/uploads/route.js');
const keyRoute = await import('@/app/api/uploads/[key]/route.js');
const piecesRoute = await import('@/app/api/uploads/[key]/pieces/route.js');
const finishRoute = await import('@/app/api/uploads/[key]/finish/route.js');

const T0 = '2026-11-23T06:00:00Z';
const EXPIRES = new Date('2026-12-30T04:00:00Z');
const MIB = 1_048_576;
const GIB = 1024 * MIB;

let admin;
let pm;
let otherPm;
let member;
let project;

function signInAs(user) {
  sessionUser = user && { ...user, status: user.status ?? 'active', sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

const startInput = (overrides = {}) => ({
  projectId: project.id,
  target: 'project',
  phase: 'design',
  visibility: 'everyone',
  name: 'brief.pdf',
  size: PIECE * 2 + 100,
  ...overrides,
});

const start = (overrides = {}, user = pm) =>
  projectFiles.startUpload({ user, input: startInput(overrides) });

/** A piece request as a browser sends it: multipart, one `piece` part, its Content-Length. */
async function pieceRequest(bytes, { offset = 0, key = 'x', sha, length, stream } = {}) {
  const form = new FormData();
  form.append('piece', new Blob([bytes]), 'blob');
  const encoded = new Response(form);
  const body = Buffer.from(await encoded.arrayBuffer());
  const headers = {
    origin: env.appOrigin,
    'content-type': encoded.headers.get('content-type'),
    'content-length': String(length ?? body.length),
  };
  if (sha) headers['x-piece-sha256'] = sha;
  const url = `${env.appOrigin}/api/uploads/${key}/pieces?offset=${offset}`;
  if (!stream) return new Request(url, { method: 'POST', headers, body });
  // A body that waits for `stream` before it arrives (a slow connection).
  const slow = new ReadableStream({
    async start(controller) {
      await stream;
      controller.enqueue(body);
      controller.close();
    },
  });
  return new Request(url, { method: 'POST', headers, body: slow, duplex: 'half' });
}

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

async function sendPiece(key, offset, bytes, options = {}, user = pm) {
  const request = await pieceRequest(bytes, { offset, key, ...options });
  return projectFiles.receivePiece({ user, key, offset, request });
}

/** Sends every piece of `bytes` from the start. */
async function sendAll(key, bytes) {
  for (let offset = 0; offset < bytes.length; offset += PIECE) {
    await sendPiece(key, offset, bytes.subarray(offset, offset + PIECE));
  }
}

/** A route call; `form` sends multipart, `body` JSON. */
async function call(handler, { method = 'POST', key, body, request, query = '' } = {}) {
  const url = `${env.appOrigin}/api/uploads${key ? `/${key}` : ''}${query}`;
  const made =
    request ??
    new Request(url, {
      method,
      headers: { origin: env.appOrigin, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const response = await handler(made, { params: Promise.resolve({ key }) });
  return { status: response.status, headers: response.headers, json: await response.json() };
}

beforeAll(async () => {
  await resetDatabase();
  admin = await createUser({ name: 'Ada Admin', role: 'admin', tracksAttendance: false });
  pm = await createUser({ name: 'Riya Kapoor', role: 'pm', tracksAttendance: false });
  otherPm = await createUser({ name: 'Omar Other', role: 'pm', tracksAttendance: false });
  member = await createUser({ name: 'Vishal Saini' });
  project = await createProject(pm, { name: 'acme-store' });
  await addMembers(project, [member]);
});

beforeEach(async () => {
  setNowForTests(T0);
  resetRateLimitsForTests();
  await db('projectFiles').delete();
  await db('fileUploads').delete();
  await db('fileSpace').update({ diskFullAt: null });
  await emptyFilesDir();
  await setSettings({ file_max_mb: 500, file_storage_limit_gb: 10 });
  signInAs(pm);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Start, pieces and Finish', () => {
  it('stores a file sent in three pieces at its key, with a file row and an audit row without the name', async () => {
    const bytes = patternBytes(PIECE * 2 + 100);
    const started = await start({ name: 'C:\\fakepath\\Payment brief.pdf' });
    expect(started).toMatchObject({
      pieceSize: PIECE,
      offset: 0,
      name: 'Payment brief.pdf',
      size: bytes.length,
    });
    expect(started.key).toMatch(/^[0-9a-f]{32}$/);
    expect(await onDisk(partFilePath(started.key))).toBe(true);

    expect(await sendPiece(started.key, 0, bytes.subarray(0, PIECE))).toEqual({ offset: PIECE });
    expect(await sendPiece(started.key, PIECE, bytes.subarray(PIECE, PIECE * 2))).toEqual({
      offset: PIECE * 2,
    });
    expect(await sendPiece(started.key, PIECE * 2, bytes.subarray(PIECE * 2))).toEqual({
      offset: bytes.length,
    });

    const { file } = await projectFiles.finishUpload({ user: pm, key: started.key });
    expect(file).toMatchObject({
      projectId: project.id,
      scope: 'project',
      phase: 'design',
      visibility: 'everyone',
      name: 'Payment brief.pdf',
      ext: 'pdf',
      kind: 'pdf',
      sizeBytes: bytes.length,
      isPicture: false,
      thumbUrl: null,
      viewUrl: null,
      downloadUrl: `/api/project-files/${file.id}`,
      createdBy: { id: pm.id, name: 'Riya Kapoor' },
      task: null,
      hasText: false,
      canManage: true,
    });
    const row = await fileRow(file.id);
    expect(row.storageKey).toMatch(/^2026\/11\/[0-9a-f]{32}$/);
    expect(await fsp.readFile(storedFilePath(row.storageKey))).toEqual(bytes);
    expect(await onDisk(partFilePath(started.key))).toBe(false);
    expect(await uploadRow(started.key)).toMatchObject({ status: 'attached', fileId: file.id });

    const audit = await db('auditLogs').where({ action: 'project_file.add', entityId: file.id });
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].after)).toEqual({
      projectId: project.id,
      scope: 'project',
      taskId: null,
      phase: 'design',
      visibility: 'everyone',
      sizeBytes: bytes.length,
      ext: 'pdf',
    });
    expect(audit[0].ip).toBeNull();
    expect(JSON.stringify(audit[0])).not.toContain('brief');
  });

  it('answers Status with the offset and busy while a lease is held', async () => {
    const started = await start();
    await sendPiece(started.key, 0, patternBytes(PIECE));
    expect(await projectFiles.uploadStatus({ user: pm, key: started.key })).toMatchObject({
      key: started.key,
      offset: PIECE,
      size: PIECE * 2 + 100,
      status: 'receiving',
      busy: false,
    });
    await db('fileUploads')
      .where({ uploadKey: started.key })
      .update({ busyUntil: new Date('2026-11-23T06:01:00Z') });
    expect((await projectFiles.uploadStatus({ user: pm, key: started.key })).busy).toBe(true);

    const answer = await call(keyRoute.GET, { method: 'GET', key: started.key });
    expect(answer.status).toBe(200);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(answer.json.data).toMatchObject({ offset: PIECE, busy: true });
  });

  it('refuses a wrong offset (409), a short or long piece (400) and a bad checksum (422) with nothing written', async () => {
    const started = await start();
    const bytes = patternBytes(PIECE * 2 + 100);
    await expectCode(sendPiece(started.key, PIECE, bytes.subarray(0, PIECE)), 'UPLOAD_OFFSET');
    await expectCode(sendPiece(started.key, 0, bytes.subarray(0, PIECE - 1)), 'PIECE_BAD');
    await expectCode(sendPiece(started.key, 0, bytes.subarray(0, PIECE + 1)), 'PIECE_BAD');
    expect((await fsp.stat(partFilePath(started.key))).size).toBe(0);

    const piece = bytes.subarray(0, PIECE);
    const wrong = sha256(Buffer.from('something else'));
    const error = await expectCode(
      sendPiece(started.key, 0, piece, { sha: wrong }),
      'PIECE_CHECKSUM',
    );
    expect(error.status).toBe(422);
    expect((await fsp.stat(partFilePath(started.key))).size).toBe(0);
    expect((await uploadRow(started.key)).receivedBytes).toBe(0);
    expect(await sendPiece(started.key, 0, piece, { sha: sha256(piece) })).toEqual({
      offset: PIECE,
    });
    expect((await uploadRow(started.key)).busyUntil).toBeNull();
  });

  it('asks for the size before reading the body (411, 413)', async () => {
    const started = await start();
    const piece = patternBytes(PIECE);
    const noLength = await pieceRequest(piece, { key: started.key });
    noLength.headers.delete('content-length');
    await expectCode(
      projectFiles.receivePiece({ user: pm, key: started.key, offset: 0, request: noLength }),
      'LENGTH_REQUIRED',
    );
    const huge = await pieceRequest(piece, { key: started.key, length: PIECE + 65_537 });
    await expectCode(
      projectFiles.receivePiece({ user: pm, key: started.key, offset: 0, request: huge }),
      'PAYLOAD_TOO_LARGE',
    );
    expect((await uploadRow(started.key)).busyUntil).toBeNull();
  });

  it('goes back to the last whole piece when the .part was cut short on disk', async () => {
    const started = await start({ size: PIECE * 3 });
    const bytes = patternBytes(PIECE * 3);
    await sendPiece(started.key, 0, bytes.subarray(0, PIECE));
    await sendPiece(started.key, PIECE, bytes.subarray(PIECE, PIECE * 2));
    await fsp.truncate(partFilePath(started.key), PIECE + 10);
    await expectCode(sendPiece(started.key, PIECE * 2, bytes.subarray(PIECE * 2)), 'UPLOAD_OFFSET');
    expect((await projectFiles.uploadStatus({ user: pm, key: started.key })).offset).toBe(PIECE);
    await sendPiece(started.key, PIECE, bytes.subarray(PIECE, PIECE * 2));
    await sendPiece(started.key, PIECE * 2, bytes.subarray(PIECE * 2));
    const { file } = await projectFiles.finishUpload({ user: pm, key: started.key });
    expect(await fsp.readFile(storedFilePath((await fileRow(file.id)).storageKey))).toEqual(bytes);
  });

  it('allows 2 pieces at once; a third gets 429 UPLOAD_BUSY with Retry-After', async () => {
    const uploads = [await start(), await start(), await start()];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const piece = patternBytes(PIECE);
    const slow = await Promise.all(
      uploads.slice(0, 2).map((item) => pieceRequest(piece, { key: item.key, stream: gate })),
    );
    const running = slow.map((request, index) =>
      call(piecesRoute.POST, { key: uploads[index].key, request, query: '?offset=0' }),
    );
    await vi.waitFor(async () => {
      const leased = await db('fileUploads').whereNotNull('busyUntil').count({ n: '*' }).first();
      expect(leased.n).toBe(2);
    });
    const third = await call(piecesRoute.POST, {
      key: uploads[2].key,
      request: await pieceRequest(piece, { key: uploads[2].key }),
      query: '?offset=0',
    });
    expect(third.status).toBe(429);
    expect(third.json.error.code).toBe('UPLOAD_BUSY');
    expect(third.headers.get('retry-after')).toBe('2');
    release();
    for (const answer of await Promise.all(running)) {
      expect(answer).toMatchObject({ status: 200, json: { data: { offset: PIECE } } });
    }
  });

  it('answers 429 with the seconds left when a stopped request left its lease', async () => {
    const started = await start();
    await db('fileUploads')
      .where({ uploadKey: started.key })
      .update({ busyUntil: new Date('2026-11-23T06:01:30Z') });
    const answer = await call(piecesRoute.POST, {
      key: started.key,
      request: await pieceRequest(patternBytes(PIECE), { key: started.key }),
      query: '?offset=0',
    });
    expect(answer.status).toBe(429);
    expect(answer.headers.get('retry-after')).toBe('90');
    await db('fileUploads')
      .where({ uploadKey: started.key })
      .update({ busyUntil: new Date('2026-11-23T07:00:00Z') });
    const capped = await call(piecesRoute.POST, {
      key: started.key,
      request: await pieceRequest(patternBytes(PIECE), { key: started.key }),
      query: '?offset=0',
    });
    expect(capped.headers.get('retry-after')).toBe('120');
    // Once the lease is over, the piece goes in.
    setNowForTests('2026-11-23T07:00:01Z');
    expect(await sendPiece(started.key, 0, patternBytes(PIECE))).toEqual({ offset: PIECE });
  });

  it("answers 404 for another person's key and a malformed key, 410 once it expired", async () => {
    const started = await start();
    await expectCode(sendPiece(started.key, 0, patternBytes(PIECE), {}, otherPm), 'NOT_FOUND');
    await expectCode(projectFiles.uploadStatus({ user: member, key: started.key }), 'NOT_FOUND');
    await expectCode(projectFiles.uploadStatus({ user: pm, key: '../../etc' }), 'NOT_FOUND');
    const answer = await call(keyRoute.GET, { method: 'GET', key: 'ABC' });
    expect(answer).toMatchObject({ status: 404, json: { error: { code: 'NOT_FOUND' } } });

    setNowForTests('2026-11-23T08:00:01Z'); // 2 h and a second after Start
    const gone = await expectCode(sendPiece(started.key, 0, patternBytes(PIECE)), 'UPLOAD_GONE');
    expect(gone.status).toBe(410);
    expect((await uploadRow(started.key)).status).toBe('expired');
  });

  it('refuses Finish before every byte is in (409 UPLOAD_INCOMPLETE)', async () => {
    const started = await start();
    await sendPiece(started.key, 0, patternBytes(PIECE));
    const error = await expectCode(
      projectFiles.finishUpload({ user: pm, key: started.key }),
      'UPLOAD_INCOMPLETE',
    );
    expect(error.status).toBe(409);
  });

  it('answers a second Finish with the same file (project) or the same held upload (task)', async () => {
    const bytes = patternBytes(PIECE + 5);
    const project1 = await start({ size: bytes.length });
    await sendAll(project1.key, bytes);
    signInAs(pm);
    const first = await call(finishRoute.POST, { key: project1.key });
    const second = await call(finishRoute.POST, { key: project1.key });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.json.data.file.id).toBe(first.json.data.file.id);
    expect(await db('projectFiles').count({ n: '*' }).first()).toEqual({ n: 1 });

    const task1 = await start({ target: 'task', taskId: null, size: bytes.length, name: 'a.png' });
    await sendAll(task1.key, bytes);
    const held = await call(finishRoute.POST, { key: task1.key });
    const again = await call(finishRoute.POST, { key: task1.key });
    expect(held.status).toBe(200);
    expect(held.json.data.upload).toMatchObject({
      key: task1.key,
      status: 'ready',
      name: 'a.png',
      size: bytes.length,
      ext: 'png',
      isPicture: false,
      expiresAt: '2026-11-24T06:00:00.000Z',
    });
    expect(again).toMatchObject({ status: 200, json: { data: held.json.data } });
    expect(await db('projectFiles').count({ n: '*' }).first()).toEqual({ n: 1 });
  });

  it('answers a repeat Finish with UPLOAD_GONE once the person may no longer see the file', async () => {
    // A former PM keeps their upload keys for 7 days: a repeat Finish must not show the file as
    // it is now (its new name, place, task) when a download of it answers 404.
    const managersOnly = await projectFile({
      user: pm,
      projectId: project.id,
      visibility: 'managers',
      name: 'board-minutes.pdf',
    });
    const forEveryone = await projectFile({ user: pm, projectId: project.id, name: 'brief.pdf' });
    const task = await createTask(project, { assigneeId: member.id, title: 'Draft the plan' });
    const onTask = await taskFile({ user: pm, projectId: project.id, taskId: task.id });
    const keyOf = async (file) =>
      (await db('fileUploads').where({ fileId: file.id }).first()).uploadKey;
    const finishAgain = async (file) => call(finishRoute.POST, { key: await keyOf(file) });

    signInAs(pm);
    expect((await finishAgain(managersOnly)).status).toBe(201);
    await db('projects').where({ id: project.id }).update({ pmId: otherPm.id });
    await db('projectFiles').where({ id: managersOnly.id }).update({ name: 'layoffs-draft.pdf' });
    await db('projectTasks').where({ id: task.id }).update({ title: 'Secret new title' });
    try {
      for (const file of [managersOnly, forEveryone, onTask]) {
        const again = await finishAgain(file);
        expect(again.status).toBe(410);
        expect(again.json.error.code).toBe('UPLOAD_GONE');
        expect(JSON.stringify(again.json)).not.toMatch(/layoffs|Secret|brief|board/);
      }
      // Still on the project as a member: an Everyone file answers as before, the others don't.
      await addMembers(project, [pm]);
      const everyone = await finishAgain(forEveryone);
      expect(everyone.status).toBe(201);
      expect(everyone.json.data.file).toMatchObject({ id: forEveryone.id, canManage: false });
      expect((await finishAgain(managersOnly)).status).toBe(410);
      expect((await finishAgain(onTask)).status).toBe(410);
    } finally {
      await db('projectMembers').where({ projectId: project.id, userId: pm.id }).delete();
      await db('projects').where({ id: project.id }).update({ pmId: pm.id });
    }
  });

  it('keeps a JPEG thumbnail for a picture and ignores it for a PDF or a part that is not a JPEG', async () => {
    const finishWith = async (name, bytes, thumb) => {
      const started = await start({ name, size: bytes.length });
      await sendAll(started.key, bytes);
      return projectFiles.finishUpload({ user: pm, key: started.key, thumb });
    };
    const thumb = new Blob([jpegBytes(400, 300)]);
    const picture = (await finishWith('logo.png', pngBytes(800, 600), thumb)).file;
    expect(picture).toMatchObject({
      isPicture: true,
      width: 800,
      height: 600,
      thumbUrl: `/api/project-files/${picture.id}/thumb`,
      viewUrl: `/api/project-files/${picture.id}/view`,
    });
    const key = (await fileRow(picture.id)).storageKey;
    expect(await fsp.readFile(`${storedFilePath(key)}.t`)).toEqual(jpegBytes(400, 300));

    const pdf = (await finishWith('brief.pdf', pdfBytes(), thumb)).file;
    expect((await fileRow(pdf.id)).hasThumb).toBe(false);
    expect(await onDisk(`${storedFilePath((await fileRow(pdf.id)).storageKey)}.t`)).toBe(false);

    const notJpeg = new Blob([pngBytes(10, 10)]);
    const other = (await finishWith('photo.png', pngBytes(20, 10), notJpeg)).file;
    expect(other).toMatchObject({
      isPicture: true,
      thumbUrl: `/api/project-files/${other.id}/view`,
    });
    expect((await fileRow(other.id)).hasThumb).toBe(false);

    // A text file named .png is not a picture.
    const fake = (
      await finishWith('wrong-bytes.png', Buffer.from('just text, not a picture'), thumb)
    ).file;
    expect(fake).toMatchObject({ isPicture: false, thumbUrl: null, viewUrl: null });
  });

  it('refuses Finish (403) when the person no longer manages the project, with no file row and no disk file', async () => {
    const bytes = patternBytes(100);
    const started = await start({ size: bytes.length });
    await sendAll(started.key, bytes);
    await db('projects').where({ id: project.id }).update({ pmId: otherPm.id });
    try {
      const error = await expectCode(
        projectFiles.finishUpload({ user: pm, key: started.key }),
        'FORBIDDEN',
      );
      expect(error.message).toBe("You can't add files to this project.");
      const row = await uploadRow(started.key);
      expect(row.status).toBe('cancelled');
      expect(await db('projectFiles').count({ n: '*' }).first()).toEqual({ n: 0 });
      expect(await onDisk(storedFilePath(row.storageKey))).toBe(false);
      expect(await onDisk(partFilePath(started.key))).toBe(false);
    } finally {
      await db('projects').where({ id: project.id }).update({ pmId: pm.id });
    }
  });

  it('cleans a crash after the rename, and a Finish again carries on from the moved file', async () => {
    const bytes = pngBytes(30, 20);
    const first = await start({ name: 'logo.png', size: bytes.length });
    await sendAll(first.key, bytes);
    disk.withReader.mockRejectedValueOnce(new Error('the process stopped'));
    await expect(projectFiles.finishUpload({ user: pm, key: first.key })).rejects.toThrow(
      'the process stopped',
    );
    const crashed = await uploadRow(first.key);
    expect(crashed).toMatchObject({ status: 'receiving', busyUntil: null });
    expect(await onDisk(partFilePath(first.key))).toBe(false);
    expect(await onDisk(storedFilePath(crashed.storageKey))).toBe(true);
    // The browser asks again: the file is already in place, so Finish goes on.
    const { file } = await projectFiles.finishUpload({ user: pm, key: first.key });
    expect((await fileRow(file.id)).storageKey).toBe(crashed.storageKey);

    // Another one that nobody finishes is cleaned once it expires.
    const second = await start({ name: 'logo.png', size: bytes.length });
    await sendAll(second.key, bytes);
    disk.withReader.mockRejectedValueOnce(new Error('the process stopped'));
    await expect(projectFiles.finishUpload({ user: pm, key: second.key })).rejects.toThrow();
    const left = await uploadRow(second.key);
    setNowForTests('2026-11-23T08:30:00Z');
    expect(await projectFiles.cleanUp({ limit: 500, budgetMs: 20_000 })).toBeGreaterThan(0);
    expect(await onDisk(storedFilePath(left.storageKey))).toBe(false);
    expect((await uploadRow(second.key)).status).toBe('expired');
  });
});

describe('Cancel', () => {
  it('deletes the .part of a receiving upload and the file of a held one', async () => {
    const receiving = await start();
    await sendPiece(receiving.key, 0, patternBytes(PIECE));
    expect(await projectFiles.cancelUpload({ user: pm, key: receiving.key })).toEqual({
      cancelled: true,
    });
    expect(await onDisk(partFilePath(receiving.key))).toBe(false);
    expect((await uploadRow(receiving.key)).status).toBe('cancelled');
    await expectCode(sendPiece(receiving.key, PIECE, patternBytes(PIECE)), 'UPLOAD_GONE');

    const { key } = await heldUpload({ user: pm, projectId: project.id });
    const held = await uploadRow(key);
    expect(await onDisk(storedFilePath(held.storageKey))).toBe(true);
    const answer = await call(keyRoute.DELETE, { method: 'DELETE', key });
    expect(answer).toMatchObject({ status: 200, json: { data: { cancelled: true } } });
    expect(await onDisk(storedFilePath(held.storageKey))).toBe(false);
    // Twice is fine; someone else's is 404.
    expect(await projectFiles.cancelUpload({ user: pm, key })).toEqual({ cancelled: true });
    await expectCode(projectFiles.cancelUpload({ user: otherPm, key }), 'NOT_FOUND');
  });

  it('wins over a running Finish: no file row without its disk file', async () => {
    const bytes = pngBytes(40, 30);
    const started = await start({ name: 'logo.png', size: bytes.length });
    await sendAll(started.key, bytes);
    // The thumbnail is read while the Finish runs; the Cancel arrives just then.
    const thumb = {
      size: 20,
      arrayBuffer: async () => {
        await projectFiles.cancelUpload({ user: pm, key: started.key });
        return jpegBytes(4, 3, 0).buffer;
      },
    };
    await expectCode(
      projectFiles.finishUpload({ user: pm, key: started.key, thumb }),
      'UPLOAD_GONE',
    );
    const row = await uploadRow(started.key);
    expect(row.status).toBe('cancelled');
    expect(await db('projectFiles').count({ n: '*' }).first()).toEqual({ n: 0 });
    expect(await onDisk(storedFilePath(row.storageKey))).toBe(false);
    expect(await onDisk(`${storedFilePath(row.storageKey)}.t`)).toBe(false);
  });

  it('waits for a task save holding the upload and then answers 409; the file stays', async () => {
    const task = await createTask(project, { assigneeId: member.id });
    const { key } = await heldUpload({ user: pm, projectId: project.id, name: 'brief.pdf' });
    let release;
    let attached;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const saved = new Promise((resolve) => {
      attached = resolve;
    });
    const save = db.transaction(async (trx) => {
      const files = await projectFiles.attachUploads(
        { user: pm, projectId: project.id, taskId: task.id, uploadKeys: [key] },
        trx,
      );
      attached();
      await gate;
      return files;
    });
    await saved;
    const cancel = projectFiles.cancelUpload({ user: pm, key }).then(
      () => null,
      (error) => error,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    const [file] = await save;
    const error = await cancel;
    expect(error).toMatchObject({ code: 'CONFLICT', message: 'This file is already added.' });
    expect(await onDisk(storedFilePath((await fileRow(file.id)).storageKey))).toBe(true);
    expect((await uploadRow(key)).status).toBe('attached');
  });
});

describe("Start's checks", () => {
  it('needs a manager of the project and a task on it', async () => {
    await expectCode(start({}, member), 'FORBIDDEN');
    await expectCode(start({}, otherPm), 'FORBIDDEN');
    await expectCode(start({ projectId: 999_999 }), 'NOT_FOUND');
    const elsewhere = await createProject(pm, { name: 'elsewhere' });
    const task = await createTask(elsewhere);
    const wrongTask = await expectCode(start({ target: 'task', taskId: task.id }), 'NOT_FOUND');
    expect(wrongTask.message).toBe("We couldn't find that task.");
    expect(await start({}, admin)).toMatchObject({ offset: 0 });
  });

  it('refuses a project file without a choice of who sees it (400)', async () => {
    signInAs(pm);
    const input = startInput();
    delete input.visibility;
    const answer = await call(startRoute.POST, { body: input });
    expect(answer.status).toBe(400);
    expect(answer.json.error.fields.visibility).toBe('Pick who can see it.');
    const ok = await call(startRoute.POST, { body: startInput() });
    expect(ok.status).toBe(201);
    expect(ok.json.data).toMatchObject({ pieceSize: PIECE, offset: 0, name: 'brief.pdf' });
  });

  it('refuses a file over the largest file (413) without naming it', async () => {
    await setSettings({ file_max_mb: 1 });
    const error = await expectCode(
      start({ size: MIB + 1, name: 'site-video.mov' }),
      'FILE_TOO_BIG',
    );
    expect(error.status).toBe(413);
    expect(error.message).toBe('This file is 1 MB. Each file can be up to 1 MB.');
    await setSettings({ file_max_mb: 500 });
    const big = await expectCode(start({ size: Math.round(1.2 * GIB) }), 'FILE_TOO_BIG');
    expect(big.message).toBe('This file is 1.2 GB. Each file can be up to 500 MB.');
  });

  it('allows 10 running uploads per person; expired ones do not count', async () => {
    for (let index = 0; index < 10; index += 1) await start({ size: 10 });
    const error = await expectCode(start({ size: 10 }), 'TOO_MANY_UPLOADS');
    expect(error).toMatchObject({ status: 429 });
    await db('fileUploads')
      .where({ createdBy: pm.id })
      .limit(1)
      .update({ expiresAt: new Date('2026-11-23T05:00:00Z') });
    expect(await start({ size: 10 })).toMatchObject({ offset: 0 });
    // Someone else still has their own 10.
    expect(await start({ size: 10 }, admin)).toMatchObject({ offset: 0 });
  });

  it('keeps the storage limit with two Starts at once, and deleted files do not count', async () => {
    await setSettings({ file_storage_limit_gb: 1 });
    const fake = await db('projectFiles').insert({
      projectId: project.id,
      scope: 'project',
      visibility: 'managers',
      name: 'big.zip',
      ext: 'zip',
      sizeBytes: Math.round(0.6 * GIB),
      storageKey: '2026/11/0123456789abcdef0123456789abcdef',
      createdBy: pm.id,
    });
    disk.freeBytes.mockResolvedValue(100 * GIB);
    const size = Math.round(0.3 * GIB);
    const answers = await Promise.allSettled([start({ size }), start({ size }, admin)]);
    const passed = answers.filter((answer) => answer.status === 'fulfilled');
    const refused = answers.filter((answer) => answer.status === 'rejected');
    expect(passed).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].reason).toMatchObject({ code: 'FILES_SPACE_FULL', status: 507 });
    const messages = [
      "There isn't enough space for this file. Ask an Admin to make room.",
      "Daybook's file space is full (921.6 MB of 1 GB). Delete old files or raise the limit in Settings.",
    ];
    expect(messages).toContain(refused[0].reason.message);

    await db('projectFiles').where({ id: fake[0] }).update({ status: 'deleted' });
    expect(await start({ size }, admin)).toMatchObject({ offset: 0 });
    disk.freeBytes.mockReset();
  });

  it('refuses when the disk is nearly full (507) and notes the day', async () => {
    disk.freeBytes.mockResolvedValueOnce(300 * MIB);
    const error = await expectCode(start({ size: 50 * MIB }), 'FILES_DISK_FULL');
    expect(error.message).toBe('The server is out of space for files. Ask an Admin.');
    expect((await db('fileSpace').first()).diskFullAt).toEqual(new Date(T0));
  });

  it('puts the space row back when it is gone (after a reset)', async () => {
    await db('fileSpace').delete();
    expect(await start()).toMatchObject({ offset: 0 });
    expect(await db('fileSpace').count({ n: '*' }).first()).toEqual({ n: 1 });
  });
});

describe('Disk errors while writing a piece', () => {
  for (const [label, failure] of [
    ['ENOSPC', Object.assign(new Error('no space left'), { code: 'ENOSPC' })],
    [
      'a quota (UNKNOWN, -122)',
      Object.assign(new Error('unknown'), { code: 'UNKNOWN', errno: -122 }),
    ],
  ]) {
    it(`stops the upload on ${label}: 507, .part gone, disk_full_at set`, async () => {
      const started = await start();
      disk.writeAt.mockRejectedValueOnce(failure);
      const answer = await call(piecesRoute.POST, {
        key: started.key,
        request: await pieceRequest(patternBytes(PIECE), { key: started.key }),
        query: '?offset=0',
      });
      expect(answer.status).toBe(507);
      expect(answer.json.error).toMatchObject({
        code: 'FILES_DISK_FULL',
        message: 'The server is out of space for files. Ask an Admin.',
      });
      expect(await uploadRow(started.key)).toMatchObject({ status: 'cancelled', busyUntil: null });
      expect(await onDisk(partFilePath(started.key))).toBe(false);
      expect((await db('fileSpace').first()).diskFullAt).toEqual(new Date(T0));
    });
  }

  it('answers UPLOAD_LOST (410) when a host scanner took the .part', async () => {
    const started = await start();
    await fsp.unlink(partFilePath(started.key));
    const error = await expectCode(sendPiece(started.key, 0, patternBytes(PIECE)), 'UPLOAD_LOST');
    expect(error.status).toBe(410);
    expect((await uploadRow(started.key)).status).toBe('cancelled');
  });
});

describe('Files on tasks (attachUploads, removeTaskFiles, deleteFilesOfTask)', () => {
  const attach = (task, uploadKeys, user = pm) =>
    db.transaction((trx) =>
      projectFiles.attachUploads(
        { user, projectId: task.projectId, taskId: task.id, uploadKeys },
        trx,
      ),
    );

  it('turns held uploads into task files with their audit rows; empty lists ask nothing', async () => {
    const task = await createTask(project, { assigneeId: member.id, phase: 'development' });
    const first = await heldUpload({ user: pm, projectId: project.id, name: 'brief.pdf' });
    const second = await heldUpload({
      user: pm,
      projectId: project.id,
      taskId: task.id,
      name: 'logo.png',
      bytes: pngBytes(120, 90),
    });
    const files = await attach(task, [first.key, second.key, first.key]);
    expect(files.map((file) => file.name)).toEqual(['brief.pdf', 'logo.png']);
    expect(files[1]).toMatchObject({
      scope: 'task',
      taskId: task.id,
      phase: null,
      isPicture: true,
      width: 120,
      task: {
        id: task.id,
        title: 'Fix the login page',
        phase: 'development',
        assigneeId: member.id,
      },
      canManage: true,
    });
    expect(await uploadRow(first.key)).toMatchObject({ status: 'attached', fileId: files[0].id });
    const audit = await db('auditLogs')
      .where({ action: 'project_file.add' })
      .whereIn(
        'entityId',
        files.map((file) => file.id),
      );
    expect(audit).toHaveLength(2);
    expect(JSON.parse(audit[0].after)).toMatchObject({ scope: 'task', taskId: task.id });
    expect(await attach(task, [])).toEqual([]);
    expect(await projectFiles.countActiveForTask(task.id, db)).toBe(2);
  });

  it('refuses the whole save for an upload that is not usable, naming only the person’s own file', async () => {
    const task = await createTask(project);
    const elsewhere = await createProject(pm, { name: 'other-store' });
    const good = await heldUpload({ user: pm, projectId: project.id, name: 'ok.pdf' });
    const theirs = await heldUpload({ user: admin, projectId: project.id, name: 'secret.pdf' });
    const otherProject = await heldUpload({ user: pm, projectId: elsewhere.id, name: 'away.pdf' });
    const expired = await heldUpload({ user: pm, projectId: project.id, name: 'old.pdf' });
    await db('fileUploads')
      .where({ uploadKey: expired.key })
      .update({ expiresAt: new Date('2026-11-23T05:59:00Z') });
    const missing = await heldUpload({ user: pm, projectId: project.id, name: 'gone.pdf' });
    await fsp.unlink(storedFilePath((await uploadRow(missing.key)).storageKey));

    const cases = [
      [theirs.key, "A file couldn't be added. Add it again."],
      ['0'.repeat(32), "A file couldn't be added. Add it again."],
      [otherProject.key, "away.pdf couldn't be added. Add it again."],
      [expired.key, "old.pdf couldn't be added. Add it again."],
      [missing.key, "gone.pdf couldn't be added. Add it again."],
    ];
    for (const [key, message] of cases) {
      const error = await expectCode(attach(task, [good.key, key]), 'VALIDATION_FAILED');
      expect(error.fields).toEqual({ uploadKeys: message });
    }
    expect(await db('projectFiles').where({ taskId: task.id }).count({ n: '*' }).first()).toEqual({
      n: 0,
    });
    expect((await uploadRow(good.key)).status).toBe('ready');
    // An upload held for another task can't go on this one.
    const otherTask = await createTask(project);
    const forOther = await heldUpload({ user: pm, projectId: project.id, taskId: otherTask.id });
    await expectCode(attach(task, [forOther.key]), 'VALIDATION_FAILED');
  });

  it('keeps a task to 20 files (409 TOO_MANY_FILES)', async () => {
    const task = await createTask(project);
    const keys = [];
    for (let index = 0; index < 21; index += 1) {
      keys.push((await heldUpload({ user: pm, projectId: project.id, name: `f${index}.txt` })).key);
    }
    expect(await attach(task, keys.slice(0, 20))).toHaveLength(20);
    const error = await expectCode(attach(task, keys.slice(20)), 'TOO_MANY_FILES');
    expect(error).toMatchObject({ status: 409 });
  });

  it('soft deletes files of a task: an id already deleted is skipped, another task’s refused', async () => {
    const task = await createTask(project);
    const other = await createTask(project);
    const [a, b] = await attach(task, [
      (await heldUpload({ user: pm, projectId: project.id, name: 'a.pdf' })).key,
      (await heldUpload({ user: pm, projectId: project.id, name: 'b.pdf' })).key,
    ]);
    const [c] = await attach(other, [
      (await heldUpload({ user: pm, projectId: project.id, name: 'c.pdf' })).key,
    ]);
    const remove = (taskRow, fileIds) =>
      db.transaction((trx) =>
        projectFiles.removeTaskFiles({ user: pm, taskId: taskRow.id, fileIds }, trx),
      );
    expect((await remove(task, [a.id])).map((file) => file.id)).toEqual([a.id]);
    expect(await fileRow(a.id)).toMatchObject({ status: 'deleted', deletedBy: pm.id });
    expect(await remove(task, [a.id])).toEqual([]);
    const refused = await expectCode(remove(task, [b.id, c.id]), 'VALIDATION_FAILED');
    expect(refused.fields).toEqual({ removeFileIds: "That file isn't on this task any more." });
    expect((await fileRow(b.id)).status).toBe('active');
    expect(
      await db('auditLogs').where({ action: 'project_file.delete', entityId: a.id }),
    ).toHaveLength(1);

    const deleted = await db.transaction((trx) =>
      projectFiles.deleteFilesOfTask({ user: pm, taskId: task.id }, trx),
    );
    expect(deleted).toBe(1);
    expect((await fileRow(b.id)).status).toBe('deleted');
    expect((await fileRow(c.id)).status).toBe('active');
  });

  it('stores a file on an existing task through storeFile', async () => {
    const task = await createTask(project, { assigneeId: member.id });
    const file = await projectFiles.storeFile({
      user: pm,
      projectId: project.id,
      target: 'task',
      taskId: task.id,
      name: 'notes.txt',
      bytes: 'Plain notes.',
    });
    expect(file).toMatchObject({
      scope: 'task',
      taskId: task.id,
      name: 'notes.txt',
      sizeBytes: 12,
    });
    expect(await fsp.readFile(storedFilePath((await fileRow(file.id)).storageKey), 'utf8')).toBe(
      'Plain notes.',
    );
  });
});
