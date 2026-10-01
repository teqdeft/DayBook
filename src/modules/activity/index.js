// The activity module (screen time, CONTRACT section 11). Other code imports only this:
// import { activity } from '@/modules/activity'.
import * as service from './service';
import { exportDay } from './workbook';

export const activity = { ...service, exportDay };
