'use client';
// Toasts: short confirmations and errors after an action ("Report submitted"). Mounted once in
// the app shell; any Client Component calls `const toast = useToast()` then
// `toast({ title, body?, tone: 'success' | 'error' })`.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CircleAlert, CircleCheck, X } from 'lucide-react';
import styles from './ToastProvider.module.css';

const ToastContext = createContext(null);
const DURATION = { success: 5000, error: 8000 };
const MAX_VISIBLE = 4;

function warnMissingProvider() {
  if (process.env.NODE_ENV !== 'production') {
    console.warn('useToast() was called outside <ToastProvider>; the toast was not shown.');
  }
}

/** @returns {(toast: { title: string, body?: string, tone?: 'success' | 'error' }) => void} */
export function useToast() {
  return useContext(ToastContext) ?? warnMissingProvider;
}

/** @param {{ children: import('react').ReactNode }} props */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());
  const nextId = useRef(0);

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    ({ title, body, tone = 'success' }) => {
      nextId.current += 1;
      const id = nextId.current;
      setToasts((list) => [...list, { id, title, body, tone }].slice(-MAX_VISIBLE));
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATION[tone] ?? DURATION.success),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((timer) => clearTimeout(timer));
      map.clear();
    };
  }, []);

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.region} role="region" aria-label="Updates">
        <ol className={styles.list} aria-live="polite" aria-relevant="additions">
          {toasts.map((t) => (
            <li
              key={t.id}
              className={`${styles.toast} ${styles[t.tone] ?? ''}`}
              role={t.tone === 'error' ? 'alert' : undefined}
            >
              {t.tone === 'error' ? (
                <CircleAlert
                  className={styles.icon}
                  size={20}
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              ) : (
                <CircleCheck
                  className={styles.icon}
                  size={20}
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              )}
              <div className={styles.text}>
                <p className={styles.title}>{t.title}</p>
                {t.body ? <p className={styles.body}>{t.body}</p> : null}
              </div>
              <button
                type="button"
                className={styles.close}
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
              >
                <X size={16} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      </div>
    </ToastContext.Provider>
  );
}

export default ToastProvider;
