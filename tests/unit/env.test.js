import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/lib/env';

const BASE = {
  NODE_ENV: 'production',
  DB_HOST: '127.0.0.1',
  DB_USER: 'daybook',
  DB_NAME: 'daybook',
  SESSION_SECRET: 'x'.repeat(64),
};
const DEV = { ...BASE, NODE_ENV: 'development' };
const TEST = { ...BASE, NODE_ENV: 'test', DB_NAME: 'daybook_test_7' };

describe('environment', () => {
  it('starts without Slack sign-in configured', () => {
    expect(parseEnv(BASE).SLACK_TEAM_ID).toBe('');
  });

  it('refuses to start with Slack sign-in but no workspace (guide 15.1)', () => {
    const slack = { ...BASE, SLACK_CLIENT_ID: '123.456', SLACK_CLIENT_SECRET: 'secret' };
    expect(() => parseEnv(slack)).toThrow(/SLACK_TEAM_ID: required/);
    expect(() => parseEnv({ ...slack, SLACK_TEAM_ID: '  ' })).toThrow(/SLACK_TEAM_ID/);
    expect(parseEnv({ ...slack, SLACK_TEAM_ID: 'T0123ABCD' }).SLACK_TEAM_ID).toBe('T0123ABCD');
  });

  it('lists every variable that failed', () => {
    expect(() => parseEnv({ ...BASE, SESSION_SECRET: 'short', DB_HOST: '' })).toThrow(
      /DB_HOST[\s\S]*SESSION_SECRET|SESSION_SECRET[\s\S]*DB_HOST/,
    );
  });
});

describe('files folder (CONTRACT 27, Storage)', () => {
  it('production has no default: files are off until FILES_DIR is set', () => {
    expect(parseEnv(BASE)).toMatchObject({ filesDir: '', filesDirIsDefault: false });
    expect(parseEnv({ ...BASE, FILES_DIR: '' })).toMatchObject({ filesDir: '' });
    expect(parseEnv({ ...BASE, FILES_DIR: '  ' })).toMatchObject({ filesDir: '' });
  });

  it('takes FILES_DIR trimmed and as written, so the storage check sees a relative path or ~', () => {
    const live = parseEnv({ ...BASE, FILES_DIR: ' /home/cpuser/daybook-files ' });
    expect(live).toMatchObject({
      FILES_DIR: '/home/cpuser/daybook-files',
      filesDir: '/home/cpuser/daybook-files',
      filesDirIsDefault: false,
    });
    expect(parseEnv({ ...BASE, FILES_DIR: '~/daybook-files' }).filesDir).toBe('~/daybook-files');
    expect(parseEnv({ ...DEV, FILES_DIR: 'files' }).filesDir).toBe('files');
  });

  it('development defaults to .daybook-files in the project folder', () => {
    expect(parseEnv(DEV)).toMatchObject({
      filesDir: path.join(process.cwd(), '.daybook-files'),
      filesDirIsDefault: true,
    });
    expect(parseEnv({ ...DEV, FILES_DIR: 'D:\files' })).toMatchObject({
      filesDir: 'D:\files',
      filesDirIsDefault: false,
    });
  });

  it('tests ignore FILES_DIR and use their own folder under the temp folder, per database', () => {
    const folder = path.join(os.tmpdir(), 'daybook-test-files', 'daybook_test_7');
    for (const value of [
      undefined,
      '',
      '/home/cpuser/daybook-files',
      'D:\DayBook\.daybook-files',
    ]) {
      const parsed = parseEnv({ ...TEST, FILES_DIR: value });
      expect(parsed, String(value)).toMatchObject({
        FILES_DIR: '',
        filesDir: folder,
        filesDirIsDefault: true,
      });
    }
    expect(parseEnv({ ...TEST, DB_NAME: 'daybook_test_8' }).filesDir).toBe(
      path.join(os.tmpdir(), 'daybook-test-files', 'daybook_test_8'),
    );
    // A database name never climbs out of that folder.
    const odd = parseEnv({ ...TEST, DB_NAME: '../x/y' }).filesDir;
    expect(path.dirname(odd)).toBe(path.join(os.tmpdir(), 'daybook-test-files'));
  });

  it('the piece size defaults to 4 MiB and keeps to its range for the mode', () => {
    expect(parseEnv(BASE).filesPieceBytes).toBe(4_194_304);
    expect(parseEnv({ ...BASE, FILES_PIECE_BYTES: '' }).filesPieceBytes).toBe(4_194_304);
    expect(parseEnv({ ...BASE, FILES_PIECE_BYTES: '2097152' }).filesPieceBytes).toBe(2_097_152);
    expect(parseEnv({ ...BASE, FILES_PIECE_BYTES: '8388608' }).filesPieceBytes).toBe(8_388_608);
    expect(() => parseEnv({ ...BASE, FILES_PIECE_BYTES: '65536' })).toThrow(
      /FILES_PIECE_BYTES: must be from 1048576 to 8388608 bytes/,
    );
    expect(() => parseEnv({ ...BASE, FILES_PIECE_BYTES: '8388609' })).toThrow(/FILES_PIECE_BYTES/);
    for (const mode of [DEV, TEST]) {
      expect(parseEnv({ ...mode, FILES_PIECE_BYTES: '65536' }).filesPieceBytes).toBe(65_536);
      expect(() => parseEnv({ ...mode, FILES_PIECE_BYTES: '65535' })).toThrow(
        /FILES_PIECE_BYTES: must be from 65536 to 4194304 bytes/,
      );
      expect(() => parseEnv({ ...mode, FILES_PIECE_BYTES: '8388608' })).toThrow(/FILES_PIECE/);
    }
    expect(() => parseEnv({ ...BASE, FILES_PIECE_BYTES: '4MB' })).toThrow(/FILES_PIECE_BYTES/);
    expect(() => parseEnv({ ...BASE, FILES_PIECE_BYTES: '1048576.5' })).toThrow(/FILES_PIECE/);
  });
});
