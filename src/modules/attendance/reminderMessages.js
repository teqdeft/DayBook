// What a remind says (CONTRACT 25, item 5), pure: the bell title and body (the bell also gives
// the desktop push) and the Slack DM. "Neha Kapoor" is the sender's full name; Daybook's own
// check-in reminder has no sender. Names in the Slack text are escaped, so "<Neha & co>" shows as
// typed. The link is Today, and /today?checkout=missing for a missing check-out, so the pop-up
// opens even after "Not now".
import { formatClock, formatDayShort, formatDuration, formatTimeAmPm } from '@/lib/time';
import { escapeSlackText } from '@/modules/slack/format';

const TODAY = '/today';
const MISSING_LINK = '/today?checkout=missing';

/** "Fri, 13 Nov" days of the missing check-outs, oldest first. */
function missingDays(dates) {
  return [...new Set(dates ?? [])].sort().map(formatDayShort);
}

/** The first sentence about the missing check-outs, and the bell's second one. */
function missingText(dates) {
  const days = missingDays(dates);
  if (days.length <= 1) {
    return {
      about: `You didn't check out on ${days[0] ?? 'an earlier day'}.`,
      ask: 'Add the time you left on Today.',
    };
  }
  const about =
    days.length === 2
      ? `You didn't check out on ${days[0]} and ${days[1]}.`
      : `You have ${days.length} missing check-outs, the latest on ${days.at(-1)}.`;
  return { about, ask: 'Add the times you left on Today.' };
}

function breakText({ onBreakSince, breakMinutes, allowanceMinutes, tz }) {
  return (
    `You've been on a break since ${formatTimeAmPm(onBreakSince, tz)}. ` +
    `Your breaks today are ${formatDuration(breakMinutes)}, over the ` +
    `${formatDuration(allowanceMinutes)} allowance.`
  );
}

/** Each kind: the bell title, the bell body, and the Slack DM's sentence and link text. */
function partsFor(kind, sender, details) {
  if (kind === 'check_in' && !sender) {
    const started = `Your day started at ${formatClock(details.expectedStart)}.`;
    return {
      title: "You haven't checked in yet",
      body: `${started} Check in on Today when you start work.`,
      slack: `You haven't checked in yet. ${started}`,
      linkText: 'Check in on Today',
    };
  }
  if (kind === 'check_in') {
    return {
      title: `${sender} reminded you to check in`,
      body: "You haven't checked in today. Check in on Today when you start work.",
      intro: 'reminded you to check in.',
      slack: "You haven't checked in today.",
      linkText: 'Check in on Today',
    };
  }
  if (kind === 'break') {
    const body = breakText(details);
    return {
      title: `${sender} reminded you about your break`,
      body,
      intro: 'reminded you about your break.',
      slack: body,
      linkText: 'End your break on Today',
    };
  }
  if (kind === 'check_out') {
    return {
      title: `${sender} reminded you to check out`,
      body: "You're still checked in. Check out on Today if you're done for the day.",
      intro: 'reminded you to check out.',
      slack: "You're still checked in.",
      linkText: 'Open Today',
    };
  }
  const { about, ask } = missingText(details.dates);
  return {
    title: `${sender} asked for your check-out time`,
    body: `${about} ${ask}`,
    intro: 'asked for your check-out time.',
    slack: about,
    linkText: 'Add it on Today',
  };
}

/**
 * The bell notification and the Slack DM of one remind.
 * @param {{ kind: 'check_in' | 'break' | 'check_out' | 'missing_checkout',
 *   sender?: string | null, details?: { expectedStart?: string, onBreakSince?: Date | string,
 *   breakMinutes?: number, allowanceMinutes?: number, dates?: string[], tz?: string },
 *   origin: string }} input sender = the full name of whoever sent it (none = Daybook's
 *   automatic check-in reminder); details: check_in (automatic) expectedStart 'HH:mm'; break
 *   onBreakSince, breakMinutes, allowanceMinutes and tz; missing_checkout the work dates
 * @returns {{ type: string, title: string, body: string, link: string, slack: string }}
 */
export function reminderMessage({ kind, sender = null, details = {}, origin }) {
  const parts = partsFor(kind, sender, details);
  const link = kind === 'missing_checkout' ? MISSING_LINK : TODAY;
  const intro = sender ? `*${escapeSlackText(sender)}* ${parts.intro} ` : '';
  return {
    type: sender ? `attendance.remind_${kind}` : 'attendance.checkin_reminder',
    title: parts.title,
    body: parts.body,
    link,
    slack: `${intro}${parts.slack} <${origin}${link}|${parts.linkText}>`,
  };
}
