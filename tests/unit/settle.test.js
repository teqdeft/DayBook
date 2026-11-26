// The drop and fly-back times (CONTRACT 28, Motion, Moments: Drop and Cancel; settle.js):
// min(400, 250 + distance / 1500 × 150) ms, a cancel 0.6 of that, nothing with reduce motion.
import { describe, expect, it } from 'vitest';
import { cancelDuration, distanceBetween, dropDuration } from '@/lib/motion/settle';

describe('dropDuration', () => {
  it('grows with the distance from 250 to 400 ms', () => {
    expect(dropDuration(0)).toBe(250);
    expect(dropDuration(750)).toBe(325);
    expect(dropDuration(1500)).toBe(400);
    expect(dropDuration(3000)).toBe(400);
  });

  it('treats a negative or missing distance as none', () => {
    expect(dropDuration(-40)).toBe(250);
    expect(dropDuration(undefined)).toBe(250);
    expect(dropDuration(Number.NaN)).toBe(250);
  });

  it('is 0 with reduce motion', () => {
    expect(dropDuration(0, true)).toBe(0);
    expect(dropDuration(900, true)).toBe(0);
  });
});

describe('cancelDuration', () => {
  it('is 0.6 of the drop time: 150 to 240 ms', () => {
    expect(cancelDuration(0)).toBe(150);
    expect(cancelDuration(750)).toBe(195);
    expect(cancelDuration(1500)).toBe(240);
    expect(cancelDuration(5000)).toBe(240);
  });

  it('is 0 with reduce motion', () => {
    expect(cancelDuration(600, true)).toBe(0);
  });
});

describe('distanceBetween', () => {
  it('is the straight line between two top left corners', () => {
    expect(distanceBetween({ left: 0, top: 0 }, { left: 300, top: 400 })).toBe(500);
    expect(distanceBetween({ left: 10, top: 10 }, { left: 10, top: 10 })).toBe(0);
  });
});
