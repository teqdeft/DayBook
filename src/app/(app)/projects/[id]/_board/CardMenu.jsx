'use client';
// A card's "⋯" (CONTRACT 27, Cards), for the project's PM and Admins: Open, Edit, Move to phase…
// (the keyboard, screen reader and phone way to move a card) and Delete. Daybook's flat Menu.
import { ArrowRightLeft, FileText, Pencil, Trash2 } from 'lucide-react';
import Menu from '@/components/Menu';
import { cardId } from './boardView';

const icon = (Icon) => <Icon size={16} strokeWidth={1.8} aria-hidden="true" />;

/**
 * @param {{ task: object, board: object, className?: string }} props board: useBoard's actions
 *   (openTask, editTask, askMove, deleteTask)
 */
export default function CardMenu({ task, board, className }) {
  const trigger = () =>
    document.getElementById(cardId(task.id))?.querySelector('[aria-haspopup="menu"]') ?? null;
  return (
    <Menu
      label={`More for ${task.title}`}
      triggerClassName={className}
      items={[
        { label: 'Open', icon: icon(FileText), onSelect: () => board.openTask(task, trigger()) },
        { label: 'Edit', icon: icon(Pencil), onSelect: () => board.editTask(task) },
        {
          label: 'Move to phase…',
          icon: icon(ArrowRightLeft),
          onSelect: () => board.askMove(task),
        },
        {
          label: 'Delete',
          icon: icon(Trash2),
          tone: 'danger',
          onSelect: () => board.deleteTask(task),
        },
      ]}
    />
  );
}
