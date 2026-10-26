// Ask Daybook's tools (CONTRACT 20): each viewer gets exactly the scope of their screens. A PM
// sees only their own projects and the people on them, HR only attendance, an Admin everything;
// an Admin's attendance never reaches HR or a PM (CONTRACT 16). Gemini is a fake that calls one
// tool; the tests read what the tool sent back.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { ai } from '@/modules/ai';
import { resetDatabase } from '../helpers/db.js';
import { createCompany, enableAsk, MONDAY, NOW, requests, TODAY, toolResult } from './aiAskKit.js';

const WEEK = { from: MONDAY, to: TODAY };
let people;

/** Everything Gemini was sent in the last ask, as one string. */
const sent = () => JSON.stringify(requests);

beforeAll(async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('No network in tests')));
  await resetDatabase();
  ({ people } = await createCompany());
  await enableAsk();
});

beforeEach(async () => {
  setNowForTests(NOW);
  await db('ai_usage').delete();
});

afterAll(() => ai.setTransportForTests(null));

describe('a PM sees only their own projects and the people on them', () => {
  it('lists only their projects and their hours', async () => {
    const projects = await toolResult(people.priya, 'list_projects');
    expect(projects.projects.map((row) => row.project)).toEqual(['acme-app']);

    const hours = await toolResult(people.priya, 'hours_by_project', WEEK);
    expect(hours.projects).toEqual([
      { project: 'acme-app', minutes: 1170, time: '19h 30m', people: 3, days: 2 },
    ]);
    expect(hours.total.time).toBe('19h 30m');
    expect(sent()).not.toContain('acme-seo');
    expect(sent()).not.toContain('side-quest');
  });

  it("can't name another PM's project", async () => {
    const hours = await toolResult(people.priya, 'hours_by_project', {
      ...WEEK,
      projectName: 'acme-seo',
    });
    expect(hours).toEqual({
      error: 'There is no project called "acme-seo" that you can see.',
    });
    const tasks = await toolResult(people.priya, 'priority_tasks', { projectName: 'acme seo' });
    expect(tasks.error).toMatch(/no project called/);
    expect(sent()).not.toContain('Audit sitemap');
  });

  it("counts a shared person's hours on the PM's projects only", async () => {
    const result = await toolResult(people.priya, 'hours_by_person', {
      ...WEEK,
      personName: 'aman',
    });
    // Aman Gupta works only on acme-seo, so "aman" can only mean Aman Singh here.
    expect(result.people).toEqual([
      {
        person: 'Aman Singh',
        total: { minutes: 120, time: '2h' },
        projects: [{ project: 'acme-app', minutes: 120, time: '2h', days: 1 }],
      },
    ]);
    expect(sent()).not.toContain('Write meta tags');
    expect(sent()).not.toContain('360');
  });

  it("doesn't know people who aren't on their projects", async () => {
    const result = await toolResult(people.priya, 'hours_by_person', {
      ...WEEK,
      personName: 'Rohit Verma',
    });
    expect(result).toEqual({
      error: 'There is no person called "Rohit Verma" that you can see.',
    });
    const all = await toolResult(people.priya, 'hours_by_person', WEEK);
    expect(all.people.map((row) => row.person)).toEqual([
      'Aman Singh',
      'Arjun Mehta',
      'Vishal Saini',
    ]);
  });

  it('reads report tasks and priority tasks of their projects, latest status once', async () => {
    const result = await toolResult(people.priya, 'report_tasks', WEEK);
    const titles = result.tasks.map((row) => `${row.task}: ${row.status}`);
    expect(titles).toContain('Fix checkout bug: Blocked');
    expect(titles).not.toContain('Fix checkout bug: In progress');
    expect(titles).not.toContain('Keyword research: In progress');
    expect(result.counts).toEqual({ done: 3, inProgress: 0, blocked: 1 });

    const blocked = await toolResult(people.priya, 'report_tasks', { ...WEEK, status: 'blocked' });
    expect(blocked.tasks).toEqual([
      {
        date: '2026-10-27',
        person: 'Vishal Saini',
        project: 'acme-app',
        task: 'Fix checkout bug',
        status: 'Blocked',
        firstReported: MONDAY,
      },
    ]);

    const priority = await toolResult(people.priya, 'priority_tasks');
    expect(priority.tasks).toEqual([
      {
        task: 'Fix login timeout',
        project: 'acme-app',
        priority: 'P1',
        status: 'Open',
        assignedTo: 'Vishal Saini',
        added: TODAY,
      },
    ]);
  });

  it("sees the attendance of the people on their projects, never an Admin's", async () => {
    const result = await toolResult(people.priya, 'attendance_summary', WEEK);
    expect(result.people.map((row) => row.person)).toEqual(['Aman Singh', 'Vishal Saini']);
    expect(sent()).not.toContain('Arjun');
    const admin = await toolResult(people.priya, 'attendance_summary', {
      ...WEEK,
      personName: 'Arjun',
    });
    expect(admin.error).toBe('There is no person called "Arjun" that you can see.');
  });
});

describe('HR sees attendance only', () => {
  it.each([
    'list_projects',
    'hours_by_project',
    'hours_by_person',
    'report_tasks',
    'priority_tasks',
  ])("can't use %s", async (tool) => {
    const result = await toolResult(people.neha, tool, WEEK);
    expect(result).toEqual({ error: 'not allowed' });
    expect(sent()).not.toContain('acme-app');
  });

  it("sums attendance for everyone but Admins, and can't name an Admin", async () => {
    const result = await toolResult(people.neha, 'attendance_summary', WEEK);
    const names = result.people.map((row) => row.person);
    expect(names).toEqual([
      'Aman Gupta',
      'Aman Singh',
      'Neha Kapoor',
      'Rohit Verma',
      'Vishal Saini',
    ]);
    expect(sent()).not.toContain('Arjun');
    expect(sent()).not.toContain('Chief');

    const vishal = result.people.find((row) => row.person === 'Vishal Saini');
    expect(vishal).toMatchObject({
      daysCheckedIn: 2,
      officeDays: 1,
      workFromHomeDays: 1,
      lateDays: 1,
      lateTotal: '15m',
      worked: '18h',
      averageCheckIn: '9:38 AM',
      missingCheckOuts: 0,
      workingDaysWithoutCheckIn: 0,
    });
    const rohit = result.people.find((row) => row.person === 'Rohit Verma');
    expect(rohit).toMatchObject({
      missingCheckOuts: 1,
      worked: '0h',
      workingDaysWithoutCheckIn: 1,
    });

    const people2 = await toolResult(people.neha, 'list_people');
    expect(people2.people.map((row) => row.name)).not.toContain('Arjun Mehta');
    const hidden = await toolResult(people.neha, 'attendance_summary', {
      ...WEEK,
      personName: 'Arjun Mehta',
    });
    expect(hidden.error).toMatch(/no person called "Arjun Mehta"/);
  });

  it('lists each day for one person over a short range', async () => {
    const result = await toolResult(people.neha, 'attendance_summary', {
      ...WEEK,
      personName: 'vishal',
    });
    expect(result.days).toEqual([
      {
        date: MONDAY,
        where: 'Office',
        checkIn: '9:45 AM',
        checkOut: '6:45 PM',
        late: '15m',
        worked: '9h',
      },
      {
        date: '2026-10-27',
        where: 'Work from home',
        checkIn: '9:30 AM',
        checkOut: '6:30 PM',
        late: null,
        worked: '9h',
      },
    ]);
    expect(sent()).not.toContain('vishal@example.com');
  });

  it('asks which person when a name matches more than one', async () => {
    const result = await toolResult(people.neha, 'attendance_summary', {
      ...WEEK,
      personName: 'Aman',
    });
    expect(result.error).toBe(
      'More than one person matches "Aman": Aman Gupta, Aman Singh. Ask which one they mean.',
    );
  });
});

describe('an Admin sees everything', () => {
  it("includes other Admins' attendance and hours on requested projects", async () => {
    const attendance = await toolResult(people.chief, 'attendance_summary', {
      ...WEEK,
      personName: 'Arjun',
    });
    expect(attendance.people[0]).toMatchObject({
      person: 'Arjun Mehta',
      lateDays: 1,
      lateTotal: '30m',
    });

    const hours = await toolResult(people.chief, 'hours_by_project', WEEK);
    expect(hours.projects.map((row) => `${row.project} ${row.time}`)).toEqual([
      'acme-app 19h 30m',
      'acme-seo 13h 30m',
      'side-quest (requested project) 30m',
    ]);
    const projects = await toolResult(people.chief, 'list_projects');
    expect(projects.projects.map((row) => row.project)).toEqual(['acme-app', 'acme-seo']);
  });
});
