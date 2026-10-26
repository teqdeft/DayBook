// Ask Daybook's words per viewer (CONTRACT 20, askCopy.js): HR's tools only answer about
// attendance, so HR is never invited to ask about hours or tasks.
import { describe, expect, it } from 'vitest';
import { askCopyFor } from '@/app/(app)/ask/askCopy';

describe('askCopyFor', () => {
  it('asks HR about attendance only', () => {
    const hr = askCopyFor('hr');
    for (const text of [hr.subtitle, hr.emptyTitle, hr.placeholder]) {
      expect(text).not.toMatch(/hours|tasks/i);
    }
    expect(hr.placeholder).toBe('Ask about check-ins, late days, work from home and breaks');
    expect(hr.emptyTitle).toBe('Ask about attendance');
  });

  it('asks Admins about everything and PMs about their projects', () => {
    expect(askCopyFor('admin')).toMatchObject({
      emptyTitle: 'Ask about hours, tasks and attendance',
      placeholder: 'Ask about hours, tasks or attendance',
    });
    expect(askCopyFor('pm').placeholder).toBe(
      'Ask about hours, tasks or attendance on your projects',
    );
  });

  it('falls back to the narrowest words for an unknown viewer', () => {
    expect(askCopyFor('someone')).toEqual(askCopyFor('hr'));
  });
});
