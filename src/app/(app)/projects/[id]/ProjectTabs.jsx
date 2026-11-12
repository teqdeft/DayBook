// The project page's tabs (CONTRACT 22): plain links, so a tab is in the URL and works without
// JavaScript. Server-safe. Tabs aren't prefetched: the page's tab streams in behind its own skeleton
// once clicked, and most visits never open all four.
import Link from 'next/link';
import styles from './ProjectTabs.module.css';

export const PROJECT_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'phases', label: 'Phases' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'hours', label: 'Hours' },
];

const first = (value) => (Array.isArray(value) ? value[0] : value);

/**
 * The tab a URL asks for. With no tab, a range, from or to opens Hours, so links from before the tabs
 * keep working.
 * @param {Record<string, string|string[]|undefined>} [query] the page's search params
 * @returns {'overview'|'phases'|'timeline'|'hours'}
 */
export function chosenTab(query) {
  const tab = first(query?.tab);
  if (PROJECT_TABS.some(({ key }) => key === tab)) return tab;
  return first(query?.range) || first(query?.from) || first(query?.to) ? 'hours' : 'overview';
}

/** '/projects/5?tab=phases' */
export function tabHref(projectId, tab) {
  return `/projects/${projectId}?tab=${tab}`;
}

/** @param {{ projectId: number, tab: string }} props */
export default function ProjectTabs({ projectId, tab }) {
  return (
    <nav aria-label="Project sections" className={styles.tabs}>
      {PROJECT_TABS.map(({ key, label }) => (
        <Link
          key={key}
          href={tabHref(projectId, key)}
          prefetch={false}
          className={`${styles.tab} ${key === tab ? styles.current : ''}`}
          aria-current={key === tab ? 'page' : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
