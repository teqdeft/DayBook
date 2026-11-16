'use client';
// The Team board's "To-do: 2 of 5 done" button and its popover (CONTRACT 24, prototype screen
// "Team"): a disclosure that opens a 380 px card on the menu surface with the person's to-do,
// whether it was posted to Slack (only while posting is on) and a link to their page. The card
// sits in a fixed layer under the button (the board's table scrolls sideways and would clip it),
// lined up with the button's right edge on desktop and its left edge at 640 px and below. Escape
// closes it and returns focus to the button; a click outside closes it.
import Link from 'next/link';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import TodoList from './TodoList';
import styles from './TodoPopover.module.css';

const WIDTH = 380;
const GAP = 6;
const EDGE = 8;
const MIN_HEIGHT = 160;
const NARROW = '(max-width: 640px)';

/** 'To-do: 2 of 5 done' */
export function todoButtonText(todo) {
  return `To-do: ${todo.done} of ${todo.total} done`;
}

/** "Priya's to-do" */
export function todoTitle(name) {
  const first =
    String(name ?? '')
      .trim()
      .split(/\s+/)[0] || 'Their';
  return `${first}'s to-do`;
}

/** 'Posted to Slack at 9:41 AM' | 'Not posted to Slack' | null while to-dos aren't posted. */
export function todoPostText(post) {
  if (!post) return null;
  return post.postedAt && post.at ? `Posted to Slack at ${post.at}` : 'Not posted to Slack';
}

/**
 * Fixed-position offsets for the card next to the button's rect: below it (above when it only
 * fits there), lined up with the button's right edge (`left` at 640 px and below), and kept
 * `EDGE` px inside the window. `maxHeight` lets a long to-do scroll inside the card.
 */
function placeCard(rect, height = 0) {
  const { clientWidth, clientHeight } = document.documentElement;
  const width = Math.min(WIDTH, clientWidth - 48);
  const narrow = window.matchMedia?.(NARROW).matches ?? false;
  const wanted = narrow ? rect.left - 4 : rect.right + 8 - width;
  const left = Math.round(Math.max(EDGE, Math.min(wanted, clientWidth - EDGE - width)));
  // Never shorter than a few lines, even with the button at the very edge of the window.
  const below = Math.max(MIN_HEIGHT, Math.round(clientHeight - rect.bottom - GAP - EDGE));
  const above = Math.max(MIN_HEIGHT, Math.round(rect.top - GAP - EDGE));
  if (height > below && above > below) {
    return { left, width, bottom: Math.round(clientHeight - rect.top + GAP), maxHeight: above };
  }
  return { left, width, top: Math.round(rect.bottom + GAP), maxHeight: below };
}

const samePlace = (a, b) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);

/**
 * The card's contents. No hooks, so it renders on its own (tests).
 * @param {{ todo: object, person: { name: string, href: string }, titleId: string,
 *   onClose?: () => void }} props
 */
export function TodoPopoverCard({ todo, person, titleId, onClose }) {
  const post = todoPostText(todo.post);
  return (
    <>
      <div className={styles.head}>
        <span className={styles.heading}>
          <span id={titleId} className={styles.title}>
            {todoTitle(person.name)}
          </span>
          {post ? <span className={styles.sub}>{post}</span> : null}
        </span>
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          <X size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      <TodoList groups={todo.groups} variant="popover" className={styles.list} />
      <div className={styles.foot}>
        <Link href={person.href} className={styles.open}>
          {`Open ${person.name}'s page`}
        </Link>
      </div>
    </>
  );
}

/**
 * @param {{ todo: { total: number, done: number, post: { postedAt: string|null, at: string|null }
 *   | null, groups: object[] }, person: { name: string, href: string }, className?: string }}
 *   props todo as getTeamToday() gives it on a board row (row.todo); person: the row's name and
 *   page link
 */
export default function TodoPopover({ todo, person, className = '' }) {
  const [place, setPlace] = useState(null);
  const open = place !== null;
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const cardRef = useRef(null);
  const cardId = useId();
  const titleId = useId();

  function close({ focusTrigger = true } = {}) {
    setPlace(null);
    if (focusTrigger) triggerRef.current?.focus();
  }

  function toggle() {
    if (open) close();
    else setPlace(placeCard(triggerRef.current.getBoundingClientRect()));
  }

  // Once measured, the card opens upwards when it only fits there.
  useLayoutEffect(() => {
    if (!open || !cardRef.current || !triggerRef.current) return;
    const next = placeCard(
      triggerRef.current.getBoundingClientRect(),
      cardRef.current.scrollHeight,
    );
    if (!samePlace(next, place)) setPlace(next);
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    cardRef.current?.focus({ preventScroll: true });
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setPlace(null);
    }
    // The card follows its button while the page scrolls, and closes once the button is gone.
    function onViewportChange(event) {
      if (event.type === 'scroll' && cardRef.current?.contains(event.target)) return;
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight || rect.width === 0) {
        setPlace(null);
        return;
      }
      setPlace(placeCard(rect, cardRef.current?.scrollHeight ?? 0));
    }
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open]);

  function onKeyDown(event) {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  // Tabbing out of the card (to the next row) closes it; a click inside it never does.
  function onBlur(event) {
    const next = event.relatedTarget;
    if (open && next && !rootRef.current?.contains(next)) close({ focusTrigger: false });
  }

  return (
    <span
      ref={rootRef}
      className={`${styles.root} ${className}`}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? cardId : undefined}
        onClick={toggle}
      >
        {todoButtonText(todo)}
        <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={cardRef}
          id={cardId}
          role="dialog"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={styles.card}
          style={place}
        >
          <TodoPopoverCard todo={todo} person={person} titleId={titleId} onClose={() => close()} />
        </div>
      ) : null}
    </span>
  );
}
