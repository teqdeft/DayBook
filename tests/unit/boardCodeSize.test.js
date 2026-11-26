// The size guide (CONTRACT 3: functions under about 50 lines, files under about 300) for the 1.12
// Board, task window and project page code, where review found it broken: ten functions of 56 to
// 95 lines in `_board/` and `components/task/` (split into parts and hooks since), the project
// page's skeleton styles at 316 lines (now one module per tab group) and Today's page styles grown
// to 510 (the Priority tasks card has its own module now). ESLint's own size rules measure the
// code, as `scratch/fnlen` did in review: every line from a function's first to its last. From
// 1.13 (CONTRACT 28) the folders are measured with everything under them (`_board/table/**`
// too), plus the motion library and the My tasks page, and the files pieces that 1.13 added or
// split (the picker, the linked chip, the Files tab's state, the files stylesheets).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

const PAGE = 'src/app/(app)/projects/[id]';
const BOARD = `${PAGE}/_board`;
const TASK = 'src/components/task';
const MOTION = 'src/lib/motion';
const MY_TASKS = 'src/app/(app)/my-tasks';
const TODAY = 'src/app/(app)/today';
/** The folders whose code and styles keep the size guide, each with everything under it. */
const MEASURED = [BOARD, TASK, MOTION, MY_TASKS];

const filesIn = (dir, pattern) =>
  readdirSync(dir)
    .filter((name) => pattern.test(name))
    .map((name) => path.join(dir, name));
/** Every file under `dir`, at any depth, whose name matches; none for a folder not there (yet). */
const filesUnder = (dir, pattern) =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true })
        .filter((name) => pattern.test(path.basename(name)))
        .map((name) => path.join(dir, name))
        .sort()
    : [];
const measured = (pattern) => MEASURED.flatMap((dir) => filesUnder(dir, pattern));
/** A file's text; '' for one that isn't there (yet), so the checks below fail rather than throw. */
const text = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
const lineCount = (file) => text(file).replace(/\n$/, '').split('\n').length;
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const linter = new Linter({ configType: 'flat' });
const SIZE_RULES = [
  {
    files: ['**/*.js', '**/*.jsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'max-lines-per-function': ['error', { max: 50 }],
      'max-lines': ['error', { max: 300 }],
    },
  },
];

/** Every function over 50 lines, or file over 300, as "file:line message" (a parse error too). */
function sizeProblems(file) {
  const filename = file.endsWith('.jsx') ? 'check.jsx' : 'check.js';
  return linter
    .verify(text(file), SIZE_RULES, { filename })
    .map((message) => `${file}:${message.line} ${message.message}`);
}

describe('the Board, task window, motion and My tasks code', () => {
  const code = measured(/\.jsx?$/);

  it('is all measured (the folders are where the guide was broken)', () => {
    expect(code.length).toBeGreaterThan(30);
    for (const name of ['QuickAdd.jsx', 'useTaskForm.js', 'useBoard.js', 'TaskCard.jsx']) {
      expect(code.some((file) => file.endsWith(name))).toBe(true);
    }
    expect(code.some((file) => file.endsWith('TaskWindowFiles.jsx'))).toBe(true);
  });

  it('reaches into every folder under them, the Table included', () => {
    for (const dir of [`${BOARD}/table`, MOTION, MY_TASKS].filter((folder) => existsSync(folder))) {
      const inside = path.join(dir, path.sep);
      const reached = code.some((file) => file.startsWith(inside));
      expect(reached, dir).toBe(true);
    }
    expect(new Set(code).size).toBe(code.length);
  });

  it('keeps every function to 50 lines and every file to 300', () => {
    expect(code.flatMap(sizeProblems)).toEqual([]);
  });

  it('keeps its styles to 300 lines a file', () => {
    const css = measured(/\.css$/);
    expect(css.filter((file) => lineCount(file) > 300)).toEqual([]);
  });
});

describe('the files pieces of 1.13', () => {
  const FILES = 'src/components/files';
  const code = [
    `${FILES}/FilesPicker.jsx`,
    `${FILES}/FilesPickerParts.jsx`,
    `${FILES}/LinkChip.jsx`,
    `${FILES}/ShareConfirm.jsx`,
    `${PAGE}/_files/useFilesTab.js`,
  ];

  it('keep every function to 50 lines and every file to 300', () => {
    expect(code.filter((file) => text(file) === '')).toEqual([]);
    expect(code.flatMap(sizeProblems)).toEqual([]);
  });

  it('keep their styles to 300 lines a file, a piece of one component in its own', () => {
    const css = filesUnder(FILES, /\.css$/);
    expect(css.length).toBeGreaterThan(8);
    expect(css.filter((file) => lineCount(file) > 300)).toEqual([]);
    const shared = withoutComments(text(`${FILES}/Files.module.css`));
    for (const selector of [
      '.tile',
      '.nameHead',
      '.chipLink',
      '.barFill',
      '.drop',
      '.fileButtons',
    ]) {
      expect(shared, selector).not.toMatch(new RegExp(`\\${selector}\\b`));
    }
  });

  it("gives a linked chip its own height whatever order the chips' styles load in", () => {
    const link = withoutComments(text(`${FILES}/LinkChip.module.css`));
    expect(link).toMatch(/(^|\s)li\.link \{\s*height: auto;/);
  });
});

describe("the project page's skeleton styles", () => {
  const modules = filesIn(PAGE, /^loading.*\.module\.css$/);

  it('come in one module per group of tabs, each at most 300 lines', () => {
    expect(modules.map((file) => path.basename(file)).sort()).toEqual([
      'loading.module.css',
      'loadingFiles.module.css',
      'loadingHours.module.css',
    ]);
    expect(modules.filter((file) => lineCount(file) > 300)).toEqual([]);
  });

  it("hide the Hours tables' middle block on a phone by position, not by another module's class", () => {
    const hours = withoutComments(text(`${PAGE}/loadingHours.module.css`));
    expect(hours).toContain('.tableRow > :nth-child(n + 4):not(:last-child)');
    expect(hours).not.toMatch(/\.cell\b/);
  });
});

describe("Today's styles", () => {
  const page = withoutComments(text(`${TODAY}/page.module.css`));
  const card = withoutComments(text(`${TODAY}/PriorityCard.module.css`));
  const CARD_CLASSES = [
    '.priority',
    '.priorityRows',
    '.titleLine',
    '.titleButton',
    '.clip',
    '.todoAdd',
  ];

  it('keep the Priority tasks card in its own module, which PriorityCard imports', () => {
    for (const selector of CARD_CLASSES) {
      expect(page).not.toMatch(new RegExp(`\\${selector}\\b`));
      expect(card).toMatch(new RegExp(`\\${selector}\\b`));
    }
    expect(text(`${TODAY}/PriorityCard.jsx`)).toContain("from './PriorityCard.module.css'");
  });

  it("leave the page's module shorter than before 1.12 (466 lines; 510 with the card's rules)", () => {
    expect(lineCount(`${TODAY}/page.module.css`)).toBeLessThan(466);
  });

  it('still hide the phone copy of the title after the title line it shares a span with', () => {
    const titleLine = card.indexOf('.titleLine {');
    const phoneTitle = card.indexOf('.phoneTitle {');
    expect(titleLine).toBeGreaterThan(-1);
    expect(phoneTitle).toBeGreaterThan(titleLine);
  });
});
