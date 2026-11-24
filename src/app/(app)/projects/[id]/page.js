// The project page (CONTRACT 27). Everyone with `project.request` may ask for it; then
// loadProjectHead decides: `team.view` holders get the PM view (only the project's PM and Admins
// change it), active members of the project the read-only member view, anyone else a 404 (the
// segment's layout.js makes the same check first, so it is a real HTTP 404). Another
// PM's page never gets files, notes, summary text or AI lines: those are only loaded for people
// who can manage the project (SummaryTab) or by the files rule (FilesTab).
import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/session';
import { projectIdParamSchema } from '@/modules/dashboard/projectReportSchemas';
import MemberProjectView from './MemberProjectView';
import { loadProjectHead } from './projectHead';
import ProjectView from './ProjectView';

export const metadata = { title: 'Project' };

export default async function ProjectPage({ params, searchParams }) {
  const user = await requirePage('project.request');
  const id = projectIdParamSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const query = await searchParams;
  const head = await loadProjectHead(id.data, user);
  if (!head) notFound();
  if (head.access === 'member') return <MemberProjectView head={head} query={query} />;
  return <ProjectView user={user} head={head} query={query} />;
}
