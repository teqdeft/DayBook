'use client';
// Reopen project (CONTRACT 28, Completed note and Reopen): on a Completed project its PM and Admins
// get "Reopen project" where Add task sits (the toolbar on the Board tab, the header on the
// others). It asks first ("Reopen Proposals?"), sends the existing `PATCH /api/projects/[id]
// { status: 'active' }`, fades the note and the "Completed" tag out, then shows the project as
// Active at once (an override the page's header and board read, dropped once the page's status
// agrees) and gives "Add task" the focus; "Project reopened." has Undo, which sends it back to
// Completed the same way and gives "Reopen project" the focus back. The provider sits around the
// whole project page (ProjectView).
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { flushSync } from 'react-dom';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { done, play } from '@/lib/motion/animate';
import { EASE, duration } from '@/lib/motion/tokens';
import BusyButton from '../BusyButton';
import UndoToast from '../UndoToast';
import windowStyles from '../projectWindows.module.css';
import { REOPEN_ID } from './boardView';

const StatusContext = createContext(null);
/** What fades out when the project is reopened: the note and the header's "Completed" tag. */
const FADING = '[data-completed-fade]';

/** The note and the tag fade out (--dur-out), and the promise ends when they have. */
async function fadeCompleted() {
  const fades = [...document.querySelectorAll(FADING)].map((el) =>
    play(el, [{ opacity: 1 }, { opacity: 0 }], {
      duration: duration('out'),
      easing: EASE.accelerate,
      fill: 'forwards',
      id: 'reopen',
    }),
  );
  await Promise.all(fades.map(done));
  return fades;
}

/** Focus on a control drawn just now, unless the person is already on another one. */
function focusIfLost(id) {
  const active = document.activeElement;
  if (!active || active === document.body) document.getElementById(id)?.focus();
}

/**
 * Sends a status; once the server has it (`onSaved`: the confirm closes), fades what goes away,
 * shows the status at once and refreshes (the page's refresh confirms it).
 */
function useStatusChange({ projectId, setShown }) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  return useCallback(
    async (status, { fade = false, focusId = null, onSaved } = {}) => {
      await api.patch(`/api/projects/${projectId}`, { status });
      onSaved?.();
      const fades = fade ? await fadeCompleted() : [];
      flushSync(() => setShown(status));
      fades.forEach((animation) => animation?.cancel());
      if (focusId) document.getElementById(focusId)?.focus();
      startRefresh(() => router.refresh());
    },
    [projectId, setShown, router],
  );
}

/** The override and the drop rule: once the page's status is the shown one, the page's wins. */
function useShownStatus(status) {
  const [shown, setShown] = useState(null);
  const [seen, setSeen] = useState(status);
  if (seen !== status) {
    setSeen(status);
    if (shown !== null) setShown(null);
  }
  return [shown ?? status, setShown];
}

/**
 * @param {{ projectId: number, status: string, children: import('react').ReactNode }} props
 *   status: the page's (the project's status)
 */
export function ProjectStatusProvider({ projectId, status, children }) {
  const toast = useToast();
  const [shownStatus, setShown] = useShownStatus(status);
  const [pending, setPending] = useState(null);
  const counter = useRef(0);
  const change = useStatusChange({ projectId, setShown });

  const reopen = useCallback(
    async (focusId, onSaved) => {
      try {
        await change('active', { fade: true, focusId, onSaved });
        counter.current += 1;
        setPending({ key: counter.current, title: 'Project reopened.', focusId });
        return true;
      } catch (error) {
        toast({ title: "Couldn't reopen the project", body: error.message, tone: 'error' });
        return false;
      }
    },
    [change, toast],
  );

  // The toast goes at once, so the focus waits on "Add task" (the header's "+ New task") until the
  // answer takes that away and brings "Reopen project" back.
  const undo = useCallback(async () => {
    document.getElementById(pending?.focusId)?.focus();
    setPending(null);
    try {
      await change('completed');
      focusIfLost(REOPEN_ID);
    } catch (error) {
      toast({ title: "Couldn't undo", body: error.message, tone: 'error' });
    }
  }, [change, toast, pending]);

  const value = useMemo(() => ({ status: shownStatus, reopen }), [shownStatus, reopen]);
  return (
    <StatusContext.Provider value={value}>
      {children}
      <UndoToast pending={pending} onUndo={undo} onEnd={() => setPending(null)} />
    </StatusContext.Provider>
  );
}

/**
 * The project's status as shown: the page's, or what Reopen (or its Undo) just set.
 * @param {string} fallback the page's status, outside a ProjectStatusProvider
 * @returns {{ status: string,
 *   reopen: ((focusId: string, onSaved?: () => void) => Promise<boolean>) | null }} reopen: the
 *   PATCH, then `onSaved`, the fade and the change; false when it failed (an error toast said so)
 */
export function useProjectStatus(fallback) {
  return useContext(StatusContext) ?? { status: fallback, reopen: null };
}

/**
 * The header's "Completed" tag: gone once the project is reopened (it fades first).
 * @param {{ children: import('react').ReactNode, className?: string }} props
 */
export function CompletedTag({ children, className }) {
  const { status } = useProjectStatus('completed');
  if (status !== 'completed') return null;
  return (
    <span className={className} data-completed-fade="">
      {children}
    </span>
  );
}

/**
 * "Reopen project" and its confirm.
 * @param {{ projectName: string, focusId: string, className?: string,
 *   size?: 'default' | 'compact' }} props focusId: what takes the focus once the project is
 *   Active again (the toolbar's "Add task", the header's "+ New task")
 */
export default function ReopenProject({ projectName, focusId, className, size = 'default' }) {
  const { reopen } = useProjectStatus('completed');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!reopen || busy) return;
    setBusy(true);
    const saved = () => {
      setBusy(false);
      setOpen(false);
    };
    if (!(await reopen(focusId, saved))) setBusy(false);
  }

  return (
    <>
      <Button
        id={REOPEN_ID}
        variant="secondary"
        size={size}
        className={className}
        icon={<RotateCcw size={16} strokeWidth={1.8} aria-hidden="true" />}
        onClick={() => setOpen(true)}
      >
        Reopen project
      </Button>
      <Dialog
        open={open}
        width={480}
        className={windowStyles.window}
        onClose={() => setOpen(false)}
        title={`Reopen ${projectName}?`}
        description="It goes back to Active, and tasks can be added again."
        footer={
          <>
            <Button variant="secondary" data-autofocus="" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <BusyButton busy={busy} onClick={confirm}>
              Reopen project
            </BusyButton>
          </>
        }
      />
    </>
  );
}
