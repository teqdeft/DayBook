// Every sentence of the move region (CONTRACT 28, Motion, Keyboard move and the live region: Words),
// exactly as the table gives it; moveWords.js is pure.
import { describe, expect, it } from 'vitest';
import {
  MOVE_HELP,
  backText,
  cancelText,
  dropText,
  goneText,
  liftText,
  nameOf,
  overText,
  sortedText,
  stayText,
} from '@/app/(app)/projects/[id]/_board/moveWords';

const TITLE = 'Checkout fix before client demo';

describe('moveWords', () => {
  it('lifts: the keyboard line tells the keys, the pointer line only the card', () => {
    expect(liftText(TITLE, 'development', 'keyboard')).toBe(
      'Picked up Checkout fix before client demo, in Development. Use the Left and Right arrow keys to choose a phase, Space to drop, Escape to cancel.',
    );
    expect(liftText('Payment settings page', 'development', 'pointer')).toBe(
      'Picked up Payment settings page.',
    );
  });

  it('over a column: the place for the keyboard, the name for the pointer', () => {
    expect(overText('testing', 1, 5, 'keyboard')).toBe('Over Testing. It goes in at 2 of 6.');
    expect(overText('testing', 1, 5, 'pointer')).toBe('Over Testing.');
  });

  it('back over its own column', () => {
    expect(backText('development')).toBe('Back in Development.');
    expect(backText('none')).toBe('Back in No phase yet.');
    expect(backText(null)).toBe('Back in No phase yet.');
  });

  it('drop, stay, cancel and a task moved away', () => {
    expect(dropText(TITLE, 'testing', 'development')).toBe(
      'Moved Checkout fix before client demo to Testing from Development.',
    );
    expect(stayText(TITLE, 'development')).toBe(
      'Checkout fix before client demo stays in Development.',
    );
    expect(stayText(TITLE, 'none')).toBe('Checkout fix before client demo stays in No phase yet.');
    expect(cancelText(TITLE, 'development')).toBe(
      'Move cancelled. Checkout fix before client demo is back in Development.',
    );
    expect(goneText()).toBe('Move cancelled.');
  });

  it('Up or Down', () => {
    expect(sortedText()).toBe('Cards are sorted by priority, so it goes in its place.');
  });

  it('the help every grip points at', () => {
    expect(MOVE_HELP).toBe(
      'Press Space to pick up. Use the Left and Right arrow keys to choose a phase. Press Space to drop or Escape to cancel.',
    );
  });

  it('names a phase key, a phase name, or No phase yet', () => {
    expect(nameOf('requirement_gathering')).toBe('Requirement gathering');
    expect(nameOf('Launch')).toBe('Launch');
    expect(nameOf(undefined)).toBe('No phase yet');
  });
});
