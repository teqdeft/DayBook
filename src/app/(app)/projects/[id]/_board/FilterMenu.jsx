'use client';
// The toolbar's Filter (CONTRACT 28, Board toolbar item 4): a menu of checkbox items that stays open
// while you tick: "Critical (4)", "With files (4)" (only for a viewer who may see files), "Overdue
// (2)", "Blocked (1)" and "Show done tasks". The button counts the items that are on ("Filter" and
// a 2 in a pill, read as "Filter, 2 on"). Counts are open tasks the viewer sees.
import { ListFilter } from 'lucide-react';
import Menu from '@/components/Menu';
import { menuItems } from './boardFilters';
import styles from './Toolbar.module.css';

/** @param {{ board: object }} props board: useBoard's (`filters`, `filesAccess`) */
export default function FilterMenu({ board }) {
  const { filters } = board;
  const files = Boolean(board.filesAccess) && board.filesAccess !== 'none';
  const items = menuItems(filters.counts, { files }).map((item) => ({
    label: item.label,
    checked: Boolean(filters.state[item.key]),
    keepOpen: true,
    onSelect: () => filters.toggle(item.key),
  }));
  return (
    <Menu
      label="Filter"
      items={items}
      align="start"
      width={220}
      triggerClassName={styles.filter}
      childrenName
    >
      <ListFilter size={16} strokeWidth={1.8} aria-hidden="true" />
      Filter
      {filters.badge ? (
        <>
          <span className={styles.badge} aria-hidden="true">
            {filters.badge}
          </span>
          <span className="visually-hidden">, {filters.badge} on</span>
        </>
      ) : null}
    </Menu>
  );
}
