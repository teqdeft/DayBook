// Range for file downloads (CONTRACT 27, Downloads): one range only; several ranges, garbage or an
// invalid range mean the whole file; a valid range outside the file is unsatisfiable (416).
import { describe, expect, it } from 'vitest';
import { contentRange, parseRange, unsatisfiedRange } from '@/modules/projectFiles/ranges';

describe('parseRange', () => {
  it.each([
    ['bytes=0-99', 1000, { start: 0, end: 99 }],
    ['bytes=100-', 1000, { start: 100, end: 999 }],
    ['bytes=-500', 1000, { start: 500, end: 999 }],
    ['bytes=-5000', 1000, { start: 0, end: 999 }],
    ['bytes=990-2000', 1000, { start: 990, end: 999 }],
    ['bytes=999-999', 1000, { start: 999, end: 999 }],
    ['Bytes = 10-19', 1000, { start: 10, end: 19 }],
  ])('%s of %d bytes', (header, size, range) => {
    expect(parseRange(header, size)).toEqual(range);
  });

  it.each([
    ['bytes=0-', 0],
    ['bytes=1000-', 1000],
    ['bytes=1000-1200', 1000],
    ['bytes=-0', 1000],
    ['bytes=-10', 0],
    ['bytes=99999999999-', 1000],
  ])('%s of %d bytes is unsatisfiable', (header, size) => {
    expect(parseRange(header, size)).toBe('unsatisfiable');
  });

  it.each([
    [undefined],
    [null],
    [''],
    ['bytes=5-1'],
    ['bytes=0-1,5-9'],
    ['bytes=0-99, 200-299'],
    ['items=0-9'],
    ['bytes='],
    ['bytes=-'],
    ['bytes=a-b'],
    ['bytes=1.5-2'],
    ['bytes=0-99999999999999999999'],
    ['garbage'],
  ])('%s is the whole file', (header) => {
    expect(parseRange(header, 1000)).toBe('all');
  });
});

describe('Content-Range', () => {
  it('names the bytes sent, or the size for a 416', () => {
    expect(contentRange(0, 99, 1000)).toBe('bytes 0-99/1000');
    expect(unsatisfiedRange(1000)).toBe('bytes */1000');
  });
});
