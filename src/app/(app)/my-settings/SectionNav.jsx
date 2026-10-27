'use client';
// My settings' section list (CONTRACT 21), built like Settings': jumps to a section and
// highlights the one in view. Only the sections this person sees are listed.
import { useEffect, useRef, useState } from 'react';
import styles from './page.module.css';

// A section counts as current once its top passes this line (px from the top of the window).
const LINE = 140;
// No scroll event for this long: a jump's smooth scroll is over (where scrollend is missing).
const SETTLE_MS = 200;

/** Whether any part of the section is in the window. */
function onScreen(id) {
  const box = document.getElementById(id)?.getBoundingClientRect();
  return Boolean(box) && box.top < window.innerHeight && box.bottom > 0;
}

/**
 * The section in view: the one jumped to, the last one once a page that scrolls is at its
 * bottom, else the last one passed (a page too short to scroll starts at its first section).
 */
function currentSection(ids, pinned) {
  if (pinned) return pinned;
  const { scrollHeight } = document.documentElement;
  const scrolls = scrollHeight > window.innerHeight + 2;
  if (scrolls && window.innerHeight + window.scrollY >= scrollHeight - 2)
    return ids[ids.length - 1];
  let current = ids[0];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && el.getBoundingClientRect().top <= LINE) current = id;
  }
  return current;
}

/** @param {{ sections: { id: string, label: string }[] }} props */
export default function SectionNav({ sections }) {
  const ids = sections.map((section) => section.id);
  const key = ids.join(' ');
  const [active, setActive] = useState(ids[0]);
  // { id, settled }: the section jumped to; settled once the jump's own scrolling is over.
  const pinned = useRef(null);

  useEffect(() => {
    const list = key.split(' ');
    let frame = 0;
    let settleTimer = 0;
    function update() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Scrolled away some other way (the scrollbar, a script): the pin ends off screen.
        const pin = pinned.current;
        if (pin?.settled && !onScreen(pin.id)) pinned.current = null;
        setActive(currentSection(list, pinned.current?.id));
      });
    }
    function settle() {
      clearTimeout(settleTimer);
      if (pinned.current) pinned.current.settled = true;
      update();
    }
    function onScroll() {
      update();
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, SETTLE_MS);
    }
    // Scrolling by hand (wheel, touch, keys) ends a jump's pin.
    function unpin() {
      pinned.current = null;
    }
    const linked = window.location.hash.slice(1);
    if (list.includes(linked) && onScreen(linked)) pinned.current = { id: linked, settled: false };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scrollend', settle);
    window.addEventListener('resize', update);
    window.addEventListener('wheel', unpin, { passive: true });
    window.addEventListener('touchmove', unpin, { passive: true });
    window.addEventListener('keydown', unpin);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settleTimer);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('scrollend', settle);
      window.removeEventListener('resize', update);
      window.removeEventListener('wheel', unpin);
      window.removeEventListener('touchmove', unpin);
      window.removeEventListener('keydown', unpin);
    };
  }, [key]);

  function jump(event, id) {
    const el = document.getElementById(id);
    if (!el) return;
    event.preventDefault();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    window.history.replaceState(null, '', `#${id}`);
    pinned.current = { id, settled: false };
    setActive(id);
    el.focus({ preventScroll: true });
  }

  return (
    <nav className={styles.nav} aria-label="My settings sections">
      <ul className={styles.navList}>
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className={`${styles.navItem} ${active === section.id ? styles.navActive : ''}`}
              aria-current={active === section.id ? 'true' : undefined}
              onClick={(event) => jump(event, section.id)}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
