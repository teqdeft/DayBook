// People (artboard 10): department tabs, search, the people table with role labels and status,
// and the Add employee / Edit drawer. HR and Admin.
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import Card from '@/components/Card';
import DataTable from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import FilterPills from '@/components/FilterPills';
import StatusCell from '@/components/StatusCell';
import Tag from '@/components/Tag';
import TopBar from '@/components/TopBar';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/session';
import { addDays, workDate } from '@/lib/time';
import { settings } from '@/modules/settings';
import { users } from '@/modules/users';
import PeopleProvider from './PeopleProvider';
import PeopleSearch from './PeopleSearch';
import PersonMenu, { AddEmployeeButton } from './PersonMenu';
import { ROLE_TONES } from './roleTones';
import styles from './page.module.css';

export const metadata = { title: 'People' };

const PAGE_SIZE = 100;

function readParams(params) {
  const one = (value) => String((Array.isArray(value) ? value[0] : value) ?? '');
  const department = /^\d{1,9}$/.test(one(params.department)) ? one(params.department) : null;
  const q = one(params.q).trim().slice(0, 100);
  const offset = Number.parseInt(one(params.offset), 10);
  return {
    department,
    q,
    offset: Number.isInteger(offset) && offset > 0 ? Math.floor(offset / PAGE_SIZE) * PAGE_SIZE : 0,
  };
}

function peopleHref({ department, q, offset }) {
  const params = new URLSearchParams();
  if (department) params.set('department', department);
  if (q) params.set('q', q);
  if (offset) params.set('offset', String(offset));
  const query = params.toString();
  return query ? `/people?${query}` : '/people';
}

/** For each department, the manager most of its active people report to. */
function suggestedManagers(people, managers) {
  const eligible = new Set(managers.map((m) => m.id));
  const tally = {};
  for (const person of people) {
    if (!eligible.has(person.reportsToId)) continue;
    const counts = (tally[person.departmentId] ??= {});
    counts[person.reportsToId] = (counts[person.reportsToId] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(tally).map(([departmentId, counts]) => [
      departmentId,
      Number(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]),
    ]),
  );
}

/** 'vishal@company.com' can wrap before the '@' on narrow tables, never inside a word. */
function emailText(email) {
  const at = String(email ?? '').lastIndexOf('@');
  if (at <= 0) return email;
  return (
    <>
      {email.slice(0, at)}
      <wbr />
      {email.slice(at)}
    </>
  );
}

function columns(viewer) {
  const lockAdmins = !can(viewer, 'roles.manage');
  return [
    {
      key: 'person',
      header: 'Person',
      width: 288,
      render: (row) => (
        <span className={styles.person}>
          <Avatar user={row} size={34} />
          <span className={styles.personText}>
            <span className={styles.personName}>{row.name}</span>
            <span className={styles.personEmail}>{emailText(row.email)}</span>
          </span>
        </span>
      ),
    },
    { key: 'designation', header: 'Designation', width: 168, render: (row) => row.designation },
    { key: 'department', header: 'Department', width: 136, render: (row) => row.departmentName },
    {
      key: 'role',
      header: 'Role',
      width: 184,
      render: (row) => (
        <Tag tone={ROLE_TONES[row.role]} size="md">
          {row.roleLabel}
        </Tag>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusCell status={row.status} size="pill" />,
    },
    {
      key: 'actions',
      header: <span className="visually-hidden">Actions</span>,
      label: '',
      width: 64,
      align: 'right',
      className: styles.actionsCell,
      render: (row) => <PersonMenu person={row} locked={lockAdmins && row.role === 'admin'} />,
    },
  ];
}

function Empty({ q, department, departmentName }) {
  if (q) {
    return (
      <EmptyState
        title={`No one matches "${q}"`}
        body="Check the spelling, or search by email or designation."
        action={
          <Button variant="secondary" href={peopleHref({ department })}>
            Clear search
          </Button>
        }
      />
    );
  }
  return (
    <EmptyState
      title={departmentName ? `No one in ${departmentName} yet` : 'No one here yet'}
      body="Add someone and they can sign in with Slack."
      action={<AddEmployeeButton variant="secondary" />}
    />
  );
}

export default async function PeoplePage({ searchParams }) {
  const viewer = await requirePage('people.manage');
  const { department, q, offset } = readParams(await searchParams);
  const [result, counts, departments, managers, active, current] = await Promise.all([
    users.list({ user: viewer, department, q, status: 'all', limit: PAGE_SIZE, offset }),
    users.countByStatus(),
    users.listDepartments(),
    users.listManagerOptions(),
    users.listActive(),
    settings.getAll(),
  ]);

  const options = {
    viewerId: viewer.id,
    canChangeRoles: can(viewer, 'roles.manage'),
    departments: departments.map(({ id, name }) => ({ id, name })),
    managers,
    suggestedManagers: suggestedManagers(active, managers),
    companyShift: { start: current.officeStart, end: current.officeEnd },
    defaultJoinedOn: addDays(workDate(current.timezone), 1),
  };
  const pills = [
    { value: 'all', label: `All (${counts.active})`, href: peopleHref({ q }) },
    ...departments.map((d) => ({
      value: String(d.id),
      label: `${d.name} (${d.activeCount})`,
      href: peopleHref({ department: String(d.id), q }),
    })),
  ];
  const selected = departments.find((d) => String(d.id) === department);
  const subtitle =
    counts.deactivated > 0
      ? `${counts.active} active, ${counts.deactivated} deactivated`
      : `${counts.active} active`;
  const shownTo = result.offset + result.rows.length;

  return (
    <PeopleProvider options={options}>
      <TopBar
        title="People"
        subtitle={subtitle}
        actions={
          <>
            <PeopleSearch
              defaultValue={q}
              department={selected ? department : null}
              className={styles.search}
            />
            <AddEmployeeButton />
          </>
        }
      />
      <FilterPills label="Departments" items={pills} value={selected ? department : 'all'} />
      <Card padding="none" className={styles.tableCard}>
        <DataTable
          caption="People"
          columns={columns(viewer)}
          rows={result.rows}
          rowClassName={() => styles.row}
          empty={<Empty q={q} department={department} departmentName={selected?.name} />}
        />
        {result.total > PAGE_SIZE ? (
          <nav className={styles.pager} aria-label="Pages">
            <span className={styles.pagerText}>
              {result.offset + 1}–{shownTo} of {result.total}
            </span>
            <Button
              variant="secondary"
              size="compact"
              href={
                result.offset > 0
                  ? peopleHref({ department, q, offset: result.offset - PAGE_SIZE })
                  : undefined
              }
              disabled={result.offset === 0}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="compact"
              href={
                shownTo < result.total ? peopleHref({ department, q, offset: shownTo }) : undefined
              }
              disabled={shownTo >= result.total}
            >
              Next
            </Button>
          </nav>
        ) : null}
      </Card>
    </PeopleProvider>
  );
}
