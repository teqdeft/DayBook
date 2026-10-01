'use client';
// Role changes on the Roles screen: the picks not saved yet, per-person errors, and the top bar's
// "Save changes" (one PATCH /api/users/:id/role per changed person).
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';
import { useUnsavedChangesWarning } from '@/components/useUnsavedChangesWarning';
import { api } from '@/lib/apiClient';
import styles from './page.module.css';

const RolesContext = createContext(null);

/** @returns {{ people: object[], draft: Record<number, string>, errors: Record<number, string>,
 *   saving: boolean, dirty: boolean, viewerId: number, pick: (id: number, role: string) => void,
 *   save: () => Promise<void> }} */
export function useRoles() {
  const value = useContext(RolesContext);
  if (!value) throw new Error('useRoles() must be used inside <RolesProvider>');
  return value;
}

/**
 * Promotions to Admin first and demotions from Admin last, so "keep one Admin" holds midway. The
 * viewer's own demotion goes very last: if only one Admin can stay, it is the one saving.
 */
function saveOrder(changes, people, viewerId) {
  const rank = (change) => {
    const before = people.find((p) => p.id === change.id)?.role;
    if (change.role === 'admin') return 0;
    if (before !== 'admin') return 1;
    return change.id === viewerId ? 3 : 2;
  };
  return [...changes].sort((a, b) => rank(a) - rank(b));
}

/**
 * @param {{ people: Array<{ id: number, name: string, role: string }>, viewerId: number,
 *   children: import('react').ReactNode }} props
 */
export default function RolesProvider({ people, viewerId, children }) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const changes = useMemo(
    () =>
      people
        .filter((person) => draft[person.id] && draft[person.id] !== person.role)
        .map((person) => ({ id: person.id, name: person.name, role: draft[person.id] })),
    [people, draft],
  );
  const dirty = changes.length > 0;

  // Asks before leaving with unsaved changes: reloads, closing the tab and in-app links.
  useUnsavedChangesWarning(dirty);

  const pick = useCallback((id, role) => {
    setDraft((current) => ({ ...current, [id]: role }));
    setErrors((current) => (current[id] ? { ...current, [id]: undefined } : current));
  }, []);

  const save = useCallback(async () => {
    if (saving) return;
    if (!dirty) {
      toast({ title: 'No changes to save', body: 'Pick a new role for someone first.' });
      return;
    }
    setSaving(true);
    const failed = {};
    let saved = 0;
    let demotedSelf = false;
    for (const change of saveOrder(changes, people, viewerId)) {
      try {
        await api.patch(`/api/users/${change.id}/role`, { role: change.role });
        saved += 1;
        if (change.id === viewerId && change.role !== 'admin') demotedSelf = true;
      } catch (error) {
        failed[change.id] = error.fields?.role ?? error.message;
      }
    }
    // Saved picks stay in the draft: they match the refreshed roles, so nothing is left dirty and
    // the selects don't flash back to the old role while the page refreshes.
    setErrors(failed);
    setSaving(false);
    if (Object.keys(failed).length === 0) {
      toast({
        title: 'Roles saved',
        body: saved === 1 ? '1 person has a new role.' : `${saved} people have new roles.`,
      });
    } else {
      toast({
        title: saved > 0 ? 'Some roles were not saved' : "Couldn't save roles",
        body: Object.values(failed)[0],
        tone: 'error',
      });
    }
    if (demotedSelf) router.replace('/');
    else router.refresh();
  }, [saving, dirty, changes, people, viewerId, router, toast]);

  const value = useMemo(
    () => ({ people, draft, errors, saving, dirty, viewerId, pick, save }),
    [people, draft, errors, saving, dirty, viewerId, pick, save],
  );
  return (
    <RolesContext.Provider value={value}>
      {children}
      {dirty ? (
        <>
          <div className={styles.mobileSaveSpace} aria-hidden="true" />
          <div className={styles.mobileSave}>
            <span className={styles.unsaved}>Unsaved changes</span>
            <Button size="compact" onClick={save} loading={saving}>
              Save changes
            </Button>
          </div>
        </>
      ) : null}
    </RolesContext.Provider>
  );
}

/** The top bar's "Save changes". */
export function SaveRolesButton() {
  const { saving, dirty, save } = useRoles();
  return (
    <>
      <span className={styles.unsaved} role="status">
        {dirty ? 'Unsaved changes' : ''}
      </span>
      <Button onClick={save} loading={saving}>
        Save changes
      </Button>
    </>
  );
}
