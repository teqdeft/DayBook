// The project page's segment (CONTRACT 27, The project page): it decides who may open the page
// before anything streams, so someone who may not (another PM is fine; HR or an employee not on
// the project is not), an unknown project or a bad id gets a real HTTP 404 with the not-found
// screen, not a 200 with it. This layout runs outside the segment's loading.js, and /projects'
// own loading.js lives in the (list) group, so no Suspense above starts the stream first. Layouts
// don't run again on every navigation, so page.js still checks, from the same cached read.
import { notFound } from 'next/navigation';
import { requirePage } from '@/lib/session';
import { projectIdParamSchema } from '@/modules/dashboard/projectReportSchemas';
import { canOpenProject } from './projectHead';

/**
 * @param {{ children: import('react').ReactNode, params: Promise<{ id: string }> }} props
 */
export default async function ProjectLayout({ children, params }) {
  const user = await requirePage('project.request');
  const id = projectIdParamSchema.safeParse((await params).id);
  if (!id.success || !(await canOpenProject(id.data, user))) notFound();
  return children;
}
