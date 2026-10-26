// The data the AI summary tests start from: one day of reports on several PMs' projects
// (Wednesday 30 September 2026), and one week of attendance (Monday 28 September to Friday 2
// October). Names are real-looking on purpose: none of them may reach Gemini.
import { db } from '@/lib/db';
import { localToUtc } from '@/lib/time';
import { createUser } from '../helpers/db.js';
import { checkIn, createProject, createReport } from './dashboardKit.js';

export const TZ = 'Asia/Kolkata';
export const PM_DAY = '2026-09-30';
export const [MON, TUE, WED, THU, FRI, SAT] = [
  '2026-09-28',
  '2026-09-29',
  '2026-09-30',
  '2026-10-01',
  '2026-10-02',
  '2026-10-03',
];
/** A local clock time on a date, as a UTC Date. */
export const at = (date, clock) => localToUtc(date, clock, TZ).toDate();

/**
 * Priya (PM, Slack id) has acme-store (three reports today, a done P1, a linked P2), acme-seo (no
 * report) and paused-site (on hold, reported); Rohan (PM, no Slack id) has internal-tool; Kavya's
 * acme-blog only has a draft; Ravi is a deactivated PM with a reported project.
 */
export async function seedPmDay() {
  const pm = { role: 'pm', tracksAttendance: false };
  const priya = await createUser({ ...pm, name: 'Priya Sharma', slackUserId: 'U0PRIYA001' });
  const rohan = await createUser({ ...pm, name: 'Rohan Mehta', email: 'rohan.mehta@example.com' });
  const kavya = await createUser({ ...pm, name: 'Kavya Iyer' });
  const ravi = await createUser({ ...pm, name: 'Ravi Verma', status: 'deactivated' });
  const vishal = await createUser({ name: 'Vishal Saini', email: 'vishal.saini@example.com' });
  const neha = await createUser({ name: 'Neha Kapoor', slackUserId: 'U0NEHA0001' });
  const anil = await createUser({ name: 'Anil Kumar', role: 'admin' });
  const meera = await createUser({ name: 'Meera Joshi' });

  const store = await createProject(priya, { name: 'acme-store' });
  await createProject(priya, { name: 'acme-seo' });
  const onHold = await createProject(priya, { name: 'paused-site', status: 'on_hold' });
  const internal = await createProject(rohan, { name: 'internal-tool' });
  const blog = await createProject(kavya, { name: 'acme-blog' });
  const legacy = await createProject(ravi, { name: 'legacy-app' });

  const task = (title, priority, extra = {}) => ({
    projectId: store.id,
    title,
    priority,
    createdBy: priya.id,
    ...extra,
  });
  const [checkoutTaskId] = await db('projectTasks').insert(task('Checkout bug', 'p2'));
  await db('projectTasks').insert([
    task('Fix login timeout', 'p1', { status: 'done', doneAt: at(PM_DAY, '15:00') }),
    task('Old done task', 'p3', { status: 'done', doneAt: at('2026-09-29', '15:00') }),
  ]);

  const done = (title) => ({ title, status: 'done' });
  const { taskIds } = await createReport(vishal, PM_DAY, {
    entries: [
      {
        projectId: store.id,
        minutes: 390,
        tasks: [
          done('Fixed the checkout bug'),
          { title: 'Product page layout', status: 'in_progress' },
        ],
      },
      { projectId: onHold.id, minutes: 30, tasks: [done('Old cleanup')] },
    ],
  });
  await db('reportTasks').where({ id: taskIds[0] }).update({ projectTaskId: checkoutTaskId });
  const blocked = { title: 'Waiting for API keys', status: 'blocked', firstReportedOn: MON };
  await createReport(neha, PM_DAY, {
    entries: [
      { projectId: store.id, minutes: 120, tasks: [blocked] },
      { projectId: internal.id, minutes: 60, tasks: [done('Set up CI')] },
      { projectId: legacy.id, minutes: 30, tasks: [done('Patched login')] },
    ],
  });
  await createReport(anil, PM_DAY, {
    entries: [{ projectId: store.id, minutes: 60, tasks: [done('Release notes')] }],
  });
  await createReport(meera, PM_DAY, {
    status: 'draft',
    entries: [{ projectId: blog.id, minutes: 240, tasks: [done('Draft post')] }],
  });
  return { priya, rohan, people: [priya, rohan, kavya, ravi, vishal, neha, anil, meera] };
}

/**
 * Hema (HR) is present and on time all week with every report in; Vishal has a late Monday, WFH
 * and a 75-minute break on Tuesday, a missing check-out on Wednesday (with a correction request
 * sent on Friday), an auto check-out on Thursday, a late Friday and no Friday report; Neha came
 * Monday and Tuesday (Tuesday's report is a draft); Arjun joined on Wednesday. Anil (Admin), Ravi
 * (deactivated) and Priya (PM, not tracked) must never be counted.
 */
export async function seedHrWeek() {
  const hema = await createUser({ name: 'Hema Rao', role: 'hr', designation: 'HR' });
  const vishal = await createUser({ name: 'Vishal Saini', email: 'vishal.saini@example.com' });
  const neha = await createUser({ name: 'Neha Kapoor', slackUserId: 'U0NEHA0001' });
  const anil = await createUser({ name: 'Anil Kumar', role: 'admin' });
  const priya = await createUser({ name: 'Priya Sharma', role: 'pm', tracksAttendance: false });
  const ravi = await createUser({ name: 'Ravi Verma', status: 'deactivated' });
  const arjun = await createUser({ name: 'Arjun Nair', joinedOn: WED });

  for (const day of [MON, TUE, WED, THU, FRI]) {
    await checkIn(hema, day, { out: day === FRI ? null : '18:30' });
    await createReport(hema, day);
    await checkIn(anil, day, { in: '10:30', lateMinutes: 60, checkoutStatus: 'missing' });
    await checkIn(ravi, day, { in: '11:00', lateMinutes: 90 });
  }
  await checkIn(vishal, MON, { in: '09:50', out: '18:40', lateMinutes: 20 });
  const tuesday = await checkIn(vishal, TUE, { out: '18:30', location: 'wfh' });
  await db('attendanceBreaks').insert({
    userId: vishal.id,
    attendanceId: tuesday,
    workDate: TUE,
    startedAt: at(TUE, '13:00'),
    endedAt: at(TUE, '14:15'),
    endReason: 'self',
  });
  const wednesday = await checkIn(vishal, WED, { checkoutStatus: 'missing' });
  await checkIn(vishal, THU, { out: '18:31', checkoutStatus: 'auto' });
  await checkIn(vishal, FRI, { in: '09:45', lateMinutes: 15 });
  for (const day of [MON, TUE, WED, THU]) await createReport(vishal, day);
  const correction = {
    userId: vishal.id,
    attendanceId: wednesday,
    workDate: WED,
    type: 'check_out',
    requestedTime: at(WED, '18:30'),
    reason: 'Forgot to check out',
  };
  await db('attendanceCorrections').insert([
    { ...correction, createdAt: at(FRI, '10:00') },
    { ...correction, workDate: '2026-09-25', createdAt: at('2026-09-25', '19:00') },
  ]);

  await checkIn(neha, MON, { out: '18:30' });
  await checkIn(neha, TUE, { out: '18:30' });
  await createReport(neha, MON);
  await createReport(neha, TUE, { status: 'draft' });
  await checkIn(arjun, WED, { out: '18:30' });
  await checkIn(arjun, THU, { out: '18:30' });
  await createReport(arjun, WED);
  return { hema, anil, people: [hema, vishal, neha, anil, priya, ravi, arjun] };
}
