// Rows that hang off the history: requests (08), corrections (09), office networks (12), the bell
// notifications and a few audit log lines.
import { toJson } from '@/lib/db';
import { formatDayShort } from '@/lib/time';
import { NOTIFICATIONS } from './notifications.js';
import { URGENT_NOTES } from './projects.js';
import { OFFICE_IP } from './rows.js';
import { CORRECTIONS, EDIT_REQUESTS, PROJECT_REQUESTS } from './requests.js';

/**
 * @typedef {object} ExtrasContext
 * @property {(offset: number, clock: string) => Date} when local time on a working-day offset
 * @property {(offset: number) => string} dateOf
 * @property {Map<string, {id: number, name: string}>} users
 * @property {Map<string, {id: number, name: string}>} projects
 * @property {{ attendance: Map<string, object>, reports: Map<string, object> }} index
 * @property {boolean} midday
 */

/** @param {ExtrasContext} ctx */
export function buildRequests(ctx) {
  const editRequests = EDIT_REQUESTS.map((request, i) => {
    const report = ctx.index.reports.get(`${request.key}|${request.offset}`);
    if (!report) {
      throw new Error(`Demo data: no report for ${request.key} at offset ${request.offset}`);
    }
    const sentAt = ctx.when(request.sent.offset, request.sent.clock);
    return {
      id: i + 1,
      reportId: report.id,
      workDate: report.workDate,
      requestedBy: ctx.users.get(request.key).id,
      reason: request.reason,
      status: request.status,
      ...handled(request, ctx),
      declineReason: request.declineReason ?? null,
      createdAt: sentAt,
      updatedAt: request.handled ? ctx.when(request.handled.offset, request.handled.clock) : sentAt,
    };
  });
  const projectRequests = PROJECT_REQUESTS.map((request, i) => {
    const sentAt = ctx.when(request.sent.offset, request.sent.clock);
    return {
      id: i + 1,
      requestedBy: ctx.users.get(request.key).id,
      name: request.name,
      note: request.note,
      status: request.status,
      ...handled(request, ctx),
      declineReason: null,
      projectId: request.project ? ctx.projects.get(request.project).id : null,
      createdAt: sentAt,
      updatedAt: request.handled ? ctx.when(request.handled.offset, request.handled.clock) : sentAt,
    };
  });
  return { editRequests, projectRequests };
}

/** @param {ExtrasContext} ctx */
export function buildCorrections(ctx) {
  return CORRECTIONS.map((correction, i) => {
    const attendance = ctx.index.attendance.get(`${correction.key}|${correction.offset}`);
    if (!attendance) {
      throw new Error(
        `Demo data: no attendance for ${correction.key} at offset ${correction.offset}`,
      );
    }
    const sentAt = ctx.when(correction.sent.offset, correction.sent.clock);
    const { handledBy, handledAt } = handled(correction, ctx);
    return {
      id: i + 1,
      userId: ctx.users.get(correction.key).id,
      attendanceId: attendance.id,
      workDate: attendance.workDate,
      type: correction.type,
      requestedTime: ctx.when(correction.requested.offset, correction.requested.clock),
      requestedEndTime: null,
      requestedLocation: null,
      reason: correction.reason,
      status: correction.status,
      handledBy,
      handledAt,
      handlerNote: null,
      createdAt: sentAt,
      updatedAt: handledAt ?? sentAt,
    };
  });
}

function handled(request, ctx) {
  if (!request.handled) return { handledBy: null, handledAt: null };
  return {
    handledBy: ctx.users.get(request.handled.by).id,
    handledAt: ctx.when(request.handled.offset, request.handled.clock),
  };
}

/** Main office from Settings (12), plus this computer so office check-in works locally. */
export function buildOfficeNetworks(ctx) {
  const createdBy = ctx.users.get('ceo').id;
  const createdAt = ctx.when(60, '11:00');
  return [
    { name: 'Main office', ipAddress: OFFICE_IP },
    { name: 'This computer (development)', ipAddress: '127.0.0.1' },
    { name: 'This computer (development)', ipAddress: '::1' },
  ].map((row, i) => ({ id: i + 1, ...row, createdBy, createdAt, updatedAt: createdAt }));
}

/**
 * Bell notifications from NOTIFICATIONS (one row per recipient). Read ones were read the same
 * evening.
 * @param {ExtrasContext} ctx
 */
export function buildNotifications(ctx) {
  const day = (offset) => formatDayShort(ctx.dateOf(offset));
  const rows = [];
  for (const item of NOTIFICATIONS) {
    if (item.eveningOnly && ctx.midday) continue;
    const createdAt = ctx.when(item.at[0], item.at[1]);
    for (const key of item.to) {
      rows.push({
        id: rows.length + 1,
        userId: ctx.users.get(key).id,
        type: item.type,
        title: typeof item.title === 'function' ? item.title(day) : item.title,
        body: item.body,
        link: item.link,
        readAt: item.read ? ctx.when(item.at[0], '19:30') : null,
        // History, not news: the desktop push for these is long done.
        pushedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      });
    }
  }
  return rows;
}

/** A few audit lines for the changes the demo data implies. */
export function buildAuditLogs(ctx) {
  const user = (key) => ctx.users.get(key).id;
  const project = (key) => ctx.projects.get(key).id;
  // Request rows get ids in list order (see buildRequests and buildCorrections).
  const editId = (key) => EDIT_REQUESTS.findIndex((r) => r.key === key && r.handled) + 1;
  const requestId = PROJECT_REQUESTS.findIndex((r) => r.project === 'app') + 1;
  const correctionId = CORRECTIONS.findIndex((c) => c.status === 'approved') + 1;
  const missing = ctx.index.attendance.get('deepak|1').id;
  const lines = [
    ['pm', 'project_request.approve', 'project_request', requestId, [6, '16:15']],
    ['pm', 'project.create', 'project', project('app'), [6, '16:15']],
    ['pm', 'report_edit_request.approve', 'report_edit_request', editId('simran'), [5, '16:30']],
    ['pm', 'report_edit_request.decline', 'report_edit_request', editId('deepak'), [7, '11:20']],
    ['pm', 'report_edit_request.approve', 'report_edit_request', editId('priya'), [9, '15:05']],
    ['neha', 'attendance_correction.approve', 'attendance_correction', correctionId, [11, '10:05']],
    [null, 'attendance.mark_missing', 'attendance', missing, [0, '00:05']],
    ['pm', 'project.mark_urgent', 'project', project('iwill'), [0, '11:05'], URGENT_NOTES.iwill],
  ];
  if (!ctx.midday) {
    lines.push([
      'pm',
      'project.mark_urgent',
      'project',
      project('store'),
      [0, '14:40'],
      URGENT_NOTES.store,
    ]);
  }
  return lines.map(([actor, action, entityType, entityId, when, note], i) => {
    const createdAt = ctx.when(when[0], when[1]);
    return {
      id: i + 1,
      actorId: actor ? user(actor) : null,
      action,
      entityType,
      entityId,
      before: null,
      after: note ? toJson({ isUrgent: true, urgentNote: note }) : null,
      reason: null,
      ip: actor ? OFFICE_IP : null,
      createdAt,
      updatedAt: createdAt,
    };
  });
}
