// Guards against editing mistakes in the hand-written demo data: before anything is written, the
// numbers the canvas shows must add up, and only tracked people (never a PM) have attendance and
// reports.
import { NON_TRACKING_ROLES } from '@/lib/permissions';
import { PEOPLE } from './people.js';
import { CORRECTIONS, EDIT_REQUESTS } from './requests.js';
import {
  FORCE_PRESENT,
  LATE_GRACE_MINUTES,
  MISSING_CHECKOUT,
  TODAY,
  VISHAL_DAYS,
  WEEK_DAYS,
  WEEK_HOURS,
  WEEK_TARGETS,
} from './schedule.js';
import { minutesOf } from './calendar.js';

// Attendance this week on 11, by working-day offset (0 = Wed, 1 = Tue, 2 = Mon).
const WEEK_ATTENDANCE = [
  { office: 20, wfh: 4, absent: 2 },
  { office: 21, wfh: 4, absent: 1 },
  { office: 22, wfh: 3, absent: 1 },
];

const isTracked = (p) => p.tracksAttendance && p.status === 'active';

function expect(condition, message) {
  if (!condition) throw new Error(`Demo data doesn't match the canvas: ${message}`);
}

function addHours(totals, entries) {
  for (const [project, hours] of entries ?? []) totals[project] = (totals[project] ?? 0) + hours;
}

/** Team hours by project this week (05, 11), counting Vishal's submitted days. */
function checkWeek() {
  const totals = {};
  for (const days of Object.values(WEEK_HOURS)) {
    days.forEach((entries) => addHours(totals, entries));
  }
  VISHAL_DAYS.slice(0, 3).forEach((day) => addHours(totals, day.entries));
  for (const [project, hours] of Object.entries(WEEK_TARGETS)) {
    expect(
      totals[project] === hours,
      `${project} has ${totals[project]}h this week, not ${hours}h`,
    );
  }
  expect(
    Object.keys(totals).length === Object.keys(WEEK_TARGETS).length,
    'extra projects this week',
  );
}

/** Vishal's month (03, 06): 142h, 21 of 22 days, 2 late days (14 min), 3 WFH days, 9:36 average. */
function checkVishal() {
  const present = VISHAL_DAYS.filter((day) => !day.absent);
  const totals = {};
  present.forEach((day) => addHours(totals, day.entries));
  expect(totals.internal === 86 && totals.iwill === 38 && totals.store === 18, 'Vishal hours');
  expect(present.length === 21 && VISHAL_DAYS.length === 22, 'Vishal days present');
  const lateBy = present.map((day) => minutesOf(day.in) - minutesOf('09:30'));
  const late = lateBy.filter((minutes) => minutes > LATE_GRACE_MINUTES);
  expect(late.length === 2 && late[0] + late[1] === 28, 'Vishal late days');
  expect(present.filter((day) => day.where === 'wfh').length === 3, 'Vishal WFH days');
  const average = lateBy.reduce((sum, minutes) => sum + minutes, 0) / present.length;
  expect(average === 6, `Vishal average check-in is 9:${30 + average}`);
}

/**
 * Company rule: PMs never check in or write reports. Only tracked people may appear in the
 * schedule, and everyone tracked except Vishal (VISHAL_DAYS) has hours this week.
 */
function checkTracking() {
  for (const p of PEOPLE) {
    expect(!(NON_TRACKING_ROLES.includes(p.role) && p.tracksAttendance), `${p.key} is tracked`);
  }
  const tracked = new Set(PEOPLE.filter(isTracked).map((p) => p.key));
  const scheduled = [
    ...Object.keys(WEEK_HOURS),
    ...Object.keys(TODAY),
    ...WEEK_DAYS.flatMap((day) => [...day.absent, ...day.wfh]),
    MISSING_CHECKOUT.key,
    ...FORCE_PRESENT.map(([key]) => key),
    ...EDIT_REQUESTS.map((request) => request.key),
    ...CORRECTIONS.map((correction) => correction.key),
  ];
  for (const key of scheduled) {
    expect(tracked.has(key), `${key} has attendance or reports but isn't tracked`);
  }
  for (const key of tracked) {
    expect(key === 'vishal' || key in WEEK_HOURS, `${key} has no hours this week`);
  }
}

/** Attendance this week (11): office, WFH and not checked in on each day so far. */
function checkWeekAttendance() {
  const tracked = PEOPLE.filter(isTracked).length;
  for (const [offset, day] of WEEK_DAYS.entries()) {
    const want = WEEK_ATTENDANCE[offset];
    const office = tracked - day.absent.length - day.wfh.length;
    expect(
      office === want.office && day.wfh.length === want.wfh && day.absent.length === want.absent,
      `attendance at offset ${offset}: ${office} office, ${day.wfh.length} WFH, ` +
        `${day.absent.length} not checked in`,
    );
  }
}

/** Today (05, 09): 26 tracked, 24 checked in (20 office, 4 WFH), 3 late, 21 reports. */
function checkToday() {
  const tracked = PEOPLE.filter(isTracked);
  expect(tracked.length === 26, `${tracked.length} tracked people`);
  const today = WEEK_DAYS[0];
  expect(tracked.length - today.absent.length === 24 && today.wfh.length === 4, 'check-ins today');
  const late = Object.values(TODAY).filter(
    (row) => row.in && minutesOf(row.in) - minutesOf('09:30') > LATE_GRACE_MINUTES,
  );
  expect(late.length === 3, 'late today');
  const withoutReport = tracked.filter(
    (p) => p.key !== 'vishal' && !today.absent.includes(p.key) && !WEEK_HOURS[p.key]?.[0],
  );
  expect(withoutReport.length === 3, `${withoutReport.length} checked in without a report`);
  for (const [offset, day] of WEEK_DAYS.entries()) {
    for (const key of day.absent) {
      expect(!WEEK_HOURS[key]?.[offset], `${key} is absent at offset ${offset} but has hours`);
    }
  }
}

/** Throws when the hand-written data no longer adds up to the canvas numbers. */
export function checkDesignNumbers() {
  checkTracking();
  checkWeek();
  checkVishal();
  checkWeekAttendance();
  checkToday();
}
