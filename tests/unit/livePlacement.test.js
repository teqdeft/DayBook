// Where the preview stack sits and what pauses it (CONTRACT 26 "Place, size, layers", "Timing"):
// PreviewStack's `placement` against a fake window and document (a window with a classic 15 px
// scrollbar, as Chrome and Edge show on Windows), and the `<ol>`'s pointer and focus handlers
// against the real useStack api.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { listHandlers, placement } from '@/components/live/PreviewStack';
import { useStack } from '@/components/live/useStack';

/** A window `innerWidth` wide whose scrollbar takes `scrollbar` px, with media queries on it. */
function viewport(innerWidth, { scrollbar = 15, header = { bottom: 87 } } = {}) {
  const query = (text) => {
    const max = Number(/max-width:\s*(\d+)px/.exec(text)?.[1]);
    return { matches: innerWidth <= max }; // a media query counts the scrollbar
  };
  globalThis.window = { innerWidth, matchMedia: query };
  globalThis.document = {
    documentElement: { clientWidth: innerWidth - scrollbar },
    querySelector: (selector) =>
      selector === '#main header' ? { getBoundingClientRect: () => header } : null,
  };
}

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
});

describe('placement without a bell', () => {
  it('is level with the main area’s padding, whatever the scrollbar', () => {
    for (const [width, right] of [
      [1440, 32],
      [1100, 32],
      [1038, 32],
      [1030, 32],
      [1024, 32],
      [1023, 24],
      [900, 24],
      [641, 24],
    ]) {
      viewport(width);
      expect(placement(null), `at ${width}`).toEqual({ top: 95, right });
    }
  });

  it('comes from the top on a phone (the CSS places it)', () => {
    viewport(390, { scrollbar: 0 });
    expect(placement(null)).toBeNull();
  });

  it('matches the bell’s right edge with a bell (clientWidth, so the scrollbar doesn’t count)', () => {
    viewport(1030);
    const bell = { getBoundingClientRect: () => ({ width: 40, right: 983, bottom: 80 }) };
    expect(placement(bell)).toEqual({ top: 88, right: 32 });
  });
});

describe('what pauses the stack', () => {
  function mountStack() {
    let out = null;
    function Harness() {
      out = useStack({ now: () => Date.now(), bellButton: () => null, onIdle: () => {} });
      return null;
    }
    renderToString(createElement(Harness));
    return out.api;
  }

  it('never pauses for a card that appears under a resting mouse (pointerenter alone)', () => {
    const stack = mountStack();
    const handlers = listHandlers(stack);
    expect(handlers.onPointerEnter).toBeUndefined();
    expect(stack.isPaused()).toBe(false);
  });

  it('pauses once the pointer moves or presses on it, until it leaves', () => {
    const stack = mountStack();
    const handlers = listHandlers(stack);
    handlers.onPointerMove({});
    expect(stack.isPaused()).toBe(true);
    handlers.onPointerLeave({});
    expect(stack.isPaused()).toBe(false);
    handlers.onPointerDown({}); // a tap
    expect(stack.isPaused()).toBe(true);
    handlers.onPointerLeave({});
    expect(stack.isPaused()).toBe(false);
  });

  it('pauses while focus is inside it', () => {
    const stack = mountStack();
    const handlers = listHandlers(stack);
    handlers.onFocus({ relatedTarget: null });
    expect(stack.isPaused()).toBe(true);
    handlers.onBlur({ relatedTarget: null });
    expect(stack.isPaused()).toBe(false);
  });
});
