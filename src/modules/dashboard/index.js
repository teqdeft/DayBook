import { buildCalendar } from './calendar';
import * as projectReport from './projectReport';
import * as projectReportWorkbook from './projectReportWorkbook';
import * as service from './service';

// buildCalendar: HR's person month draws its calendar with it (CONTRACT 25, item 8).
export const dashboard = { ...service, ...projectReport, ...projectReportWorkbook, buildCalendar };
