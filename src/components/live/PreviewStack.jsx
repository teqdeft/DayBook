'use client';
// The "New notifications" region (CONTRACT 26): the preview cards under the bell (or under the top
// bar on a page without one), at most 3 (2 on a phone, 1 in a short window), newest on top. The
// pointer moving or pressing on the stack, or focus in it, pauses every card (a card that appears
// under a resting mouse doesn't); Escape closes the focused card, or every card when nothing else
// used the key; focus that lands under a card closes the stack (WCAG 2.4.11).
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { workDate } from '@/lib/time';
import PreviewCard from './PreviewCard';
import styles from './PreviewStack.module.css';

const CARD_WIDTH = 360;
const GAP = 8;
const PHONE = '(max-width: 640px)';
const NARROW = '(max-width: 1023px)'; // AppShell's: the main area's padding is 24 px, else 32

const within = (inner, outer) =>
  inner.left >= outer.left &&
  inner.right <= outer.right &&
  inner.top >= outer.top &&
  inner.bottom <= outer.bottom;

/**
 * Where the stack sits at 641 px and wider: under the bell, else under the top bar, `right` level
 * with the main area's padding (decided by the same media query, which counts the scrollbar;
 * `clientWidth` doesn't, so a 1030 px window with a 15 px scrollbar still has 32 px).
 * @param {HTMLElement | null} bell the registered bell button
 * @returns {{ top: number, right: number } | null} null on a phone
 */
export function placement(bell) {
  if (window.matchMedia?.(PHONE).matches) return null; // the CSS brings it from the top
  const width = document.documentElement.clientWidth;
  const narrow = window.matchMedia?.(NARROW).matches ?? window.innerWidth < 1024;
  const bellBox = bell?.getBoundingClientRect();
  const anchor = bellBox?.width
    ? bellBox
    : document.querySelector('#main header')?.getBoundingClientRect();
  let top = anchor ? anchor.bottom + GAP : 16;
  if (!(top >= 8 && top <= 240)) top = 16;
  let right = narrow ? 24 : 32;
  if (bellBox?.width) {
    const cardWidth = Math.min(CARD_WIDTH, width - 32);
    right = Math.max(16, Math.min(width - bellBox.right, width - cardWidth - 16));
  }
  return { top: Math.round(top), right: Math.round(right) };
}

/**
 * The `<ol>`'s pause: the pointer once it moves or presses over the stack (not `pointerenter`,
 * which Chrome also fires when a card appears under a mouse that isn't moving), until it leaves;
 * and focus inside it, until focus goes outside.
 * @param {object} stack useStack's `api`
 */
export function listHandlers(stack) {
  const point = () => stack.hold('pointer', true);
  return {
    onPointerMove: point,
    onPointerDown: point,
    onPointerLeave: () => stack.hold('pointer', false),
    onFocus: (event) => stack.hold('focus', true, event.relatedTarget),
    onBlur: (event) => {
      if (event.relatedTarget && stack.element()?.contains(event.relatedTarget)) return;
      stack.hold('focus', false);
    },
  };
}

/**
 * @param {{ entries: object[], hidden: boolean, stack: object, sectionRef: object, tz: string,
 *   maxCards: number, hasBell: boolean, bellButton: () => HTMLElement | null,
 *   onAction: (action: string, entry: object, event: object) => void }} props `stack` is
 *   useStack's `api`, `sectionRef` its section ref.
 */
export default function PreviewStack({
  entries,
  hidden,
  stack,
  sectionRef,
  tz,
  maxCards,
  hasBell,
  bellButton,
  onAction,
}) {
  const [place, setPlace] = useState(null);
  const shown = entries.length > 0;
  const { element, leave, closeAll } = stack;

  // Measured when the stack goes from empty to shown and on resize (not on scroll).
  useLayoutEffect(() => {
    if (!shown) return undefined;
    const measure = () => setPlace(placement(bellButton()));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [shown, bellButton]);

  const onKeyDown = useCallback(
    (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const li = event.target?.closest?.('[data-preview-key]');
      if (li && element()?.contains(li)) leave(li.dataset.previewKey);
      else closeAll();
    },
    [element, leave, closeAll],
  );

  const onFocusIn = useCallback(
    (event) => {
      const target = event.target;
      if (!target?.getBoundingClientRect || element()?.contains(target)) return;
      const box = target.getBoundingClientRect();
      if (!box.width && !box.height) return;
      const cards = element()?.querySelectorAll('[data-preview-key]') ?? [];
      if ([...cards].some((li) => within(box, li.getBoundingClientRect()))) {
        closeAll({ now: true });
      }
    },
    [element, closeAll],
  );

  useEffect(() => {
    if (!shown) return undefined;
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [shown, onKeyDown, onFocusIn]);

  if (!shown) return null;
  const today = workDate(tz);
  return (
    <section
      ref={sectionRef}
      className={styles.stack}
      style={place ?? undefined}
      aria-label="New notifications"
      hidden={hidden}
    >
      <ol className={styles.list} {...listHandlers(stack)}>
        {entries.map((entry) => (
          <li
            key={entry.key}
            ref={(element) => stack.register(entry.key, element)}
            data-preview-key={entry.key}
            className={`${styles.item} ${entry.leaving ? styles.leaving : ''}`}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget && entry.leaving) stack.remove(entry.key);
            }}
          >
            <PreviewCard
              entry={entry}
              tz={tz}
              today={today}
              maxCards={maxCards}
              hasBell={hasBell}
              onAction={(action, event) => onAction(action, entry, event)}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}
