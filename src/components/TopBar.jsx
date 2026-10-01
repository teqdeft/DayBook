// Page header, the first block of every page: optional breadcrumb, the page title (30 px bold)
// and subtitle on the left; page actions, search, the notification bell and the avatar on the
// right. Below 1024 px a menu button opens the sidebar and the actions wrap under the title.
// Async Server Component (reads the session for the bell and avatar). Every page renders it, so it
// also asks the browser to re-issue an out-of-date session cookie (SessionRefresh).
import { can } from '@/lib/permissions';
import { getSessionUser } from '@/lib/session';
import { logger } from '@/lib/logger';
import { notifications } from '@/modules/notifications';
import { push } from '@/modules/push';
import { settings } from '@/modules/settings';
import Breadcrumb from './Breadcrumb';
import GlobalSearch from './GlobalSearch';
import NotificationBell from './NotificationBell';
import SessionRefresh from './SessionRefresh';
import ShellMenuButton from './ShellMenuButton';
import UserMenu from './UserMenu';
import styles from './TopBar.module.css';

/**
 * @param {{
 *   title: import('react').ReactNode, subtitle?: import('react').ReactNode,
 *   breadcrumb?: { label: string, href?: string }[], actions?: import('react').ReactNode,
 *   bell?: boolean, avatar?: boolean, search?: { placeholder: string, width?: number },
 *   className?: string,
 * }} props
 */
export default async function TopBar({
  title,
  subtitle,
  breadcrumb,
  actions,
  bell = false,
  avatar = false,
  search,
  className = '',
}) {
  const user = await getSessionUser();
  const [unread, timezone, desktop] = user && bell ? await bellData(user) : [0, undefined, null];

  return (
    <header className={`${styles.topbar} ${className}`}>
      {user?.sessionCookieStale ? <SessionRefresh /> : null}
      <div className={styles.lead}>
        <ShellMenuButton />
        <div className={styles.heading}>
          {breadcrumb?.length ? <Breadcrumb items={breadcrumb} className={styles.crumbs} /> : null}
          <h1 className={styles.title}>{title}</h1>
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        </div>
      </div>
      {actions || (user && (search || bell || avatar)) ? (
        <div className={styles.actions}>
          {actions}
          {search && user ? (
            <GlobalSearch
              placeholder={search.placeholder}
              width={search.width}
              scope={{
                people: can(user, 'team.view')
                  ? 'team'
                  : can(user, 'people.manage')
                    ? 'people'
                    : null,
                projects: can(user, 'project.request') || can(user, 'project.manage'),
              }}
            />
          ) : null}
          {bell && user ? (
            <NotificationBell initialUnread={unread} tz={timezone} push={desktop} />
          ) : null}
          {avatar && user ? (
            <UserMenu
              variant="avatar"
              user={{
                name: user.name,
                email: user.email,
                initials: user.initials,
                avatarUrl: user.avatarUrl,
                role: user.role,
              }}
            />
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

/**
 * The unread count, the company time zone and, while desktop notifications are on for the
 * company (CONTRACT 14), what the bell's "Show on this computer" needs: the VAPID public key
 * (never the private one) and who is signed in.
 */
async function bellData(user) {
  try {
    const [count, all] = await Promise.all([notifications.unreadCount(user.id), settings.getAll()]);
    const publicKey = all?.pushEnabled === true ? push.publicKey() : null;
    return [Number(count) || 0, all?.timezone, publicKey ? { publicKey, userId: user.id } : null];
  } catch (error) {
    logger.warn({ err: error, userId: user.id }, 'top bar: could not load the unread count');
    return [0, undefined, null];
  }
}
