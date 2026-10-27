'use client';
// My settings state shared by the sections and the top bar's status (CONTRACT 21): the values
// shown, and change(key, value), which shows the new value at once and saves that one key
// (PATCH /api/me/preferences). A failed save puts the control back and shows a toast. A theme
// change applies to the page at once. Once the saves are done the shell (bell, theme) is
// refreshed from the server.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { applyTheme } from '@/lib/theme';
import { createPreferenceSaver } from './preferenceSaver';
import styles from './page.module.css';

const PreferencesContext = createContext(null);

/** @returns {{ values: Record<string, unknown>, status: 'idle' | 'saving' | 'saved',
 *   change: (key: string, value: unknown) => void }} */
export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('usePreferences() must be used inside <PreferencesProvider>');
  return value;
}

/** @param {{ initial: Record<string, unknown>, children: import('react').ReactNode }} props
 *   initial: preferences.getFor() for the signed-in person */
export default function PreferencesProvider({ initial, children }) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState(initial);
  const [status, setStatus] = useState('idle');
  // The saver lives as long as the page and is made on the first change. Its callbacks use only
  // state setters and this ref, which follows the router and toast.
  const saver = useRef(null);
  const latest = useRef({ router, toast });
  useEffect(() => {
    latest.current = { router, toast };
  }, [router, toast]);

  const change = useCallback(
    (key, next) => {
      setValues((current) => ({ ...current, [key]: next }));
      if (key === 'theme') applyTheme(next);
      saver.current ??= createPreferenceSaver({
        initial,
        send: async (name, value) =>
          (await api.patch('/api/me/preferences', { [name]: value })).data,
        onStatus: setStatus,
        onRevert: (name, value) => {
          setValues((current) => ({ ...current, [name]: value }));
          if (name === 'theme') applyTheme(value);
        },
        onError: (error) =>
          latest.current.toast({
            title: "Couldn't save this setting",
            body: error?.message,
            tone: 'error',
          }),
        onDrained: () => latest.current.router.refresh(),
      });
      saver.current.change(key, next);
    },
    [initial],
  );

  const value = useMemo(() => ({ values, status, change }), [values, status, change]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

/** The top bar's quiet "Saving…" / "Saved" (read out politely, never moves the page). */
export function SaveStatus() {
  const { status } = usePreferences();
  return (
    <p className={styles.status} role="status">
      {status === 'saving' ? 'Saving…' : null}
      {status === 'saved' ? (
        <>
          <Check size={16} strokeWidth={1.8} className={styles.statusIcon} aria-hidden="true" />
          Saved
        </>
      ) : null}
    </p>
  );
}
