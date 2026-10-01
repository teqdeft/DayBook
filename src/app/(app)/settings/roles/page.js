// Roles and permissions (artboard 13): people per role, a role picker per person, and the
// read-only "What each role can do" table (it mirrors src/lib/permissions.js). Admin only.
import { Check } from 'lucide-react';
import Card, { CardHeader } from '@/components/Card';
import DataTable from '@/components/DataTable';
import Tag from '@/components/Tag';
import TopBar from '@/components/TopBar';
import { PERMISSION_TABLE, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/permissions';
import { requirePage } from '@/lib/session';
import { users } from '@/modules/users';
import { ROLE_TONES } from '../../people/roleTones';
import PeopleRoles from './PeopleRoles';
import RolesProvider, { SaveRolesButton } from './RolesProvider';
import styles from './page.module.css';

export const metadata = { title: 'Roles and permissions' };

const CARD_ORDER = ['admin', 'pm', 'hr', 'employee'];
const TABLE_ROLES = [
  { role: 'employee', header: 'Employee', width: 79.33 },
  { role: 'pm', header: 'PM', width: 79.33 },
  { role: 'hr', header: 'HR', width: 79.33 },
  { role: 'admin', header: 'Admin', width: 91 },
];

function Allowed({ value, role }) {
  if (value === 'optional') return <span className={styles.optional}>Optional</span>;
  if (value) {
    return (
      <Check
        className={styles.check}
        size={18}
        strokeWidth={2.8}
        role="img"
        aria-label={`${ROLE_LABELS[role]}: yes`}
      />
    );
  }
  return <span className={styles.dash} role="img" aria-label={`${ROLE_LABELS[role]}: no`} />;
}

const PERMISSION_COLUMNS = [
  {
    key: 'label',
    header: 'Permission',
    render: (row) => <span className={styles.permissionLabel}>{row.label}</span>,
  },
  ...TABLE_ROLES.map(({ role, header, width }) => ({
    key: role,
    header,
    width,
    align: 'center',
    className: role === 'admin' ? styles.lastRole : undefined,
    render: (row) => <Allowed value={row.roles[role]} role={role} />,
  })),
];

export default async function RolesPage() {
  const viewer = await requirePage('roles.manage');
  const [counts, people] = await Promise.all([users.countActiveByRole(), users.listActive()]);
  const rows = people.map((person) => ({
    id: person.id,
    name: person.name,
    email: person.email,
    designation: person.designation,
    role: person.role,
    status: person.status,
    initials: person.initials,
    avatarUrl: person.avatarUrl,
  }));

  return (
    <RolesProvider people={rows} viewerId={viewer.id}>
      <TopBar
        title="Roles and permissions"
        subtitle="Only Admin can change roles"
        actions={<SaveRolesButton />}
      />
      <ul className={styles.roleCards} aria-label="People per role">
        {CARD_ORDER.map((role) => (
          <li key={role}>
            <Card className={styles.roleCard}>
              <div className={styles.roleTop}>
                <Tag tone={ROLE_TONES[role]} size="lg">
                  {ROLE_LABELS[role]}
                </Tag>
                <span className={styles.count}>
                  {counts[role]}
                  <span className="visually-hidden"> active</span>
                </span>
              </div>
              <p className={styles.roleText}>{ROLE_DESCRIPTIONS[role]}</p>
            </Card>
          </li>
        ))}
      </ul>
      <div className={styles.bottom}>
        <PeopleRoles />
        <Card padding="none" className={styles.permissionsCard}>
          <CardHeader title="What each role can do" divider />
          <DataTable
            caption="What each role can do"
            columns={PERMISSION_COLUMNS}
            rows={PERMISSION_TABLE}
            rowKey="label"
            className={styles.permissionsTable}
          />
        </Card>
      </div>
    </RolesProvider>
  );
}
