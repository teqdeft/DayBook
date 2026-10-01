'use client';
// The signed-in person's menu: at the bottom of the sidebar (avatar, name, designation) and as the
// avatar circle in the top bar. Both offer "Sign out", which also stops desktop notifications in
// this browser (CONTRACT 14).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { api } from '@/lib/apiClient';
import Avatar from './Avatar';
import Menu from './Menu';
import { removeOnSignOut } from './NotificationBell.push';
import { useToast } from './ToastProvider';
import styles from './UserMenu.module.css';

// The top bar circle sets its initials at 14 px (the sidebar's 38 px circle uses Avatar's 13 px).
const TOP_BAR_INITIALS = { fontSize: '14px' };

/**
 * @param {{
 *   user: { name: string, email?: string, designation?: string, initials?: string, role?: string,
 *     avatarUrl?: string | null },
 *   variant?: 'sidebar' | 'avatar',
 * }} props
 */
export default function UserMenu({ user, variant = 'sidebar' }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const face = { name: user.name, initials: user.initials, avatarUrl: user.avatarUrl };

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      // Best effort and short: signing out never waits on the push service.
      await removeOnSignOut();
      await api.post('/api/auth/logout');
      router.replace('/login');
      router.refresh();
    } catch (error) {
      setBusy(false);
      toast({ title: "Couldn't sign out", body: error.message, tone: 'error' });
    }
  }

  const header = (
    <div className={styles.header}>
      <span className={styles.headerName}>{user.name}</span>
      {user.email ? <span className={styles.headerEmail}>{user.email}</span> : null}
    </div>
  );
  const items = [
    {
      label: busy ? 'Signing out…' : 'Sign out',
      icon: <LogOut size={16} strokeWidth={1.8} aria-hidden="true" />,
      onSelect: signOut,
      disabled: busy,
    },
  ];

  if (variant === 'avatar') {
    return (
      <Menu
        label={`Account menu for ${user.name}`}
        items={items}
        header={header}
        width={220}
        triggerClassName={styles.avatarButton}
      >
        <Avatar
          user={face}
          size={44}
          tone={user.role === 'admin' ? 'ink' : 'navy'}
          style={TOP_BAR_INITIALS}
        />
      </Menu>
    );
  }

  return (
    <Menu
      label={`Account menu for ${user.name}`}
      items={items}
      header={header}
      placement="top"
      align="start"
      width={212}
      className={styles.sidebarMenu}
      triggerClassName={styles.personButton}
    >
      <Avatar user={face} size={38} tone="navy" />
      <span className={styles.personText} aria-hidden="true">
        <span className={styles.name}>{user.name}</span>
        {user.designation ? <span className={styles.designation}>{user.designation}</span> : null}
      </span>
    </Menu>
  );
}
