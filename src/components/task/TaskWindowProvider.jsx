'use client';
// Opens the task window from anywhere under it (CONTRACT 27, Task window). On a project page
// (`projectId`) it also opens the task a link names (`?task=<id>`: task notifications, Today's
// "Open project", the Files tab) over whichever tab loads, and closing that window takes the
// parameter away with router.replace (no history entry). There it also holds the file X's Undo
// toast ("File removed."), so a closed window never cuts it short. Today's Priority card mounts it
// in `today` mode, with its to-do card's "Add to to-do".
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useFileRemoval } from '@/components/files/useFileRemoval';
import TaskWindow from './TaskWindow';

const WindowContext = createContext(null);

const taskIdOf = (value) => (/^[1-9]\d{0,17}$/.test(value ?? '') ? Number(value) : null);

/** The page's address without `?task=`. */
function withoutTask(pathname, params) {
  const next = new URLSearchParams(params?.toString() ?? '');
  next.delete('task');
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * The window opened from a card, a row or a button: `{ taskId, origin, title, returnFocus, key }`
 * or null.
 */
function useOpened() {
  const [opened, setOpened] = useState(null);
  const count = useRef(0);
  const open = useCallback((taskId, { origin = null, title = null, returnFocus = null } = {}) => {
    const id = Number(taskId);
    if (!(id > 0)) return;
    count.current += 1;
    setOpened({ taskId: id, origin, title, returnFocus, key: `open:${count.current}` });
  }, []);
  return [opened, open, setOpened];
}

function Provider({ value, shown, close, windowProps, children, after = null }) {
  return (
    <WindowContext.Provider value={value}>
      {children}
      {shown ? (
        <TaskWindow
          key={shown.key}
          taskId={shown.taskId}
          open
          onClose={close}
          origin={shown.origin}
          title={shown.title}
          returnFocus={shown.returnFocus}
          {...windowProps}
        />
      ) : null}
      {after}
    </WindowContext.Provider>
  );
}

/** A project page: cards, rows and `?task=`. */
function ProjectWindows({ windowProps, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const removal = useFileRemoval();
  const asked = taskIdOf(params?.get('task'));
  const [opened, open, setOpened] = useOpened();
  // The `?task=` window closed by hand while the address still names it.
  const [dismissed, setDismissed] = useState(null);
  if (dismissed !== null && asked !== dismissed) setDismissed(null);
  const fromLink = asked && asked !== dismissed ? asked : null;
  const shown =
    opened ?? (fromLink ? { taskId: fromLink, origin: null, key: `link:${fromLink}` } : null);

  const close = useCallback(() => {
    if (opened) {
      setOpened(null);
      return;
    }
    if (!fromLink) return;
    setDismissed(fromLink);
    router.replace(withoutTask(pathname, params), { scroll: false });
  }, [opened, setOpened, fromLink, router, pathname, params]);

  const value = useMemo(() => ({ open, close }), [open, close]);
  return (
    <Provider
      value={value}
      shown={shown}
      close={close}
      windowProps={{ ...windowProps, removal }}
      after={removal.toast}
    >
      {children}
    </Provider>
  );
}

/** Anywhere else (Today): rows and buttons only. */
function PlainWindows({ windowProps, children }) {
  const [opened, open, setOpened] = useOpened();
  const close = useCallback(() => setOpened(null), [setOpened]);
  const value = useMemo(() => ({ open, close }), [open, close]);
  return (
    <Provider value={value} shown={opened} close={close} windowProps={windowProps}>
      {children}
    </Provider>
  );
}

/**
 * @param {{ mode: 'manage' | 'team' | 'member' | 'today', projectId?: number,
 *   currentPhase?: string | null, today?: string,
 *   todo?: { has: (taskId: number) => boolean, add: (task: object) => void } | null,
 *   todoOpen?: boolean, children: import('react').ReactNode }} props projectId: the page's
 *   project (a task of another project shows the window's error state; reads `?task=`);
 *   currentPhase: the project's phase, for the header's "Current" tag; today: the company's date
 *   for the due tag and the report line (the browser's date when left out); todo: Today's to-do
 *   card, for "Add to to-do" and "In to-do" in `today` mode; todoOpen: in `member` mode, "Add to
 *   to-do" shows only while today's to-do takes lines (`head.todoOpen`)
 */
export function TaskWindowProvider({
  mode,
  projectId,
  currentPhase,
  today,
  todo,
  todoOpen = false,
  children,
}) {
  const windowProps = {
    mode,
    projectId: projectId ?? null,
    currentPhase: currentPhase ?? null,
    today,
    todo: todo ?? null,
    todoOpen: Boolean(todoOpen),
  };
  if (projectId) return <ProjectWindows windowProps={windowProps}>{children}</ProjectWindows>;
  return <PlainWindows windowProps={windowProps}>{children}</PlainWindows>;
}

/**
 * @returns {null | { open: (taskId: number, opts?: { origin?: HTMLElement | null,
 *   title?: string, returnFocus?: () => HTMLElement | null }) => void, close: () => void }} null
 *   outside a TaskWindowProvider; origin: where focus returns; title: shown while the task loads;
 *   returnFocus: where focus returns when the opener is gone from the page (a card drawn again in
 *   another list after Mark done)
 */
export function useTaskWindow() {
  return useContext(WindowContext);
}
