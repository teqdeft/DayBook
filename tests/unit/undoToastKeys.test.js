// The Undo toast from the keyboard (CONTRACT 22; CONTRACT 28, Look and accessibility: focus never
// goes to the page, and is never stuck): Tab and Shift+Tab leave through onLeave, and stay the
// browser's own when onLeave moved nothing (or there is none, as on "Project reopened." and the
// Table's bulk toast); Escape, Close and Undo from the keyboard hand the focus back to where it came
// from, else to the page's main part, when nothing else took it. A mouse is left alone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { el, fakeEvent, installGlobals } from '../helpers/motionFakes';

vi.mock('react', async (original) => ({
  ...(await original()),
  useRef: (initial) => ({ current: initial }),
}));

const { useToastKeys } = await import('@/app/(app)/projects/[id]/UndoToast.jsx');

let page;
let parts;
beforeEach(() => {
  page = installGlobals();
  const undo = el('button');
  const close = el('button');
  const toast = el('div', { children: [undo, close] });
  const ticked = el('input');
  const main = el('main', { attrs: { id: 'main' } });
  const next = el('button');
  page.body.append(main, ticked, next, toast);
  parts = { undo, close, toast, ticked, main, next };
  undo.focus();
});
afterEach(() => vi.unstubAllGlobals());

const active = () => page.doc.activeElement;
/** The toast's handlers, with the focus on Undo, come from the ticked box. */
function useKeys(props = {}) {
  const spies = { onUndo: vi.fn(), onEnd: vi.fn(), ...props };
  const keys = useToastKeys(spies);
  keys.onFocus({ currentTarget: parts.toast, relatedTarget: parts.ticked });
  return { keys, spies };
}
const press = (keys, key) => {
  const event = fakeEvent('keydown', { key, currentTarget: parts.toast });
  keys.onKeyDown(event);
  return event;
};
const click = (target, detail) => ({ currentTarget: target, detail });

describe('Tab on the toast', () => {
  it('leaves through onLeave and is not also moved by the browser', () => {
    const { keys, spies } = useKeys({ onLeave: () => parts.next.focus() });
    expect(press(keys, 'Tab').defaultPrevented).toBe(true);
    expect(active()).toBe(parts.next);
    expect(spies.onEnd).not.toHaveBeenCalled(); // the toast stays for the rest of its time
  });

  it('is never swallowed: the browser moves on when onLeave moved nothing', () => {
    const { keys } = useKeys({ onLeave: () => {} });
    expect(press(keys, 'Tab').defaultPrevented).toBe(false);
    expect(press(useKeys().keys, 'Tab').defaultPrevented).toBe(false); // no onLeave at all
  });
});

describe('a toast that goes from the keyboard', () => {
  it('Escape: onLeave first, and the toast ends', () => {
    const { keys, spies } = useKeys({ onLeave: () => parts.next.focus() });
    expect(press(keys, 'Escape').defaultPrevented).toBe(true);
    expect(active()).toBe(parts.next);
    expect(spies.onEnd).toHaveBeenCalledTimes(1);
  });

  it('Escape with nowhere to go back to: where the focus came from, else the main part', () => {
    press(useKeys({ onLeave: () => {} }).keys, 'Escape');
    expect(active()).toBe(parts.ticked);

    parts.undo.focus();
    const { keys } = useKeys();
    parts.ticked.remove();
    press(keys, 'Escape');
    expect(active()).toBe(parts.main);
    expect(parts.main.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('Close and Undo with Enter hand it back; a focus moved by Undo itself stays', () => {
    const closed = useKeys();
    closed.keys.onCloseClick(click(parts.close, 0));
    expect(active()).toBe(parts.ticked);
    expect(closed.spies.onEnd).toHaveBeenCalledTimes(1);

    parts.undo.focus();
    useKeys().keys.onUndoClick(click(parts.undo, 0));
    expect(active()).toBe(parts.ticked);

    parts.undo.focus();
    useKeys({ onUndo: () => parts.next.focus() }).keys.onUndoClick(click(parts.undo, 0));
    expect(active()).toBe(parts.next);
  });

  it('leaves the focus of a mouse alone', () => {
    const onLeave = vi.fn();
    const { keys, spies } = useKeys({ onLeave });
    keys.onCloseClick(click(parts.close, 1));
    keys.onUndoClick(click(parts.undo, 1));
    expect(onLeave).not.toHaveBeenCalled();
    expect(active()).toBe(parts.undo);
    expect(spies.onUndo).toHaveBeenCalledTimes(1);
    expect(spies.onEnd).toHaveBeenCalledTimes(1);
  });
});
