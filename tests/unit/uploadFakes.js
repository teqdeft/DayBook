// Fakes for the uploader's unit tests (CONTRACT 27, Tests: "a fake XHR, fetch and clock"): a small
// upload server in memory that answers Start, Status, pieces, Finish, Cancel and the attach call
// as section 27 says, with scripted answers for the cases under test; an `io` whose clock only
// moves when the uploader waits (every wait is recorded); and files whose bytes are made in code.
// No browser, no network, no timers.

export const KEY = 'a'.repeat(32);

/** A Blob-like file of `size` zero bytes; `unreadable` makes every read fail as a moved file. */
export function fakeFile(name, size, { type = '', unreadable = false } = {}) {
  const part = (start, end) => ({
    size: Math.max(0, end - start),
    slice: (a = 0, b = end - start) => part(start + a, start + Math.min(b, end - start)),
    arrayBuffer: async () => {
      if (unreadable) {
        const error = new Error('The file changed');
        error.name = 'NotReadableError';
        throw error;
      }
      return new ArrayBuffer(Math.max(0, end - start));
    },
  });
  return { name, type, lastModified: 0, ...part(0, size), size };
}

const json = (status, body, headers = {}) => ({ status, text: JSON.stringify(body), headers });
const fail = (status, code, message = 'No.', headers = {}) =>
  json(status, { error: { code, message } }, headers);

/**
 * The server. `script(request)` may answer first: return an answer, `{ network: true }`,
 * `{ timeout: true }`, a Promise of one, or undefined for the normal behaviour.
 */
export function fakeServer({ pieceSize = 4, target = 'task', script = () => undefined } = {}) {
  const server = {
    pieceSize,
    offset: 0,
    size: 0,
    status: 'receiving',
    busy: false,
    log: [],
    script,
  };

  function normal(request) {
    const { method, path } = request;
    if (method === 'POST' && path === '/api/uploads') {
      server.size = request.json.size;
      const { name, size } = request.json;
      return json(201, { data: { key: KEY, pieceSize: server.pieceSize, offset: 0, name, size } });
    }
    if (method === 'GET' && path === `/api/uploads/${KEY}`) {
      const { offset, size, status, busy } = server;
      return json(200, { data: { key: KEY, offset, size, status, busy } });
    }
    if (method === 'POST' && path.startsWith(`/api/uploads/${KEY}/pieces`)) {
      const offset = Number(new URL(path, 'http://x').searchParams.get('offset'));
      if (offset !== server.offset) return fail(409, 'UPLOAD_OFFSET');
      server.offset += request.pieceBytes;
      return json(200, { data: { offset: server.offset } });
    }
    if (method === 'POST' && path === `/api/uploads/${KEY}/finish`) {
      if (server.offset < server.size) return fail(409, 'UPLOAD_INCOMPLETE');
      server.status = target === 'task' ? 'ready' : 'attached';
      return target === 'task'
        ? json(200, { data: { upload: { key: KEY, status: 'ready', size: server.size } } })
        : json(201, { data: { file: { id: 9, downloadUrl: '/api/project-files/9' } } });
    }
    if (method === 'DELETE' && path === `/api/uploads/${KEY}`) {
      server.status = 'cancelled';
      return json(200, { data: { cancelled: true } });
    }
    if (method === 'POST' && /^\/api\/project-tasks\/\d+\/files$/.test(path)) {
      return json(201, { data: { files: [], told: 'person', toldName: 'Simran Kaur' } });
    }
    return fail(404, 'NOT_FOUND');
  }

  server.answer = async (request) => {
    server.log.push(request);
    const scripted = await server.script(request, server);
    return scripted ?? normal(request);
  };
  return server;
}

export { fail, json };

/** A FormData stand-in: the parts in order. */
class FakeForm {
  constructor() {
    this.parts = [];
  }
  append(name, value, filename) {
    this.parts.push({ name, value, filename });
  }
}

function headerReader(headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return (name) => lower[name.toLowerCase()] ?? null;
}

/** The io of uploadClient.js over a fake server, with a clock that moves only on waits. */
export function fakeIo(server, { online = true, subtle = null, random = () => 0.5 } = {}) {
  const io = { time: 0, waits: [], fetches: [], xhrs: [], onlineWaits: 0, online };
  io.now = () => io.time;
  io.random = random;
  io.sleep = (ms, signal) => {
    if (signal?.aborted)
      return Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }));
    io.waits.push(ms);
    io.time += ms;
    return Promise.resolve();
  };
  io.isOnline = () => io.online;
  io.waitOnline = () => {
    io.onlineWaits += 1;
    io.online = true;
    return Promise.resolve();
  };
  io.setTimer = () => 0;
  io.clearTimer = () => {};
  io.createForm = () => new FakeForm();
  io.createAbort = () => new AbortController();
  io.subtle = subtle;
  io.thumbs = 0;
  io.makeThumb = async () => {
    io.thumbs += 1;
    return null;
  };
  io.fetch = async (url, options = {}) => {
    const request = {
      method: options.method ?? 'GET',
      path: url,
      json: options.body && typeof options.body === 'string' ? JSON.parse(options.body) : null,
      form: options.body instanceof FakeForm ? options.body : null,
      keepalive: Boolean(options.keepalive),
    };
    io.fetches.push(request);
    const answer = await server.answer(request);
    if (options.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (answer.network || answer.timeout) throw new TypeError('Failed to fetch');
    return {
      status: answer.status,
      headers: { get: headerReader(answer.headers) },
      text: async () => answer.text ?? '',
    };
  };
  io.createXhr = () => {
    const xhr = {
      upload: {},
      headers: {},
      aborted: false,
      open(method, url) {
        Object.assign(xhr, { method, url });
      },
      setRequestHeader(name, value) {
        xhr.headers[name] = value;
      },
      getResponseHeader: () => null,
      abort() {
        xhr.aborted = true;
        io.events?.push('abort');
        xhr.onabort?.();
      },
      async send(form) {
        io.xhrs.push(xhr);
        const piece = form.parts.find((part) => part.name === 'piece')?.value;
        const request = {
          method: 'POST',
          path: xhr.url,
          headers: xhr.headers,
          pieceBytes: piece?.size ?? 0,
        };
        const answer = await server.answer(request);
        if (xhr.aborted) return;
        if (answer.network) return xhr.onerror?.();
        if (answer.timeout) return xhr.ontimeout?.();
        xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 });
        xhr.status = answer.status;
        xhr.responseText = answer.text ?? '';
        xhr.getResponseHeader = headerReader(answer.headers);
        xhr.onload?.();
      },
    };
    return xhr;
  };
  return io;
}

/** The paths the server saw, as "METHOD path" without the key. */
export const trail = (server) =>
  server.log.map((r) => `${r.method} ${r.path.replace(`/${KEY}`, '/:key')}`);
