// The uploader's protocol in the browser (CONTRACT 27, Uploads, Browser side), run against a fake
// server, XHR, fetch and clock (uploadFakes.js): pieces in order with the piece size from Start,
// the waits and their jitter, Status before each try again, a lost answer moving on without
// sending twice, 409 and 422, the codes that stop, the host's own pages, UPLOAD_BUSY and
// TOO_MANY_UPLOADS that never pause, Finish safe to repeat, the attach call, a file that moved,
// offline, Cancel, pagehide's keepalive and the chip preview that is never made for SVG.
import { describe, expect, it } from 'vitest';
import { createFileUpload, cancelOnServer } from '@/components/files/uploadClient';
import { classify, answerOf, RETRY_DELAYS_MS } from '@/components/files/uploadHttp';
import { backoffMs } from '@/components/files/uploadRetry';
import { sendAttach } from '@/components/files/uploadAttach';
import { canPreview, failureText } from '@/components/files/uploadItems';
import { createUploadSet } from '@/components/files/uploadSet';
import { createUploadQueue } from '@/components/files/uploadQueue';
import { fail, fakeFile, fakeIo, fakeServer, json, KEY, trail } from './uploadFakes';

const REQUEST = { projectId: 5, target: 'task', taskId: null };
const html = (status) => ({ status, text: '<html><body>Not allowed</body></html>' });

function upload(server, { size = 10, io = fakeIo(server), file, request = REQUEST } = {}) {
  const phases = [];
  const one = createFileUpload({
    file: file ?? fakeFile('brief.pdf', size),
    request,
    io,
    onChange: (snap) => phases.push(snap.phase),
  });
  return { one, io, phases };
}

const isPiece = (r) => r.path.includes('/pieces');

describe('pieces', () => {
  it('sends the pieces in order with the piece size of the Start answer, then Finish', async () => {
    const server = fakeServer({ pieceSize: 3 });
    const { one } = upload(server, { size: 8 });
    const outcome = await one.run();
    expect(outcome).toEqual({ status: 'done', result: { key: KEY, status: 'ready', size: 8 } });
    expect(trail(server)).toEqual([
      'POST /api/uploads',
      'POST /api/uploads/:key/pieces?offset=0',
      'POST /api/uploads/:key/pieces?offset=3',
      'POST /api/uploads/:key/pieces?offset=6',
      'POST /api/uploads/:key/finish',
    ]);
    expect(server.log[0].json).toMatchObject({
      projectId: 5,
      target: 'task',
      name: 'brief.pdf',
      size: 8,
    });
  });

  it('sends X-Piece-Sha256 when crypto.subtle exists', async () => {
    const server = fakeServer({ pieceSize: 4 });
    const subtle = { digest: async () => new Uint8Array(32).fill(171).buffer };
    const { one, io } = upload(server, { size: 4, io: fakeIo(server, { subtle }) });
    await one.run();
    expect(io.xhrs[0].headers['X-Piece-Sha256']).toBe('ab'.repeat(32));
  });
});

describe('waits', () => {
  it('waits about 1, 2, 4, 8, 16 and 30 s, each within 20%', () => {
    expect(RETRY_DELAYS_MS).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
    RETRY_DELAYS_MS.forEach((base, i) => {
      expect(backoffMs(i + 1, () => 0)).toBe(Math.round(base * 0.8));
      expect(backoffMs(i + 1, () => 0.999999)).toBeLessThanOrEqual(Math.round(base * 1.2));
      expect(backoffMs(i + 1, () => 0.5)).toBe(base);
    });
  });

  it('asks Status before each try again, and pauses after the sixth', async () => {
    const server = fakeServer({ script: (r) => (isPiece(r) ? { network: true } : undefined) });
    const { one, io } = upload(server, { size: 4 });
    expect(await one.run()).toEqual({ status: 'paused' });
    expect(io.waits).toEqual(RETRY_DELAYS_MS);
    const after = trail(server).slice(1);
    expect(after.filter((line) => line.startsWith('POST'))).toHaveLength(7);
    after.forEach((line, i) => {
      if (line.startsWith('POST') && i > 0) expect(after[i - 1]).toBe('GET /api/uploads/:key');
    });
  });

  it('Retry after a pause asks Status and carries on without sending a piece twice', async () => {
    let down = true;
    const server = fakeServer({
      pieceSize: 4,
      script: (r) =>
        down && isPiece(r) && r.path.endsWith('offset=4') ? { network: true } : undefined,
    });
    const { one } = upload(server, { size: 8 });
    expect((await one.run()).status).toBe('paused');
    down = false;
    const before = server.log.length;
    expect((await one.run()).status).toBe('done');
    expect(trail(server).slice(before)).toEqual([
      'GET /api/uploads/:key',
      'POST /api/uploads/:key/pieces?offset=4',
      'POST /api/uploads/:key/finish',
    ]);
  });

  it('a lost answer moves on: the server had the piece, so it is never sent again', async () => {
    const server = fakeServer({ pieceSize: 4 });
    let calls = 0;
    server.script = (r) => {
      if (!isPiece(r)) return undefined;
      calls += 1;
      if (calls !== 2) return undefined;
      server.offset += 4; // the second piece arrives, its answer is lost
      return { network: true };
    };
    const { one } = upload(server, { size: 12 });
    expect((await one.run()).status).toBe('done');
    expect(trail(server)).toEqual([
      'POST /api/uploads',
      'POST /api/uploads/:key/pieces?offset=0',
      'POST /api/uploads/:key/pieces?offset=4',
      'GET /api/uploads/:key',
      'POST /api/uploads/:key/pieces?offset=8',
      'POST /api/uploads/:key/finish',
    ]);
  });

  it('409 UPLOAD_OFFSET asks Status and goes on from the server offset', async () => {
    const server = fakeServer({ pieceSize: 4 });
    let calls = 0;
    server.script = (r) => {
      if (!isPiece(r)) return undefined;
      calls += 1;
      if (calls === 2) {
        server.offset = 8;
        return fail(409, 'UPLOAD_OFFSET');
      }
      return undefined;
    };
    const { one, io } = upload(server, { size: 12 });
    expect((await one.run()).status).toBe('done');
    expect(trail(server).slice(2, 5)).toEqual([
      'POST /api/uploads/:key/pieces?offset=4',
      'GET /api/uploads/:key',
      'POST /api/uploads/:key/pieces?offset=8',
    ]);
    expect(io.waits).toEqual([]);
  });

  it('422 PIECE_CHECKSUM sends the piece again at once, at most 3 times', async () => {
    const server = fakeServer({
      script: (r) => (isPiece(r) ? fail(422, 'PIECE_CHECKSUM') : undefined),
    });
    const { one, io } = upload(server, { size: 4 });
    const outcome = await one.run();
    expect(outcome.status).toBe('error');
    expect(outcome.failure.code).toBe('PIECE_CHECKSUM');
    expect(server.log.filter(isPiece)).toHaveLength(4);
    expect(io.waits).toEqual([]);
  });
});

describe('answers that stop', () => {
  it('401 stops with Retry; 507 stops without it; neither is tried again', async () => {
    for (const [status, code, canRetry] of [
      [401, 'UNAUTHENTICATED', true],
      [507, 'FILES_SPACE_FULL', false],
    ]) {
      const server = fakeServer({ script: (r) => (isPiece(r) ? fail(status, code) : undefined) });
      const { one, io } = upload(server, { size: 4 });
      const outcome = await one.run();
      expect(outcome.status).toBe('error');
      expect(outcome.failure).toMatchObject({ code, status, canRetry });
      expect(server.log.filter(isPiece)).toHaveLength(1);
      expect(io.waits).toEqual([]);
    }
  });

  it("the host's own 413 page stops with the hosting message, with the file's name", async () => {
    const server = fakeServer({ script: (r) => (isPiece(r) ? html(413) : undefined) });
    const { one } = upload(server, { size: 4 });
    const { failure } = await one.run();
    expect(failure.code).toBe('HOST_REFUSED');
    expect(failureText(failure, 'brief.pdf')).toBe(
      'The server refused part of brief.pdf. Ask an Admin to check the hosting limits.',
    );
  });

  it('an HTML 508 is tried again; an HTML 406 stops with the hosting message', async () => {
    let calls = 0;
    const server = fakeServer({
      script: (r) => (isPiece(r) && (calls += 1) === 1 ? html(508) : undefined),
    });
    const { one, io } = upload(server, { size: 4 });
    expect((await one.run()).status).toBe('done');
    expect(io.waits).toEqual([1000]);
    const refused = fakeServer({ script: (r) => (isPiece(r) ? html(406) : undefined) });
    const second = upload(refused, { size: 4 });
    expect((await second.one.run()).failure.code).toBe('HOST_REFUSED');
  });

  it("Daybook's own UPDATE_NEEDED, FILES_UNAVAILABLE and FILES_DISK_FULL are never tried again", () => {
    for (const [status, code] of [
      [503, 'UPDATE_NEEDED'],
      [503, 'FILES_UNAVAILABLE'],
      [507, 'FILES_DISK_FULL'],
    ]) {
      expect(classify(answerOf(status, () => null, JSON.stringify({ error: { code } })))).toBe(
        'stop',
      );
    }
    expect(classify(answerOf(500, () => null, '{"error":{"code":"INTERNAL"}}'))).toBe('connection');
    expect(classify(answerOf(520, () => null, '<html>'))).toBe('connection');
    expect(classify(answerOf(408, () => null, ''))).toBe('connection');
  });

  it('UPLOAD_GONE says "stopped" for a cancelled upload, "left too long" for an expired one', async () => {
    for (const [status, words] of [
      ['cancelled', 'This upload was stopped. Add the file again.'],
      ['expired', 'This upload stopped because it was left too long. Add the file again.'],
    ]) {
      const server = fakeServer({
        script: (r, s) => {
          if (!isPiece(r)) return undefined;
          s.status = status;
          return fail(410, 'UPLOAD_GONE');
        },
      });
      const { one } = upload(server, { size: 4 });
      const { failure } = await one.run();
      expect(failureText(failure, 'brief.pdf')).toBe(words);
    }
  });
});

describe('a busy server never pauses a file', () => {
  it('UPLOAD_BUSY for 150 s, then the piece goes: no try is counted', async () => {
    const server = fakeServer({ pieceSize: 4 });
    const { one, io, phases } = upload(server, { size: 4 });
    server.script = (r, s) => {
      const busy = io.time < 150_000;
      s.busy = busy;
      if (isPiece(r) && busy) return fail(429, 'UPLOAD_BUSY', 'Busy.', { 'Retry-After': '2' });
      return undefined;
    };
    expect((await one.run()).status).toBe('done');
    expect(phases).not.toContain('paused');
    expect(phases).toContain('waiting');
    expect(Math.max(...io.waits)).toBeLessThanOrEqual(10_000);
    expect(io.waits.slice(0, 5)).toEqual([2000, 4000, 6000, 8000, 10000]);
    expect(server.log.filter(isPiece)).toHaveLength(2);
  });

  it('TOO_MANY_UPLOADS keeps the file Waiting and tries Start again every 10 s', async () => {
    let starts = 0;
    const server = fakeServer({
      script: (r) =>
        r.path === '/api/uploads' && (starts += 1) <= 8 ? fail(429, 'TOO_MANY_UPLOADS') : undefined,
    });
    const { one, io, phases } = upload(server, { size: 4 });
    expect((await one.run()).status).toBe('done');
    expect(io.waits).toEqual(Array(8).fill(10_000));
    expect(phases).toContain('waiting');
    expect(phases).not.toContain('paused');
  });
});

describe('Finish, Start and the attach call follow the same rules', () => {
  it('a lost Finish answer: Status, then Finish again gives the same upload', async () => {
    let finishes = 0;
    const server = fakeServer({ pieceSize: 4 });
    server.script = (r, s) => {
      if (!r.path.endsWith('/finish') || (finishes += 1) > 1) return undefined;
      s.status = 'ready';
      return { network: true };
    };
    const { one } = upload(server, { size: 4 });
    const outcome = await one.run();
    expect(outcome.result.key).toBe(KEY);
    expect(trail(server).slice(-3)).toEqual([
      'POST /api/uploads/:key/finish',
      'GET /api/uploads/:key',
      'POST /api/uploads/:key/finish',
    ]);
  });

  it('a lost Start is tried again', async () => {
    let starts = 0;
    const server = fakeServer({
      script: (r) => (r.path === '/api/uploads' && (starts += 1) === 1 ? html(503) : undefined),
    });
    const { one, io } = upload(server, { size: 4 });
    expect((await one.run()).status).toBe('done');
    expect(io.waits).toEqual([1000]);
  });

  it('the attach call is tried again on a 5xx, and a refused key stops it', async () => {
    let calls = 0;
    const server = fakeServer({
      script: (r) => (r.path.endsWith('/files') && (calls += 1) === 1 ? html(502) : undefined),
    });
    const io = fakeIo(server);
    const answer = await sendAttach({ taskId: 12, uploadKeys: [KEY], io });
    expect(answer).toEqual({
      ok: true,
      data: { files: [], told: 'person', toldName: 'Simran Kaur' },
    });
    expect(io.waits).toEqual([1000]);
    const refusing = fakeServer({
      script: (r) =>
        r.path.endsWith('/files')
          ? json(400, {
              error: {
                code: 'VALIDATION_FAILED',
                fields: { uploadKeys: "brief.pdf couldn't be added. Add it again." },
              },
            })
          : undefined,
    });
    const refused = await sendAttach({ taskId: 12, uploadKeys: [KEY], io: fakeIo(refusing) });
    expect(refused.ok).toBe(false);
    expect(refused.failure.fields.uploadKeys).toBe("brief.pdf couldn't be added. Add it again.");
  });
});

describe('the computer and the page', () => {
  it('a file that moved or changed stops with "Couldn\'t read"', async () => {
    const server = fakeServer();
    const subtle = { digest: async () => new ArrayBuffer(32) };
    const file = fakeFile('brief.pdf', 4, { unreadable: true });
    const { one } = upload(server, { file, io: fakeIo(server, { subtle }) });
    const { failure } = await one.run();
    expect(failureText(failure, 'brief.pdf')).toBe(
      "Couldn't read brief.pdf. It may have been moved or changed. Choose it again.",
    );
  });

  it('waits for the online event while the browser is offline', async () => {
    const server = fakeServer();
    const io = fakeIo(server, { online: false });
    const { one } = upload(server, { size: 4, io });
    expect((await one.run()).status).toBe('done');
    expect(io.onlineWaits).toBe(1);
    expect(server.log[0].path).toBe('/api/uploads');
  });

  it('Cancel aborts the running piece first, then cancels on the server', async () => {
    let release;
    const server = fakeServer({
      script: (r) => (isPiece(r) ? new Promise((resolve) => (release = resolve)) : undefined),
    });
    const io = fakeIo(server);
    io.events = [];
    const { one } = upload(server, { size: 4, io });
    const running = one.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const cancelling = one.cancel();
    io.events.push('after abort');
    expect(await cancelling).toBe('cancelled');
    release(json(200, { data: { offset: 4 } }));
    expect((await running).status).toBe('cancelled');
    expect(io.events[0]).toBe('abort');
    expect(server.log.at(-1)).toMatchObject({ method: 'DELETE', path: `/api/uploads/${KEY}` });
  });

  it('a file cancelled while its Start is on its way cancels the key Start gives', async () => {
    let release;
    const server = fakeServer({
      script: (r) =>
        r.path === '/api/uploads' ? new Promise((resolve) => (release = resolve)) : undefined,
    });
    const { one } = upload(server, { size: 4 });
    const running = one.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await one.cancel()).toBe('cancelled');
    release(json(201, { data: { key: KEY, pieceSize: 4, offset: 0 } }));
    expect((await running).status).toBe('cancelled');
    expect(trail(server)).toEqual(['POST /api/uploads', 'DELETE /api/uploads/:key']);
  });

  it('a 409 to Cancel means the file made it', async () => {
    const server = fakeServer({
      script: (r) => (r.method === 'DELETE' ? fail(409, 'CONFLICT') : undefined),
    });
    expect(await cancelOnServer(fakeIo(server), KEY)).toBe('kept');
  });

  it('pagehide cancels every running and held upload with keepalive', async () => {
    const server = fakeServer();
    const io = fakeIo(server);
    const set = createUploadSet({
      settings: { projectId: 5, target: 'task', taskId: null, limits: undefined },
      io,
      queue: createUploadQueue({ concurrency: 2 }),
      preview: { create: () => 'blob:x', revoke: () => {} },
    });
    set.add([fakeFile('brief.pdf', 4)]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(set.getSnapshot().items[0].state).toBe('done');
    set.leave();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const cancel = io.fetches.at(-1);
    expect(cancel).toMatchObject({
      method: 'DELETE',
      path: `/api/uploads/${KEY}`,
      keepalive: true,
    });
  });

  it('never makes a local preview of an SVG, whatever its name says', () => {
    expect(canPreview({ name: 'drawing.svg', type: 'image/svg+xml' })).toBe(false);
    expect(canPreview({ name: 'drawing.png', type: 'image/svg+xml' })).toBe(false);
    expect(canPreview({ name: 'photo.png', type: 'image/png' })).toBe(true);
    const made = [];
    const set = createUploadSet({
      settings: { projectId: 5, target: 'project', visibility: 'everyone', autoStart: false },
      queue: createUploadQueue(),
      preview: { create: (file) => made.push(file.name) && 'blob:x', revoke: () => {} },
    });
    set.add([
      fakeFile('drawing.svg', 10, { type: 'image/svg+xml' }),
      fakeFile('photo.png', 10, { type: 'image/png' }),
    ]);
    expect(made).toEqual(['photo.png']);
  });
});
