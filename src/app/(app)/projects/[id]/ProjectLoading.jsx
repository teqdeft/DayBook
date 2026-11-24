'use client';
// What loading.js shows: the frame and the skeleton of the tab the URL asks for (CONTRACT 27).
// Moving between tabs passes through here too, and a server-rendered loading.js can't see the URL's
// tab. It can't know whether the viewer is a member either, so it draws the PM view's tabs; the
// member page's own tab skeletons (MemberProjectView) are the member's.
import { useSearchParams } from 'next/navigation';
import { chosenTab } from './ProjectTabs';
import { ProjectSkeleton } from './TabSkeletons';

export default function ProjectLoading() {
  const params = useSearchParams();
  return <ProjectSkeleton tab={chosenTab(Object.fromEntries(params))} />;
}
