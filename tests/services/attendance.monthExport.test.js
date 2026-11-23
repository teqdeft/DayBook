// The month Excel (CONTRACT 25, item 4): a Summary and a Days sheet with their names and headers,
// numbers as numbers, one person's file, the Days sheet stopping at today, 400 over 200 people,
// 429 while another export builds, and never a report's text, screen time or an IP.
import ExcelJS from 'exceljs';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { createProject, createReport } from './dashboardKit.js';

const at = (date, clock) => new Date(`${date}T${clock}:00+05:30`);
const IP = '10.0.0.88';

let hr;
let vishal;

const SUMMARY_HEADERS = [
  'Name',
  'Email',
  'Designation',
  'Department',
  'Working days',
  'Days present',
  'Office days',
  'WFH days',
  'Worked on days off',
  'Paid leave days',
  'Unpaid leave days',
  'Holidays',
  'Absent days',
  'Late days',
  'Late (minutes)',
  'Half days',
  'Short days',
  'Left early (days)',
  'Worked (hours)',
  'Breaks (hours)',
  'Days over break allowance',
  'Missing check-outs',
  'Not fixed yet',
  'Auto check-outs',
  'Check-outs entered themselves',
  'Entered after last seen',
  'Reports submitted',
  'Missing reports',
  'Joined',
  'Left',
  'Planned leave days',
];

const DAY_HEADERS = [
  'Name',
  'Email',
  'Date',
  'Day',
  'Day type',
  'Where',
  'Leave',
  'Leave paid',
  'Leave type',
  'Leave note',
  'Check-in',
  'Check-out',
  'Check-out status',
  'Check-out entered by',
  'Entered after last seen',
  'Late (minutes)',
  'Present (hours)',
  'Breaks (minutes)',
  'Worked (hours)',
  'Over allowance (minutes)',
  'Half day',
  'Short day',
  'Left early (minutes)',
  'Absent',
  'Report',
  'Note',
];

async function addRow(user, date, extra = {}) {
  await db('attendance').insert({
    userId: user.id,
    workDate: date,
    checkInAt: at(date, '09:30'),
    checkOutAt: at(date, '18:00'),
    location: 'office',
    officeVerified: true,
    checkInIp: IP,
    checkOutIp: IP,
    lateMinutes: 0,
    isWorkingDay: true,
    checkoutStatus: 'checked_out',
    source: 'self',
    ...extra,
  });
}

/** The workbook of a download Response, and its file name. */
async function workbookOf(response) {
  expect(response.status).toBe(200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await response.arrayBuffer());
  const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition'))?.[1];
  return { book, name };
}

const headersOf = (sheet) => sheet.getRow(1).values.slice(1);

/** Every row of a sheet as { header: value }. */
function rowsOf(sheet) {
  const headers = headersOf(sheet);
  const rows = [];
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    rows.push(Object.fromEntries(headers.map((header, index) => [header, row.values[index + 1]])));
  });
  return rows;
}

/** Every cell's text in the workbook. */
function allText(book) {
  const cells = [];
  book.eachSheet((sheet) =>
    sheet.eachRow((row) => row.eachCell((cell) => cells.push(String(cell.value ?? '')))),
  );
  return cells.join('\n');
}

beforeAll(async () => {
  await resetDatabase();
  await setSettings({
    working_days: [1, 2, 3, 4, 5],
    office_start: '09:30',
    office_end: '18:30',
    late_after: '09:30',
    payroll_month_start_day: 26,
  });
  hr = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  vishal = await createUser({ name: 'Vishal Saini', email: 'vishal@example.com' });
});

beforeEach(async () => {
  setNowForTests('2026-11-19T06:30:00Z');
  await db('attendance').delete();
  await db('leaveEntries').delete();
});

afterEach(() => setNowForTests(null));

describe('exportMonth', () => {
  it('writes the Summary and Days sheets with every header and numbers as numbers', async () => {
    await addRow(vishal, '2026-11-02', { lateMinutes: 12, note: 'Train was late' });
    await addRow(vishal, '2026-11-03', { location: 'wfh', officeVerified: false });
    await db('leaveEntries').insert({
      userId: vishal.id,
      fromDate: '2026-11-04',
      toDate: '2026-11-04',
      part: 'first_half',
      paid: false,
      leaveType: 'sick',
      note: 'Fever',
    });
    const response = await attendance.exportMonthResponse({ viewer: hr, month: '2026-11' });
    const { book, name } = await workbookOf(response);
    expect(name).toBe('attendance-2026-11.xlsx');
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual([
      'Summary 26 Oct to 25 Nov',
      'Days 26 Oct to 25 Nov',
    ]);
    const [summary, days] = book.worksheets;
    expect(headersOf(summary)).toEqual(SUMMARY_HEADERS);
    expect(headersOf(days)).toEqual(DAY_HEADERS);
    const row = rowsOf(summary).find((item) => item.Name === 'Vishal Saini');
    expect(row).toMatchObject({
      'Working days': 23,
      'Days present': 2,
      'Office days': 1,
      'WFH days': 1,
      'Unpaid leave days': 0.5,
      'Late days': 1,
      'Late (minutes)': 12,
      'Worked (hours)': 17,
    });
    const dayRows = rowsOf(days).filter((item) => item.Name === 'Vishal Saini');
    expect(dayRows[0]).toMatchObject({
      Date: '2026-10-26',
      Day: 'Mon',
      'Day type': 'Working day',
      Where: 'Absent',
      Absent: 1,
    });
    expect(dayRows.find((item) => item.Date === '2026-11-02')).toMatchObject({
      Where: 'Office',
      'Check-in': '09:30',
      'Check-out': '18:00',
      'Check-out status': 'Checked out',
      'Late (minutes)': 12,
      'Present (hours)': 8.5,
      'Worked (hours)': 8.5,
      'Left early (minutes)': 30,
      Note: 'Train was late',
    });
    expect(dayRows.find((item) => item.Date === '2026-11-04')).toMatchObject({
      Leave: 'First half',
      'Leave paid': 'Unpaid',
      'Leave type': 'Sick',
      'Leave note': 'Fever',
      Absent: 0.5,
    });
    // The Days sheet stops at today.
    expect(dayRows.at(-1).Date).toBe('2026-11-19');
  });

  it("writes one person's file", async () => {
    await addRow(vishal, '2026-11-02');
    const response = await attendance.exportMonthResponse({
      viewer: hr,
      month: '2026-11',
      userId: vishal.id,
    });
    const { book, name } = await workbookOf(response);
    expect(name).toBe('attendance-2026-11-vishal-saini.xlsx');
    expect(rowsOf(book.worksheets[0]).map((row) => row.Name)).toEqual(['Vishal Saini']);
    await expect(attendance.exportMonth({ viewer: hr, userId: 999999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('never writes report text, screen time or an IP', async () => {
    const pm = await createUser({ name: 'Pam Mehta', role: 'pm', tracksAttendance: false });
    const project = await createProject(pm);
    await addRow(vishal, '2026-11-02');
    await createReport(vishal, '2026-11-02', {
      entries: [{ projectId: project.id, minutes: 60, tasks: [{ title: 'Secret task title' }] }],
    });
    await db('activitySegments').insert({
      userId: vishal.id,
      workDate: '2026-11-02',
      state: 'active',
      source: 'system',
      startedAt: at('2026-11-02', '07:13'),
      endedAt: at('2026-11-02', '07:47'),
    });
    const { book } = await workbookOf(await attendance.exportMonthResponse({ viewer: hr }));
    const text = allText(book);
    expect(text).not.toContain('Secret task title');
    expect(text).not.toContain(IP);
    expect(text).not.toContain('07:13');
    expect(text).not.toContain('07:47');
    const days = rowsOf(book.worksheets[1]);
    expect(
      days.find((item) => item.Date === '2026-11-02' && item.Name === 'Vishal Saini'),
    ).toMatchObject({ Report: 'Submitted' });
  });

  it('refuses a second export while one builds (429)', async () => {
    const first = attendance.exportMonthResponse({ viewer: hr });
    await expect(attendance.exportMonth({ viewer: hr })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      message: 'An export is being built. Try again in a minute.',
    });
    expect((await first).status).toBe(200);
    // Once it is built the next one goes ahead.
    expect((await attendance.exportMonth({ viewer: hr })).sheets).toHaveLength(2);
  });

  it('refuses more than 200 people (400)', async () => {
    const department = await db('departments').first();
    const extra = Array.from({ length: 200 }, (_, index) => ({
      name: `Crowd ${index}`,
      email: `crowd${index}@example.com`,
      designation: 'Developer',
      departmentId: department.id,
      role: 'employee',
      tracksAttendance: true,
      status: 'active',
    }));
    await db.batchInsert('users', extra, 100);
    try {
      await expect(attendance.exportMonth({ viewer: hr })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        status: 400,
        message: "Too many people for one file. Download one person's month instead.",
      });
      // One person's file still works.
      const one = await attendance.exportMonth({ viewer: hr, userId: vishal.id });
      expect(one.filename).toBe('attendance-2026-11-vishal-saini.xlsx');
    } finally {
      await db('users').where('email', 'like', 'crowd%').delete();
    }
  });
});
