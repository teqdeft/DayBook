import { notFound } from 'next/navigation';
import { Bell, Inbox, Plus } from 'lucide-react';
import { env } from '@/lib/env';
import Avatar, { AvatarStack } from '@/components/Avatar';
import Badge from '@/components/Badge';
import Breadcrumb from '@/components/Breadcrumb';
import Button from '@/components/Button';
import Card, { CardHeader } from '@/components/Card';
import DateSwitcher from '@/components/DateSwitcher';
import DayToggleGroup from '@/components/DayToggleGroup';
import EmptyState from '@/components/EmptyState';
import Field from '@/components/Field';
import FilterPills from '@/components/FilterPills';
import IconButton from '@/components/IconButton';
import Input from '@/components/Input';
import Kpi from '@/components/Kpi';
import Legend from '@/components/Legend';
import PersonChip from '@/components/PersonChip';
import PriorityTag, { PRIORITIES } from '@/components/PriorityTag';
import ProgressBar from '@/components/ProgressBar';
import ProjectLabel from '@/components/ProjectLabel';
import ProjectSquare from '@/components/ProjectSquare';
import SearchBox from '@/components/SearchBox';
import Segmented from '@/components/Segmented';
import Select from '@/components/Select';
import Skeleton from '@/components/Skeleton';
import StatTile from '@/components/StatTile';
import StatusCell, { STATUS_LABELS } from '@/components/StatusCell';
import Tag from '@/components/Tag';
import Textarea from '@/components/Textarea';
import Toggle from '@/components/Toggle';
import {
  DaysDemo,
  FilterPillsDemo,
  PeopleDemo,
  SearchDemo,
  SegmentedDemo,
  ToggleDemo,
} from './Demos';
import styles from './page.module.css';

export const metadata = { title: 'UI kit' };

const ICON = { size: 18, strokeWidth: 1.8 };

const P = {
  iwill: { name: 'iwilltillimwell', color: 'orange' },
  internal: { name: 'internal-tool', color: 'blue' },
  acme: { name: 'acme-store', color: 'green' },
  seo: { name: 'acme-seo', color: 'violet' },
  proposals: { name: 'Proposals', color: 'teal' },
  hiring: { name: 'Hiring', color: 'pink' },
};

const U = {
  vs: { name: 'Vishal Saini', initials: 'VS' },
  km: { name: 'Karan Mehta', initials: 'KM' },
  ar: { name: 'Ankit Rana', initials: 'AR' },
  pm: { name: '[PM name]', initials: 'PM', role: 'pm' },
  ce: { name: '[CEO name]', initials: 'CE', role: 'admin' },
  dj: { name: 'Deepak Joshi', initials: 'DJ' },
  sk: { name: 'Simran Kaur', initials: 'SK' },
  rv: { name: 'Rohit Verma', initials: 'RV' },
  ps: { name: 'Priya Sharma', initials: 'PS' },
  tb: { name: 'Tarun Bansal', initials: 'TB', status: 'deactivated' },
};

/** One specimen: 10 px padding on the artboard's background, so it can be compared 1:1. */
function Spec({ id, bg = 'surface', width, children }) {
  return (
    <figure className={styles.figure}>
      <div data-spec={id} className={[styles.spec, styles[bg]].join(' ')}>
        <div className={styles.specInner} style={width ? { width: `${width}px` } : undefined}>
          {children}
        </div>
      </div>
      <figcaption className={styles.caption}>{id}</figcaption>
    </figure>
  );
}

function Section({ title, children }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.row}>{children}</div>
    </section>
  );
}

export default function UiKitPage() {
  if (env.isProduction) notFound();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.pageTitle}>UI kit</h1>
        <p className={styles.pageSubtitle}>
          Every primitive in src/components, on the artboard backgrounds. Dev only.
        </p>
      </header>

      <Section title="Button">
        <Spec id="btn-primary-save" bg="paper">
          <Button>Save changes</Button>
        </Spec>
        <Spec id="btn-primary-large" bg="paper">
          <Button size="large">Submit report</Button>
        </Spec>
        <Spec id="btn-primary-icon" bg="paper">
          <Button icon={<Plus {...ICON} />}>Request a project</Button>
        </Spec>
        <Spec id="btn-secondary-checkout" bg="paper">
          <Button variant="secondary">Check out</Button>
        </Spec>
        <Spec id="btn-secondary-download" bg="paper">
          <Button variant="secondary">Download Excel</Button>
        </Spec>
        <Spec id="btn-secondary-icon" bg="surface">
          <Button variant="secondary" icon={<Plus {...ICON} />}>
            Request a project
          </Button>
        </Spec>
        <Spec id="btn-compact-pair" bg="surface">
          <div className={styles.inline}>
            <Button variant="secondary" size="medium">
              Decline
            </Button>
            <Button size="medium">Approve edit</Button>
          </div>
        </Spec>
        <Spec id="btn-medium-approve" bg="surface">
          <Button size="medium">Approve edit</Button>
        </Spec>
        <Spec id="btn-small-fix" bg="surface">
          <Button variant="secondary" size="small">
            Fix
          </Button>
        </Spec>
        <Spec id="btn-secondary-compact-icon" bg="surface">
          <Button variant="secondary" size="compact" icon={<Plus {...ICON} />}>
            Add network
          </Button>
        </Spec>
        <Spec id="btn-marigold-xl" bg="navy">
          <Button variant="marigold" size="xl">
            Write today&apos;s report
          </Button>
        </Spec>
        <Spec id="btn-danger-small" bg="muted">
          <Button variant="danger" size="small">
            Disconnect
          </Button>
        </Spec>
        <Spec id="btn-fullwidth" bg="surface" width={323}>
          <Button variant="secondary" fullWidth>
            Request an edit
          </Button>
        </Spec>
        <Spec id="btn-dark" bg="surface">
          <Button variant="dark">Dark button</Button>
        </Spec>
        <Spec id="btn-states" bg="surface">
          <div className={styles.inline}>
            <Button loading>Saving</Button>
            <Button variant="secondary" disabled>
              Disabled
            </Button>
            <Button href="/dev/ui" variant="secondary">
              Link button
            </Button>
          </div>
        </Spec>
        <Spec id="btn-text" bg="surface">
          <div className={styles.inline}>
            <Button variant="text">Edit</Button>
            <Button variant="text">Confirm</Button>
            <Button variant="text">Remove</Button>
            <Button variant="text">Edit report</Button>
            <Button variant="text" href="/dev/ui">
              Back to today
            </Button>
            <Button variant="text" icon={<Plus {...ICON} />}>
              Add people
            </Button>
          </div>
        </Spec>
        <Spec id="text-edit" bg="surface">
          <Button variant="text">Edit</Button>
        </Spec>
        <Spec id="text-confirm" bg="surface">
          <Button variant="text">Confirm</Button>
        </Spec>
        <Spec id="text-review" bg="surface">
          <Button variant="text" size="compact">
            Review
          </Button>
        </Spec>
        <Spec id="text-show-more" bg="surface">
          <Button variant="text" size="compact">
            Show 17 more
          </Button>
        </Spec>
        <Spec id="icon-bell" bg="paper">
          <IconButton label="Notifications" icon={<Bell {...ICON} />} dot />
        </Spec>
        <Spec id="icon-bell-plain" bg="paper">
          <div className={styles.inline}>
            <IconButton label="Notifications" icon={<Bell {...ICON} />} />
            <IconButton label="Inbox" variant="ghost" icon={<Inbox {...ICON} />} />
          </div>
        </Spec>
      </Section>

      <Section title="Tag and Badge">
        <Spec id="tag-report-due">
          <Tag tone="marigold" size="xl">
            Report due in 3h 20m
          </Tag>
        </Spec>
        <Spec id="tag-urgent-solid-lg" bg="urgent">
          <Tag tone="marigold" size="lg" solid padX={12}>
            Urgent
          </Tag>
        </Spec>
        <Spec id="tag-urgent-solid-md">
          <Tag tone="marigold" size="md" solid>
            Urgent
          </Tag>
        </Spec>
        <Spec id="tag-today">
          <Tag tone="blue">Today</Tag>
        </Spec>
        <Spec id="tag-wfh">
          <Tag tone="violet">WFH</Tag>
        </Spec>
        <Spec id="tag-late">
          <Tag tone="marigold" padX={8}>
            Late 38m
          </Tag>
        </Spec>
        <Spec id="tag-late-11">
          <Tag tone="marigold" padX={8}>
            Late 11m
          </Tag>
        </Spec>
        <Spec id="tag-carried">
          <Tag tone="neutral" size="md">
            Carried over
          </Tag>
        </Spec>
        <Spec id="tag-report-edit">
          <Tag tone="primary" size="md">
            Report edit
          </Tag>
        </Spec>
        <Spec id="tag-new-project">
          <Tag tone="teal" size="md">
            New project
          </Tag>
        </Spec>
        <Spec id="tag-inprogress6" bg="muted">
          <Tag tone="marigold" size="lg">
            In progress 6 days
          </Tag>
        </Spec>
        <Spec id="tag-inprogress3" bg="muted">
          <Tag tone="neutral" size="lg">
            In progress 3 days
          </Tag>
        </Spec>
        <Spec id="tag-role-admin">
          <Tag tone="ink" size="lg">
            Admin
          </Tag>
        </Spec>
        <Spec id="tag-role-pm">
          <Tag tone="primary" size="lg">
            Project manager
          </Tag>
        </Spec>
        <Spec id="tag-role-hr">
          <Tag tone="pink" size="lg">
            HR
          </Tag>
        </Spec>
        <Spec id="tag-role-employee">
          <Tag tone="grey" size="lg">
            Employee
          </Tag>
        </Spec>
        <Spec id="tag-roles-md">
          <div className={styles.inline}>
            <Tag tone="grey" size="md">
              Employee
            </Tag>
            <Tag tone="primary" size="md">
              Project manager
            </Tag>
            <Tag tone="pink" size="md">
              HR
            </Tag>
            <Tag tone="ink" size="md">
              Admin
            </Tag>
          </div>
        </Spec>
        <Spec id="tag-in-office" bg="paper">
          <Tag tone="green" size="xxl" dot>
            In office since 9:32
          </Tag>
        </Spec>
        <Spec id="tag-tones">
          <div className={styles.inline}>
            {[
              'primary',
              'blue',
              'marigold',
              'green',
              'red',
              'violet',
              'teal',
              'orange',
              'pink',
              'neutral',
              'grey',
              'ink',
            ].map((tone) => (
              <Tag key={tone} tone={tone}>
                {tone}
              </Tag>
            ))}
          </div>
        </Spec>
        <Spec id="priority-tags">
          <div className={styles.inline}>
            {['sm', 'md', 'lg'].map((size) =>
              PRIORITIES.map((priority) => (
                <PriorityTag key={`${size}-${priority}`} priority={priority} size={size} />
              )),
            )}
          </div>
        </Spec>
        <Spec id="badge-2">
          <Badge label="2 waiting">2</Badge>
        </Spec>
        <Spec id="badge-sizes" bg="navy">
          <div className={styles.inline}>
            <Badge size={22}>3</Badge>
            <Badge>12</Badge>
            <Badge tone="red">5</Badge>
            <Badge tone="primary">1</Badge>
          </div>
        </Spec>
      </Section>

      <Section title="StatusCell">
        <Spec id="sc-cell-inprogress" width={132.67}>
          <StatusCell status="in_progress" />
        </Spec>
        <Spec id="sc-cell-blocked" width={132.67}>
          <StatusCell status="blocked" />
        </Spec>
        <Spec id="sc-cell-done" width={132.67}>
          <StatusCell status="done" />
        </Spec>
        <Spec id="sc-cell-submitted" width={92.33}>
          <StatusCell status="submitted" />
        </Spec>
        <Spec id="sc-cell-locked" width={93}>
          <StatusCell status="locked" />
        </Spec>
        <Spec id="sc-cell-editreq" width={93}>
          <StatusCell status="edit_requested" />
        </Spec>
        <Spec id="sc-large-done" width={189.33}>
          <StatusCell status="done" size="cellLarge" as="button" chevron />
        </Spec>
        <Spec id="sc-large-inprogress" width={189.33}>
          <StatusCell status="in_progress" size="cellLarge" as="button" chevron />
        </Spec>
        <Spec id="sc-compact-office" width={107}>
          <StatusCell status="office" size="cellCompact" />
        </Spec>
        <Spec id="sc-compact-wfh" width={107}>
          <StatusCell status="wfh" size="cellCompact" />
        </Spec>
        <Spec id="sc-cell-edited" width={131}>
          <StatusCell status="edited" />
        </Spec>
        <Spec id="sc-compact-unverified" width={89}>
          <StatusCell status="unverified" size="cellCompact" />
        </Spec>
        <Spec id="sc-compact-notchecked" width={89}>
          <StatusCell status="not_checked_in" size="cellCompact" />
        </Spec>
        <Spec id="sc-cell-missing" width={136}>
          <StatusCell status="missing" />
        </Spec>
        <Spec id="pill-active">
          <StatusCell status="active" size="pill" />
        </Spec>
        <Spec id="pill-urgent">
          <StatusCell status="urgent" size="pill" />
        </Spec>
        <Spec id="pill-onhold">
          <StatusCell status="on_hold" size="pill" />
        </Spec>
        <Spec id="pill-approved">
          <StatusCell status="approved" size="pill" />
        </Spec>
        <Spec id="pill-declined">
          <StatusCell status="declined" size="pill" />
        </Spec>
        <Spec id="pill-connected" bg="muted">
          <StatusCell status="connected" size="pill" />
        </Spec>
        <Spec id="pill-pending" bg="muted">
          <StatusCell status="pending" size="pill" />
        </Spec>
        <Spec id="block-missing">
          <StatusCell status="missing" size="block" />
        </Spec>
        <Spec id="block-pending">
          <StatusCell status="pending" size="block" />
        </Spec>
        <Spec id="sc-all" width={1080}>
          <div className={styles.grid6}>
            {Object.keys(STATUS_LABELS).map((status) => (
              <StatusCell key={status} status={status} />
            ))}
          </div>
        </Spec>
      </Section>

      <Section title="ProjectLabel and ProjectSquare">
        <Spec id="pl-orange">
          <ProjectLabel project={P.iwill} />
        </Spec>
        <Spec id="pl-blue">
          <ProjectLabel project={P.internal} />
        </Spec>
        <Spec id="pl-green">
          <ProjectLabel project={P.acme} />
        </Spec>
        <Spec id="pl-lg-orange">
          <ProjectLabel project={P.iwill} size="lg" as="button" chevron />
        </Spec>
        <Spec id="pl-lg-blue">
          <ProjectLabel project={P.internal} size="lg" as="button" chevron />
        </Spec>
        <Spec id="pl-all">
          <div className={styles.inline}>
            {Object.values(P).map((project) => (
              <ProjectLabel key={project.name} project={project} />
            ))}
            <ProjectLabel project={P.seo} size="sm" />
          </div>
        </Spec>
        <Spec id="sq-42-orange">
          <ProjectSquare project={P.iwill} size={42} />
        </Spec>
        <Spec id="sq-42-blue">
          <ProjectSquare project={P.internal} size={42} />
        </Spec>
        <Spec id="sq-all">
          <div className={styles.inline}>
            {Object.values(P).map((project) => (
              <ProjectSquare key={project.name} project={project} />
            ))}
            {Object.values(P).map((project) => (
              <ProjectSquare key={`${project.name}-34`} project={project} size={34} />
            ))}
          </div>
        </Spec>
      </Section>

      <Section title="Avatar, AvatarStack and PersonChip">
        <Spec id="av-34-blue">
          <Avatar user={U.vs} tone="blue" />
        </Spec>
        <Spec id="av-34-red">
          <Avatar user={U.km} tone="red" />
        </Spec>
        <Spec id="av-34-teal">
          <Avatar user={U.ar} tone="teal" />
        </Spec>
        <Spec id="av-34-navy">
          <Avatar user={U.pm} />
        </Spec>
        <Spec id="av-34-ink">
          <Avatar user={U.ce} />
        </Spec>
        <Spec id="av-64">
          <Avatar user={U.vs} size={64} tone="blue" />
        </Spec>
        <Spec id="av-44-navy" bg="paper">
          <Avatar user={U.pm} size={44} label="[PM name]" />
        </Spec>
        <Spec id="av-30-orange">
          <Avatar user={U.dj} size={30} tone="orange" />
        </Spec>
        <Spec id="av-square-36">
          <Avatar user={U.vs} size={36} tone="blue" shape="square" />
        </Spec>
        <Spec id="av-38-sidebar" bg="navy">
          <Avatar user={U.vs} size={38} tone="navy" />
        </Spec>
        <Spec id="av-tones">
          <div className={styles.inline}>
            {[
              'blue',
              'violet',
              'green',
              'teal',
              'orange',
              'red',
              'pink',
              'navy',
              'ink',
              'grey',
            ].map((tone) => (
              <Avatar key={tone} user={U.vs} tone={tone} />
            ))}
            <Avatar user={U.tb} />
            <Avatar user={U.vs} />
            <Avatar user={U.dj} />
            <Avatar user={{ name: 'Photo Person', avatarUrl: '/icons/icon-192.png' }} />
          </div>
        </Spec>
        <Spec id="av-stack-2">
          <AvatarStack
            users={[
              { ...U.vs, id: 1 },
              { ...U.sk, id: 2 },
            ]}
          />
        </Spec>
        <Spec id="av-stack-more">
          <AvatarStack users={[U.vs, U.rv, U.sk, U.ps, U.ar, U.km]} />
        </Spec>
        <Spec id="chip-ps">
          <PeopleDemo people={[{ ...U.ps, tone: 'violet' }]} />
        </Spec>
        <Spec id="chip-ar">
          <PeopleDemo people={[{ ...U.ar, tone: 'teal' }]} />
        </Spec>
        <Spec id="chip-static">
          <PersonChip user={U.vs} tone="blue" />
        </Spec>
      </Section>

      <Section title="Kpi, StatTile, ProgressBar, Legend">
        <Spec id="kpi-03-hours" bg="paper" width={270}>
          <Kpi label="Hours logged" value="142h" sub="this month" percent={86} />
        </Spec>
        <Spec id="kpi-05-checkedin" bg="paper" width={270}>
          <Kpi label="Checked in" value="24" sub="of 26 people" percent={92} />
        </Spec>
        <Spec id="kpi-11-hoursweek" bg="paper" width={214.67}>
          <Kpi
            label="Hours this week"
            value="328h"
            footer="Monday to today"
            percent={66}
            color="teal"
          />
        </Spec>
        <Spec id="kpi-09-missing" bg="paper" width={213.67}>
          <Kpi label="Missing check-out" value="1" sub="from yesterday" percent={2} color="red" />
        </Spec>
        <Spec id="kpi-colors" bg="paper" width={1100}>
          <div className={styles.grid5}>
            <Kpi label="Present" value="24" sub="of 26 people" percent={92} />
            <Kpi label="Working from home" value="4" sub="people" percent={15} color="violet" />
            <Kpi label="Late" value="3" sub="average 26 minutes" percent={12} color="marigold" />
            <Kpi
              label="Reports submitted"
              value="21"
              sub="of 24, due 6:30"
              percent={88}
              color="green"
            />
            <Kpi label="No bar" value="12" sub="marked urgent" />
          </div>
        </Spec>
        <Spec id="tile-932" width={220.33}>
          <StatTile value="9:32" label="Checked in" />
        </Spec>
        <Spec id="tile-538" width={220.33}>
          <StatTile value="5h 38m" label="Present so far" />
        </Spec>
        <Spec id="bar-12-blue" width={136.33}>
          <ProgressBar percent={100} color="blue" height={12} />
        </Spec>
        <Spec id="bar-12-orange" width={136.33}>
          <ProgressBar percent={44} color="orange" height={12} />
        </Spec>
        <Spec id="bar-8" width={228}>
          <ProgressBar percent={86} height={8} label="Hours logged" />
        </Spec>
        <Spec id="legend-list" width={323}>
          <Legend
            items={[
              { label: 'In office', color: 'primary', value: '18 days' },
              { label: 'Working from home', color: 'violet', value: '3 days' },
              { label: 'Late', color: 'marigold', value: '2 days' },
              { label: 'Not checked in', color: 'red', value: '1 day' },
            ]}
          />
        </Spec>
        <Spec id="legend-inline">
          <Legend
            layout="inline"
            items={[
              { label: 'Office', color: 'primary' },
              { label: 'WFH', color: 'violet' },
              { label: 'Late', color: 'marigold' },
              { label: 'Not checked in', color: 'red' },
            ]}
          />
        </Spec>
      </Section>

      <Section title="Card and CardHeader">
        <Spec id="card-header-divider" bg="paper" width={745}>
          <Card padding="none">
            <CardHeader title="My tasks this week" actions="From your daily reports" divider />
            <div className={styles.cardBody}>Table goes here</div>
          </Card>
        </Spec>
        <Spec id="card-your-day" bg="paper" width={745}>
          <Card>
            <CardHeader
              title="Your day"
              actions={
                <Tag tone="marigold" size="xl">
                  Report due in 3h 20m
                </Tag>
              }
            />
          </Card>
        </Spec>
        <Spec id="card-this-week" bg="paper" width={373}>
          <Card>
            <CardHeader title="This week" subtitle="22h 8m logged so far" />
          </Card>
        </Spec>
        <Spec id="card-urgent" bg="paper" width={373}>
          <Card tone="urgent">
            <Tag tone="marigold" size="lg" solid>
              Urgent
            </Tag>
            <p className={styles.cardText}>Client needs the homepage content changes live today.</p>
          </Card>
        </Spec>
        <Spec id="card-dashed" bg="paper" width={776}>
          <Card tone="dashed" padding="compact">
            <p className={styles.centerText}>Add another project</p>
          </Card>
        </Spec>
        <Spec id="card-dark" bg="paper" width={776}>
          <Card tone="dark">
            <CardHeader
              title="Your report is due at 6:30"
              subtitle="It posts to #daily-reports on Slack in the usual format."
              actions={
                <Button variant="marigold" size="xl">
                  Write today&apos;s report
                </Button>
              }
            />
          </Card>
        </Spec>
        <Spec id="card-muted" bg="surface" width={323}>
          <Card tone="muted" padding="compact">
            <CardHeader
              title="Report for Fri, 25 Sep"
              subtitle="Hours for acme-store were 3, not 2."
            />
          </Card>
        </Spec>
      </Section>

      <Section title="Field, Input, Select, Textarea, Toggle">
        <Spec id="field-project-name" width={411}>
          <Field label="Project name" htmlFor="ui-project-name">
            <Input id="ui-project-name" placeholder="For example: acme-blog" />
          </Field>
        </Spec>
        <Spec id="select-pm" width={411}>
          <Select
            aria-label="Project manager"
            defaultValue="pm"
            options={[{ value: 'pm', label: '[PM name]' }]}
          />
        </Spec>
        <Spec id="input-value" width={409}>
          <Input aria-label="Company name" defaultValue="[Company name]" />
        </Spec>
        <Spec id="field-shift" width={198}>
          <Field label="Shift" htmlFor="ui-shift" help="Company default">
            <Input id="ui-shift" defaultValue="9:30 AM to 6:30 PM" readOnly />
          </Field>
        </Spec>
        <Spec id="select-disabled" width={411}>
          <Select
            aria-label="Role"
            disabled
            defaultValue="employee"
            options={[{ value: 'employee', label: 'Employee' }]}
          />
        </Spec>
        <Spec id="select-compact" width={137}>
          <Select
            aria-label="Role"
            compact
            defaultValue="employee"
            options={[
              { value: 'employee', label: 'Employee' },
              { value: 'pm', label: 'Project manager' },
              { value: 'hr', label: 'HR' },
              { value: 'admin', label: 'Admin' },
            ]}
          />
        </Spec>
        <Spec id="field-error" width={411}>
          <Field label="Work email" htmlFor="ui-email" error="Use a company email address">
            <Input id="ui-email" type="email" defaultValue="riya@gmail.com" />
          </Field>
        </Spec>
        <Spec id="textarea" width={411}>
          <Field label="Reason" htmlFor="ui-reason" help="Your PM sees this with the request.">
            <Textarea id="ui-reason" placeholder="For example: forgot to add 1 hour on acme-seo" />
          </Field>
        </Spec>
        <Spec id="toggle-on">
          <ToggleDemo initial ariaLabel="Allow unverified office check-in" />
        </Spec>
        <Spec id="toggle-off" bg="urgent">
          <ToggleDemo initial={false} ariaLabel="Mark as urgent" />
        </Spec>
        <Spec id="toggle-row" width={833}>
          <ToggleDemo
            label="Allow unverified office check-in"
            help="For when the office Wi-Fi is down. HR confirms these later."
          />
        </Spec>
        <Spec id="toggle-disabled">
          <Toggle checked={false} disabled label="Disabled" help="Can't change this" />
        </Spec>
        <Spec id="days">
          <DaysDemo />
        </Spec>
        <Spec id="days-static">
          <DayToggleGroup name="days" defaultValue={[1, 2, 3, 4, 5]} />
        </Spec>
      </Section>

      <Section title="FilterPills, Segmented, SearchBox, DateSwitcher, Breadcrumb">
        <Spec id="pills-04" bg="paper">
          <FilterPills
            label="Projects"
            value="active"
            items={[
              { value: 'active', label: 'Active (6)', href: '/dev/ui?f=active' },
              { value: 'completed', label: 'Completed (9)', href: '/dev/ui?f=completed' },
            ]}
          />
        </Spec>
        <Spec id="pills-09">
          <FilterPillsDemo
            initial="all"
            items={[
              { value: 'all', label: 'All (26)' },
              { value: 'late', label: 'Late (3)' },
              { value: 'wfh', label: 'WFH (4)' },
              { value: 'missing', label: 'Not checked in (2)' },
              { value: 'unverified', label: 'Unverified (1)' },
            ]}
          />
        </Spec>
        <Spec id="seg-05">
          <SegmentedDemo
            initial="week"
            items={[
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
            ]}
          />
        </Spec>
        <Spec id="seg-06" bg="paper">
          <Segmented
            label="Range"
            value="month"
            items={[
              { value: 'week', label: 'This week', href: '/dev/ui?r=week' },
              { value: 'month', label: 'This month', href: '/dev/ui?r=month' },
              { value: 'custom', label: 'Custom', href: '/dev/ui?r=custom' },
            ]}
          />
        </Spec>
        <Spec id="seg-07">
          <SegmentedDemo
            initial="active"
            items={[
              { value: 'active', label: 'Active' },
              { value: 'on_hold', label: 'On hold' },
            ]}
          />
        </Spec>
        <Spec id="search-05" bg="paper" width={280}>
          <SearchDemo placeholder="Search people and projects" />
        </Spec>
        <Spec id="search-13" width={200}>
          <SearchBox placeholder="Search people" name="q" />
        </Spec>
        <Spec id="date-03" bg="paper">
          <DateSwitcher
            label="September 2026"
            prevHref="/dev/ui?m=2026-08"
            nextHref="/dev/ui?m=2026-10"
            prevLabel="August 2026"
            nextLabel="October 2026"
          />
        </Spec>
        <Spec id="date-09" bg="paper">
          <DateSwitcher
            label="Today"
            prevHref="/dev/ui?d=2026-09-29"
            prevLabel="Tuesday, 29 September"
            nextLabel="No later days"
          />
        </Spec>
        <Spec id="crumb-06" bg="paper">
          <Breadcrumb items={[{ label: 'Team', href: '/dev/ui' }, { label: 'Vishal Saini' }]} />
        </Spec>
      </Section>

      <Section title="EmptyState and Skeleton">
        <Spec id="empty" width={500}>
          <EmptyState
            icon={<Inbox size={20} strokeWidth={1.8} />}
            title="No reports yet this month"
            body="Reports you submit show up here with their hours and tasks."
            action={<Button variant="secondary">Write today&apos;s report</Button>}
          />
        </Spec>
        <Spec id="skeleton" width={500}>
          <div className={styles.stack}>
            <Skeleton width={180} height={18} />
            <Skeleton height={34} radius={8} />
            <Skeleton height={34} radius={8} />
            <Skeleton width="60%" height={14} />
          </div>
        </Spec>
      </Section>
    </main>
  );
}
