// Shared set-up for the Ask Daybook tests (CONTRACT 20): a small company with two PMs, HR, two
// Admins and their projects, reports, priority tasks and attendance, plus a fake Gemini that
// scripts function calls. Nothing reaches Google: the transport is fake and fetch is blocked.
import { db } from '@/lib/db';
import { ai } from '@/modules/ai';
import { aiAsk } from '@/modules/aiAsk';
import { createUser, setSettings } from '../helpers/db.js';
import {
  addMembers,
  checkIn,
  createProject,
  createProjectRequest,
  createReport,
} from './dashboardKit.js';

/** Wednesday 28 October 2026, 12:00 in Kolkata. */
export const NOW = '2026-10-28T06:30:00Z';
export const MONDAY = '2026-10-26';
export const TUESDAY = '2026-10-27';
export const TODAY = '2026-10-28';

/** Every request body the fake Gemini received in the last ask. */
export let requests = [];

/** Gemini answers in turn (the last one repeats): fakeGeminiResponse data or { status, data }. */
export function script(...replies) {
  requests = [];
  ai.setTransportForTests(async ({ body }) => {
    requests.push(structuredClone(body));
    const next = replies.length > 1 ? replies.shift() : replies[0];
    return next?.status ? next : { status: 200, data: next };
  });
}

/** A Gemini turn that calls one tool. */
export const callTool = (name, args = {}) =>
  ai.fakeGeminiResponse({ calls: [{ name, args, id: `call-${name}` }] });

/** A Gemini turn that answers in text. */
export const answer = (text) => ai.fakeGeminiResponse({ text });

/** The tool results Gemini got back in a request: [{ name, response }]. */
export function resultsIn(body) {
  return body.contents
    .flatMap((content) => content.parts)
    .filter((part) => part.functionResponse)
    .map((part) => ({
      name: part.functionResponse.name,
      response: part.functionResponse.response,
    }));
}

/** Asks as `viewer` with Gemini calling one tool, and returns what the tool answered. */
export async function toolResult(viewer, name, args = {}) {
  script(callTool(name, args), answer('Done.'));
  await aiAsk.ask({ user: viewer, question: 'A test question' });
  return resultsIn(requests[1])[0].response;
}

/** AI and Ask Daybook on, with room for many requests. */
export async function enableAsk() {
  await setSettings({ ai_enabled: true, ai_ask_enabled: true, ai_daily_limit: 2000 });
}

/**
 * The company: Priya (PM) runs acme-app, Bharat (PM) runs acme-seo; Vishal and Aman Singh work on
 * acme-app, Rohit and Aman Gupta on acme-seo, Aman Singh on both; Arjun is a tracked Admin on
 * acme-app; Chief is the untracked CEO; Neha is HR.
 */
export async function createCompany() {
  const people = {
    priya: await createUser({ name: 'Priya Sharma', role: 'pm', tracksAttendance: false }),
    bharat: await createUser({ name: 'Bharat Rao', role: 'pm', tracksAttendance: false }),
    neha: await createUser({ name: 'Neha Kapoor', role: 'hr', department: 'HR' }),
    arjun: await createUser({ name: 'Arjun Mehta', role: 'admin', department: 'Leadership' }),
    chief: await createUser({ name: 'Chief Exec', role: 'admin', tracksAttendance: false }),
    vishal: await createUser({ name: 'Vishal Saini', email: 'vishal@example.com' }),
    amanS: await createUser({ name: 'Aman Singh' }),
    amanG: await createUser({ name: 'Aman Gupta', department: 'SEO' }),
    rohit: await createUser({ name: 'Rohit Verma', department: 'SEO' }),
  };
  const app = await createProject(people.priya, { name: 'acme-app', color: 'blue' });
  const seo = await createProject(people.bharat, { name: 'acme-seo', color: 'green' });
  await addMembers(app, [people.vishal, people.amanS, people.arjun]);
  await addMembers(seo, [people.rohit, people.amanS, people.amanG]);
  const request = await createProjectRequest(people.vishal, { name: 'side-quest' });

  const monday = await createReport(people.vishal, MONDAY, {
    entries: [
      {
        projectId: app.id,
        minutes: 510,
        tasks: [
          { title: 'Build login page', status: 'done' },
          { title: 'Fix checkout bug', status: 'in_progress' },
        ],
      },
      { projectRequestId: request.id, minutes: 30, tasks: [{ title: 'Spike', status: 'done' }] },
    ],
  });
  await createReport(people.vishal, TUESDAY, {
    entries: [
      {
        projectId: app.id,
        minutes: 480,
        tasks: [
          {
            title: 'Fix checkout bug',
            status: 'blocked',
            firstReportedOn: MONDAY,
            carriedFromTaskId: monday.taskIds[1],
          },
        ],
      },
    ],
  });
  await createReport(people.amanS, MONDAY, {
    entries: [
      { projectId: app.id, minutes: 120, tasks: [{ title: 'Review login page' }] },
      { projectId: seo.id, minutes: 360, tasks: [{ title: 'Write meta tags' }] },
    ],
  });
  await createReport(people.rohit, MONDAY, {
    entries: [
      {
        projectId: seo.id,
        minutes: 450,
        tasks: [{ title: 'Keyword research', status: 'in_progress' }],
      },
    ],
  });
  await createReport(people.arjun, MONDAY, {
    entries: [{ projectId: app.id, minutes: 60, tasks: [{ title: 'Client call' }] }],
  });
  // A draft never counts.
  await createReport(people.amanG, MONDAY, {
    status: 'draft',
    entries: [{ projectId: seo.id, minutes: 240, tasks: [{ title: 'Draft only' }] }],
  });

  const createdAt = new Date(NOW);
  await db('projectTasks').insert([
    {
      projectId: app.id,
      title: 'Fix login timeout',
      priority: 'p1',
      assigneeId: people.vishal.id,
      createdBy: people.priya.id,
      createdAt,
    },
    {
      projectId: seo.id,
      title: 'Audit sitemap',
      priority: 'p2',
      createdBy: people.bharat.id,
      createdAt,
    },
  ]);

  await checkIn(people.vishal, MONDAY, { in: '09:45', out: '18:45', lateMinutes: 15 });
  await checkIn(people.vishal, TUESDAY, { in: '09:30', out: '18:30', location: 'wfh' });
  await checkIn(people.rohit, MONDAY, { in: '09:20', checkoutStatus: 'missing' });
  await checkIn(people.arjun, MONDAY, { in: '10:00', out: '19:00', lateMinutes: 30 });
  await checkIn(people.neha, MONDAY, { in: '09:25', out: '18:30' });
  return { people, projects: { app, seo }, request };
}
