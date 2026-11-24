// Migration 019 (CONTRACT 27, "Data") on a fresh test database: up, down, up; every new table,
// column, default, key and foreign key; down keeps every note and text (a Whole project note goes
// to Requirement gathering with updated_at unchanged, a file's text becomes a text-only document)
// and up again gives every row Only PM and Admins; a stopped down and a stopped up run again.
// .github/workflows/migration-check.yml runs this file on MySQL 8.4 too, so it reads
// information_schema the way both servers answer and uses only DB_NAME.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import * as migration019 from '../../db/migrations/019_project_files.js';
import { createUser, resetDatabase } from '../helpers/db.js';
import { constraintsOf, tablesOf } from './migration018Kit.js';
import {
  checkedTooEarly,
  expectNoSchema,
  expectSchema,
  INDEXES,
  MIGRATION,
  NEW_TABLES,
} from './migration019Kit.js';

const STAMP = new Date('2026-11-02T05:00:00Z'); // when the sample documents were last changed
const LATER = new Date('2026-11-20T05:00:00Z');
const HEX = (n) => String(n).repeat(32).slice(0, 32);

let pm;
let project;
let task;

/** One project_documents row; returns its id. */
async function addDocument(fields) {
  const [id] = await db('projectDocuments').insert({
    projectId: project.id,
    title: 'Scope',
    body: 'The client wants a new checkout.',
    charCount: 32,
    createdBy: pm.id,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...fields,
  });
  return id;
}

/** One project_files row (no disk file: the migration never reads the disk); returns its id. */
async function addFile(n, fields = {}) {
  const [id] = await db('projectFiles').insert({
    projectId: project.id,
    scope: 'project',
    name: `brief-${n}.pdf`,
    ext: 'pdf',
    sizeBytes: 1024 * n,
    storageKey: `2026/11/${HEX(n)}`,
    createdBy: pm.id,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...fields,
  });
  return id;
}

const documents = () => db('projectDocuments').orderBy('id').select();

beforeAll(async () => {
  await resetDatabase();
});

afterAll(async () => {
  // Leave the test database migrated for the next file, whatever a failed case left behind.
  await migration019.up(db);
  await db.migrate.latest();
});

describe('migration 019: tables, columns, keys', () => {
  it('creates the three tables as InnoDB with utf8mb4_unicode_ci and the one space row', async () => {
    const found = await tablesOf(NEW_TABLES);
    for (const table of NEW_TABLES) {
      expect(found[table], table).toEqual({ collation: 'utf8mb4_unicode_ci', engine: 'InnoDB' });
    }
    await expectSchema(expect);
  });

  it('names every unique key as a UNIQUE constraint', async () => {
    for (const [table, indexes] of Object.entries(INDEXES)) {
      const constraints = await constraintsOf(table);
      for (const [name, [unique]] of Object.entries(indexes)) {
        if (unique) expect(constraints[name], name).toBe('UNIQUE');
      }
    }
  });

  it('down takes it all away and up makes it again', async () => {
    await db.migrate.down({ name: MIGRATION });
    await expectNoSchema(expect);
    await db.migrate.latest();
    await expectSchema(expect);
  });
});

describe('migration 019 with data', () => {
  let ids;

  beforeAll(async () => {
    pm = await createUser({ role: 'pm' });
    const client = await db('clients').first('id');
    const [projectId] = await db('projects').insert({
      name: 'Acme store',
      clientId: client.id,
      pmId: pm.id,
      createdBy: pm.id,
    });
    project = { id: projectId };
    const [taskId] = await db('projectTasks').insert({
      projectId,
      title: 'Login',
      createdBy: pm.id,
    });
    task = { id: taskId };
    const fileId = await addFile(1, { visibility: 'everyone' });
    ids = {
      fileId,
      wholeNote: await addDocument({ phase: null, kind: 'note', visibility: 'everyone' }),
      designNote: await addDocument({ phase: 'design', kind: 'note' }),
      fileText: await addDocument({ phase: null, kind: 'file', title: 'brief-1.pdf', fileId }),
      textOnly: await addDocument({ phase: 'development', kind: 'file', title: 'old.docx' }),
    };
  });

  it('keeps one text per file, and a file text goes with its file row', async () => {
    const other = await addFile(2);
    const text = await addDocument({ phase: 'design', kind: 'file', fileId: other });
    await expect(
      addDocument({ kind: 'file', phase: 'design', fileId: other }),
    ).rejects.toMatchObject({ errno: 1062 });
    await db('projectFiles').where({ id: other }).del();
    expect(await db('projectDocuments').where({ id: text }).first()).toBeUndefined();
  });

  it('a task file loses its task and an upload its file, with the defaults', async () => {
    const taskFile = await addFile(3, { scope: 'task', taskId: task.id });
    const upload = {
      uploadKey: HEX(4),
      projectId: project.id,
      target: 'task',
      taskId: task.id,
      name: 'photo.png',
      sizeBytes: 10,
      pieceBytes: 65536,
      fileId: taskFile,
      expiresAt: LATER,
      createdBy: pm.id,
    };
    const [uploadId] = await db('fileUploads').insert(upload);
    await db('projectTasks').where({ id: task.id }).del();
    expect(await db('projectFiles').where({ id: taskFile }).first()).toMatchObject({
      taskId: null,
      visibility: 'managers', // the column default: fails closed
      status: 'active',
      isPicture: false,
      hasThumb: false,
    });
    expect(await db('fileUploads').where({ id: uploadId }).first()).toMatchObject({
      taskId: null,
      status: 'receiving',
      receivedBytes: 0,
      visibility: 'managers',
    });
    await db('projectFiles').where({ id: taskFile }).del();
    expect(await db('fileUploads').where({ id: uploadId }).first('fileId')).toEqual({
      fileId: null,
    });
    await db('fileUploads').where({ id: uploadId }).del();
  });

  it('files and uploads go with their project', async () => {
    const client = await db('clients').first('id');
    const [other] = await db('projects').insert({
      name: 'Other store',
      clientId: client.id,
      pmId: pm.id,
      createdBy: pm.id,
    });
    const fileId = await addFile(5, { projectId: other });
    await db('fileUploads').insert({
      uploadKey: HEX(6),
      projectId: other,
      target: 'project',
      name: 'plan.pdf',
      sizeBytes: 10,
      pieceBytes: 65536,
      expiresAt: LATER,
      createdBy: pm.id,
    });
    await db('projects').where({ id: other }).del();
    expect(await db('projectFiles').where({ id: fileId }).first()).toBeUndefined();
    expect(await db('fileUploads').where({ projectId: other }).first()).toBeUndefined();
  });

  it('down keeps every note and text: Whole project goes to Requirement gathering', async () => {
    const before = await documents();
    await db.migrate.down({ name: MIGRATION });
    await expectNoSchema(expect);
    const after = await documents();
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    const byId = Object.fromEntries(after.map((row) => [row.id, row]));
    expect(byId[ids.wholeNote]).toMatchObject({ phase: 'requirement_gathering', kind: 'note' });
    // updated_at = updated_at kept the column's ON UPDATE from restamping the moved rows.
    expect(byId[ids.wholeNote].updatedAt).toEqual(STAMP);
    expect(byId[ids.designNote]).toMatchObject({ phase: 'design', updatedAt: STAMP });
    // The text of an uploaded file stays, as a text-only document (no file column any more).
    expect(byId[ids.fileText]).toMatchObject({
      phase: 'requirement_gathering',
      kind: 'file',
      title: 'brief-1.pdf',
      body: 'The client wants a new checkout.',
      updatedAt: STAMP,
    });
    expect(byId[ids.fileText]).not.toHaveProperty('fileId');
    expect(byId[ids.textOnly]).toMatchObject({ phase: 'development', kind: 'file' });
  });

  it('up again: every row Only PM and Admins and no file, the dates unchanged', async () => {
    await db.migrate.latest();
    await expectSchema(expect);
    const rows = await documents();
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row, String(row.id)).toMatchObject({ visibility: 'managers', fileId: null });
      expect(row.updatedAt).toEqual(STAMP);
    }
    expect(await db('projectFiles').count({ n: '*' })).toEqual([{ n: 0 }]);
  });
});

describe('migration 019 run again after a stop', () => {
  it('a stopped down (the foreign key already gone) runs again, and a second down too', async () => {
    await db.raw(
      'ALTER TABLE `project_documents` DROP FOREIGN KEY `project_documents_file_id_foreign`',
    );
    await migration019.down(db);
    await expectNoSchema(expect);
    await migration019.down(db);
    await expectNoSchema(expect);
    await migration019.up(db);
    await expectSchema(expect);
  });

  it('a down stopped after project_documents and file_uploads runs again', async () => {
    await db.raw(
      'ALTER TABLE `project_documents` DROP FOREIGN KEY `project_documents_file_id_foreign`',
    );
    await db.raw(
      'ALTER TABLE `project_documents` DROP INDEX `project_documents_file_id_unique`, ' +
        'DROP COLUMN `file_id`, DROP COLUMN `visibility`, MODIFY `phase` VARCHAR(24) NOT NULL',
    );
    await db.schema.dropTable('file_uploads');
    await migration019.down(db);
    await expectNoSchema(expect);
    await migration019.up(db);
    await expectSchema(expect);
  });

  it('an up stopped after project_files makes the rest, and the space row once', async () => {
    await migration019.down(db);
    await migration019.up(db);
    await db.schema.dropTable('file_uploads');
    await db.schema.dropTable('file_space');
    await db.raw(
      'ALTER TABLE `project_documents` DROP FOREIGN KEY `project_documents_file_id_foreign`, ' +
        'DROP INDEX `project_documents_file_id_unique`, DROP COLUMN `file_id`, ' +
        'DROP COLUMN `visibility`',
    );
    await migration019.up(db);
    await expectSchema(expect);
    await migration019.up(db);
    await expectSchema(expect);
  });

  it('a rerun whose checks answered before the stopped statements committed (1050, 1060)', async () => {
    await migration019.up(checkedTooEarly(db));
    await expectSchema(expect);
  });
});
