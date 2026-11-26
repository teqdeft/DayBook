'use client';
// A card's "⋯" (CONTRACT 28, Cards and the card menu), for the project's PM and Admins: Assign to me
// (first; not on the viewer's own task or a done one), Assign to… (the people window as a window:
// the keyboard and phone way to give a task to someone), Open, Edit, Move to phase… (the keyboard,
// screen reader and phone way to move a card) and, under a line, Delete (danger, with the 1.12
// Undo). Daybook's flat Menu.
import { ArrowRight, Eye, Pencil, Trash2, UserPlus, Users } from 'lucide-react';
import Menu from '@/components/Menu';
import { isViewersTask } from './assignView';
import { cardId } from './boardView';
import { useTaskActions } from './TaskActionsProvider';

const icon = (Icon) => <Icon size={16} strokeWidth={1.8} aria-hidden="true" />;

/** The card's "⋯" button (the menu gives focus back to it before an item runs). */
const triggerOf = (taskId) =>
  document.getElementById(cardId(taskId))?.querySelector('[aria-haspopup="menu"]') ?? null;

/**
 * The menu's items, in order.
 * @param {{ task: object, board: object, actions: object | null }} args board: useBoard's actions
 *   (openTask, editTask, askMove, deleteTask); actions: useTaskActions()
 * @returns {import('@/components/Menu').MenuItem[]}
 */
export function cardMenuItems({ task, board, actions }) {
  const items = [];
  if (actions && task.status !== 'done' && !isViewersTask(task, board.viewerId)) {
    items.push({
      label: 'Assign to me',
      icon: icon(UserPlus),
      onSelect: () => actions.take(task, { origin: triggerOf(task.id) }),
    });
  }
  if (actions) {
    items.push({
      label: 'Assign to…',
      icon: icon(Users),
      onSelect: () => actions.openPeople({ tasks: [task] }),
    });
  }
  items.push(
    { label: 'Open', icon: icon(Eye), onSelect: () => board.openTask(task, triggerOf(task.id)) },
    { label: 'Edit', icon: icon(Pencil), onSelect: () => board.editTask(task) },
    { label: 'Move to phase…', icon: icon(ArrowRight), onSelect: () => board.askMove(task) },
    {
      label: 'Delete',
      icon: icon(Trash2),
      tone: 'danger',
      separator: true,
      onSelect: () => board.deleteTask(task),
    },
  );
  return items;
}

/**
 * @param {{ task: object, board: object, className?: string }} props board: useBoard's actions
 *   (openTask, editTask, askMove, deleteTask) and `viewerId`
 */
export default function CardMenu({ task, board, className }) {
  const actions = useTaskActions();
  return (
    <Menu
      label={`More for ${task.title}`}
      triggerClassName={className}
      width={220}
      items={cardMenuItems({ task, board, actions })}
    />
  );
}
