'use client';
// Toasts: short confirmations and errors after an action ("Report submitted"). Mounted once in
// the app shell; any Client Component calls `const toast = useToast()` then
// `toast({ title, body?, tone: 'success' | 'error' })`. A toast with its own controls (the bell's
// Undo) portals into `useToastSlot()`, under these, so the two never cover each other. Since 1.13
// (CONTRACT 28, Motion) a toast that goes fades out first (`data-leaving`, removed on its own
// animationend, with a safety timeout), and the corner sits `--toast-offset` higher while the
// Table's bulk bar shows.
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
import { DUR } from '@/lib/motion/tokens';
import { exitTimeout } from '@/lib/motion/presence';
import styles from './ToastProvider.module.css';

const ToastContext = createContext(null);
const SlotContext = createContext(null);
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

/**
 * Where another toast goes so it stacks with these (bottom right, under them): an element to
 * createPortal into, or null outside a ToastProvider and before it has mounted.
 * @returns {HTMLElement | null}
 */
export function useToastSlot() {
  return useContext(SlotContext);
}

/**
 * The toasts and their clocks: `dismiss` marks one leaving (its fade plays), `remove` takes it
 * off the page.
 */
function useToastList() {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());
  const nextId = useRef(0);

  const remove = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const dismiss = useCallback(
    (id) => {
      clearTimeout(timers.current.get(id));
      setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      timers.current.set(
        id,
        setTimeout(() => remove(id), exitTimeout(DUR.toastOut)),
      );
    },
    [remove],
  );

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

  return { toasts, toast, dismiss, remove };
}

/** One toast; a leaving one is inert and goes when its own fade ends. */
function ToastItem({ item, onDismiss, onGone }) {
  const Icon = item.tone === 'error' ? CircleAlert : CircleCheck;
  return (
    <li
      className={`${styles.toast} ${styles[item.tone] ?? ''}`}
      role={item.tone === 'error' ? 'alert' : undefined}
      data-leaving={item.leaving ? '' : undefined}
      inert={item.leaving || undefined}
      onAnimationEnd={(event) => {
        if (item.leaving && event.target === event.currentTarget) onGone(item.id);
      }}
    >
      <Icon className={styles.icon} size={20} strokeWidth={1.8} aria-hidden="true" />
      <div className={styles.text}>
        <p className={styles.title}>{item.title}</p>
        {item.body ? <p className={styles.body}>{item.body}</p> : null}
      </div>
      <button
        type="button"
        className={styles.close}
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss"
      >
        <X size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </li>
  );
}

/** @param {{ children: import('react').ReactNode }} props */
export function ToastProvider({ children }) {
  const { toasts, toast, dismiss, remove } = useToastList();
  const [slot, setSlot] = useState(null);
  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      <SlotContext.Provider value={slot}>{children}</SlotContext.Provider>
      <div className={styles.region} role="region" aria-label="Updates">
        <ol className={styles.list} aria-live="polite" aria-relevant="additions">
          {toasts.map((t) => (
            <ToastItem key={t.id} item={t} onDismiss={dismiss} onGone={remove} />
          ))}
        </ol>
        <div ref={setSlot} className={styles.slot} />
      </div>
    </ToastContext.Provider>
  );
}

export default ToastProvider;
