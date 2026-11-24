// The Files tab's places, counts and rows (CONTRACT 27, Files tab): each item once, a phase with its
// task files under "On tasks in Design", On tasks grouped by task, search, the three sorts, every
// empty state, the lines of each row and the row menus. Pure: the server already left out what the
// viewer may not see, so these lists are per viewer.
import { describe, expect, it } from 'vitest';
import {
  canReadForAi,
  deleteCopy,
  dropLabel,
  filesItems,
  optionPhase,
  phaseForPlace,
  phaseOption,
  placeCounts,
  placeHref,
  placeName,
  placeOf,
  placeOptions,
  placeView,
  rowActions,
  rowMeta,
  rowNotes,
  rowOpens,
  sortItems,
  sortOf,
} from '@/app/(app)/projects/[id]/_files/filesTabView.js';

const PM = { id: 7, name: 'Riya Kapoor' };
const MB = 1024 * 1024;

const at = (day, hour = 6) => new Date(`2026-11-${String(day).padStart(2, '0')}T0${hour}:00:00Z`);

function projectFile(id, more = {}) {
  return {
    id,
    projectId: 5,
    scope: 'project',
    taskId: null,
    phase: 'design',
    visibility: 'everyone',
    name: `file-${id}.pdf`,
    ext: 'pdf',
    kind: 'pdf',
    typeLabel: 'PDF',
    sizeBytes: 340 * 1024,
    isPicture: false,
    thumbUrl: null,
    createdBy: PM,
    createdAt: at(20),
    addedOn: '2026-11-20',
    task: null,
    hasText: false,
    downloadUrl: `/api/project-files/${id}`,
    viewUrl: null,
    canManage: true,
    ...more,
  };
}

const task = (id, title, phase) => ({ id, title, phase, assigneeId: null });

const taskFile = (id, onTask, more = {}) =>
  projectFile(id, { scope: 'task', taskId: onTask.id, phase: null, task: onTask, ...more });

function doc(id, more = {}) {
  return {
    id,
    projectId: 5,
    phase: 'design',
    kind: 'note',
    title: `Note ${id}`,
    pages: null,
    pagesTotal: null,
    charCount: 10,
    visibility: 'everyone',
    fileId: null,
    createdBy: PM.id,
    createdByName: PM.name,
    createdAt: at(19),
    addedOn: '2026-11-19',
    ...more,
  };
}

const LOGIN = task(31, 'Fix the login page', 'design');
const CHECKOUT = task(32, 'Checkout fix before client demo', 'development');
const OLD = task(33, 'An old task', null);

const FILES = [
  projectFile(1, { name: 'checkout-flow.fig', ext: 'fig', kind: 'file', typeLabel: 'FIG' }),
  projectFile(2, { name: 'brief.pdf', phase: null, visibility: 'managers', hasText: true }),
  projectFile(3, { name: 'test-cases.xlsx', phase: 'testing', typeLabel: 'Excel' }),
  taskFile(4, LOGIN, { name: 'brand-check.pdf' }),
  taskFile(5, LOGIN, {
    name: 'login-page-now.png',
    ext: 'png',
    kind: 'picture',
    typeLabel: 'Picture',
    isPicture: true,
    viewUrl: '/api/project-files/5/view',
  }),
  taskFile(6, CHECKOUT, { name: 'card-payment-error.png', isPicture: true, typeLabel: 'Picture' }),
  taskFile(7, OLD, { name: 'old.zip', typeLabel: 'Zip' }),
];

const DOCUMENTS = [
  doc(11, { title: 'Weekly call', phase: 'development', visibility: 'managers' }),
  doc(12, { title: 'Who to call', phase: null }),
  doc(13, { kind: 'file', title: 'SOW-v2.pdf', phase: null, pages: 4, pagesTotal: 4 }),
  doc(14, { kind: 'file', title: 'brief.pdf', phase: null, fileId: 2, visibility: 'managers' }),
];

const items = () => filesItems({ files: FILES, documents: DOCUMENTS });
const names = (list) => list.map((item) => item.name);

describe('places', () => {
  it('reads a place from the URL, falling back to All files', () => {
    for (const place of ['all', 'project', 'design', 'requirement_gathering', 'tasks']) {
      expect(placeOf(place)).toBe(place);
    }
    for (const value of [undefined, null, '', 'files', 'Design', 'notes', ['design']]) {
      expect(placeOf(value)).toBe('all');
    }
  });

  it('names each place and links it', () => {
    expect(placeName('all')).toBe('All files');
    expect(placeName('project')).toBe('Whole project');
    expect(placeName('tasks')).toBe('On tasks');
    expect(placeName('requirement_gathering')).toBe('Requirement gathering');
    expect(placeHref('design')).toBe('?tab=files&place=design');
  });

  it('presets the windows to the phase of the place, else Whole project', () => {
    expect(phaseForPlace('design')).toBe('design');
    for (const place of ['all', 'project', 'tasks']) expect(phaseForPlace(place)).toBeNull();
    expect(optionPhase('project')).toBeNull();
    expect(optionPhase('launch')).toBe('launch');
    expect(phaseOption(null)).toBe('project');
    expect(phaseOption('launch')).toBe('launch');
    expect(placeOptions('development').map((option) => option.label)).toEqual([
      'Whole project',
      'Requirement gathering',
      'Design',
      'Development (current phase)',
      'Testing',
      'Launch',
      'Support',
    ]);
    expect(dropLabel('design')).toBe('Drop to add to Design');
    expect(dropLabel('all')).toBe('Drop to add to Whole project');
    expect(dropLabel('tasks')).toBe('Drop to add to Whole project');
  });
});

describe('items and counts', () => {
  it("counts each file, note and text-only document once, never a file's text", () => {
    const list = items();
    expect(list).toHaveLength(FILES.length + 3);
    expect(list.filter((item) => item.name === 'brief.pdf')).toHaveLength(1);
    expect(list.find((item) => item.id === 2).text.id).toBe(14);
    expect(list.find((item) => item.id === 13).type).toBe('text');
  });

  it('counts a phase with its task files, a task without a phase only in All and On tasks', () => {
    const counts = placeCounts({ files: FILES, documents: DOCUMENTS });
    expect(counts).toEqual({
      all: 10,
      project: 3, // brief.pdf, Who to call, SOW-v2.pdf
      requirement_gathering: 0,
      design: 3, // checkout-flow.fig, brand-check.pdf, login-page-now.png
      development: 2, // Weekly call, card-payment-error.png
      testing: 1,
      launch: 0,
      support: 0,
      tasks: 4,
    });
  });

  it('counts only what the viewer was given', () => {
    const member = placeCounts({
      files: FILES.filter((file) => file.visibility === 'everyone' && file.id !== 6),
      documents: DOCUMENTS.filter((item) => item.visibility === 'everyone'),
    });
    expect(member).toMatchObject({ all: 7, project: 2, design: 3, development: 0, tasks: 3 });
    expect(placeCounts({})).toMatchObject({ all: 0, tasks: 0, design: 0 });
  });
});

describe('what a place shows', () => {
  it('lists every item in All files', () => {
    const view = placeView({ items: items(), place: 'all' });
    expect(view.groups).toHaveLength(1);
    expect(view.shown).toHaveLength(10);
    expect(view.empty).toBeNull();
  });

  it('lists a phase with its own items first, then "On tasks in Design"', () => {
    const view = placeView({ items: items(), place: 'design', sort: 'name' });
    expect(view.groups.map((group) => group.heading)).toEqual([
      null,
      { text: 'On tasks in Design', count: 2 },
    ]);
    expect(names(view.groups[0].items)).toEqual(['checkout-flow.fig']);
    expect(names(view.groups[1].items)).toEqual(['brand-check.pdf', 'login-page-now.png']);
    expect(view.pictures.map((file) => file.id)).toEqual([5]);
  });

  it('gives Whole project no task files', () => {
    const view = placeView({ items: items(), place: 'project', sort: 'name' });
    expect(view.groups).toHaveLength(1);
    expect(names(view.shown)).toEqual(['brief.pdf', 'SOW-v2.pdf', 'Who to call']);
  });

  it('groups On tasks by task, by phase then title, a task with no phase last', () => {
    const view = placeView({ items: items(), place: 'tasks', sort: 'name' });
    expect(view.groups.map((group) => [group.heading.task.title, group.heading.phase])).toEqual([
      ['Fix the login page', 'Design'],
      ['Checkout fix before client demo', 'Development'],
      ['An old task', 'No phase yet'],
    ]);
    expect(names(view.groups[0].items)).toEqual(['brand-check.pdf', 'login-page-now.png']);
  });

  it('searches names and note titles in the place, in any case', () => {
    const view = placeView({ items: items(), place: 'all', query: '  BRIEF ' });
    expect(names(view.shown)).toEqual(['brief.pdf']);
    const design = placeView({ items: items(), place: 'design', query: 'png' });
    expect(design.groups.map((group) => group.heading?.count ?? null)).toEqual([1]);
    expect(names(design.shown)).toEqual(['login-page-now.png']);
    const notes = placeView({ items: items(), place: 'all', query: 'weekly' });
    expect(names(notes.shown)).toEqual(['Weekly call']);
  });
});

describe('sorts', () => {
  const sortable = () =>
    filesItems({
      files: [
        projectFile(1, { name: 'b.pdf', sizeBytes: 5 * MB, createdAt: at(18) }),
        projectFile(2, { name: 'A.pdf', sizeBytes: 1 * MB, createdAt: at(21) }),
        projectFile(3, { name: 'c.pdf', sizeBytes: 9 * MB, createdAt: at(20) }),
      ],
      documents: [doc(9, { title: 'a note', createdAt: at(22) })],
    });

  it('puts the newest first by default', () => {
    expect(sortOf('nonsense')).toBe('new');
    expect(names(sortItems(sortable(), 'new'))).toEqual(['a note', 'A.pdf', 'c.pdf', 'b.pdf']);
  });

  it('sorts by name A to Z, ignoring case', () => {
    expect(names(sortItems(sortable(), 'name'))).toEqual(['a note', 'A.pdf', 'b.pdf', 'c.pdf']);
  });

  it('puts the biggest first, notes and texts last', () => {
    expect(names(sortItems(sortable(), 'big'))).toEqual(['c.pdf', 'b.pdf', 'A.pdf', 'a note']);
  });
});

describe('empty states', () => {
  const empty = (args) => placeView({ items: [], place: 'all', ...args }).empty;

  it('says the whole tab is empty, with Upload for managers', () => {
    expect(empty({ canManage: true })).toEqual({
      text: 'No files yet. Upload briefs, designs and contracts so the team has them in one place.',
      action: 'upload',
    });
    expect(empty({ canManage: false })).toEqual({
      text: 'No files shared with you yet.',
      action: null,
    });
  });

  it('says one place is empty', () => {
    const list = items();
    expect(placeView({ items: list, place: 'launch', canManage: true }).empty).toEqual({
      text: 'Nothing in Launch yet.',
      action: 'upload',
    });
    expect(placeView({ items: list, place: 'launch' }).empty).toEqual({
      text: 'Nothing in Launch yet.',
      action: null,
    });
  });

  it('says no task has files', () => {
    const list = items().filter((item) => item.type !== 'task');
    expect(placeView({ items: list, place: 'tasks', canManage: true }).empty).toEqual({
      text: 'No task has files yet. Add files to a task from its window.',
      action: null,
    });
    expect(placeView({ items: list, place: 'tasks' }).empty.text).toBe(
      'None of your tasks has files.',
    );
  });

  it('says nothing matches a search, with Clear search', () => {
    expect(placeView({ items: items(), place: 'design', query: 'logo' }).empty).toEqual({
      text: 'No files match "logo".',
      action: 'clear',
    });
  });
});

describe('rows', () => {
  const item = (id) => items().find((entry) => entry.id === id);

  it('says what a file is, its size, who added it and when, and where in All files', () => {
    expect(rowMeta(item(3), 'all')).toEqual({
      text: 'Excel · 340 KB · Riya Kapoor, 20 Nov · Testing',
      task: null,
    });
    expect(rowMeta(item(2), 'all').text).toBe('PDF · 340 KB · Riya Kapoor, 20 Nov · Whole project');
    expect(rowMeta(item(3), 'testing').text).toBe('Excel · 340 KB · Riya Kapoor, 20 Nov');
  });

  it("names a task file's task outside On tasks", () => {
    expect(rowMeta(item(4), 'all')).toEqual({
      text: 'PDF · 340 KB · Riya Kapoor, 20 Nov · Design',
      task: LOGIN,
    });
    expect(rowMeta(item(7), 'all').text).toContain('· No phase yet');
    expect(rowMeta(item(4), 'tasks').task).toBeNull();
  });

  it('labels notes and text-only documents', () => {
    expect(rowMeta(item(12), 'all').text).toBe('Note · Riya Kapoor, 19 Nov · Whole project');
    expect(rowMeta(item(13), 'project').text).toBe('Text only · 4 pages · 19 Nov');
    const cut = filesItems({ documents: [doc(20, { kind: 'file', pages: 100, pagesTotal: 140 })] });
    expect(rowMeta(cut[0], 'design').text).toBe('Text only · First 100 of 140 pages · 19 Nov');
    const word = filesItems({ documents: [doc(21, { kind: 'file', title: 'Brief.docx' })] });
    expect(rowMeta(word[0], 'design').text).toBe('Text only · 19 Nov');
  });

  it('adds the lock for Only PM and Admins and the program warning', () => {
    expect(rowNotes(item(2))).toEqual({ managers: true, program: false });
    expect(rowNotes(item(11))).toEqual({ managers: true, program: false });
    expect(rowNotes(item(4))).toEqual({ managers: false, program: false });
    const program = filesItems({ files: [projectFile(40, { kind: 'program', ext: 'sh' })] });
    expect(rowNotes(program[0])).toEqual({ managers: false, program: true });
  });

  it('opens a picture in the viewer, downloads another file, opens a note', () => {
    expect(rowOpens(item(5))).toBe('viewer');
    expect(rowOpens(item(4))).toBe('download');
    expect(rowOpens(item(12))).toBe('note');
    expect(rowOpens(item(13))).toBe('note');
  });

  it('gives each kind its menu, with Read text for AI only where it can be read', () => {
    expect(rowActions(item(2))).toEqual(['download', 'viewText', 'edit', 'delete']);
    const unread = filesItems({ files: [projectFile(41)] })[0];
    expect(canReadForAi(unread)).toBe(true);
    expect(rowActions(unread)).toEqual(['download', 'readText', 'edit', 'delete']);
    const big = filesItems({ files: [projectFile(42, { sizeBytes: 21 * MB })] })[0];
    expect(rowActions(big)).toEqual(['download', 'edit', 'delete']);
    expect(rowActions(item(1))).toEqual(['download', 'edit', 'delete']);
    expect(rowActions(item(4))).toEqual(['download', 'openTask', 'edit', 'delete']);
    expect(canReadForAi(item(4))).toBe(false);
    expect(rowActions(item(12))).toEqual(['open', 'edit', 'delete']);
    expect(rowActions(item(13))).toEqual(['viewText', 'edit', 'delete']);
  });

  it('deletes through the right route, with the right words', () => {
    expect(deleteCopy(item(2))).toEqual({
      url: '/api/project-files/2',
      label: 'File deleted.',
      failTitle: "Couldn't delete the file",
    });
    expect(deleteCopy(item(12))).toMatchObject({
      url: '/api/project-documents/12',
      label: 'Note deleted.',
    });
    expect(deleteCopy(item(13))).toMatchObject({
      url: '/api/project-documents/13',
      label: 'File deleted.',
    });
  });
});
