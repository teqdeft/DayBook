'use client';
// Menu button: the row "⋯" menu (Edit, Mark urgent, Deactivate) and the signed-in person's menu.
// The list opens below (or above) the trigger in a fixed layer, so a table or drawer that scrolls
// never clips it. Arrow keys move, Escape and Tab close, focus returns to the trigger.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Ellipsis } from 'lucide-react';
import styles from './Menu.module.css';

const GAP = 6;
const EDGE = 8;

/**
 * Fixed-position offsets for a list `width` px wide next to the trigger's rect: below or above it,
 * lined up with its right edge (`end`) or left edge (`start`), and moved sideways as far as needed
 * to stay `EDGE` px inside the window (row menus on phone cards sit near the left edge).
 */
function placeNextTo(rect, { placement, align, width }) {
  const { clientWidth, clientHeight } = document.documentElement;
  const next = {};
  if (placement === 'top') next.bottom = clientHeight - rect.top + GAP;
  else next.top = rect.bottom + GAP;
  const wanted = align === 'start' ? rect.left : rect.right - width;
  next.left = Math.round(Math.max(EDGE, Math.min(wanted, clientWidth - EDGE - width)));
  return next;
}

/**
 * @typedef {{ label: string, onSelect?: () => void, href?: string, tone?: 'default'|'danger',
 *   disabled?: boolean, icon?: import('react').ReactNode }} MenuItem
 */

/**
 * @param {{
 *   label: string, items: MenuItem[], header?: import('react').ReactNode,
 *   children?: import('react').ReactNode, align?: 'start'|'end', placement?: 'bottom'|'top',
 *   width?: number, triggerClassName?: string, className?: string,
 * }} props
 *   `label` is the trigger's accessible name. `children` replaces the default "⋯" icon inside
 *   the trigger button.
 */
export default function Menu({
  label,
  items = [],
  header,
  children,
  align = 'end',
  placement = 'bottom',
  width = 200,
  triggerClassName,
  className = '',
}) {
  const [position, setPosition] = useState(null);
  const open = position !== null;
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const menuId = useId();

  function openMenu() {
    setPosition(
      placeNextTo(triggerRef.current.getBoundingClientRect(), { placement, align, width }),
    );
  }

  function close({ focusTrigger = true } = {}) {
    setPosition(null);
    if (focusTrigger) triggerRef.current?.focus();
  }

  // A list that would run off the bottom of the window opens upwards instead (row menus near
  // the bottom of a long table), and one that would run off the top opens downwards. Once the
  // list is measured, it is also kept inside the window sideways.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !position) return;
    const box = list.getBoundingClientRect();
    const rect = triggerRef.current.getBoundingClientRect();
    const fitsAbove = rect.top - GAP - box.height >= EDGE;
    const fitsBelow = rect.bottom + GAP + box.height <= window.innerHeight - EDGE;
    let side = 'top' in position ? 'bottom' : 'top';
    if (side === 'bottom' && !fitsBelow && fitsAbove) side = 'top';
    else if (side === 'top' && !fitsAbove && fitsBelow) side = 'bottom';
    const next = placeNextTo(rect, { placement: side, align, width: box.width });
    const same = Object.keys(next).every((key) => next[key] === position[key]);
    if (!same || Object.keys(next).length !== Object.keys(position).length) setPosition(next);
  }, [position, align]);

  useEffect(() => {
    if (!open) return undefined;
    listRef.current
      ?.querySelector('[role="menuitem"]:not([aria-disabled="true"])')
      ?.focus({ preventScroll: true });
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setPosition(null);
    }
    // The list follows its trigger while the page scrolls, and closes once the trigger is gone.
    function onViewportChange(event) {
      if (event.type === 'scroll' && listRef.current?.contains(event.target)) return;
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight || rect.width === 0) {
        setPosition(null);
        return;
      }
      setPosition((current) => {
        if (!current) return current;
        const side = 'bottom' in current ? 'top' : 'bottom';
        // The list's real width (its content may be wider than `width`).
        const listWidth = listRef.current?.offsetWidth || width;
        return placeNextTo(rect, { placement: side, align, width: listWidth });
      });
    }
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open, align, width]);

  function onTriggerKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu();
    }
  }

  function onListKeyDown(event) {
    const entries = [
      ...listRef.current.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])'),
    ];
    const index = entries.indexOf(document.activeElement);
    const moves = {
      ArrowDown: (index + 1) % entries.length,
      ArrowUp: (index - 1 + entries.length) % entries.length,
      Home: 0,
      End: entries.length - 1,
    };
    if (event.key in moves && entries.length > 0) {
      event.preventDefault();
      entries[moves[event.key]].focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      close({ focusTrigger: false });
    }
  }

  function select(item) {
    if (item.disabled) return;
    close();
    item.onSelect?.();
  }

  return (
    <div ref={rootRef} className={`${styles.root} ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName ?? styles.trigger}
        aria-label={children ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        {children ?? <Ellipsis size={18} strokeWidth={1.8} aria-hidden="true" />}
        {children ? <span className="visually-hidden">{label}</span> : null}
      </button>
      {open ? (
        <div
          ref={listRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className={styles.menu}
          style={{ ...position, minWidth: width }}
          onKeyDown={onListKeyDown}
        >
          {header ? <div className={styles.header}>{header}</div> : null}
          {items.map((item) => {
            const itemClass = `${styles.item} ${item.tone === 'danger' ? styles.danger : ''}`;
            const content = (
              <>
                {item.icon ? <span className={styles.icon}>{item.icon}</span> : null}
                {item.label}
              </>
            );
            return item.href && !item.disabled ? (
              <Link
                key={item.label}
                href={item.href}
                role="menuitem"
                tabIndex={-1}
                className={itemClass}
                onClick={() => close({ focusTrigger: false })}
              >
                {content}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={itemClass}
                aria-disabled={item.disabled ? 'true' : undefined}
                onClick={() => select(item)}
              >
                {content}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
