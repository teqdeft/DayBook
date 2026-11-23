// The preview stack's state (CONTRACT 26 "Timing", "Summary card", "Keyboard and screen readers"):
// the real useStack api (taken from a server render: its logic lives in refs, React state only
// mirrors it) and the real LiveCards buttons, with a small fake document for focus and fake timers.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let stackProps = null;
vi.mock('@/components/live/PreviewStack', () => ({
  default: (props) => {
    stackProps = props;
    return null;
  },
}));
vi.mock('@/components/live/usePreviewActions', () => ({
  usePreviewActions: () => ({ open() {}, markRead() {}, markMany() {}, markAll() {} }),
}));

const { useStack } = await import('@/components/live/useStack');
const { default: LiveCards } = await import('@/components/live/LiveCards');
const { cardLimit, planCards } = await import('@/components/live/liveRules');

const DESKTOP = cardLimit({ width: 1440, height: 900 });
const PHONE = cardLimit({ width: 390, height: 844 });

const item = (id) => ({
  id,
  type: 'report.reminder',
  title: `Notification ${id}`,
  body: null,
  link: '/report',
  readAt: null,
  createdAt: '2026-11-23T08:00:00.000Z',
});

/** A focusable fake element; `focus` records its options. */
function focusable(doc, name, extra = {}) {
  const element = {
    name,
    isConnected: true,
    focusCalls: [],
    ...extra,
    focus(options) {
      element.focusCalls.push(options);
      doc.activeElement = element;
    },
  };
  return element;
}

let doc;
let main;
let idle;

beforeEach(() => {
  vi.useFakeTimers();
  doc = { activeElement: null };
  main = focusable(doc, 'main');
  doc.getElementById = (id) => (id === 'main' ? main : null);
  globalThis.document = doc;
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);
  stackProps = null;
  idle = 0;
});

afterEach(() => {
  delete globalThis.document;
  delete globalThis.requestAnimationFrame;
  vi.useRealTimers();
});

/** The stack and its section, with each card's `<li>` and first button faked. */
function mountStack({ bellButton = () => null } = {}) {
  let out = null;
  function Harness() {
    out = useStack({ now: () => Date.now(), bellButton, onIdle: () => (idle += 1) });
    return null;
  }
  renderToString(createElement(Harness));
  const buttons = new Map();
  out.sectionRef.current = { contains: (element) => Boolean(element?.owner) };
  const stack = out.api;
  const register = () => {
    for (const entry of stack.liveEntries()) {
      if (!buttons.has(entry.key))
        buttons.set(entry.key, focusable(doc, `button of ${entry.key}`, { owner: entry.key }));
      const button = buttons.get(entry.key);
      stack.register(entry.key, {
        contains: (element) => element?.owner === entry.key,
        querySelector: () => button,
      });
    }
  };
  return { stack, buttons, register };
}

/** The provider's flush for one batch (LiveNotifications `present`, the cards branch). */
function flush(stack, ids, maxCards) {
  const plan = planCards({
    stack: stack.liveEntries(),
    batch: { items: ids.map(item) },
    preview: true,
    visible: true,
    bellOpen: false,
    wait: false,
    maxCards,
    now: Date.now(),
  });
  expect(plan.reason).toBe('cards');
  stack.show(plan.added, plan.removed);
}

/** A summary's "See them" through the real LiveCards, on a page without a bell. */
function seeThem(stack, maxCards) {
  const store = { hasBell: () => false, bellButton: () => null, openBell: () => false };
  const entries = stack.liveEntries();
  renderToString(
    createElement(LiveCards, {
      entries,
      hidden: false,
      stack,
      sectionRef: { current: null },
      store,
      tz: 'Asia/Kolkata',
      maxCards: () => maxCards,
    }),
  );
  stackProps.onAction(
    'see',
    entries.find((entry) => entry.kind === 'summary'),
    { button: 0 },
  );
}

const keys = (stack) => stack.liveEntries().map((entry) => entry.key);

describe('See them on a page without a bell', () => {
  it('keeps the pointer’s pause: the new cards stay under the pointer that pressed it', async () => {
    const { stack } = mountStack();
    flush(stack, [2, 3, 4], DESKTOP);
    stack.hold('pointer', true); // the pointer is on the summary
    seeThem(stack, DESKTOP);
    expect(stack.isPaused()).toBe(true);
    expect(idle).toBe(0); // the queue isn't let out in the middle of the swap
    await vi.advanceTimersByTimeAsync(8000);
    expect(keys(stack)).toEqual(['item-4', 'item-3', 'item-2']);
    stack.hold('pointer', false);
    await vi.advanceTimersByTimeAsync(6500);
    expect(stack.count()).toBe(0);
  });

  it('keeps the stack at its limit: 3 on a computer, 2 on a phone', () => {
    for (const limit of [DESKTOP, PHONE]) {
      const { stack } = mountStack();
      flush(stack, [1], limit); // a card still showing
      flush(stack, [2, 3, 4], limit); // a summary on top of it
      seeThem(stack, limit);
      expect(keys(stack)).toEqual(['item-4', 'item-3', 'item-2'].slice(0, limit));
    }
  });

  it('leaves out an item read meanwhile (another tab, the bell)', () => {
    const { stack } = mountStack();
    flush(stack, [1, 2, 3, 4, 5], DESKTOP);
    stack.closeFor([5, 3]);
    expect(stack.liveEntries()[0].kind).toBe('summary'); // not all read: it stays
    seeThem(stack, DESKTOP);
    expect(keys(stack)).toEqual(['item-4', 'item-2', 'item-1']);
  });

  it('sends keyboard focus back where it came from once the new cards are closed', async () => {
    for (const blurOnRemove of [false, true]) {
      const { stack, buttons, register } = mountStack();
      const from = focusable(doc, 'Request an edit');
      flush(stack, [2, 3, 4], DESKTOP);
      register();
      const summary = stack.liveEntries()[0];
      stack.hold('focus', true, from); // Tab from "Request an edit" into the summary
      buttons.get(summary.key).focus();
      seeThem(stack, DESKTOP);
      // Some browsers fire focusout when the focused button is removed (no relatedTarget).
      if (blurOnRemove) stack.hold('focus', false);
      doc.activeElement = null;
      register();
      await vi.advanceTimersByTimeAsync(20); // the top card takes focus on the next frame
      stack.hold('focus', true, null);
      expect(doc.activeElement).toBe(buttons.get('item-4'));
      for (const key of keys(stack)) stack.leave(key); // Escape on each card
      expect(doc.activeElement).toBe(from);
    }
  });
});

describe('focus going back after the last card', () => {
  it('never scrolls the page: the bell, main and the origin are focused with preventScroll', () => {
    const bell = focusable(doc, 'bell');
    for (const [bellButton, origin, target] of [
      [() => bell, null, bell],
      [() => null, null, main],
      [() => bell, focusable(doc, 'a link far up the page'), null],
    ]) {
      const { stack, buttons, register } = mountStack({ bellButton });
      flush(stack, [9], DESKTOP);
      register();
      stack.hold('focus', true, origin); // a click on Dismiss focuses it
      buttons.get('item-9').focus();
      stack.leave('item-9');
      const focused = target ?? origin;
      expect(doc.activeElement).toBe(focused);
      expect(focused.focusCalls.at(-1)).toEqual({ preventScroll: true });
    }
  });
});
