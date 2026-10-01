'use client';
// The "⋯" menu on a Projects row: Edit, Priority tasks (the card on the project page), Mark
// urgent or Remove urgent, Change status.
import Menu from '@/components/Menu';
import { useProjectEditor } from './ProjectEditorProvider';

export default function ProjectRowMenu({ project }) {
  const { openEdit, openAction } = useProjectEditor();
  const items = [
    { label: 'Edit', onSelect: () => openEdit(project) },
    { label: 'Priority tasks', href: `/projects/${project.id}#priority` },
  ];
  if (project.isUrgent) {
    items.push({ label: 'Remove urgent', onSelect: () => openAction('clearUrgent', project) });
  } else if (project.status === 'active') {
    items.push({ label: 'Mark urgent', onSelect: () => openAction('urgent', project) });
  }
  items.push({ label: 'Change status', onSelect: () => openAction('status', project) });
  return <Menu label={`Actions for ${project.name}`} items={items} />;
}
