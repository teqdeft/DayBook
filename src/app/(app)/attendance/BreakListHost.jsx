'use client';
// Holds the break list for a table whose rows can go away (CONTRACT 25, item 2). On Attendance's
// On break filter, ending or deleting the open break takes the row out with the refresh, and with
// it the Present cell that opened the list. So the dialog lives here, outside the rows, and keeps
// the answer and its "Break changed" status. When the dialog has closed and the refresh has
// landed, focus is back on the cell (useModal), or on `returnTo` when that row went away.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useRouter } from 'next/navigation';
import BreakListDialog from './BreakListDialog';

const BreakListContext = createContext(null);

/** `{ show(row) }` inside a BreakListHost; null outside one (BreaksButton keeps its own dialog). */
export function useBreakListHost() {
  return useContext(BreakListContext);
}

/**
 * @param {{ returnTo: string, children: import('react').ReactNode }} props returnTo: the id of a
 *   focusable element that stays (the card's title)
 */
export default function BreakListHost({ returnTo, children }) {
  const router = useRouter();
  const [shown, setShown] = useState(null);
  const [refreshing, startRefresh] = useTransition();
  const closed = useRef(false);

  const show = useCallback(
    (row) => setShown({ attendanceId: row.attendanceId, personName: row.user?.name }),
    [],
  );
  const value = useMemo(() => ({ show }), [show]);
  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router]);

  useEffect(() => {
    if (shown || refreshing || !closed.current) return;
    closed.current = false;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    document.getElementById(returnTo)?.focus({ preventScroll: true });
  }, [shown, refreshing, returnTo]);

  return (
    <BreakListContext.Provider value={value}>
      {children}
      {shown ? (
        <BreakListDialog
          key={shown.attendanceId}
          attendanceId={shown.attendanceId}
          personName={shown.personName}
          open
          onClose={() => {
            closed.current = true;
            setShown(null);
          }}
          onSaved={refresh}
        />
      ) : null}
    </BreakListContext.Provider>
  );
}
