// The board's CSS for the sideways scroll (CONTRACT 28, The sideways scroll): every phase column 248
// to 320 px (no slim or wider current column, no scroll snapping), the Done phases rail 72 px and
// 220 px open, `min-width: 0` down the chain, the data-fill height and the bodies that scroll only
// then (with a stable gutter, never `overscroll-behavior`), the extra room while a card is lifted,
// the phone's one full-width column, the band's track under every part (its fill a scaleX, one
// ring), and the toolbar's faces (a 4 px overlap; 44 px and apart on a phone). The values are
// binding; the class names are the board's own. Read from the CSS modules themselves.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const BOARD = 'src/app/(app)/projects/[id]/_board';
const read = (name) => readFileSync(`${BOARD}/${name}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every rule of a stylesheet: its selectors, its media condition (null at the top level) and its
 * declarations as one line ("a: b; c: d;").
 */
function rulesOf(text, media = null) {
  const rules = [];
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf('{', at);
    if (open < 0) break;
    const head = text.slice(at, open).trim();
    let depth = 1;
    let end = open + 1;
    while (depth > 0 && end < text.length) {
      if (text[end] === '{') depth += 1;
      if (text[end] === '}') depth -= 1;
      end += 1;
    }
    const body = text.slice(open + 1, end - 1);
    if (head.startsWith('@media')) rules.push(...rulesOf(body, head.slice(6).trim()));
    else if (!head.startsWith('@')) {
      const declarations = body.trim().replace(/\s+/g, ' ');
      rules.push({ selectors: head.split(',').map((one) => one.trim()), media, declarations });
    }
    at = end;
  }
  return rules;
}

/**
 * The declarations of one selector (at the top level, or in that media condition), from every
 * rule that names it, in order; null when none does.
 */
function rule(name, selector, media = null) {
  const found = rulesOf(read(name)).filter(
    (one) => one.media === media && one.selectors.includes(selector),
  );
  return found.length ? found.map((one) => one.declarations).join(' ') : null;
}

const PHONE = '(max-width: 640px)';
const BOARD_CSS = [
  'Board.module.css',
  'Columns.module.css',
  'DoneRail.module.css',
  'Toolbar.module.css',
  'Faces.module.css',
  'ProgressBand.module.css',
];

describe('the phase columns', () => {
  it('are 248 to 320 px wide, the current one too, free space at the right', () => {
    expect(rule('Board.module.css', '.column')).toBe(
      'display: flex; flex-direction: column; flex: 1 1 248px; min-width: 248px; max-width: 320px; min-height: 0;',
    );
    for (const name of BOARD_CSS) {
      const text = read(name);
      expect(text, name).not.toMatch(/\.slim\b/);
      expect(text, name).not.toMatch(/\.current\s*\{[^}]*(min-width|flex-grow)/);
      expect(text, name).not.toContain('scroll-snap');
    }
  });

  it('are at least 220 px tall without data-fill', () => {
    expect(rule('Board.module.css', '.view:not([data-fill]) .column')).toBe('min-height: 220px;');
  });

  it('keep their header and foot still; only the body scrolls, and only with data-fill', () => {
    expect(rule('Board.module.css', '.columnHead')).toBe('flex: none;');
    expect(rule('Board.module.css', '.columnFoot')).toBe('flex: none;');
    expect(rule('Board.module.css', '.columnBody')).toBe('flex: 1 1 auto; min-height: 0;');
    expect(rule('Board.module.css', '.view[data-fill] .columnBody')).toBe(
      'overflow-y: auto; scrollbar-width: thin; scrollbar-gutter: stable;',
    );
    expect(rule('Board.module.css', '.view:not([data-fill]) .columnBody')).toBe('flex: none;');
    for (const name of BOARD_CSS) expect(read(name), name).not.toMatch(/overscroll-behavior-y/);
    expect(read('Columns.module.css')).not.toContain('overscroll-behavior');
  });
});

describe('the Done phases rail', () => {
  it('is 72 px, and 220 px open (it widens by FLIP, never by a transition)', () => {
    expect(rule('Board.module.css', '.rail')).toBe('flex: 0 0 72px;');
    expect(rule('Board.module.css', '.rail[data-open]')).toBe('flex-basis: 220px;');
    for (const name of BOARD_CSS) expect(read(name), name).not.toMatch(/transition[^;]*flex/);
  });

  it('draws its box apart, so the box can scale while the words stay sharp', () => {
    expect(rule('DoneRail.module.css', '.box')).toContain('position: absolute; inset: 0;');
    expect(rule('DoneRail.module.css', '.box')).toContain('transform-origin: left center;');
  });
});

describe('the frame', () => {
  it('keeps min-width: 0 down the chain, and the board scrolls inside its own box', () => {
    for (const selector of ['.tab', '.view', '.boardWrap', '.board']) {
      expect(rule('Board.module.css', selector), selector).toContain('min-width: 0;');
    }
    expect(rule('Board.module.css', '.board')).toBe(
      'display: flex; align-items: flex-start; gap: 12px; min-width: 0; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; padding-bottom: 2px;',
    );
    expect(rule('Toolbar.module.css', '.toolbar')).toContain('flex-wrap: wrap;');
    expect(rule('Toolbar.module.css', '.search')).toContain('width: 260px; max-width: 100%;');
    expect(rule('Faces.module.css', '.faces')).toContain('min-width: 0;');
  });

  it('fills the window with data-fill, the board stretching to it', () => {
    expect(rule('Board.module.css', '.view[data-fill]')).toBe(
      'height: calc(100vh - 24px); height: calc(100dvh - 24px); min-height: 560px;',
    );
    expect(rule('Board.module.css', '.view[data-fill] .board')).toBe(
      'align-items: stretch; height: 100%;',
    );
    expect(rule('Board.module.css', '.boardWrap')).toBe(
      'position: relative; flex: 1 1 auto; min-width: 0; min-height: 0;',
    );
  });

  it('grows the board by one card while a card is lifted without data-fill', () => {
    expect(rule('Board.module.css', '.view:not([data-fill]) .board[data-dragging]')).toBe(
      'align-items: stretch; padding-bottom: calc(2px + var(--drag-room, 0px));',
    );
  });

  it("takes every column's background one card below the tallest column in that room", () => {
    // the margin gives the room back to the line, so the board still grows by one card only
    expect(rule('Board.module.css', '.view:not([data-fill]) .board[data-dragging] > *')).toBe(
      'margin-bottom: calc(-1 * var(--drag-room, 0px));',
    );
    expect(rule('Board.module.css', '.view:not([data-fill]) .board[data-dragging] > .column')).toBe(
      'padding-bottom: calc(6px + var(--drag-room, 0px));',
    );
    // the 6 px are the column's own foot
    expect(rule('Columns.module.css', '.column')).toContain('padding: 10px 10px 6px;');
  });

  it('fades the side that has more and puts its arrow there', () => {
    expect(rule('Board.module.css', ".boardWrap[data-more~='right'] .board")).toBe(
      'mask-image: linear-gradient(to right, black calc(100% - 24px), transparent);',
    );
    expect(rule('Board.module.css', ".boardWrap[data-more~='left'] .board")).toBe(
      'mask-image: linear-gradient(to left, black calc(100% - 24px), transparent);',
    );
    expect(rule('Board.module.css', ".boardWrap[data-more='left right'] .board")).toBe(
      'mask-image: linear-gradient( to right, transparent, black 24px, black calc(100% - 24px), transparent );',
    );
    expect(rule('Board.module.css', '.arrow')).toContain('width: 44px; height: 44px;');
    expect(rule('Board.module.css', '.arrow')).toContain('box-shadow: var(--shadow-menu);');
  });
});

describe('a phone', () => {
  it('scrolls the page, one full-width column at a time, no rail', () => {
    expect(rule('Board.module.css', '.view[data-fill]', PHONE)).toBe(
      'height: auto; min-height: 0;',
    );
    expect(rule('Board.module.css', '.boardWrap', PHONE)).toBe('flex: none;');
    expect(rule('Board.module.css', '.board', PHONE)).toBe(
      'display: block; height: auto; overflow: visible; mask-image: none;',
    );
    expect(rule('Board.module.css', '.column', PHONE)).toBe('max-width: none; min-width: 0;');
    expect(rule('Board.module.css', '.view[data-fill] .columnBody', PHONE)).toBe(
      'overflow: visible;',
    );
    expect(rule('Board.module.css', '.board > .rail', PHONE)).toBe('display: none;');
    expect(rule('Board.module.css', '.board > .column.selected', PHONE)).toBe('display: flex;');
  });
});

describe('the band', () => {
  it('draws the track under every part, the fill a scaleX and the green layer over it', () => {
    expect(rule('ProgressBand.module.css', '.bar')).toContain('background: var(--track);');
    expect(rule('ProgressBand.module.css', '.bar')).toContain('overflow: hidden;');
    expect(rule('ProgressBand.module.css', '.fill')).toBe(
      'position: absolute; inset: 0; transform-origin: left center; background: var(--primary); transform: scaleX(var(--share, 0));',
    );
    expect(rule('ProgressBand.module.css', '.doneLayer')).toBe(
      'position: absolute; inset: 0; transform-origin: left center; background: var(--green); opacity: 0;',
    );
    const text = read('ProgressBand.module.css');
    expect(text).not.toMatch(/\.done \.bar/);
    expect(text).not.toMatch(/\.current \.bar/);
    expect(rule('ProgressBand.module.css', '.fill')).not.toContain('width');
  });

  it('has one ring, one part wide, moved to its part', () => {
    expect(rule('ProgressBand.module.css', '.ring')).toContain(
      'width: calc((100% - 20px) / 6); height: 10px; border-radius: 6px; box-shadow: 0 0 0 2px var(--primary); transform: translateX(calc(var(--i) * (100% + 4px)));',
    );
  });
});

describe("the toolbar's faces", () => {
  it('overlap by 4 px with a 2 px ring, the pressed one a 2 px --ink ring', () => {
    expect(rule('Faces.module.css', '.face')).toContain('margin-left: -4px;');
    expect(rule('Faces.module.css', '.face')).toContain('box-shadow: 0 0 0 2px var(--surface);');
    expect(rule('Faces.module.css', ".face[aria-pressed='true']")).toContain(
      '0 0 0 4px var(--ink)',
    );
    expect(rule('Faces.module.css', '.anyone')).toContain('margin-left: 8px;');
  });

  it('are 44 px and apart on a phone, the row scrolling inside itself', () => {
    expect(rule('Faces.module.css', '.faces', PHONE)).toContain('overflow-x: auto;');
    const face = rulesOf(read('Faces.module.css')).find(
      (one) => one.media === PHONE && one.selectors.includes('.face'),
    );
    expect(face.declarations).toContain('width: 44px; height: 44px; margin-left: 0;');
  });
});
