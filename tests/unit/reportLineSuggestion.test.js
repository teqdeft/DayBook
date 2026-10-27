// A line's suggestion strip while the report is submitting (CONTRACT 21, TaskLine + LinePolish):
// the line is disabled, and so are Keep mine and Use, since the submitted copy would replace a
// title Use changed meanwhile. Otherwise both work as usual.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/(app)/report/PolishProvider', () => ({
  usePolish: () => ({
    lines: {
      enabled: true,
      states: { t1: { phase: 'suggest', id: 1, after: 'Fixed the sign-in timeout' } },
      polish: () => {},
      use: () => true,
      keep: () => {},
      drop: () => {},
    },
  }),
}));

const { default: TaskLine } = await import('@/app/(app)/report/TaskLine.jsx');

/** Every button of a rendered line: its name and whether it is disabled. */
function buttons({ disabled }) {
  const html = renderToStaticMarkup(
    createElement(TaskLine, {
      task: { key: 't1', id: 5, title: 'fix login timeout', status: 'in_progress' },
      index: 0,
      projectName: 'acme',
      suggestions: [],
      taken: new Set(),
      readOnly: false,
      disabled,
      errorId: 'task-error',
      inputRef: () => {},
      onUpdate: () => {},
      onEnter: () => {},
      onRemove: () => {},
    }),
  );
  return Object.fromEntries(
    [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/gs)].map(([, attributes, inner]) => {
      const name = attributes.match(/aria-label="([^"]+)"/)?.[1] ?? inner.replace(/<[^>]+>/g, '');
      return [name.trim(), /\sdisabled=""/.test(attributes)];
    }),
  );
}

describe('suggestion strip', () => {
  it('is disabled with the rest of the line while the report is submitting', () => {
    expect(buttons({ disabled: true })).toEqual({
      'Polish task 1 for acme with AI': true,
      'Remove task 1 for acme': true,
      'Keep mine': true,
      Use: true,
    });
  });

  it('works while the report is editable', () => {
    expect(buttons({ disabled: false })).toEqual({
      'Polish task 1 for acme with AI': false,
      'Remove task 1 for acme': false,
      'Keep mine': false,
      Use: false,
    });
  });
});
