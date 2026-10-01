'use client';
// The navy sidebar: logo, workspace box, nav items (from config/navigation.js, with count badges)
// and the signed-in person with a menu (Sign out). The active item follows the current path.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { activeNavHref } from '@/config/navigation';
import Logo from './Logo';
import UserMenu from './UserMenu';
import { NavIcon } from './NavIcon';
import { useAppShell } from './AppShell';
import styles from './Sidebar.module.css';

/**
 * @param {{
 *   items: { key: string, label: string, href: string, icon: string, matches?: string[],
 *     badge?: number }[],
 *   companyName?: string, homeHref?: string,
 *   user: { name: string, email?: string, designation?: string, initials?: string, roleLabel?: string },
 *   className?: string,
 * }} props
 */
export default function Sidebar({ items = [], companyName, homeHref = '/', user, className = '' }) {
  const pathname = usePathname() ?? '';
  const shell = useAppShell();
  const activeHref = activeNavHref(items, pathname);
  const closeDrawer = () => shell?.closeSidebar();

  return (
    <div className={`${styles.sidebar} ${className}`}>
      <Link
        href={homeHref}
        className={styles.brand}
        onClick={closeDrawer}
        aria-label="Daybook home"
      >
        <Logo />
      </Link>

      <div className={styles.workspace}>
        <div className={styles.workspaceText}>
          <span className={styles.workspaceLabel}>Workspace</span>
          <span className={styles.workspaceName}>{companyName || 'Daybook'}</span>
        </div>
        <ChevronDown className={styles.chevron} size={18} strokeWidth={1.8} aria-hidden="true" />
      </div>

      <nav className={styles.nav} aria-label="Main">
        <ul className={styles.list}>
          {items.map((item) => {
            const active = item.href === activeHref;
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className={`${styles.item} ${active ? styles.active : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={closeDrawer}
                >
                  <NavIcon name={item.icon} className={styles.icon} />
                  <span className={styles.label}>{item.label}</span>
                  {item.badge > 0 ? (
                    <span className={styles.badge}>
                      {item.badge > 99 ? '99+' : item.badge}
                      <span className="visually-hidden"> waiting</span>
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className={styles.person}>
        <UserMenu user={user} variant="sidebar" />
      </div>
    </div>
  );
}
