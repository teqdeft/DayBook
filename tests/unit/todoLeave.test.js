// Leaving Today while a removed to-do line waits behind its Undo toast (CONTRACT 24): the delete
// queue sends the waiting DELETE at once and says when it has answered (settle), and a click on a
// link to another page waits for that before it is followed, so the report opens without the line.
import { describe, expect, it, vi } from 'vitest';
import { createDeleteQueue } from '@/app/(app)/projects/[id]/undoQueue';
import { LEAVE_WAIT_MS, createLeaveGuard, leavingLink } from '@/app/(app)/today/useSendBeforeLeave';

async function flush() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

/** A DELETE that answers when the test says so. */
function deferredSend() {
  const calls = [];
  const send = vi.fn(
    (entry) =>
      new Promise((resolve, reject) => {
        calls.push({ entry, resolve, reject });
      }),
  );
  return { send, calls };
}

describe('settling the delete queue', () => {
  it('sends the waiting delete at once and resolves once it has answered', async () => {
    const { send, calls } = deferredSend();
    const queue = createDeleteQueue({ send, sendOnLeave: vi.fn() });
    const onSent = vi.fn();
    queue.listen({ onSent });
    expect(queue.busy).toBe(false);
    queue.hold({ key: 'line:22', url: '/api/me/todo/lines/22', label: 'Task removed.' });
    expect(queue.busy).toBe(true);
    let settled = false;
    queue.settle(['line:22']).then(() => (settled = true));
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.pending).toBeNull();
    expect(settled).toBe(false);
    expect(queue.busy).toBe(true);
    calls[0].resolve();
    await flush();
    expect(settled).toBe(true);
    expect(onSent).toHaveBeenCalled();
    expect(queue.busy).toBe(false);
  });

  it('leaves a waiting delete of another row alone, but waits for one already on its way', async () => {
    const { send, calls } = deferredSend();
    const queue = createDeleteQueue({ send, sendOnLeave: vi.fn() });
    queue.hold({ key: 'line:21', url: '/a', label: 'Task removed.' });
    queue.hold({ key: 'line:22', url: '/b', label: 'Task removed.' }); // sends line:21
    let settled = false;
    queue.settle(['line:21']).then(() => (settled = true));
    await flush();
    expect(queue.pending.key).toBe('line:22');
    expect(send).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    calls[0].reject(Object.assign(new Error('Try again.'), { status: 500 }));
    await flush();
    // A failed delete settles too (the row comes back through onFailed).
    expect(settled).toBe(true);
  });

  it('settles at once when nothing waits, and sends everything when no keys are given', async () => {
    const { send, calls } = deferredSend();
    const queue = createDeleteQueue({ send, sendOnLeave: vi.fn() });
    let empty = false;
    queue.settle(['line:9']).then(() => (empty = true));
    await flush();
    expect(empty).toBe(true);
    queue.hold({ key: 'project:2', url: '/c', label: 'Project removed.' });
    const all = queue.settle();
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    calls[0].resolve();
    await expect(all).resolves.toBeUndefined();
  });
});

/** A link element as the guard sees it. */
function link(href, attributes = {}) {
  return {
    href: new URL(href, 'https://daybook.test/today').href,
    isConnected: true,
    click: vi.fn(),
    getAttribute: (name) => (name === 'href' ? href : (attributes[name] ?? null)),
    hasAttribute: (name) => name in attributes,
    closest() {
      return this;
    },
  };
}
const HERE = {
  href: 'https://daybook.test/today',
  origin: 'https://daybook.test',
  pathname: '/today',
};
const clickOn = (target, extra = {}) => ({
  target,
  button: 0,
  defaultPrevented: false,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  ...extra,
});

describe('the link a click leaves by', () => {
  it('is a plain click on a link to another page of the site', () => {
    const report = link('/report');
    expect(leavingLink(clickOn(report), HERE)).toBe(report);
    expect(leavingLink(clickOn({ closest: () => report }), HERE)).toBe(report);
  });

  it('is none for a new tab, a modified or other button, a download, another site or this page', () => {
    expect(leavingLink(clickOn(link('/report', { target: '_blank' })), HERE)).toBeNull();
    expect(leavingLink(clickOn(link('/report'), { ctrlKey: true }), HERE)).toBeNull();
    expect(leavingLink(clickOn(link('/report'), { button: 1 }), HERE)).toBeNull();
    expect(leavingLink(clickOn(link('/api/x.csv', { download: '' })), HERE)).toBeNull();
    expect(leavingLink(clickOn(link('https://example.com/report')), HERE)).toBeNull();
    expect(leavingLink(clickOn(link('/today#todo')), HERE)).toBeNull();
    expect(leavingLink(clickOn({ closest: () => null }), HERE)).toBeNull();
    expect(leavingLink(clickOn(link('/report'), { defaultPrevented: true }), HERE)).toBeNull();
  });
});

describe('the leave guard', () => {
  const guard = ({ waiting = () => true, settle, wait = () => new Promise(() => {}) } = {}) => {
    const follow = vi.fn();
    const onClick = createLeaveGuard({ waiting, settle, here: () => HERE, wait, follow });
    return { onClick, follow };
  };

  it('holds a click on a link while a delete waits, then follows it once the delete answered', async () => {
    let answer;
    const settle = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const { onClick, follow } = guard({ settle });
    const report = link('/report');
    const event = clickOn(report);
    onClick(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(settle).toHaveBeenCalledTimes(1);
    await flush();
    expect(follow).not.toHaveBeenCalled();
    // A second click while waiting replaces the link, and waits for the same deletes.
    const log = link('/log');
    onClick(clickOn(log));
    expect(settle).toHaveBeenCalledTimes(1);
    answer();
    await flush();
    expect(follow).toHaveBeenCalledWith(log);
  });

  it('lets its own click through, and every click while nothing waits', async () => {
    const again = [];
    let onClick;
    // Following the link clicks it again (as link.click() does), with a delete still waiting.
    const follow = vi.fn((target) => {
      again.push(clickOn(target));
      onClick(again.at(-1));
    });
    const settle = vi.fn(() => Promise.resolve());
    onClick = createLeaveGuard({
      waiting: () => true,
      settle,
      here: () => HERE,
      wait: () => new Promise(() => {}),
      follow,
    });
    onClick(clickOn(link('/report')));
    await flush();
    expect(follow).toHaveBeenCalledTimes(1);
    expect(again[0].preventDefault).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledTimes(1);

    const idle = guard({ waiting: () => false, settle });
    const event = clickOn(link('/report'));
    idle.onClick(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it(`follows the link after ${LEAVE_WAIT_MS / 1000} s even when the delete hangs`, async () => {
    vi.useFakeTimers();
    try {
      const { onClick, follow } = guard({
        settle: () => new Promise(() => {}),
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      });
      const report = link('/report');
      onClick(clickOn(report));
      await vi.advanceTimersByTimeAsync(LEAVE_WAIT_MS - 1);
      expect(follow).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(follow).toHaveBeenCalledWith(report);
    } finally {
      vi.useRealTimers();
    }
  });
});
