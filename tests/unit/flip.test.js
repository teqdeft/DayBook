// FLIP (CONTRACT 28, Motion, Modules and signatures; flip.js): `measure` reads each box once,
// `flipFrom` cancels running 'flip' animations, reads every box, then writes; only what moved over
// 0.5 px animates, with translate(dx, dy) → none; `skip`, `onEnter` and the `moved` card's fly; no
// FLIP with reduce motion, in a hidden tab or past 150 cards.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { el, flushPromises, installGlobals } from '../helpers/motionFakes';

vi.mock('react-dom', () => ({ flushSync: (fn) => fn() }));

const { flipFrom, flyClone, measure, tooManyToFlip } = await import('@/lib/motion/flip');
const { resetAnimateForTests } = await import('@/lib/motion/animate');

const card = (id, rect) =>
  el('li', { attrs: { 'data-flip': `card:${id}` }, rect: { width: 280, height: 100, ...rect } });

let page;
beforeEach(() => {
  page = installGlobals();
  resetAnimateForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('measure', () => {
  it('reads each box once, by its data-flip key', () => {
    const a = card(1, { left: 10, top: 20 });
    const b = card(2, { left: 10, top: 140 });
    const boxes = measure([a, b, el('li')]);
    expect([...boxes.keys()]).toEqual(['card:1', 'card:2']);
    expect(boxes.get('card:2')).toEqual({ left: 10, top: 140, width: 280, height: 100 });
    expect(a.getBoundingClientRect).toHaveBeenCalledTimes(1);
  });

  it('leaves out an element that is not drawn (hidden), so it enters later and never slides', () => {
    const shown = card(1, { left: 10, top: 20 });
    const hidden = card(2, { left: 0, top: 0, width: 0, height: 0 });
    expect([...measure([shown, hidden]).keys()]).toEqual(['card:1']);
    const first = measure([shown]);
    shown.rect = { left: 0, top: 0, width: 0, height: 0 };
    expect(flipFrom(first, [shown])).toEqual([]);
  });

  it('keeps a box inside its scroll box with `relative`, so a scroll later is fine', () => {
    const scroller = el('div', { attrs: { 'data-flip-scroll': '' }, rect: { left: 100, top: 50 } });
    const a = card(1, { left: 300, top: 250 });
    scroller.append(a);
    scroller.scrollLeft = 40;
    const box = measure([a], { relative: true }).get('card:1');
    expect(box.left).toBe(240);
    expect(box.top).toBe(200);
  });
});

describe('flipFrom', () => {
  it('cancels a running flip first, then reads all, then writes', () => {
    const log = [];
    const a = card(1, { left: 0, top: 0 });
    const b = card(2, { left: 0, top: 120 });
    const first = measure([a, b]);
    const running = a.animate([], { id: 'flip' });
    running.cancel.mockImplementation(() => log.push('cancel'));
    for (const node of [a, b]) {
      node.getBoundingClientRect.mockImplementation(() => {
        log.push('read');
        return { ...node.rect, right: 0, bottom: 0 };
      });
      const animate = node.animate.getMockImplementation();
      node.animate.mockImplementation((frames, options) => {
        log.push('write');
        return animate(frames, options);
      });
    }
    a.rect.top = 120;
    b.rect.top = 0;
    flipFrom(first, [a, b]);
    expect(log).toEqual(['cancel', 'read', 'read', 'write', 'write']);
  });

  it('animates only what moved over 0.5 px, from its old place to none', () => {
    const a = card(1, { left: 0, top: 0 });
    const b = card(2, { left: 0, top: 120 });
    const c = card(3, { left: 0, top: 240 });
    const first = measure([a, b, c]);
    b.rect.top = 120.3;
    c.rect.top = 360;
    c.rect.left = 300;
    const animations = flipFrom(first, [a, b, c]);
    expect(animations).toHaveLength(1);
    expect(c.animations[0].keyframes).toEqual([
      { transform: 'translate(-300px, -120px)' },
      { transform: 'none' },
    ]);
    expect(c.animations[0].options).toMatchObject({ duration: 200, fill: 'none', id: 'flip' });
    expect(a.animations).toHaveLength(0);
    expect(b.animations).toHaveLength(0);
  });

  it('holds the old place with a delay (fill backwards)', () => {
    const a = card(1, { left: 0, top: 0 });
    const first = measure([a]);
    a.rect.left = 200;
    flipFrom(first, [a], { delay: 480, duration: 300 });
    expect(a.animations[0].options).toMatchObject({ delay: 480, fill: 'backwards', duration: 300 });
  });

  it('skips the keys in `skip` and calls onEnter for a new key', () => {
    const a = card(1, { left: 0, top: 0 });
    const first = measure([a]);
    a.rect.top = 300;
    const fresh = card(2, { left: 0, top: 0 });
    const onEnter = vi.fn();
    const animations = flipFrom(first, [a, fresh], { skip: new Set(['card:1']), onEnter });
    expect(animations).toEqual([]);
    expect(onEnter).toHaveBeenCalledWith(fresh);
  });

  it('never calls onEnter for a new element that is not drawn (a hidden column)', () => {
    const a = card(1, { left: 0, top: 0 });
    const hidden = card(2, { width: 0, height: 0 });
    const onEnter = vi.fn();
    flipFrom(measure([a]), [a, hidden], { onEnter });
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('flies the `moved` card as a fixed clone while the real one waits at opacity 0', async () => {
    const a = card(7, { left: 0, top: 0 });
    const first = measure([a]);
    a.rect.left = 600;
    a.rect.top = 40;
    const animations = flipFrom(first, [a], { moved: 'card:7' });
    const clone = page.body.children.find((node) => node.hasAttribute('data-fly-clone'));
    expect(clone).toBeTruthy();
    expect(clone.getAttribute('inert')).toBe('');
    expect(clone.getAttribute('aria-hidden')).toBe('true');
    expect(clone.style.position).toBe('fixed');
    expect(clone.animations[0].keyframes).toEqual([
      { transform: 'translate(0px, 0px)' },
      { transform: 'translate(600px, 40px)' },
    ]);
    expect(clone.animations[0].options.duration).toBe(350);
    expect(a.animations[0].options.id).toBe('fly-hide');
    expect(animations).toHaveLength(2);
    clone.animations[0].finish();
    await flushPromises();
    expect(clone.parentElement).toBeNull();
    expect(a.animations[0].cancel).toHaveBeenCalled();
    expect(a.animations.at(-1).options.id).toBe('flash');
  });

  it('is [] with reduce motion, in a hidden tab or past 150 cards (onEnter still runs)', () => {
    const a = card(1, { left: 0, top: 0 });
    const first = measure([a]);
    a.rect.top = 200;
    page.matchMedia.reduce = true;
    expect(flipFrom(first, [a])).toEqual([]);
    page.matchMedia.reduce = false;
    page.doc.hidden = true;
    expect(flipFrom(first, [a])).toEqual([]);
    page.doc.hidden = false;
    const many = Array.from({ length: 151 }, (_, i) => card(i + 10, { top: i }));
    const onEnter = vi.fn();
    expect(flipFrom(measure(many.slice(1)), many, { onEnter })).toEqual([]);
    expect(onEnter).toHaveBeenCalledWith(many[0]);
    expect(a.animations).toHaveLength(0);
  });
});

describe('flyClone', () => {
  it('only flashes with reduce motion', async () => {
    page.matchMedia.reduce = true;
    const a = card(1, {});
    await flyClone(a, { left: 0, top: 0, width: 10, height: 10 }, { left: 5, top: 5 });
    expect(a.animations.map((x) => x.options.id)).toEqual(['flash']);
  });
});

describe('tooManyToFlip', () => {
  it('is true past 150 cards or rows, in a hidden tab, or with reduce motion', () => {
    const root = el('div');
    for (let i = 0; i < 150; i += 1) root.append(card(i, {}));
    expect(tooManyToFlip(root)).toBe(false);
    root.append(card(999, {}));
    expect(tooManyToFlip(root)).toBe(true);
    const table = el('tbody');
    for (let i = 0; i < 151; i += 1) table.append(el('tr', { attrs: { 'data-flip': `row:${i}` } }));
    expect(tooManyToFlip(table)).toBe(true);
    const small = el('div', { children: [card(1, {})] });
    page.doc.hidden = true;
    expect(tooManyToFlip(small)).toBe(true);
    page.doc.hidden = false;
    page.matchMedia.reduce = true;
    expect(tooManyToFlip(small)).toBe(true);
    expect(tooManyToFlip(null)).toBe(true);
  });
});
