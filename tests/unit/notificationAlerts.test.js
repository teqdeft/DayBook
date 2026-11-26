// Important notifications (CONTRACT 26, 27, 28): ALERT_TYPES is exactly the table of 45 types (19
// important, 26 normal), every prefix has a group, and a source scan fails for any notification type the code
// creates that isn't classified (literals and templates on lines with `type:` or `TYPE =`).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REMIND_KINDS } from '@/modules/attendance/remindRules';
import {
  ALERT_GROUPS,
  ALERT_TYPES,
  alertGroup,
  alertLevel,
  assertClassified,
  isClassified,
  isImportant,
} from '@/modules/notifications/alerts';
import * as fromIndex from '@/modules/notifications';

const ROOT = path.resolve(import.meta.dirname, '../..');

// [type, important, group] as in the CONTRACT 26 table.
const TABLE = [
  ['attendance.checkin_reminder', true, 'attendance'],
  ['attendance.remind_check_in', true, 'attendance'],
  ['attendance.remind_break', true, 'attendance'],
  ['attendance.remind_check_out', true, 'attendance'],
  ['attendance.remind_missing_checkout', true, 'attendance'],
  ['attendance.checkout_reminder', true, 'attendance'],
  ['attendance.auto_checkout', true, 'attendance'],
  ['attendance.missing_checkout', true, 'attendance'],
  ['attendance.unverified_office', true, 'attendance'],
  ['attendance_correction.requested', true, 'attendance'],
  ['attendance.hr_summary', true, 'attendance'],
  ['wfh_request.created', true, 'calendar'],
  ['project.urgent', true, 'project'],
  ['project_request.created', true, 'project'],
  ['report_edit.requested', true, 'report'],
  ['report.reminder', true, 'report'],
  ['timer.reminder', true, 'timer'],
  ['timer.stopped_midnight', true, 'timer'],
  ['system.test', true, 'system'],
  ['attendance_correction.approved', false, 'attendance'],
  ['attendance_correction.rejected', false, 'attendance'],
  ['attendance.self_checkout_past', false, 'attendance'],
  ['attendance.edited', false, 'attendance'],
  ['attendance.break_over_allowance', false, 'attendance'],
  ['attendance.hr_evening_summary', false, 'attendance'],
  ['attendance.late_alert', false, 'attendance'],
  ['holiday.past_changed', false, 'calendar'],
  ['leave.marked', false, 'calendar'],
  ['leave.changed', false, 'calendar'],
  ['leave.removed', false, 'calendar'],
  ['wfh_request.approved', false, 'calendar'],
  ['wfh_request.declined', false, 'calendar'],
  ['project.created', false, 'project'],
  ['project.member_added', false, 'project'],
  ['project_request.approved', false, 'project'],
  ['project_request.declined', false, 'project'],
  ['project_task.added', false, 'task'],
  ['project_task.changed', false, 'task'],
  ['project_task.files_added', false, 'task'],
  ['project_task.reassigned', false, 'task'],
  ['report_edit.sent', false, 'report'],
  ['report_edit.approved', false, 'report'],
  ['report_edit.declined', false, 'report'],
  ['ai.pm_summary', false, 'ai'],
  ['ai.hr_notes', false, 'ai'],
];

// Every template literal that builds a type, where it is, and what it can become.
const TEMPLATES = [
  {
    file: 'src/modules/attendance/reminderMessages.js',
    literal: '`attendance.remind_${kind}`',
    expansions: REMIND_KINDS.map((kind) => `attendance.remind_${kind}`),
  },
  {
    file: 'src/modules/attendance/decisions.js',
    literal: '`attendance_correction.${verdict}`',
    expansions: ['attendance_correction.approved', 'attendance_correction.rejected'],
  },
  {
    file: 'src/modules/attendance/wfhDecisions.js',
    literal: '`wfh_request.${verdict}`',
    expansions: ['wfh_request.approved', 'wfh_request.declined'],
  },
  {
    file: 'src/modules/projects/messages.js',
    literal: "`project_request.${approved ? 'approved' : 'declined'}`",
    expansions: ['project_request.approved', 'project_request.declined'],
  },
];

const DOTTED = /^[a-z_]+\.[a-z_]+$/;
const TEMPLATE_PREFIX = /^`[a-z_]+\.[a-z_]*\$\{/;

/** Every .js and .jsx file under a folder, as paths from the project root with forward slashes. */
function sourceFiles(folder) {
  const found = [];
  for (const entry of fs.readdirSync(path.join(ROOT, folder), { withFileTypes: true })) {
    const relative = `${folder}/${entry.name}`;
    if (entry.isDirectory()) found.push(...sourceFiles(relative));
    else if (/\.jsx?$/.test(entry.name)) found.push(relative);
  }
  return found;
}

/** The quoted strings and dotted template literals on one line. */
function scanLine(line) {
  const templates = [];
  const withoutTemplates = line.replace(/`(?:[^`\\]|\\.)*`/g, (literal) => {
    if (TEMPLATE_PREFIX.test(literal)) templates.push(literal);
    else if (!literal.includes('${')) return `'${literal.slice(1, -1)}'`;
    return '``';
  });
  const strings = [];
  for (const match of withoutTemplates.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) {
    strings.push(match[1] ?? match[2]);
  }
  return { strings: strings.filter((value) => DOTTED.test(value)), templates };
}

/** Every type literal and template on the lines that set a type. */
function scanSources() {
  const literals = [];
  const templates = [];
  for (const file of ['src', 'scripts', 'db/demo'].flatMap(sourceFiles)) {
    const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.includes('type:') && !line.includes('TYPE =')) return;
      const found = scanLine(line);
      const where = `${file}:${index + 1}`;
      for (const value of found.strings) literals.push({ value, where });
      for (const literal of found.templates) templates.push({ file, literal, where });
    });
  }
  return { literals, templates };
}

describe('ALERT_TYPES', () => {
  it('is exactly the 45 types of the table, 19 of them important and 26 normal', () => {
    expect(Object.isFrozen(ALERT_TYPES)).toBe(true);
    expect(Object.keys(ALERT_TYPES).sort()).toEqual(TABLE.map(([type]) => type).sort());
    expect(Object.keys(ALERT_TYPES)).toHaveLength(45);
    expect(ALERT_TYPES['project_task.files_added']).toBe('normal');
    // CONTRACT 28: the earlier person's notice, normal, in the task group.
    expect(ALERT_TYPES['project_task.reassigned']).toBe('normal');
    expect(alertGroup('project_task.reassigned')).toBe('task');
    for (const [type, important] of TABLE) {
      expect(ALERT_TYPES[type], type).toBe(important ? 'important' : 'normal');
      expect(alertLevel(type), type).toBe(important ? 'important' : 'normal');
      expect(isImportant(type), type).toBe(important);
      expect(isClassified(type), type).toBe(true);
    }
    expect(TABLE.filter(([, important]) => important)).toHaveLength(19);
    expect(TABLE.filter(([, important]) => !important)).toHaveLength(26);
  });

  it('gives every type a group from its prefix', () => {
    expect(Object.isFrozen(ALERT_GROUPS)).toBe(true);
    for (const [type, , group] of TABLE) {
      expect(Object.hasOwn(ALERT_GROUPS, type.split('.')[0]), type).toBe(true);
      expect(alertGroup(type), type).toBe(group);
    }
  });

  it('treats an unknown type as normal, in the system group, and unclassified', () => {
    for (const type of ['made.up', 'toString', '', null, undefined, 42]) {
      expect(alertLevel(type)).toBe('normal');
      expect(isImportant(type)).toBe(false);
      expect(isClassified(type)).toBe(false);
    }
    expect(alertGroup('made.up')).toBe('system');
    expect(alertGroup('constructor.x')).toBe('system');
    expect(alertGroup(undefined)).toBe('system');
    expect(alertGroup('leave.something_new')).toBe('calendar');
  });

  it('assertClassified throws for an unknown type and names CONTRACT 26', () => {
    expect(() => assertClassified('made.up')).toThrow(
      'Notification type "made.up" has no alert level. Add it to ALERT_TYPES (CONTRACT 26).',
    );
    expect(() => assertClassified('timer.reminder')).not.toThrow();
  });

  it('is re-exported by the module index', () => {
    expect(fromIndex.ALERT_TYPES).toBe(ALERT_TYPES);
    expect(fromIndex.alertLevel).toBe(alertLevel);
    expect(fromIndex.isImportant).toBe(isImportant);
  });
});

describe('every type the code creates is classified (source scan)', () => {
  const { literals, templates } = scanSources();

  it('finds the type literals and every one is in ALERT_TYPES', () => {
    expect(literals.length).toBeGreaterThan(30);
    // src (a `type:` line and a `TYPE =` line), scripts and db/demo are all read.
    const places = (type) =>
      literals.filter(({ value }) => value === type).map(({ where }) => where);
    expect(places('attendance.edited').some((where) => where.startsWith('src/'))).toBe(true);
    expect(places('timer.reminder')).toContain('src/modules/timers/worker.js:16');
    expect(places('system.test').some((where) => where.startsWith('scripts/'))).toBe(true);
    expect(places('project_request.approved').some((where) => where.startsWith('db/demo/'))).toBe(
      true,
    );
    // CONTRACT 27's and 28's new types, sent by the task messages.
    for (const type of ['project_task.files_added', 'project_task.reassigned']) {
      expect(
        places(type).some((where) => where.startsWith('src/modules/projectTasks/messages.js:')),
        type,
      ).toBe(true);
    }
    const unclassified = literals.filter(({ value }) => !isClassified(value));
    expect(unclassified).toEqual([]);
  });

  it('finds each template of the TEMPLATES table, and nothing else', () => {
    const found = templates.map(({ file, literal }) => `${file} ${literal}`).sort();
    const listed = TEMPLATES.map(({ file, literal }) => `${file} ${literal}`).sort();
    expect(found).toEqual(listed);
  });

  it('classifies every expansion of every template', () => {
    for (const { literal, expansions } of TEMPLATES) {
      const prefix = /^`([a-z_]+\.[a-z_]*)\$\{/.exec(literal)[1];
      expect(expansions.length, literal).toBeGreaterThan(0);
      for (const type of expansions) {
        expect(type.startsWith(prefix), `${literal} ${type}`).toBe(true);
        expect(isClassified(type), type).toBe(true);
      }
    }
  });
});
