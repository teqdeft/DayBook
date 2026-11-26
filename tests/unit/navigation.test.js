import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activeNavHref, homePathFor, NAV_ITEMS, navigationFor } from '@/config/navigation';

vi.mock('next/navigation', () => ({ usePathname: () => '/my-tasks' }));
vi.mock('@/components/UserMenu', () => ({ default: () => null }));

const { default: Sidebar } = await import('@/components/Sidebar.jsx');

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
      'myTasks',
      'screenTime',
      'attendance',
      'requests',
      'mySettings',
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
      'myTasks',
      'screenTime',
      'attendance',
      'requests',
      'summaries',
      'mySettings',
    ]);
    expect(keys(hr, { ask: true, summaries: true })).toEqual([
      'today',
      'log',
      'attendance',
      'ask',
      'summaries',
      'people',
      'mySettings',
    ]);
    expect(keys(ceo, { summaries: true })).toContain('summaries');
    expect(keys(employee, { ask: true, summaries: true })).toEqual([
      'today',
      'log',
      'projects',
      'mySettings',
    ]);
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

  it('ends every role with My settings, open to anyone signed in (CONTRACT 21)', () => {
    const hr = { role: 'hr', status: 'active', tracksAttendance: true };
    for (const user of [employee, pm, hr, ceo, { ...ceo, tracksAttendance: true }]) {
      const items = navigationFor(user, {}, { ask: true, summaries: true });
      expect(items.at(-1)).toEqual({
        key: 'mySettings',
        label: 'My settings',
        href: '/my-settings',
        icon: 'UserCog',
        matches: [],
        badge: 0,
        badgeLabel: 'waiting',
      });
    }
    // An employee sees Today, My log, Projects, My settings.
    expect(navigationFor(employee).map((item) => item.label)).toEqual([
      'Today',
      'My log',
      'Projects',
      'My settings',
    ]);
    // /my-settings lights up My settings, not Settings.
    const items = navigationFor(ceo);
    expect(activeNavHref(items, '/my-settings')).toBe('/my-settings');
    expect(activeNavHref(items, '/settings')).toBe('/settings');
  });

  it('shows a deactivated person nothing, My settings included', () => {
    expect(navigationFor({ ...employee, status: 'deactivated' })).toEqual([]);
  });

  it('lists My tasks for PMs after Team and for Admins after Overview (CONTRACT 28)', () => {
    const hr = { role: 'hr', status: 'active', tracksAttendance: true };
    const keys = (user) => navigationFor(user).map((item) => item.key);
    expect(keys(ceo)).toEqual([
      'overview',
      'myTasks',
      'team',
      'screenTime',
      'projects',
      'attendance',
      'people',
      'roles',
      'settings',
      'mySettings',
    ]);
    expect(keys({ ...ceo, tracksAttendance: true }).slice(0, 5)).toEqual([
      'overview',
      'myTasks',
      'today',
      'log',
      'team',
    ]);
    expect(keys(employee)).not.toContain('myTasks');
    expect(keys(hr)).not.toContain('myTasks');
    expect(NAV_ITEMS.myTasks).toEqual({
      label: 'My tasks',
      href: '/my-tasks',
      icon: 'ListChecks',
      permission: 'project.manage',
      badge: 'myTasks',
      badgeRoles: ['pm', 'admin'],
      badgeLabel: 'due now',
    });
    expect(activeNavHref(navigationFor(pm), '/my-tasks')).toBe('/my-tasks');
  });

  it('counts My tasks due now for PMs and Admins only; other badges keep "waiting"', () => {
    const badges = { myTasks: 4, requests: 2, corrections: 3 };
    const itemOf = (user, key) => navigationFor(user, badges).find((item) => item.key === key);
    expect(itemOf(pm, 'myTasks')).toMatchObject({ badge: 4, badgeLabel: 'due now' });
    expect(itemOf(ceo, 'myTasks')).toMatchObject({ badge: 4, badgeLabel: 'due now' });
    expect(itemOf(pm, 'requests')).toMatchObject({ badge: 2, badgeLabel: 'waiting' });
    expect(itemOf(ceo, 'attendance')).toMatchObject({ badge: 3, badgeLabel: 'waiting' });
    expect(navigationFor(pm).find((item) => item.key === 'myTasks').badge).toBe(0);
  });

  it('writes the badge word for screen readers: " due now" on My tasks, 99+ past 99', () => {
    const render = (badges) =>
      renderToStaticMarkup(
        createElement(Sidebar, { items: navigationFor(pm, badges), user: { name: 'Riya Kapoor' } }),
      );
    const html = render({ myTasks: 3, requests: 2 });
    expect(html).toContain('My tasks</span><span class="');
    expect(html).toMatch(/>3<span class="visually-hidden"> due now<\/span>/);
    expect(html).toMatch(/>2<span class="visually-hidden"> waiting<\/span>/);
    expect(html).toContain('aria-current="page" href="/my-tasks"');
    expect(render({ myTasks: 120 })).toMatch(/>99\+<span class="visually-hidden"> due now/);
    // Nothing at 0.
    expect(render({ myTasks: 0 })).not.toContain('due now');
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
