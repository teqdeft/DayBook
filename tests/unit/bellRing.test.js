// When the bell swings (CONTRACT 20 and 21): only while something is unread and the list is
// closed, and never once the person turned "Ring the bell" off (the dot and count don't use this).
import { describe, expect, it } from 'vitest';
import { bellSwing } from '@/components/NotificationBell.ring';

const base = { enabled: true, unread: 2, open: false, now: false };

describe('bellSwing', () => {
  it('swings while something is unread and the list is closed', () => {
    expect(bellSwing(base)).toBe('later');
    expect(bellSwing({ ...base, now: true })).toBe('now'); // the count just went up
  });

  it('stays still with nothing unread or the list open', () => {
    expect(bellSwing({ ...base, unread: 0 })).toBeNull();
    expect(bellSwing({ ...base, unread: undefined })).toBeNull();
    expect(bellSwing({ ...base, open: true, now: true })).toBeNull();
  });

  it('never swings when the person turned the ring off', () => {
    expect(bellSwing({ ...base, enabled: false })).toBeNull();
    expect(bellSwing({ ...base, enabled: false, now: true, unread: 9 })).toBeNull();
  });
});
