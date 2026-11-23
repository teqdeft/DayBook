// The words of the morning HR summary and the evening wrap-up (CONTRACT 25, item 1), pure: the
// bell title (counts), the bell body (count first, joined with " · ") and the Slack DM (one line
// per list that has someone, at most 15 names a line, then "and 4 more"). Names are escaped for
// Slack, so "<Neha & co>" shows as typed. Yes or no about reports only, never their content.
import { plural } from '@/lib/text';
import { formatDayShort, formatDuration } from '@/lib/time';
import { escapeSlackText } from '@/modules/slack/format';

export const MAX_NAMES = 15;
const DOT = ' · ';
const PARTS = { first_half: 'first half', second_half: 'second half' };

/**
 * "Priya Sharma, Karan Mehta and 4 more", with an optional last piece ("1 still on their shift").
 * @param {string[]} items already escaped
 * @param {string | null} [extra]
 */
export function nameList(items, extra = null) {
  const rest = items.length - MAX_NAMES;
  const shown = items.slice(0, MAX_NAMES).join(', ');
  const text = rest > 0 ? `${shown} and ${rest} more` : shown;
  if (!extra) return text;
  return text ? `${text} and ${extra}` : extra;
}

const esc = (name) => escapeSlackText(name);
const line = (label, items, extra) => `*${label} (${items.length}):* ${nameList(items, extra)}`;
const link = (origin) => `<${origin}/attendance|Open Attendance>`;

function morningTitle({ notCheckedIn, late }) {
  const parts = [];
  if (notCheckedIn.length > 0) parts.push(`${notCheckedIn.length} not checked in`);
  if (late.length > 0) parts.push(`${late.length} late`);
  if (parts.length === 0) return 'Morning attendance: everyone has checked in';
  return `Morning attendance: ${parts.join(', ')}`;
}

function morningBody({ onLeave, wfh, waiting, missing }) {
  const waitingCount = waiting.corrections + waiting.wfh;
  const parts = [];
  if (onLeave.length > 0) parts.push(`${onLeave.length} on leave`);
  if (wfh.length > 0) parts.push(`${wfh.length} WFH`);
  if (waitingCount > 0) parts.push(`${waitingCount} waiting for you`);
  if (missing.count > 0) {
    parts.push(`${missing.count} ${plural(missing.count, 'missing check-out')} ${missing.label}`);
  }
  return parts.length > 0 ? parts.join(DOT) : 'Nothing is waiting for you.';
}

function waitingLine({ corrections, wfh }) {
  const parts = [];
  if (corrections > 0) parts.push(`${corrections} ${plural(corrections, 'correction request')}`);
  if (wfh > 0) parts.push(`${wfh} ${plural(wfh, 'work from home request')}`);
  return parts.length > 0 ? `*Waiting for you:* ${parts.join(', ')}` : null;
}

function morningLines(facts) {
  const { notCheckedIn, late, onLeave, wfh, missing } = facts;
  const lines = [
    notCheckedIn.length > 0 &&
      line(
        'Not checked in',
        notCheckedIn.map(({ name, startsAt }) =>
          startsAt ? `${esc(name)} (starts ${startsAt})` : esc(name),
        ),
      ),
    late.length > 0 &&
      line(
        'Late',
        late.map(({ name, minutes }) => `${esc(name)} ${formatDuration(minutes)}`),
      ),
    onLeave.length > 0 &&
      line(
        'On leave',
        onLeave.map(({ name, part }) => (PARTS[part] ? `${esc(name)}, ${PARTS[part]}` : esc(name))),
      ),
    wfh.length > 0 && line('Working from home', wfh.map(esc)),
    waitingLine(facts.waiting),
    missing.count > 0 &&
      `*Missing check-outs ${missing.label} (${missing.count}):* ${nameList(missing.names.map(esc))}`,
  ];
  return lines.filter(Boolean);
}

/**
 * The morning summary for one recipient.
 * @param {{ date: string, time: string, notCheckedIn: Array<{ name: string,
 *   startsAt: string | null }>, late: Array<{ name: string, minutes: number }>,
 *   onLeave: Array<{ name: string, part: 'full' | 'first_half' | 'second_half' }>,
 *   wfh: string[], waiting: { corrections: number, wfh: number },
 *   missing: { count: number, names: string[], label: string } }} facts time "10:00 AM";
 *   startsAt "11:00" for someone whose late mark hasn't passed; missing.label "from yesterday"
 *   or "since Friday"
 * @param {{ origin: string }} options the app's origin for the Slack link
 * @returns {{ title: string, body: string, link: string, slack: string }}
 */
export function morningMessage(facts, { origin }) {
  const lines = morningLines(facts);
  const slack = [
    `*Morning attendance, ${formatDayShort(facts.date)}* (${facts.time})`,
    ...(lines.length > 0 ? lines : ['Everyone has checked in and nothing is waiting for you.']),
    link(origin),
  ].join('\n');
  return {
    title: morningTitle(facts),
    body: morningBody(facts),
    link: facts.notCheckedIn.length > 0 ? '/attendance?filter=not_checked_in' : '/attendance',
    slack,
  };
}

function eveningTitle({ stillIn, onShift }) {
  if (stillIn.length > 0) return `Evening attendance: ${stillIn.length} still checked in`;
  if (onShift > 0) return `Evening attendance: ${onShift} still on their shift`;
  return 'Evening attendance: everyone has checked out';
}

function eveningBody({ reportsNotIn, over, autos }) {
  const parts = [];
  const count = autos.items.length;
  if (reportsNotIn.length > 0) {
    parts.push(`${reportsNotIn.length} ${plural(reportsNotIn.length, 'report')} not in`);
  }
  if (over.length > 0) parts.push(`${over.length} over the break allowance`);
  if (count > 0) {
    parts.push(`${count} ${plural(count, 'auto check-out')} since ${formatDayShort(autos.from)}`);
  }
  return parts.length > 0 ? parts.join(DOT) : 'Nothing else to look at.';
}

function eveningLines({ stillIn, onShift, reportsNotIn, over, autos }) {
  const shift = onShift > 0 ? `${onShift} still on their shift` : null;
  const still = stillIn.map(({ name, since }) => `${esc(name)} (since ${since})`);
  const lines = [
    still.length > 0
      ? line('Still checked in', still, shift)
      : shift && `*Still checked in:* ${shift}`,
    reportsNotIn.length > 0 && line('Reports not in', reportsNotIn.map(esc)),
    over.length > 0 &&
      line(
        'Over the break allowance',
        over.map(({ name, minutes }) => `${esc(name)}, over by ${formatDuration(minutes)}`),
      ),
    autos.items.length > 0 &&
      line(
        `Auto check-outs since ${formatDayShort(autos.from)}`,
        autos.items.map(
          ({ name, time, workDate }) => `${esc(name)} at ${time} on ${formatDayShort(workDate)}`,
        ),
      ),
  ];
  return lines.filter(Boolean);
}

/**
 * The evening wrap-up for one recipient.
 * @param {{ date: string, time: string, stillIn: Array<{ name: string, since: string }>,
 *   onShift: number, reportsNotIn: string[], over: Array<{ name: string, minutes: number }>,
 *   autos: { from: string, items: Array<{ name: string, time: string, workDate: string }> } }}
 *   facts time "7:00 PM"; stillIn = open rows past their day end, since "9:32"; onShift = open
 *   rows whose day end hasn't passed; autos.from = the last working day
 * @param {{ origin: string }} options
 * @returns {{ title: string, body: string, link: string, slack: string }}
 */
export function eveningMessage(facts, { origin }) {
  const lines = eveningLines(facts);
  const slack = [
    `*Evening attendance, ${formatDayShort(facts.date)}* (${facts.time})`,
    ...(lines.length > 0 ? lines : ['Everyone has checked out and every report is in.']),
    link(origin),
  ].join('\n');
  return { title: eveningTitle(facts), body: eveningBody(facts), link: '/attendance', slack };
}
