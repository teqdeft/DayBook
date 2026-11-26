// copyText (CONTRACT 28, Copy button on the Slack preview): the Clipboard API first; a hidden
// textarea and execCommand('copy') when the API is missing or refuses; false when neither works;
// never a throw, and never a textarea left on the page. The browser parts are small stand-ins.
// Then the Slack preview's header as drawn: the Copy button and its empty live region.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SlackPreview from '@/app/(app)/report/SlackPreview.jsx';
import { newEntry, newTask } from '@/app/(app)/report/reportState';
import { copyText } from '@/lib/copyText';

const ctx = vi.hoisted(() => ({ current: null }));
vi.mock('@/app/(app)/report/ReportProvider', () => ({ useReport: () => ctx.current }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => () => {} }));

const MESSAGE = [
  'Name: Vishal Saini',
  'Date: 25-11-2026',
  '',
  'Project: Acme store',
  'Hours: 2',
  'Tasks',
  '• Write the FAQ (Done)',
].join('\n');

/** A page with a body, a focused button and execCommand answering `copies` (or throwing). */
function fakeDocument({ copies = true } = {}) {
  const page = { areas: [], commands: [], attached: new Set() };
  const button = { focus: vi.fn() };
  const body = {
    appendChild(node) {
      page.attached.add(node);
      return node;
    },
  };
  page.document = {
    body,
    activeElement: button,
    createElement(tag) {
      const area = {
        tag,
        value: '',
        style: {},
        attributes: {},
        selected: false,
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        select() {
          this.selected = true;
          page.document.activeElement = this;
        },
        setSelectionRange(start, end) {
          this.range = [start, end];
        },
        remove() {
          page.attached.delete(this);
        },
      };
      page.areas.push(area);
      return area;
    },
    execCommand(command) {
      page.commands.push(command);
      const [area] = page.areas;
      page.copied = area?.selected && page.attached.has(area) ? area.value : undefined;
      if (copies instanceof Error) throw copies;
      return copies;
    },
  };
  page.button = button;
  return page;
}

function clipboard(writeText) {
  const fake = { writeText: vi.fn(writeText) };
  vi.stubGlobal('navigator', { clipboard: fake });
  return fake;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('copyText', () => {
  it('uses the Clipboard API with the text as it is', async () => {
    const api = clipboard(async () => {});
    const page = fakeDocument();
    vi.stubGlobal('document', page.document);
    expect(await copyText(MESSAGE)).toBe(true);
    expect(api.writeText).toHaveBeenCalledTimes(1);
    expect(api.writeText).toHaveBeenCalledWith(MESSAGE);
    expect(page.areas).toEqual([]);
    expect(page.commands).toEqual([]);
  });

  it('falls back to a hidden textarea when navigator.clipboard is missing', async () => {
    vi.stubGlobal('navigator', {});
    const page = fakeDocument();
    vi.stubGlobal('document', page.document);
    expect(await copyText(MESSAGE)).toBe(true);
    expect(page.commands).toEqual(['copy']);
    expect(page.copied).toBe(MESSAGE);
    const [area] = page.areas;
    expect(area.tag).toBe('textarea');
    expect(area.attributes).toEqual({ readonly: '', 'aria-hidden': 'true', tabindex: '-1' });
    expect(area.style).toMatchObject({ position: 'fixed', opacity: '0', pointerEvents: 'none' });
    expect(area.range).toEqual([0, MESSAGE.length]);
    expect(page.attached.size).toBe(0);
    // Focus goes back to what had it (the Copy button).
    expect(page.button.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('falls back when writeText rejects or throws', async () => {
    for (const writeText of [
      async () => {
        throw new DOMException('Document is not focused.', 'NotAllowedError');
      },
      () => {
        throw new TypeError('Illegal invocation');
      },
    ]) {
      const api = clipboard(writeText);
      const page = fakeDocument();
      vi.stubGlobal('document', page.document);
      expect(await copyText(MESSAGE)).toBe(true);
      expect(api.writeText).toHaveBeenCalledWith(MESSAGE);
      expect(page.copied).toBe(MESSAGE);
      expect(page.attached.size).toBe(0);
    }
  });

  it('gives false when both fail, and always removes the textarea', async () => {
    for (const copies of [false, new Error('execCommand is gone')]) {
      clipboard(async () => {
        throw new Error('denied');
      });
      const page = fakeDocument({ copies });
      vi.stubGlobal('document', page.document);
      await expect(copyText(MESSAGE)).resolves.toBe(false);
      expect(page.areas).toHaveLength(1);
      expect(page.attached.size).toBe(0);
      expect(page.button.focus).toHaveBeenCalledTimes(1);
    }
  });

  it('gives false without a page or a clipboard, and never throws', async () => {
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('document', undefined);
    await expect(copyText(MESSAGE)).resolves.toBe(false);
    vi.stubGlobal('document', { body: null, execCommand: () => true });
    await expect(copyText(MESSAGE)).resolves.toBe(false);
    vi.stubGlobal('document', { body: {}, createElement: () => ({}) });
    await expect(copyText(MESSAGE)).resolves.toBe(false);
  });

  it('copies an empty string for nothing, and a number as text', async () => {
    const api = clipboard(async () => {});
    expect(await copyText(undefined)).toBe(true);
    expect(await copyText(42)).toBe(true);
    expect(api.writeText.mock.calls).toEqual([[''], ['42']]);
  });
});

describe('the Slack preview header (CONTRACT 28)', () => {
  it('has a Copy button named Copy Slack message, top right, and a quiet live region', () => {
    const entry = {
      ...newEntry({ projectId: 3, name: 'Acme store' }),
      hours: '2h',
      tasks: [{ ...newTask('done'), title: 'Write the FAQ' }],
    };
    ctx.current = {
      data: {
        user: { name: 'Priya Sharma', initials: 'PS' },
        slackLines: { draft: 'Posts to #daily-reports when you submit', submitted: '' },
        previewTime: '6:28 PM',
      },
      entries: [entry],
      report: { status: 'draft', workDate: '2026-11-12' },
    };
    const html = renderToStaticMarkup(createElement(SlackPreview));
    const header = html.slice(0, html.indexOf('Priya Sharma</span>'));
    const button = header.match(/<button[^>]*>.*?<\/button>/)?.[0] ?? '';
    expect(button).toContain('aria-label="Copy Slack message"');
    expect(button).toContain('lucide-copy');
    expect(button).toContain('lucide-check');
    expect(button).not.toContain('data-copied');
    expect(button.replace(/<[^>]+>/g, '')).toBe('Copy');
    // The button comes after the title and subtitle, in the header's actions.
    expect(header.indexOf('Posts to #daily-reports')).toBeLessThan(header.indexOf('<button'));
    expect(header).toMatch(/<span class="visually-hidden" role="status"><\/span>/);
    // What it copies is the message the preview shows.
    expect(html).toContain('Project: Acme store');
    expect(html).toContain('• Write the FAQ (Done)');
  });
});
