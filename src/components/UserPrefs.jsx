'use client';
// The signed-in person's preferences in the browser (CONTRACT 21). AppFrame loads them once per
// request and provides them around the whole app shell, so a client component anywhere inside
// (the bell in every page's TopBar) reads them without its own request. A router.refresh() after
// My settings saves brings the new values.
import { createContext, useContext } from 'react';

const UserPrefsContext = createContext(null);

/**
 * @param {{ prefs: object | null, children: import('react').ReactNode }} props
 *   `prefs` is preferences.getFor's object (or the defaults when it couldn't be read).
 */
export function UserPrefsProvider({ prefs, children }) {
  return <UserPrefsContext.Provider value={prefs}>{children}</UserPrefsContext.Provider>;
}

/** Every preference, or null outside the signed-in app (no provider). */
export function useUserPrefs() {
  return useContext(UserPrefsContext);
}

/** Whether the bell swings for unread notifications: on unless the person turned it off. */
export function useBellRing() {
  return useContext(UserPrefsContext)?.bellRing !== false;
}
