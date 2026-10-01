'use client';
// Decline / Create project on a project request card. Create project opens the New project
// drawer filled from the request.
import { useState } from 'react';
import Button from '@/components/Button';
import { useProjectEditor } from '../projects/ProjectEditorProvider';
import DeclineDialog from './DeclineDialog';
import styles from './RequestActions.module.css';

export default function ProjectRequestActions({ request, moveTargets }) {
  const { openFromRequest } = useProjectEditor();
  const [declining, setDeclining] = useState(false);
  const personName = request.requester?.name ?? 'The requester';

  return (
    <div className={styles.actions}>
      <Button variant="secondary" size="compact" onClick={() => setDeclining(true)}>
        Decline
      </Button>
      <Button size="compact" onClick={() => openFromRequest(request)}>
        Create project
      </Button>
      {declining ? (
        <DeclineDialog
          title="Decline this project request?"
          description={`${personName} asked to add a project: ${request.name}.`}
          endpoint={`/api/project-requests/${request.id}/decline`}
          personName={personName}
          moveTargets={moveTargets}
          onClose={() => setDeclining(false)}
        />
      ) : null}
    </div>
  );
}
