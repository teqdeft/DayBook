// The timers module (CONTRACT 15): project timers that fill the daily report.
// Other code imports only this: import { timers } from '@/modules/timers'. No spread: attendance
// and timers call each other, and a namespace reference stays live through the import cycle.
import * as service from './service';

export const timers = service;
