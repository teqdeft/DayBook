// The attendance module: check-in and check-out, the day view, HR edits, corrections,
// work-from-home requests, the auto check-out of inactive people (CONTRACT 19), and the person's
// day with holidays, leave and the marks (CONTRACT 25).
// Other code imports only this: import { attendance } from '@/modules/attendance'.
// Each 1.10 builder's part is one barrel spread at the end (CONTRACT 25, "Files and owners").
import * as autoCheckout from './autoCheckout';
import * as breakExports from './breakExports';
import * as breaks from './breaks';
import * as calendar from './calendar';
import * as calendarExports from './calendarExports';
import * as calendarReads from './calendarReads';
import * as checkoutEntered from './checkoutEntered';
import * as checkoutExports from './checkoutExports';
import * as corrections from './corrections';
import * as day from './day';
import * as dayExport from './dayExport';
import * as dayRules from './dayRules';
import * as decisions from './decisions';
import * as hr from './hr';
import * as leaveReads from './leaveReads';
import * as marks from './marks';
import * as monthExports from './monthExports';
import * as payroll from './payroll';
import * as reminderExports from './reminderExports';
import * as service from './service';
import * as tellPerson from './tellPerson';
import * as wfh from './wfh';
import * as wfhDecisions from './wfhDecisions';

export const attendance = {
  ...service,
  startBreak: breaks.startBreak,
  endBreak: breaks.endBreak,
  getOpenBreak: breaks.getOpenBreak,
  endOpenBreak: breaks.endOpenBreak,
  lockDay: breaks.lockDay,
  listBreaks: breaks.listBreaks,
  listBreaksForDate: breaks.listBreaksForDate,
  closeForgottenBreaks: breaks.closeForgottenBreaks,
  sendCheckoutReminders: autoCheckout.sendCheckoutReminders,
  autoCheckOut: autoCheckout.autoCheckOut,
  // The person's day (CONTRACT 25)
  personDay: calendar.personDay,
  presenceOf: calendar.presenceOf,
  leaveFraction: calendar.leaveFraction,
  dayCounts: calendar.dayCounts,
  halfDayAt: calendar.halfDayAt,
  lateMinutesForDay: calendar.lateMinutesForDay,
  effectiveLateMinutes: calendar.effectiveLateMinutes,
  LEAVE_PARTS: calendar.LEAVE_PARTS,
  LEAVE_TYPES: calendar.LEAVE_TYPES,
  LEAVE_TYPE_LABELS: calendar.LEAVE_TYPE_LABELS,
  PART_LABELS: calendar.PART_LABELS,
  loadCalendar: calendarReads.loadCalendar,
  getDay: calendarReads.getDay,
  companyDay: calendarReads.companyDay,
  clearCompanyDayCache: calendarReads.clearCompanyDayCache,
  lastWorkingDayBefore: calendarReads.lastWorkingDayBefore,
  holidaysBefore: calendarReads.holidaysBefore,
  listHolidaysBetween: calendarReads.listHolidaysBetween,
  nextHoliday: calendarReads.nextHoliday,
  dayPersonOf: calendarReads.dayPersonOf,
  listOnLeave: leaveReads.listOnLeave,
  listUpcomingLeave: leaveReads.listUpcomingLeave,
  getMyLeave: leaveReads.getMyLeave,
  applyDayRules: dayRules.applyDayRules,
  recheckDayRules: dayRules.recheckDayRules,
  dayMarks: marks.dayMarks,
  payrollPeriod: payroll.payrollPeriod,
  payrollMonthOf: payroll.payrollMonthOf,
  resolvePayrollMonth: payroll.resolvePayrollMonth,
  checkoutEnteredFor: checkoutEntered.checkoutEnteredFor,
  markCheckoutEntered: checkoutEntered.markCheckoutEntered,
  clearCheckoutEntered: checkoutEntered.clearCheckoutEntered,
  // The day list
  listDay: day.listDay,
  listForDay: day.listForDay,
  filterDay: day.filterDay,
  summarize: day.summarize,
  getDaySummary: day.getDaySummary,
  missingWindow: day.missingWindow,
  exportDay: dayExport.exportDay,
  resolveDate: day.resolveDate,
  createForUser: hr.createForUser,
  updateRow: hr.updateRow,
  confirmOffice: hr.confirmOffice,
  tellPerson: tellPerson.tellPerson,
  requestCorrection: corrections.requestCorrection,
  listCorrections: corrections.listCorrections,
  approveCorrection: decisions.approveCorrection,
  rejectCorrection: decisions.rejectCorrection,
  requestWfh: wfh.requestWfh,
  listWfhRequests: wfh.listWfhRequests,
  countPendingWfh: wfh.countPendingWfh,
  getWfhForDay: wfh.getWfhForDay,
  approveWfh: wfhDecisions.approveWfh,
  declineWfh: wfhDecisions.declineWfh,
  cancelWfh: wfhDecisions.cancelWfh,
  // 1.10 builders' parts (B breaks, C check-outs, D reminders, E month, F holidays and leave)
  ...breakExports,
  ...checkoutExports,
  ...reminderExports,
  ...monthExports,
  ...calendarExports,
};
