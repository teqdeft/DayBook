// Weekly HR notes (CONTRACT 20, worker ai-hr-notes): on the week's last working day, numbers per
// tracked, active, non-Admin person for Monday to today go to Gemini as "Person 1" tokens; the
// fast model writes neutral, factual notes, saved for each recipient (the active HR people, or
// the Admins when there is no HR) with a bell notification. An Admin's attendance is never in
// them (CONTRACT 16), and an 'auto' check-out is a check-out, counted on its own (CONTRACT 19).
import { db } from '@/lib/db';
import { can } from '@/lib/permissions';
import {
  eachDay,
  formatClock,
  formatDayShort,
  formatDuration,
  isWorkingDay,
  localToUtc,
  now,
  weekRange,
} from '@/lib/time';
import { ai } from '@/modules/ai';
import { attendance } from '@/modules/attendance';
import { notifications } from '@/modules/notifications';
import { settings } from '@/modules/settings';
import { users } from '@/modules/users';
import { dayBounds } from './calendar';
import * as repo from './repo';
import { bellBody } from './text';
import { isAiError, logFailure, writeSummary } from './writing';

export const HR_NOTES_TITLE = "This week's attendance notes";
/** The longest body kept. */
export const HR_BODY_MAX = 2000;
const JOB = 'ai-hr-notes';

const SYSTEM = [
  "You write HR's weekly attendance notes in Daybook, a work log app, from the numbers given for",
  'Monday to today. Be neutral and factual and use only those numbers. Point out patterns (for',
  'example several late days, missing check-outs or missing reports), people HR may want to',
  'check in with and the numbers behind it, and improvements or what went well. Never judge',
  'people, guess reasons or use disciplinary language (no warnings, penalties, "poor", "lazy" or',
  '"unacceptable"). Write plain text without Markdown: one or two opening sentences, then short',
  '"- " lists under the labels "Patterns:", "Check in with:" and "Going well:" (leave out a label',
  'with nothing under it). Write durations exactly as given, like "1h 15m". Keep the body under',
  '1,600 characters and the title under 80 characters.',
  ai.PEOPLE_TOKEN_NOTE,
].join(' ');

/** HR people get the notes; the Admins when there is no HR. */
async function recipients() {
  const hr = await users.listByRole('hr');
  return hr.length > 0 ? hr : users.listByRole('admin');
}

function emptyCounts(user) {
  return {
    user,
    workingDays: 0,
    presentDays: [],
    wfhDays: 0,
    lateDays: 0,
    lateMinutes: 0,
    missingCheckOuts: 0,
    autoCheckOuts: 0,
    breaksOverDays: 0,
  };
}

/**
 * Each person's attendance numbers for the days, from attendance.listDay() lists (one per day,
 * in the same order): everyone tracked and active who had joined, never an Admin.
 * @returns {Array<{ user: object, workingDays: number, presentDays: string[], wfhDays: number,
 *   lateDays: number, lateMinutes: number, missingCheckOuts: number, autoCheckOuts: number,
 *   breaksOverDays: number }>}
 */
export function countWeek({ days, dayLists, workingDays }) {
  const people = new Map();
  days.forEach((day, index) => {
    const working = isWorkingDay(day, workingDays);
    for (const item of dayLists[index] ?? []) {
      if (item.user.role === 'admin') continue;
      if (!people.has(item.user.id)) people.set(item.user.id, emptyCounts(item.user));
      const person = people.get(item.user.id);
      if (working) person.workingDays += 1;
      const row = item.attendance;
      if (!row) continue;
      person.presentDays.push(day);
      if (row.location === 'wfh') person.wfhDays += 1;
      if (row.lateMinutes > 0) {
        person.lateDays += 1;
        person.lateMinutes += row.lateMinutes;
      }
      if (row.checkoutStatus === 'missing') person.missingCheckOuts += 1;
      if (row.checkoutStatus === 'auto') person.autoCheckOuts += 1;
      if (item.overAllowanceMinutes > 0) person.breaksOverDays += 1;
    }
  });
  return [...people.values()];
}

/** Monday to `date`, everyone's numbers, plus correction requests and missing reports. */
async function loadWeek(date, values) {
  const { from } = weekRange(date);
  const days = eachDay(from, date);
  const dayLists = await Promise.all(days.map((day) => attendance.listDay(day)));
  const people = countWeek({ days, dayLists, workingDays: values.workingDays });
  const ids = people.map((person) => person.user.id);
  const sent = {
    from: dayBounds(from, values.timezone).from,
    to: dayBounds(date, values.timezone).to,
  };
  const [corrections, reportDays] = await Promise.all([
    repo.countCorrectionsByUser(ids, sent),
    repo.listSubmittedReportDays(ids, { from, to: date }),
  ]);
  const submitted = new Set(reportDays.map((row) => `${row.userId}:${row.workDate}`));
  // Today's report only counts as missing from the report reminder on (CONTRACT 16).
  const todayDue = !now().isBefore(localToUtc(date, values.reportReminderAt, values.timezone));
  for (const person of people) {
    person.corrections = corrections[person.user.id] ?? 0;
    person.missingReports = can(person.user, 'report.self')
      ? person.presentDays.filter(
          (day) => !submitted.has(`${person.user.id}:${day}`) && (day < date || todayDue),
        ).length
      : 0;
  }
  return { from, people };
}

/** The prompt: the week's rules and each person's numbers as JSON, people as tokens. */
function promptFor({ from, date, people, values, tokenFor }) {
  const data = {
    week: `${formatDayShort(from)} to ${formatDayShort(date)}`,
    rules: {
      officeHours: `${formatClock(values.officeStart)} to ${formatClock(values.officeEnd)}`,
      lateAfter: formatClock(values.lateAfter),
      dailyBreakAllowance:
        values.breakAllowanceMinutes > 0 ? formatDuration(values.breakAllowanceMinutes) : 'none',
    },
    people: people.map((person) => ({
      person: tokenFor(person.user.id),
      workingDays: person.workingDays,
      daysPresent: person.presentDays.length,
      wfhDays: person.wfhDays,
      lateDays: person.lateDays,
      totalLate: formatDuration(person.lateMinutes),
      missingCheckOuts: person.missingCheckOuts,
      autoCheckOuts: person.autoCheckOuts,
      correctionRequests: person.corrections,
      daysWithBreaksOverAllowance: person.breaksOverDays,
      missingReports: person.missingReports,
    })),
  };
  return [
    'Attendance numbers per person for this week so far (JSON). autoCheckOuts are days Daybook',
    'checked the person out because their computer showed no activity after office hours; they',
    'count as check-outs. missingReports are days they checked in without submitting a report.',
    JSON.stringify(data, null, 1),
  ].join('\n');
}

/**
 * Writes this week's attendance notes for HR (worker ai-hr-notes, on the week's last working
 * day): one Gemini request; the same notes are saved for each recipient (ai_summaries
 * 'hr_weekly', Monday to `date`) with a bell notification (ai.hr_notes, link /summaries/<id>).
 * Does nothing when this week's notes were already written (the worker may run it again after a
 * failure). An AI failure (limit reached, Gemini busy or wrong) is logged and nothing is saved.
 * Never logs the prompt or the answer.
 * @param {string} date 'YYYY-MM-DD', the company's today
 * @returns {Promise<{ written: boolean, recipients: number, people: number, code?: string,
 *   already?: true }>} already = this week's notes were written before
 * @throws only errors that aren't AI errors (for example the database is down)
 */
export async function sendHrNotes(date) {
  const written = await ai.summaryRecipients({
    kind: 'hr_weekly',
    periodFrom: weekRange(date).from,
  });
  if (written.length > 0) return { written: false, recipients: 0, people: 0, already: true };
  const values = await settings.getAll();
  const sendTo = await recipients();
  if (sendTo.length === 0) return { written: false, recipients: 0, people: 0 };
  const { from, people } = await loadWeek(date, values);
  if (people.length === 0) return { written: false, recipients: 0, people: 0 };
  const { tokenFor, names } = ai.pseudonymize(people.map((person) => person.user));
  let notes;
  try {
    notes = await writeSummary({
      feature: 'hr_notes',
      system: SYSTEM,
      prompt: promptFor({ from, date, people, values, tokenFor }),
      names,
      maxLength: HR_BODY_MAX,
      fallbackTitle: HR_NOTES_TITLE,
    });
  } catch (error) {
    if (!isAiError(error)) throw error;
    logFailure(error, { job: JOB });
    return { written: false, recipients: 0, people: people.length, code: error.code };
  }
  await db.transaction(async (trx) => {
    for (const recipient of sendTo) {
      const id = await ai.saveSummary(
        {
          kind: 'hr_weekly',
          recipientId: recipient.id,
          periodFrom: from,
          periodTo: date,
          ...notes,
        },
        trx,
      );
      await notifications.notify(
        {
          userIds: [recipient.id],
          type: 'ai.hr_notes',
          title: HR_NOTES_TITLE,
          body: bellBody(notes.body),
          link: `/summaries/${id}`,
        },
        trx,
      );
    }
  });
  return { written: true, recipients: sendTo.length, people: people.length };
}
