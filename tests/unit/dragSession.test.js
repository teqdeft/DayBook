// The pointer drag and the keyboard move of a card (CONTRACT 28, Motion, Pointer drag; Keyboard
// move and the live region; motion.md 6.2): who may lift, the 6 px start, the lift's marks, the
// targets and their room, the final hit test, the drop, every cancel and lost pointer, the click
// after a drag, a press while one settles, destroy(), a refresh mid-drag, and the keyboard walk.
// The board is the fake of tests/helpers/motionFakes.js; frames and timers are stepped by hand.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fakeBoard,
  fakeEvent,
  fakeFrames,
  fakeTimers,
  fire,
  flushPromises,
  installGlobals,
} from '../helpers/motionFakes';

vi.mock('react-dom', () => ({ flushSync: (fn) => fn() }));

const { createDragController } = await import('@/app/(app)/projects/[id]/_board/dragController');
const { resetAnimateForTests } = await import('@/lib/motion/animate');

let page;
let b;
let frames;
let timers;
let ctx;
let drag;
let clock;

beforeEach(() => {
  page = installGlobals();
  resetAnimateForTests();
  b = fakeBoard(page);
  frames = fakeFrames();
  timers = fakeTimers();
  clock = 0;
  ctx = {
    enabled: true,
    findTask: b.findTask,
    columnsOf: b.columnsOf,
    onDrop: vi.fn(),
    say: vi.fn(),
    askMove: vi.fn(),
    isBusy: (task) => Boolean(task.uploading),
  };
  drag = createDragController({
    board: b.board,
    context: () => ctx,
    env: {
      now: () => clock,
      frame: frames.frame,
      cancelFrame: frames.cancelFrame,
      later: timers.later,
      reduced: () => page.matchMedia.reduce,
      doc: page.doc,
      win: page.win,
      flushSync: (fn) => fn(),
      classes: { preview: 'preview', outline: 'outline', dropOn: 'dropOn', dragging: 'dragging' },
    },
  });
});

afterEach(() => {
  drag.destroy();
  vi.unstubAllGlobals();
});

const send = (target, type, init) => fire(target, type, init, { win: page.win, doc: page.doc });
const preview = () => page.body.children.find((node) => node.hasAttribute('data-drag-preview'));
const inner = () => preview()?.children[0];

/** Presses a card at (x, y) on its body text and moves the pointer by (dx, dy). */
function press(card, { x, y, dx = 10, dy = 0, target, ...init } = {}) {
  const at = { x: x ?? card.rect.left + 40, y: y ?? card.rect.top + 20 };
  const from = target ?? card.children.find((node) => node.tagName === 'P');
  const down = send(from, 'pointerdown', { clientX: at.x, clientY: at.y, ...init });
  send(from, 'pointermove', { clientX: at.x + dx, clientY: at.y + dy, ...init });
  return { down, at };
}

/** Lifts card 1 (Development) and lets the two frames pass. */
function lift(id = 1, options = {}) {
  const started = press(b.cards[id], options);
  frames.step(0);
  frames.step(16);
  return started;
}

/** Moves the pointer so the preview's centre is over `column` and runs a frame. */
function moveOver(column, { y = 400, frameAt = 400 } = {}) {
  const box = b.columns[column].rect;
  const x = box.left + box.width / 2 - 260 / 2 + 40;
  send(b.board, 'pointermove', { clientX: x, clientY: y });
  clock = frameAt;
  frames.step(frameAt);
}

/** Finishes the preview's settle (drop or fly back) and lets the promises run. */
async function settle() {
  for (const animation of preview()?.animations ?? []) animation.finish();
  await flushPromises();
}

describe('who may lift, and when', () => {
  it('a press that moves under 6 px never lifts, and its click goes through', () => {
    const title = b.cards[1].querySelector('[data-card-title]');
    const { down } = press(b.cards[1], { target: title, dx: 3, dy: 3 });
    expect(down.defaultPrevented).toBe(false);
    send(title, 'pointerup', { clientX: 103, clientY: 263 });
    expect(drag.session).toBeNull();
    expect(preview()).toBeUndefined();
    expect(send(title, 'click').defaultPrevented).toBe(false);
  });

  it('lifts after 6 px, never preventing the press itself', () => {
    const { down } = press(b.cards[1], { dx: 6 });
    expect(down.defaultPrevented).toBe(false);
    expect(drag.session?.state).toBe('lifted');
  });

  it.each([
    ['the middle button', { button: 1 }],
    ['the right button', { button: 2 }],
    ['touch', { pointerType: 'touch' }],
    ['a second pointer', { isPrimary: false }],
    ['Shift', { shiftKey: true }],
    ['Ctrl', { ctrlKey: true }],
  ])('never lifts with %s', (_, init) => {
    press(b.cards[1], init);
    expect(drag.session).toBeNull();
  });

  it('never lifts from a link, a field or the tick, nor a done or uploading card', () => {
    press(b.cards[1], { target: b.cards[1].querySelector('a') });
    press(b.cards[1], { target: b.cards[1].querySelector('input') });
    press(b.cards[2]);
    press(b.cards[6]);
    expect(drag.session).toBeNull();
  });

  it('lifts from the grip and from the title (whose click after the drag is stopped)', async () => {
    press(b.cards[3], { target: b.cards[3].querySelector('[data-grip]') });
    expect(drag.session?.state).toBe('lifted');
    drag.session.cancel({ instant: true });
    await flushPromises();
    const title = b.cards[1].querySelector('[data-card-title]');
    press(b.cards[1], { target: title });
    expect(drag.session?.state).toBe('lifted');
    moveOver('testing');
    send(page.win, 'pointerup', { clientX: 470, clientY: 400 });
    expect(send(title, 'click').defaultPrevented).toBe(true);
    timers.run(); // the listener goes after the one click
    expect(send(title, 'click').defaultPrevented).toBe(false);
  });

  it('never lifts for someone who only reads the board, or on a narrow board', () => {
    ctx.enabled = false;
    press(b.cards[1]);
    expect(drag.session).toBeNull();
    ctx.enabled = true;
    b.board.clientWidth = 600;
    press(b.cards[1]);
    expect(drag.session).toBeNull();
  });
});

describe('the lift', () => {
  it('marks the outline, the page and the board, captures the pointer, and lifts two frames later', () => {
    press(b.cards[1]);
    expect(b.cards[1].hasAttribute('data-outline')).toBe(true);
    expect(b.cards[1].classList.contains('outline')).toBe(true);
    expect(page.html.hasAttribute('data-dragging')).toBe(true);
    expect(b.board.hasAttribute('data-dragging')).toBe(true);
    expect(b.board.style.getPropertyValue('--drag-room')).toBe('112px');
    expect(b.board.setPointerCapture).toHaveBeenCalledWith(1);
    expect(preview().getAttribute('inert')).toBe('');
    expect(preview().style.transform).toBe('translate3d(90px, 260px, 0)');
    expect(inner().hasAttribute('data-lifted')).toBe(false);
    frames.step(0);
    expect(inner().hasAttribute('data-lifted')).toBe(false);
    frames.step(16);
    expect(inner().hasAttribute('data-lifted')).toBe(true);
    expect(ctx.say).toHaveBeenCalledWith('Picked up Checkout fix before client demo.');
  });

  it('a throwing setPointerCapture is fine', () => {
    b.board.setPointerCapture.mockImplementation(() => {
      throw new DOMException('gone', 'NotFoundError');
    });
    press(b.cards[1]);
    expect(drag.session?.state).toBe('lifted');
  });

  it('the preview is a clean copy: no ids, no outline, inert', () => {
    lift();
    expect(inner().getAttribute('id')).toBeNull();
    expect(inner().hasAttribute('data-outline')).toBe(false);
    expect(inner().getAttribute('aria-hidden')).toBe('true');
    expect(inner().querySelector('[data-grip]').getAttribute('aria-describedby')).toBeNull();
  });
});

describe('targets', () => {
  it('the column under the preview takes the tint and opens the gap at the sorted place', () => {
    lift();
    moveOver('testing');
    const testing = b.columns.testing;
    expect(testing.getAttribute('data-drop')).toBe('on');
    expect(testing.classList.contains('dropOn')).toBe(true);
    expect(b.lists.testing.hasAttribute('data-room')).toBe(true);
    expect(b.cards[3].style.transform).toBe(''); // P1 stays above the P2 card
    expect(b.cards[4].style.transform).toBe('translateY(112px)');
    expect(ctx.say).toHaveBeenLastCalledWith('Over Testing.');
  });

  it('the items after the list (the fold and its done cards) slide with the room', () => {
    lift(3);
    moveOver('development');
    expect(b.cards[1].style.transform).toBe('translateY(112px)');
    for (const item of b.columns.development.querySelectorAll('[data-follow]')) {
      expect(item.style.transform).toBe('translateY(112px)');
    }
  });

  it('its own column, the rail and No phase yet never react', () => {
    lift();
    moveOver('development');
    expect(b.board.querySelectorAll('[data-drop]')).toEqual([]);
    moveOver('none');
    expect(b.board.querySelectorAll('[data-drop]')).toEqual([]);
    send(b.board, 'pointermove', { clientX: 30, clientY: 400 });
    frames.step(500);
    expect(b.board.querySelectorAll('[data-drop]')).toEqual([]);
  });

  it('leaving a column slides its cards back and drops the tint', () => {
    lift();
    moveOver('testing');
    moveOver('development');
    expect(b.columns.testing.hasAttribute('data-drop')).toBe(false);
    expect(b.cards[4].style.transform).toBe('');
    timers.run();
    expect(b.lists.testing.hasAttribute('data-room')).toBe(false);
  });

  it('a card in No phase yet lifts and every phase column takes it', () => {
    lift(5);
    moveOver('development');
    expect(b.columns.development.getAttribute('data-drop')).toBe('on');
    moveOver('testing');
    expect(b.columns.testing.getAttribute('data-drop')).toBe('on');
  });

  it('reads the columns again after the lift, which stretches the short ones (no data-fill)', () => {
    b.columns.testing.rect.height = 120; // 200 to 320
    press(b.cards[1]);
    b.columns.testing.rect.height = 700; // data-dragging: the columns are one height now
    frames.step(0);
    frames.step(16);
    moveOver('testing', { y: 600 });
    expect(b.columns.testing.getAttribute('data-drop')).toBe('on');
  });

  it('a scroll marks the boxes to be read again on the next frame', () => {
    lift();
    moveOver('testing');
    const reads = b.columns.testing.getBoundingClientRect.mock.calls.length;
    frames.step(420);
    expect(b.columns.testing.getBoundingClientRect.mock.calls.length).toBe(reads);
    send(page.win, 'scroll');
    frames.step(440);
    expect(b.columns.testing.getBoundingClientRect.mock.calls.length).toBe(reads + 1);
  });
});

describe('the drop', () => {
  it('a move and the up together still drop: the last hit test uses the up point', async () => {
    lift();
    send(page.win, 'pointermove', { clientX: 470, clientY: 400 });
    send(page.win, 'pointerup', { clientX: 470, clientY: 400 });
    expect(drag.session.state).toBe('settling');
    await settle();
    expect(ctx.onDrop).toHaveBeenCalledTimes(1);
    expect(ctx.onDrop).toHaveBeenCalledWith(b.findTask(1), 'testing', { mode: 'pointer' });
  });

  it('settles into the gap, commits once, then leaves nothing behind', async () => {
    lift();
    moveOver('testing');
    send(page.win, 'pointerup', { clientX: 470, clientY: 400 });
    const [glide] = preview().animations;
    expect(glide.options.easing).toBe('cubic-bezier(0.2, 1, 0.1, 1)');
    expect(glide.options.duration).toBeGreaterThanOrEqual(250);
    expect(glide.options.duration).toBeLessThanOrEqual(400);
    expect(ctx.onDrop).not.toHaveBeenCalled();
    await settle();
    expect(ctx.onDrop).toHaveBeenCalledTimes(1);
    expect(drag.session).toBeNull();
    expect(page.win.listeners.count('pointermove')).toBe(0);
    expect(preview()).toBeUndefined();
    expect(page.html.hasAttribute('data-dragging')).toBe(false);
    expect(b.board.querySelectorAll('[data-outline], [data-drop], [data-room]')).toEqual([]);
    expect(b.board.querySelectorAll('[style*="translateY"]')).toEqual([]);
    expect(b.cards[1].animations.some((a) => a.id === 'flash')).toBe(true);
    expect(ctx.say).toHaveBeenLastCalledWith(
      'Moved Checkout fix before client demo to Testing from Development.',
    );
  });

  it('a tall card held by its top, let go low in a column (over "+ Add task"), lands there', async () => {
    b.cards[1].rect.height = 400;
    lift(); // 20 px below its top: its centre is 180 px below the pointer
    moveOver('testing', { y: 880 }); // the column ends at 900, the centre is at 1,060
    expect(b.columns.testing.getAttribute('data-drop')).toBe('on');
    expect(ctx.say).toHaveBeenLastCalledWith('Over Testing.');
    moveOver('testing', { y: 905, frameAt: 420 });
    expect(b.columns.testing.hasAttribute('data-drop')).toBe(false); // the pointer left it too
    // The last hit test reads the up event's point the same way.
    send(page.win, 'pointerup', { clientX: 470, clientY: 880 });
    expect(drag.session.state).toBe('settling');
    await settle();
    expect(ctx.onDrop).toHaveBeenCalledTimes(1);
    expect(ctx.onDrop).toHaveBeenCalledWith(b.findTask(1), 'testing', { mode: 'pointer' });
  });

  it.each([
    ['below the board', 'testing', 930],
    ['above the board', 'testing', 10],
    ['low in No phase yet', 'none', 880],
    ['low in its own column', 'development', 880],
  ])('a tall card let go %s flies back', async (_, column, y) => {
    b.cards[1].rect.height = 400;
    lift();
    moveOver(column, { y });
    expect(b.board.querySelectorAll('[data-drop]')).toEqual([]);
    const box = b.columns[column].rect;
    send(page.win, 'pointerup', { clientX: box.left + box.width / 2 - 90, clientY: y });
    await settle();
    expect(ctx.onDrop).not.toHaveBeenCalled();
    expect(drag.session).toBeNull();
  });

  it('a drop where it can not go flies back', async () => {
    lift();
    moveOver('none');
    send(page.win, 'pointerup', { clientX: 700, clientY: 400 });
    const [back] = preview().animations;
    expect(back.options.duration).toBeGreaterThanOrEqual(150);
    expect(back.options.duration).toBeLessThanOrEqual(240);
    await settle();
    expect(ctx.onDrop).not.toHaveBeenCalled();
    expect(drag.session).toBeNull();
    expect(ctx.say).toHaveBeenLastCalledWith(
      'Move cancelled. Checkout fix before client demo is back in Development.',
    );
  });

  it('with reduce motion the drop is at once, then the flash', async () => {
    page.matchMedia.reduce = true;
    lift();
    moveOver('testing');
    send(page.win, 'pointerup', { clientX: 470, clientY: 400 });
    await flushPromises();
    expect(ctx.onDrop).toHaveBeenCalledTimes(1);
    expect(b.cards[1].animations.map((a) => a.id)).toEqual(['flash']);
  });
});

describe('cancel and lost pointers', () => {
  it.each([
    ['Escape', () => send(page.doc, 'keydown', { key: 'Escape' })],
    ['pointercancel', () => send(page.win, 'pointercancel', { pointerId: 1 })],
    ['lostpointercapture', () => send(b.board, 'lostpointercapture', { pointerId: 1 })],
    ['blur', () => send(page.win, 'blur')],
  ])('%s flies back, and the later pointerup and click are swallowed', async (_, end) => {
    lift();
    moveOver('testing');
    end();
    expect(drag.session.state).toBe('settling');
    expect(b.cards[4].style.transform).toBe(''); // the room slides back while it flies
    send(page.win, 'pointerup', { clientX: 470, clientY: 400 });
    expect(send(b.cards[1], 'click').defaultPrevented).toBe(true);
    await settle();
    expect(ctx.onDrop).not.toHaveBeenCalled();
    expect(preview()).toBeUndefined();
  });

  it('Escape is taken: no window or menu sees it', () => {
    lift();
    const key = send(page.doc, 'keydown', { key: 'Escape' });
    expect(key.defaultPrevented).toBe(true);
    expect(key.stopped).toBe(true);
  });

  it('a cancel after the button was released... a pointerup later still opens nothing', async () => {
    lift();
    send(page.doc, 'keydown', { key: 'Escape' });
    await settle();
    send(page.win, 'pointerup', { clientX: 10, clientY: 10, pointerId: 1 });
    expect(send(b.cards[1], 'click').defaultPrevented).toBe(true);
  });

  it('a hidden tab puts it back at once', async () => {
    lift();
    page.doc.hidden = true;
    send(page.doc, 'visibilitychange');
    await flushPromises();
    expect(drag.session).toBeNull();
    expect(preview()).toBeUndefined();
  });

  it('the context menu is prevented while lifted', () => {
    lift();
    expect(send(b.cards[3], 'contextmenu').defaultPrevented).toBe(true);
  });
});

describe('while one settles, and destroy()', () => {
  it('a press while it settles is ignored', () => {
    lift();
    moveOver('testing');
    send(page.win, 'pointerup', { clientX: 470, clientY: 400 });
    const settling = drag.session;
    press(b.cards[3], { pointerId: 2 });
    expect(drag.session).toBe(settling);
  });

  it('destroy() while it settles still commits the drop, once, without motion', async () => {
    lift();
    moveOver('testing');
    send(page.win, 'pointerup', { clientX: 470, clientY: 400 });
    drag.destroy();
    expect(ctx.onDrop).toHaveBeenCalledTimes(1);
    await flushPromises();
    expect(ctx.onDrop).toHaveBeenCalledTimes(1);
    expect(preview()).toBeUndefined();
  });

  it('destroy() while lifted leaves nothing behind and says nothing', () => {
    lift();
    moveOver('testing');
    ctx.say.mockClear();
    drag.destroy();
    expect(preview()).toBeUndefined();
    expect(b.board.querySelectorAll('[data-outline], [data-drop], [data-room]')).toEqual([]);
    expect(b.board.querySelectorAll('[style*="translateY"]')).toEqual([]);
    expect(page.html.hasAttribute('data-dragging')).toBe(false);
    expect(ctx.say).not.toHaveBeenCalled();
  });
});

describe('a refresh while lifted', () => {
  it('relayout() puts the outline on the new node and the room back', () => {
    lift();
    moveOver('testing');
    const fresh = b.cards[1].cloneNode(true);
    fresh.removeAttribute('data-outline');
    b.lists.development.children[0] = fresh;
    fresh.parentElement = b.lists.development;
    b.cards[1].parentElement = null;
    const four = b.cards[4];
    four.style.transform = '';
    drag.relayout();
    expect(fresh.hasAttribute('data-outline')).toBe(true);
    expect(four.style.transform).toBe('translateY(112px)');
  });

  it('a task moved away meanwhile cancels at once: "Move cancelled."', async () => {
    lift();
    b.tasks.find((task) => task.id === 1).phase = 'launch';
    drag.relayout();
    await flushPromises();
    expect(ctx.say).toHaveBeenLastCalledWith('Move cancelled.');
    expect(drag.session).toBeNull();
  });
});

describe('the keyboard move', () => {
  const grip = (id = 1) => b.cards[id].querySelector('[data-grip]');
  const keyOnGrip = (key, init = {}) =>
    drag
      .gripProps(b.findTask(1))
      .onKeyDown(fakeEvent('keydown', { key, currentTarget: grip(), target: grip(), ...init }));
  const key = (name, init) => send(page.doc, 'keydown', { key: name, ...init });

  it('Space on the grip lifts (a repeat does not), with the keyboard words', () => {
    keyOnGrip(' ', { repeat: true });
    expect(drag.session).toBeNull();
    keyOnGrip(' ');
    expect(drag.session?.mode).toBe('keyboard');
    expect(b.board.setPointerCapture).not.toHaveBeenCalled();
    expect(frames.waiting).toBe(1); // only the two-frame wait, no frame loop
    frames.step(0);
    frames.step(16);
    expect(inner().hasAttribute('data-lifted')).toBe(true);
    expect(inner().querySelector('[data-grip]').hasAttribute('data-focus-ring')).toBe(true);
    expect(ctx.say).toHaveBeenLastCalledWith(
      'Picked up Checkout fix before client demo, in Development. Use the Left and Right arrow keys to choose a phase, Space to drop, Escape to cancel.',
    );
  });

  it('Left and Right walk the phase columns, its own included, the rail and No phase yet skipped', () => {
    keyOnGrip('Enter');
    const right = key('ArrowRight');
    expect(right.stopped).toBe(true);
    expect(b.columns.testing.getAttribute('data-drop')).toBe('on');
    expect(ctx.say).toHaveBeenLastCalledWith('Over Testing. It goes in at 2 of 3.');
    key('ArrowRight'); // No phase yet is not on its walk
    expect(b.columns.none.hasAttribute('data-drop')).toBe(false);
    key('ArrowLeft');
    expect(ctx.say).toHaveBeenLastCalledWith('Back in Development.');
    expect(b.board.querySelectorAll('[data-drop]')).toEqual([]);
  });

  it('skips a column folded into the rail (still in the page, hidden)', () => {
    b.columns.testing.setAttribute('hidden', '');
    b.columns.testing.rect.width = 0;
    keyOnGrip(' ');
    key('ArrowRight');
    expect(b.board.querySelectorAll('[data-drop]')).toEqual([]);
    expect(ctx.say).not.toHaveBeenCalledWith(expect.stringContaining('Over Testing'));
  });

  it('Up and Down say how cards are sorted, once', () => {
    keyOnGrip(' ');
    key('ArrowDown');
    key('ArrowUp');
    const said = ctx.say.mock.calls.filter(([text]) => text.startsWith('Cards are sorted'));
    expect(said).toHaveLength(1);
  });

  it('Space drops on the column it is over and focuses the moved card’s grip', async () => {
    keyOnGrip(' ');
    key('ArrowRight');
    key(' ');
    await settle();
    expect(ctx.onDrop).toHaveBeenCalledWith(b.findTask(1), 'testing', { mode: 'keyboard' });
    expect(page.doc.activeElement).toBe(grip());
  });

  it('Space on its own column is the quiet cancel: "stays in"', async () => {
    keyOnGrip(' ');
    key(' ');
    await settle();
    expect(ctx.onDrop).not.toHaveBeenCalled();
    expect(ctx.say).toHaveBeenLastCalledWith(
      'Checkout fix before client demo stays in Development.',
    );
  });

  it.each([
    ['Tab', () => key('Tab')],
    ['Escape', () => key('Escape')],
    ['a focusout to elsewhere', () => send(grip(), 'focusout', { relatedTarget: b.cards[3] })],
    ['a pointerdown', () => send(b.cards[3], 'pointerdown', { clientX: 400, clientY: 300 })],
    ['blur', () => send(page.win, 'blur')],
  ])('%s cancels it', async (_, end) => {
    keyOnGrip(' ');
    key('ArrowRight');
    end();
    await settle();
    expect(ctx.onDrop).not.toHaveBeenCalled();
    expect(drag.session).toBeNull();
    expect(ctx.say).toHaveBeenLastCalledWith(
      'Move cancelled. Checkout fix before client demo is back in Development.',
    );
  });

  it('a pointerdown during a keyboard move never starts a drag', () => {
    keyOnGrip(' ');
    press(b.cards[3]);
    expect(drag.session).toBeNull();
  });

  it('a card in No phase yet starts over No phase yet; Left goes to the last phase column', () => {
    const fiveGrip = grip(5);
    drag
      .gripProps(b.findTask(5))
      .onKeyDown(fakeEvent('keydown', { key: ' ', currentTarget: fiveGrip, target: fiveGrip }));
    expect(b.board.querySelectorAll('[data-drop]')).toEqual([]);
    key('ArrowRight');
    expect(b.board.querySelectorAll('[data-drop]')).toEqual([]);
    key('ArrowLeft');
    expect(b.columns.testing.getAttribute('data-drop')).toBe('on');
    key('ArrowRight');
    expect(ctx.say).toHaveBeenLastCalledWith('Back in No phase yet.');
  });

  it("the grip's click opens Move to phase…, but not the click from the key that lifted", async () => {
    const props = drag.gripProps(b.findTask(1));
    props.onClick();
    expect(ctx.askMove).toHaveBeenCalledTimes(1);
    keyOnGrip(' ');
    key('Escape');
    props.onClick(); // the click the Space key causes
    expect(ctx.askMove).toHaveBeenCalledTimes(1);
    await settle();
    send(page.doc, 'keyup', { key: ' ' });
    timers.run();
    props.onClick();
    expect(ctx.askMove).toHaveBeenCalledTimes(2);
  });
});
