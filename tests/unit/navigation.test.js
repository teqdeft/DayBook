import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { activeNavHref, homePathFor, NAV_ITEMS, navigationFor } from '@/config/navigation';

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

  it('shows the Attendance count to HR and Admins (both decide), never to PMs', () => {
    const hr = { role: 'hr', status: 'active', tracksAttendance: true };
    const badge = (user) =>
      navigationFor(user, { corrections: 3, requests: 2 }).find((item) => item.key === 'attendance')
        ?.badge;
    expect(badge(hr)).toBe(3);
    expect(badge(ceo)).toBe(3);
    expect(badge(pm)).toBe(0);
    expect(navigationFor(pm, { requests: 2 }).find((item) => item.key === 'requests').badge).toBe(
      2,
    );
  });

  it('shows Summaries to PM, HR and Admin once they have one, with a drawn icon', () => {
    const hr = { role: 'hr', status: 'active', tracksAttendance: true };
    const keys = (user, features) => navigationFor(user, {}, features).map((item) => item.key);
    expect(keys(pm, { summaries: true })).toEqual([
      'projects',
      'team',
      'screenTime',
      'attendance',
      'requests',
      'summaries',
    ]);
    expect(keys(hr, { ask: true, summaries: true })).toEqual([
      'today',
      'log',
      'attendance',
      'ask',
      'summaries',
      'people',
    ]);
    expect(keys(ceo, { summaries: true })).toContain('summaries');
    expect(keys(employee, { ask: true, summaries: true })).toEqual(['today', 'log', 'projects']);
    expect(keys(hr, {})).not.toContain('summaries');
    const item = navigationFor(hr, {}, { summaries: true }).find((i) => i.key === 'summaries');
    expect(item).toMatchObject({ label: 'Summaries', href: '/summaries', icon: 'Newspaper' });
    const ask = navigationFor(hr, {}, { ask: true }).find((i) => i.key === 'ask');
    expect(ask.icon).toBe('Sparkles');
  });

  it('has a drawn icon for every item (NavIcon shows a plain circle for a missing one)', () => {
    const source = readFileSync(path.resolve('src/components/NavIcon.jsx'), 'utf8');
    const missing = Object.values(NAV_ITEMS)
      .map((item) => item.icon)
      .filter((icon) => !source.includes(`\n  ${icon}: {`));
    expect(missing).toEqual([]);
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
