// Every upload message word for word (CONTRACT 27, Upload states and every message), with names and
// sizes, and forCode for each server code (server messages never name a file; the browser adds it).
import { describe, expect, it } from 'vitest';
import * as messages from '@/modules/projectFiles/fileMessages';

const MB = 1_048_576;

describe('every message of the table', () => {
  it.each([
    ['empty', 'notes.txt', 'notes.txt is empty.'],
    ['alreadyAttached', 'card-payment-error.png', 'card-payment-error.png is already attached.'],
    ['alreadyInList', 'card-payment-error.png', 'card-payment-error.png is already in the list.'],
    ['taskFull', undefined, 'A task can have up to 20 files. Remove one to add more.'],
    ['pickMax', undefined, 'Pick up to 50 files at a time.'],
    ['diskFull', undefined, 'The server is out of space for files. Ask an Admin.'],
    ['storageOff', undefined, "File storage isn't set up yet. Ask an Admin."],
    ['updateNeeded', undefined, 'This needs the latest database update. Ask an Admin.'],
    ['noPermission', undefined, "You can't add files to this project."],
    ['expired', undefined, 'This upload stopped because it was left too long. Add the file again.'],
    ['stopped', undefined, 'This upload was stopped. Add the file again.'],
    [
      'removedOnServer',
      'brief.pdf',
      'brief.pdf was removed from the server while it uploaded. Add it again. If it happens again, ask an Admin.',
    ],
    ['signedOut', undefined, 'You were signed out. Sign in again, then press Retry.'],
    [
      'notReadable',
      'brief.pdf',
      "Couldn't read brief.pdf. It may have been moved or changed. Choose it again.",
    ],
    [
      'hostRefused',
      'brief.pdf',
      'The server refused part of brief.pdf. Ask an Admin to check the hosting limits.',
    ],
    ['tooManyUploads', undefined, 'You have 10 files uploading. Wait for some to finish.'],
    ['heldExpired', 'brief.pdf', "brief.pdf couldn't be added. Add it again."],
    ['paused', 'brief.pdf', "Couldn't upload brief.pdf. Check your connection, then press Retry."],
    ['notSaved', 'brief.pdf', "brief.pdf didn't finish uploading. Press Retry or remove it."],
    [
      'dropFailed',
      'brief.pdf',
      "Couldn't upload brief.pdf. Check your connection, then drop it again.",
    ],
    ['cancelled', 'brief.pdf', 'Upload of brief.pdf cancelled.'],
    ['fileMissing', undefined, 'This file is missing. Ask your PM to add it again.'],
  ])('%s', (name, fileName, text) => {
    expect(messages[name](fileName)).toBe(text);
    expect(messages[name]({ name: fileName })).toBe(text);
  });

  it('too big, with the sizes', () => {
    expect(
      messages.tooBig({ name: 'site-video.mov', size: 1_288_490_189, maxBytes: 500 * MB }),
    ).toBe('site-video.mov is 1.2 GB. Each file can be up to 500 MB.');
  });

  it('space full: an Admin reads the numbers, anyone else the name', () => {
    const full = { name: 'site-video.mov', usedBytes: 10_522_669_875, limitBytes: 10_737_418_240 };
    expect(messages.spaceFull({ ...full, admin: false })).toBe(
      "There isn't enough space for site-video.mov. Ask an Admin to make room.",
    );
    expect(messages.spaceFull({ ...full, admin: true })).toBe(
      "Daybook's file space is full (9.8 GB of 10 GB). Delete old files or raise the limit in Settings.",
    );
    const adminText = messages.spaceFull({ ...full, admin: true });
    expect(adminText).not.toContain('site-video');
  });

  it('the numbers in taskFull, pickMax and tooManyUploads follow the limits given', () => {
    expect(messages.taskFull({ maxTaskFiles: 5 })).toBe(
      'A task can have up to 5 files. Remove one to add more.',
    );
    expect(messages.pickMax({ pickMax: 30 })).toBe('Pick up to 30 files at a time.');
  });
});

describe('forCode', () => {
  const name = 'brief.pdf';

  it.each([
    ['FILES_DISK_FULL', 'The server is out of space for files. Ask an Admin.'],
    ['FILES_UNAVAILABLE', "File storage isn't set up yet. Ask an Admin."],
    ['UPDATE_NEEDED', 'This needs the latest database update. Ask an Admin.'],
    ['FORBIDDEN', "You can't add files to this project."],
    ['UPLOAD_GONE', 'This upload stopped because it was left too long. Add the file again.'],
    [
      'UPLOAD_LOST',
      'brief.pdf was removed from the server while it uploaded. Add it again. If it happens again, ask an Admin.',
    ],
    ['UNAUTHENTICATED', 'You were signed out. Sign in again, then press Retry.'],
    ['TOO_MANY_UPLOADS', 'You have 10 files uploading. Wait for some to finish.'],
    ['TOO_MANY_FILES', 'A task can have up to 20 files. Remove one to add more.'],
    ['FILE_MISSING', 'This file is missing. Ask your PM to add it again.'],
    [
      'HOST_REFUSED',
      'The server refused part of brief.pdf. Ask an Admin to check the hosting limits.',
    ],
    [
      'NOT_READABLE',
      "Couldn't read brief.pdf. It may have been moved or changed. Choose it again.",
    ],
    ['NETWORK', "Couldn't upload brief.pdf. Check your connection, then press Retry."],
  ])('%s', (code, text) => {
    expect(messages.forCode(code, { name })).toBe(text);
  });

  it('UPLOAD_GONE for a cancelled upload (from Status) says it was stopped', () => {
    expect(messages.forCode('UPLOAD_GONE', { name, uploadStatus: 'cancelled' })).toBe(
      'This upload was stopped. Add the file again.',
    );
    expect(messages.forCode('UPLOAD_GONE', { name, uploadStatus: 'expired' })).toBe(
      'This upload stopped because it was left too long. Add the file again.',
    );
  });

  it('FILE_TOO_BIG names the file, with the sizes or from the server message', () => {
    expect(messages.forCode('FILE_TOO_BIG', { name, size: 600 * MB, maxBytes: 500 * MB })).toBe(
      'brief.pdf is 600 MB. Each file can be up to 500 MB.',
    );
    const message = 'This file is 1.2 GB. Each file can be up to 500 MB.';
    expect(messages.forCode('FILE_TOO_BIG', { name, message })).toBe(
      'brief.pdf is 1.2 GB. Each file can be up to 500 MB.',
    );
  });

  it('FILES_SPACE_FULL for an Admin and for anyone else', () => {
    const admin =
      "Daybook's file space is full (9.8 GB of 10 GB). Delete old files or raise the limit in Settings.";
    expect(messages.forCode('FILES_SPACE_FULL', { name, message: admin })).toBe(admin);
    expect(
      messages.forCode('FILES_SPACE_FULL', {
        name,
        message: "There isn't enough space for this file. Ask an Admin to make room.",
      }),
    ).toBe("There isn't enough space for brief.pdf. Ask an Admin to make room.");
    expect(
      messages.forCode('FILES_SPACE_FULL', {
        name,
        admin: true,
        usedBytes: 10_522_669_875,
        limitBytes: 10_737_418_240,
      }),
    ).toBe(admin);
  });

  it("other codes answer the server's own message, else the Paused line", () => {
    const message = 'That part of the file changed on the way. Daybook will send it again.';
    expect(messages.forCode('PIECE_CHECKSUM', { name, message })).toBe(message);
    expect(messages.forCode('SOMETHING_NEW', { name })).toBe(
      "Couldn't upload brief.pdf. Check your connection, then press Retry.",
    );
    expect(messages.forCode('constructor', { name, message: 'x' })).toBe('x');
    expect(messages.forCode('UPLOAD_LOST', 'notes.txt')).toContain('notes.txt was removed');
  });
});

describe('Settings → Files and doctor sentences (Admins read them)', () => {
  it.each([
    ['not_set', 'Add FILES_DIR to the settings file on the server, then press Restart.'],
    [
      'not_absolute',
      'FILES_DIR must be a full path that starts with /, for example /home/cpuser/daybook-files (not ~).',
    ],
    ['inside_app', 'FILES_DIR must be outside the daybook and public_html folders.'],
    ['public', 'FILES_DIR must be outside the daybook and public_html folders.'],
    ['not_empty', 'FILES_DIR must be a new, empty folder.'],
    [
      'not_writable',
      "Daybook can't write to the FILES_DIR folder. Check it exists and its permissions are 700.",
    ],
  ])('storageProblem %s', (problem, text) => {
    expect(messages.storageProblem(problem)).toBe(text);
    expect(text).not.toContain('Ask an Admin');
  });

  it('no problem, or an unknown one, has no sentence', () => {
    expect(messages.storageProblem(null)).toBeNull();
    expect(messages.storageProblem('constructor')).toBeNull();
  });

  it('the disk-full day and the database update', () => {
    expect(messages.diskRanOut('Sat, 21 Nov')).toBe(
      'On Sat, 21 Nov the server ran out of disk space for files. Free space on the hosting account.',
    );
    expect(messages.filesUpdateNeeded()).toBe(
      'Files need the latest database update. Run the migrate line in README, Updating.',
    );
  });
});
