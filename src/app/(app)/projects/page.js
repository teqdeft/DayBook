// /projects: people see the projects they work on (artboard 04); PMs and Admin manage every
// project in the health table of the project management prototype (CONTRACT 22,
// docs/design/project-management-prototype.dc.html).
import { Suspense } from 'react';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/session';
import ManageProjectsView from './ManageProjectsView';
import MyProjectsView from './MyProjectsView';
import { ManageProjectsSkeleton, MyProjectsSkeleton } from './ProjectsSkeletons';
import { readRange } from './projectsRange';

export const metadata = { title: 'Projects' };

export default async function ProjectsPage({ searchParams }) {
  const user = await requirePage('project.request');
  const params = await searchParams;
  if (can(user, 'project.manage')) {
    const { showCustom } = readRange(params, 'week');
    return (
      <Suspense fallback={<ManageProjectsSkeleton custom={showCustom} />}>
        <ManageProjectsView user={user} params={params} />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<MyProjectsSkeleton />}>
      <MyProjectsView user={user} params={params} />
    </Suspense>
  );
}
