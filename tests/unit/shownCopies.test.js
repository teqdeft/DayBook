// The Table and the phone's stacked list both draw each task (CONTRACT 28, Table and bulk bar; CSS
// shows one), so a change of person flashes the row where it is shown (useAssign's placeOf), not
// the hidden copy that comes first in the page; a card on the Board still wins.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => () => {} }));
vi.mock('@/lib/apiClient', () => ({ api: {} }));
vi.mock('@/lib/motion/animate', () => ({ flash() {} }));

const { placeOf } = await import('@/app/(app)/projects/[id]/_board/useAssign.js');

/** An element of the fake page: shown (a box) or not (display: none above it). */
const node = (flip, shown) => ({
  flip,
  isConnected: true,
  getClientRects: () => (shown ? [{ width: 1, height: 1 }] : []),
});

function page(nodes) {
  const matching = (selector) => {
    const flip = /data-flip="([^"]+)"/.exec(selector)[1];
    return nodes.filter((one) => one.flip === flip);
  };
  globalThis.document = {
    querySelector: (selector) => matching(selector)[0] ?? null,
    querySelectorAll: (selector) => matching(selector),
  };
}

afterEach(() => {
  delete globalThis.document;
});

describe('where a change of person plays', () => {
  it("takes the phone list's row when the table's copy is hidden", () => {
    const hidden = node('row:8', false);
    const shown = node('row:8', true);
    page([hidden, shown]);
    expect(placeOf(8)).toEqual({ row: shown });
  });

  it("takes the table's row on a computer, and the card on the Board", () => {
    const table = node('row:8', true);
    page([table, node('row:8', false)]);
    expect(placeOf(8)).toEqual({ row: table });
    const card = node('card:8', true);
    page([card, table]);
    expect(placeOf(8)).toEqual({ card });
  });

  it('finds nothing when no copy is shown, and nothing on the server', () => {
    page([node('row:8', false)]);
    expect(placeOf(8)).toEqual({ row: null });
    delete globalThis.document;
    expect(placeOf(8)).toEqual({});
  });
});
