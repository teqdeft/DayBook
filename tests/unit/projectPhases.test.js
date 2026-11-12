// The phase list (CONTRACT 22), the weeks a project's speed is worked out from, and the plan's input
// schemas.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isPhase,
  nextPhase,
  PHASE_KEYS,
  phaseIndex,
  phaseLabel,
  PROJECT_PHASES,
} from '@/modules/projectPlan/phases';
import {
  phaseDatesSchema,
  projectDeadlineSchema,
  projectPhaseSchema,
  routeId,
  routePhase,
} from '@/modules/projectPlan/schemas';
import { lastFullWeeks } from '@/modules/projectPlan/weeks';
import { projectTaskCreateSchema, projectTaskUpdateSchema } from '@/modules/projectTasks/schemas';

describe('the phase list', () => {
  it('has the six phases, in order', () => {
    expect(PROJECT_PHASES).toEqual([
      { key: 'requirement_gathering', label: 'Requirement gathering' },
      { key: 'design', label: 'Design' },
      { key: 'development', label: 'Development' },
      { key: 'testing', label: 'Testing' },
      { key: 'launch', label: 'Launch' },
      { key: 'support', label: 'Support' },
    ]);
    expect(PHASE_KEYS).toHaveLength(6);
  });

  it('fits the VARCHAR(24) columns', () => {
    for (const key of PHASE_KEYS) expect(key.length).toBeLessThanOrEqual(24);
  });

  it('labels a phase, and "Not set" for none', () => {
    expect(phaseLabel('testing')).toBe('Testing');
    expect(phaseLabel(null)).toBe('Not set');
    expect(phaseLabel(undefined)).toBe('Not set');
    expect(phaseLabel('nonsense')).toBe('Not set');
  });

  it('places a phase, before the first for none', () => {
    expect(phaseIndex('requirement_gathering')).toBe(0);
    expect(phaseIndex('support')).toBe(5);
    expect(phaseIndex(null)).toBe(-1);
    expect(phaseIndex('nonsense')).toBe(-1);
  });

  it('gives the next phase: from null the first, after support null', () => {
    expect(nextPhase(null)).toBe('requirement_gathering');
    expect(nextPhase(undefined)).toBe('requirement_gathering');
    expect(nextPhase('requirement_gathering')).toBe('design');
    expect(nextPhase('launch')).toBe('support');
    expect(nextPhase('support')).toBeNull();
    expect(nextPhase('nonsense')).toBeNull();
  });

  it('knows what is on the list', () => {
    expect(isPhase('design')).toBe(true);
    expect(isPhase(null)).toBe(false);
    expect(isPhase('toString')).toBe(false);
  });

  it('imports nothing, so it is safe in the browser', () => {
    expect(readFileSync('src/modules/projectPlan/phases.js', 'utf8')).not.toMatch(
      /\bimport\b.*from/,
    );
  });
});

describe('lastFullWeeks', () => {
  const iso = (weeks) => weeks.map(({ from, to }) => [from.toISOString(), to.toISOString()]);

  it('gives the last 3 full weeks in company time, newest first, as UTC bounds', () => {
    expect(iso(lastFullWeeks('2026-10-30', 'Asia/Kolkata'))).toEqual([
      ['2026-10-18T18:30:00.000Z', '2026-10-25T18:30:00.000Z'],
      ['2026-10-11T18:30:00.000Z', '2026-10-18T18:30:00.000Z'],
      ['2026-10-04T18:30:00.000Z', '2026-10-11T18:30:00.000Z'],
    ]);
  });

  it('is the same from Monday to Sunday and moves on the next Monday', () => {
    const monday = iso(lastFullWeeks('2026-10-26', 'Asia/Kolkata'));
    expect(iso(lastFullWeeks('2026-11-01', 'Asia/Kolkata'))).toEqual(monday);
    expect(iso(lastFullWeeks('2026-11-02', 'Asia/Kolkata'))[0]).toEqual([
      '2026-10-25T18:30:00.000Z',
      '2026-11-01T18:30:00.000Z',
    ]);
  });

  it('follows a clock change: a week can be 169 hours', () => {
    // New York leaves daylight time on Sunday 1 November 2026.
    expect(iso(lastFullWeeks('2026-11-04', 'America/New_York'))[0]).toEqual([
      '2026-10-26T04:00:00.000Z',
      '2026-11-02T05:00:00.000Z',
    ]);
  });
});

describe('the plan schemas', () => {
  const dates = (plannedStart, plannedEnd) =>
    phaseDatesSchema.safeParse({ plannedStart, plannedEnd });

  it('takes a phase on the list and nothing else', () => {
    expect(projectPhaseSchema.parse({ phase: 'design' })).toEqual({ phase: 'design' });
    for (const phase of [null, undefined, '', 'nonsense', 3]) {
      expect(projectPhaseSchema.safeParse({ phase }).success).toBe(false);
    }
  });

  it('takes the phase the page showed as `from`: one on the list, null for Not set, or none', () => {
    expect(projectPhaseSchema.parse({ phase: 'testing', from: 'design' })).toEqual({
      phase: 'testing',
      from: 'design',
    });
    expect(projectPhaseSchema.parse({ phase: 'design', from: null }).from).toBeNull();
    expect(projectPhaseSchema.parse({ phase: 'design' })).not.toHaveProperty('from');
    for (const from of ['', 'nonsense', 3]) {
      expect(projectPhaseSchema.safeParse({ phase: 'design', from }).success).toBe(false);
    }
  });

  it('takes a real deadline, null or empty, but not a missing one', () => {
    expect(projectDeadlineSchema.parse({ deadline: '2026-12-15' }).deadline).toBe('2026-12-15');
    expect(projectDeadlineSchema.parse({ deadline: null }).deadline).toBeNull();
    expect(projectDeadlineSchema.parse({ deadline: '' }).deadline).toBeNull();
    expect(projectDeadlineSchema.safeParse({}).success).toBe(false);
  });

  it.each(['2026-02-30', '2026-13-01', '15-12-2026', '2026-1-5', 'soon', 20261215])(
    'refuses %s as a date',
    (deadline) => {
      expect(projectDeadlineSchema.safeParse({ deadline }).success).toBe(false);
    },
  );

  it.each(['0202-12-15', '1999-12-31', '2100-01-01', '9999-12-31'])(
    'refuses %s, a slip of the fingers',
    (deadline) => {
      expect(projectDeadlineSchema.safeParse({ deadline }).success).toBe(false);
    },
  );

  it('takes planned dates in order, the same day and either one empty', () => {
    expect(dates('2026-10-01', '2026-10-31').success).toBe(true);
    expect(dates('2026-10-01', '2026-10-01').success).toBe(true);
    expect(dates(null, '2026-10-31').success).toBe(true);
    expect(dates('2026-10-01', null).success).toBe(true);
    expect(dates(null, null).success).toBe(true);
  });

  it('refuses an end before the start, on the end date', () => {
    const result = dates('2026-10-02', '2026-10-01');
    expect(result.success).toBe(false);
    expect(result.error.issues[0]).toMatchObject({
      path: ['plannedEnd'],
      message: "The end date can't be before the start date.",
    });
  });

  it('needs both planned dates in the body', () => {
    expect(phaseDatesSchema.safeParse({ plannedStart: '2026-10-01' }).success).toBe(false);
    expect(phaseDatesSchema.safeParse({}).success).toBe(false);
  });

  it('reads route params', () => {
    expect(routeId({ id: '12' })).toBe(12);
    for (const id of ['0', '-1', '1.5', 'x', '', undefined]) expect(routeId({ id })).toBeNull();
    expect(routePhase({ phase: 'design' })).toBe('design');
    expect(routePhase({ phase: 'nonsense' })).toBeNull();
    expect(routePhase({})).toBeNull();
  });
});

describe('the task schemas', () => {
  it('defaults a new task to no phase and no due date', () => {
    expect(projectTaskCreateSchema.parse({ title: 'Fix it' })).toMatchObject({
      phase: null,
      dueDate: null,
    });
  });

  it('takes a phase and a due date, or null, or empty', () => {
    const task = { title: 'Fix it', phase: 'testing', dueDate: '2026-11-20' };
    expect(projectTaskCreateSchema.parse(task)).toMatchObject({
      phase: 'testing',
      dueDate: '2026-11-20',
    });
    expect(projectTaskUpdateSchema.parse({ phase: null, dueDate: null })).toEqual({
      phase: null,
      dueDate: null,
    });
    expect(projectTaskUpdateSchema.parse({ phase: '', dueDate: '' })).toEqual({
      phase: null,
      dueDate: null,
    });
  });

  it("leaves out what an edit doesn't send", () => {
    const parsed = projectTaskUpdateSchema.parse({ title: 'Fix it' });
    expect(parsed.phase).toBeUndefined();
    expect(parsed.dueDate).toBeUndefined();
  });

  it('refuses a phase or date that is not valid', () => {
    expect(projectTaskCreateSchema.safeParse({ title: 'Fix', phase: 'nope' }).success).toBe(false);
    expect(projectTaskCreateSchema.safeParse({ title: 'Fix', dueDate: 'soon' }).success).toBe(
      false,
    );
    expect(projectTaskUpdateSchema.safeParse({ dueDate: '2026-02-30' }).success).toBe(false);
  });
});
