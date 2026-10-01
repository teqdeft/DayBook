'use client';
// Holds the New project / Edit drawer and the row action dialogs for the Projects and Requests
// screens. Buttons anywhere under it open them with useProjectEditor().
import { createContext, useContext, useMemo, useState } from 'react';
import ProjectActionDialog from './ProjectActionDialog';
import ProjectDrawer from './ProjectDrawer';

const ProjectEditorContext = createContext(null);

/**
 * @returns {{ openCreate: () => void, openEdit: (project: object) => void,
 *   openFromRequest: (request: object) => void,
 *   openAction: (kind: 'urgent' | 'clearUrgent' | 'status', project: object) => void }}
 */
export function useProjectEditor() {
  const value = useContext(ProjectEditorContext);
  if (!value) throw new Error('useProjectEditor() needs a <ProjectEditorProvider> above it.');
  return value;
}

/**
 * @param {{ managers: Array<{ id: number, name: string }>, people: object[],
 *   viewer: { id: number, isAdmin: boolean }, children: import('react').ReactNode }} props
 *   managers: who the viewer may pick as PM; people: active people for the team picker
 */
export default function ProjectEditorProvider({ managers, people, viewer, children }) {
  const [editor, setEditor] = useState(null);
  const [action, setAction] = useState(null);

  const value = useMemo(
    () => ({
      openCreate: () => setEditor({ mode: 'create' }),
      openEdit: (project) => setEditor({ mode: 'edit', project }),
      openFromRequest: (request) => setEditor({ mode: 'request', request }),
      openAction: (kind, project) => setAction({ kind, project }),
    }),
    [],
  );

  return (
    <ProjectEditorContext.Provider value={value}>
      {children}
      {editor ? (
        <ProjectDrawer
          mode={editor.mode}
          project={editor.project}
          request={editor.request}
          managers={managers}
          people={people}
          viewer={viewer}
          onClose={() => setEditor(null)}
        />
      ) : null}
      {action ? (
        <ProjectActionDialog
          kind={action.kind}
          project={action.project}
          onClose={() => setAction(null)}
        />
      ) : null}
    </ProjectEditorContext.Provider>
  );
}
