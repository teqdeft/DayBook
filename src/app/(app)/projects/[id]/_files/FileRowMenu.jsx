'use client';
// A row's "⋯" for managers (CONTRACT 27, Files tab, Row menu): files "Download", "View text" or
// "Read text for AI", "Edit details", "Delete"; task files "Download", "Open task", "Edit details",
// "Delete"; notes "Open", "Edit", "Delete"; text-only documents "View text", "Edit details",
// "Delete". Daybook's flat Menu: arrow keys, Home, End, Escape back to the button.
import { Download, FileText, Pencil, Sparkles, StickyNote, Trash2 } from 'lucide-react';
import Menu from '@/components/Menu';
import { rowActions } from './filesTabView';
import styles from './FileListRow.module.css';

const icon = (Icon) => <Icon size={16} strokeWidth={1.8} aria-hidden="true" />;

const ITEMS = {
  download: { label: 'Download', icon: icon(Download) },
  viewText: { label: 'View text', icon: icon(FileText) },
  readText: { label: 'Read text for AI', icon: icon(Sparkles) },
  openTask: { label: 'Open task', icon: icon(FileText) },
  open: { label: 'Open', icon: icon(StickyNote) },
  edit: { label: 'Edit details', icon: icon(Pencil) },
  delete: { label: 'Delete', icon: icon(Trash2), tone: 'danger' },
};

/**
 * @param {{ item: object,
 *   onAction: (action: string, item: object, event: import('react').MouseEvent) => void }} props
 *   item: a filesItems item; onAction: 'download', 'viewText', 'readText', 'openTask', 'open',
 *   'edit' or 'delete', with the menu item's click (detail 0 from Enter or Space)
 */
export default function FileRowMenu({ item, onAction }) {
  const items = rowActions(item).map((action) => {
    const base = ITEMS[action];
    const label = action === 'edit' && item.type === 'note' ? 'Edit' : base.label;
    return { ...base, label, onSelect: (event) => onAction(action, item, event) };
  });
  return (
    <Menu
      label={`More for ${item.name}`}
      items={items}
      width={196}
      triggerClassName={styles.menuButton}
    />
  );
}
