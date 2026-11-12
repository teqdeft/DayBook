'use client';
// One file or note in "Files and notes" (CONTRACT 22), as the prototype draws it: its icon, the name
// (which opens its text in a small box under the row), how many pages and when it was added, then
// Edit (notes only) and Delete.
import { FileText, Pencil, StickyNote, Trash2 } from 'lucide-react';
import IconButton from '@/components/IconButton';
import DocumentText from './DocumentText';
import { deleteCopy, documentButtonId, documentDetail, documentTextId } from './documentsView';
import styles from './PhaseDocuments.module.css';

/**
 * @param {{ document: object, today: string, open: boolean, onToggle: () => void,
 *   onEdit: () => void, onDelete: (event: import('react').MouseEvent) => void }} props document:
 *   a listDocuments row with addedOn; open: its text box shows
 */
export default function DocumentRow({ document, today, open, onToggle, onEdit, onDelete }) {
  const { id, kind, title } = document;
  const Icon = kind === 'note' ? StickyNote : FileText;
  return (
    <li>
      <div className={styles.row}>
        <Icon className={styles.kindIcon} size={18} strokeWidth={1.8} aria-hidden="true" />
        <div className={styles.rowText}>
          <button
            type="button"
            id={documentButtonId(id, 'name')}
            className={styles.name}
            aria-expanded={open}
            aria-controls={open ? documentTextId(id) : undefined}
            onClick={onToggle}
          >
            {title}
          </button>
          <span className={styles.detail}>{documentDetail(document, today)}</span>
        </div>
        <span className={styles.actions}>
          {kind === 'note' ? (
            <IconButton
              variant="ghost"
              id={documentButtonId(id, 'edit')}
              className={styles.iconButton}
              label={`Edit note: ${title}`}
              icon={<Pencil size={16} strokeWidth={1.8} aria-hidden="true" />}
              onClick={onEdit}
            />
          ) : null}
          <IconButton
            variant="ghost"
            id={documentButtonId(id, 'delete')}
            className={styles.iconButton}
            label={deleteCopy(document).button}
            icon={<Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />}
            onClick={onDelete}
          />
        </span>
      </div>
      {open ? <DocumentText id={documentTextId(id)} document={document} /> : null}
    </li>
  );
}
