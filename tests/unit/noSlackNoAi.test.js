// Files never go to Slack or AI (CONTRACT 27, Who sees and does what; CONTRACT 28, Nothing to
// Slack or AI): a scan of the source. projectTasks and projectFiles never import Slack (their new
// 1.13 files included); aiAsk and aiSummaries never read the files tables or task_file_links in
// either spelling (knexfile's wrapIdentifier turns `projectFiles` into `project_files`) nor import
// the files module; the project summary's prompt and service never import it either.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const FILES_TABLES = /project_?files|file_?uploads/i;
const LINKS_TABLE = /task_?file_?links|taskFileLinks/i;
const IMPORTS_FILES = /['"]@\/modules\/projectFiles(?:\/[^'"]*)?['"]|['"]\.\.\/projectFiles/;
const IMPORTS_SLACK = /['"]@\/modules\/slack(?:\/[^'"]*)?['"]|['"]\.\.\/slack/;

/** Every .js and .jsx file under a folder of the project, as paths from the root. */
function sourceFiles(folder) {
  const found = [];
  for (const entry of fs.readdirSync(path.join(ROOT, folder), { withFileTypes: true })) {
    const relative = `${folder}/${entry.name}`;
    if (entry.isDirectory()) found.push(...sourceFiles(relative));
    else if (/\.jsx?$/.test(entry.name)) found.push(relative);
  }
  return found;
}

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** The files of the folders whose text matches the pattern. */
function matching(folders, pattern) {
  return folders.flatMap(sourceFiles).filter((file) => pattern.test(read(file)));
}

describe('no file, file name or link goes to Slack', () => {
  const folders = ['src/modules/projectTasks', 'src/modules/projectFiles'];

  it('reads both folders', () => {
    for (const folder of folders) expect(sourceFiles(folder).length).toBeGreaterThan(2);
    expect(sourceFiles('src/modules/projectTasks')).toContain(
      'src/modules/projectTasks/messages.js',
    );
  });

  it('reads the new files of 1.13 too', () => {
    const files = folders.flatMap(sourceFiles);
    for (const file of [
      'src/modules/projectTasks/assignees.js',
      'src/modules/projectTasks/bulk.js',
      'src/modules/projectTasks/bulkMessages.js',
      'src/modules/projectTasks/mine.js',
      'src/modules/projectTasks/updates.js',
      'src/modules/projectFiles/migration020.js',
    ]) {
      expect(files, file).toContain(file);
    }
  });

  it('has no Slack import under projectTasks or projectFiles', () => {
    expect(matching(folders, IMPORTS_SLACK)).toEqual([]);
  });

  it('catches a Slack import when there is one', () => {
    expect(IMPORTS_SLACK.test("import { slack } from '@/modules/slack';")).toBe(true);
    expect(IMPORTS_SLACK.test("import { escapeSlackText } from '@/modules/slack/format';")).toBe(
      true,
    );
    expect(IMPORTS_SLACK.test("import { slack } from '../slack';")).toBe(true);
    expect(IMPORTS_SLACK.test("import { notifications } from '@/modules/notifications';")).toBe(
      false,
    );
  });
});

describe('the AI never reads files', () => {
  const folders = ['src/modules/aiAsk', 'src/modules/aiSummaries'];

  it('reads both AI folders', () => {
    for (const folder of folders) expect(sourceFiles(folder).length).toBeGreaterThan(2);
  });

  it('never names the files tables, in either spelling, under aiAsk or aiSummaries', () => {
    expect(matching(folders, FILES_TABLES)).toEqual([]);
  });

  it('never reads task_file_links, in either spelling, under aiAsk or aiSummaries', () => {
    expect(matching(folders, LINKS_TABLE)).toEqual([]);
    for (const text of ["db('task_file_links')", "trx('taskFileLinks as l')", 'TASK_FILE_LINKS']) {
      expect(LINKS_TABLE.test(text), text).toBe(true);
    }
    expect(LINKS_TABLE.test("db('project_tasks')")).toBe(false);
  });

  it('never imports the files module under aiAsk or aiSummaries', () => {
    expect(matching(folders, IMPORTS_FILES)).toEqual([]);
  });

  it("keeps the project summary's prompt and service away from the files module", () => {
    for (const file of [
      'src/modules/projectSummaries/prompt.js',
      'src/modules/projectSummaries/service.js',
    ]) {
      expect(IMPORTS_FILES.test(read(file)), file).toBe(false);
    }
  });

  it('catches both spellings and both import forms', () => {
    for (const text of [
      "db('project_files')",
      "trx('projectFiles as f')",
      "db('file_uploads')",
      "trx('fileUploads')",
      'FROM PROJECT_FILES',
    ]) {
      expect(FILES_TABLES.test(text), text).toBe(true);
    }
    expect(FILES_TABLES.test("db('project_documents')")).toBe(false);
    expect(IMPORTS_FILES.test("import { projectFiles } from '@/modules/projectFiles';")).toBe(true);
    expect(IMPORTS_FILES.test("import { kindOf } from '@/modules/projectFiles/kinds';")).toBe(true);
    expect(IMPORTS_FILES.test("import { projectFiles } from '../projectFiles';")).toBe(true);
  });
});
