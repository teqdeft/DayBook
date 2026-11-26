'use client';
// The My tasks toolbar (CONTRACT 28, My tasks: sidebar, page and home cards): "Group by" with
// "When | Project" (two pressed-state buttons in a group), the project select ("All projects", then
// the projects of my tasks A to Z) and "Search my tasks" (a title, or a task's number). They last
// for the visit. On a phone each takes its own 44 px row.
import { useId } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import Input from '@/components/Input';
import Segmented from '@/components/Segmented';
import Select from '@/components/Select';
import styles from './MyTasksToolbar.module.css';

const GROUP_BY = [
  { value: 'when', label: 'When' },
  { value: 'project', label: 'Project' },
];

/** "Group by" and its When | Project buttons. */
function GroupBy({ id, by, onBy }) {
  return (
    <div className={styles.groupBy}>
      <span id={id} className={styles.groupByLabel}>
        Group by
      </span>
      <Segmented
        items={GROUP_BY}
        value={by}
        onChange={onBy}
        aria-labelledby={id}
        className={styles.segmented}
      />
    </div>
  );
}

/** "Search my tasks", with its icon inside. */
function MineSearch({ id, query, onQuery }) {
  return (
    <div className={styles.search}>
      <Search size={16} strokeWidth={1.8} aria-hidden="true" />
      <label className="visually-hidden" htmlFor={id}>
        Search my tasks
      </label>
      <Input
        id={id}
        type="search"
        compact
        className={styles.searchInput}
        placeholder="Search my tasks"
        autoComplete="off"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
      />
    </div>
  );
}

/**
 * @param {{ by: 'when' | 'project', onBy: (by: string) => void,
 *   choices: Array<{ value: string, label: string }>, projectId: string,
 *   onProject: (projectId: string) => void, query: string, onQuery: (query: string) => void }}
 *   props choices: myTasksView.projectChoices
 */
export default function MyTasksToolbar({
  by,
  onBy,
  choices,
  projectId,
  onProject,
  query,
  onQuery,
}) {
  const id = useId();
  return (
    <div className={styles.toolbar}>
      <GroupBy id={`${id}-by`} by={by} onBy={onBy} />
      <div className={styles.projectPick}>
        <label className="visually-hidden" htmlFor={`${id}-project`}>
          Project
        </label>
        <Select
          id={`${id}-project`}
          compact
          options={choices}
          value={projectId}
          onChange={(event) => onProject(event.target.value)}
        />
        <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
      </div>
      <MineSearch id={`${id}-search`} query={query} onQuery={onQuery} />
    </div>
  );
}
