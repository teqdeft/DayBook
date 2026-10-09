// The attendance module: check-in and check-out, the day view, HR edits and corrections.
// Other code imports only this: import { attendance } from '@/modules/attendance'.
import * as breaks from './breaks';
import * as corrections from './corrections';
import * as day from './day';
import * as decisions from './decisions';
import * as hr from './hr';
import * as service from './service';

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
  listDay: day.listDay,
  listForDay: day.listForDay,
  filterDay: day.filterDay,
  getDaySummary: day.getDaySummary,
  listMissingCheckouts: day.listMissingCheckouts,
  exportDay: day.exportDay,
  resolveDate: day.resolveDate,
  createForUser: hr.createForUser,
  updateRow: hr.updateRow,
  confirmOffice: hr.confirmOffice,
  requestCorrection: corrections.requestCorrection,
  listCorrections: corrections.listCorrections,
  approveCorrection: decisions.approveCorrection,
  rejectCorrection: decisions.rejectCorrection,
};
