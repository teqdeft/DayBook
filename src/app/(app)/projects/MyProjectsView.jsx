// Employee view of /projects (artboard 04): the projects the person is a member of, as cards,
// with Active and Completed tabs and "Request a project".
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import FilterPills from '@/components/FilterPills';
import TopBar from '@/components/TopBar';
import { logger } from '@/lib/logger';
import { compactName } from '@/lib/text';
import { monthOf, monthRange, workDate } from '@/lib/time';
import { projects } from '@/modules/projects';
import { reports } from '@/modules/reports';
import { settings } from '@/modules/settings';
import ProjectCard from './ProjectCard';
import RequestProjectButton from './RequestProjectButton';
import styles from './page.module.css';

/** Hours come from the reports module; the cards still render if it fails. */
async function safely(promise, fallback, message, userId) {
  try {
    return (await promise) ?? fallback;
  } catch (error) {
    logger.warn({ err: error, userId }, message);
    return fallback;
  }
}

function tabHref(status, q) {
  const search = new URLSearchParams();
  if (status !== 'active') search.set('status', status);
  if (q) search.set('q', q);
  const query = search.toString();
  return query ? `/projects?${query}` : '/projects';
}

/** Filters by the search text from the top bar search (it links here with ?q=). */
function matches(project, q) {
  if (!q) return true;
  const text = q.toLowerCase();
  const compact = compactName(text);
  return (
    project.name.toLowerCase().includes(text) ||
    String(project.clientName ?? '')
      .toLowerCase()
      .includes(text) ||
    (compact !== '' && compactName(project.name).includes(compact))
  );
}

export default async function MyProjectsView({ user, params }) {
  const q = typeof params?.q === 'string' ? params.q.trim().slice(0, 120) : '';
  const all = (await projects.listForMember(user.id)).filter((project) => matches(project, q));
  const active = all.filter((project) => project.status !== 'completed');
  const completed = all.filter((project) => project.status === 'completed');
  const requested = params?.status === 'completed' ? 'completed' : 'active';
  // A search from the top bar opens the tab that has the match.
  const tab =
    q && requested === 'active' && active.length === 0 && completed.length > 0
      ? 'completed'
      : requested;
  const shown = tab === 'completed' ? completed : active;

  const { timezone } = await settings.getAll();
  const today = workDate(timezone);
  const month = monthRange(monthOf(today));
  const [minutes, lastDates] = await Promise.all([
    safely(
      reports.getMinutesByProject({ from: month.from, to: month.to, userId: user.id }),
      {},
      'my projects: could not load hours this month',
      user.id,
    ),
    safely(
      reports.getLastReportDateByProject(user.id),
      {},
      'my projects: could not load last updates',
      user.id,
    ),
  ]);

  return (
    <>
      <TopBar
        title="Projects"
        subtitle="Projects you are working on"
        actions={<RequestProjectButton />}
      />
      <FilterPills
        label="Project status"
        value={tab}
        items={[
          { value: 'active', label: `Active (${active.length})`, href: tabHref('active', q) },
          {
            value: 'completed',
            label: `Completed (${completed.length})`,
            href: tabHref('completed', q),
          },
        ]}
      />
      {shown.length > 0 ? (
        <div className={styles.cardGrid}>
          {shown.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              minutes={Number(minutes[project.id] ?? 0)}
              lastDate={lastDates[project.id] ?? null}
              today={today}
            />
          ))}
        </div>
      ) : (
        <Card className={styles.emptyCard}>
          {q ? (
            <EmptyState
              title="No projects match your search"
              body={`Nothing you work on matches "${q}".`}
              action={
                <Button variant="secondary" href={tabHref(tab, '')}>
                  Clear search
                </Button>
              }
            />
          ) : tab === 'completed' ? (
            <EmptyState
              title="No completed projects yet"
              body="Projects you worked on move here when your PM completes them."
              action={
                <Button variant="secondary" href="/projects">
                  See active projects
                </Button>
              }
            />
          ) : completed.length > 0 ? (
            <EmptyState
              title="No active projects"
              body="Your projects are all completed. Working on something new? Request it."
              action={<RequestProjectButton variant="secondary" />}
            />
          ) : (
            <EmptyState
              title="You are not on a project yet"
              body="When your PM adds you to a project, it shows here. Working on something already? Request it."
              action={<RequestProjectButton variant="secondary" />}
            />
          )}
        </Card>
      )}
      {shown.length > 0 && tab === 'active' ? (
        <Card tone="dashed" className={styles.requestCard}>
          <div className={styles.requestText}>
            <p className={styles.requestTitle}>Working on something that is not listed?</p>
            <p className={styles.requestBody}>
              Request it and your PM adds it. You can still log hours to it today.
            </p>
          </div>
          <RequestProjectButton variant="secondary" />
        </Card>
      ) : null}
    </>
  );
}
