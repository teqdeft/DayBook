'use client';
// "+ New project" in the Projects top bar.
import { Plus } from 'lucide-react';
import Button from '@/components/Button';
import { useProjectEditor } from './ProjectEditorProvider';

export default function NewProjectButton() {
  const { openCreate } = useProjectEditor();
  return (
    <Button icon={<Plus size={18} strokeWidth={1.8} aria-hidden="true" />} onClick={openCreate}>
      New project
    </Button>
  );
}
