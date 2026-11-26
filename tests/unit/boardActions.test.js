// The Board's card actions and first filter (CONTRACT 27 and 28, Board tab; CONTRACT 22, UndoToast): a
// delete from the keyboard leaves focus on the toast's Undo (the next card mustn't take it, or Enter
// opens that task and the delete goes through), and Undo, Tab or Escape bring it back to the card,
// or to the next one when the card stayed deleted; a pointer delete moves focus to the next card.
// A move that fails puts the card back, drawn again in its old column, and focus goes back to it
// there (a move from a menu glides first: CONTRACT 28). A card opens the task window with its title
// shown at once, and names where focus goes when the card was drawn again meanwhile (marked done in
// the window). `?show=files` ticks With files only for a viewer who may see files. Files dropped where nothing takes them are swallowed
// (FileDropGuard). A focused card drawn again is in boardFocus.test.js (split by CONTRACT 28, Files
// and owners). The browser path is in tests/e2e/project-board.spec.js.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {} }),
  usePathname: () => '/projects/5',
  useSearchParams: () => new URLSearchParams(),
}));

const { cardActions, openTaskFrom } = await import('@/app/(app)/projects/[id]/_board/useBoard.js');
const { firstFilters } = await import('@/app/(app)/projects/[id]/_board/boardFilters.js');
const { guardFileDrops } = await import('@/app/(app)/projects/[id]/FileDropGuard.jsx');

const task = (id) => ({ id, title: `Task ${id}`, phase: 'development', status: 'open' });
const TASKS = [task(1), task(2), task(3)];
const COLUMNS = [{ key: 'development', open: TASKS }];

let onPage;
beforeEach(() => {
  onPage = new Map();
  vi.stubGlobal('document', { getElementById: (id) => onPage.get(id) ?? null });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
});
afterEach(() => vi.unstubAllGlobals());

function actionsFor({ keyboard, moved = true }) {
  const editor = { remove: vi.fn() };
  const after = vi.fn();
  const actions = cardActions({
    columns: COLUMNS,
    moves: { move: vi.fn(async () => moved) },
    editor,
    after,
    keyboard: () => keyboard,
    scroll: { show: vi.fn() },
  });
  return { actions, editor, after };
}

describe('deleting a card', () => {
  it('from the keyboard leaves focus on Undo: nothing else is focused after the render', () => {
    const { actions, editor, after } = actionsFor({ keyboard: true });
    actions.deleteTask(TASKS[1]);
    expect(editor.remove).toHaveBeenCalledWith(
      TASKS[1],
      expect.objectContaining({ keyboard: true }),
    );
    expect(after).not.toHaveBeenCalled();
  });

  it('with the pointer moves focus to the next card, or the one before the last', () => {
    const { actions, editor, after } = actionsFor({ keyboard: false });
    actions.deleteTask(TASKS[1]);
    expect(editor.remove.mock.calls[0][1].keyboard).toBe(false);
    expect(after).toHaveBeenCalledWith('board-card-3-title');
    actions.deleteTask(TASKS[2]);
    expect(after).toHaveBeenLastCalledWith('board-card-2-title');
  });

  it("returns focus to the card after Undo, else to the next card or the column's Add task", () => {
    const { actions, editor } = actionsFor({ keyboard: true });
    actions.deleteTask(TASKS[1]);
    const { returnFocus } = editor.remove.mock.calls[0][1];
    const card = { id: 'card 2' };
    const next = { id: 'card 3' };
    onPage.set('board-card-3-title', next);
    expect(returnFocus()).toBe(next); // Tab or Escape: the card is still hidden
    onPage.set('board-card-2-title', card);
    expect(returnFocus()).toBe(card); // Undo: the card is back
    onPage.clear();
    expect(returnFocus()).toBeNull();

    const alone = cardActions({
      columns: [{ key: 'testing', open: [task(9)] }],
      editor,
      after: vi.fn(),
      keyboard: () => true,
    });
    alone.deleteTask({ ...task(9), phase: 'testing' });
    const add = { id: 'add' };
    onPage.set('board-testing-add', add);
    expect(editor.remove.mock.calls[1][1].returnFocus()).toBe(add);
  });
});

describe('a move that fails', () => {
  const menuButton = { id: 'the card’s ⋯' };
  const onCard = (id) => (id === 'board-card-2' ? { querySelector: () => menuButton } : null);

  it('puts focus back on the card’s ⋯ in its old column after the dialog', async () => {
    const { actions, after } = actionsFor({ keyboard: true, moved: false });
    vi.stubGlobal('document', { getElementById: onCard });
    expect(await actions.move(TASKS[1], 'testing', 'dialog')).toBe(false);
    expect(after).toHaveBeenCalledTimes(2); // the ⋯ in the new column, then in the old one
    const [target] = after.mock.calls[1];
    expect(target()).toBe(menuButton);
  });

  it('puts focus back on the card’s title after a drag, and on a phone', async () => {
    const dragged = actionsFor({ keyboard: false, moved: false });
    await dragged.actions.move(TASKS[1], 'testing', 'drag');
    expect(dragged.after).toHaveBeenLastCalledWith('board-card-2-title');

    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    const phone = actionsFor({ keyboard: false, moved: false });
    await phone.actions.move(TASKS[1], 'testing', 'dialog');
    expect(phone.after).toHaveBeenLastCalledWith('board-card-2-title');
  });

  it('moves focus only once when the server takes the move', async () => {
    const { actions, after } = actionsFor({ keyboard: true, moved: true });
    expect(await actions.move(TASKS[1], 'testing', 'dialog')).toBe(true);
    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe('opening the task window from a card', () => {
  const open = (task, origin) => {
    const taskWindow = { open: vi.fn() };
    openTaskFrom(taskWindow, task, origin);
    return taskWindow.open.mock.calls[0];
  };

  it('shows the card’s title at once while the task loads', () => {
    const title = { id: 'board-card-2-title' };
    const [id, opts] = open(TASKS[1], title);
    expect(id).toBe(2);
    expect(opts).toMatchObject({ origin: title, title: 'Task 2' });
  });

  it('returns focus to the title for a click on the card, and to the ⋯ that opened it', () => {
    const title = { id: 'board-card-2-title' };
    onPage.set('board-card-2-title', title);
    expect(open(TASKS[1], { id: 'board-card-2' })[1].origin).toBe(title);
    const menu = { id: 'menu' };
    expect(open(TASKS[1], menu)[1].origin).toBe(menu);
  });

  it('names the card drawn again, else its column’s done fold, else Add task', () => {
    const { returnFocus } = open(TASKS[1], null)[1];
    expect(returnFocus()).toBeNull();
    const add = { id: 'board-development-add' };
    onPage.set('board-development-add', add);
    expect(returnFocus()).toBe(add);
    const fold = { id: 'board-development-done' };
    onPage.set('board-development-done', fold);
    expect(returnFocus()).toBe(fold); // marked done into a closed "› 6 done"
    const again = { id: 'board-card-2-title' };
    onPage.set('board-card-2-title', again);
    expect(returnFocus()).toBe(again); // the fold is open: the card's title there
  });
});

describe('files dropped where nothing takes them', () => {
  const drag = (type, types) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types } });
    return event;
  };

  it('are swallowed on every tab, so the browser never opens the file instead of Daybook', () => {
    const page = new EventTarget();
    const stop = guardFileDrops(page);
    for (const type of ['dragover', 'drop']) {
      const files = drag(type, ['Files']);
      page.dispatchEvent(files);
      expect(files.defaultPrevented).toBe(true);
      const text = drag(type, ['text/plain']);
      page.dispatchEvent(text);
      expect(text.defaultPrevented).toBe(false);
    }
    stop();
    const later = drag('drop', ['Files']);
    page.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });
});

describe('the Filter item ticked first (the 1.12 pill pressed first)', () => {
  const ticked = (input) => {
    const filters = firstFilters(input);
    return ['critical', 'files'].filter((item) => filters[item]).join() || 'none';
  };

  it('follows ?show= for the PM and a PM who may see files', () => {
    expect(ticked({ access: 'manage', filesAccess: 'manage', show: 'files' })).toBe('files');
    expect(ticked({ access: 'team', filesAccess: 'member', show: 'files' })).toBe('files');
    expect(ticked({ access: 'team', filesAccess: 'none', show: 'critical' })).toBe('critical');
    expect(ticked({ access: 'manage', filesAccess: 'manage', show: ['critical'] })).toBe(
      'critical',
    );
    expect(ticked({ access: 'manage', filesAccess: 'manage', show: null })).toBe('none');
  });

  it('ticks no With files without file rights, and nothing for a member', () => {
    expect(ticked({ access: 'team', filesAccess: 'none', show: 'files' })).toBe('none');
    expect(ticked({ access: 'team', filesAccess: undefined, show: 'files' })).toBe('none');
    expect(ticked({ access: 'member', filesAccess: 'member', show: 'files' })).toBe('none');
    expect(ticked({ access: 'member', filesAccess: 'member', show: 'critical' })).toBe('none');
  });
});
