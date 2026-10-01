// The Requests screen: pending cards on the left, "Recently handled" and "How edits work" on the
// right. Report edits come from the reports module, project requests from projects.
import Card, { CardHeader } from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import FilterPills from '@/components/FilterPills';
import Button from '@/components/Button';
import TopBar from '@/components/TopBar';
import { can } from '@/lib/permissions';
import { logger } from '@/lib/logger';
import { workDate } from '@/lib/time';
import { projects } from '@/modules/projects';
import { reports } from '@/modules/reports';
import { settings } from '@/modules/settings';
import ProjectEditorProvider from '../projects/ProjectEditorProvider';
import RecentlyHandled from './RecentlyHandled';
import RequestCard from './RequestCard';
import styles from './page.module.css';

const FILTERS = ['all', 'edits', 'projects'];

async function safely(promise, fallback, message, userId) {
  try {
    return (await promise) ?? fallback;
  } catch (error) {
    logger.warn({ err: error, userId }, message);
    return fallback;
  }
}

/** "Reports lock at 12:00 the day after." from the report_lock setting. */
export function lockSentence(reportLock) {
  const match = /^(same|next)_day_(\d{1,2}:\d{2})$/.exec(reportLock ?? '');
  if (!match) return 'Reports lock at 12:00 the day after.';
  return `Reports lock at ${match[2]} ${match[1] === 'next' ? 'the day after' : 'the same day'}.`;
}

function filterHref(type) {
  return type === 'all' ? '/requests' : `/requests?type=${type}`;
}

function emptyCopy(type) {
  if (type === 'edits')
    return { title: 'No report edits waiting', body: 'Edit requests from your team show up here.' };
  if (type === 'projects')
    return {
      title: 'No new project requests',
      body: 'When someone asks for a missing project, it shows up here.',
    };
  return {
    title: 'You are all caught up',
    body: 'Report edits and new project requests show up here.',
  };
}

export default async function RequestsView({ user, params }) {
  const type = FILTERS.includes(params?.type) ? params.type : 'all';
  const handlesEdits = can(user, 'report.approve_edit');
  const [config, edits, projectRequests, handledEdits, handledProjects, managers, people] =
    await Promise.all([
      settings.getAll(),
      handlesEdits
        ? safely(reports.listPendingEditRequestsFor(user), [], 'requests: edit requests', user.id)
        : [],
      projects.listPendingRequestsFor(user),
      handlesEdits
        ? safely(
            reports.listHandledEditRequestsFor(user, { limit: 10 }),
            [],
            'requests: handled edit requests',
            user.id,
          )
        : [],
      projects.listHandledRequestsFor(user, { limit: 10 }),
      projects.listManagerOptions(user),
      projects.listPeopleOptions(),
    ]);
  const needsMoveTargets = projectRequests.some((request) => request.hasEntries);
  const moveTargets = needsMoveTargets
    ? (await projects.listActiveOptions()).map((project) => ({
        value: project.id,
        label: project.name,
      }))
    : [];

  const pending = [
    ...edits.map((request) => ({ kind: 'edit', request })),
    ...projectRequests.map((request) => ({ kind: 'project', request })),
  ].sort(
    (a, b) =>
      new Date(b.request.createdAt) - new Date(a.request.createdAt) ||
      (a.kind === b.kind ? b.request.id - a.request.id : a.kind === 'edit' ? -1 : 1),
  );
  const shown = pending.filter(
    (item) =>
      type === 'all' ||
      (type === 'edits' && item.kind === 'edit') ||
      (type === 'projects' && item.kind === 'project'),
  );
  const total = pending.length;
  const tz = config.timezone;
  const today = workDate(tz);
  const empty = emptyCopy(type);

  return (
    <ProjectEditorProvider
      managers={managers}
      people={people}
      viewer={{ id: user.id, isAdmin: user.role === 'admin' }}
    >
      <TopBar
        title="Requests"
        subtitle={total > 0 ? `${total} waiting for you` : 'Nothing waiting for you'}
        bell
      />
      <FilterPills
        label="Request type"
        value={type}
        items={[
          { value: 'all', label: `All (${total})`, href: filterHref('all') },
          { value: 'edits', label: `Report edits (${edits.length})`, href: filterHref('edits') },
          {
            value: 'projects',
            label: `New projects (${projectRequests.length})`,
            href: filterHref('projects'),
          },
        ]}
      />
      <div className={styles.layout}>
        <section className={styles.list} aria-label="Waiting for you">
          {shown.length > 0 ? (
            shown.map((item) => (
              <RequestCard
                key={`${item.kind}-${item.request.id}`}
                kind={item.kind}
                request={item.request}
                tz={tz}
                today={today}
                moveTargets={moveTargets}
              />
            ))
          ) : (
            <Card className={styles.emptyCard}>
              <EmptyState
                title={empty.title}
                body={empty.body}
                action={
                  type === 'all' ? (
                    <Button variant="secondary" href="/projects">
                      Open projects
                    </Button>
                  ) : (
                    <Button variant="secondary" href="/requests">
                      See all requests
                    </Button>
                  )
                }
              />
            </Card>
          )}
        </section>
        <aside className={styles.side}>
          <RecentlyHandled edits={handledEdits} projectRequests={handledProjects} />
          <Card className={styles.howCard}>
            <CardHeader title="How edits work" className={styles.howHeader} />
            <p className={styles.howText}>
              {lockSentence(config.reportLock)} Approving an edit unlocks that one report, and every
              change is saved in its history.
            </p>
          </Card>
        </aside>
      </div>
    </ProjectEditorProvider>
  );
}
