// /projects: people see the projects they work on (artboard 04); PMs and Admin manage every
// project (artboard 07).
import { Suspense } from 'react';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/session';
import ManageProjectsView from './ManageProjectsView';
import MyProjectsView from './MyProjectsView';
import { ManageProjectsSkeleton, MyProjectsSkeleton } from './ProjectsSkeletons';

export const metadata = { title: 'Projects' };

export default async function ProjectsPage({ searchParams }) {
  const user = await requirePage('project.request');
  const params = await searchParams;
  if (can(user, 'project.manage')) {
    return (
      <Suspense fallback={<ManageProjectsSkeleton />}>
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
