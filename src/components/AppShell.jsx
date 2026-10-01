'use client';
// The app frame: sidebar on the left, pages in the main area. Below 1024 px the sidebar becomes a
// drawer that the menu button in TopBar opens (through this component's context).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { focusableIn } from './useModal';
import styles from './AppShell.module.css';

const ShellContext = createContext(null);
const SIDEBAR_ID = 'app-sidebar';
const WIDE = '(min-width: 1024px)';

/** { open, openSidebar, closeSidebar, sidebarId } inside the app shell, otherwise null. */
export function useAppShell() {
  return useContext(ShellContext);
}

/**
 * @param {{ sidebar: import('react').ReactNode, children: import('react').ReactNode }} props
 */
export default function AppShell({ sidebar, children }) {
  const [open, setOpen] = useState(false);
  const sidebarRef = useRef(null);
  const openerRef = useRef(null);

  const openSidebar = useCallback(() => {
    openerRef.current = document.activeElement;
    setOpen(true);
  }, []);

  const closeSidebar = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const panel = sidebarRef.current;
    focusableIn(panel)[0]?.focus({ preventScroll: true });
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    const wide = window.matchMedia(WIDE);

    function onKeyDown(event) {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'Tab') return;
      const items = focusableIn(panel);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    function onWide(event) {
      if (event.matches) setOpen(false);
    }

    document.addEventListener('keydown', onKeyDown);
    wide.addEventListener('change', onWide);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      wide.removeEventListener('change', onWide);
      body.style.overflow = previousOverflow;
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected && !window.matchMedia(WIDE).matches) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [open]);

  const value = useMemo(
    () => ({ open, openSidebar, closeSidebar, sidebarId: SIDEBAR_ID }),
    [open, openSidebar, closeSidebar],
  );

  return (
    <ShellContext.Provider value={value}>
      <div className={styles.shell} data-sidebar-open={open ? 'true' : undefined}>
        <a className={styles.skip} href="#main">
          Skip to content
        </a>
        <div
          ref={sidebarRef}
          id={SIDEBAR_ID}
          className={styles.sidebar}
          role={open ? 'dialog' : undefined}
          aria-modal={open ? 'true' : undefined}
          aria-label={open ? 'Menu' : undefined}
        >
          {sidebar}
        </div>
        {open ? <div className={styles.scrim} onClick={closeSidebar} aria-hidden="true" /> : null}
        <main id="main" className={styles.main} tabIndex={-1}>
          {children}
        </main>
      </div>
    </ShellContext.Provider>
  );
}
