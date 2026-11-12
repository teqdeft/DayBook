'use client';
// What loading.js shows: the frame and the skeleton of the tab the URL asks for. Moving between tabs
// passes through here too, and a server-rendered loading.js can't see the URL's tab.
import { useSearchParams } from 'next/navigation';
import { chosenTab } from './ProjectTabs';
import { ProjectSkeleton } from './TabSkeletons';

export default function ProjectLoading() {
  const params = useSearchParams();
  return <ProjectSkeleton tab={chosenTab(Object.fromEntries(params))} />;
}
