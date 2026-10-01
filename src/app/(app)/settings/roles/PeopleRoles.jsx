'use client';
// "People and roles" card: search, and a role picker per person (saved with "Save changes").
import { useRef, useState } from 'react';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import Card, { CardHeader } from '@/components/Card';
import DataTable from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import SearchBox from '@/components/SearchBox';
import Select from '@/components/Select';
import { ROLE_LABELS, ROLES } from '@/lib/permissions';
import { useRoles } from './RolesProvider';
import styles from './page.module.css';

const OPTIONS = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));

function RolePicker({ person }) {
  const { draft, errors, pick, viewerId } = useRoles();
  const value = draft[person.id] ?? person.role;
  const error = errors[person.id];
  const leavingAdmin = person.id === viewerId && person.role === 'admin' && value !== 'admin';
  const id = `role-${person.id}`;
  const note = error ?? (leavingAdmin ? "You'll lose access to Settings and Roles." : null);
  return (
    <div className={styles.picker}>
      <Select
        id={id}
        compact
        value={value}
        options={OPTIONS}
        error={Boolean(error)}
        aria-label={`Role for ${person.name}`}
        aria-describedby={note ? `${id}-note` : undefined}
        onChange={(event) => pick(person.id, event.target.value)}
      />
      {note ? (
        <p
          id={`${id}-note`}
          className={error ? styles.pickerError : styles.pickerNote}
          role={error ? 'alert' : undefined}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}

const COLUMNS = [
  {
    key: 'person',
    header: 'Person',
    width: 239,
    render: (person) => (
      <span className={styles.person}>
        <Avatar user={person} size={34} />
        <span className={styles.personText}>
          <span className={styles.personName}>{person.name}</span>
          <span className={styles.personSub}>{person.designation}</span>
        </span>
      </span>
    ),
  },
  {
    key: 'designation',
    header: 'Designation',
    width: 153,
    hideOnMobile: true,
    render: (p) => <span className={styles.designation}>{p.designation}</span>,
  },
  { key: 'role', header: 'Role', width: 165, render: (person) => <RolePicker person={person} /> },
];

function matches(person, text) {
  const q = text.trim().toLowerCase();
  if (!q) return true;
  return `${person.name} ${person.designation ?? ''} ${person.email ?? ''}`
    .toLowerCase()
    .includes(q);
}

export default function PeopleRoles() {
  const { people } = useRoles();
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);
  const rows = people.filter((person) => matches(person, query));
  return (
    <Card padding="none" className={styles.peopleCard}>
      <CardHeader
        title="People and roles"
        divider
        className={styles.peopleHeader}
        actions={
          <SearchBox
            placeholder="Search people"
            value={query}
            onChange={setQuery}
            maxLength={100}
            ref={searchRef}
            className={styles.search}
          />
        }
      />
      <DataTable
        caption="People and roles"
        columns={COLUMNS}
        rows={rows}
        className={styles.rolesTable}
        empty={
          <EmptyState
            compact
            title={`No one matches "${query.trim()}"`}
            body="Search by name, designation or email."
            action={
              <Button
                variant="secondary"
                size="compact"
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
              >
                Clear search
              </Button>
            }
          />
        }
      />
    </Card>
  );
}
