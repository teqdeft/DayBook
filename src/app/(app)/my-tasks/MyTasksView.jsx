'use client';
// The /my-tasks page under its TopBar (CONTRACT 28, My tasks: sidebar, page and home cards): the
// toolbar, then the tasks grouped by when they are due (or by project) in the Table's look, "No
// tasks match." when the select and the search keep none, the empty sentence when there are no
// tasks, and "Showing the first 200 tasks." past 200. Titles open the task window in `mine` mode
// ("Open project", and Mark done or Reopen for a manager of that project); a tick plays the row's
// leave, with "Marked done." and Undo from the page's TaskUndoProvider.
import { useState } from 'react';
import Card from '@/components/Card';
import { TaskWindowProvider } from '@/components/task/TaskWindowProvider';
import { TaskUndoProvider } from '@/app/(app)/projects/[id]/TaskUndoProvider';
import { NO_TASKS } from './MyTasksCard';
import MyTasksTable from './MyTasksTable';
import MyTasksToolbar from './MyTasksToolbar';
import { ALL_PROJECTS, filterMine, groupsFor, projectChoices } from './myTasksView';
import { useMineTick } from './useMineTick';
import styles from './MyTasks.module.css';

function MineBody({ mine }) {
  const [by, setBy] = useState('when');
  const [projectId, setProjectId] = useState(ALL_PROJECTS);
  const [query, setQuery] = useState('');
  const { tasks, tick } = useMineTick(mine.tasks);
  const choices = projectChoices(tasks);
  // A project whose last task left reads as All projects again.
  const picked = choices.some((choice) => choice.value === projectId) ? projectId : ALL_PROJECTS;
  const shown = filterMine(tasks, { projectId: picked, query });
  const groups = groupsFor(shown, { by, today: mine.today });
  return (
    <>
      <MyTasksToolbar
        by={by}
        onBy={setBy}
        choices={choices}
        projectId={picked}
        onProject={setProjectId}
        query={query}
        onQuery={setQuery}
      />
      {shown.length > 0 ? (
        <MyTasksTable groups={groups} today={mine.today} onTick={tick} />
      ) : (
        <Card padding="none">
          <p className={styles.empty}>{tasks.length > 0 ? 'No tasks match.' : NO_TASKS}</p>
        </Card>
      )}
      {mine.more ? <p className={styles.more}>Showing the first 200 tasks.</p> : null}
    </>
  );
}

/**
 * @param {{ mine: { tasks: import('./myTasksData').MineRow[], more: boolean, today: string,
 *   viewerId: number } }} props mine: loadMyTasks' answer (myTasksData.js)
 */
export default function MyTasksView({ mine }) {
  return (
    <TaskUndoProvider>
      <TaskWindowProvider mode="mine" viewerId={mine.viewerId} today={mine.today}>
        <MineBody mine={mine} />
      </TaskWindowProvider>
    </TaskUndoProvider>
  );
}
