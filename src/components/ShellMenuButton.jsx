'use client';
// The menu button that opens the sidebar drawer below 1024 px. Renders nothing outside AppShell.
import { Menu as MenuIcon } from 'lucide-react';
import { useAppShell } from './AppShell';
import styles from './ShellMenuButton.module.css';

export default function ShellMenuButton() {
  const shell = useAppShell();
  if (!shell) return null;
  return (
    <button
      type="button"
      className={styles.button}
      onClick={shell.openSidebar}
      aria-label="Open menu"
      aria-expanded={shell.open}
      aria-controls={shell.sidebarId}
    >
      <MenuIcon size={20} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
