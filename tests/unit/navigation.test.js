import { describe, expect, it } from 'vitest';
import { activeNavHref, homePathFor, navigationFor } from '@/config/navigation';

const employee = { role: 'employee', status: 'active', tracksAttendance: true };
const pm = { role: 'pm', status: 'active', tracksAttendance: false };
const ceo = { role: 'admin', status: 'active', tracksAttendance: false };

describe('navigation', () => {
  it('highlights Today on the Daily report (artboard 02)', () => {
    const items = navigationFor(employee);
    expect(activeNavHref(items, '/report')).toBe('/today');
    expect(activeNavHref(items, '/report/2026-09-30')).toBe('/today');
    expect(activeNavHref(items, '/today')).toBe('/today');
    expect(activeNavHref(items, '/log')).toBe('/log');
    expect(activeNavHref(items, '/reports')).toBeNull();
  });

  it('picks the longest matching item (/settings/roles is Roles, not Settings)', () => {
    const items = navigationFor(ceo);
    expect(activeNavHref(items, '/settings/roles')).toBe('/settings/roles');
    expect(activeNavHref(items, '/settings')).toBe('/settings');
    expect(activeNavHref(items, '/team/2')).toBe('/team');
  });

  it('gives PMs no Today or My log and starts them on the Team dashboard', () => {
    const items = navigationFor(pm);
    expect(items.map((item) => item.key)).toEqual([
      'projects',
      'team',
      'screenTime',
      'attendance',
      'requests',
    ]);
    expect(activeNavHref(items, '/report')).toBeNull();
    expect(homePathFor(pm)).toBe('/team');
  });

  it('hides Today and My log from an Admin who is not tracked', () => {
    const keys = navigationFor(ceo).map((item) => item.key);
    expect(keys).not.toContain('today');
    expect(keys).not.toContain('log');
    expect(navigationFor({ ...ceo, tracksAttendance: true }).map((item) => item.key)).toContain(
      'today',
    );
  });
});
