// The note above the toolbar of a Completed project (CONTRACT 28, Completed note and Reopen): says
// once why nothing can be added, and the PM and Admins learn how to change that. It fades out when
// the project is reopened (`data-completed-fade`, ReopenProject.jsx). Server-safe.
import { Info } from 'lucide-react';
import styles from './FilterLine.module.css';

/** @param {{ manage: boolean }} props manage: the viewer is the project's PM or an Admin */
export default function CompletedNote({ manage }) {
  return (
    <p className={styles.note} data-completed-fade="">
      <Info size={16} strokeWidth={1.8} aria-hidden="true" />
      <span>
        This project is completed, so new tasks can&apos;t be added.
        {manage ? ' Use Reopen project to add tasks again.' : null}
      </span>
    </p>
  );
}
