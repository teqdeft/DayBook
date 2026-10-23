// parseDuration (@/lib/time): the time people type in the daily report's hours box, read to the
// minute (company request: "8h 30m", exact minutes, no 0.25-hour steps).
import { describe, expect, it } from 'vitest';
import { formatDuration, MAX_DURATION_MINUTES, parseDuration } from '@/lib/time';

describe('parseDuration', () => {
  it.each([
    ['2h 15m', 135],
    ['2h15m', 135],
    ['2 h 15 m', 135],
    ['2h  15m', 135],
    ['2h 05m', 125],
    ['2h 5m', 125],
    ['2h', 120],
    ['2 h', 120],
    ['15m', 15],
    ['15 m', 15],
    ['15 min', 15],
    ['15min', 15],
    ['15 mins', 15],
    ['15 minutes', 15],
    ['1 minute', 1],
    ['2 hrs 15 mins', 135],
    ['2hr', 120],
    ['2 hours 30 minutes', 150],
    ['1 hour', 60],
    ['90m', 90],
    ['0m', 0],
  ])('reads hours and minutes: %j -> %i', (text, minutes) => {
    expect(parseDuration(text)).toBe(minutes);
  });

  it.each([
    ['2:15', 135],
    ['2:05', 125],
    ['0:45', 45],
    ['12:45', 765],
    ['24:00', 1440],
  ])('reads clock style: %j -> %i', (text, minutes) => {
    expect(parseDuration(text)).toBe(minutes);
  });

  it.each([
    ['2', 120],
    ['2.25', 135],
    ['2,25', 135],
    ['2.5', 150],
    ['0.5', 30],
    ['.5', 30],
    ['2.', 120],
    ['6.5', 390],
    ['7.50', 450],
    ['0.75', 45],
    ['0', 0],
    ['24', 1440],
    ['1.5h', 90],
    ['2.25 hrs', 135],
  ])('reads decimal hours in 0.25-hour steps: %j -> %i', (text, minutes) => {
    expect(parseDuration(text)).toBe(minutes);
  });

  it('refuses other decimals, which people write for hours and minutes ("8.30" = 8h 30m)', () => {
    // Read as decimal hours they would quietly become something else: 8.30 -> 8h 18m.
    for (const text of ['8.30', '1.30', '2.05', '8.15', '1.45', '8,30', '8.3', '2.1', '2.0833']) {
      expect(parseDuration(text)).toBeNull();
    }
    expect(parseDuration('8.30 hrs')).toBeNull();
    expect(parseDuration('8.3h')).toBeNull();
    // The exact forms say it without doubt.
    expect(parseDuration('8h 30m')).toBe(510);
    expect(parseDuration('8:30')).toBe(510);
  });

  it('ignores case and surrounding spaces', () => {
    expect(parseDuration('  2H 15M  ')).toBe(135);
    expect(parseDuration('\t2h 15m\n')).toBe(135);
    expect(parseDuration(' 2:15 ')).toBe(135);
    expect(parseDuration('2 HOURS')).toBe(120);
    expect(parseDuration('15 Min')).toBe(15);
  });

  it('takes a bare number after hours as minutes, and every step of typing a unit', () => {
    // So the box doesn't flag "2h 1" while someone is on their way to "2h 15m".
    expect(parseDuration('2h 15')).toBe(135);
    expect(parseDuration('2h 1')).toBe(121);
    expect(parseDuration('2ho')).toBe(120);
    expect(parseDuration('2hou')).toBe(120);
    expect(parseDuration('2h 15mi')).toBe(135);
    expect(parseDuration('2h 15minu')).toBe(135);
    expect(parseDuration('2h 15minut')).toBe(135);
  });

  it('takes numbers as decimal hours', () => {
    expect(parseDuration(2)).toBe(120);
    expect(parseDuration(1.5)).toBe(90);
    expect(parseDuration(0)).toBe(0);
  });

  it.each([
    '-2',
    '-2h',
    '-0:30',
    '2h -15m',
    'abc',
    'h',
    'm',
    'hm',
    '2 15',
    '2:5',
    '2h:15',
    '15m 2h',
    '2h 15m 3h',
    '2.5h 15m',
    '2x',
    '2 hours and 15 minutes',
    '1e1',
    'Infinity',
    'NaN',
    '2..5',
    '2.5.1',
    ':30',
  ])('refuses %j', (text) => {
    expect(parseDuration(text)).toBeNull();
  });

  it('refuses 60 or more minutes next to hours, but not minutes on their own', () => {
    expect(parseDuration('2h 60m')).toBeNull();
    expect(parseDuration('2h 75m')).toBeNull();
    expect(parseDuration('0h 75m')).toBeNull();
    expect(parseDuration('2:60')).toBeNull();
    expect(parseDuration('2:75')).toBeNull();
    expect(parseDuration('2h 59m')).toBe(179);
    expect(parseDuration('75m')).toBe(75);
  });

  it('refuses more than 24 hours, or another limit', () => {
    expect(MAX_DURATION_MINUTES).toBe(1440);
    expect(parseDuration('24h')).toBe(1440);
    expect(parseDuration('24h 1m')).toBeNull();
    expect(parseDuration('24:01')).toBeNull();
    expect(parseDuration('25')).toBeNull();
    expect(parseDuration('1441m')).toBeNull();
    expect(parseDuration('24.5')).toBeNull();
    expect(parseDuration('99999999999999999999')).toBeNull();
    expect(parseDuration('25h', { max: Infinity })).toBe(1500);
    expect(parseDuration('2h', { max: 60 })).toBeNull();
    expect(parseDuration('1h', { max: 60 })).toBe(60);
  });

  it('gives null for nothing at all', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('   ')).toBeNull();
    expect(parseDuration(null)).toBeNull();
    expect(parseDuration(undefined)).toBeNull();
  });

  it('reads back what formatDuration writes, for every minute of a day', () => {
    for (let minutes = 1; minutes <= MAX_DURATION_MINUTES; minutes += 1) {
      expect(parseDuration(formatDuration(minutes))).toBe(minutes);
    }
  });
});
