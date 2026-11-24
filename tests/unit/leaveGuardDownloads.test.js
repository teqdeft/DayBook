// Downloads while files upload (CONTRACT 27, Uploads, Leaving): the leave guard never asks for a
// download. The browser fires `beforeunload` for a plain link before it knows the answer is an
// attachment, so while a guard is up a plain click on a link to /api/ (and the row menu's
// Download) goes through a hidden frame and the page is never left. A frame only shows a page when
// the link failed (a missing file): then the guard's own question comes first, and on yes the
// error shows as the plain page it is; on no the uploads go on. Without a guard nothing changes.
// The browser objects are small fakes (the unit tests run in Node), the real run is in
// tests/e2e/project-files.spec.js.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  holdLeaveGuard,
  isDownloadClick,
  startDownload,
  uploadingLeaveMessage,
} from '@/components/files/leaveGuard.js';

const HERE = 'http://localhost:3000/projects/5?tab=files&place=design';
const FILE = 'http://localhost:3000/api/project-files/14';

class FakeElement {
  constructor(attributes = {}) {
    this.attributes = attributes;
    this.href = attributes.href ?? '';
    this.target = attributes.target ?? '';
  }

  closest(selector) {
    return selector === 'a[href]' && this.href ? this : null;
  }

  hasAttribute(name) {
    return name in this.attributes;
  }
}

class FakeFrame {
  constructor() {
    this.listeners = {};
    this.attributes = {};
    this.removed = false;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  remove() {
    this.removed = true;
  }
}

/** A target with its own listeners: window or document. */
function target(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    listeners,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
}

let win;
let doc;
let frames;
let release = [];
// Each test a minute after the last, so one test's "just asked" never reaches the next.
let clock = Date.UTC(2026, 10, 24, 4, 30);

function hold(count = 2, scope = 'tab') {
  const stop = holdLeaveGuard(uploadingLeaveMessage(count), scope);
  release.push(stop);
  return stop;
}

/** A click on a link, as the capture listener on the document gets it. */
function click(href, more = {}) {
  const event = {
    target: new FakeElement({ href, ...(more.attributes ?? {}) }),
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault: vi.fn(() => {
      event.defaultPrevented = true;
    }),
    stopPropagation: vi.fn(),
    ...more.keys,
  };
  doc.listeners.get('click')?.(event);
  return event;
}

/** The page is about to unload: whether the guard holds it ("Leave site?"). */
function unloadAsks() {
  const event = { preventDefault: vi.fn(), returnValue: undefined };
  win.listeners.get('beforeunload')?.(event);
  return event.preventDefault.mock.calls.length > 0;
}

beforeEach(() => {
  clock += 60_000;
  vi.useFakeTimers({ toFake: ['Date'], now: clock });
  frames = [];
  win = target({
    location: { href: HERE, assign: vi.fn() },
    confirm: vi.fn(() => true),
  });
  doc = target({
    createElement: vi.fn((tag) => {
      expect(tag).toBe('iframe');
      return new FakeFrame();
    }),
    body: { append: vi.fn((frame) => frames.push(frame)) },
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('Element', FakeElement);
});

afterEach(() => {
  release.forEach((stop) => stop());
  release = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a download while files upload', () => {
  it('goes through a hidden frame, so neither the browser nor the guard asks', () => {
    hold();
    const event = click(FILE);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(win.confirm).not.toHaveBeenCalled();
    expect(win.location.assign).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ src: FILE, hidden: true, tabIndex: -1 });
    expect(frames[0].attributes['aria-hidden']).toBe('true');
    // Leaving for real still asks.
    expect(unloadAsks()).toBe(true);
  });

  it('is the same for the row menu Download, which is not a link', () => {
    hold(1, 'page');
    startDownload(FILE);
    expect(frames.map((frame) => frame.src)).toEqual([FILE]);
    expect(win.location.assign).not.toHaveBeenCalled();
  });

  it('asks the guard first when the frame shows a page (the download failed), then shows it', () => {
    hold(2);
    click(FILE);
    frames[0].listeners.load();
    expect(win.confirm).toHaveBeenCalledWith(
      'Leave this page? 2 files are still uploading and will stop.',
    );
    expect(frames[0].removed).toBe(true);
    expect(win.location.assign).toHaveBeenCalledWith(FILE);
    // The guard has asked already: the browser's own "Leave site?" doesn't ask again.
    expect(unloadAsks()).toBe(false);
  });

  it('stays, uploads and all, when the person says no to the failed download', () => {
    hold(1);
    win.confirm.mockReturnValue(false);
    click(FILE);
    frames[0].listeners.load();
    expect(win.confirm).toHaveBeenCalledWith(
      'Leave this page? 1 file is still uploading and will stop.',
    );
    expect(win.location.assign).not.toHaveBeenCalled();
    expect(unloadAsks()).toBe(true);
  });

  it('leaves a new tab, a saved link, a target and other pages to the browser and the guard', () => {
    hold();
    expect(click(FILE, { keys: { ctrlKey: true } }).defaultPrevented).toBe(false);
    expect(click(FILE, { attributes: { download: '' } }).defaultPrevented).toBe(false);
    expect(click(FILE, { attributes: { target: '_blank' } }).defaultPrevented).toBe(false);
    expect(click('https://example.com/api/project-files/14').defaultPrevented).toBe(false);
    expect(frames).toHaveLength(0);
    win.confirm.mockReturnValue(false);
    expect(click('http://localhost:3000/today').defaultPrevented).toBe(true);
    expect(win.confirm).toHaveBeenCalledTimes(1);
  });
});

describe('a download with nothing uploading', () => {
  it('is a plain link: no listener, no frame', () => {
    expect(doc.listeners.size).toBe(0);
    expect(win.listeners.size).toBe(0);
    startDownload(FILE);
    expect(win.location.assign).toHaveBeenCalledWith(FILE);
    expect(frames).toHaveLength(0);
  });

  it('takes the listeners down with the last guard', () => {
    const first = hold();
    const second = hold(1, 'page');
    first();
    expect(doc.listeners.has('click')).toBe(true);
    second();
    first();
    expect(doc.listeners.size).toBe(0);
    expect(win.listeners.size).toBe(0);
    const event = click(FILE);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('isDownloadClick', () => {
  const plain = { button: 0 };
  it("is a plain click on a link to this site's /api/", () => {
    expect(isDownloadClick({ href: FILE }, plain, HERE)).toBe(true);
    expect(isDownloadClick({ href: `${FILE}/view` }, plain, HERE)).toBe(true);
    expect(isDownloadClick({ href: 'http://localhost:3000/projects/5' }, plain, HERE)).toBe(false);
    expect(isDownloadClick({ href: FILE }, { button: 1 }, HERE)).toBe(false);
    expect(isDownloadClick({ href: FILE }, { button: 0, shiftKey: true }, HERE)).toBe(false);
    expect(isDownloadClick({ href: FILE, target: '_self' }, plain, HERE)).toBe(true);
    expect(isDownloadClick({ href: 'not a url' }, plain, 'nor this')).toBe(false);
  });
});
