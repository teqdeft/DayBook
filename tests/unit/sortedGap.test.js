// Where a dragged card would land (CONTRACT 28, Motion, Pointer drag: "Gap at the sorted place";
// sortedGap.js): the column under the card that takes it (the preview's centre across; its centre or
// the pointer up and down), its sorted place (P1, P2, P3, then due date, then title), the gap's top,
// the room and the "2 of 6" words.
import { describe, expect, it } from 'vitest';
import {
  gapIndex,
  gapTop,
  hitColumn,
  positionText,
  roomShift,
} from '@/app/(app)/projects/[id]/_board/sortedGap';

const column = (key, left, accepts = true) => ({
  key,
  accepts,
  rect: { left, right: left + 280, top: 200, bottom: 900 },
});

describe('hitColumn', () => {
  const columns = [
    column('development', 100, false),
    column('testing', 400),
    column('launch', 700),
  ];

  it('is the column under the preview centre', () => {
    expect(hitColumn(columns, { x: 500, y: 300 })?.key).toBe('testing');
    expect(hitColumn(columns, { x: 700, y: 899 })?.key).toBe('launch');
  });

  it('ignores columns that do not take the card (its own, the rail, No phase yet)', () => {
    expect(hitColumn(columns, { x: 200, y: 300 })).toBeNull();
  });

  it('is null between columns, above or below them, or without a centre', () => {
    expect(hitColumn(columns, { x: 390, y: 300 })).toBeNull();
    expect(hitColumn(columns, { x: 500, y: 150 })).toBeNull();
    expect(hitColumn(columns, null)).toBeNull();
  });

  it('up and down takes the centre or the pointer: a tall card held by its top, low in a column', () => {
    const low = { x: 500, y: 1040 }; // the centre is below the column
    expect(hitColumn(columns, low)).toBeNull();
    expect(hitColumn(columns, low, { x: 400, y: 880 })?.key).toBe('testing');
    expect(hitColumn(columns, low, { x: 400, y: 900 })?.key).toBe('testing');
    // the other way round: held by its foot, the pointer is already below
    expect(hitColumn(columns, { x: 500, y: 880 }, { x: 400, y: 960 })?.key).toBe('testing');
  });

  it('across only the centre decides, wherever the pointer is', () => {
    expect(hitColumn(columns, { x: 500, y: 1040 }, { x: 800, y: 880 })?.key).toBe('testing');
    expect(hitColumn(columns, { x: 390, y: 300 }, { x: 420, y: 300 })).toBeNull();
  });

  it('is null with both the centre and the pointer above or below, or where it is not taken', () => {
    expect(hitColumn(columns, { x: 500, y: 1040 }, { x: 400, y: 901 })).toBeNull();
    expect(hitColumn(columns, { x: 500, y: 190 }, { x: 400, y: 120 })).toBeNull();
    expect(hitColumn(columns, { x: 200, y: 1040 }, { x: 200, y: 880 })).toBeNull();
    expect(hitColumn(columns, null, { x: 500, y: 300 })).toBeNull();
  });

  it('never hits a column clipped away by the board (no width left)', () => {
    const clipped = [
      { key: 'support', accepts: true, rect: { left: 900, right: 900, top: 0, bottom: 900 } },
    ];
    expect(hitColumn(clipped, { x: 900, y: 10 })).toBeNull();
    expect(hitColumn(clipped, { x: 900, y: 1200 }, { x: 900, y: 10 })).toBeNull();
  });
});

describe('gapIndex', () => {
  const open = [
    { id: 1, title: 'Alpha', priority: 'p1', dueDate: '2026-11-20' },
    { id: 2, title: 'Beta', priority: 'p2', dueDate: '2026-11-21' },
    { id: 3, title: 'Gamma', priority: 'p2', dueDate: null },
    { id: 4, title: 'Delta', priority: 'p3', dueDate: '2026-11-01' },
  ];

  it('puts P1 before P2 before P3', () => {
    expect(gapIndex(open, { id: 9, title: 'Zed', priority: 'p1', dueDate: '2026-12-31' })).toBe(1);
    expect(gapIndex(open, { id: 9, title: 'Zed', priority: 'p3', dueDate: '2026-12-31' })).toBe(4);
  });

  it('then by due date (no date last), then by title', () => {
    expect(gapIndex(open, { id: 9, title: 'Zed', priority: 'p2', dueDate: '2026-11-20' })).toBe(1);
    expect(gapIndex(open, { id: 9, title: 'Aa', priority: 'p2', dueDate: '2026-11-21' })).toBe(1);
    expect(gapIndex(open, { id: 9, title: 'Ca', priority: 'p2', dueDate: '2026-11-21' })).toBe(2);
    expect(gapIndex(open, { id: 9, title: 'Zed', priority: 'p2', dueDate: null })).toBe(3);
  });

  it('is 0 in an empty column', () => {
    expect(gapIndex([], { id: 9, title: 'Zed', priority: 'p2' })).toBe(0);
  });
});

describe('gapTop', () => {
  const list = { top: 300 };
  const cards = [
    { offsetTop: 0, offsetHeight: 100 },
    { offsetTop: 112, offsetHeight: 90 },
  ];

  it('is the top of the card the gap goes before', () => {
    expect(gapTop(list, cards, 0, 12)).toBe(300);
    expect(gapTop(list, cards, 1, 12)).toBe(412);
  });

  it('is one row gap after the last card', () => {
    expect(gapTop(list, cards, 2, 12)).toBe(514);
  });

  it("is the empty list's own top", () => {
    expect(gapTop(list, [], 0, 12)).toBe(300);
  });
});

describe('roomShift', () => {
  it('moves only the cards at and after the gap, by the height plus the row gap', () => {
    expect(roomShift(0, 2, 120, 12)).toBe(0);
    expect(roomShift(1, 2, 120, 12)).toBe(0);
    expect(roomShift(2, 2, 120, 12)).toBe(132);
    expect(roomShift(5, 2, 120, 12)).toBe(132);
  });
});

describe('positionText', () => {
  it('counts from 1 among the open cards plus the dragged one', () => {
    expect(positionText(0, 0)).toBe('1 of 1');
    expect(positionText(1, 5)).toBe('2 of 6');
  });
});
