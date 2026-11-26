// The New task and Edit task window's rules (CONTRACT 22, 27 and 28; taskFormModel.js): the
// "Assign to" chips, its first values, the request a save sends (links, shareConfirmed and
// shareWith included), when it asks the share confirm, and every sentence it says. Split from
// phasesBoard.test.js by CONTRACT 28, Files and owners (phasesView and the undo queue are in
// phasesView.test.js).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AssignField from '@/app/(app)/projects/[id]/_board/AssignField';
import LinkChip from '@/components/files/LinkChip';
import { linkState } from '@/app/(app)/projects/[id]/_board/useFormLinks';
import {
  FIND_FROM,
  addedToast,
  assignChoices,
  chosenName,
  chosenPerson,
  closeQuestion,
  createBody,
  editBody,
  editable,
  filesShared,
  findChoices,
  initialValues,
  noteCount,
  pausedLine,
  phaseOptions,
  saveError,
  saveRequest,
  savedResult,
  savedToast,
  shareAsked,
  titleError,
  toldBody,
  uploadCounts,
  uploadingLabel,
} from '@/app/(app)/projects/[id]/_board/taskFormModel';
import { PROJECT_PHASES } from '@/modules/projectPlan/phases';

describe('the task window: Assign to and phases', () => {
  // AssigneeOption[] as listAssigneeOptions orders them: the viewer, the PM, the members A to Z.
  const riya = { id: 7, name: 'Riya Kapoor', role: 'pm', status: 'active', kind: 'me' };
  const simran = {
    id: 11,
    name: 'Simran Kaur',
    role: 'employee',
    status: 'active',
    kind: 'member',
  };
  const vishal = {
    id: 12,
    name: 'Vishal Saini',
    role: 'employee',
    status: 'active',
    kind: 'member',
  };
  const labels = (choices) => choices.map((choice) => choice.label);

  it('offers Anyone first, then Me, then the members A to Z', () => {
    const choices = assignChoices([riya, vishal, simran], null, 7);
    expect(labels(choices)).toEqual([
      'Anyone on the project',
      'Me (Riya Kapoor)',
      'Simran Kaur',
      'Vishal Saini',
    ]);
    expect(choices.map((choice) => choice.value)).toEqual(['', '7', '11', '12']);
    expect(choices[0].person).toBeNull();
    expect(choices[1].person).toBe(riya);
  });

  it("puts the project's PM after Me for an Admin, and finds Me without a kind by the viewer", () => {
    const ceo = { id: 3, name: 'Arvind Menon', role: 'admin', status: 'active', kind: 'me' };
    const pm = { ...riya, kind: 'pm' };
    expect(labels(assignChoices([simran, pm, ceo], null, 3))).toEqual([
      'Anyone on the project',
      'Me (Arvind Menon)',
      'Riya Kapoor',
      'Simran Kaur',
    ]);
    const plain = [
      { id: 9, name: 'Neha Arora' },
      { id: 7, name: 'Riya Kapoor' },
    ];
    expect(labels(assignChoices(plain, null, 7))).toEqual([
      'Anyone on the project',
      'Me (Riya Kapoor)',
      'Neha Arora',
    ]);
  });

  it('keeps the current person last when they are not on the list, and says why', () => {
    const away = editable({
      id: 1,
      assignee: { id: 20, name: 'Vishal Saini', status: 'active', isMember: false },
    });
    expect(assignChoices([riya, simran], away, 7).at(-1)).toMatchObject({
      value: '20',
      label: 'Vishal Saini (not on the project)',
      current: true,
    });
    const gone = editable({
      id: 1,
      assignee: { id: 20, name: 'Vishal Saini', status: 'deactivated', isMember: true },
    });
    expect(assignChoices([riya], gone, 7).at(-1).label).toBe('Vishal Saini (deactivated)');
    // A task the CEO took, opened by the PM: the CEO isn't a member, so he is listed last.
    const took = editable({
      id: 1,
      assignee: { id: 3, name: 'Arvind Menon', role: 'admin', status: 'active', isMember: true },
    });
    expect(assignChoices([riya, simran], took, 7).at(-1)).toMatchObject({
      value: '3',
      label: 'Arvind Menon (Admin)',
    });
    expect(assignChoices([riya, simran], editable({ id: 1, assignee: simran }), 7)).toHaveLength(3);
  });

  it('filters the chips by name past 8 people, keeping the checked one', () => {
    const choices = assignChoices([riya, simran, vishal], null, 7);
    expect(labels(findChoices(choices, 'sim', '11'))).toEqual(['Simran Kaur']);
    expect(labels(findChoices(choices, 'sim', ''))).toEqual([
      'Anyone on the project',
      'Simran Kaur',
    ]);
    expect(labels(findChoices(choices, 'SIM', '12'))).toEqual(['Simran Kaur', 'Vishal Saini']);
    expect(findChoices(choices, '  ', '')).toBe(choices);
    expect(FIND_FROM).toBe(8);
  });

  it('names the person a chip stands for, as the share rules take them', () => {
    const choices = assignChoices([riya, simran], null, 7);
    expect(chosenPerson(choices, '11')).toEqual({ id: 11, role: 'employee', status: 'active' });
    expect(chosenPerson(choices, '')).toBeNull();
    expect(chosenName(choices, '11')).toBe('Simran Kaur');
    expect(chosenName(choices, '')).toBeNull();
  });

  it('lists No phase yet only when editing a task that has none', () => {
    expect(phaseOptions(null).map((option) => option.label)).toEqual(
      PROJECT_PHASES.map(({ label }) => label),
    );
    expect(phaseOptions({ phase: null }).at(-1)).toEqual({ value: '', label: 'No phase yet' });
    expect(phaseOptions({ phase: 'design' })).toHaveLength(6);
  });

  it('reads a card and the task window details alike', () => {
    const details = {
      id: 3,
      title: 'Fix the login page',
      details: null,
      priority: 'p1',
      phase: 'design',
      dueDate: null,
      privateLinkCount: 1,
      assignee: {
        id: 9,
        name: 'Neha Arora',
        role: 'employee',
        status: 'deactivated',
        isMember: true,
      },
    };
    expect(editable(details).assignee).toEqual({
      id: 9,
      name: 'Neha Arora',
      initials: null,
      avatarUrl: null,
      role: 'employee',
      status: 'deactivated',
      away: 'Deactivated',
    });
    expect(editable(details).privateLinkCount).toBe(1);
    expect(editable({ ...details, phase: 'old' }).phase).toBeNull();
  });
});

describe('the task window: values and requests', () => {
  const task = editable({
    id: 3,
    title: 'Fix the login page',
    details: 'Steps in the brief',
    priority: 'p2',
    phase: 'design',
    dueDate: '2026-11-25',
    assignee: { id: 9, name: 'Neha Arora', away: null },
  });

  it('presets a new task to the column, else the current phase, else the first', () => {
    const preset = { phase: 'testing', title: 'Go' };
    expect(initialValues({ preset, currentPhase: 'design' })).toEqual({
      title: 'Go',
      details: '',
      owner: '',
      dueDate: '',
      phase: 'testing',
      priority: 'p2',
    });
    expect(initialValues({ currentPhase: 'design' }).phase).toBe('design');
    expect(initialValues({ currentPhase: null }).phase).toBe('requirement_gathering');
    expect(initialValues({ task, currentPhase: 'launch' })).toMatchObject({
      owner: '9',
      phase: 'design',
      details: 'Steps in the brief',
    });
  });

  it('sends everything for a new task, with its held files', () => {
    const values = { ...initialValues({ currentPhase: 'design' }), title: ' Fix it ', owner: '9' };
    expect(createBody(values, ['a'.repeat(32)])).toEqual({
      title: 'Fix it',
      details: null,
      assigneeId: 9,
      phase: 'design',
      dueDate: null,
      priority: 'p2',
      uploadKeys: ['a'.repeat(32)],
      linkFileIds: [],
    });
  });

  it('sends the linked project files and, after the confirm, shareConfirmed and shareWith', () => {
    const values = { ...initialValues({ currentPhase: 'design' }), title: 'Fix it', owner: '12' };
    expect(createBody(values, [], { linkFileIds: [5, 6] })).toMatchObject({
      assigneeId: 12,
      uploadKeys: [],
      linkFileIds: [5, 6],
    });
    expect(createBody(values, [], { linkFileIds: [5] })).not.toHaveProperty('shareConfirmed');
    expect(createBody(values, [], { linkFileIds: [5], share: { shareWith: 12 } })).toMatchObject({
      linkFileIds: [5],
      shareConfirmed: true,
      shareWith: 12,
    });
    const anyone = { ...values, owner: '' };
    expect(createBody(anyone, [], { linkFileIds: [5], share: { shareWith: '' } })).toMatchObject({
      assigneeId: null,
      shareConfirmed: true,
      shareWith: '',
    });
  });

  it('sends the files linked and unlinked on Edit, and no assigneeId when the chip did not change', () => {
    const values = initialValues({ task, currentPhase: 'design' });
    expect(editBody(values, task, { addLinkFileIds: [5], removeLinkFileIds: [6] })).toEqual({
      addLinkFileIds: [5],
      removeLinkFileIds: [6],
    });
    expect(editBody(values, task, { addLinkFileIds: [5], share: { shareWith: 9 } })).toEqual({
      addLinkFileIds: [5],
      shareConfirmed: true,
      shareWith: 9,
    });
    // "Nothing to change." ignores the confirm: an edit that changes nothing sends nothing.
    expect(editBody(values, task, { share: { shareWith: 9 } })).toEqual({});
    expect(editBody({ ...values, owner: '12' }, task, { share: { shareWith: 12 } })).toEqual({
      assigneeId: 12,
      shareConfirmed: true,
      shareWith: 12,
    });
    expect(editBody({ ...values, owner: '' }, task)).toEqual({ assigneeId: null });
  });

  it('sends only what changed for an edit, plus the files added and removed', () => {
    const values = initialValues({ task, currentPhase: 'design' });
    expect(editBody(values, task)).toEqual({});
    expect(editBody({ ...values, details: '', priority: 'p1' }, task)).toEqual({
      details: null,
      priority: 'p1',
    });
    expect(editBody(values, task, { addUploadKeys: ['k1'], removeFileIds: [4] })).toEqual({
      addUploadKeys: ['k1'],
      removeFileIds: [4],
    });
  });

  it("posts a new task, patches an edit, and drops the files when the task's didn't load", () => {
    const values = initialValues({ task, currentPhase: 'design' });
    const files = { readyKeys: ['k1'], removedIds: [4] };
    const [method, path, body] = saveRequest({
      task: null,
      projectId: 5,
      values: { ...values, title: 'New one' },
      ...files,
      attachedError: false,
    });
    expect([method, path, body.title, body.uploadKeys]).toEqual([
      'post',
      '/api/projects/5/tasks',
      'New one',
      ['k1'],
    ]);
    const edit = { task, projectId: 5, values, ...files };
    expect(saveRequest({ ...edit, attachedError: false })).toEqual([
      'patch',
      '/api/project-tasks/3',
      { addUploadKeys: ['k1'], removeFileIds: [4] },
    ]);
    expect(saveRequest({ ...edit, attachedError: true })).toEqual([
      'patch',
      '/api/project-tasks/3',
      {},
    ]);
    const links = { add: [5], remove: [6] };
    expect(saveRequest({ ...edit, links, attachedError: false })[2]).toEqual({
      addUploadKeys: ['k1'],
      removeFileIds: [4],
      addLinkFileIds: [5],
      removeLinkFileIds: [6],
    });
    // The task's files didn't load: nothing it holds can be removed, new links still go.
    expect(saveRequest({ ...edit, links, attachedError: true })[2]).toEqual({
      addLinkFileIds: [5],
    });
    const share = { shareWith: 12 };
    const fresh = { task: null, projectId: 5, values: { ...values, title: 'New one' }, ...files };
    expect(saveRequest({ ...fresh, links, share, attachedError: false })[2]).toMatchObject({
      linkFileIds: [5],
      shareConfirmed: true,
      shareWith: 12,
    });
  });

  it('hands the editor the saved task, its phase, whether it was an edit, and the toast', () => {
    const told = { told: 'person', toldName: 'Simran Kaur' };
    expect(
      savedResult({
        data: { id: 8, ...told },
        task: null,
        body: { phase: 'design', uploadKeys: ['k1'], linkFileIds: [5] },
      }),
    ).toEqual({
      id: 8,
      phase: 'design',
      edited: false,
      toast: {
        title: 'Task added to Design.',
        body: 'Simran Kaur gets a notification with the 2 file names.',
      },
    });
    expect(
      savedResult({
        data: told,
        task,
        body: { addUploadKeys: ['k1'], addLinkFileIds: [5], removeFileIds: [4] },
      }),
    ).toEqual({
      id: 3,
      phase: 'design',
      edited: true,
      toast: { title: 'Changes saved.', body: '2 files added and 1 removed. Simran Kaur is told.' },
    });
    expect(savedResult({ data: null, task, body: { priority: 'p1' } })).toEqual({
      id: 3,
      phase: 'design',
      edited: true,
      toast: { title: 'Changes saved.' },
    });
  });

  it('toasts a person change from told, toldName and toldEarlierName', () => {
    const answer = { told: 'person', toldName: 'Vishal Saini', toldEarlierName: 'Simran Kaur' };
    expect(savedResult({ data: answer, task, body: { assigneeId: 12 } }).toast).toEqual({
      title: 'Changes saved.',
      body: 'Vishal Saini and Simran Kaur get a notification.',
    });
    const withFiles = { assigneeId: 12, addUploadKeys: ['k1'], addLinkFileIds: [5] };
    expect(savedResult({ data: answer, task, body: withFiles }).toast.body).toBe(
      '2 files added. Vishal Saini and Simran Kaur get a notification.',
    );
    const toMe = { told: null, toldName: null, toldEarlierName: 'Simran Kaur' };
    expect(savedResult({ data: toMe, task, body: { assigneeId: 7 } }).toast.body).toBe(
      'Simran Kaur gets a notification.',
    );
    const nobody = { told: null, toldName: null, toldEarlierName: null };
    expect(savedResult({ data: nobody, task, body: { assigneeId: 7 } }).toast).toEqual({
      title: 'Changes saved.',
    });
  });

  it('checks the title and counts the note past 800 characters', () => {
    expect(titleError(' a ')).toBe('Write a title of at least 2 characters.');
    expect(titleError('Ok')).toBeNull();
    expect(noteCount('x'.repeat(800))).toBeNull();
    expect(noteCount('x'.repeat(812))).toBe('812 of 1,000');
  });

  it('puts an error under its field, under Files, or in a toast', () => {
    expect(saveError({ fields: { title: 'Too short' }, message: 'Check' })).toEqual({
      field: 'title',
      files: null,
      message: 'Too short',
    });
    const held = "brief.pdf couldn't be added. Add it again.";
    expect(saveError({ fields: { uploadKeys: held } }).files).toBe(held);
    expect(saveError({ message: 'Offline' })).toEqual({
      field: null,
      files: null,
      message: 'Offline',
    });
  });
});

describe('the task window: what it says', () => {
  it('toasts who was told after adding', () => {
    const vishal = { told: 'person', toldName: 'Vishal Saini' };
    expect(addedToast({ phase: 'development', ...vishal, files: 2 })).toEqual({
      title: 'Task added to Development.',
      body: 'Vishal Saini gets a notification with the 2 file names.',
    });
    expect(addedToast({ phase: 'development', ...vishal }).body).toBe(
      'Vishal Saini gets a notification.',
    );
    expect(addedToast({ phase: 'design', told: 'members', files: 1 }).body).toBe(
      'Everyone on the project gets a notification with the file name.',
    );
    expect(addedToast({ phase: 'design', told: null, files: 2 })).toEqual({
      title: 'Task added to Design.',
    });
  });

  it('toasts what happened to the files after an edit', () => {
    const told = { told: 'person', toldName: 'Simran Kaur' };
    expect(savedToast({ ...told, added: 2 }).body).toBe('2 files added. Simran Kaur is told.');
    expect(savedToast({ ...told, removed: 1 }).body).toBe('1 file removed.');
    expect(savedToast({ ...told, added: 2, removed: 1 }).body).toBe(
      '2 files added and 1 removed. Simran Kaur is told.',
    );
    expect(savedToast({ told: null, added: 1 }).body).toBe('1 file added.');
    expect(savedToast({ told: 'person' })).toEqual({ title: 'Changes saved.' });
  });

  it('counts the files on their way and asks before closing', () => {
    const items = [
      { state: 'uploading', name: 'a.pdf' },
      { state: 'waiting', name: 'b.pdf' },
      { state: 'done', name: 'c.pdf' },
      { state: 'paused', name: 'brief.pdf' },
      { state: 'error', name: 'big.mov' },
    ];
    const counts = uploadCounts(items);
    expect(counts).toMatchObject({ running: 2, unsaved: 4, paused: items[3] });
    expect(uploadingLabel(2)).toBe('Uploading 2 files…');
    expect(closeQuestion(counts)).toBe('4 files are still uploading. Close anyway?');
    expect(closeQuestion({ unsaved: 2, running: 0 })).toBe(
      "2 files aren't saved yet. Close anyway?",
    );
    expect(closeQuestion({ unsaved: 1, running: 0 })).toBe("1 file isn't saved yet. Close anyway?");
    expect(pausedLine('brief.pdf')).toBe(
      "brief.pdf didn't finish uploading. Press Retry or remove it.",
    );
  });
});

describe('the task window: who a save told', () => {
  it('names the new and the earlier person, Everyone on the project, or nobody', () => {
    const vishal = { told: 'person', toldName: 'Vishal Saini' };
    expect(toldBody({ ...vishal, toldEarlierName: 'Simran Kaur' })).toBe(
      'Vishal Saini and Simran Kaur get a notification.',
    );
    expect(toldBody(vishal)).toBe('Vishal Saini gets a notification.');
    expect(toldBody({ told: null, toldEarlierName: 'Simran Kaur' })).toBe(
      'Simran Kaur gets a notification.',
    );
    expect(toldBody({ told: 'members' })).toBe('Everyone on the project gets a notification.');
    expect(toldBody({ told: 'members', toldEarlierName: 'Riya Kapoor' })).toBe(
      'Everyone on the project and Riya Kapoor get a notification.',
    );
    expect(toldBody({ told: null })).toBeNull();
    expect(
      toldBody({ told: 'person', toldName: 'Simran Kaur', toldEarlierName: 'Simran Kaur' }),
    ).toBe('Simran Kaur gets a notification.');
  });
});

describe('the task window: the share confirm', () => {
  const project = { id: 5, pmId: 7 };
  const vishal = { id: 12, role: 'employee', status: 'active' };
  const ceo = { id: 3, role: 'admin', status: 'active' };
  const contract = { id: 41, name: 'acme-store-contract-signed.pdf', visibility: 'managers' };
  const cards = { id: 42, name: 'checkout-test-cards.pdf', visibility: 'managers' };
  const guide = { id: 43, name: 'acme-brand-guide.pdf', visibility: 'everyone' };

  it('shares new "Only PM and Admins" links with a person who is not a manager', () => {
    const args = { links: [contract, guide], personChanged: false, project };
    expect(filesShared({ ...args, person: vishal })).toEqual([contract]);
    expect(filesShared({ ...args, person: null })).toEqual([contract]); // anyone on the project
    expect(filesShared({ ...args, person: ceo })).toEqual([]);
    expect(filesShared({ ...args, person: { id: 7, role: 'pm', status: 'active' } })).toEqual([]);
    const gone = { id: 3, role: 'admin', status: 'deactivated' };
    expect(filesShared({ ...args, person: gone })).toEqual([contract]);
  });

  it('asks about the links that stay only when the person changes', () => {
    const args = { links: [contract, cards], existingIds: [42], project, person: vishal };
    expect(filesShared({ ...args, personChanged: false })).toEqual([contract]);
    expect(filesShared({ ...args, personChanged: true })).toEqual([contract, cards]);
    expect(filesShared({ ...args, links: [cards], personChanged: false })).toEqual([]);
  });

  it("counts the picker's confirm for the files it named while the same chip stays checked", () => {
    expect(shareAsked([], null, '12')).toBe(false);
    expect(shareAsked([contract], null, '12')).toBe(true);
    expect(shareAsked([contract], { owner: '12', ids: [41] }, '12')).toBe(false);
    expect(shareAsked([contract], { owner: '12', ids: [41] }, '11')).toBe(true);
    expect(shareAsked([contract, cards], { owner: '12', ids: [41] }, '12')).toBe(true);
  });

  it('turns a refused save into the confirm, a gone file under Files, or a field error', () => {
    const share = 'This task is now for someone else. Check who it is for and confirm again.';
    expect(saveError({ fields: { shareConfirmed: share } })).toEqual({
      field: null,
      files: null,
      message: share,
      share: true,
    });
    const gone = "That file isn't in this project's files any more.";
    expect(saveError({ fields: { linkFileIds: gone } })).toEqual({
      field: null,
      files: gone,
      message: gone,
      gone: true,
    });
    expect(saveError({ fields: { addLinkFileIds: gone } }).gone).toBe(true);
    const who = 'Pick someone who is on this project, or anyone on the project.';
    expect(saveError({ fields: { assigneeId: who, shareConfirmed: share } })).toEqual({
      field: 'assigneeId',
      files: null,
      message: who,
    });
  });
});

describe('the task window: the chips it draws', () => {
  const render = (type, props) => renderToStaticMarkup(createElement(type, props));
  const words = (html) =>
    html
      .replace(/<!-- -->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const flow = {
    id: 5,
    name: 'checkout-flow.docx',
    ext: 'docx',
    typeLabel: 'Word',
    sizeBytes: 340 * 1024,
    visibility: 'everyone',
  };
  const cards = {
    ...flow,
    id: 6,
    name: 'checkout-test-cards.pdf',
    typeLabel: 'PDF',
    visibility: 'managers',
  };

  it('draws "Assign to" as radio chips, Anyone checked by default, with its help', () => {
    const choices = assignChoices(
      [{ id: 7, name: 'Riya Kapoor', kind: 'me', role: 'pm', status: 'active' }],
      null,
      7,
    );
    const html = render(AssignField, { choices, value: '', onChange: () => {} });
    expect(html).toContain('<fieldset');
    expect(html).toMatch(/<legend[^>]*>Assign to<\/legend>/);
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html).toMatch(/<input type="radio"[^>]*checked=""[^>]*value=""/);
    expect(words(html)).toContain('Anyone on the project RK Me (Riya Kapoor)');
    expect(words(html)).toContain('Everyone on the project sees it on their Today page.');
    expect(html).not.toContain('Find a person');
  });

  it('keeps a task the CEO took checked on Edit, and adds the search past 8 people', () => {
    const took = editable({
      id: 1,
      assignee: { id: 3, name: 'Arvind Menon', role: 'admin', status: 'active', isMember: true },
    });
    const people = Array.from({ length: 8 }, (_, at) => ({
      id: 20 + at,
      name: `Person ${at + 1}`,
      kind: 'member',
    }));
    const choices = assignChoices(people, took, 7);
    const html = render(AssignField, { choices, value: '3', onChange: () => {} });
    expect(html).toMatch(/<input type="radio"[^>]*checked=""[^>]*value="3"/);
    expect(words(html)).toContain('Arvind Menon (Admin)');
    expect(html).toContain('placeholder="Find a person"');
    expect(words(html)).not.toContain('Everyone on the project sees it');
  });

  it('draws a linked file: From Files, its lock, and the X that names the task', () => {
    const html = render(LinkChip, { file: cards, onRemove: () => {} });
    expect(words(html)).toContain('From Files · PDF · 340 KB');
    expect(html).toContain('lucide-lock');
    expect(html).toContain('aria-label="Remove checkout-test-cards.pdf from this task"');
    expect(html).toContain('lucide-link');
  });

  it('marks a removed link on Edit, and strikes a file gone from Files without an X', () => {
    const removed = render(LinkChip, { file: flow, removed: true, onKeep: () => {} });
    expect(words(removed)).toContain('From Files · Word · 340 KB · Removed when you save');
    expect(removed).toContain('aria-label="Keep checkout-flow.docx"');
    expect(removed).toMatch(/class="[^"]*_chipOff_/);
    const gone = render(LinkChip, { file: cards, gone: true, onRemove: () => {} });
    expect(words(gone)).toContain('No longer in Files');
    expect(gone).not.toContain('<button');
    expect(gone).not.toContain('lucide-lock');
  });

  it('links the picked files, unlinks the removed saved ones, and drops the gone ones', () => {
    const state = linkState({
      saved: [flow],
      picked: [flow, cards, { ...cards, id: 7, name: 'gone.pdf' }],
      removedIds: [5],
      goneIds: [7],
    });
    expect(state.all.map((file) => file.id)).toEqual([5, 6, 7]);
    expect(state.kept.map((file) => file.id)).toEqual([6]);
    expect(state.add).toEqual([5, 6]);
    expect(state.remove).toEqual([5]);
    expect(state.fresh).toBe(2);
  });
});
