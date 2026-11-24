// The tab's upload queue (CONTRACT 27, Uploads, Browser side): one queue shared by every uploader
// of the tab, 2 files at a time, Start only when a file leaves Waiting (so a tab never reserves
// space for waiting files), Retry puts a paused file back in line, and a waiting file that is
// cancelled leaves the line without a request. Also the attach store's batches on that queue
// (Task files): one attach call per batch, its toasts, and a paused file in a task window.
import { describe, expect, it } from 'vitest';
import { createUploadQueue, sharedUploadQueue } from '@/components/files/uploadQueue';
import { createUploadSet } from '@/components/files/uploadSet';
import { createAttachStore } from '@/components/files/attachStore';
import { fakeFile, fakeIo, fakeServer, KEY } from './uploadFakes';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A job that runs until the test ends it. */
function job(log, name) {
  let end;
  return {
    name,
    start() {
      log.push(`start ${name}`);
      return new Promise((resolve) => {
        end = () => {
          log.push(`end ${name}`);
          resolve();
        };
      });
    },
    end: () => end(),
  };
}

describe('createUploadQueue', () => {
  it('runs 2 at a time and starts the next only when a place frees', async () => {
    const log = [];
    const queue = createUploadQueue({ concurrency: 2 });
    const [a, b, c] = ['a', 'b', 'c'].map((name) => job(log, name));
    [a, b, c].forEach((one) => queue.add(one));
    expect(log).toEqual(['start a', 'start b']);
    expect(queue.running).toBe(2);
    expect(queue.waiting).toBe(1);
    a.end();
    await tick();
    expect(log).toEqual(['start a', 'start b', 'end a', 'start c']);
  });

  it('a cancelled waiting job leaves the line and never starts', async () => {
    const log = [];
    const queue = createUploadQueue({ concurrency: 1 });
    const [a, b, c] = ['a', 'b', 'c'].map((name) => job(log, name));
    [a, b, c].forEach((one) => queue.add(one));
    expect(queue.remove(b)).toBe(true);
    expect(queue.remove(a)).toBe(false); // running: it ends through its own cancel
    a.end();
    await tick();
    expect(log).toEqual(['start a', 'end a', 'start c']);
  });

  it('Retry adds a job that ended back to the line; a job is never queued twice', async () => {
    const log = [];
    const queue = createUploadQueue({ concurrency: 2 });
    const a = job(log, 'a');
    expect(queue.add(a)).toBe(true);
    expect(queue.add(a)).toBe(false);
    a.end();
    await tick();
    expect(queue.has(a)).toBe(false);
    expect(queue.add(a)).toBe(true);
    expect(log).toEqual(['start a', 'end a', 'start a']);
  });

  it('keeps going when a job throws', async () => {
    const log = [];
    const queue = createUploadQueue({ concurrency: 1 });
    queue.add({
      start() {
        throw new Error('boom');
      },
    });
    const b = job(log, 'b');
    queue.add(b);
    await tick();
    expect(log).toEqual(['start b']);
  });

  it('the tab has one shared queue of 2', () => {
    expect(sharedUploadQueue.running).toBe(0);
    expect(typeof sharedUploadQueue.add).toBe('function');
  });
});

describe('uploaders on one queue', () => {
  it('Start is sent only when a file leaves Waiting, 2 files at a time across uploaders', async () => {
    const holds = [];
    const server = fakeServer({
      pieceSize: 4,
      script: (r) =>
        r.path.includes('/pieces') ? new Promise((resolve) => holds.push(resolve)) : undefined,
    });
    const io = fakeIo(server);
    const queue = createUploadQueue({ concurrency: 2 });
    const preview = { create: () => 'blob:x', revoke: () => {} };
    const settings = { projectId: 5, target: 'task', taskId: null };
    const first = createUploadSet({ settings, io, queue, preview });
    const second = createUploadSet({ settings, io, queue, preview });
    first.add([fakeFile('a.pdf', 4), fakeFile('b.pdf', 4)]);
    second.add([fakeFile('c.pdf', 4)]);
    await tick();
    const starts = () => server.log.filter((r) => r.path === '/api/uploads').length;
    expect(starts()).toBe(2);
    expect(second.getSnapshot().items[0].state).toBe('waiting');
    server.offset = 4; // the fake server has one upload state: a's piece is in
    holds.shift()({ status: 200, text: JSON.stringify({ data: { offset: 4 } }) });
    for (let i = 0; i < 20; i += 1) await tick();
    expect(starts()).toBe(3);
    expect(second.getSnapshot().items[0].state).not.toBe('waiting');
    expect(server.log.some((r) => r.path === `/api/uploads/${KEY}/finish`)).toBe(true);
  });

  it('cancelling a waiting file sends nothing', async () => {
    const server = fakeServer({
      script: (r) => (r.path.includes('/pieces') ? new Promise(() => {}) : undefined),
    });
    const io = fakeIo(server);
    const queue = createUploadQueue({ concurrency: 1 });
    const set = createUploadSet({
      settings: { projectId: 5, target: 'task', taskId: 3 },
      io,
      queue,
      preview: { create: () => '', revoke: () => {} },
    });
    const { ids } = set.add([fakeFile('a.pdf', 4), fakeFile('b.pdf', 4)]);
    await tick();
    const before = server.log.length;
    set.remove(ids[1]);
    await tick();
    expect(server.log.length).toBe(before);
    expect(queue.waiting).toBe(0);
    expect(set.getSnapshot().items.map((item) => item.name)).toEqual(['a.pdf']);
    expect(set.getSnapshot().announcement).toBe('Upload of b.pdf cancelled.');
  });

  it('Retry puts a paused file back in line', async () => {
    let down = true;
    const server = fakeServer({
      script: (r) => (down && r.path.includes('/pieces') ? { network: true } : undefined),
    });
    const queue = createUploadQueue({ concurrency: 1 });
    const set = createUploadSet({
      settings: { projectId: 5, target: 'task', taskId: 3 },
      io: fakeIo(server),
      queue,
      preview: { create: () => '', revoke: () => {} },
    });
    const { ids } = set.add([fakeFile('a.pdf', 4)]);
    for (let i = 0; i < 40; i += 1) await tick();
    expect(set.getSnapshot().items[0]).toMatchObject({
      state: 'paused',
      message: "Couldn't upload a.pdf. Check your connection, then press Retry.",
    });
    down = false;
    set.retry(ids[0]);
    expect(set.getSnapshot().items[0].state).toBe('uploading'); // a place was free at once
    for (let i = 0; i < 20; i += 1) await tick();
    expect(set.getSnapshot().items[0].state).toBe('done');
    expect(set.getSnapshot().items[0].key).toBe(KEY);
  });
});

describe('the attach store (files on a saved task)', () => {
  const settle = async () => {
    for (let i = 0; i < 60; i += 1) await tick();
  };

  function store(server, more = {}) {
    const toasts = [];
    const refreshed = [];
    const attachStore = createAttachStore({
      settings: { projectId: 5 },
      notify: (toast) => toasts.push(toast),
      refresh: (taskId) => refreshed.push(taskId),
      io: fakeIo(server),
      queue: createUploadQueue({ concurrency: 2 }),
      preview: { create: () => '', revoke: () => {} },
      ...more,
    });
    return { attachStore, toasts, refreshed };
  }

  it('one batch, one attach call, its own toast and a refresh; no Undo', async () => {
    const server = fakeServer({ pieceSize: 4 });
    const { attachStore, toasts, refreshed } = store(server);
    attachStore.add(8, [fakeFile('a.pdf', 4)], { title: 'Checkout fix before client demo' });
    expect(attachStore.batchFor(8)).toMatchObject({ busy: true, count: 1 });
    await settle();
    const calls = server.log.filter((r) => r.path === '/api/project-tasks/8/files');
    expect(calls).toHaveLength(1);
    expect(calls[0].json).toEqual({ uploadKeys: [KEY] });
    expect(toasts).toEqual([
      { title: '1 file added to Checkout fix before client demo.', body: 'Simran Kaur is told.' },
    ]);
    expect(refreshed).toEqual([8]);
    expect(attachStore.batchFor(8)).toBe(null);
  });

  it('a dropped file that fails a check is told at once and never sent', async () => {
    const server = fakeServer({ pieceSize: 4 });
    const { attachStore, toasts } = store(server);
    attachStore.add(8, [fakeFile('notes.txt', 0), fakeFile('b.pdf', 4)], { title: 'Go live' });
    expect(toasts[0]).toEqual({ title: 'notes.txt is empty.', body: undefined, tone: 'error' });
    await settle();
    expect(toasts[1].title).toBe('1 file added to Go live.');
    expect(server.log.filter((r) => r.path === '/api/uploads')).toHaveLength(1);
  });

  it('a paused file holds a task window batch until the window closes, then counts as failed', async () => {
    let down = true;
    const server = fakeServer({
      pieceSize: 4,
      script: (r) => (down && r.path.includes('/pieces') ? { network: true } : undefined),
    });
    const { attachStore, toasts } = store(server);
    const unwatch = attachStore.watch(8);
    attachStore.add(8, [fakeFile('a.pdf', 4)], { title: 'Go live', from: 'window' });
    await settle();
    expect(attachStore.batchFor(8).items[0].state).toBe('paused');
    expect(toasts).toEqual([]);
    unwatch();
    await settle();
    expect(toasts).toEqual([
      {
        title: "Couldn't upload a.pdf. Check your connection, then drop it again.",
        body: undefined,
        tone: 'error',
      },
    ]);
    expect(server.log.at(-1)).toMatchObject({ method: 'DELETE', path: `/api/uploads/${KEY}` });
    down = false;
  });

  it('a refused attach call cancels the held uploads and shows its message', async () => {
    const message = "a.pdf couldn't be added. Add it again.";
    const server = fakeServer({
      pieceSize: 4,
      script: (r) =>
        r.path.endsWith('/files')
          ? {
              status: 400,
              text: JSON.stringify({
                error: { code: 'VALIDATION_FAILED', fields: { uploadKeys: message } },
              }),
            }
          : undefined,
    });
    const { attachStore, toasts, refreshed } = store(server);
    attachStore.add(8, [fakeFile('a.pdf', 4)], { title: 'Go live' });
    await settle();
    expect(toasts).toEqual([{ title: message, tone: 'error' }]);
    expect(refreshed).toEqual([]);
    expect(server.log.at(-1)).toMatchObject({ method: 'DELETE', path: `/api/uploads/${KEY}` });
  });
});
