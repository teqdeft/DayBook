// The project page (CONTRACT 22). PMs see every project; only the project's PM and Admin can change
// it. Another PM's page never gets files, notes, summary text or AI lines: those are only loaded when
// canManage is true (OverviewTab).
import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/session';
import { projectIdParamSchema } from '@/modules/dashboard/projectReportSchemas';
import { loadProjectHead } from './projectHead';
import ProjectView from './ProjectView';

export const metadata = { title: 'Project' };

export default async function ProjectPage({ params, searchParams }) {
  const user = await requirePage('team.view');
  const id = projectIdParamSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const query = await searchParams;
  const head = await loadProjectHead(id.data, user);
  if (!head) notFound();
  return <ProjectView user={user} head={head} query={query} />;
}
