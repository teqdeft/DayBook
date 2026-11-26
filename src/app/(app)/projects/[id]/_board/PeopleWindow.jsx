'use client';
// The people window, "Assign to" (CONTRACT 28, The people window): who a task can be given to. From
// a card's face or the task window's "Assigned to" on a computer it is a 300 px popover anchored to
// that button; from "Assign to…" in a menu, the Table's "Give to…" and always at 640 px and below it
// is a 400 px window (a bottom sheet on a phone) titled "Assign Checkout fix before client demo" or
// "Give 2 tasks to", with Cancel. "Find a person" filters the rows by name. Picking saves and
// closes; when the pick would let someone who isn't a manager open an "Only PM and Admins" file, the
// foot turns into the share confirm first ("Give and share"). A pick whose save answers that the
// share confirm is needed (`fields.shareConfirmed`) turns the foot into the confirm too, and the
// window stays open until it succeeds or is cancelled.
import { useEffect, useId, useRef, useState } from 'react';
import { Check, Users } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Input from '@/components/Input';
import ShareConfirm from '@/components/files/ShareConfirm';
import windowStyles from '../projectWindows.module.css';
import { asksShare } from './assignView';
import PeoplePopover from './PeoplePopover';
import { filterRows, peopleRows, peopleShareText, shareNeeded, sharingTasks } from './peopleView';
import styles from './PeopleWindow.module.css';

/** True at 640 px and below, where the people window is always a window. */
const isPhone = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 640px)').matches);

/** A popover only for one task opened from a face on a computer. */
export const asPopover = ({ tasks, anchor }) => Boolean(anchor) && tasks.length === 1 && !isPhone();

/** "Assign Checkout fix before client demo" (one task) or "Give 2 tasks to" (several). */
export const peopleTitle = (tasks) =>
  tasks.length === 1 ? `Assign ${tasks[0].title}` : `Give ${tasks.length} tasks to`;

const sameId = (a, b) => ((a ?? null) === null ? (b ?? null) === null : Number(a) === Number(b));

/**
 * The share confirm's line for a pick: the people window's words from the tasks the window has
 * (read again after a server answer), or the server's own sentence when those tasks know of no
 * "Only PM and Admins" file (a bulk selection that couldn't be read again).
 */
function confirmText(list, row, error) {
  const local = list.length === 1 || sharingTasks(list, row.id).length > 0;
  const server = error?.fields?.shareConfirmed;
  if (!local && server) return server;
  return peopleShareText(list, row.person ? row.person.name : null, row.id);
}

/**
 * Picking a row: nothing for the current person, the share confirm first when it is needed, then
 * `onPick`; a promise from `onPick` keeps the window open (busy) until it settles. A rejection that
 * asks for the share confirm (`fields.shareConfirmed`) turns the foot into the confirm, with the
 * tasks read again when it carries them (`error.tasks`).
 */
function usePicking({ tasks, setTasks, rows, project, ask, onPick, onClose }) {
  const [confirm, setConfirm] = useState(() => {
    const row = ask ? rows.find((one) => sameId(one.id, ask.assigneeId)) : null;
    return row ? { row, text: ask.text ?? confirmText(tasks, row) } : null;
  });
  const [busy, setBusy] = useState(null);

  function submit(row, shareConfirmed) {
    const result = onPick(row.id, { shareConfirmed, tasks });
    if (!result || typeof result.then !== 'function') return onClose({ picked: true });
    setBusy(row.key);
    result.then(
      () => onClose({ picked: true }),
      (error) => {
        setBusy(null);
        if (!asksShare(error)) return onClose({ picked: true });
        const fresh = Array.isArray(error.tasks) && error.tasks.length > 0 ? error.tasks : tasks;
        if (fresh !== tasks) setTasks(fresh);
        setConfirm({ row, text: confirmText(fresh, row, error) });
      },
    );
  }

  function pick(row) {
    if (row.disabled || busy) return;
    if (tasks.length === 1 && row.checked) return onClose({ picked: false });
    if (shareNeeded(tasks, row.person, project)) {
      return setConfirm({ row, text: confirmText(tasks, row) });
    }
    submit(row, false);
  }

  return {
    confirm,
    busy,
    pick,
    back: () => setConfirm(null),
    share: () => confirm && submit(confirm.row, true),
  };
}

function PersonRow({ row, busy, onPick }) {
  return (
    <button
      type="button"
      className={styles.row}
      data-person={row.key}
      aria-pressed={row.checked}
      aria-disabled={row.disabled || Boolean(busy) || undefined}
      aria-busy={busy === row.key || undefined}
      onClick={() => onPick(row)}
    >
      {row.person ? (
        <Avatar user={row.person} size={28} />
      ) : (
        <span className={styles.anyone} aria-hidden="true">
          <Users size={12} strokeWidth={1.8} />
        </span>
      )}
      <span className={styles.text}>
        <span className={styles.name}>{row.name}</span>
        <span className={styles.sub}>{row.sub}</span>
      </span>
      {row.checked ? (
        <Check className={styles.check} size={16} strokeWidth={1.8} aria-hidden="true" />
      ) : null}
    </button>
  );
}

/** "Find a person" and the rows ("No one matches." when none does). */
function PeopleList({ rows, picking, heading }) {
  const inputId = useId();
  const [query, setQuery] = useState('');
  const shown = filterRows(rows, query);
  return (
    <>
      <div className={styles.head}>
        {heading ? <h2 className={styles.heading}>Assign to</h2> : null}
        <label htmlFor={inputId} className="visually-hidden">
          Find a person
        </label>
        <Input
          id={inputId}
          type="search"
          compact
          className={styles.search}
          placeholder="Find a person"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          data-autofocus=""
        />
      </div>
      <div className={styles.list}>
        {shown.map((row) => (
          <PersonRow key={row.key} row={row} busy={picking.busy} onPick={picking.pick} />
        ))}
        <p className={styles.none} role="status">
          {shown.length === 0 ? 'No one matches.' : ''}
        </p>
      </div>
    </>
  );
}

/**
 * The share confirm in the foot; "Give and share" takes the focus. Back (or Escape inside it)
 * returns to the list, with the focus on the row that was picked.
 */
function Confirm({ picking }) {
  const ref = useRef(null);
  const shown = picking.confirm;
  useEffect(() => {
    if (shown) ref.current?.querySelector('button:last-of-type')?.focus({ preventScroll: true });
  }, [shown]);
  if (!shown) return null;
  const back = () => {
    // The confirm goes with Back, so the window is found first.
    const box = ref.current?.closest('[role="dialog"]');
    const key = shown.row.key;
    picking.back();
    requestAnimationFrame(() => box?.querySelector(`[data-person="${key}"]`)?.focus());
  };
  const onKeyDown = (event) => {
    if (event.key !== 'Escape' || picking.busy) return;
    event.preventDefault();
    event.stopPropagation();
    back();
  };
  return (
    <div ref={ref} className={styles.confirm} onKeyDown={onKeyDown}>
      <ShareConfirm
        text={shown.text}
        confirmLabel="Give and share"
        busy={Boolean(picking.busy)}
        onBack={back}
        onConfirm={picking.share}
      />
    </div>
  );
}

/**
 * @param {{ tasks: object[], anchor?: HTMLElement | null, title?: string, options: object[],
 *   viewerId: number, project?: { id: number, pmId: number | null },
 *   ask?: { assigneeId: number | null, text?: string } | null, open?: boolean,
 *   onPick: (assigneeId: number | null, options: { shareConfirmed: boolean,
 *     tasks: object[] }) => unknown,
 *   onClose: (how?: { picked: boolean }) => void }} props tasks: the one task or the bulk
 *   selection (BoardTask or TaskDetails: `assignee`, `privateLinkCount`); anchor: the face that
 *   opened it (a popover); project: for the share rule; ask: open straight in the share confirm
 *   for that pick (the server asked for it); onPick gets the tasks as the window has them now and
 *   may return a promise: rejected with the API's `fields.shareConfirmed` (and, read again,
 *   `tasks`) it shows the confirm, else the window closes when it settles
 */
export default function PeopleWindow({
  tasks: given,
  anchor,
  title,
  options,
  viewerId,
  project = { id: null, pmId: null },
  ask = null,
  open = true,
  onPick,
  onClose,
}) {
  const [tasks, setTasks] = useState(given);
  // A popover or a window, decided once when it opens (the width can change while it is open).
  const [popover] = useState(() => asPopover({ tasks: given, anchor }));
  const one = tasks.length === 1 ? tasks[0] : null;
  const rows = peopleRows(options, one, viewerId);
  const picking = usePicking({ tasks, setTasks, rows, project, ask, onPick, onClose });
  if (popover) {
    if (!open) return null;
    return (
      <PeoplePopover anchor={anchor} asking={Boolean(picking.confirm)} onClose={onClose}>
        <PeopleList rows={rows} picking={picking} heading />
        {picking.confirm ? (
          <div className={styles.foot}>
            <Confirm picking={picking} />
          </div>
        ) : null}
      </PeoplePopover>
    );
  }
  return (
    <PeopleDialog
      open={open}
      title={title ?? peopleTitle(tasks)}
      rows={rows}
      picking={picking}
      onClose={onClose}
    />
  );
}

/** The window: 400 px, its title, the list, Cancel (or the share confirm) in its footer. */
function PeopleDialog({ open, title, rows, picking, onClose }) {
  const cancel = () => onClose({ picked: false });
  return (
    <Dialog
      open={open}
      width={400}
      className={`${windowStyles.window} ${styles.window}`}
      title={title}
      onClose={cancel}
      footer={
        picking.confirm ? (
          <Confirm picking={picking} />
        ) : (
          <Button variant="secondary" onClick={cancel}>
            Cancel
          </Button>
        )
      }
    >
      <PeopleList rows={rows} picking={picking} />
    </Dialog>
  );
}
