'use client';
// Holds the People screen's overlays: the Add / Edit drawer and the Deactivate / Reactivate
// confirmation. The top bar button, the empty state and each row menu open them through
// usePeople(), so there is one drawer for the whole table.
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import PersonDrawer from './PersonDrawer';
import StatusDialog from './StatusDialog';

const PeopleContext = createContext(null);

/** @returns {{ openAdd: () => void, openEdit: (person: object) => void,
 *   askStatus: (person: object, action: 'deactivate' | 'reactivate') => void, options: object }} */
export function usePeople() {
  const value = useContext(PeopleContext);
  if (!value) throw new Error('usePeople() must be used inside <PeopleProvider>');
  return value;
}

/**
 * @param {{ options: { viewerId: number, canChangeRoles: boolean,
 *   departments: Array<{ id: number, name: string }>,
 *   managers: Array<{ id: number, name: string, role: string }>,
 *   suggestedManagers: Record<string, number>, companyShift: { start: string, end: string },
 *   defaultJoinedOn: string }, children: import('react').ReactNode }} props
 */
export default function PeopleProvider({ options, children }) {
  const [drawer, setDrawer] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const opened = useRef(0);

  const openAdd = useCallback(() => {
    opened.current += 1;
    setDrawer({ key: opened.current, person: null });
  }, []);

  const openEdit = useCallback((person) => {
    opened.current += 1;
    setDrawer({ key: opened.current, person });
  }, []);

  const askStatus = useCallback((person, action) => {
    opened.current += 1;
    setConfirm({ key: opened.current, person, action });
  }, []);

  const value = useMemo(
    () => ({ openAdd, openEdit, askStatus, options }),
    [openAdd, openEdit, askStatus, options],
  );

  return (
    <PeopleContext.Provider value={value}>
      {children}
      {drawer ? (
        <PersonDrawer
          key={drawer.key}
          person={drawer.person}
          options={options}
          onClose={() => setDrawer(null)}
        />
      ) : null}
      {confirm ? (
        <StatusDialog
          key={confirm.key}
          person={confirm.person}
          action={confirm.action}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </PeopleContext.Provider>
  );
}
