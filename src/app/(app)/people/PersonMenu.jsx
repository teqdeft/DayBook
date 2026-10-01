'use client';
// Row menu on the People table (Edit, then Deactivate or Reactivate) and the "Add employee"
// button. Both open the overlays held by PeopleProvider.
import { Plus } from 'lucide-react';
import Button from '@/components/Button';
import Menu from '@/components/Menu';
import { usePeople } from './PeopleProvider';
import styles from './PersonMenu.module.css';

/**
 * @param {{ person: object, locked?: boolean }} props locked: an Admin account the viewer can't
 *   change (only Admins change Admin accounts)
 */
export default function PersonMenu({ person, locked = false }) {
  const { openEdit, askStatus, options } = usePeople();
  const isSelf = person.id === options.viewerId;
  const active = person.status === 'active';
  const items = [
    { label: 'Edit', onSelect: () => openEdit(person), disabled: locked },
    active
      ? {
          label: 'Deactivate',
          tone: 'danger',
          onSelect: () => askStatus(person, 'deactivate'),
          disabled: locked || isSelf,
        }
      : { label: 'Reactivate', onSelect: () => askStatus(person, 'reactivate'), disabled: locked },
  ];
  const note = locked
    ? "Only an Admin can change an Admin's account."
    : isSelf && active
      ? "You can't deactivate yourself."
      : null;
  return (
    <Menu
      label={`Actions for ${person.name}`}
      items={items}
      header={note ? <span className={styles.note}>{note}</span> : undefined}
      width={220}
    />
  );
}

/** "Add employee" (top bar and empty state). */
export function AddEmployeeButton({ children = 'Add employee', ...rest }) {
  const { openAdd } = usePeople();
  return (
    <Button
      icon={<Plus size={18} strokeWidth={1.8} aria-hidden="true" />}
      onClick={openAdd}
      {...rest}
    >
      {children}
    </Button>
  );
}
