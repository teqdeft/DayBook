// Employee view of /projects (artboard 04): the projects the person is a member of, as cards,
// with Active and Completed tabs, a name search (MyProjectsFilter, in the browser) and "Request a
// project".
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import TopBar from '@/components/TopBar';
import { logger } from '@/lib/logger';
import { monthOf, monthRange, workDate } from '@/lib/time';
import { projects } from '@/modules/projects';
import { reports } from '@/modules/reports';
import { settings } from '@/modules/settings';
import MyProjectsFilter, { MyProjectsList, MyProjectsSearch } from './MyProjectsFilter';
import ProjectCard from './ProjectCard';
import RequestProjectButton from './RequestProjectButton';
import { cleanQuery, filterProjects } from './projectFilter';
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

/** What a tab shows when it has no projects at all (whatever the search). */
function EmptyTab({ tab, hasCompleted }) {
  if (tab === 'completed') {
    return (
      <EmptyState
        title="No completed projects yet"
        body="Projects you worked on move here when your PM completes them."
        action={
          <Button variant="secondary" href="/projects">
            See active projects
          </Button>
        }
      />
    );
  }
  if (hasCompleted) {
    return (
      <EmptyState
        title="No active projects"
        body="Your projects are all completed. Working on something new? Request it."
        action={<RequestProjectButton variant="secondary" />}
      />
    );
  }
  return (
    <EmptyState
      title="You are not on a project yet"
      body="When your PM adds you to a project, it shows here. Working on something already? Request it."
      action={<RequestProjectButton variant="secondary" />}
    />
  );
}

function RequestCard() {
  return (
    <Card tone="dashed" className={styles.requestCard}>
      <div className={styles.requestText}>
        <p className={styles.requestTitle}>Working on something that is not listed?</p>
        <p className={styles.requestBody}>
          Request it and your PM adds it. You can still log hours to it today.
        </p>
      </div>
      <RequestProjectButton variant="secondary" />
    </Card>
  );
}

export default async function MyProjectsView({ user, params }) {
  const q = cleanQuery(params?.q);
  const all = await projects.listForMember(user.id);
  const active = all.filter((project) => project.status !== 'completed');
  const completed = all.filter((project) => project.status === 'completed');
  const requested = params?.status === 'completed' ? 'completed' : 'active';
  // A link with ?q= opens the tab that has the match.
  const tab =
    q &&
    requested === 'active' &&
    filterProjects(active, q).length === 0 &&
    filterProjects(completed, q).length > 0
      ? 'completed'
      : requested;

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
  // The open tab's cards render here (they read on the server) and the search shows or hides
  // them; the other tab only needs the names (project and client), for its count.
  const cards = (list) =>
    list.map((project) => ({
      id: project.id,
      name: project.name,
      clientName: project.clientName,
      card: (
        <ProjectCard
          project={project}
          minutes={Number(minutes[project.id] ?? 0)}
          lastDate={lastDates[project.id] ?? null}
          today={today}
        />
      ),
    }));
  const names = (list) => list.map(({ id, name, clientName }) => ({ id, name, clientName }));
  const shown = tab === 'completed' ? completed : active;

  return (
    <MyProjectsFilter>
      <TopBar
        title="Projects"
        subtitle="Projects you are working on"
        actions={
          <>
            <MyProjectsSearch className={styles.search} />
            <RequestProjectButton />
          </>
        }
      />
      <MyProjectsList
        tab={tab}
        active={tab === 'active' ? cards(active) : names(active)}
        completed={tab === 'completed' ? cards(completed) : names(completed)}
        empty={<EmptyTab tab={tab} hasCompleted={completed.length > 0} />}
        footer={shown.length > 0 && tab === 'active' ? <RequestCard /> : null}
      />
    </MyProjectsFilter>
  );
}
