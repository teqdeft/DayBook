// The project page's tabs (CONTRACT 27): plain links, so a tab is in the URL and works without
// JavaScript. Server-safe. The PM view has Board, Summary, Files, Timeline and Hours; a member gets
// Board and Files. Tabs aren't prefetched: the page's tab streams in behind its own skeleton once
// clicked, and most visits never open them all.
import Link from 'next/link';
import styles from './ProjectTabs.module.css';

export const PROJECT_TABS = [
  { key: 'board', label: 'Board' },
  { key: 'summary', label: 'Summary' },
  { key: 'files', label: 'Files' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'hours', label: 'Hours' },
];

export const MEMBER_TABS = PROJECT_TABS.filter(({ key }) => key === 'board' || key === 'files');

/** Tabs from before 1.12 that now open the Board (stored notification rows, the row menu). */
const OLD_TABS = new Set(['phases', 'overview']);

const first = (value) => (Array.isArray(value) ? value[0] : value);

/**
 * The tabs this viewer gets.
 * @param {'manage'|'team'|'member'} [access] the page's access; left out, the PM view's
 */
export function tabsFor(access) {
  return access === 'member' ? MEMBER_TABS : PROJECT_TABS;
}

/**
 * The tab a URL asks for. `phases` and `overview` open the Board. In the PM view, with no tab, a
 * range, from or to opens Hours, so links from before the tabs keep working; a member asking for a
 * tab they don't have gets the Board. `show` (the Board's pills) never changes the tab.
 * @param {Record<string, string|string[]|undefined>} [query] the page's search params
 * @param {'manage'|'team'|'member'} [access] the page's access; left out, the PM view's
 * @returns {'board'|'summary'|'files'|'timeline'|'hours'}
 */
export function chosenTab(query, access) {
  const tab = first(query?.tab);
  if (OLD_TABS.has(tab)) return 'board';
  if (tabsFor(access).some(({ key }) => key === tab)) return tab;
  if (access === 'member') return 'board';
  return first(query?.range) || first(query?.from) || first(query?.to) ? 'hours' : 'board';
}

/** '/projects/5?tab=files' */
export function tabHref(projectId, tab) {
  return `/projects/${projectId}?tab=${tab}`;
}

/** @param {{ projectId: number, tab: string, access?: 'manage'|'team'|'member' }} props */
export default function ProjectTabs({ projectId, tab, access }) {
  return (
    <nav aria-label="Project sections" className={styles.tabs}>
      {tabsFor(access).map(({ key, label }) => (
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
