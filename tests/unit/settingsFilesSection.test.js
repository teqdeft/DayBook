// Settings → Files (CONTRACT 27, Settings; the prototype's settings-files screen): the two fields
// with their help, "Space used: 1.2 GB of 10 GB" with the bar's tone, the files and projects, the
// held and deleted lines only when there are bytes, one line per storage problem, the disk-full
// day, and before migration 019 one line in place of the numbers.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const saved = { fileMaxMb: 500, fileStorageLimitGb: 10 };

vi.mock('@/app/(app)/settings/SettingsProvider', () => ({
  useSettingsForm: () => ({
    form: { fileMaxMb: '500', fileStorageLimitGb: '10' },
    saved,
    errors: {},
    setField: () => {},
  }),
}));

const { default: FilesSection } = await import('@/app/(app)/settings/FilesSection.jsx');

const SPACE = {
  usedBytes: 1.2 * GIB,
  heldBytes: 0,
  deletedBytes: 0,
  fileCount: 342,
  projectCount: 12,
  updateNeeded: false,
  problem: null,
  diskFullOn: null,
};

const render = (space) => renderToStaticMarkup(createElement(FilesSection, { space }));
const text = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

describe('Settings → Files', () => {
  it('has the two fields with their help, the subtitle and the section id', () => {
    const html = render(SPACE);
    expect(html).toContain('id="files"');
    const words = text(html);
    expect(words).toContain('Files people add to projects and tasks.');
    expect(words).toContain('Largest file (MB)');
    expect(words).toContain(
      'Each file can be up to this size. Very big files take a few minutes to upload.',
    );
    expect(words).toContain('Storage limit (GB)');
    expect(words).toContain(
      'All project files together. Keep it to about half of the free space your hosting shows under Disk Usage.',
    );
  });

  it('shows the space used with a primary bar, the files and no extra lines', () => {
    const html = render(SPACE);
    const words = text(html);
    expect(words).toContain('Space used: 1.2 GB of 10 GB');
    expect(words).toContain('342 files on 12 projects.');
    expect(words).not.toContain('is held by uploads');
    expect(words).not.toContain('leaves the server tonight');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Space used"');
    expect(html).toContain('aria-valuenow="12"');
    expect(html).toContain('background:var(--primary)');
  });

  it('writes the sizes in the line\'s own type, as the prototype (no "5 . 4 MB" gaps)', () => {
    const html = render({ ...SPACE, usedBytes: 5.4 * MIB });
    // The tabular heading figures (.num) give a decimal point the width of a digit.
    expect(html).toMatch(/<p class="_used_[^"]*">Space used: 5.4 MB of 10 GB<\/p>/);
    expect(html).not.toContain('class="num"');
  });

  it('turns the bar marigold from 80% and red from 100%', () => {
    expect(render({ ...SPACE, usedBytes: 8 * GIB })).toContain('background:var(--marigold)');
    expect(render({ ...SPACE, usedBytes: 10 * GIB })).toContain('background:var(--red)');
  });

  it('adds the held and deleted lines when they hold bytes; one file, one project', () => {
    const words = text(
      render({
        ...SPACE,
        heldBytes: 307.2 * MIB,
        deletedBytes: 409.6 * MIB,
        fileCount: 1,
        projectCount: 1,
      }),
    );
    expect(words).toContain(
      '307.2 MB is held by uploads that are still running or waiting to be added to a task.',
    );
    expect(words).toContain('409.6 MB of deleted files leaves the server tonight.');
    expect(words).toContain('1 file on 1 project.');
    expect(text(render({ ...SPACE, usedBytes: 0, fileCount: 0, projectCount: 0 }))).toContain(
      'Space used: 0 KB of 10 GB',
    );
  });

  it('says what is wrong with the storage, and a recent disk-full day', () => {
    const words = text(render({ ...SPACE, problem: 'not_empty', diskFullOn: 'Sat, 21 Nov' }));
    expect(words).toContain('FILES_DIR must be a new, empty folder.');
    expect(words).toContain(
      'On Sat, 21 Nov the server ran out of disk space for files. Free space on the hosting account.',
    );
    expect(words).not.toContain('Ask an Admin');
  });

  it('before migration 019 shows one line in place of the numbers', () => {
    const words = text(render({ ...SPACE, updateNeeded: true, problem: 'not_set' }));
    expect(words).toContain(
      'Files need the latest database update. Run the migrate line in README, Updating.',
    );
    expect(words).not.toContain('Space used');
    expect(words).not.toContain('FILES_DIR');
  });

  it('without the numbers (they could not be read) only the fields show', () => {
    const words = text(render(null));
    expect(words).toContain('Largest file (MB)');
    expect(words).not.toContain('Space used');
  });
});
