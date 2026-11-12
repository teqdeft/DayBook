// The AI summary card's buttons (CONTRACT 22): Write summary, Update summary and Add to tasks keep
// keyboard focus while they work, so they are aria-disabled, never disabled, and every button in the
// card is secondary, as in the prototype: the Overview's one primary button is the phase move.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => '/projects/5',
  useSearchParams: () => new URLSearchParams(),
}));

const { default: BusyButton } = await import('@/app/(app)/projects/[id]/BusyButton.jsx');
const { default: SummaryCard } = await import('@/app/(app)/projects/[id]/SummaryCard.jsx');

const card = (props) =>
  renderToStaticMarkup(
    createElement(SummaryCard, {
      projectId: 5,
      status: 'active',
      available: true,
      counts: { files: 1, notes: 1 },
      summary: null,
      currentPhase: 'design',
      ...props,
    }),
  );

const summaryOf = (overrides = {}) => ({
  body: {
    overview: 'The clinic wants online booking.',
    actions: [{ key: 'a1', owner: 'client', text: 'Send the logo', dueAsWritten: 'Friday' }],
  },
  stale: false,
  truncated: false,
  sources: { files: 1, notes: 1 },
  ...overrides,
});

/** Every <button …> start tag in the markup. */
const buttons = (html) => html.match(/<button[^>]*>/g) ?? [];

describe('BusyButton', () => {
  it('stays focusable while busy: aria-disabled and aria-busy, never disabled', () => {
    const html = renderToStaticMarkup(
      createElement(BusyButton, { busy: true, variant: 'secondary', onClick: () => {} }, 'Working'),
    );
    const [tag] = buttons(html);
    expect(tag).toContain('aria-disabled="true"');
    expect(tag).toContain('aria-busy="true"');
    expect(tag).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(html).toContain('lucide-loader-circle');
  });

  it('is an ordinary button when it isn’t busy', () => {
    const html = renderToStaticMarkup(
      createElement(BusyButton, { busy: false, onClick: () => {} }, 'Write summary'),
    );
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toContain('aria-busy');
    expect(html).not.toContain('lucide-loader-circle');
  });
});

describe('the summary card’s buttons', () => {
  it('draws Write summary as a secondary button, focusable, with no second primary', () => {
    const html = card();
    expect(html).toContain('Write summary');
    const [write] = buttons(html);
    expect(write).toMatch(/_secondary_/);
    expect(write).not.toMatch(/_primary_|\sdisabled/);
  });

  it('draws Update summary and Add to tasks as secondary buttons that never disable', () => {
    const html = card({ summary: summaryOf({ stale: true }) });
    expect(html).toContain('Update summary');
    expect(html).toContain('aria-label="Add to tasks: Send the logo"');
    const tags = buttons(html).filter((tag) => !tag.includes('aria-expanded'));
    expect(tags).toHaveLength(2);
    for (const tag of tags) {
      expect(tag).toMatch(/_secondary_/);
      expect(tag).not.toMatch(/\sdisabled/);
    }
  });

  it('lets an added item and the card title take focus when their button goes away', () => {
    const html = card({
      summary: summaryOf({
        body: { actions: [{ key: 'a1', owner: 'us', text: 'Share the wireframes', taskId: 9 }] },
      }),
    });
    expect(html).toMatch(/<span id="summary-added-a1" tabindex="-1"[^>]*>Added<\/span>/);
    expect(html).toMatch(/<h2 id="overview-ai" tabindex="-1"/);
  });
});
