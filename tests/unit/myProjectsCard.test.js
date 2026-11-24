// A card on My projects (CONTRACT 27, My projects), rendered: the name links to the project page and
// the link covers the card; under the client a mini band of the six phases (done, the current one
// filled to the project's share, later) and "Development · 66% · Deadline 16 Dec" ("No phase yet ·
// 40%", "No tasks yet"); the priority line adds the files ("2 priority tasks · 1 P1 · 3 files").
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, prefetch, ...rest }) =>
    createElement('a', { href, 'data-prefetch': String(prefetch), ...rest }, children),
}));
vi.mock('@/lib/session', () => ({ getSessionUser: async () => null }));

const { default: ProjectCard } = await import('@/app/(app)/projects/ProjectCard.jsx');
const view = await import('@/app/(app)/projects/projectCardView.js');

const PROJECT = {
  id: 5,
  name: 'acme-store',
  clientName: 'Acme Retail',
  status: 'active',
  isUrgent: true,
  color: 'green',
  pmName: 'Riya Kapoor',
  members: [],
};
const PLAN = { currentPhase: 'development', deadline: '2026-12-16' };

/** Visible text: tags and React's text separators dropped, entities decoded. */
const text = (html) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

async function render(props) {
  const element = await ProjectCard({
    project: PROJECT,
    minutes: 600,
    lastDate: null,
    today: '2026-11-23',
    priority: null,
    ...props,
  });
  return renderToStaticMarkup(element);
}

describe('the link', () => {
  it('makes the name a link to the project page', async () => {
    const html = await render({});
    expect(html).toMatch(/<a href="\/projects\/5"[^>]*>acme-store<\/a>/);
    expect(html).toContain('data-prefetch="false"');
    expect(html).toContain('<article');
  });
});

describe('the band and its line', () => {
  it('says the phase, the share done and the deadline', async () => {
    const html = await render({ plan: PLAN, progress: { total: 29, done: 19 } });
    expect(text(html)).toContain('Development · 66% · Deadline 16 Dec');
    expect(html).toContain('--fill:66%');
  });

  it('says "No phase yet" without a phase and "No tasks yet" without tasks', () => {
    expect(view.phaseLine({ plan: null, progress: { total: 5, done: 2 } })).toBe(
      'No phase yet · 40%',
    );
    expect(view.phaseLine({ plan: PLAN, progress: { total: 0, done: 0 } })).toBe('No tasks yet');
    expect(
      view.phaseLine({
        plan: { currentPhase: 'testing', deadline: null },
        progress: { total: 4, done: 1 },
      }),
    ).toBe('Testing · 25%');
  });

  it('colours the parts: done before the current one, the current filled, later ones the track', () => {
    expect(view.miniBand({ plan: PLAN, progress: { total: 3, done: 1 } })).toEqual([
      { key: 'requirement_gathering', state: 'done', fill: 100 },
      { key: 'design', state: 'done', fill: 100 },
      { key: 'development', state: 'current', fill: 33 },
      { key: 'testing', state: 'later', fill: 0 },
      { key: 'launch', state: 'later', fill: 0 },
      { key: 'support', state: 'later', fill: 0 },
    ]);
    expect(
      view.miniBand({ plan: null, progress: null }).every((part) => part.state === 'later'),
    ).toBe(true);
  });
});

describe('the priority line', () => {
  it('adds the files after the tasks', async () => {
    const html = await render({ priority: { total: 2, p1: 1 }, fileCount: 3 });
    expect(text(html)).toContain('2 priority tasks · 1 P1 · 3 files');
  });

  it('shows the files alone, and nothing without tasks or files', async () => {
    expect(text(await render({ fileCount: 1 }))).toContain('1 file');
    const none = await render({});
    expect(text(none)).not.toMatch(/priority task|file/);
  });
});
