'use client';
// The board's toolbar (CONTRACT 28, Board toolbar, filters, faces, Mine and search): a white bar
// under the band, wrapping, named "Task tools". Left to right: Add task (the project's PM and
// Admins on an open project; Reopen project on a Completed one), Board | Table, the search,
// Filter, Mine (3) (managers) and the faces (managers and another PM), pushed to the right. A
// member gets Board | Table, the search and Filter.
import { useState } from 'react';
import AddTaskButton from './AddTaskButton';
import BoardSearch from './BoardSearch';
import { ADD_TASK_ID } from './boardView';
import FacesFilter from './FacesFilter';
import FilterMenu from './FilterMenu';
import ReopenProject from './ReopenProject';
import ViewSwitch from './ViewSwitch';
import styles from './Toolbar.module.css';

/** Mine (3): a toggle pill keeping the viewer's own open tasks in view. */
function Mine({ filters }) {
  return (
    <button
      type="button"
      className={styles.mine}
      aria-pressed={filters.state.mine}
      onClick={() => filters.toggle('mine')}
    >
      Mine ({filters.counts.mine})
    </button>
  );
}

/** Add task, or Reopen project on a Completed project (the project's PM and Admins). */
function AddOrReopen({ board }) {
  if (board.status === 'completed') {
    return (
      <ReopenProject
        projectName={board.projectName}
        focusId={ADD_TASK_ID}
        className={styles.reopen}
        size="compact"
      />
    );
  }
  return <AddTaskButton board={board} />;
}

/** @param {{ board: object }} props board: useBoard's shared values and actions */
export default function BoardToolbar({ board }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const { filters } = board;
  const manage = board.access === 'manage';
  return (
    <div
      className={styles.toolbar}
      role="group"
      aria-label="Task tools"
      data-search-open={searchOpen ? '' : undefined}
    >
      {manage ? <AddOrReopen board={board} /> : null}
      <ViewSwitch view={board.view} onView={board.setView} />
      <BoardSearch
        value={filters.state.query}
        onChange={(query) => filters.set('query', query)}
        open={searchOpen}
        onOpen={setSearchOpen}
      />
      <FilterMenu board={board} />
      {manage ? <Mine filters={filters} /> : null}
      {board.access === 'member' ? null : <FacesFilter board={board} />}
    </div>
  );
}
