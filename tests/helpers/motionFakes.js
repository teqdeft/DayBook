// Hand-made fakes for the motion tests (CONTRACT 28, Tests: node only, no jsdom): a small DOM
// (elements with attributes, data-*, classes, style, boxes, children, the selectors the motion
// code uses, events with a capture phase, focus), Web Animations (`el.animate` records
// FakeAnimations whose `finished` the test settles), `matchMedia`, frames and timers stepped by
// hand. `installGlobals()` puts the window and document on globalThis for the modules that read
// them (reduce motion, `document.hidden`, the flash's colour token).
import { vi } from 'vitest';

/** One recorded Web Animation: `finish()` resolves `finished`, `cancel()` rejects it. */
export function fakeAnimation(keyframes = [], options = {}) {
  let resolve;
  let reject;
  const finished = new Promise((ok, no) => {
    resolve = ok;
    reject = no;
  });
  finished.catch(() => {});
  const animation = {
    id: options.id ?? '',
    keyframes,
    options,
    playState: 'running',
    finished,
    effect: { getComputedTiming: () => ({ iterations: options.iterations ?? 1 }) },
    finish: vi.fn(() => {
      if (animation.playState !== 'running') return;
      animation.playState = 'finished';
      resolve(animation);
    }),
    cancel: vi.fn(() => {
      if (animation.playState !== 'running') return;
      animation.playState = 'idle';
      reject(new DOMException('cancelled', 'AbortError'));
    }),
  };
  return animation;
}

// ---- selectors: tag, *, .class, [attr], [attr="v"], [attr^="v"], [attr*="v"], descendant, lists
const ATTR = /\[([\w-]+)(?:([\^*]?=)"([^"]*)")?\]/g;

function parseCompound(text) {
  const tag = /^[a-z*][\w-]*/i.exec(text)?.[0] ?? null;
  const classes = [...text.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const attrs = [...text.matchAll(ATTR)].map(([, name, op, value]) => ({ name, op, value }));
  return { tag, classes, attrs };
}

const parsed = new Map();
function parseSelector(selector) {
  if (!parsed.has(selector)) {
    const list = selector.split(',').map((part) => part.trim().split(/\s+/).map(parseCompound));
    parsed.set(selector, list);
  }
  return parsed.get(selector);
}

function attrValue(el, name) {
  if (name === 'style') return el.style.cssText();
  return el.getAttribute(name);
}

function matchesCompound(el, { tag, classes, attrs }) {
  if (!el || el.nodeType !== 1) return false;
  if (tag && tag !== '*' && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
  if (classes.some((name) => !el.classList.contains(name))) return false;
  return attrs.every(({ name, op, value }) => {
    const now = attrValue(el, name);
    if (now === null || now === undefined) return false;
    if (!op) return true;
    if (op === '=') return now === value;
    if (op === '^=') return now.startsWith(value);
    return now.includes(value);
  });
}

function matchesChain(el, chain) {
  if (!matchesCompound(el, chain[chain.length - 1])) return false;
  let index = chain.length - 2;
  let node = el.parentElement;
  while (index >= 0 && node) {
    if (matchesCompound(node, chain[index])) index -= 1;
    node = node.parentElement;
  }
  return index < 0;
}

const matchesSelector = (el, selector) =>
  parseSelector(selector).some((chain) => matchesChain(el, chain));

// ---- style
function fakeStyle() {
  const props = new Map();
  const style = {
    setProperty: (name, value) => props.set(name, String(value)),
    removeProperty: (name) => props.delete(name),
    getPropertyValue: (name) => props.get(name) ?? '',
    cssText: () =>
      [
        ...Object.entries(style)
          .filter(([, v]) => typeof v === 'string' && v)
          .map(([k, v]) => `${k}: ${v}`),
        ...[...props].map(([k, v]) => `${k}: ${v}`),
      ].join('; '),
  };
  return style;
}

// ---- events
function listenerStore() {
  const list = [];
  return {
    add(type, handler, options) {
      const capture = options === true || Boolean(options?.capture);
      const once = Boolean(options?.once);
      if (list.some((l) => l.type === type && l.handler === handler && l.capture === capture))
        return;
      list.push({ type, handler, capture, once });
    },
    remove(type, handler, options) {
      const capture = options === true || Boolean(options?.capture);
      const at = list.findIndex(
        (l) => l.type === type && l.handler === handler && l.capture === capture,
      );
      if (at !== -1) list.splice(at, 1);
    },
    run(target, event, capture) {
      for (const l of [...list]) {
        if (l.type !== event.type || l.capture !== capture || event.stopped) continue;
        if (l.once) this.remove(l.type, l.handler, l.capture);
        event.currentTarget = target;
        l.handler.call(target, event);
      }
    },
    count: (type) => list.filter((l) => l.type === type).length,
  };
}

/** A plain event target (the window, the document). */
export function fakeTarget(extra = {}) {
  const listeners = listenerStore();
  return {
    listeners,
    addEventListener: vi.fn((type, handler, options) => listeners.add(type, handler, options)),
    removeEventListener: vi.fn((type, handler, options) =>
      listeners.remove(type, handler, options),
    ),
    ...extra,
  };
}

/** An event to dispatch: `fire(target, 'pointerdown', { clientX: 10 })`. */
export function fakeEvent(type, init = {}) {
  const event = {
    type,
    bubbles: true,
    defaultPrevented: false,
    stopped: false,
    isPrimary: true,
    button: 0,
    buttons: 1,
    pointerId: 1,
    pointerType: 'mouse',
    clientX: 0,
    clientY: 0,
    repeat: false,
    ...init,
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopPropagation() {
      event.stopped = true;
    },
  };
  return event;
}

// ---- elements
let lastDoc = null;

/**
 * An element. `rect` is its box (change it to move it); `attrs` its attributes.
 * @param {string} tag
 * @param {{ attrs?: Record<string, string>, rect?: object, children?: object[],
 *   doc?: object, text?: string, offsetTop?: number, offsetHeight?: number }} [init]
 */
export function el(tag = 'div', init = {}) {
  const attributes = new Map(Object.entries(init.attrs ?? {}));
  const listeners = listenerStore();
  const classSet = new Set();
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    children: [],
    parentElement: null,
    ownerDocument: init.doc ?? lastDoc,
    style: fakeStyle(),
    rect: { left: 0, top: 0, width: 0, height: 0, ...init.rect },
    animations: [],
    listeners,
    textContent: init.text ?? '',
    offsetTop: init.offsetTop ?? 0,
    offsetHeight: init.offsetHeight ?? init.rect?.height ?? 0,
    scrollLeft: 0,
    scrollTop: 0,
    scrollWidth: 0,
    clientWidth: init.rect?.width ?? 0,
    scrollHeight: 0,
    clientHeight: init.rect?.height ?? 0,
    classList: {
      add: (...names) => names.forEach((name) => classSet.add(name)),
      remove: (...names) => names.forEach((name) => classSet.delete(name)),
      contains: (name) => classSet.has(name),
    },
    get className() {
      return [...classSet].join(' ');
    },
    set className(value) {
      classSet.clear();
      String(value)
        .split(/\s+/)
        .filter(Boolean)
        .forEach((name) => classSet.add(name));
    },
    get dataset() {
      const data = {};
      for (const [name, value] of attributes) {
        if (name.startsWith('data-')) {
          data[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
        }
      }
      return new Proxy(data, {
        set(target, key, value) {
          node.setAttribute(
            `data-${String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
            value,
          );
          target[key] = value;
          return true;
        },
      });
    },
    get isConnected() {
      let at = node;
      while (at.parentElement) at = at.parentElement;
      return Boolean(at.isRoot);
    },
    /** False: drawn nowhere (a hidden column, the hidden table or list). */
    shown: true,
    getClientRects: () => (node.shown && node.isConnected ? [node.rect] : []),
    getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    hasAttribute: (name) => attributes.has(name),
    getBoundingClientRect: vi.fn(() => {
      const r = node.rect;
      return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top };
    }),
    matches: (selector) => matchesSelector(node, selector),
    closest(selector) {
      let at = node;
      while (at && at.nodeType === 1) {
        if (matchesSelector(at, selector)) return at;
        at = at.parentElement;
      }
      return null;
    },
    contains(other) {
      let at = other;
      while (at) {
        if (at === node) return true;
        at = at.parentElement;
      }
      return false;
    },
    querySelectorAll(selector) {
      const found = [];
      const walk = (parent) => {
        for (const child of parent.children) {
          if (matchesSelector(child, selector)) found.push(child);
          walk(child);
        }
      };
      walk(node);
      return found;
    },
    querySelector: (selector) => node.querySelectorAll(selector)[0] ?? null,
    append(...kids) {
      for (const kid of kids) {
        kid.remove?.();
        kid.parentElement = node;
        kid.ownerDocument = node.ownerDocument;
        node.children.push(kid);
      }
    },
    remove() {
      const parent = node.parentElement;
      if (!parent) return;
      parent.children.splice(parent.children.indexOf(node), 1);
      node.parentElement = null;
    },
    cloneNode(deep) {
      const copy = el(tag, { attrs: Object.fromEntries(attributes), rect: { ...node.rect } });
      copy.className = node.className;
      copy.style.transform = node.style.transform ?? '';
      copy.textContent = node.textContent;
      if (deep) for (const kid of node.children) copy.append(kid.cloneNode(true));
      return copy;
    },
    animate: vi.fn((keyframes, options = {}) => {
      const animation = fakeAnimation(keyframes, options);
      node.animations.push(animation);
      return animation;
    }),
    getAnimations: () => node.animations.filter((a) => a.playState === 'running'),
    addEventListener: vi.fn((type, handler, options) => listeners.add(type, handler, options)),
    removeEventListener: vi.fn((type, handler, options) =>
      listeners.remove(type, handler, options),
    ),
    focus: vi.fn(() => {
      if (node.ownerDocument) node.ownerDocument.activeElement = node;
    }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    scrollTo: vi.fn(({ left, top } = {}) => {
      if (left !== undefined) node.scrollLeft = left;
      if (top !== undefined) node.scrollTop = top;
    }),
  };
  for (const kid of init.children ?? []) node.append(kid);
  return node;
}

/**
 * Dispatches an event like a browser: the window's and document's capture listeners, then the
 * capture phase down to the target, its own listeners, the bubble phase up, then the document's
 * and window's bubble listeners.
 */
export function fire(target, type, init = {}, { win, doc } = {}) {
  const event = fakeEvent(type, { target, ...init });
  const path = [];
  for (let at = target; at; at = at.parentElement) path.unshift(at);
  const outer = [win, doc].filter(Boolean);
  for (const t of outer) t.listeners.run(t, event, true);
  for (const at of path) at.listeners?.run(at, event, true);
  for (const at of [...path].reverse()) at.listeners?.run(at, event, false);
  for (const t of [...outer].reverse()) t.listeners.run(t, event, false);
  return event;
}

/** `window.matchMedia` that answers `reduce` for the reduce query and `desktop` for the rest. */
export function fakeMatchMedia({ reduce = false, desktop = true } = {}) {
  const queries = [];
  const matchMedia = vi.fn((query) => {
    const entry = {
      query,
      get matches() {
        return query.includes('reduce') ? matchMedia.reduce : matchMedia.desktop;
      },
      listeners: new Set(),
      addEventListener: (type, fn) => entry.listeners.add(fn),
      removeEventListener: (type, fn) => entry.listeners.delete(fn),
    };
    queries.push(entry);
    return entry;
  });
  matchMedia.reduce = reduce;
  matchMedia.desktop = desktop;
  /** Turns reduce motion on or off and tells every listener. */
  matchMedia.setReduce = (on) => {
    matchMedia.reduce = on;
    for (const entry of queries) entry.listeners.forEach((fn) => fn({ matches: on }));
  };
  return matchMedia;
}

/** Frames stepped by hand: `step(t)` runs every frame waiting, with the time `t`. */
export function fakeFrames() {
  let id = 0;
  const queue = new Map();
  return {
    frame: vi.fn((cb) => {
      id += 1;
      queue.set(id, cb);
      return id;
    }),
    cancelFrame: vi.fn((key) => queue.delete(key)),
    step(time = 0) {
      const now = [...queue.values()];
      queue.clear();
      now.forEach((cb) => cb(time));
    },
    get waiting() {
      return queue.size;
    },
  };
}

/** A document and a window with the bits the motion code reads, put on globalThis. */
export function installGlobals({ reduce = false, desktop = true, soft = '#eef0ff' } = {}) {
  const doc = fakeTarget({ hidden: false, activeElement: null });
  lastDoc = doc;
  const html = el('html', { doc });
  html.isRoot = true;
  const body = el('body', { doc });
  html.append(body);
  Object.assign(doc, {
    documentElement: html,
    body,
    createElement: (tag) => el(tag, { doc }),
    getElementById: (id) => html.querySelector(`[id="${id}"]`),
    querySelector: (selector) => html.querySelector(selector),
    querySelectorAll: (selector) => html.querySelectorAll(selector),
    getSelection: () => ({ removeAllRanges: vi.fn() }),
  });
  const matchMedia = fakeMatchMedia({ reduce, desktop });
  const tokens = { '--primary-soft': soft, '--surface-muted': '#f6f7fb' };
  const computed = (node) => ({
    rowGap: '12px',
    transform: node?.style?.transform || 'none',
    getPropertyValue: (name) => tokens[name] ?? '',
  });
  const win = fakeTarget({
    document: doc,
    matchMedia,
    innerHeight: 900,
    innerWidth: 1440,
    scrollY: 0,
    getComputedStyle: computed,
    scrollBy: vi.fn(),
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('getComputedStyle', computed);
  vi.stubGlobal('innerHeight', 900);
  return { doc, win, html, body, matchMedia, tokens };
}

/** Timers stepped by hand (the `later` of the drag env). */
export function fakeTimers() {
  let id = 0;
  const queue = new Map();
  return {
    later: vi.fn((cb, ms = 0) => {
      id += 1;
      queue.set(id, { cb, ms });
      return id;
    }),
    clear: (key) => queue.delete(key),
    run() {
      const now = [...queue.values()];
      queue.clear();
      now.forEach(({ cb }) => cb());
    },
    get waiting() {
      return queue.size;
    },
  };
}

/** Lets promise callbacks (an animation's `finished`) run; safe with fake timers. */
export async function flushPromises(rounds = 10) {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

const TITLES = {
  1: 'Checkout fix before client demo',
  2: 'Scope signed off',
  3: 'Payment settings page',
  4: 'Error logs',
  5: 'Loose end',
  6: 'Upload the brand guide',
};

/** A card as C3 draws it: the title button, the actions (grip, menu), the tick, a link. */
function fakeCard(task, rect, index) {
  const attrs = { 'data-flip': `card:${task.id}`, id: `task-card-${task.id}` };
  if (task.status !== 'done') attrs['data-open'] = '';
  const card = el('li', { attrs, rect, offsetTop: index * 112, offsetHeight: rect.height });
  const title = el('button', { attrs: { 'data-card-title': '' }, text: task.title });
  const grip = el('button', { attrs: { 'data-grip': '', 'aria-describedby': 'move-help' } });
  const actions = el('div', { attrs: { 'data-card-actions': '' }, children: [grip] });
  const tick = el('label', { children: [el('input', { attrs: { type: 'checkbox' } })] });
  const link = el('a', { attrs: { href: '/files/1' } });
  const face = el('span', { attrs: { 'data-face': '' } });
  const body = el('p', { text: 'Some words' });
  card.append(tick, title, actions, link, face, body);
  if (task.uploading) card.append(el('span', { attrs: { role: 'progressbar' } }));
  return card;
}

/**
 * The board as C1 and C3 render it (CONTRACT 28, Data attributes), on the fake page: the Done
 * phases rail, Development (the current phase: Checkout fix, an uploading card, a done card),
 * Testing (two cards and its "› 1 done" fold) and No phase yet (one card), every column with its
 * list. Boxes are laid out like the 1,440 px board.
 * @param {{ body: object }} page installGlobals()
 */
export function fakeBoard(page) {
  const tasks = [
    { id: 1, title: TITLES[1], phase: 'development', priority: 'p2', status: 'open' },
    {
      id: 6,
      title: TITLES[6],
      phase: 'development',
      priority: 'p3',
      status: 'open',
      uploading: true,
    },
    { id: 2, title: TITLES[2], phase: 'development', priority: 'p2', status: 'done' },
    { id: 3, title: TITLES[3], phase: 'testing', priority: 'p1', status: 'open' },
    { id: 4, title: TITLES[4], phase: 'testing', priority: 'p3', status: 'open' },
    { id: 5, title: TITLES[5], phase: null, priority: 'p2', status: 'open' },
  ];
  const wrap = el('div', { rect: { left: 0, top: 200, width: 1200, height: 700 } });
  const board = el('div', {
    attrs: { 'data-board': '', 'data-flip-scroll': '', id: 'project-board' },
    rect: { left: 0, top: 200, width: 1200, height: 700 },
  });
  board.scrollWidth = 1200;
  wrap.append(board);
  page.body.append(wrap);
  const rail = el('aside', {
    attrs: { 'data-flip': 'rail' },
    rect: { left: 0, top: 200, width: 72, height: 700 },
  });
  rail.append(
    el('span', {
      attrs: { 'data-rail-box': '' },
      rect: { left: 0, top: 200, width: 72, height: 700 },
    }),
    el('span', {
      attrs: { 'data-rail-n': '' },
      text: '2',
      rect: { left: 20, top: 260, width: 20, height: 20 },
    }),
  );
  board.append(rail);
  const columns = {};
  const lists = {};
  const cards = {};
  ['development', 'testing', 'none'].forEach((key, at) => {
    const left = 80 + at * 300;
    const section = el('section', {
      attrs: { 'data-flip': `col:${key}`, 'data-column': key },
      rect: { left, top: 200, width: 280, height: 700 },
    });
    const head = el('h3', { text: key });
    if (key === 'development') head.append(el('span', { attrs: { 'data-current-tag': '' } }));
    const list = el('ul', {
      attrs: { 'data-cards': key },
      rect: { left: left + 10, top: 260, width: 260, height: 400 },
    });
    section.append(head, list);
    const open = tasks.filter((t) => (t.phase ?? 'none') === key && t.status !== 'done');
    open.forEach((task, index) => {
      const card = fakeCard(
        task,
        { left: left + 10, top: 260 + index * 112, width: 260, height: 100 },
        index,
      );
      cards[task.id] = card;
      list.append(card);
    });
    const done = tasks.filter((t) => (t.phase ?? 'none') === key && t.status === 'done');
    for (const task of done) {
      const fold = el('button', {
        attrs: { 'data-follow': '', 'data-flip': `fold:${key}` },
        rect: { left: left + 10, top: 260 + open.length * 112, width: 260, height: 32 },
      });
      const doneList = el('ul', { attrs: { 'data-follow': '', 'data-flip': `done:${key}` } });
      const card = fakeCard(
        task,
        { left: left + 10, top: 300 + open.length * 112, width: 260, height: 100 },
        0,
      );
      cards[task.id] = card;
      doneList.append(card);
      section.append(fold, doneList);
    }
    columns[key] = section;
    lists[key] = list;
    board.append(section);
  });
  const findTask = (id) => tasks.find((task) => task.id === Number(id)) ?? null;
  const columnsOf = () =>
    ['development', 'testing', 'none'].map((key) => ({
      key,
      open: tasks.filter((t) => (t.phase ?? 'none') === key && t.status !== 'done'),
    }));
  return { board, wrap, rail, columns, lists, cards, tasks, findTask, columnsOf };
}
