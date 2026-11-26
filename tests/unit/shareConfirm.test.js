// The share confirm (CONTRACT 28, Linking and the share confirm; Every message, Share confirm (form,
// picker)): its sentence word for word (one file by name, 2 files, Everyone on the project), the
// count-only sentence a refused reassign falls back to, who needs it (anyone and a person who
// isn't a manager; never the PM or an active Admin, the viewer included; a deactivated Admin
// does), the `shareWith` it names, and the ShareConfirm line itself: role="status", Lock, Back and
// the confirm button, both staying focusable while the save runs.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ShareConfirm from '@/components/files/ShareConfirm';
import {
  ADD_AND_SHARE,
  ATTACH_AND_SHARE,
  SAVE_AND_SHARE,
  filesToShare,
  managesProject,
  personOf,
  privateFiles,
  shareText,
  shareWithOf,
  taskShareText,
} from '@/components/files/shareConfirmView';

const contract = { id: 41, name: 'acme-store-contract-signed.pdf', visibility: 'managers' };
const cards = { id: 42, name: 'checkout-test-cards.pdf', visibility: 'managers' };
const guide = { id: 43, name: 'acme-brand-guide.pdf', visibility: 'everyone' };
const project = { id: 5, pmId: 7 };
const PM = { id: 7, role: 'pm', status: 'active' };
const VISHAL = { id: 12, role: 'employee', status: 'active' };
const CEO = { id: 3, role: 'admin', status: 'active' };

const text = (html) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('the sentence', () => {
  it('names one file and the person, word for word', () => {
    expect(shareText({ files: [contract], personName: 'Vishal Saini' })).toBe(
      'acme-store-contract-signed.pdf is only for PM and Admins. Vishal Saini will be able to open it from this task.',
    );
  });

  it('counts two files', () => {
    expect(shareText({ files: [contract, cards], personName: 'Vishal Saini' })).toBe(
      '2 files are only for PM and Admins. Vishal Saini will be able to open them from this task.',
    );
  });

  it('says Everyone on the project for anyone', () => {
    expect(shareText({ files: [contract], anyone: true })).toBe(
      'acme-store-contract-signed.pdf is only for PM and Admins. Everyone on the project will be able to open it from this task.',
    );
    expect(shareText({ files: [contract, cards], personName: null })).toBe(
      '2 files are only for PM and Admins. Everyone on the project will be able to open them from this task.',
    );
  });

  it('falls back to the count when only the server knows the files', () => {
    expect(taskShareText({ count: 1, personName: 'Simran Kaur' })).toBe(
      'This task has a file only for PM and Admins. Simran Kaur will be able to open it from this task.',
    );
    expect(taskShareText({ count: 2, anyone: true })).toBe(
      'This task has 2 files only for PM and Admins. Everyone on the project will be able to open them from this task.',
    );
  });

  it('has the three confirm buttons of the form and the picker', () => {
    expect([ATTACH_AND_SHARE, ADD_AND_SHARE, SAVE_AND_SHARE]).toEqual([
      'Attach and share',
      'Add task and share',
      'Save and share',
    ]);
  });

  it('writes those words once: the picker and the form use the constants', () => {
    const code = (file) =>
      readFileSync(`src/${file}`, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    const picker = code('components/files/FilesPicker.jsx');
    const form = code('app/(app)/projects/[id]/_board/TaskFormDialog.jsx');
    expect(picker).toContain('confirmLabel={ATTACH_AND_SHARE}');
    expect(form).toContain('confirmLabel={task ? SAVE_AND_SHARE : ADD_AND_SHARE}');
    for (const words of [ATTACH_AND_SHARE, ADD_AND_SHARE, SAVE_AND_SHARE]) {
      expect(`${picker}${form}`).not.toContain(words);
    }
  });
});

describe('who it asks about', () => {
  it('asks for anyone on the project and a person who is not a manager', () => {
    expect(filesToShare([contract, guide], VISHAL, project)).toEqual([contract]);
    expect(filesToShare([contract, guide], null, project)).toEqual([contract]);
    expect(filesToShare([guide], VISHAL, project)).toEqual([]);
  });

  it('never asks for the PM or an active Admin, and does for a deactivated Admin', () => {
    expect(filesToShare([contract], PM, project)).toEqual([]);
    expect(filesToShare([contract], CEO, project)).toEqual([]);
    expect(filesToShare([contract], { ...CEO, status: 'deactivated' }, project)).toEqual([
      contract,
    ]);
    // Another PM who is a member isn't this project's manager.
    expect(filesToShare([contract], { id: 9, role: 'pm', status: 'active' }, project)).toEqual([
      contract,
    ]);
    expect(managesProject(PM, project)).toBe(true);
    expect(privateFiles([contract, guide])).toEqual([contract]);
  });

  it('reads a person from an option, a card or the details, and names them in shareWith', () => {
    const option = {
      id: 12,
      name: 'Vishal Saini',
      role: 'employee',
      status: 'active',
      kind: 'member',
    };
    expect(personOf(option)).toEqual(VISHAL);
    expect(personOf({ id: '12', name: 'Vishal Saini' })).toEqual({
      id: 12,
      role: null,
      status: 'active',
    });
    expect(personOf(null)).toBeNull();
    expect(shareWithOf(VISHAL)).toBe(12);
    expect(shareWithOf(null)).toBe('');
  });
});

describe('the ShareConfirm line', () => {
  const render = (props) =>
    renderToStaticMarkup(
      createElement(ShareConfirm, {
        text: shareText({ files: [contract], personName: 'Vishal Saini' }),
        confirmLabel: ATTACH_AND_SHARE,
        onBack: () => {},
        onConfirm: () => {},
        ...props,
      }),
    );

  it('says the sentence as a status, with the Lock, Back and the confirm button', () => {
    const html = render();
    expect(html).toMatch(/^<div class="[^"]*_ask_[^"]*" role="status"/);
    expect(html).toContain('lucide-lock');
    expect(text(html)).toBe(
      'acme-store-contract-signed.pdf is only for PM and Admins. Vishal Saini will be able to open it from this task. Back Attach and share',
    );
  });

  it('keeps both buttons focusable while the save runs: aria-disabled, never disabled', () => {
    const html = render({ busy: true });
    const buttons = html.match(/<button\b[^>]*>/g);
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toContain('aria-disabled="true"');
      expect(button).not.toMatch(/\sdisabled(=|\s|>)/);
    }
    expect(buttons[1]).toContain('aria-busy="true"');
  });
});
