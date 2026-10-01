'use client';
// Settings sub-navigation: jumps to a section and highlights the one in view. "Roles and
// permissions" opens its own page.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './page.module.css';

export const SECTIONS = [
  { id: 'company', label: 'Company' },
  { id: 'hours', label: 'Office hours and reports' },
  { id: 'check-in', label: 'Check-in' },
  { id: 'slack', label: 'Slack' },
  { id: 'screen-time', label: 'Screen time' },
  { id: 'notifications', label: 'Notifications' },
];

// A section counts as current once its top passes this line (px from the top of the window).
const LINE = 140;

function currentSection() {
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

  useEffect(() => {
    let frame = 0;
    function update() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActive(currentSection()));
    }
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  function jump(event, id) {
    const el = document.getElementById(id);
    if (!el) return;
    event.preventDefault();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    window.history.replaceState(null, '', `#${id}`);
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
