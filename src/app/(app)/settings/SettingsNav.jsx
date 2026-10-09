'use client';
// Settings sub-navigation: jumps to a section and highlights the one in view. "Roles and
// permissions" opens its own page.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import styles from './page.module.css';

export const SECTIONS = [
  { id: 'company', label: 'Company' },
  { id: 'hours', label: 'Office hours and reports' },
  { id: 'check-in', label: 'Check-in' },
  { id: 'slack', label: 'Slack' },
  { id: 'screen-time', label: 'Screen time' },
  { id: 'timers', label: 'Timers and breaks' },
  { id: 'notifications', label: 'Notifications' },
];

// A section counts as current once its top passes this line (px from the top of the window).
const LINE = 140;
// No scroll event for this long: a jump's smooth scroll is over (where scrollend is missing).
const SETTLE_MS = 200;

/** Whether any part of the section is in the window. */
function onScreen(id) {
  const box = document.getElementById(id)?.getBoundingClientRect();
  return Boolean(box) && box.top < window.innerHeight && box.bottom > 0;
}

function currentSection(pinned) {
  // The section someone jumped to stays current, even when the page can't scroll its top up to
  // the line (the last sections), until they scroll themselves.
  if (pinned) return pinned;
  const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
  if (atBottom) return SECTIONS[SECTIONS.length - 1].id;
  let current = SECTIONS[0].id;
  for (const section of SECTIONS) {
    const el = document.getElementById(section.id);
    if (el && el.getBoundingClientRect().top <= LINE) current = section.id;
  }
  return current;
}

export default function SettingsNav() {
  const [active, setActive] = useState(SECTIONS[0].id);
  // { id, settled }: the section jumped to; settled once the jump's own scrolling is over.
  const pinned = useRef(null);

  useEffect(() => {
    let frame = 0;
    let settleTimer = 0;
    function update() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Scrolled away from it some other way (the scrollbar, autoscroll, a script): the pin
        // ends once the section is off screen.
        const pin = pinned.current;
        if (pin?.settled && !onScreen(pin.id)) pinned.current = null;
        setActive(currentSection(pinned.current?.id));
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
    // Opened at #timers (or reloaded there): that section, while it is on screen.
    const linked = window.location.hash.slice(1);
    if (SECTIONS.some((section) => section.id === linked) && onScreen(linked)) {
      pinned.current = { id: linked, settled: false };
    }
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
  }, []);

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
    <nav className={styles.nav} aria-label="Settings sections">
      <ul className={styles.navList}>
        {SECTIONS.map((section) => (
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
        <li>
          <Link href="/settings/roles" className={styles.navItem}>
            Roles and permissions
          </Link>
        </li>
      </ul>
    </nav>
  );
}
