// The daily report's hours boxes (reportHours.js) and how the editor rows carry them: exact
// minutes shown as '2h 15m', any form parseDuration reads, saves that send whole minutes, and
// totals and the Slack preview to the minute (company request: "8h 30m", not "2.25").
import { describe, expect, it } from 'vitest';
import {
  entryMinutes,
  firstHoursError,
  normalizeHours,
  parseHours,
  TIME_FORMAT_ERROR,
  timeText,
  timeToSend,
  totalMinutes,
} from '@/app/(app)/report/reportHours';
import {
  entriesFromView,
  mapFieldErrors,
  newEntry,
  previewEntries,
  serialize,
} from '@/app/(app)/report/reportState';
import { formatReport } from '@/modules/slack/format';

/** An editor row with this box text and last valid minutes. */
function row(hours, savedMinutes = 0, rest = {}) {
  return {
    ...newEntry({ projectId: 5, name: 'internal-tool' }),
    id: 1,
    hours,
    savedMinutes,
    tasks: [{ key: 't-a', id: 9, title: 'Backend', status: 'done' }],
    ...rest,
  };
}

describe('parseHours (the box as typed)', () => {
  it('reads every form to the minute', () => {
    expect(parseHours('2h 15m')).toEqual({ minutes: 135 });
    expect(parseHours('2h15m')).toEqual({ minutes: 135 });
    expect(parseHours('2:15')).toEqual({ minutes: 135 });
    expect(parseHours('2.25')).toEqual({ minutes: 135 });
    expect(parseHours('2,25')).toEqual({ minutes: 135 });
    expect(parseHours('2h 5m')).toEqual({ minutes: 125 });
    expect(parseHours('7.75')).toEqual({ minutes: 465 });
    expect(parseHours('45m')).toEqual({ minutes: 45 });
    expect(parseHours(' 6.5 ')).toEqual({ minutes: 390 });
  });

  it('counts an empty box as 0 while drafting', () => {
    expect(parseHours('')).toEqual({ minutes: 0 });
    expect(parseHours('   ')).toEqual({ minutes: 0 });
    expect(parseHours(undefined)).toEqual({ minutes: 0 });
  });

  it('says how to write it, and says so separately for more than 24 hours', () => {
    expect(TIME_FORMAT_ERROR).toBe('Enter time like 2h 15m');
    expect(parseHours('abc')).toEqual({ error: TIME_FORMAT_ERROR });
    expect(parseHours('2h 75m')).toEqual({ error: TIME_FORMAT_ERROR });
    expect(parseHours('-1')).toEqual({ error: TIME_FORMAT_ERROR });
    // "8.30" may mean 8h 30m: refused, never saved as 8.3 hours (8h 18m).
    expect(parseHours('8.30')).toEqual({ error: TIME_FORMAT_ERROR });
    expect(parseHours('1.30')).toEqual({ error: TIME_FORMAT_ERROR });
    expect(parseHours('2.05')).toEqual({ error: TIME_FORMAT_ERROR });
    expect(parseHours('25')).toEqual({ error: 'Hours must be 24 or less.' });
    expect(parseHours('24h 1m')).toEqual({ error: 'Hours must be 24 or less.' });
    expect(parseHours('24h')).toEqual({ minutes: 1440 });
  });
});

describe('what a box shows', () => {
  it('writes minutes as hours and minutes, empty for 0', () => {
    expect(timeText(135)).toBe('2h 15m');
    expect(timeText(125)).toBe('2h 5m');
    expect(timeText(120)).toBe('2h');
    expect(timeText(45)).toBe('45m');
    expect(timeText(765)).toBe('12h 45m');
    expect(timeText(0)).toBe('');
    expect(timeText(null)).toBe('');
  });

  it('tidies a valid entry when the person leaves the box, and leaves a wrong one as typed', () => {
    expect(normalizeHours('2.25')).toBe('2h 15m');
    expect(normalizeHours('2:05')).toBe('2h 5m');
    expect(normalizeHours('6.5')).toBe('6h 30m');
    expect(normalizeHours('2H15M')).toBe('2h 15m');
    expect(normalizeHours('90m')).toBe('1h 30m');
    expect(normalizeHours('2h 15m')).toBe('2h 15m');
    expect(normalizeHours('0')).toBe('');
    expect(normalizeHours('')).toBe('');
    expect(normalizeHours('2h 75m')).toBe('2h 75m');
    expect(normalizeHours('8.30')).toBe('8.30');
    expect(normalizeHours('abc')).toBe('abc');
  });

  it('loads a saved report as hours and minutes, from minutes (or hours on older copies)', () => {
    const [exact, older, none] = entriesFromView({
      entries: [
        { id: 1, projectId: 5, projectName: 'a', minutes: 125, hours: 2.08, tasks: [] },
        { id: 2, projectId: 6, projectName: 'b', hours: 2.25, tasks: [] },
        { id: 3, projectId: 7, projectName: 'c', minutes: 0, hours: 0, tasks: [] },
      ],
    });
    expect(exact).toMatchObject({ hours: '2h 5m', savedMinutes: 125 });
    expect(older).toMatchObject({ hours: '2h 15m', savedMinutes: 135 });
    expect(none).toMatchObject({ hours: '', savedMinutes: 0 });
  });
});

describe('what a save sends', () => {
  it('sends whole minutes when the box is valid, never a rounded value', () => {
    expect(timeToSend(row('2h 5m', 0))).toEqual({ minutes: 125 });
    expect(timeToSend(row('2.25', 0))).toEqual({ minutes: 135 });
    expect(timeToSend(row('8:30', 0))).toEqual({ minutes: 510 });
    expect(timeToSend(row('', 60))).toEqual({ minutes: 0 });
  });

  it('sends a wrong box as typed, so the server refuses it under that field', () => {
    expect(timeToSend(row('2h 75m', 120))).toEqual({ hours: '2h 75m' });
    expect(timeToSend(row('8.30', 120))).toEqual({ hours: '8.30' });
    expect(timeToSend(row(' 25 ', 120))).toEqual({ hours: '25' });
  });

  it('keeps the last valid minutes only for the save on leaving the page', () => {
    expect(timeToSend(row('abc', 125), { keepLastValid: true })).toEqual({ minutes: 125 });
    // A backup written by an older page has savedHours instead.
    const older = { ...row('abc'), savedMinutes: undefined, savedHours: 2.5 };
    expect(timeToSend(older, { keepLastValid: true })).toEqual({ minutes: 150 });
  });

  it('puts the time in the body in place of hours', () => {
    const { body } = serialize([row('2h 5m', 125), row('oops', 30)]);
    expect(body[0]).toEqual({
      id: 1,
      projectId: 5,
      projectRequestId: undefined,
      minutes: 125,
      tasks: [{ id: 9, title: 'Backend', status: 'done', projectTaskId: undefined }],
    });
    expect(body[0]).not.toHaveProperty('hours');
    expect(body[1]).toMatchObject({ hours: 'oops' });
    expect(body[1]).not.toHaveProperty('minutes');
  });

  it('shows a minutes or hours error from the server under the hours box', () => {
    const rows = [row('2h', 120)];
    const { keys } = serialize(rows);
    const errors = mapFieldErrors(
      {
        'entries.0.minutes': 'Hours must be 24 or less.',
        'entries.0.tasks.0.title': 'Write at least 2 characters.',
      },
      keys,
    );
    expect(errors.entries[rows[0].key]).toEqual({ hours: 'Hours must be 24 or less.' });
    expect(errors.tasks['t-a']).toBe('Write at least 2 characters.');
    const hours = mapFieldErrors({ 'entries.0.hours': TIME_FORMAT_ERROR }, keys);
    expect(hours.entries[rows[0].key]).toEqual({ hours: TIME_FORMAT_ERROR });
  });
});

describe('totals and the Slack preview', () => {
  it('count exact minutes, and the last valid value of a wrong box', () => {
    const rows = [row('2h 5m', 125), row('6.5', 390), row('2h 75m', 10)];
    expect(entryMinutes(rows[0])).toBe(125);
    expect(entryMinutes(rows[2])).toBe(10);
    expect(totalMinutes(rows)).toBe(525);
    expect(firstHoursError(rows)).toEqual({ entryKey: rows[2].key, message: TIME_FORMAT_ERROR });
    expect(firstHoursError(rows.slice(0, 2))).toBeNull();
  });

  it('builds the Slack text with hours and minutes', () => {
    const text = formatReport({
      userName: 'Vishal Saini',
      workDate: '2026-09-30',
      entries: previewEntries([row('2h 5m', 125, { projectName: 'internal-tool' })]),
    });
    expect(text).toContain('Hours: 2h 5m');
    expect(text).not.toContain('2.08');
  });
});
