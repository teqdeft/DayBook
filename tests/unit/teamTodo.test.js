// Today's to-do on the Team board and the Employee detail (CONTRACT 24): the read-only TodoList
// (check or circle per line, the words a screen reader hears, the tags as on Today), the popover's
// button and card ("Priya's to-do", the Slack line only while posting is on, the page link), the
// "Projects today" cell before and after submit ("No to-do yet" at 14 px), and the employee card's
// subtitle.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TodoList, { todoCardSubtitle } from '@/app/(app)/team/TodoList.jsx';
import TodoPopover, {
  TodoPopoverCard,
  todoButtonText,
  todoPostText,
  todoTitle,
} from '@/app/(app)/team/TodoPopover.jsx';
import { ProjectsCell } from '@/app/(app)/team/TeamBoardCells.jsx';

/** Visible text of some markup: tags and React's text separators dropped, apostrophes decoded. */
const text = (html) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'");
const render = (type, props) => renderToStaticMarkup(createElement(type, props));

const line = (id, title, status = 'in_progress', extra = {}) => ({
  id,
  title,
  status,
  done: status === 'done',
  now: false,
  carriedFrom: null,
  ...extra,
});

const TODO = {
  total: 5,
  done: 2,
  post: { postedAt: '2026-11-12T04:11:00.000Z', at: '9:41 AM' },
  groups: [
    {
      entryId: 1,
      project: { id: 3, name: 'Studio Ubique', color: 'violet' },
      lines: [
        line(11, '1 web blog publish', 'done'),
        line(12, 'Analysing the gsc stats', 'in_progress', {
          carriedFrom: { workDate: '2026-11-11', dayLabel: 'From yesterday' },
        }),
        line(13, 'Fix the sitemap', 'blocked'),
      ],
    },
    {
      entryId: 2,
      request: { id: 4, name: 'Riverkraft website' },
      lines: [
        line(21, 'Kickoff notes', 'in_progress', { now: true }),
        line(22, 'Proofread', 'done'),
      ],
    },
  ],
};
const PERSON = { name: 'Priya Sharma', href: '/team/7' };

describe('TodoList', () => {
  it('lists each project with its lines, a filled check for done and a circle otherwise', () => {
    const html = render(TodoList, { groups: TODO.groups });
    expect(text(html)).toContain('Studio Ubique');
    expect(text(html)).toContain('Riverkraft website');
    expect(html.match(/<li/g)).toHaveLength(5);
    expect(html.match(/lucide-circle-check/g)).toHaveLength(2);
    expect(html.match(/lucide-circle(?!-)/g)).toHaveLength(3);
    // The icons are hidden; a screen reader hears the state before each title.
    expect(text(html)).toContain('Done: 1 web blog publish');
    expect(text(html)).toContain('Not done yet: Analysing the gsc stats');
    expect(text(html)).toContain('Blocked: Fix the sitemap');
  });

  it('shows the tags as on Today: the day a line was carried from, Blocked and Now', () => {
    const html = text(render(TodoList, { groups: TODO.groups, variant: 'card' }));
    expect(html).toContain('Analysing the gsc statsFrom yesterday');
    expect(html).toContain('Blocked: Fix the sitemapBlocked');
    expect(html).toContain('Kickoff notesNow');
    expect(html).not.toContain('1 web blog publishFrom');
  });

  it('writes the card subtitle with the Slack part only while to-dos are posted', () => {
    expect(todoCardSubtitle(TODO)).toBe('2 of 5 done · Posted at 9:41 AM');
    expect(todoCardSubtitle({ ...TODO, post: { postedAt: null, at: null } })).toBe(
      '2 of 5 done · Not posted',
    );
    expect(todoCardSubtitle({ ...TODO, post: null })).toBe('2 of 5 done');
    expect(todoCardSubtitle({ total: 0, done: 0, post: null, groups: [] })).toBeNull();
  });
});

describe('TodoPopover', () => {
  it('is a closed disclosure button "To-do: 2 of 5 done" until pressed', () => {
    const html = render(TodoPopover, { todo: TODO, person: PERSON });
    expect(text(html)).toBe('To-do: 2 of 5 done');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('lucide-chevron-down');
    expect(html).not.toContain('role="dialog"');
    expect(todoButtonText({ done: 0, total: 1 })).toBe('To-do: 0 of 1 done');
  });

  it("titles the card with the first name, says whether it was posted and links the person's page", () => {
    const html = render(TodoPopoverCard, { todo: TODO, person: PERSON, titleId: 't1' });
    expect(html).toContain('id="t1"');
    expect(text(html)).toContain("Priya's to-do");
    expect(text(html)).toContain('Posted to Slack at 9:41 AM');
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('href="/team/7"');
    expect(text(html)).toContain("Open Priya Sharma's page");
    expect(text(html)).toContain('Done: 1 web blog publish');
    expect(todoTitle('Vishal')).toBe("Vishal's to-do");
    expect(todoPostText({ postedAt: null, at: null })).toBe('Not posted to Slack');
    expect(todoPostText(null)).toBeNull();
    const off = text(render(TodoPopoverCard, { todo: { ...TODO, post: null }, person: PERSON }));
    expect(off).not.toContain('Slack');
  });
});

describe('ProjectsCell', () => {
  const base = { name: 'Priya Sharma', href: '/team/7', projects: [], workingOn: null };

  it('before submit shows the timer project and the to-do button, never the planned projects', () => {
    const html = text(
      render(ProjectsCell, {
        row: { ...base, workingOn: { name: 'Beta', color: 'green', note: null }, todo: TODO },
      }),
    );
    expect(html).toBe('NowBetaTo-do: 2 of 5 done');
  });

  it('says "No to-do yet" for someone checked in without lines, and nothing otherwise', () => {
    expect(text(render(ProjectsCell, { row: { ...base, todo: null, noTodo: true } }))).toBe(
      'No to-do yet',
    );
    expect(render(ProjectsCell, { row: { ...base, todo: null, noTodo: false } })).toBe('');
  });

  it('draws "No to-do yet" at the row text’s 14 px, muted, as the design', () => {
    const html = render(ProjectsCell, { row: { ...base, todo: null, noTodo: true } });
    expect(html).toMatch(/<span class="_noTodo_[^"]*">No to-do yet<\/span>/);
    const css = readFileSync(
      new URL('../../src/app/(app)/team/TeamBoard.module.css', import.meta.url),
      'utf8',
    );
    expect(css).toMatch(/^\.noTodo \{\n {2}font-size: 14px;\n {2}color: var\(--muted\);\n\}/m);
  });

  it('after submit shows the projects with hours, then the same button', () => {
    const html = text(
      render(ProjectsCell, {
        row: { ...base, projects: [{ name: 'Alpha', color: 'blue' }], todo: TODO },
      }),
    );
    expect(html).toBe('AlphaTo-do: 2 of 5 done');
  });
});
