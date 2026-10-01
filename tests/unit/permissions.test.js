import { describe, expect, it } from 'vitest';
import { can, permissionsFor, PERMISSION_TABLE, roleTracksAttendance } from '@/lib/permissions';

describe('permissions', () => {
  it('lets employees, HR and Admin check in and write reports, but not PMs', () => {
    for (const role of ['employee', 'hr', 'admin']) {
      expect(can({ role, status: 'active' }, 'attendance.self')).toBe(true);
      expect(can({ role, status: 'active' }, 'report.self')).toBe(true);
    }
    // Company decision: PMs don't check in, check out or write daily reports.
    expect(can({ role: 'pm', status: 'active' }, 'attendance.self')).toBe(false);
    expect(can({ role: 'pm', status: 'active' }, 'report.self')).toBe(false);
    expect(can({ role: 'pm', status: 'active' }, 'project.request')).toBe(true);
  });

  it('never tracks PMs', () => {
    expect(roleTracksAttendance('pm', true)).toBe(false);
    expect(roleTracksAttendance('employee', true)).toBe(true);
    expect(roleTracksAttendance('admin', false)).toBe(false);
  });

  it('matches the build guide table', () => {
    expect(can({ role: 'employee' }, 'team.view')).toBe(false);
    expect(can({ role: 'pm' }, 'team.view')).toBe(true);
    expect(can({ role: 'hr' }, 'team.view')).toBe(false);
    expect(can({ role: 'hr' }, 'attendance.correct')).toBe(true);
    expect(can({ role: 'pm' }, 'attendance.correct')).toBe(false);
    expect(can({ role: 'pm' }, 'export.hours')).toBe(true);
    expect(can({ role: 'hr' }, 'export.hours')).toBe(false);
    expect(can({ role: 'hr' }, 'people.manage')).toBe(true);
    expect(can({ role: 'pm' }, 'overview.view')).toBe(false);
    expect(can({ role: 'admin' }, 'roles.manage')).toBe(true);
    expect(permissionsFor({ role: 'admin' })).toHaveLength(16);
    expect(can({ role: 'pm' }, 'activity.view_all')).toBe(true);
    expect(can({ role: 'pm' }, 'activity.self')).toBe(false);
    expect(can({ role: 'employee' }, 'activity.self')).toBe(true);
    expect(can({ role: 'employee' }, 'activity.view_all')).toBe(false);
  });

  it('refuses deactivated users', () => {
    expect(can({ role: 'admin', status: 'deactivated' }, 'overview.view')).toBe(false);
  });

  it('builds the read-only roles table', () => {
    const row = PERMISSION_TABLE.find((r) => r.label === "View everyone's attendance");
    expect(row.roles).toEqual({ employee: false, pm: true, hr: true, admin: true });
    expect(PERMISSION_TABLE[0].roles.admin).toBe('optional');
    expect(PERMISSION_TABLE[0].roles.pm).toBe(false);
  });
});
