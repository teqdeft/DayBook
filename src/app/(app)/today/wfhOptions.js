// Today's work-from-home pieces (CONTRACT 17), kept pure so the check-in card, the request dialog
// and todayData.js share them and unit tests can run them: which check-in options are open and
// what their hints say, the request lines under the page's links and the request dialog's dates.
import { addDays, isWorkingDay } from '@/lib/time';

/** The most days one request may cover (the server's MAX_WFH_DAYS). */
export const MAX_WFH_DAYS = 14;

/** "Vishal" from "Vishal Saini"; placeholder names like "[PM name]" stay whole. */
export function firstName(name) {
  const value = String(name ?? '').trim();
  if (!value || value.startsWith('[')) return value;
  return value.split(/\s+/)[0];
}

/**
 * The person's work-from-home state for today's check-in card.
 * @param {{ wfh?: { approved: object | null, pending: object[] } | null,
 *   wfhNeedsApproval?: boolean }} mine attendance.getMyToday()
 * @returns {{ needsApproval: boolean, approved: boolean, approvedBy: string | null,
 *   pending: boolean }} approvedBy: the first name of who approved today's request
 */
export function wfhToday(mine) {
  const approved = mine.wfh?.approved ?? null;
  return {
    needsApproval: Boolean(mine.wfhNeedsApproval),
    approved: Boolean(approved),
    approvedBy: approved?.handledBy?.name ? firstName(approved.handledBy.name) : null,
    pending: (mine.wfh?.pending?.length ?? 0) > 0,
  };
}

function pickChoice(picked, { officeOpen, wfhOpen, unverifiedOpen }) {
  if (picked === 'office' && officeOpen) return 'office';
  if (picked === 'wfh' && wfhOpen) return 'wfh';
  if (picked === 'unverified' && unverifiedOpen) return 'unverified';
  if (officeOpen) return 'office';
  return wfhOpen ? 'wfh' : null;
}

function officeOption({ onOfficeNetwork, officeAnywhere, unverified }) {
  const office = { value: 'office', title: 'Office', disabled: false };
  if (officeAnywhere) return { ...office, hint: 'Check in from anywhere for now' };
  if (onOfficeNetwork) return { ...office, hint: "You're on the office Wi-Fi" };
  if (unverified) {
    return {
      ...office,
      value: 'unverified',
      title: 'Office, unverified',
      hint: 'HR confirms it later',
    };
  }
  return { ...office, hint: 'Only on the office Wi-Fi', disabled: true };
}

function wfhOption({ onOfficeNetwork, wfh }) {
  if (onOfficeNetwork) return { hint: 'Not while on the office Wi-Fi', disabled: true, ask: false };
  if (!wfh.needsApproval) {
    return { hint: 'Or anywhere outside the office', disabled: false, ask: false };
  }
  if (wfh.approved) {
    const by = wfh.approvedBy || 'HR';
    return { hint: `Approved by ${by}`, disabled: false, ask: false };
  }
  if (wfh.pending) return { hint: 'Waiting for HR', disabled: true, ask: false };
  return { hint: "Needs HR's approval", disabled: true, ask: true };
}

/**
 * What the check-in card offers and which option is picked (guide 7.2.2-3, CONTRACT 17). The
 * server decides for real; this only offers what it will accept:
 * - on the office network the only option is Office;
 * - with officeAnywhere, Office works from any network and is picked first, and the card shows
 *   neither the network tag nor the Wi-Fi line;
 * - otherwise plain Office needs the office network, and "Office, unverified" is there while the
 *   company allows it;
 * - WFH never on the office network and, when the person needs approval, only on a day HR
 *   approved (pending: "Waiting for HR"; nothing asked yet: "Needs HR's approval" with Ask HR).
 * @param {{ picked: 'office' | 'wfh' | 'unverified' | null, onOfficeNetwork: boolean,
 *   officeAnywhere: boolean, allowUnverifiedOffice: boolean,
 *   wfh: ReturnType<typeof wfhToday> }} input picked: what the person clicked last, if anything
 * @returns {{ choice: 'office' | 'wfh' | 'unverified' | null,
 *   office: { value: string, title: string, hint: string, disabled: boolean },
 *   wfh: { hint: string, disabled: boolean, ask: boolean }, network: 'on' | 'off' | null,
 *   wifi: 'unverified' | 'offer' | 'officeOnly' | null, wfhOpen: boolean }}
 *   choice null: nothing can be picked yet (no check-in); network: the tag beside the title;
 *   wifi: the line under the options
 */
export function checkInOptions({
  picked,
  onOfficeNetwork,
  officeAnywhere,
  allowUnverifiedOffice,
  wfh,
}) {
  const officeOpen = Boolean(onOfficeNetwork || officeAnywhere);
  const wfhOpen = !onOfficeNetwork && (!wfh.needsApproval || wfh.approved);
  const unverifiedOpen = !officeOpen && Boolean(allowUnverifiedOffice);
  const choice = pickChoice(picked, { officeOpen, wfhOpen, unverifiedOpen });
  const unverified = choice === 'unverified';
  let wifi = null;
  if (!officeOpen) wifi = unverified ? 'unverified' : unverifiedOpen ? 'offer' : 'officeOnly';
  return {
    choice,
    office: officeOption({ onOfficeNetwork, officeAnywhere, unverified }),
    wfh: wfhOption({ onOfficeNetwork, wfh }),
    network: officeAnywhere ? null : onOfficeNetwork ? 'on' : 'off',
    wifi,
    wfhOpen,
  };
}

const byFromDate = (a, b) => (a.fromDate < b.fromDate ? -1 : a.fromDate > b.fromDate ? 1 : 0);

/**
 * The lines under Today's links, one per request the person can still cancel: those waiting for
 * HR, then the approved ones, soonest first. Only requests that aren't over yet: a pending one
 * whose last day has passed is out of date (nobody decided in time).
 * @param {Array<{ id: number, fromDate: string, toDate: string, days: string,
 *   status: string }>} requests listWfhRequests() items (days: "Tue, 14 – Thu, 16 Oct")
 * @param {string} today 'YYYY-MM-DD'
 * @returns {Array<{ id: number, status: 'pending' | 'approved', days: string, started: boolean,
 *   text: string }>} started: an approved request whose first day is today or earlier
 *   (cancelling ends it early)
 */
export function wfhLines(requests, today) {
  const open = (status) =>
    requests
      .filter((request) => request.status === status && request.toDate >= today)
      .sort(byFromDate);
  const line = (request, text) => ({
    id: request.id,
    status: request.status,
    days: request.days,
    started: request.status === 'approved' && request.fromDate <= today,
    text,
  });
  return [
    ...open('pending').map((request) =>
      line(request, `Waiting for HR: Working from home on ${request.days}.`),
    ),
    ...open('approved').map((request) =>
      line(request, `Working from home approved for ${request.days}.`),
    ),
  ];
}

/**
 * The cancel dialog's words for a line (WfhCancelDialog.jsx).
 * @param {{ status: string, days: string, started: boolean }} line from wfhLines()
 * @returns {{ title: string, description: string, confirm: string }}
 */
export function cancelWording(line) {
  if (line.status === 'pending') {
    return {
      title: 'Cancel this request?',
      description: `You asked to work from home on ${line.days}. HR won't need to decide on it.`,
      confirm: 'Cancel request',
    };
  }
  if (line.started) {
    return {
      title: 'Cancel the rest?',
      description:
        `HR approved working from home on ${line.days}. The days from today on are cancelled; ` +
        "today stays if you've already checked in from home.",
      confirm: 'Cancel the rest',
    };
  }
  return {
    title: 'Cancel working from home?',
    description:
      `HR approved working from home on ${line.days}. ` +
      'To work from home on those days after all, ask again.',
    confirm: 'Cancel it',
  };
}

/**
 * The toast after a cancel: the whole request went, or (an approved one that had started) the
 * rest of it, keeping its first days.
 * @param {{ status: string }} line from wfhLines()
 * @param {{ status: string, days: string } | null} request what the cancel API answered
 */
export function cancelledToast(line, request) {
  if (request?.status === 'approved') {
    return {
      title: 'The rest is cancelled',
      body: `Working from home stays approved for ${request.days}.`,
    };
  }
  return { title: line.status === 'pending' ? 'Request cancelled' : 'Working from home cancelled' };
}

/**
 * The first working day after `today` (the "another day" request starts there).
 * @param {string} today 'YYYY-MM-DD'
 * @param {number[]} workingDays ISO weekdays, settings.workingDays
 */
export function nextWorkingDay(today, workingDays) {
  for (let step = 1; step <= 7; step += 1) {
    const date = addDays(today, step);
    if (isWorkingDay(date, workingDays ?? [])) return date;
  }
  return addDays(today, 1);
}

/**
 * The request dialog's To day after From changes: it follows From until the person picks a day
 * of their own, and never stays before From.
 * @param {{ toDate: string, toTouched: boolean }} form
 * @param {string} fromDate the new From ('YYYY-MM-DD' or '')
 */
export function followFrom({ toDate, toTouched }, fromDate) {
  if (!toTouched || !toDate || (fromDate && toDate < fromDate)) return fromDate;
  return toDate;
}

/** The last day To may be for a From day (MAX_WFH_DAYS days in all), or '' without one. */
export function lastToDate(fromDate) {
  return fromDate ? addDays(fromDate, MAX_WFH_DAYS - 1) : '';
}
