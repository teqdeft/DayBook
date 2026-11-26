// Moving a card with its Undo (CONTRACT 27, Board tab; boardMoves.js): a drop only on another
// phase column, never on No phase yet or Done phases; the six targets of Move to phase…; the
// optimistic move and its Undo; where a dragged card lands and what to focus after it leaves.
// Split from boardView.test.js by CONTRACT 28, Files and owners.
import { describe, expect, it } from 'vitest';
import {
  canDropOn,
  landingIndex,
  moveBody,
  moveOf,
  moveTargets,
  movedText,
  nextCardAfter,
  pendingMoves,
  undoOf,
  withMoves,
} from '@/app/(app)/projects/[id]/_board/boardMoves';
import { NO_PHASE } from '@/app/(app)/projects/[id]/phasesView';

const task = (id, more = {}) => ({
  id,
  title: `Task ${id}`,
  priority: 'p2',
  status: 'open',
  phase: 'development',
  dueDate: null,
  fileCount: 0,
  ...more,
});

describe('moving a card', () => {
  const card = task(7, { title: 'Fix the login page', phase: 'design' });

  it('takes a drop only on another phase column, never on No phase yet or Done phases', () => {
    expect(canDropOn(card, 'testing')).toBe(true);
    expect(canDropOn(card, 'design')).toBe(false);
    expect(canDropOn(card, NO_PHASE)).toBe(false);
    expect(canDropOn(card, 'done-phases')).toBe(false);
    expect(canDropOn({ ...card, status: 'done' }, 'testing')).toBe(false);
    expect(canDropOn({ ...card, phase: null }, 'design')).toBe(true);
  });

  it('lists the six phases, its own as here now', () => {
    const rows = moveTargets(card, { design: { total: 8, done: 7 } });
    expect(rows).toHaveLength(6);
    expect(rows[1]).toEqual({
      key: 'design',
      label: 'Design (here now)',
      count: '7 of 8',
      here: true,
    });
    expect(rows[5]).toEqual({
      key: 'support',
      label: 'Support',
      count: 'No tasks yet',
      here: false,
    });
  });

  it('moves at once and takes it back with Undo', () => {
    const move = moveOf(card, 'testing');
    expect(move).toEqual({ taskId: 7, from: 'design', to: 'testing' });
    expect(movedText(move.to)).toBe('Moved to Testing.');
    expect(undoOf(move)).toEqual({ taskId: 7, from: 'testing', to: 'design' });
    expect(moveBody(undoOf(move))).toEqual({ phase: 'design' });
    const fromNone = moveOf({ id: 8, phase: null }, 'design');
    expect(moveBody(undoOf(fromNone))).toEqual({ phase: null });

    const moves = new Map([[7, 'testing']]);
    expect(withMoves([card], moves)[0].phase).toBe('testing');
    expect(pendingMoves(moves, [card])).toBe(moves);
    expect(pendingMoves(moves, [{ ...card, phase: 'testing' }]).size).toBe(0);
  });

  it('finds where a dragged card lands and what to focus after it leaves', () => {
    const column = [task(1, { priority: 'p1' }), task(2, { title: 'A' }), task(3, { title: 'Z' })];
    expect(landingIndex(column, { ...card, priority: 'p2', title: 'M' })).toBe(2);
    expect(landingIndex(column, { ...card, priority: 'p1', title: 'A' })).toBe(0);
    expect(nextCardAfter(column, 2)).toBe(3);
    expect(nextCardAfter(column, 3)).toBe(2);
    expect(nextCardAfter([task(1)], 1)).toBeNull();
  });
});
