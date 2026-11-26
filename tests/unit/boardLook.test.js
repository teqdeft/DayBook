// The Board's cards match the final prototype (CONTRACT 27, Screens; Look, phone and
// accessibility; docs/design/project-board-prototype.html), where review found them off: Critical
// tasks with the Card's own padding (16 px on a phone), and the My projects mini band 12 px under
// the head with 3 px gaps. The task window and the project page's windows are in
// taskWindowLook.test.js (split by CONTRACT 28, Files and owners). Browser checks: the review's
// measurements in a copy.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {} }),
  usePathname: () => '/projects/5',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => () => {},
  useToastSlot: () => null,
}));

const { default: CriticalTasksCard } =
  await import('@/app/(app)/projects/[id]/CriticalTasksCard.jsx');

const PROJECT = 'src/app/(app)/projects';
const css = (file) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of `selector`'s rule, at the top level or inside `media` (its condition). */
function rule(text, selector, media) {
  let scope = text;
  if (media) {
    const start = text.indexOf(`@media ${media}`);
    if (start < 0) return null;
    scope = text.slice(text.indexOf('{', start) + 1);
  } else {
    scope = text.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
  }
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = scope.match(new RegExp(`(?:^|[}\\s,])${escaped}\\s*\\{([^}]*)\\}`));
  return found ? found[1].replace(/\s+/g, ' ').trim() : null;
}

const PHONE = '(max-width: 640px)';

describe('Critical tasks on the Summary tab', () => {
  it("has the Card's 20 x 24 px padding, 16 px on a phone", () => {
    const html = renderToStaticMarkup(
      createElement(CriticalTasksCard, {
        projectId: 5,
        tasks: [],
        today: '2026-11-23',
        canManage: false,
      }),
    );
    expect(html).toMatch(/<section class="[^"]*_padDefault_/);
    expect(html).not.toContain('_padCompact_');
    const overview = css(`${PROJECT}/[id]/Overview.module.css`);
    expect(rule(overview, '.columnCard', PHONE)).toBe('--card-pad: 16px;');
  });
});

describe('the My projects card', () => {
  it('puts the mini band 12 px under the head with 3 px between its parts', () => {
    const band = rule(css(`${PROJECT}/ProjectCard.module.css`), '.band');
    expect(band).toContain('gap: 3px;');
    expect(band).toContain('margin-top: 12px;');
  });
});

// CONTRACT 28, Cards and the card menu; The people window; Look and accessibility: the card's CSS
// as the 1.13 prototype draws it (docs/design/project-tasks-prototype.html, `.tc`, `.fchip`,
// `.face`, `.pop`, `.prow`).
/** The text inside `@media <media> {…}`, exactly that query (its braces balanced); '' if none. */
function mediaBlock(text, media) {
  const start = text.indexOf(`@media ${media} {`);
  if (start < 0) return '';
  let depth = 0;
  for (let at = text.indexOf('{', start); at < text.length; at += 1) {
    if (text[at] === '{') depth += 1;
    if (text[at] === '}') depth -= 1;
    if (depth === 0) return text.slice(text.indexOf('{', start) + 1, at);
  }
  return '';
}
/** A rule inside exactly that media query. */
const ruleIn = (text, selector, media) => rule(mediaBlock(text, media), selector);

describe('the 1.13 task card', () => {
  const BOARD = `${PROJECT}/[id]/_board`;
  const card = css(`${BOARD}/TaskCard.module.css`);
  const parts = css(`${BOARD}/CardParts.module.css`);
  const people = css(`${BOARD}/PeopleWindow.module.css`);
  const move = css(`${BOARD}/MoveTaskDialog.module.css`);

  it('is a white tile with 12 px padding, 10 px between its rows and a 22 px top line', () => {
    const tile = rule(card, '.card');
    expect(tile).toContain('padding: 12px;');
    expect(tile).toContain('gap: 10px;');
    expect(tile).toContain('border: 1px solid var(--line);');
    expect(tile).toContain('background: var(--surface);');
    expect(rule(card, '.card:hover')).toBe('border-color: var(--line-strong);');
    expect(rule(card, '.top')).toContain('min-height: 22px;');
    expect(card).toMatch(/\n\.title \{[^}]*-webkit-line-clamp: 3;/);
    expect(rule(card, '.dim')).toBe('opacity: 0.4;');
  });

  it('draws Anyone as a 24 px dashed circle', () => {
    const anyone = rule(card, '.anyone');
    expect(anyone).toContain('width: 24px;');
    expect(anyone).toContain('border: 1.5px dashed var(--line-dashed);');
    expect(anyone).toContain('border-radius: 50%;');
    expect(rule(people, '.anyone')).toContain('border: 1.5px dashed var(--line-dashed);');
  });

  it("puts an open card menu over the next card's own actions", () => {
    // The menu (Menu.module.css, 80) is drawn inside the group, which is a stacking context.
    const menu = css('src/components/Menu.module.css');
    expect(rule(menu, '.menu')).toContain('z-index: 80;');
    expect(rule(card, '.actions')).toContain('z-index: 1;');
    const open = card.split(".actions:has([aria-expanded='true']) {").slice(1);
    expect(open.map((one) => one.split('}')[0]).join(' ')).toContain('z-index: 80;');
  });

  it('draws the line above Delete in the card menu as the prototype', () => {
    const menu = css('src/components/Menu.module.css');
    expect(rule(menu, '.separator')).toBe(
      'flex: none; height: 1px; margin: 5px 4px; background: var(--line);',
    );
  });

  it('keeps room on the top line where the actions always show', () => {
    expect(rule(card, '.actions')).toContain('opacity: 0;');
    expect(ruleIn(card, '.actions', '(hover: none)')).toBe('opacity: 1;');
    expect(ruleIn(card, '.manage .top', '(hover: none)')).toBe('padding-right: 64px;');
    expect(ruleIn(card, '.manage .top', PHONE)).toBe('flex-wrap: wrap; padding-right: 84px;');
  });

  it('hides the grip on phones and touch screens (mouse and pen only)', () => {
    expect(ruleIn(card, '.grip', '(max-width: 640px), (pointer: coarse)')).toBe('display: none;');
    expect(rule(card, '.grip')).toContain('touch-action: none;');
  });

  it('makes every control a 44 px target on a phone', () => {
    expect(ruleIn(card, '.action', PHONE)).toBe('width: 44px; height: 44px;');
    expect(rule(card, '.action')).toContain('width: 28px;');
    expect(ruleIn(parts, '.face', PHONE)).toBe('height: 44px; margin-block: -8px;');
    expect(ruleIn(parts, '.fileChip', PHONE)).toBe('height: 44px;');
    expect(ruleIn(people, '.row', PHONE)).toBe('min-height: 44px;');
    expect(rule(people, '.row')).toContain('min-height: 40px;');
    expect(rule(move, '.target')).toContain('min-height: 44px;');
  });

  it('has 32 px file chips, a 42 px picture with a 40 x 30 thumbnail', () => {
    expect(rule(parts, '.fileChip')).toContain('height: 32px;');
    expect(rule(parts, '.picture')).toContain('width: 42px;');
    expect(rule(parts, '.picture img')).toContain('width: 40px; height: 30px;');
    expect(rule(parts, '.footer')).toContain('border-top: 1px solid var(--track);');
  });

  it('opens the people popover at 300 px and the windows as bottom sheets on a phone', () => {
    const popover = rule(people, '.popover');
    expect(popover).toContain('width: 300px;');
    expect(popover).toContain('box-shadow: var(--shadow-menu);');
    expect(popover).toContain('border-radius: var(--radius-tile);');
    for (const [text, selector] of [
      [people, "[role='dialog'].window"],
      [move, "[role='dialog'].sheet"],
    ]) {
      const sheet = ruleIn(text, selector, PHONE);
      expect(sheet).toContain('inset: auto 0 0;');
      expect(sheet).toContain('border-radius: var(--radius-card) var(--radius-card) 0 0;');
    }
  });

  it('uses tokens only: no colour written out', () => {
    for (const text of [card, parts, people, move]) {
      expect(text).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    }
  });
});
