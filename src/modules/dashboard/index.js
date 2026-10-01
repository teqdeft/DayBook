import * as projectReport from './projectReport';
import * as projectReportWorkbook from './projectReportWorkbook';
import * as service from './service';

export const dashboard = { ...service, ...projectReport, ...projectReportWorkbook };
