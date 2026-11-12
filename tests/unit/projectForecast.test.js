// Project health (CONTRACT 22, "Forecast"): every row of the table in order, the speed from the last
// full weeks, the rounding, a young project's weeks, the singular wording and the design's numbers.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  compareHealth,
  forecastProject,
  healthTone,
  speedText,
  weeksCounted,
} from '@/modules/projectPlan/forecast';

const TODAY = '2026-10-30'; // a Friday; this Monday is 26 October
const DEADLINE = '2026-12-15';
const OLD = '2026-01-05';

/** A running project with tasks left, old enough for all 3 weeks, at a speed of 4 a week. */
function forecast(overrides = {}) {
  return forecastProject({
    status: 'active',
    total: 50,
    done: 16,
    doneByWeek: [4, 4, 4],
    deadline: DEADLINE,
    today: TODAY,
    createdOn: OLD,
    ...overrides,
  });
}

describe('the design', () => {
  it('reads 16 of 50 at a speed of 4 as off track', () => {
    expect(forecast()).toEqual({
      kind: 'off',
      pill: 'Off track',
      title: 'Off track: will miss the deadline by about 14 days',
      body:
        'At the current speed (4 tasks a week) the work ends around 29 Dec. ' +
        'To finish by 15 Dec, the team needs about 5 tasks a week.',
      pct: 32,
      done: 16,
      total: 50,
      left: 34,
      finishOn: '2026-12-29',
      daysLate: 14,
      daysLeft: 46,
      speed: 4,
      needed: 5,
    });
  });

  it('reads 17 of 50 at a speed of 4', () => {
    const result = forecast({ done: 17 });
    expect(result).toMatchObject({
      pct: 34,
      finishOn: '2026-12-27',
      daysLate: 12,
      title: 'Off track: will miss the deadline by about 12 days',
    });
    expect(result.body).toContain('the work ends around 27 Dec.');
  });
});

describe('the table, first match wins', () => {
  it('completed comes before everything else', () => {
    const result = forecast({ status: 'completed', total: 0, done: 0, deadline: null });
    expect(result).toMatchObject({
      kind: 'completed',
      pill: 'Completed',
      title: 'Completed',
      body: 'This project is completed.',
      finishOn: null,
      needed: null,
    });
  });

  it('on hold comes next, whatever the tasks and the deadline say', () => {
    expect(forecast({ status: 'on_hold', deadline: '2026-01-01' })).toMatchObject({
      kind: 'hold',
      pill: 'On hold',
      title: 'On hold',
      body: 'This project is on hold.',
      finishOn: null,
      daysLate: null,
      needed: null,
    });
  });

  it('no tasks comes before no deadline', () => {
    expect(forecast({ total: 0, done: 0, deadline: null })).toMatchObject({
      kind: 'noplan',
      pill: 'No plan yet',
      title: 'No plan yet',
      body: 'Add tasks to the phases to see if the project is on track.',
      pct: 0,
    });
  });

  it('no deadline', () => {
    expect(forecast({ deadline: null })).toMatchObject({
      kind: 'nodeadline',
      pill: 'No deadline',
      title: 'No deadline yet',
      body: 'Add a deadline to see if the project is on track.',
      daysLeft: null,
      daysLate: null,
      finishOn: '2026-12-29', // the timeline still shows when the work ends
    });
  });

  it('no tasks left comes before a passed deadline', () => {
    expect(forecast({ done: 50, deadline: '2026-10-01' })).toMatchObject({
      kind: 'on',
      pill: 'On track',
      title: 'On track: all tasks are done',
      body: 'All 50 tasks are done. The deadline is 1 Oct.',
      pct: 100,
      left: 0,
      finishOn: null,
      daysLate: null,
    });
  });

  it('a passed deadline comes before no speed', () => {
    expect(forecast({ done: 38, deadline: '2026-10-25', doneByWeek: [0, 0, 0] })).toMatchObject({
      kind: 'off',
      pill: 'Off track',
      title: 'Off track: the deadline passed 5 days ago',
      body: '12 tasks are still open.',
      daysLeft: -5,
      needed: null,
    });
  });

  it('no speed', () => {
    expect(forecast({ doneByWeek: [0, 0, 0] })).toMatchObject({
      kind: 'nodata',
      pill: 'Not enough data',
      title: 'Not enough data yet',
      body: 'Daybook works out the speed from tasks marked done in the last 3 full weeks.',
      speed: 0,
      finishOn: null,
      daysLate: null,
    });
  });

  it('more than 7 days late is off track, 8 days exactly', () => {
    // 4 tasks at 1 a week end in 28 days, on 27 November.
    const late = forecast({ total: 8, done: 4, doneByWeek: [1, 1, 1], deadline: '2026-11-19' });
    expect(late).toMatchObject({
      kind: 'off',
      finishOn: '2026-11-27',
      daysLate: 8,
      title: 'Off track: will miss the deadline by about 8 days',
    });
  });

  it('7 days late is at risk', () => {
    const result = forecast({ total: 8, done: 4, doneByWeek: [1, 1, 1], deadline: '2026-11-20' });
    expect(result).toMatchObject({
      kind: 'risk',
      pill: 'At risk',
      daysLate: 7,
      title: 'At risk: may miss the deadline by about 7 days',
    });
    expect(result.body).toBe(
      'At the current speed (1 task a week) the work ends around 27 Nov. ' +
        'To finish by 20 Nov, the team needs about 2 tasks a week.',
    );
  });

  it('1 day late is at risk', () => {
    expect(forecast({ total: 8, done: 4, deadline: '2026-11-05' })).toMatchObject({
      kind: 'risk',
      daysLate: 1,
      title: 'At risk: may miss the deadline by about 1 day',
    });
  });

  it('finishing on the deadline is on time', () => {
    const result = forecast({ total: 8, done: 4, deadline: '2026-11-06' });
    expect(result).toMatchObject({
      kind: 'on',
      pill: 'On track',
      daysLate: 0,
      title: 'On track: will finish on time',
    });
    expect(result.body).toBe(
      'At the current speed (4 tasks a week) the work ends around 6 Nov. ' +
        'The deadline is 6 Nov.',
    );
  });

  it('finishing before the deadline says how early', () => {
    expect(forecast({ total: 8, done: 4, deadline: '2026-11-11' })).toMatchObject({
      kind: 'on',
      daysLate: -5,
      title: 'On track: will finish about 5 days early',
    });
    expect(forecast({ total: 8, done: 4, deadline: '2026-11-07' }).title).toBe(
      'On track: will finish about 1 day early',
    );
  });
});

describe('the deadline is today', () => {
  it('leaves the second sentence out', () => {
    const result = forecast({ total: 8, done: 4, deadline: TODAY });
    expect(result).toMatchObject({
      kind: 'risk',
      daysLeft: 0,
      daysLate: 7,
      needed: null,
      finishOn: '2026-11-06',
    });
    expect(result.body).toBe('At the current speed (4 tasks a week) the work ends around 6 Nov.');
  });

  it("doesn't count as passed", () => {
    expect(forecast({ deadline: TODAY, doneByWeek: [0, 0, 0] }).kind).toBe('nodata');
    expect(forecast({ done: 50, deadline: TODAY }).kind).toBe('on');
  });

  it('counts as passed from the next day', () => {
    expect(forecast({ deadline: '2026-10-29' })).toMatchObject({
      kind: 'off',
      title: 'Off track: the deadline passed 1 day ago',
      daysLeft: -1,
    });
  });
});

describe('the speed', () => {
  it('is the mean of the last 3 full weeks, and reads "about" when not whole', () => {
    const result = forecast({ doneByWeek: [5, 3, 2] });
    expect(result.speed).toBeCloseTo(10 / 3);
    expect(result.body).toContain('At the current speed (about 3.3 tasks a week)');
    const halves = forecast({ doneByWeek: [4, 3, 0], createdOn: '2026-10-12' });
    expect(halves.body).toContain('At the current speed (about 3.5 tasks a week)');
  });

  it('words a whole speed without "about"', () => {
    expect(speedText(4)).toBe('4 tasks a week');
    expect(speedText(1)).toBe('1 task a week');
    expect(speedText(3.5)).toBe('about 3.5 tasks a week');
    expect(speedText(2 / 3)).toBe('about 0.7 tasks a week');
  });

  it('counts whole weeks between the creation date and this Monday', () => {
    expect(weeksCounted('2026-10-26', TODAY)).toBe(0); // created this Monday
    expect(weeksCounted('2026-10-30', TODAY)).toBe(0); // created today
    expect(weeksCounted('2026-10-20', TODAY)).toBe(0); // 6 days before this Monday
    expect(weeksCounted('2026-10-19', TODAY)).toBe(1);
    expect(weeksCounted('2026-10-13', TODAY)).toBe(1);
    expect(weeksCounted('2026-10-12', TODAY)).toBe(2);
    expect(weeksCounted('2026-10-05', TODAY)).toBe(3);
    expect(weeksCounted(OLD, TODAY)).toBe(3); // at most 3
    expect(weeksCounted(null, TODAY)).toBe(3);
  });

  it('uses only the weeks a young project has lived, newest first', () => {
    expect(forecast({ doneByWeek: [6, 9, 9], createdOn: '2026-10-19' }).speed).toBe(6);
    expect(forecast({ doneByWeek: [6, 2, 9], createdOn: '2026-10-12' }).speed).toBe(4);
  });

  it('is 0 in a project\'s first week, whatever is done, so "not enough data"', () => {
    const result = forecast({ doneByWeek: [6, 6, 6], createdOn: '2026-10-27' });
    expect(result).toMatchObject({ kind: 'nodata', speed: 0, finishOn: null });
  });

  it("doesn't change with today's ticks: only the last full weeks count", () => {
    expect(forecast({ done: 16 }).speed).toBe(forecast({ done: 20 }).speed);
  });
});

describe('the rounding', () => {
  it('rounds the finish date up', () => {
    // 34 / 4 * 7 = 59.5 days -> 60; 33 / 4 * 7 = 57.75 days -> 58.
    expect(forecast({ done: 16 }).finishOn).toBe('2026-12-29');
    expect(forecast({ done: 17 }).finishOn).toBe('2026-12-27');
  });

  it('gets exact days where floating point would add one', () => {
    // 29 tasks at 21 in 3 weeks (7 a week) take exactly 29 days; 29 / 7 * 7 is a little over 29.
    expect(Math.ceil((29 / (21 / 3)) * 7)).toBe(30);
    const result = forecast({ total: 29, done: 0, doneByWeek: [7, 7, 7] });
    expect(result.finishOn).toBe('2026-11-28');
  });

  it('rounds the percent', () => {
    expect(forecast({ total: 200, done: 29 }).pct).toBe(15); // 14.5, not 14.499999
    expect(forecast({ total: 3, done: 1 }).pct).toBe(33);
    expect(forecast({ total: 3, done: 2 }).pct).toBe(67);
  });

  it('needs at least one task a week more than the speed', () => {
    // 31 tasks in 71 days rounds to 3 a week, which is the speed they are already late at.
    const result = forecast({
      total: 41,
      done: 10,
      doneByWeek: [3, 3, 3],
      deadline: '2027-01-09',
    });
    expect(result).toMatchObject({ kind: 'risk', speed: 3, daysLeft: 71, daysLate: 2, needed: 4 });
  });

  it('needs what the days left ask for when that is more', () => {
    expect(forecast({ total: 100, done: 10, deadline: '2026-11-30' })).toMatchObject({
      daysLeft: 31,
      needed: 20, // 90 / (31 / 7) = 20.3
    });
  });
});

describe('the singular wording', () => {
  it('a project with one task', () => {
    expect(forecast({ total: 1, done: 1 }).body).toBe(
      'The only task is done. The deadline is 15 Dec.',
    );
  });

  it('one task open after the deadline', () => {
    expect(forecast({ total: 2, done: 1, deadline: '2026-10-29' }).body).toBe(
      '1 task is still open.',
    );
  });

  it('needs about 1 task a week', () => {
    const result = forecast({ total: 2, done: 1, doneByWeek: [1, 0, 0], deadline: '2026-11-13' });
    expect(result).toMatchObject({ kind: 'risk', daysLate: 7, needed: 1 });
    expect(result.body).toBe(
      'At the current speed (about 0.3 tasks a week) the work ends around 20 Nov. ' +
        'To finish by 13 Nov, the team needs about 1 task a week.',
    );
  });
});

describe('dates in another year', () => {
  it('names the year', () => {
    const result = forecast({ total: 100, done: 0, deadline: '2027-01-10' });
    // 100 tasks at 4 a week take 175 days.
    expect(result.finishOn).toBe('2027-04-23');
    expect(result.title).toBe('Off track: will miss the deadline by about 103 days');
    expect(result.body).toContain('the work ends around 23 Apr 2027.');
    expect(result.body).toContain('To finish by 10 Jan 2027,');
  });
});

describe('tolerant input', () => {
  it('reads missing numbers as zero and never goes below zero', () => {
    const result = forecastProject({ status: 'active', today: TODAY, deadline: DEADLINE });
    expect(result).toMatchObject({ kind: 'noplan', total: 0, done: 0, left: 0, pct: 0, speed: 0 });
    expect(forecast({ total: 5, done: 9 }).left).toBe(0);
  });
});

describe('the pills and the list order', () => {
  it('uses soft tags: red, marigold, green, the rest neutral', () => {
    expect(healthTone('off')).toBe('red');
    expect(healthTone('risk')).toBe('marigold');
    expect(healthTone('on')).toBe('green');
    for (const kind of ['nodata', 'nodeadline', 'noplan', 'hold', 'completed']) {
      expect(healthTone(kind)).toBe('neutral');
    }
  });

  it('sorts by health, then the nearest deadline, then name', () => {
    const rows = [
      { kind: 'completed', deadline: '2026-11-01', name: 'a' },
      { kind: 'hold', deadline: null, name: 'b' },
      { kind: 'noplan', deadline: null, name: 'c' },
      { kind: 'nodeadline', deadline: null, name: 'd' },
      { kind: 'nodata', deadline: '2026-11-01', name: 'e' },
      { kind: 'on', deadline: null, name: 'z' },
      { kind: 'on', deadline: '2026-12-01', name: 'y' },
      { kind: 'on', deadline: '2026-11-01', name: 'x' },
      { kind: 'on', deadline: '2026-11-01', name: 'w' },
      { kind: 'risk', deadline: '2026-11-01', name: 'g' },
      { kind: 'off', deadline: '2026-12-01', name: 'h' },
    ];
    expect(rows.sort(compareHealth).map((row) => row.name)).toEqual([
      'h',
      'g',
      'w',
      'x',
      'y',
      'z',
      'e',
      'd',
      'c',
      'b',
      'a',
    ]);
  });
});

describe('safe in the browser', () => {
  it('imports no server code', () => {
    const source = readFileSync('src/modules/projectPlan/forecast.js', 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    expect(imports.sort()).toEqual(['@/lib/text', '@/lib/time']);
    expect(source).not.toMatch(/new Date\(|Date\.now\(/);
  });
});
