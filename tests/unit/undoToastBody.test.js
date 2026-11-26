// The Undo toast's words (CONTRACT 22; CONTRACT 28, Files tab and Toasts): the title, then the body
// on its own line when there is one, read with the title in the toast's live region: "File
// deleted." with "It was on 2 tasks." (the Files tab's delete through useUndoDelete), and "… is now
// yours." with who was told (the people window's change of person). No body, no line.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UndoToastBody } from '@/app/(app)/projects/[id]/UndoToast.jsx';

const draw = (shown) =>
  renderToStaticMarkup(
    createElement(UndoToastBody, {
      shown,
      leaving: false,
      hold: () => {},
      undoRef: null,
      onUndo: () => {},
      onEnd: () => {},
    }),
  );

const textOf = (html) => html.replace(/<[^>]+>/g, '').trim();
const css = readFileSync(
  new URL('../../src/app/(app)/projects/[id]/UndoToast.module.css', import.meta.url),
  'utf8',
);

describe('the Undo toast body', () => {
  it('draws the body under the title, in the same paragraph', () => {
    const html = draw({ key: 1, title: 'File deleted.', body: 'It was on 2 tasks.' });
    const title = /<p class="[^"]*title[^"]*">([\s\S]*?)<\/p>/.exec(html)[1];
    expect(textOf(title)).toBe('File deleted. It was on 2 tasks.');
    expect(title).toMatch(/<span class="[^"]*body[^"]*"> It was on 2 tasks\.<\/span>/);
    expect(textOf(html)).toBe('File deleted. It was on 2 tasks.Undo');
  });

  it('draws no body line without a body', () => {
    for (const body of [undefined, null, '']) {
      const html = draw({ key: 2, title: 'Task deleted.', body });
      expect(html).not.toMatch(/class="[^"]*body/);
      expect(textOf(html)).toBe('Task deleted.Undo');
    }
  });

  it('gives the body its own muted line in tokens', () => {
    const rule = /\.body \{([^}]*)\}/.exec(css)[1];
    expect(rule).toContain('display: block');
    expect(rule).toContain('color: var(--muted)');
    expect(rule).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
  });
});
