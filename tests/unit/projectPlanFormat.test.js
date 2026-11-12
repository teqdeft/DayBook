// What the project page says about dates, phases and summaries (CONTRACT 22): planFormat.js,
// summaryView.js and DueTag's rules, with the prototype's wording.
import { describe, expect, it, vi } from 'vitest';
import {
  dateRange,
  joinNames,
  lateNote,
  longDate,
  moveLabel,
  movePhaseCopy,
  phaseStatus,
  plannedRange,
  shortDate,
  timing,
} from '@/app/(app)/projects/[id]/planFormat';
import {
  aiSuggestion,
  documentCounts,
  firstRisk,
  summaryActions,
  summaryGroups,
  summaryState,
} from '@/app/(app)/projects/[id]/summaryView';
import { PROJECT_PHASES } from '@/modules/projectPlan/phases';

vi.mock('next/link', () => ({ default: () => null }));

const { dueLook } = await import('@/app/(app)/projects/[id]/DueTag.jsx');

const TODAY = '2026-10-30';

describe('dates', () => {
  it('leaves out this year and keeps any other', () => {
    expect(shortDate('2026-12-29', TODAY)).toBe('29 Dec');
    expect(shortDate('2027-01-10', TODAY)).toBe('10 Jan 2027');
    expect(longDate('2026-12-15')).toBe('15 Dec 2026');
  });

  it('writes a range as the prototype does', () => {
    expect(dateRange('2026-10-06', '2026-10-23', TODAY)).toBe('6 to 23 Oct');
    expect(dateRange('2026-10-26', '2026-11-20', TODAY)).toBe('26 Oct to 20 Nov');
    expect(dateRange('2026-12-16', '2027-01-15', TODAY)).toBe('16 Dec to 15 Jan 2027');
    expect(dateRange('2027-01-04', '2027-01-15', TODAY)).toBe('4 to 15 Jan 2027');
    expect(dateRange('2027-01-04', '2027-02-15', TODAY)).toBe('4 Jan 2027 to 15 Feb 2027');
  });

  it('writes a range on one day as that day, with its year when it is not this one', () => {
    expect(dateRange('2026-11-11', '2026-11-11', TODAY)).toBe('11 Nov');
    expect(dateRange('2027-01-04', '2027-01-04', TODAY)).toBe('4 Jan 2027');
    const oneDay = { plannedStart: '2026-11-11', plannedEnd: '2026-11-11' };
    expect(plannedRange(oneDay, TODAY)).toBe('11 Nov');
  });

  it('copes with one planned date or none', () => {
    const both = { plannedStart: '2026-10-06', plannedEnd: '2026-10-23' };
    expect(plannedRange(both, TODAY)).toBe('6 to 23 Oct');
    expect(plannedRange({ plannedStart: '2026-10-06', plannedEnd: null }, TODAY)).toBe(
      'From 6 Oct',
    );
    expect(plannedRange({ plannedStart: null, plannedEnd: '2026-10-23' }, TODAY)).toBe(
      'Until 23 Oct',
    );
    expect(plannedRange({ plannedStart: null, plannedEnd: null }, TODAY)).toBeNull();
  });

  it('joins names', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('says how a date compares with the plan', () => {
    expect(timing('2026-10-30', '2026-10-23')).toBe('7 days late');
    expect(timing('2026-10-30', '2026-10-29')).toBe('1 day late');
    expect(timing('2026-10-30', '2026-11-02')).toBe('3 days early');
    expect(timing('2026-10-30', '2026-10-30')).toBe('on time');
  });
});

describe('phaseStatus and lateNote', () => {
  const phase = (key, more = {}) => ({
    key,
    plannedStart: null,
    plannedEnd: null,
    actualStart: null,
    actualEnd: null,
    ...more,
  });

  it('knows where a phase stands', () => {
    expect(phaseStatus('design', phase('design'))).toBe('current');
    expect(phaseStatus('design', phase('testing'))).toBe('later');
    expect(phaseStatus('design', phase('requirement_gathering'))).toBe('skipped');
    expect(phaseStatus('design', phase('requirement_gathering', { actualEnd: '2026-10-20' }))).toBe(
      'done',
    );
    expect(phaseStatus(null, phase('requirement_gathering'))).toBe('later');
  });

  it('notes what is late, and nothing without the dates to tell', () => {
    expect(lateNote('current', phase('design', { plannedEnd: '2026-10-29' }), TODAY).text).toBe(
      '1 day late',
    );
    expect(lateNote('current', phase('design'), TODAY)).toBeNull();
    expect(lateNote('done', phase('design', { actualEnd: '2026-10-29' }), TODAY)).toBeNull();
    expect(lateNote('later', phase('design', { plannedStart: '2026-10-30' }), TODAY)).toBeNull();
    expect(lateNote('skipped', phase('design'), TODAY)).toEqual({ text: 'Skipped', tone: 'muted' });
  });
});

describe('moveLabel', () => {
  it('names the next phase', () => {
    expect(moveLabel(null)).toBe('Start Requirement gathering');
    expect(moveLabel('requirement_gathering')).toBe('Move to Design');
    expect(moveLabel('launch')).toBe('Move to Support');
    expect(moveLabel('support')).toBeNull();
  });
});

describe('movePhaseCopy', () => {
  const dated = {
    requirement_gathering: { plannedStart: '2026-10-06', plannedEnd: '2026-10-23' },
    design: { plannedStart: '2026-10-26', plannedEnd: '2026-11-20' },
    development: { plannedStart: '2026-11-09', plannedEnd: '2026-12-04' },
    testing: { plannedStart: '2026-11-30', plannedEnd: '2026-12-10' },
  };
  const phases = PROJECT_PHASES.map(({ key }) => ({ key, ...dated[key] }));
  const copy = (from, to, rows = phases) => movePhaseCopy({ phases: rows, from, to, today: TODAY });

  it('moves forward with the prototype wording', () => {
    expect(copy('requirement_gathering', 'design')).toEqual({
      title: 'Move to Design?',
      body: 'Requirement gathering ends today, 7 days late. Design starts today, 4 days late.',
      okLabel: 'Move to Design',
    });
  });

  it('says on time and early', () => {
    expect(copy('design', 'development').body).toBe(
      'Design ends today, 21 days early. Development starts today, 10 days early.',
    );
    const rows = [
      { key: 'design', plannedEnd: TODAY },
      { key: 'development', plannedStart: TODAY },
    ];
    expect(copy('design', 'development', rows).body).toBe(
      'Design ends today, on time. Development starts today, on time.',
    );
  });

  it('names what a jump skips', () => {
    expect(copy('requirement_gathering', 'development').body).toContain(' Design is skipped.');
    expect(copy('requirement_gathering', 'testing').body).toContain(
      ' Design and Development are skipped.',
    );
  });

  it('goes back with its own wording', () => {
    expect(copy('design', 'requirement_gathering')).toEqual({
      title: 'Go back to Requirement gathering?',
      body: 'Requirement gathering opens again. Design goes back to not started.',
      okLabel: 'Go back',
    });
    expect(copy('testing', 'design').body).toBe(
      'Design opens again. Development and Testing go back to not started.',
    );
  });

  it('starts from no phase, with no first sentence', () => {
    expect(copy(null, 'requirement_gathering')).toEqual({
      title: 'Start Requirement gathering?',
      body: 'Requirement gathering starts today, 24 days late.',
      okLabel: 'Start Requirement gathering',
    });
  });

  it('jumps from no phase over what comes first', () => {
    expect(copy(null, 'design')).toEqual({
      title: 'Move to Design?',
      body: 'Design starts today, 4 days late. Requirement gathering is skipped.',
      okLabel: 'Move to Design',
    });
  });

  it('leaves out the timing without planned dates', () => {
    const rows = PROJECT_PHASES.map(({ key }) => ({ key }));
    expect(copy('design', 'testing', rows).body).toBe(
      'Design ends today. Testing starts today. Development is skipped.',
    );
    expect(movePhaseCopy({ from: 'design', to: 'testing', today: TODAY }).okLabel).toBe(
      'Move to Testing',
    );
  });
});

describe('dueLook', () => {
  it.each([
    [null, 'No due date', 'neutral'],
    ['2026-10-29', '1 day late', 'red'],
    ['2026-10-20', '10 days late', 'red'],
    ['2026-10-30', 'Due today', 'marigold'],
    ['2026-11-06', 'Due 6 Nov', 'neutral'],
    ['2027-01-10', 'Due 10 Jan 2027', 'neutral'],
  ])('%s reads as %s', (date, text, tone) => {
    expect(dueLook(date, TODAY)).toEqual({ text, tone });
  });
});

describe('summaryState', () => {
  const state = (available, files, notes, summary) =>
    summaryState({ available, counts: { files, notes }, summary });

  it('asks for documents, then a summary', () => {
    expect(state(true, 0, 0, null)).toBe('empty');
    expect(state(true, 1, 0, null)).toBe('ready');
  });

  it('tells a fresh summary from a stale one', () => {
    expect(state(true, 1, 1, { stale: false })).toBe('fresh');
    expect(state(true, 1, 1, { stale: true })).toBe('stale');
  });

  it('keeps a summary readable when AI is off', () => {
    expect(state(false, 1, 1, { stale: false })).toBe('offSummary');
    expect(state(false, 1, 1, { stale: true })).toBe('offSummary');
    expect(state(false, 1, 1, null)).toBe('off');
    expect(state(false, 0, 0, null)).toBe('off');
  });

  it('stops showing a summary once every document is gone', () => {
    expect(state(true, 0, 0, { stale: true })).toBe('empty');
    expect(state(false, 0, 0, { stale: true })).toBe('off');
  });
});

describe('the summary text', () => {
  const body = {
    overview: 'A booking app.',
    scope: [
      { text: 'Patient booking', notInScope: false, source: 'SOW-Acme-v3.pdf, page 3' },
      { text: 'SMS reminders', notInScope: true, source: 'SOW-Acme-v3.pdf, page 5' },
    ],
    deadlines: [
      { text: 'Designs ready', dateAsWritten: '20 November', source: 'Kickoff call notes' },
      { text: 'Go-live on 15 December', dateAsWritten: '15 December', source: 'SOW, page 9' },
      { text: 'Staff training', dateAsWritten: null, source: 'Kickoff call notes' },
    ],
    risks: [
      { text: 'Waiting on logo files', kind: 'question', source: 'Kickoff call notes' },
      { text: 'Payment provider not chosen', kind: 'risk', source: 'Kickoff call notes' },
    ],
    actions: [
      { key: 'a', owner: 'client', text: 'Send logos', dueAsWritten: 'Friday', taskId: null },
      { key: 'b', owner: 'us', text: 'Share wireframes', dueAsWritten: null, taskId: 12 },
      { key: 'c', owner: 'unclear', text: 'Pick a date', dueAsWritten: '', taskId: null },
    ],
  };

  it('counts files and notes', () => {
    expect(documentCounts({ files: 1, notes: 1 })).toBe('1 file and 1 note');
    expect(documentCounts({ files: 2, notes: 0 })).toBe('2 files');
    expect(documentCounts({ files: 0, notes: 3 })).toBe('3 notes');
    expect(documentCounts({ files: 0, notes: 0 })).toBe('');
    expect(documentCounts()).toBe('');
  });

  it('builds the three groups of the full summary', () => {
    const [scope, deadlines, risks] = summaryGroups(body);
    expect(scope.title).toBe('Scope');
    expect(scope.points[1]).toEqual({
      text: 'SMS reminders',
      notInScope: true,
      source: 'SOW-Acme-v3.pdf, page 5',
    });
    expect(deadlines.title).toBe('Deadlines');
    expect(deadlines.points.map((point) => point.text)).toEqual([
      'Designs ready: 20 November',
      'Go-live on 15 December',
      'Staff training',
    ]);
    expect(risks.title).toBe('Risks and open questions');
    expect(risks.points.map((point) => point.text)).toEqual([
      'Question: Waiting on logo files',
      'Risk: Payment provider not chosen',
    ]);
  });

  it('leaves out empty groups', () => {
    expect(summaryGroups({ overview: 'x', scope: [], deadlines: [], risks: [] })).toEqual([]);
    expect(summaryGroups(undefined)).toEqual([]);
  });

  it('picks the first real risk for under the overview', () => {
    expect(firstRisk(body)).toBe('Risk: Payment provider not chosen');
    expect(firstRisk({ risks: [{ text: 'x', kind: 'question' }] })).toBeNull();
    expect(firstRisk({})).toBeNull();
  });

  it('words the action items', () => {
    expect(summaryActions(body)).toEqual([
      { key: 'a', who: 'Client', text: 'Send logos', when: 'Friday', added: false },
      { key: 'b', who: 'Us', text: 'Share wireframes', when: 'No date given', added: true },
      {
        key: 'c',
        who: 'Owner not clear',
        text: 'Pick a date',
        when: 'No date given',
        added: false,
      },
    ]);
  });
});

describe('aiSuggestion', () => {
  const summary = (phase, quote = 'Client approved the scope') => ({
    body: { nextPhase: { phase, quote, source: 'Kickoff call notes' } },
  });
  const ask = (next, currentPhase, status = 'active') =>
    aiSuggestion({ summary: next, currentPhase, status });

  it('shows when the summary points at the next phase', () => {
    expect(ask(summary('design'), 'requirement_gathering')).toEqual({
      quote: 'Client approved the scope',
      source: 'Kickoff call notes',
    });
    expect(ask(summary('requirement_gathering'), null)?.quote).toBeTruthy();
  });

  it('hides for any other phase, once moved on, and on a completed project', () => {
    expect(ask(summary('testing'), 'requirement_gathering')).toBeNull();
    expect(ask(summary('design'), 'design')).toBeNull();
    expect(ask(summary('design'), 'requirement_gathering', 'completed')).toBeNull();
  });

  it('hides without a phase, a quote or a summary', () => {
    expect(ask(summary(null), 'requirement_gathering')).toBeNull();
    expect(ask(summary('design', ''), 'requirement_gathering')).toBeNull();
    expect(ask({ body: { nextPhase: null } }, 'requirement_gathering')).toBeNull();
    expect(ask(null, 'requirement_gathering')).toBeNull();
  });
});
